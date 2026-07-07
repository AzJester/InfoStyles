import { requireAdmin } from "../lib/auth.js";
import { slugify } from "../lib/style.js";
import { promises as fs } from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

// Admin-only: store a document (PDF, Office, text…) on the Render persistent
// disk (UPLOAD_DIR) and return a relative URL served from /uploads. Unlike
// upload-image this takes the raw file bytes (no base64/JSON inflation);
// server.js mounts express.raw for this route. The filename arrives as a
// query param; only its slug survives into the stored name.
const UPLOAD_DIR = process.env.UPLOAD_DIR;
const SUBDIR = "files";
const MAX_BYTES = 10 * 1024 * 1024;

// Extensions we're willing to store and serve. Nothing browser-executable
// (html/svg/xml/js) — those could run script on this origin.
const ALLOWED_EXT = new Set([
  "pdf", "doc", "docx", "xls", "xlsx", "ppt", "pptx",
  "txt", "md", "csv", "json", "rtf", "zip",
  "png", "jpg", "jpeg", "webp", "gif",
]);

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });
  if (!requireAdmin(req, res)) return;
  if (!UPLOAD_DIR) {
    return res.status(503).json({ error: "File uploads are not configured (no disk / UPLOAD_DIR)." });
  }

  if (!Buffer.isBuffer(req.body)) return res.status(400).json({ error: "Expected the raw file bytes." });
  if (!req.body.length) return res.status(400).json({ error: "The file is empty." });
  if (req.body.length > MAX_BYTES) return res.status(413).json({ error: "File too large (max 10MB)." });

  const original = String(req.query?.filename || "file");
  const ext = (original.includes(".") ? original.split(".").pop() : "").toLowerCase();
  if (!ALLOWED_EXT.has(ext)) {
    return res.status(400).json({ error: `That file type isn't allowed. Use: ${[...ALLOWED_EXT].join(", ")}.` });
  }

  // Server-generated filename (slug + random) avoids any path-traversal from client input.
  const base = original.replace(/\.[^.]*$/, "");
  const safe = (slugify(base) || "file").slice(0, 40);
  const name = `${safe}-${crypto.randomBytes(6).toString("hex")}.${ext}`;
  const dir = path.join(UPLOAD_DIR, SUBDIR);

  try {
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(path.join(dir, name), req.body);
    return res.status(200).json({ url: `/uploads/${SUBDIR}/${name}`, name: original.slice(0, 120) });
  } catch (err) {
    return res.status(500).json({ error: `Save failed: ${err?.message || err}` });
  }
}
