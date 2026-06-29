import { getCatalog } from "../lib/store.js";

// Public read: admin edits (overrides), admin-created styles, and extra categories.
// The browser merges these onto the static styles.json so everyone sees edits.
export default async function handler(req, res) {
  try {
    const catalog = await getCatalog();
    res.setHeader("Cache-Control", "no-store");
    return res.status(200).json(catalog);
  } catch (err) {
    // Never break the public gallery if KV is misconfigured.
    return res.status(200).json({ overrides: {}, custom: [], categories: [], error: String(err?.message || err) });
  }
}
