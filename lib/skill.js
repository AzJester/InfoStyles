// Normalize an AI-skill-library record. Fields: name, platform, category,
// description, instructions, link, tags[], notes. A "skill" is a reusable
// capability pack: a Claude Skill (SKILL.md), a ChatGPT custom-GPT instruction
// set, a Gemini Gem, or anything similar.
const SLUG_RE = /[^a-z0-9]+/g;

// The platforms the UI offers. Free-text still passes sanitize (capped), so a
// new platform can be introduced without a code change.
export const SKILL_PLATFORMS = ["Claude", "ChatGPT", "Gemini", "Other"];

// Merge the read-only seed skills (public/data/skills.json) with the
// Redis-backed list. Same contract as mergePrompts: a saved skill shadows the
// seed with the same id (admin edits win) and tombstoned ids are dropped
// (admin deletes win), so admin changes survive a seed rebuild. Saved skills
// come first to preserve the "newest first" default order.
export function mergeSkills(seeds = [], saved = [], deletedIds = []) {
  const dead = new Set(deletedIds);
  const savedIds = new Set(saved.map((s) => s.id));
  const seedIds = new Set(seeds.map((s) => s.id));
  return [
    // A saved record that shadows a seed is marked so the UI can offer
    // "Reset to original" (display-only; sanitize strips it on save).
    ...saved.filter((s) => !dead.has(s.id)).map((s) => (seedIds.has(s.id) ? { ...s, _seed: true } : s)),
    ...seeds.filter((s) => !savedIds.has(s.id) && !dead.has(s.id)),
  ];
}

export function slugify(...parts) {
  return parts.filter(Boolean).join("-").toLowerCase().replace(SLUG_RE, "-").replace(/^-+|-+$/g, "");
}

function strArray(v, cap = 16, len = 40) {
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

export function sanitizeSkill(input = {}) {
  const str = (v, n) => String(v ?? "").trim().slice(0, n);
  const platform = str(input.platform, 40) || "Other";
  const out = {
    name: str(input.name, 200) || "Untitled skill",
    platform,
    category: str(input.category, 120) || "General",
    description: str(input.description, 2000),
    instructions: str(input.instructions, 40000),
    link: sanitizeLink(input.link),
    tags: strArray(input.tags),
    notes: str(input.notes, 4000),
    version: str(input.version, 20),
    updated: sanitizeDate(input.updated),
    author: str(input.author, 120),
    files: strArray(input.files, 20, 120),
    resources: sanitizeResources(input.resources),
  };
  // Curator rating, 1-5 stars: the key exists only when rated (see prompt.js).
  const rating = Math.round(Number(input.rating));
  if (rating >= 1 && rating <= 5) out.rating = rating;
  return out;
}

// Files that ship with a skill (references, patterns, scripts…): stored with
// their package-relative paths so downloads can rebuild the full folder.
// Text files store their content directly; binary files (images, fonts) store
// base64 with encoding: "base64" so the zip round-trips them byte-for-byte.
function sanitizeResources(v) {
  const arr = Array.isArray(v) ? v : [];
  const out = [];
  const seen = new Set();
  for (const r of arr) {
    const path = String(r?.path ?? "").trim().replace(/^\/+/, "").slice(0, 200);
    const binary = r?.encoding === "base64";
    const text = String(r?.text ?? "").slice(0, binary ? 400000 : 200000);
    if (!path || !text || seen.has(path.toLowerCase())) continue;
    if (path.includes("..")) continue; // no traversal in stored paths
    if (binary && !/^[A-Za-z0-9+/=\s]+$/.test(text)) continue; // must actually be base64
    seen.add(path.toLowerCase());
    out.push(binary ? { path, text, encoding: "base64" } : { path, text });
    if (out.length >= 20) break;
  }
  return out;
}

// "updated" is an ISO date (YYYY-MM-DD); anything unparseable becomes "".
function sanitizeDate(v) {
  const s = String(v ?? "").trim().slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : "";
}

// The public URL path segment for a skill: its id without the "skill-" prefix
// (e.g. /skills/claude-ai-fingerprint).
export function skillSlug(id) {
  return String(id || "").replace(/^skill-/, "");
}

// Links render as clickable anchors, so only allow http(s) URLs.
function sanitizeLink(v) {
  const s = String(v ?? "").trim().slice(0, 2000);
  if (!s) return "";
  try {
    const u = new URL(s);
    return u.protocol === "http:" || u.protocol === "https:" ? u.href : "";
  } catch {
    return "";
  }
}
