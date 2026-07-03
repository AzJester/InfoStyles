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
  return [
    ...saved.filter((s) => !dead.has(s.id)),
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
  return {
    name: str(input.name, 200) || "Untitled skill",
    platform,
    category: str(input.category, 120) || "General",
    description: str(input.description, 2000),
    instructions: str(input.instructions, 40000),
    link: sanitizeLink(input.link),
    tags: strArray(input.tags),
    notes: str(input.notes, 4000),
  };
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
