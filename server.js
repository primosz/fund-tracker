import app from "./api/index.js";

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`Local development server running at http://localhost:${PORT}`);
});