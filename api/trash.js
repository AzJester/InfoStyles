import { requireAdmin } from "../lib/auth.js";
import { kvAvailable, getTrash, removeTrashAt, savePrompt, saveSkill, saveCustom, saveOverride } from "../lib/store.js";

// Recently deleted records (last 50), restorable. GET lists; POST restores by
// index: the record goes back through the normal save path for its kind,
// which also clears any tombstone.
export default async function handler(req, res) {
  if (!requireAdmin(req, res)) return;
  if (!kvAvailable()) {
    return res.status(503).json({ error: "Persistence not configured. Connect a Render Key Value store and set REDIS_URL." });
  }

  try {
    if (req.method === "GET") {
      return res.status(200).json({ trash: await getTrash() });
    }
    if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

    const index = Number(req.body?.index);
    if (!Number.isInteger(index) || index < 0) return res.status(400).json({ error: "A valid index is required." });
    const entry = await removeTrashAt(index);
    if (!entry) return res.status(404).json({ error: "That trash entry no longer exists." });

    const { kind, record } = entry;
    if (kind === "prompt") await savePrompt(record);
    else if (kind === "skill") await saveSkill(record);
    else if (kind === "style-custom") await saveCustom(record);
    else if (kind === "style-override") await saveOverride(record.id, record.fields);
    else return res.status(400).json({ error: `Unknown trash kind "${kind}".` });

    return res.status(200).json({ ok: true, kind });
  } catch (err) {
    return res.status(500).json({ error: `Restore failed: ${err?.message || err}` });
  }
}
