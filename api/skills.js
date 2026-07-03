import { requireAdmin } from "../lib/auth.js";
import { kvAvailable, getSkills, saveSkill, deleteSkill, getDeletedSkillIds } from "../lib/store.js";
import { sanitizeSkill, slugify, mergeSkills } from "../lib/skill.js";
import { seedSkills } from "../lib/skillSeeds.js";

// GET: public list of AI skills — the committed seeds merged with admin
// edits/creations from Redis. POST (admin): save / delete.
export default async function handler(req, res) {
  if (req.method === "GET") {
    res.setHeader("Cache-Control", "no-store");
    try {
      const [saved, deleted] = await Promise.all([getSkills(), getDeletedSkillIds()]);
      return res.status(200).json({ skills: mergeSkills(seedSkills(), saved, deleted) });
    } catch (err) {
      // Seeds still work when Redis is down; only admin edits go missing.
      // Don't echo backend errors (host/auth details) to public visitors.
      console.error("skills store read failed:", err);
      return res.status(200).json({ skills: seedSkills(), error: "Saved skills are temporarily unavailable." });
    }
  }

  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });
  if (!requireAdmin(req, res)) return;
  if (!kvAvailable()) {
    return res.status(503).json({ error: "Persistence not configured. Connect a Render Key Value store and set REDIS_URL." });
  }

  const { action = "save", id, skill } = req.body || {};
  try {
    if (action === "delete") {
      if (!id) return res.status(400).json({ error: "id is required to delete." });
      await deleteSkill(id);
      return res.status(200).json({ ok: true });
    }
    const clean = sanitizeSkill(skill || {});
    // Every save stamps the freshness date shown on cards and detail pages.
    clean.updated = new Date().toISOString().slice(0, 10);
    const skillId =
      id || `skill-${slugify(clean.platform, clean.name)}-${Math.abs(hashString(clean.name + clean.platform)).toString(36)}`;
    const saved = await saveSkill({ id: skillId, ...clean });
    return res.status(200).json({ skill: saved });
  } catch (err) {
    return res.status(500).json({ error: `Save failed: ${err?.message || err}` });
  }
}

function hashString(s) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (Math.imul(31, h) + s.charCodeAt(i)) | 0;
  return h;
}
