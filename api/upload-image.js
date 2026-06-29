import { requireAdmin } from "../lib/auth.js";
import { slugify } from "../lib/style.js";
import { promises as fs } from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

// Admin-only: store a sample image on the Render persistent disk (UPLOAD_DIR)
// and return a relative URL the app serves from /uploads. The browser downscales
// and sends a base64 data URL (JSON) so the request stays small.
const UPLOAD_DIR = process.env.UPLOAD_DIR;
const SUBDIR = "samples";

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });
  if (!requireAdmin(req, res)) return;
  if (!UPLOAD_DIR) {
    return res.status(503).json({ error: "Image uploads are not configured (no disk / UPLOAD_DIR)." });
  }

  const { dataUrl, filename } = req.body || {};
  const m = /^data:(image\/(png|jpe?g|webp|gif));base64,(.+)$/i.exec(String(dataUrl || ""));
  if (!m) return res.status(400).json({ error: "Expected a base64 image data URL." });

  const ext = m[2].toLowerCase() === "jpeg" ? "jpg" : m[2].toLowerCase();
  const buffer = Buffer.from(m[3], "base64");
  if (buffer.length > 5 * 1024 * 1024) return res.status(413).json({ error: "Image too large (max 5MB)." });

  // Server-generated filename (slug + random) avoids any path-traversal from client input.
  const safe = (slugify(filename || "sample") || "sample").slice(0, 40);
  const name = `${safe}-${crypto.randomBytes(6).toString("hex")}.${ext}`;
  const dir = path.join(UPLOAD_DIR, SUBDIR);

  try {
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(path.join(dir, name), buffer);
    return res.status(200).json({ url: `/uploads/${SUBDIR}/${name}` });
  } catch (err) {
    return res.status(500).json({ error: `Save failed: ${err?.message || err}` });
  }
}
