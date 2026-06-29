import { requireAdmin } from "../lib/auth.js";

// Sample-image upload is deferred on this deployment (no object storage wired).
// The endpoint stays so the route exists; session.uploadEnabled is false, so the
// editor hides the upload field. Add object storage (e.g. Cloudflare R2) later
// to re-enable it.
export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });
  if (!requireAdmin(req, res)) return;
  return res.status(503).json({ error: "Image uploads are not enabled on this deployment yet." });
}
