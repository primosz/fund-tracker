document.addEventListener('DOMContentLoaded', () => {
    // API endpoint references
    const API_URL = '/api';

    // Global state
    let trackedFunds = [];
    let fundsData = [];
    const chartInstances = {}; // Track ApexCharts instances by fund ID

    // DOM Elements
    const statsTotalCount = document.getElementById('stats-total-count');
    const statsAvgPerformance = document.getElementById('stats-avg-performance');
    const statsLastSync = document.getElementById('stats-last-sync');
    const btnRefreshAll = document.getElementById('btn-refresh-all');
    const addFundForm = document.getElementById('add-fund-form');
    const fundUrlInput = document.getElementById('fund-url-input');
    const btnAddFund = document.getElementById('btn-add-fund');
    const errorMessage = document.getElementById('error-message');
    const errorText = errorMessage.querySelector('.error-text');
    const globalLoading = document.getElementById('global-loading');
    const emptyState = document.getElementById('empty-state');
    const fundsGrid = document.getElementById('funds-grid');

    // Retrieve list of tracked funds from LocalStorage
    function getTrackedList() {
        try {
            const listJson = localStorage.getItem('fund_tracker_list');
            if (listJson) {
                return JSON.parse(listJson);
            }
        } catch (e) {
            console.error("Failed to parse fund_tracker_list from localStorage:", e);
        }
        
        // Default initial fund (Generali Obligacji UFK)
        const defaultList = [{ type: 'ufk', code: 'UGEN4' }];
        saveTrackedList(defaultList);
        return defaultList;
    }

    // Save tracked funds list to LocalStorage
    function saveTrackedList(list) {
        try {
            localStorage.setItem('fund_tracker_list', JSON.stringify(list));
        } catch (e) {
            console.error("Failed to save fund_tracker_list to localStorage:", e);
        }
    }

    // Retrieve cached fund quotation data from LocalStorage
    function getCachedQuotation(type, code) {
        try {
            const cacheKey = `fund_cache_${type.toLowerCase()}_${code.toUpperCase()}`;
            const cacheJson = localStorage.getItem(cacheKey);
            if (cacheJson) {
                const cache = JSON.parse(cacheJson);
                const CACHE_DURATION_MS = 60 * 60 * 1000; // 1 hour
                if (Date.now() - cache.timestamp < CACHE_DURATION_MS) {
                    return cache.data;
                }
            }
        } catch (e) {
            console.error(`Failed to read cache for ${type}/${code}:`, e);
        }
        return null;
    }

    // Save fund quotation data to LocalStorage cache
    function saveCachedQuotation(type, code, data) {
        try {
            const cacheKey = `fund_cache_${type.toLowerCase()}_${code.toUpperCase()}`;
            localStorage.setItem(cacheKey, JSON.stringify({
                timestamp: Date.now(),
                data: data
            }));
        } catch (e) {
            console.error(`Failed to write cache for ${type}/${code}:`, e);
        }
    }

    // Clear all fund quotation caches
    function clearAllCaches() {
        try {
            const keysToRemove = [];
            for (let i = 0; i < localStorage.length; i++) {
                const key = localStorage.key(i);
                if (key && key.startsWith('fund_cache_')) {
                    keysToRemove.push(key);
                }
            }
            keysToRemove.forEach(key => localStorage.removeItem(key));
            console.log("Cleared all local quotation caches.");
        } catch (e) {
            console.error("Failed to clear localStorage caches:", e);
        }
    }

    // Fetch quotation data from backend proxy
    async function fetchQuotation(type, code) {
        const response = await fetch(`${API_URL}/quotation/${type}/${code}`);
        if (!response.ok) {
            throw new Error(`Błąd HTTP ${response.status}`);
        }
        return await response.json();
    }

    // Fetch and load dashboard data
    async function loadDashboard(showLoader = true, forceRefresh = false) {
        if (showLoader) {
            globalLoading.style.display = 'flex';
            fundsGrid.style.display = 'none';
            emptyState.style.display = 'none';
        }

        trackedFunds = getTrackedList();
        fundsData = [];

        for (const fund of trackedFunds) {
            try {
                let data = null;
                if (!forceRefresh) {
                    data = getCachedQuotation(fund.type, fund.code);
                }

                if (!data) {
                    data = await fetchQuotation(fund.type, fund.code);
                    saveCachedQuotation(fund.type, fund.code, data);
                }

                // Extract first series (the fund itself)
                const series = data.series && data.series[0];
                const prices = (series && series.price) || [];
                
                let currentValue = 0;
                let changeAbs = 0;
                let changePct = 0;
                let lastUpdate = 'N/A';

                if (prices.length > 0) {
                    const last = prices[prices.length - 1];
                    currentValue = last.value;
                    lastUpdate = last.date;

                    if (prices.length > 1) {
                        const prev = prices[prices.length - 2];
                        changeAbs = currentValue - prev.value;
                        changePct = prev.value !== 0 ? (changeAbs / prev.value) * 100 : 0;
                    }
                }

                fundsData.push({
                    id: `${fund.type}/${fund.code}`,
                    type: fund.type,
                    code: fund.code,
                    name: data.label || `${fund.type.toUpperCase()} / ${fund.code.toUpperCase()}`,
                    currency: data.currency || 'PLN',
                    currentValue: parseFloat(currentValue.toFixed(4)),
                    changeAbs: parseFloat(changeAbs.toFixed(4)),
                    changePct: parseFloat(changePct.toFixed(2)),
                    lastUpdate,
                    prices: prices
                });
            } catch (error) {
                console.error(`Skipping fund ${fund.type}/${fund.code} due to fetch error:`, error.message);
                
                // Fallback to expired cache if available during load failure
                try {
                    const cacheKey = `fund_cache_${fund.type.toLowerCase()}_${fund.code.toUpperCase()}`;
                    const rawItem = localStorage.getItem(cacheKey);
                    if (rawItem) {
                        const cached = JSON.parse(rawItem);
                        const series = cached.data.series && cached.data.series[0];
                        const prices = (series && series.price) || [];
                        const last = prices[prices.length - 1];
                        const prev = prices[prices.length - 2] || last;
                        const changeAbs = last.value - prev.value;
                        const changePct = prev.value !== 0 ? (changeAbs / prev.value) * 100 : 0;
                        
                        fundsData.push({
                            id: `${fund.type}/${fund.code}`,
                            type: fund.type,
                            code: fund.code,
                            name: cached.data.label || `${fund.type.toUpperCase()}`,
                            currency: cached.data.currency || 'PLN',
                            currentValue: last.value,
                            changeAbs,
                            changePct,
                            lastUpdate: last.date,
                            prices,
                            stale: true
                        });
                        continue;
                    }
                } catch(e) {}

                // Push error node
                fundsData.push({
                    id: `${fund.type}/${fund.code}`,
                    type: fund.type,
                    code: fund.code,
                    name: `${fund.type.toUpperCase()} / ${fund.code.toUpperCase()}`,
                    currency: 'PLN',
                    currentValue: 0,
                    changeAbs: 0,
                    changePct: 0,
                    lastUpdate: 'Błąd połączenia',
                    prices: [],
                    error: true
                });
            }
        }

        updateStats();
        renderFunds();

        if (showLoader) {
            globalLoading.style.display = 'none';
        }
    }

    // Update stats bar
    function updateStats() {
        statsTotalCount.textContent = fundsData.length;

        // Calculate average daily performance (exclude funds with errors)
        const validFunds = fundsData.filter(f => !f.error);
        if (validFunds.length > 0) {
            const sum = validFunds.reduce((acc, f) => acc + f.changePct, 0);
            const avg = sum / validFunds.length;
            statsAvgPerformance.textContent = (avg >= 0 ? '+' : '') + avg.toFixed(2) + '%';
            
            if (avg > 0) {
                statsAvgPerformance.style.color = 'var(--green-accent)';
            } else if (avg < 0) {
                statsAvgPerformance.style.color = 'var(--red-accent)';
            } else {
                statsAvgPerformance.style.color = 'var(--text-primary)';
            }
        } else {
            statsAvgPerformance.textContent = '0.00%';
            statsAvgPerformance.style.color = 'var(--text-primary)';
        }

        const now = new Date();
        statsLastSync.textContent = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    }

    // Show error message helper
    function showError(text) {
        errorText.textContent = text;
        errorMessage.style.display = 'flex';
        setTimeout(() => {
            errorMessage.style.display = 'none';
        }, 8000);
    }

    // Add fund form handler (stateless validation)
    addFormInputFocus();
    function addFormInputFocus() {
        fundUrlInput.addEventListener('focus', () => {
            errorMessage.style.display = 'none';
        });
    }

    addFundForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const urlValue = fundUrlInput.value.trim();
        if (!urlValue) return;

        // Disable form and show loader
        fundUrlInput.disabled = true;
        btnAddFund.disabled = true;
        const origBtnContent = btnAddFund.innerHTML;
        btnAddFund.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i><span>Weryfikacja...</span>';

        try {
            const response = await fetch(`${API_URL}/validate?url=${encodeURIComponent(urlValue)}`);
            
            if (!response.ok) {
                let errorMsg = 'Nie można zweryfikować funduszu.';
                try {
                    const data = await response.json();
                    errorMsg = data.error || errorMsg;
                } catch (e) {}
                throw new Error(errorMsg);
            }

            const data = await response.json();
            const { type, code } = data;

            // Check if already in the list
            const currentList = getTrackedList();
            const exists = currentList.some(f => f.type === type && f.code === code);

            if (exists) {
                throw new Error('Ten fundusz jest już na Twojej liście.');
            }

            // Append and save list
            currentList.push({ type, code });
            saveTrackedList(currentList);
            
            // Force fetch quotation to write cache immediately
            const quotationData = await fetchQuotation(type, code);
            saveCachedQuotation(type, code, quotationData);

            fundUrlInput.value = '';
            await loadDashboard(true);
        } catch (error) {
            console.error('Error adding fund:', error);
            showError(error.message);
        } finally {
            fundUrlInput.disabled = false;
            btnAddFund.disabled = false;
            btnAddFund.innerHTML = origBtnContent;
        }
    });

    // Refresh all button handler (clears client cache and fetches fresh)
    btnRefreshAll.addEventListener('click', async () => {
        btnRefreshAll.classList.add('loading');
        btnRefreshAll.disabled = true;
        
        try {
            clearAllCaches();
            await loadDashboard(false, true);
        } catch (error) {
            console.error('Error refreshing funds:', error);
            showError('Błąd połączenia z serwerem podczas odświeżania.');
        } finally {
            btnRefreshAll.classList.remove('loading');
            btnRefreshAll.disabled = false;
        }
    });

    // Delete fund handler
    async function deleteFund(type, code) {
        if (!type || !code) {
            showError('Błędne dane identyfikacyjne funduszu.');
            return;
        }
        
        const displayCode = code.toUpperCase();
        if (!confirm(`Czy na pewno chcesz usunąć fundusz ${displayCode}?`)) return;

        try {
            // Remove from local tracked list
            let currentList = getTrackedList();
            currentList = currentList.filter(f => !(f.type.toLowerCase() === type.toLowerCase() && f.code.toUpperCase() === code.toUpperCase()));
            saveTrackedList(currentList);

            // Remove quotation cache
            const cacheKey = `fund_cache_${type.toLowerCase()}_${code.toUpperCase()}`;
            localStorage.removeItem(cacheKey);

            await loadDashboard(true);
        } catch (error) {
            console.error('Error deleting fund:', error);
            showError('Nie udało się usunąć funduszu.');
        }
    }

    // Date calculations helper to filter history
    function getCutoffDate(baselineStr, monthsAgo) {
        const d = new Date(baselineStr);
        d.setMonth(d.getMonth() - monthsAgo);
        return d.toISOString().split('T')[0];
    }

    // Filter time-series price data locally
    function filterPricesByPeriod(prices, period) {
        if (!prices || prices.length === 0) return [];
        
        const lastPrice = prices[prices.length - 1];
        if (!lastPrice || !lastPrice.date) return [];
        const lastDateStr = lastPrice.date;

        let cutoffDate = '';
        const year = lastDateStr.split('-')[0];

        switch(period) {
            case '1M':
                cutoffDate = getCutoffDate(lastDateStr, 1);
                break;
            case '3M':
                cutoffDate = getCutoffDate(lastDateStr, 3);
                break;
            case '6M':
                cutoffDate = getCutoffDate(lastDateStr, 6);
                break;
            case '1Y':
                cutoffDate = getCutoffDate(lastDateStr, 12);
                break;
            case 'YTD':
                cutoffDate = `${year}-01-01`;
                break;
            case 'MAX':
            default:
                return prices;
        }

        return prices.filter(p => p.date >= cutoffDate);
    }

    // Render individual ApexChart
    function renderFundChart(fundId, prices, isPositive, period = '1Y') {
        if (!fundId) return;
        const containerId = `chart-${fundId.replace('/', '-')}`;
        const container = document.getElementById(containerId);
        if (!container) return;

        if (chartInstances[fundId]) {
            try {
                chartInstances[fundId].destroy();
            } catch (e) {
                console.warn(`Error destroying chart ${fundId}:`, e);
            }
            delete chartInstances[fundId];
        }

        const filteredPrices = filterPricesByPeriod(prices, period);
        if (filteredPrices.length === 0) {
            container.innerHTML = '<div style="color: var(--text-muted); font-size: 0.8rem; text-align: center; padding-top: 4rem;">Brak danych historycznych</div>';
            return;
        }
        
        const categories = filteredPrices.map(p => p.date);
        const dataValues = filteredPrices.map(p => p.value);

        const themeColor = isPositive ? '#34c759' : '#ff3b30';

        if (typeof ApexCharts === 'undefined') {
            container.innerHTML = '<div style="color: var(--apple-red); font-size: 0.8rem; text-align: center; padding-top: 4rem;">ApexCharts nie załadowany</div>';
            return;
        }

        const options = {
            chart: {
                type: 'area',
                height: 160,
                sparkline: { enabled: true },
                animations: { enabled: true, easing: 'easeinout', speed: 400 },
                background: 'transparent'
            },
            stroke: {
                curve: 'smooth',
                width: 2,
                colors: [themeColor]
            },
            fill: {
                type: 'gradient',
                gradient: {
                    shadeIntensity: 1,
                    opacityFrom: 0.12,
                    opacityTo: 0.0,
                    stops: [0, 100]
                }
            },
            series: [{
                name: 'Cena jednostki',
                data: dataValues
            }],
            xaxis: {
                categories: categories,
                type: 'datetime'
            },
            yaxis: {
                labels: {
                    formatter: function(val) {
                        return val.toFixed(2);
                    }
                }
            },
            tooltip: {
                theme: 'light',
                x: { format: 'dd.MM.yyyy' },
                y: {
                    formatter: function(val) {
                        return val.toFixed(4) + ' PLN';
                    }
                },
                style: {
                    fontSize: '11px',
                    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto'
                },
                marker: { show: false }
            },
            grid: {
                padding: { top: 10, right: 10, bottom: 5, left: 10 }
            }
        };

        const chart = new ApexCharts(container, options);
        chart.render();
        chartInstances[fundId] = chart;
    }

    // Render cards list
    function renderFunds() {
        Object.keys(chartInstances).forEach(key => {
            try { chartInstances[key].destroy(); } catch(e){}
            delete chartInstances[key];
        });
        
        fundsGrid.innerHTML = '';

        if (fundsData.length === 0) {
            emptyState.style.display = 'block';
            fundsGrid.style.display = 'none';
            return;
        }

        emptyState.style.display = 'none';
        fundsGrid.style.display = 'grid';

        fundsData.forEach(fund => {
            const isPositive = fund.changePct >= 0;
            const card = document.createElement('div');
            card.className = 'fund-card';
            
            const typeColor = `var(--${fund.type}-color, var(--primary-color))`;
            card.style.setProperty('--primary-color', typeColor);

            if (fund.error) {
                card.innerHTML = `
                    <div class="card-header">
                        <div class="fund-badge-group">
                            <span class="type-badge ${fund.type}">${fund.type}</span>
                            <span class="code-badge">${fund.code}</span>
                        </div>
                        <button class="btn-delete" data-type="${fund.type}" data-code="${fund.code}">
                            <i class="fa-solid fa-trash-can"></i>
                        </button>
                    </div>
                    <div class="fund-title" style="height: auto;">Błąd wczytywania funduszu</div>
                    <div style="color: var(--red-accent); font-size: 0.85rem; margin: 1rem 0;">
                        Nie można połączyć się z serwerem notowań dla tej jednostki.
                    </div>
                `;
                
                card.querySelector('.btn-delete').addEventListener('click', () => deleteFund(fund.type, fund.code));
                fundsGrid.appendChild(card);
                return;
            }

            const changeSign = isPositive ? '+' : '';
            const changeClass = fund.changePct > 0 ? 'positive' : (fund.changePct < 0 ? 'negative' : 'neutral');
            const changeIcon = isPositive ? 'fa-arrow-trend-up' : 'fa-arrow-trend-down';
            const staleBadge = fund.stale ? '<span class="type-badge" style="background:rgba(255,255,255,0.05);color:var(--text-secondary);font-size:0.6rem;margin-left:0.25rem;">Z bufora</span>' : '';

            card.innerHTML = `
                <div class="card-header">
                    <div class="fund-badge-group">
                        <span class="type-badge ${fund.type}">${fund.type}</span>
                        <span class="code-badge">${fund.code}</span>
                        ${staleBadge}
                    </div>
                    <button class="btn-delete" data-type="${fund.type}" data-code="${fund.code}" title="Usuń fundusz z panelu">
                        <i class="fa-solid fa-trash-can"></i>
                    </button>
                </div>
                
                <div class="fund-title" title="${fund.name}">${fund.name}</div>
                
                <div class="card-price-section">
                    <div class="price-main">
                        <h3>${fund.currentValue.toLocaleString('pl-PL', { minimumFractionDigits: 2, maximumFractionDigits: 4 })}<span>${fund.currency}</span></h3>
                        <p>Notowanie z dnia: ${fund.lastUpdate}</p>
                    </div>
                    <div class="change-badge ${changeClass}">
                        <i class="fa-solid ${changeIcon}"></i>
                        <span>${changeSign}${fund.changePct.toFixed(2)}%</span>
                    </div>
                </div>

                <div class="card-chart-controls">
                    <span class="chart-title">Wykres wartości</span>
                    <div class="timeframe-selectors" data-fund-id="${fund.id}">
                        <button class="btn-timeframe" data-period="1M">1M</button>
                        <button class="btn-timeframe" data-period="3M">3M</button>
                        <button class="btn-timeframe" data-period="6M">6M</button>
                        <button class="btn-timeframe active" data-period="1Y">1Y</button>
                        <button class="btn-timeframe" data-period="YTD">YTD</button>
                        <button class="btn-timeframe" data-period="MAX">MAX</button>
                    </div>
                </div>

                <div class="fund-chart-container" id="chart-${fund.id.replace('/', '-')}"></div>
            `;

            fundsGrid.appendChild(card);

            // Set up delete handler immediately (guaranteed to be registered first)
            card.querySelector('.btn-delete').addEventListener('click', () => deleteFund(fund.type, fund.code));

            // Render default chart (1Y) inside try-catch to isolate errors
            try {
                renderFundChart(fund.id, fund.prices, isPositive, '1Y');
            } catch (chartError) {
                console.error(`Failed to render chart for ${fund.id}:`, chartError);
            }

            // Set up timeframe button handlers
            const tfButtons = card.querySelectorAll('.btn-timeframe');
            tfButtons.forEach(btn => {
                btn.addEventListener('click', (e) => {
                    tfButtons.forEach(b => b.classList.remove('active'));
                    btn.classList.add('active');

                    const period = btn.getAttribute('data-period');
                    renderFundChart(fund.id, fund.prices, isPositive, period);
                });
            });
        });
    }

    // Set up hourly background refreshes automatically
    setInterval(() => {
        console.log("Triggering scheduled hourly background refresh...");
        loadDashboard(false);
    }, 60 * 60 * 1000); // 1 hour

    // Initial load
    loadDashboard(true);
});
