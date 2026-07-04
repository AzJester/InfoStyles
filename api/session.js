import { isAdmin } from "../lib/auth.js";
import { kvAvailable } from "../lib/store.js";

// Tells the frontend whether to reveal admin UI, whether persistence is wired
// up, and whether the public Prompt Studio (AI improve) is available.
export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  return res.status(200).json({
    admin: isAdmin(req),
    kv: kvAvailable(),
    uploadEnabled: !!process.env.UPLOAD_DIR,
    studio: !!process.env.ANTHROPIC_API_KEY && kvAvailable() && process.env.STUDIO_DISABLED !== "1",
  });
}
