import { passwordMatches, makeSessionToken, sessionCookie } from "../lib/auth.js";
import { allowed, recordFailure, reset, clientKey } from "../lib/ratelimit.js";

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const expected = process.env.ADMIN_PASSWORD;
  const secret = process.env.AUTH_SECRET;
  if (!expected || !secret) {
    return res.status(500).json({ error: "Server auth is not configured (ADMIN_PASSWORD / AUTH_SECRET)." });
  }

  const key = clientKey(req);
  if (!allowed(key)) {
    return res.status(429).json({ error: "Too many attempts. Wait a few minutes and try again." });
  }

  const { password } = req.body || {};
  if (!passwordMatches(password, expected)) {
    recordFailure(key);
    return res.status(401).json({ error: "Incorrect password." });
  }

  reset(key);
  res.setHeader("Set-Cookie", sessionCookie(makeSessionToken()));
  return res.status(200).json({ ok: true });
}
