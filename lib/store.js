// Store for admin edits and admin-created styles, backed by Render Key Value
// (Redis). Connection comes from REDIS_URL. Reads are public (so every visitor
// sees edits); writes are admin-gated by the API route.
//
//   styles:overrides  -> { [builtinId]: { ...editedFields, _deleted? } }
//   styles:custom     -> [ styleObject, ... ]
//   categories:custom -> [ "New Category", ... ]
//   prompts:list      -> [ promptObject, ... ] (admin-created + edited seeds)
//   prompts:deleted   -> SET of ids (tombstones, so deleting a seed prompt sticks)
//   skills:list       -> [ skillObject, ... ] (admin-created + edited seeds)
//   skills:deleted    -> SET of ids (tombstones for seed skills)
//   trash:list        -> [ {kind, at, record}, ... ] (last 50 deletions, restorable)
//   stats:skills      -> HASH skillId -> download count (public counters)
import Redis from "ioredis";

const K_OVERRIDES = "styles:overrides";
const K_CUSTOM = "styles:custom";
const K_CATEGORIES = "categories:custom";
const K_PROMPTS = "prompts:list";
const K_PROMPT_TOMBSTONES = "prompts:deleted";
const K_SKILLS = "skills:list";
const K_SKILL_TOMBSTONES = "skills:deleted";
const K_TRASH = "trash:list";
const K_SKILL_STATS = "stats:skills";
const K_SUBMISSIONS = "submissions:list";
const TRASH_CAP = 50;
const SUBMISSIONS_CAP = 200;

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

// --- AI skill library (same persistence contract as prompts) ---
export async function getSkills() {
  if (!kvAvailable()) return [];
  const list = await getJSON(K_SKILLS);
  return Array.isArray(list) ? list : [];
}

export async function getDeletedSkillIds() {
  if (!kvAvailable()) return [];
  return redis().smembers(K_SKILL_TOMBSTONES);
}

export async function saveSkill(skill) {
  // Un-tombstone first (see savePrompt for the failure-ordering rationale).
  await redis().srem(K_SKILL_TOMBSTONES, skill.id);
  const list = (await getJSON(K_SKILLS)) || [];
  const idx = list.findIndex((s) => s.id === skill.id);
  if (idx >= 0) list[idx] = skill;
  else list.unshift(skill);
  await setJSON(K_SKILLS, list);
  return skill;
}

export async function deleteSkill(id) {
  // Tombstone first (see deletePrompt for the failure-ordering rationale).
  await redis().sadd(K_SKILL_TOMBSTONES, id);
  const list = (await getJSON(K_SKILLS)) || [];
  await setJSON(K_SKILLS, list.filter((s) => s.id !== id));
}

// --- revert an edited seed: remove the shadowing record WITHOUT tombstoning,
// so the original seed reappears on the next merge. ---
export async function revertPrompt(id) {
  await redis().srem(K_PROMPT_TOMBSTONES, id);
  const list = (await getJSON(K_PROMPTS)) || [];
  await setJSON(K_PROMPTS, list.filter((p) => p.id !== id));
}

export async function revertSkill(id) {
  await redis().srem(K_SKILL_TOMBSTONES, id);
  const list = (await getJSON(K_SKILLS)) || [];
  await setJSON(K_SKILLS, list.filter((s) => s.id !== id));
}

export async function revertOverride(id) {
  const overrides = (await getJSON(K_OVERRIDES)) || {};
  delete overrides[id];
  await setJSON(K_OVERRIDES, overrides);
}

// --- trash: every delete keeps the full record (last 50) so it can be
// restored even when it was admin-created and exists nowhere else. ---
export async function pushTrash(kind, record) {
  if (!record) return;
  const list = (await getJSON(K_TRASH)) || [];
  list.unshift({ kind, at: new Date().toISOString(), record });
  await setJSON(K_TRASH, list.slice(0, TRASH_CAP));
}

export async function getTrash() {
  if (!kvAvailable()) return [];
  const list = await getJSON(K_TRASH);
  return Array.isArray(list) ? list : [];
}

export async function removeTrashAt(index) {
  const list = (await getJSON(K_TRASH)) || [];
  const [entry] = list.splice(index, 1);
  await setJSON(K_TRASH, list);
  return entry || null;
}

// --- public download counters (skills) ---
export async function bumpSkillStat(id) {
  if (!kvAvailable()) return;
  await redis().hincrby(K_SKILL_STATS, id, 1);
}

export async function getSkillStats() {
  if (!kvAvailable()) return {};
  const raw = await redis().hgetall(K_SKILL_STATS);
  const out = {};
  for (const [k, v] of Object.entries(raw || {})) out[k] = Number(v) || 0;
  return out;
}

// --- Prompt Studio submissions: visitor-created prompts, private to the
// admin until approved. Upserts by id so a second "improve" updates the
// same record rather than duplicating it. ---
export async function getSubmissions() {
  if (!kvAvailable()) return [];
  const list = await getJSON(K_SUBMISSIONS);
  return Array.isArray(list) ? list : [];
}

export async function upsertSubmission(sub) {
  const list = (await getJSON(K_SUBMISSIONS)) || [];
  const idx = list.findIndex((s) => s.id === sub.id);
  if (idx >= 0) list[idx] = { ...list[idx], ...sub };
  else {
    if (list.length >= SUBMISSIONS_CAP) throw new Error("The review queue is full.");
    list.unshift(sub);
  }
  await setJSON(K_SUBMISSIONS, list);
  return sub;
}

export async function removeSubmission(id) {
  const list = (await getJSON(K_SUBMISSIONS)) || [];
  const record = list.find((s) => s.id === id) || null;
  await setJSON(K_SUBMISSIONS, list.filter((s) => s.id !== id));
  return record;
}

// Global daily counter for public AI improvements (spend ceiling). The key
// carries its own date, so yesterday's count never leaks into today.
export async function bumpStudioDaily() {
  const key = `studio:daily:${new Date().toISOString().slice(0, 10)}`;
  const r = redis();
  const n = await r.incr(key);
  if (n === 1) await r.expire(key, 60 * 60 * 48);
  return n;
}

// --- backup: one snapshot of every admin-owned key, and its inverse. ---
export async function exportAll() {
  const [overrides, custom, categories, prompts, promptTombstones, skills, skillTombstones, trash, statsRaw, submissions] =
    await Promise.all([
      getJSON(K_OVERRIDES),
      getJSON(K_CUSTOM),
      getJSON(K_CATEGORIES),
      getJSON(K_PROMPTS),
      redis().smembers(K_PROMPT_TOMBSTONES),
      getJSON(K_SKILLS),
      redis().smembers(K_SKILL_TOMBSTONES),
      getJSON(K_TRASH),
      redis().hgetall(K_SKILL_STATS),
      getJSON(K_SUBMISSIONS),
    ]);
  return {
    format: "ai-compendium-backup",
    version: 1,
    exportedAt: new Date().toISOString(),
    data: {
      stylesOverrides: overrides || {},
      stylesCustom: custom || [],
      categoriesCustom: categories || [],
      promptsList: prompts || [],
      promptsDeleted: promptTombstones || [],
      skillsList: skills || [],
      skillsDeleted: skillTombstones || [],
      trash: trash || [],
      skillStats: statsRaw || {},
      submissions: submissions || [],
    },
  };
}

export async function restoreAll(snapshot) {
  const d = snapshot?.data;
  if (snapshot?.format !== "ai-compendium-backup" || !d) {
    throw new Error("Not a valid backup file (expected format ai-compendium-backup).");
  }
  const r = redis();
  await setJSON(K_OVERRIDES, d.stylesOverrides || {});
  await setJSON(K_CUSTOM, Array.isArray(d.stylesCustom) ? d.stylesCustom : []);
  await setJSON(K_CATEGORIES, Array.isArray(d.categoriesCustom) ? d.categoriesCustom : []);
  await setJSON(K_PROMPTS, Array.isArray(d.promptsList) ? d.promptsList : []);
  await setJSON(K_SKILLS, Array.isArray(d.skillsList) ? d.skillsList : []);
  await setJSON(K_TRASH, Array.isArray(d.trash) ? d.trash : []);
  await setJSON(K_SUBMISSIONS, Array.isArray(d.submissions) ? d.submissions : []);
  await r.del(K_PROMPT_TOMBSTONES);
  if ((d.promptsDeleted || []).length) await r.sadd(K_PROMPT_TOMBSTONES, ...d.promptsDeleted);
  await r.del(K_SKILL_TOMBSTONES);
  if ((d.skillsDeleted || []).length) await r.sadd(K_SKILL_TOMBSTONES, ...d.skillsDeleted);
  await r.del(K_SKILL_STATS);
  const stats = Object.entries(d.skillStats || {});
  if (stats.length) await r.hset(K_SKILL_STATS, Object.fromEntries(stats));
}
