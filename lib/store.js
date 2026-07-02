// Store for admin edits and admin-created styles, backed by Render Key Value
// (Redis). Connection comes from REDIS_URL. Reads are public (so every visitor
// sees edits); writes are admin-gated by the API route.
//
//   styles:overrides  -> { [builtinId]: { ...editedFields, _deleted? } }
//   styles:custom     -> [ styleObject, ... ]
//   categories:custom -> [ "New Category", ... ]
//   prompts:list      -> [ promptObject, ... ] (admin-created + edited seeds)
//   prompts:deleted   -> SET of ids (tombstones, so deleting a seed prompt sticks)
import Redis from "ioredis";

const K_OVERRIDES = "styles:overrides";
const K_CUSTOM = "styles:custom";
const K_CATEGORIES = "categories:custom";
const K_PROMPTS = "prompts:list";
const K_PROMPT_TOMBSTONES = "prompts:deleted";

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

// --- LLM prompt library ---
export async function getPrompts() {
  if (!kvAvailable()) return [];
  const list = await getJSON(K_PROMPTS);
  return Array.isArray(list) ? list : [];
}

// Ids of deleted prompts, kept as a Redis set so concurrent deletes can't
// lose each other's tombstone. The list above only holds saved records, so
// without tombstones a deleted seed prompt would resurface on the next merge.
export async function getDeletedPromptIds() {
  if (!kvAvailable()) return [];
  return redis().smembers(K_PROMPT_TOMBSTONES);
}

export async function savePrompt(prompt) {
  // Un-tombstone first: if the save then fails the prompt just stays deleted,
  // whereas the reverse order could leave a saved-but-hidden prompt.
  await redis().srem(K_PROMPT_TOMBSTONES, prompt.id);
  const list = (await getJSON(K_PROMPTS)) || [];
  const idx = list.findIndex((p) => p.id === prompt.id);
  if (idx >= 0) list[idx] = prompt;
  else list.unshift(prompt);
  await setJSON(K_PROMPTS, list);
  return prompt;
}

export async function deletePrompt(id) {
  // Tombstone first: a failure after this leaves the prompt hidden (fail-safe)
  // rather than resurrecting the original seed under an edited one.
  await redis().sadd(K_PROMPT_TOMBSTONES, id);
  const list = (await getJSON(K_PROMPTS)) || [];
  await setJSON(K_PROMPTS, list.filter((p) => p.id !== id));
}
