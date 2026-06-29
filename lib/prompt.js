// Normalize an LLM-prompt-library record. Fields: title, category, body,
// models[], tags[], notes.
const SLUG_RE = /[^a-z0-9]+/g;

export function slugify(...parts) {
  return parts.filter(Boolean).join("-").toLowerCase().replace(SLUG_RE, "-").replace(/^-+|-+$/g, "");
}

function strArray(v, cap = 12, len = 40) {
  const arr = Array.isArray(v) ? v : String(v || "").split(",");
  const seen = new Set();
  const out = [];
  for (const item of arr) {
    const s = String(item).trim().slice(0, len);
    if (s && !seen.has(s.toLowerCase())) {
      seen.add(s.toLowerCase());
      out.push(s);
    }
  }
  return out.slice(0, cap);
}

export function sanitizePrompt(input = {}) {
  const str = (v, n) => String(v ?? "").trim().slice(0, n);
  const out = {
    title: str(input.title, 200) || "Untitled prompt",
    category: str(input.category, 120) || "General",
    body: str(input.body, 20000),
    notes: str(input.notes, 4000),
    models: strArray(input.models, 8, 40),
    tags: strArray(input.tags, 16, 40),
  };
  return out;
}
