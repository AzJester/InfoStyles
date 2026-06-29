// Tiny in-memory rate limiter (single long-lived server instance on Render).
// Used to throttle admin login attempts per client IP.
const hits = new Map(); // key -> { count, first }
const WINDOW_MS = 15 * 60 * 1000;
const MAX = 10;

export function allowed(key) {
  const now = Date.now();
  const rec = hits.get(key);
  if (rec && now - rec.first > WINDOW_MS) {
    hits.delete(key);
    return true;
  }
  return !rec || rec.count < MAX;
}

export function recordFailure(key) {
  const now = Date.now();
  const rec = hits.get(key);
  if (rec && now - rec.first <= WINDOW_MS) rec.count++;
  else hits.set(key, { count: 1, first: now });
}

export function reset(key) {
  hits.delete(key);
}

export function clientKey(req) {
  const fwd = (req.headers["x-forwarded-for"] || "").split(",")[0].trim();
  return fwd || req.socket?.remoteAddress || "unknown";
}
