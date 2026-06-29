import { passwordMatches, makeSessionToken, sessionCookie } from "../lib/auth.js";

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const expected = process.env.ADMIN_PASSWORD;
  const secret = process.env.AUTH_SECRET;
  if (!expected || !secret) {
    return res.status(500).json({ error: "Server auth is not configured (ADMIN_PASSWORD / AUTH_SECRET)." });
  }

  const { password } = req.body || {};
  if (!passwordMatches(password, expected)) {
    return res.status(401).json({ error: "Incorrect password." });
  }

  res.setHeader("Set-Cookie", sessionCookie(makeSessionToken()));
  return res.status(200).json({ ok: true });
}
