// Single Node/Express service for Render: serves the static site in public/ and
// mounts the /api routes. The api/*.js handlers use the (req, res) shape that
// works under both Express and serverless, so they're reused as-is.
import express from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";

import login from "./api/login.js";
import logout from "./api/logout.js";
import session from "./api/session.js";
import catalog from "./api/catalog.js";
import generateStyle from "./api/generate-style.js";
import styles from "./api/styles.js";
import uploadImage from "./api/upload-image.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();

app.use(express.json({ limit: "1mb" }));

// Baseline security headers (previously in vercel.json).
app.use((req, res, next) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  next();
});

// Adapt a handler and surface unexpected errors as JSON rather than crashing.
const wrap = (handler) => (req, res) =>
  Promise.resolve(handler(req, res)).catch((err) => {
    console.error(err);
    if (!res.headersSent) res.status(500).json({ error: String(err?.message || err) });
  });

app.post("/api/login", wrap(login));
app.post("/api/logout", wrap(logout));
app.get("/api/session", wrap(session));
app.get("/api/catalog", wrap(catalog));
app.post("/api/generate-style", wrap(generateStyle));
app.post("/api/styles", wrap(styles));
app.post("/api/upload-image", wrap(uploadImage));

// Serve admin-uploaded sample images from the persistent disk, when configured.
if (process.env.UPLOAD_DIR) {
  app.use("/uploads", express.static(process.env.UPLOAD_DIR, { maxAge: "1h", index: false }));
}

// Static site (index.html served at /).
app.use(express.static(path.join(__dirname, "public"), { extensions: ["html"] }));

const port = process.env.PORT || 3000;
app.listen(port, () => console.log(`InfoStyles listening on :${port}`));
