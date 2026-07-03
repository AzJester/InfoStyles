import { kvAvailable, bumpSkillStat, getSkills, getDeletedSkillIds } from "../lib/store.js";
import { mergeSkills } from "../lib/skill.js";
import { seedSkills } from "../lib/skillSeeds.js";
import { clientKey } from "../lib/ratelimit.js";

// Public, fire-and-forget download counter for skills. Own in-memory rate
// window (the login limiter's 10/15min is too strict for this), and only
// counts ids that exist, so the endpoint can't be used to bloat storage.
const hits = new Map(); // ip -> { count, first }
const WINDOW_MS = 15 * 60 * 1000;
const MAX = 120;
function withinLimit(key) {
  const now = Date.now();
  const rec = hits.get(key);
  if (!rec || now - rec.first > WINDOW_MS) {
    hits.set(key, { count: 1, first: now });
    return true;
  }
  rec.count++;
  return rec.count <= MAX;
}

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });
  if (!kvAvailable()) return res.status(200).json({ ok: false }); // silently a no-op without Redis

  if (!withinLimit(clientKey(req))) return res.status(429).json({ error: "Too many requests." });

  const id = String(req.body?.id || "");
  if (!id) return res.status(400).json({ error: "id is required." });

  try {
    const [saved, deleted] = await Promise.all([getSkills(), getDeletedSkillIds()]);
    const exists = mergeSkills(seedSkills(), saved, deleted).some((s) => s.id === id);
    if (!exists) return res.status(404).json({ error: "Unknown skill." });
    await bumpSkillStat(id);
    return res.status(200).json({ ok: true });
  } catch {
    return res.status(200).json({ ok: false }); // counters are best-effort
  }
}
