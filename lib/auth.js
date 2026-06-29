// Admin session auth: a signed, expiring token kept in an httpOnly cookie.
// The Anthropic / OpenAI keys never leave the server; this gates who may use them.
import crypto from "node:crypto";

const COOKIE = "sid";
const MAX_AGE_SEC = 7 * 24 * 60 * 60; // 7 days

function b64url(buf) {
  return Buffer.from(buf).toString("base64url");
}

export function sign(payload, secret) {
  const body = b64url(JSON.stringify(payload));
  const sig = b64url(crypto.createHmac("sha256", secret).update(body).digest());
  return `${body}.${sig}`;
}

export function verify(token, secret) {
  if (!token || !secret || !token.includes(".")) return null;
  const [body, sig] = token.split(".");
  const expected = b64url(crypto.createHmac("sha256", secret).update(body).digest());
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  let payload;
  try {
    payload = JSON.parse(Buffer.from(body, "base64url").toString());
  } catch {
    return null;
  }
  if (!payload.exp || Date.now() > payload.exp) return null;
  return payload;
}

// Constant-time password comparison that doesn't leak length.
export function passwordMatches(input, expected) {
  if (!expected) return false;
  const a = crypto.createHash("sha256").update(String(input ?? "")).digest();
  const b = crypto.createHash("sha256").update(String(expected)).digest();
  return crypto.timingSafeEqual(a, b);
}

export function parseCookies(req) {
  const header = req.headers?.cookie || "";
  const out = {};
  for (const part of header.split(";")) {
    const idx = part.indexOf("=");
    if (idx === -1) continue;
    const k = part.slice(0, idx).trim();
    const v = part.slice(idx + 1).trim();
    if (k) out[k] = decodeURIComponent(v);
  }
  return out;
}

export function isAdmin(req) {
  const secret = process.env.AUTH_SECRET;
  if (!secret) return false;
  return !!verify(parseCookies(req)[COOKIE], secret);
}

export function makeSessionToken() {
  const secret = process.env.AUTH_SECRET;
  return sign({ exp: Date.now() + MAX_AGE_SEC * 1000, role: "admin" }, secret);
}

export function sessionCookie(token) {
  return `${COOKIE}=${token}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=${MAX_AGE_SEC}`;
}

export function clearCookie() {
  return `${COOKIE}=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0`;
}

export function requireAdmin(req, res) {
  if (isAdmin(req)) return true;
  res.status(401).json({ error: "Not authorized. Log in as admin." });
  return false;
}
