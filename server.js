// Single Node/Express service for Render: serves the static site in public/ and
// mounts the /api routes. The api/*.js handlers use the (req, res) shape that
// works under both Express and serverless, so they're reused as-is.
import express from "express";
import compression from "compression";
import path from "node:path";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { mergeSkills, skillSlug } from "./lib/skill.js";
import { seedSkills } from "./lib/skillSeeds.js";
import { getSkills as storedSkills, getDeletedSkillIds } from "./lib/store.js";

import login from "./api/login.js";
import logout from "./api/logout.js";
import session from "./api/session.js";
import catalog from "./api/catalog.js";
import generateStyle from "./api/generate-style.js";
import styles from "./api/styles.js";
import uploadImage from "./api/upload-image.js";
import prompts from "./api/prompts.js";
import generatePrompt from "./api/generate-prompt.js";
import skills from "./api/skills.js";
import generateSkill from "./api/generate-skill.js";
import analyzeSkill from "./api/analyze-skill.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();

// Gzip responses; /api/prompts alone is ~330 KB of JSON uncompressed.
app.use(compression());
app.use(express.json({ limit: "1mb" }));

// Baseline security headers. CSP keeps scripts to same-origin (the theme-init
// script is an external file); inline styles are allowed for the palette swatches.
app.use((req, res, next) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  res.setHeader(
    "Content-Security-Policy",
    "default-src 'self'; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline'; " +
      "script-src 'self'; connect-src 'self'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'"
  );
  next();
});

// Block cross-origin state-changing requests (CSRF mitigation). Same-origin
// fetches send an Origin matching the host; cross-site POSTs are rejected.
app.use((req, res, next) => {
  if (req.method === "POST" && req.headers.origin) {
    let host;
    try {
      host = new URL(req.headers.origin).host;
    } catch {
      return res.status(403).json({ error: "Bad origin." });
    }
    if (host !== req.headers.host) {
      return res.status(403).json({ error: "Cross-origin request blocked." });
    }
  }
  next();
});

// Health check for Render.
app.get("/api/health", (req, res) => res.status(200).json({ ok: true }));

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
app.get("/api/prompts", wrap(prompts));
app.post("/api/prompts", wrap(prompts));
app.post("/api/generate-prompt", wrap(generatePrompt));
app.get("/api/skills", wrap(skills));
app.post("/api/skills", wrap(skills));
app.post("/api/generate-skill", wrap(generateSkill));
app.post("/api/analyze-skill", wrap(analyzeSkill));

// Serve admin-uploaded sample images from the persistent disk, when configured.
if (process.env.UPLOAD_DIR) {
  app.use("/uploads", express.static(process.env.UPLOAD_DIR, { maxAge: "1h", index: false }));
}

// ---- Client-side routes (History API): every page serves the shell. ----
const INDEX_PATH = path.join(__dirname, "public", "index.html");
const escapeHtml = (s) =>
  String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

app.get(["/styles", "/prompts", "/skills"], (req, res) => res.sendFile(INDEX_PATH));

// Skill detail pages get server-rendered <title>/OG tags so a shared link
// unfurls with the skill's own name and description.
app.get("/skills/:slug", async (req, res) => {
  let html = readFileSync(INDEX_PATH, "utf8");
  try {
    const [saved, deleted] = await Promise.all([storedSkills(), getDeletedSkillIds()]);
    const all = mergeSkills(seedSkills(), saved, deleted);
    const s = all.find((k) => skillSlug(k.id) === req.params.slug || k.id === req.params.slug);
    if (s) {
      const title = escapeHtml(`${s.name} — The AI Compendium Skills Hub`);
      const desc = escapeHtml(s.description || `A ${s.platform} skill from the InfoStyles Skills Hub.`);
      const url = escapeHtml(`https://infostyles.onrender.com/skills/${skillSlug(s.id)}`);
      // The <meta> tags in index.html wrap across lines, so match attributes
      // separated by any whitespace.
      html = html
        .replace(/<title>[^<]*<\/title>/, () => `<title>${title}</title>`)
        .replace(/(<meta\s+property="og:title"\s+content=")[^"]*(")/, (m, a, b) => a + title + b)
        .replace(/(<meta\s+property="og:description"\s+content=")[^"]*(")/, (m, a, b) => a + desc + b)
        .replace(/(<meta\s+property="og:url"\s+content=")[^"]*(")/, (m, a, b) => a + url + b)
        .replace(/(<meta\s+name="description"\s+content=")[^"]*(")/, (m, a, b) => a + desc + b);
    }
  } catch (err) {
    console.error("skill OG render failed:", err); // fall through to the plain shell
  }
  res.type("html").send(html);
});

// Static site (index.html served at /).
app.use(express.static(path.join(__dirname, "public"), { extensions: ["html"] }));

const port = process.env.PORT || 3000;
app.listen(port, () => console.log(`InfoStyles listening on :${port}`));
