import { requireAdmin } from "../lib/auth.js";
import { slugify } from "../lib/style.js";
import { put } from "@vercel/blob";

// Admin-only: store a sample image in Vercel Blob and return its public URL.
// The browser downscales and sends a base64 data URL (JSON) to stay under the
// serverless body limit; we decode and upload the bytes.
export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });
  if (!requireAdmin(req, res)) return;
  if (!process.env.BLOB_READ_WRITE_TOKEN) {
    return res.status(503).json({ error: "Image storage not configured. Enable Vercel Blob and set BLOB_READ_WRITE_TOKEN." });
  }

  const { dataUrl, filename } = req.body || {};
  const m = /^data:(image\/(png|jpeg|jpg|webp|gif));base64,(.+)$/i.exec(String(dataUrl || ""));
  if (!m) return res.status(400).json({ error: "Expected a base64 image data URL." });

  const contentType = m[1].toLowerCase();
  const ext = m[2].toLowerCase() === "jpeg" ? "jpg" : m[2].toLowerCase();
  const buffer = Buffer.from(m[3], "base64");
  if (buffer.length > 5 * 1024 * 1024) return res.status(413).json({ error: "Image too large (max 5MB)." });

  const safe = slugify(filename || "sample") || "sample";
  try {
    const { url } = await put(`samples/${safe}.${ext}`, buffer, {
      access: "public",
      contentType,
      addRandomSuffix: true,
    });
    return res.status(200).json({ url });
  } catch (err) {
    return res.status(502).json({ error: `Upload failed: ${err?.message || err}` });
  }
}
