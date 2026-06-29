// Shared helpers for normalizing style records on the server.

const FIELDS = [
  "category", "style", "type", "icons", "layout", "charts", "background", "avoid", "notebookLMPrompt",
];

export function slugify(...parts) {
  return parts
    .filter(Boolean)
    .join("-")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function normalizePalette(palette) {
  const arr = Array.isArray(palette) ? palette : String(palette || "").split(/\s+/);
  const seen = new Set();
  const out = [];
  for (const raw of arr) {
    const hex = String(raw).trim().toUpperCase();
    if (/^#([0-9A-F]{3}|[0-9A-F]{6})$/.test(hex) && !seen.has(hex)) {
      seen.add(hex);
      out.push(hex);
    }
  }
  return out;
}

// Coerce arbitrary input into a clean style record. Caps string lengths defensively.
export function sanitizeStyle(input = {}) {
  const out = {};
  for (const f of FIELDS) out[f] = String(input[f] ?? "").trim().slice(0, 4000);
  out.palette = normalizePalette(input.palette).slice(0, 12);
  out.style = out.style || "Untitled";
  out.category = out.category || "Custom";
  // Example images: each must be an https URL or a relative /uploads/<path>.<ext>
  // served from our disk. The strict /uploads pattern (no "..", known extensions)
  // blocks path traversal and javascript:/data: URIs.
  const okImg = (v) => {
    const s = String(v ?? "").trim();
    if (/^https:\/\/\S+$/i.test(s)) return s.slice(0, 1000);
    if (/^\/uploads\/[\w/-]+\.(png|jpg|jpeg|webp|gif)$/i.test(s)) return s.slice(0, 1000);
    return null;
  };
  const raw = Array.isArray(input.images) ? input.images : input.sampleImage ? [input.sampleImage] : [];
  out.images = raw.map(okImg).filter(Boolean).slice(0, 12);
  // Keep sampleImage as the primary (first) image for back-compat with older records.
  out.sampleImage = out.images[0] || "";
  return out;
}
