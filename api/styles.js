import { requireAdmin } from "../lib/auth.js";
import { kvAvailable, saveOverride, saveCustom, deleteOverride, deleteCustom } from "../lib/store.js";
import { sanitizeStyle, slugify } from "../lib/style.js";

// Admin-only create / edit / delete of styles, persisted to Vercel KV.
// Body: { action: "save"|"delete", kind: "builtin"|"custom", id?, style? }
//   - kind "builtin": an edit to a CSV-sourced style (stored as an override keyed by id)
//   - kind "custom":  an admin-created style (stored in the custom list)
export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });
  if (!requireAdmin(req, res)) return;
  if (!kvAvailable()) {
    return res.status(503).json({ error: "Persistence not configured. Enable Vercel KV and set its env vars." });
  }

  const { action = "save", kind, id, style } = req.body || {};

  try {
    if (action === "delete") {
      if (!id) return res.status(400).json({ error: "id is required to delete." });
      if (kind === "custom") await deleteCustom(id);
      else await deleteOverride(id);
      return res.status(200).json({ ok: true });
    }

    // save
    const clean = sanitizeStyle(style || {});
    if (kind === "builtin") {
      if (!id) return res.status(400).json({ error: "id is required to edit a built-in style." });
      const saved = await saveOverride(id, clean);
      return res.status(200).json({ style: { id, ...saved }, kind: "builtin" });
    }

    // custom: keep id if editing, else mint one
    const styleId = id || `custom-${slugify(clean.category, clean.style)}-${Math.abs(hashString(clean.style + clean.category)).toString(36)}`;
    const record = { id: styleId, _custom: true, ...clean };
    const saved = await saveCustom(record);
    return res.status(200).json({ style: saved, kind: "custom" });
  } catch (err) {
    return res.status(500).json({ error: `Save failed: ${err?.message || err}` });
  }
}

// Small deterministic hash so ids don't rely on Date.now (stable across retries).
function hashString(s) {
  let h = 0;
  for (let i = 0; i < s.length; i++) {
    h = (Math.imul(31, h) + s.charCodeAt(i)) | 0;
  }
  return h;
}
