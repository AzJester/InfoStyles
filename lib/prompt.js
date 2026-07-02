// Normalize an LLM-prompt-library record. Fields: title, category, body,
// models[], tags[], notes.
const SLUG_RE = /[^a-z0-9]+/g;

// Merge the read-only seed prompts (public/data/prompts.json, built from the
// Airtable CSV) with the Redis-backed list. A saved prompt shadows the seed
// with the same id (admin edits win), and tombstoned ids are dropped (admin
// deletes win), so admin changes survive a seed rebuild. Saved prompts come
// first to preserve the "newest first" default order.
export function mergePrompts(seeds = [], saved = [], deletedIds = []) {
  const dead = new Set(deletedIds);
  const savedIds = new Set(saved.map((p) => p.id));
  return [
    ...saved.filter((p) => !dead.has(p.id)),
    ...seeds.filter((p) => !savedIds.has(p.id) && !dead.has(p.id)),
  ];
}

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
  // Saved outputs: what the prompt produced and on which model.
  const results = Array.isArray(input.results) ? input.results : [];
  out.results = results
    .map((r) => ({
      model: str(r?.model, 60),
      output: str(r?.output, 8000),
      at: str(r?.at, 40),
    }))
    .filter((r) => r.output)
    .slice(0, 50);
  return out;
}
