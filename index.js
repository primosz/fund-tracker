import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();

app.use(express.json());

// Serve static assets from public folder (for local running)
app.use(express.static(path.join(__dirname, 'public')));

// Fetch quotation directly from Analizy.pl API
async function fetchQuotation(type, code) {
  const url = `https://www.analizy.pl/api/quotation/${type}/${code}`;
  console.log(`Stateless Proxying request to: ${url}`);
  const response = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
    }
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch quotation: HTTP ${response.status}`);
  }

  return await response.json();
}

// API: Proxy quotation requests (caching handled by browser localStorage)
app.get('/api/quotation/:type/:code', async (req, res) => {
  const type = req.params.type.toLowerCase();
  const code = req.params.code.toUpperCase();

  try {
    const data = await fetchQuotation(type, code);
    res.json(data);
  } catch (error) {
    console.error(`Error proxying quotation for ${type}/${code}:`, error.message);
    res.status(500).json({ error: `Nie można pobrać notowań dla funduszu ${type}/${code}` });
  }
});

// API: Stateless validation of a fund URL or code
app.get('/api/validate', async (req, res) => {
  const { url } = req.query;
  if (!url) {
    return res.status(400).json({ error: 'Parametr URL jest wymagany.' });
  }

  let type = '';
  let code = '';

  try {
    let cleanUrl = url.trim();
    if (!cleanUrl.startsWith('http') && !cleanUrl.startsWith('/')) {
      if (cleanUrl.includes('analizy.pl/')) {
        cleanUrl = 'https://' + cleanUrl.substring(cleanUrl.indexOf('analizy.pl/'));
      } else if (cleanUrl.split('/').length === 2) {
        const parts = cleanUrl.split('/');
        if (parts[0].length === 3) {
          type = parts[0].toLowerCase();
          code = parts[1].toUpperCase();
        }
      }
    }

    if (!type && !code) {
      const isHttp = cleanUrl.startsWith('http');
      const parsed = isHttp ? new URL(cleanUrl) : { pathname: cleanUrl };
      const parts = parsed.pathname.split('/').filter(Boolean);
      
      if (parts.length >= 2) {
        const categorySlug = parts[0];
        const mappings = {
          'ubezpieczeniowe-fundusze-kapitalowe': 'ufk',
          'fundusze-inwestycyjne-otwarte': 'fio',
          'fundusze-ppk': 'ppk',
          'etf': 'etf',
          'fundusze-zagraniczne': 'fzg',
          'fundusze-inwestycyjne-zamkniete': 'fiz',
          'fundusze-emerytalne': 'ofe',
          'otwarte-fundusze-emerytalne': 'ofe'
        };
        
        type = mappings[categorySlug] || (categorySlug.length === 3 ? categorySlug : '');
        
        let scrapedCode = '';
        if (isHttp) {
          try {
            console.log(`Scraping page to resolve internal ID: ${cleanUrl}`);
            const pageRes = await fetch(cleanUrl, {
              headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
              }
            });
            if (pageRes.ok) {
              const html = await pageRes.text();
              const match = html.match(/window\.fundID\s*=\s*["']([^"']+)["']/);
              if (match && match[1]) {
                scrapedCode = match[1].toUpperCase();
                console.log(`Successfully scraped internal ID: ${scrapedCode}`);
              }
            }
          } catch (scrapeErr) {
            console.warn(`Scraping failed, falling back to URL code:`, scrapeErr.message);
          }
        }

        code = scrapedCode || parts[1].toUpperCase();
      }
    }
  } catch (error) {
    console.error("URL Parsing failed:", error.message);
  }

  type = type.toLowerCase();
  code = code.toUpperCase();

  if (!type || !code) {
    return res.status(400).json({ error: 'Nieprawidłowy format linku z Analizy.pl.' });
  }

  try {
    await fetchQuotation(type, code);
    res.json({ success: true, type, code });
  } catch (error) {
    res.status(400).json({ error: `Nie znaleziono funduszu ani ETF dla kodu ${type}/${code}. Upewnij się, że link prowadzi do poprawnego funduszu/ETF.` });
  }
});

// Export Express app for Vercel
export default app;
