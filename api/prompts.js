import { requireAdmin } from "../lib/auth.js";
import { kvAvailable, getPrompts, savePrompt, deletePrompt } from "../lib/store.js";
import { sanitizePrompt, slugify } from "../lib/prompt.js";

// GET: public list of prompts. POST (admin): save / delete.
export default async function handler(req, res) {
  if (req.method === "GET") {
    res.setHeader("Cache-Control", "no-store");
    try {
      return res.status(200).json({ prompts: await getPrompts() });
    } catch (err) {
      return res.status(200).json({ prompts: [], error: String(err?.message || err) });
    }
  }

  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });
  if (!requireAdmin(req, res)) return;
  if (!kvAvailable()) {
    return res.status(503).json({ error: "Persistence not configured. Connect a Render Key Value store and set REDIS_URL." });
  }

  const { action = "save", id, prompt } = req.body || {};
  try {
    if (action === "delete") {
      if (!id) return res.status(400).json({ error: "id is required to delete." });
      await deletePrompt(id);
      return res.status(200).json({ ok: true });
    }
    const clean = sanitizePrompt(prompt || {});
    const promptId =
      id || `prompt-${slugify(clean.category, clean.title)}-${Math.abs(hashString(clean.title + clean.category)).toString(36)}`;
    const saved = await savePrompt({ id: promptId, ...clean });
    return res.status(200).json({ prompt: saved });
  } catch (err) {
    return res.status(500).json({ error: `Save failed: ${err?.message || err}` });
  }
}

function hashString(s) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (Math.imul(31, h) + s.charCodeAt(i)) | 0;
  return h;
}
