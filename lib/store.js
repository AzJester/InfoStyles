// Vercel KV-backed store for admin edits and admin-created styles.
// - overrides:  { [builtinId]: { ...editedFields, _deleted? } }  edits to CSV styles
// - custom:     [ styleObject, ... ]                              admin-created styles
// - categories: [ "New Category", ... ]                          extra categories
//
// Reads are public (so every visitor sees edits); writes are admin-gated by the API route.
import { kv } from "@vercel/kv";

const K_OVERRIDES = "styles:overrides";
const K_CUSTOM = "styles:custom";
const K_CATEGORIES = "categories:custom";

export function kvAvailable() {
  return !!(process.env.KV_REST_API_URL && process.env.KV_REST_API_TOKEN);
}

export async function getCatalog() {
  if (!kvAvailable()) return { overrides: {}, custom: [], categories: [] };
  const [overrides, custom, categories] = await Promise.all([
    kv.get(K_OVERRIDES),
    kv.get(K_CUSTOM),
    kv.get(K_CATEGORIES),
  ]);
  return {
    overrides: overrides || {},
    custom: Array.isArray(custom) ? custom : [],
    categories: Array.isArray(categories) ? categories : [],
  };
}

async function rememberCategory(name) {
  if (!name) return;
  const cats = (await kv.get(K_CATEGORIES)) || [];
  if (!cats.includes(name)) {
    cats.push(name);
    await kv.set(K_CATEGORIES, cats);
  }
}

// Upsert an edit to a built-in (CSV) style. `fields` are the full edited record.
export async function saveOverride(id, fields) {
  const overrides = (await kv.get(K_OVERRIDES)) || {};
  overrides[id] = { ...fields, _deleted: false };
  await kv.set(K_OVERRIDES, overrides);
  await rememberCategory(fields.category);
  return overrides[id];
}

export async function deleteOverride(id) {
  const overrides = (await kv.get(K_OVERRIDES)) || {};
  overrides[id] = { ...(overrides[id] || {}), _deleted: true };
  await kv.set(K_OVERRIDES, overrides);
}

// Upsert an admin-created style (global, visible to everyone).
export async function saveCustom(style) {
  const custom = (await kv.get(K_CUSTOM)) || [];
  const idx = custom.findIndex((s) => s.id === style.id);
  if (idx >= 0) custom[idx] = style;
  else custom.unshift(style);
  await kv.set(K_CUSTOM, custom);
  await rememberCategory(style.category);
  return style;
}

export async function deleteCustom(id) {
  const custom = (await kv.get(K_CUSTOM)) || [];
  await kv.set(
    K_CUSTOM,
    custom.filter((s) => s.id !== id)
  );
}
