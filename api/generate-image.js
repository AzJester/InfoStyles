import { requireAdmin } from "../lib/auth.js";

const API_URL = "https://api.openai.com/v1/images/generations";
const ALLOWED_SIZES = new Set(["1024x1024", "1536x1024", "1024x1536", "auto"]);

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });
  if (!requireAdmin(req, res)) return;

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return res.status(500).json({ error: "OPENAI_API_KEY is not configured on the server." });

  const { prompt, size } = req.body || {};
  if (!prompt || !String(prompt).trim()) return res.status(400).json({ error: "A prompt is required." });
  const chosenSize = ALLOWED_SIZES.has(size) ? size : "1536x1024";

  try {
    const r = await fetch(API_URL, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model: "gpt-image-1",
        prompt: String(prompt).slice(0, 32000),
        size: chosenSize,
        n: 1,
      }),
    });

    if (!r.ok) {
      let detail = `${r.status} ${r.statusText}`;
      try {
        const body = await r.json();
        if (body?.error?.message) detail = body.error.message;
      } catch {}
      return res.status(502).json({ error: `OpenAI image error: ${detail}` });
    }

    const data = await r.json();
    const b64 = data?.data?.[0]?.b64_json;
    if (!b64) return res.status(502).json({ error: "No image returned." });
    return res.status(200).json({ b64 });
  } catch (err) {
    return res.status(502).json({ error: `Request failed: ${err?.message || err}` });
  }
}
