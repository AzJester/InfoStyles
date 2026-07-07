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
  const seedIds = new Set(seeds.map((p) => p.id));
  return [
    // A saved record that shadows a seed is marked so the UI can offer
    // "Reset to original" (display-only; sanitize strips it on save).
    ...saved.filter((p) => !dead.has(p.id)).map((p) => (seedIds.has(p.id) ? { ...p, _seed: true } : p)),
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
  // Curator rating, 1-5 stars. The key exists only when rated, so unrated
  // records (all seeds) round-trip through sanitize unchanged, and clearing
  // a rating removes it.
  const rating = Math.round(Number(input.rating));
  if (rating >= 1 && rating <= 5) out.rating = rating;
  // Community attribution ("Submitted by …") — same conditional-key contract.
  const credit = str(input.credit, 80);
  if (credit) out.credit = credit;
  // Saved outputs: what the prompt produced and on which model. An output may
  // be text (Markdown), uploaded images, attached documents, or any mix.
  // `images`/`files` hold app-served /uploads/ paths (or absolute URLs); each
  // key exists only when non-empty, so text-only records round-trip unchanged.
  const results = Array.isArray(input.results) ? input.results : [];
  out.results = results
    .map((r) => {
      const rec = {
        model: str(r?.model, 60),
        output: str(r?.output, 8000),
        at: str(r?.at, 40),
      };
      const images = resultImages(r?.images);
      if (images.length) rec.images = images;
      const files = resultFiles(r?.files);
      if (files.length) rec.files = files;
      return rec;
    })
    .filter((r) => r.output || r.images || r.files)
    .slice(0, 50);
  return out;
}

// URLs attachable to a saved output: uploaded files served from /uploads, or
// an absolute http(s) URL. Anything else (javascript:, data: blobs that would
// bloat the store, path traversal) is dropped.
const SAFE_URL_RE = /^(\/uploads\/|https?:\/\/)/i;

function resultImages(v) {
  if (!Array.isArray(v)) return [];
  return v
    .map((u) => String(u ?? "").trim().slice(0, 500))
    .filter((u) => SAFE_URL_RE.test(u))
    .slice(0, 8);
}

// Documents attached to a saved output: {url, name} pairs, same URL rules as
// images; `name` is the original filename shown on the download link.
function resultFiles(v) {
  if (!Array.isArray(v)) return [];
  return v
    .map((f) => ({
      url: String(f?.url ?? "").trim().slice(0, 500),
      name: String(f?.name ?? "").trim().slice(0, 120) || "file",
    }))
    .filter((f) => SAFE_URL_RE.test(f.url))
    .slice(0, 8);
}
