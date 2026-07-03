import { requireAdmin } from "../lib/auth.js";
import { kvAvailable, exportAll, restoreAll } from "../lib/store.js";

// Admin backup of everything the app stores in Redis (edits, custom records,
// ratings, tombstones, trash, counters). GET downloads a snapshot; POST
// restores one — a full replace, so the UI confirms before calling.
export default async function handler(req, res) {
  if (!requireAdmin(req, res)) return;
  if (!kvAvailable()) {
    return res.status(503).json({ error: "Persistence not configured. Connect a Render Key Value store and set REDIS_URL." });
  }

  try {
    if (req.method === "GET") {
      const snapshot = await exportAll();
      res.setHeader("Content-Disposition", `attachment; filename="ai-compendium-backup-${snapshot.exportedAt.slice(0, 10)}.json"`);
      return res.status(200).json(snapshot);
    }
    if (req.method === "POST") {
      await restoreAll(req.body);
      return res.status(200).json({ ok: true });
    }
    return res.status(405).json({ error: "Method not allowed" });
  } catch (err) {
    return res.status(500).json({ error: `Backup failed: ${err?.message || err}` });
  }
}
