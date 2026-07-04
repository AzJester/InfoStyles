import { requireAdmin } from "../lib/auth.js";
import { kvAvailable, getSubmissions, removeSubmission, savePrompt, pushTrash } from "../lib/store.js";
import { sanitizePrompt, slugify } from "../lib/prompt.js";

// Admin review queue for Prompt Studio submissions. GET lists pending;
// POST approves (publishes to the library) or rejects (to the trash).
export default async function handler(req, res) {
  if (!requireAdmin(req, res)) return;
  if (!kvAvailable()) {
    return res.status(503).json({ error: "Persistence not configured. Connect a Render Key Value store and set REDIS_URL." });
  }

  try {
    if (req.method === "GET") {
      return res.status(200).json({ submissions: await getSubmissions() });
    }
    if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

    const { action, id, prompt } = req.body || {};
    if (!id) return res.status(400).json({ error: "id is required." });

    if (action === "approve") {
      const sub = (await getSubmissions()).find((s) => s.id === id);
      if (!sub) return res.status(404).json({ error: "That submission no longer exists." });
      // `prompt` (from Edit & approve) overrides the stored submission fields.
      const clean = sanitizePrompt({
        title: sub.title,
        category: sub.category,
        tags: sub.tags,
        body: sub.body,
        credit: sub.credit,
        ...(prompt || {}),
      });
      clean.updated = new Date().toISOString().slice(0, 10);
      const promptId = `prompt-${slugify(clean.category, clean.title)}-${Math.abs(hashString(clean.title + clean.category)).toString(36)}`;
      const saved = await savePrompt({ id: promptId, ...clean });
      await removeSubmission(id);
      return res.status(200).json({ prompt: saved });
    }

    if (action === "reject") {
      const record = await removeSubmission(id);
      if (record) await pushTrash("submission", record);
      return res.status(200).json({ ok: true });
    }

    return res.status(400).json({ error: `Unknown action "${action}".` });
  } catch (err) {
    return res.status(500).json({ error: `Request failed: ${err?.message || err}` });
  }
}

function hashString(s) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (Math.imul(31, h) + s.charCodeAt(i)) | 0;
  return h;
}
