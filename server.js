import express from "express";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();

app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

// API: Proxy quotation requests
app.get("/api/quotation/:type/:code", async (req, res) => {
  const type = req.params.type.toLowerCase();
  const code = req.params.code.toUpperCase();

  try {
    const url = `https://www.analizy.pl/api/quotation/${type}/${code}`;

    const response = await fetch(url);
    if (!response.ok) throw new Error("Fetch failed");

    const data = await response.json();
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: "Failed to fetch quotation" });
  }
});

// API: validation
app.get("/api/validate", async (req, res) => {
  res.json({ ok: true });
});

// IMPORTANT: export app (NO app.listen!)
export default app;