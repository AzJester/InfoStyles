// Store for admin edits and admin-created styles, backed by Render Key Value
// (Redis). Connection comes from REDIS_URL. Reads are public (so every visitor
// sees edits); writes are admin-gated by the API route.
//
//   styles:overrides  -> { [builtinId]: { ...editedFields, _deleted? } }
//   styles:custom     -> [ styleObject, ... ]
//   categories:custom -> [ "New Category", ... ]
import Redis from "ioredis";

const K_OVERRIDES = "styles:overrides";
const K_CUSTOM = "styles:custom";
const K_CATEGORIES = "categories:custom";

let client;
function redis() {
  if (!client) client = new Redis(process.env.REDIS_URL, { maxRetriesPerRequest: 3 });
  return client;
}

export function kvAvailable() {
  return !!process.env.REDIS_URL;
}

async function getJSON(key) {
  const raw = await redis().get(key);
  return raw ? JSON.parse(raw) : null;
}
async function setJSON(key, value) {
  await redis().set(key, JSON.stringify(value));
}

export async function getCatalog() {
  if (!kvAvailable()) return { overrides: {}, custom: [], categories: [] };
  const [overrides, custom, categories] = await Promise.all([
    getJSON(K_OVERRIDES),
    getJSON(K_CUSTOM),
    getJSON(K_CATEGORIES),
  ]);
  return {
    overrides: overrides || {},
    custom: Array.isArray(custom) ? custom : [],
    categories: Array.isArray(categories) ? categories : [],
  };
}

async function rememberCategory(name) {
  if (!name) return;
  const cats = (await getJSON(K_CATEGORIES)) || [];
  if (!cats.includes(name)) {
    cats.push(name);
    await setJSON(K_CATEGORIES, cats);
  }
}

export async function saveOverride(id, fields) {
  const overrides = (await getJSON(K_OVERRIDES)) || {};
  overrides[id] = { ...fields, _deleted: false };
  await setJSON(K_OVERRIDES, overrides);
  await rememberCategory(fields.category);
  return overrides[id];
}

export async function deleteOverride(id) {
  const overrides = (await getJSON(K_OVERRIDES)) || {};
  overrides[id] = { ...(overrides[id] || {}), _deleted: true };
  await setJSON(K_OVERRIDES, overrides);
}

export async function saveCustom(style) {
  const custom = (await getJSON(K_CUSTOM)) || [];
  const idx = custom.findIndex((s) => s.id === style.id);
  if (idx >= 0) custom[idx] = style;
  else custom.unshift(style);
  await setJSON(K_CUSTOM, custom);
  await rememberCategory(style.category);
  return style;
}

export async function deleteCustom(id) {
  const custom = (await getJSON(K_CUSTOM)) || [];
  await setJSON(K_CUSTOM, custom.filter((s) => s.id !== id));
}
