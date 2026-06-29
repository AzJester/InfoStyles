// Loads the catalog: static CSV styles (styles.json) merged with admin edits and
// admin-created styles from the server (Vercel KV via /api/catalog). The merged
// result is what every visitor sees.
import { getCatalog } from "./api.js";

const BUILTIN_FIELDS = [
  "category", "style", "type", "icons", "layout", "charts", "background", "avoid", "notebookLMPrompt", "sampleImage", "images",
];

let builtin = [];
let merged = [];

async function loadBuiltin() {
  const [styles] = await Promise.all([fetch("data/styles.json").then((r) => r.json())]);
  return styles;
}

function applyCatalog(base, { overrides, custom }) {
  const out = [];
  for (const s of base) {
    const ov = overrides[s.id];
    if (ov && ov._deleted) continue; // admin removed this built-in
    if (ov) {
      // override carries edited fields + palette; keep id, mark edited
      out.push({ ...s, ...pick(ov, BUILTIN_FIELDS), palette: ov.palette || s.palette, _edited: true });
    } else {
      out.push(s);
    }
  }
  for (const c of custom) out.push({ ...c, _custom: true });
  return out;
}

function pick(obj, keys) {
  const o = {};
  for (const k of keys) if (obj[k] !== undefined) o[k] = obj[k];
  return o;
}

export async function loadCatalog() {
  const [base, cat] = await Promise.all([loadBuiltin(), getCatalog()]);
  builtin = base;
  merged = applyCatalog(base, {
    overrides: cat.overrides || {},
    custom: cat.custom || [],
  });
  return merged;
}

export function getStyles() {
  return merged;
}

// Whether an id refers to a CSV-sourced style (edit -> "builtin") or an admin one.
export function kindOf(id) {
  return builtin.some((s) => s.id === id) ? "builtin" : "custom";
}

// Categories with counts, derived from the merged set so edits/new styles are reflected.
export function getCategories(extraCategories = []) {
  const counts = new Map();
  for (const s of merged) {
    if (!s.category) continue;
    counts.set(s.category, (counts.get(s.category) || 0) + 1);
  }
  for (const name of extraCategories) if (!counts.has(name)) counts.set(name, 0);
  return [...counts.entries()]
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count || a.name.toLowerCase().localeCompare(b.name.toLowerCase()));
}

// Replace a single style in the merged list in place (after an edit/create), returning it.
export function upsertLocal(style) {
  const idx = merged.findIndex((s) => s.id === style.id);
  if (idx >= 0) merged[idx] = style;
  else merged.unshift(style);
  return style;
}

export function removeLocal(id) {
  merged = merged.filter((s) => s.id !== id);
}
