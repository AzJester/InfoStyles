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
import { mergePrompts } from "./lib/prompt.js";
import { seedPrompts } from "./lib/promptSeeds.js";
import {
  kvAvailable,
  exportAll,
  getCatalog as storedCatalog,
  getPrompts as storedPrompts,
  getDeletedPromptIds,
  getSkills as storedSkills,
  getDeletedSkillIds,
} from "./lib/store.js";

import login from "./api/login.js";
import logout from "./api/logout.js";
import session from "./api/session.js";
import catalog from "./api/catalog.js";
import generateStyle from "./api/generate-style.js";
import styles from "./api/styles.js";
import uploadImage from "./api/upload-image.js";
import uploadFile from "./api/upload-file.js";
import prompts from "./api/prompts.js";
import generatePrompt from "./api/generate-prompt.js";
import skills from "./api/skills.js";
import generateSkill from "./api/generate-skill.js";
import analyzeSkill from "./api/analyze-skill.js";
import backup from "./api/backup.js";
import trash from "./api/trash.js";
import track from "./api/track.js";
import studio from "./api/studio.js";
import submissions from "./api/submissions.js";
import submit from "./api/submit.js";

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
// Documents arrive as raw bytes (filename in ?filename=), not JSON — the
// global express.json only parses application/json bodies, so it skips these.
app.post("/api/upload-file", express.raw({ type: () => true, limit: "11mb" }), wrap(uploadFile));
app.get("/api/prompts", wrap(prompts));
app.post("/api/prompts", wrap(prompts));
app.post("/api/generate-prompt", wrap(generatePrompt));
app.get("/api/skills", wrap(skills));
app.post("/api/skills", wrap(skills));
app.post("/api/generate-skill", wrap(generateSkill));
app.post("/api/analyze-skill", wrap(analyzeSkill));
app.get("/api/backup", wrap(backup));
app.post("/api/backup", wrap(backup));
app.get("/api/trash", wrap(trash));
app.post("/api/trash", wrap(trash));
app.post("/api/track", wrap(track));
app.get("/api/studio", wrap(studio));
app.post("/api/studio", wrap(studio));
app.get("/api/submissions", wrap(submissions));
app.post("/api/submissions", wrap(submissions));
app.post("/api/submit", wrap(submit));

// Serve admin-uploaded sample images and documents from the persistent disk,
// when configured. Documents (uploads/files/) download rather than render
// inline — except PDFs, which browsers display safely — so nothing under
// /uploads can ever execute in this origin.
if (process.env.UPLOAD_DIR) {
  app.use(
    "/uploads",
    express.static(process.env.UPLOAD_DIR, {
      maxAge: "1h",
      index: false,
      setHeaders: (res, filePath) => {
        if (filePath.includes(`${path.sep}files${path.sep}`) && !filePath.toLowerCase().endsWith(".pdf")) {
          res.setHeader("Content-Disposition", "attachment");
        }
      },
    })
  );
}

// ---- Client-side routes (History API): every page serves the shell. ----
const INDEX_PATH = path.join(__dirname, "public", "index.html");
const escapeHtml = (s) =>
  String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

// Public origin, derived from the request so a service rename or custom
// domain needs no code change.
const originOf = (req) => `${req.headers["x-forwarded-proto"]?.split(",")[0] || "https"}://${req.headers.host}`;

// Rewrite the shell's <title>/description/OG tags for a specific record so a
// shared link unfurls with its own name. The meta tags wrap across lines, so
// attribute matching tolerates any whitespace. `extra` is injected raw before
// </head> (used for JSON-LD).
function shellWith(req, { title, desc, path: urlPath, extra = "" }) {
  let html = readFileSync(INDEX_PATH, "utf8");
  const t = escapeHtml(title);
  const d = escapeHtml(desc);
  const url = escapeHtml(`${originOf(req)}${urlPath}`);
  html = html
    .replace(/<title>[^<]*<\/title>/, () => `<title>${t}</title>`)
    .replace(/(<meta\s+property="og:title"\s+content=")[^"]*(")/, (m, a, b) => a + t + b)
    .replace(/(<meta\s+property="og:description"\s+content=")[^"]*(")/, (m, a, b) => a + d + b)
    .replace(/(<meta\s+property="og:url"\s+content=")[^"]*(")/, (m, a, b) => a + url + b)
    .replace(/(<meta\s+name="description"\s+content=")[^"]*(")/, (m, a, b) => a + d + b);
  if (extra) html = html.replace("</head>", `${extra}\n</head>`);
  return html;
}

async function allSkills() {
  const [saved, deleted] = await Promise.all([storedSkills(), getDeletedSkillIds()]);
  return mergeSkills(seedSkills(), saved, deleted);
}

// Styles seeds, loaded once (the committed JSON the client also uses).
let styleSeedCache;
function styleSeeds() {
  if (!styleSeedCache) {
    try {
      styleSeedCache = JSON.parse(readFileSync(path.join(__dirname, "public", "data", "styles.json"), "utf8"));
    } catch {
      styleSeedCache = [];
    }
  }
  return styleSeedCache;
}

// /styles and /prompts serve the shell; when a share link names a record
// (?style= / ?prompt=), its title/description are injected for link unfurls.
app.get("/styles", async (req, res) => {
  const id = req.query.style;
  if (id) {
    try {
      const cat = await storedCatalog().catch(() => ({ overrides: {}, custom: [] }));
      const s =
        cat.custom.find((x) => x.id === id) ||
        (() => {
          const seed = styleSeeds().find((x) => x.id === id);
          const ov = cat.overrides[id];
          return seed && !(ov && ov._deleted) ? { ...seed, ...(ov || {}) } : seed;
        })();
      if (s) {
        return res.type("html").send(
          shellWith(req, {
            title: `${s.style} — The AI Compendium Style Library`,
            desc: `${s.category ? `${s.category} · ` : ""}An infographic & slide style with a ready palette and copy-ready prompts.`,
            path: `/styles?style=${encodeURIComponent(id)}`,
          })
        );
      }
    } catch (err) {
      console.error("style OG render failed:", err);
    }
  }
  res.sendFile(INDEX_PATH);
});

app.get("/prompts", async (req, res) => {
  const id = req.query.prompt;
  if (id) {
    try {
      const [saved, deleted] = await Promise.all([
        storedPrompts().catch(() => []),
        getDeletedPromptIds().catch(() => []),
      ]);
      const p = mergePrompts(seedPrompts(), saved, deleted).find((x) => x.id === id);
      if (p) {
        return res.type("html").send(
          shellWith(req, {
            title: `${p.title} — The AI Compendium Prompt Library`,
            desc: (p.body || "").replace(/\s+/g, " ").slice(0, 200),
            path: `/prompts?prompt=${encodeURIComponent(id)}`,
          })
        );
      }
    } catch (err) {
      console.error("prompt OG render failed:", err);
    }
  }
  res.sendFile(INDEX_PATH);
});

app.get("/skills", (req, res) => res.sendFile(INDEX_PATH));

// Skill detail pages get server-rendered <title>/OG tags plus JSON-LD so a
// shared link unfurls with the skill's own name and crawlers see structured data.
app.get("/skills/:slug", async (req, res) => {
  try {
    const s = (await allSkills()).find((k) => skillSlug(k.id) === req.params.slug || k.id === req.params.slug);
    if (s) {
      const ld = {
        "@context": "https://schema.org",
        "@type": "HowTo",
        name: s.name,
        description: s.description || undefined,
        datePublished: s.updated || undefined,
        author: s.author ? { "@type": "Person", name: s.author } : undefined,
        keywords: (s.tags || []).join(", ") || undefined,
      };
      return res.type("html").send(
        shellWith(req, {
          title: `${s.name} — The AI Compendium Skills Hub`,
          desc: s.description || `A ${s.platform} skill from The AI Compendium Skills Hub.`,
          path: `/skills/${skillSlug(s.id)}`,
          extra: `<script type="application/ld+json">${JSON.stringify(ld).replace(/</g, "\\u003c")}</script>`,
        })
      );
    }
  } catch (err) {
    console.error("skill OG render failed:", err); // fall through to the plain shell
  }
  res.sendFile(INDEX_PATH);
});

// ---- Crawlers: robots + a sitemap listing every page incl. skill details ----
app.get("/robots.txt", (req, res) => {
  res.type("text/plain").send(`User-agent: *\nAllow: /\nSitemap: ${originOf(req)}/sitemap.xml\n`);
});

app.get("/sitemap.xml", async (req, res) => {
  const base = originOf(req);
  let slugs = [];
  try {
    slugs = (await allSkills()).map((s) => skillSlug(s.id));
  } catch {
    slugs = seedSkills().map((s) => skillSlug(s.id));
  }
  const urls = ["/", "/styles", "/prompts", "/skills", ...slugs.map((x) => `/skills/${encodeURIComponent(x)}`)]
    .map((u) => `  <url><loc>${escapeHtml(base + u)}</loc></url>`)
    .join("\n");
  res.setHeader("Cache-Control", "public, max-age=3600");
  res.type("application/xml").send(`<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>\n`);
});

// Static site (index.html served at /).
app.use(express.static(path.join(__dirname, "public"), { extensions: ["html"] }));

// ---- Daily backup snapshot to the persistent disk (belt and suspenders on
// top of the admin's manual export). Keeps the last 14 days. ----
if (process.env.UPLOAD_DIR && kvAvailable()) {
  const { writeFileSync, mkdirSync, readdirSync, unlinkSync } = await import("node:fs");
  const dir = path.join(process.env.UPLOAD_DIR, "backups");
  const snapshot = async () => {
    try {
      mkdirSync(dir, { recursive: true });
      const snap = await exportAll();
      writeFileSync(path.join(dir, `backup-${snap.exportedAt.slice(0, 10)}.json`), JSON.stringify(snap));
      const old = readdirSync(dir).filter((f) => /^backup-\d{4}-\d{2}-\d{2}\.json$/.test(f)).sort().slice(0, -14);
      for (const f of old) unlinkSync(path.join(dir, f));
      console.log(`backup snapshot written (${dir})`);
    } catch (err) {
      console.error("backup snapshot failed:", err?.message || err);
    }
  };
  setTimeout(snapshot, 60 * 1000); // one on boot (delayed so Redis is up)
  setInterval(snapshot, 24 * 60 * 60 * 1000).unref();
}

const port = process.env.PORT || 3000;
app.listen(port, () => console.log(`The AI Compendium listening on :${port}`));
