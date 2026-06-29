import { isAdmin } from "../lib/auth.js";
import { kvAvailable } from "../lib/store.js";

// Tells the frontend whether to reveal admin UI, and whether persistence is wired up.
export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  return res.status(200).json({
    admin: isAdmin(req),
    kv: kvAvailable(),
    imageEnabled: !!process.env.OPENAI_API_KEY,
  });
}
