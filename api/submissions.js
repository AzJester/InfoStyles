import { requireAdmin } from "../lib/auth.js";
import { kvAvailable, getSubmissions, removeSubmission, savePrompt, saveSkill, saveCustom, pushTrash } from "../lib/store.js";
import { sanitizePrompt, slugify as promptSlug } from "../lib/prompt.js";
import { sanitizeSkill, slugify as skillSlug } from "../lib/skill.js";
import { sanitizeStyle, slugify as styleSlug } from "../lib/style.js";

// Admin review queue for community submissions: Prompt Studio prompts, plus
// visitor-submitted skills and styles (kind on the record; missing = prompt).
// GET lists pending; POST approves (publishes to the matching library) or
// rejects (to the trash).
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

    const { action, id, prompt, skill, style } = req.body || {};
    if (!id) return res.status(400).json({ error: "id is required." });

    if (action === "approve") {
      const sub = (await getSubmissions()).find((s) => s.id === id);
      if (!sub) return res.status(404).json({ error: "That submission no longer exists." });
      // `skill`/`style`/`prompt` (from Edit & approve) override the stored
      // submission fields. Ids are minted exactly like the admin save routes.
      const today = new Date().toISOString().slice(0, 10);

      if (sub.kind === "skill") {
        const clean = sanitizeSkill({ ...(sub.skill || {}), ...(skill || {}) });
        if (!clean.author && sub.credit) clean.author = String(sub.credit).slice(0, 120);
        clean.updated = today;
        const skillId = `skill-${skillSlug(clean.platform, clean.name)}-${Math.abs(hashString(clean.name + clean.platform)).toString(36)}`;
        const saved = await saveSkill({ id: skillId, ...clean });
        await removeSubmission(id);
        return res.status(200).json({ skill: saved });
      }

      if (sub.kind === "style") {
        const clean = sanitizeStyle({ ...(sub.style || {}), ...(style || {}) });
        const styleId = `custom-${styleSlug(clean.category, clean.style)}-${Math.abs(hashString(clean.style + clean.category)).toString(36)}`;
        const saved = await saveCustom({ id: styleId, _custom: true, ...clean });
        await removeSubmission(id);
        return res.status(200).json({ style: saved });
      }

      // Default: a Prompt Studio prompt (older records carry no kind).
      const clean = sanitizePrompt({
        title: sub.title,
        category: sub.category,
        tags: sub.tags,
        body: sub.body,
        credit: sub.credit,
        ...(prompt || {}),
      });
      clean.updated = today;
      const promptId = `prompt-${promptSlug(clean.category, clean.title)}-${Math.abs(hashString(clean.title + clean.category)).toString(36)}`;
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
