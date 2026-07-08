// Normalize and validate public (visitor) submissions of skills and styles
// before they enter the admin review queue. Stricter than the admin
// sanitizers: harder caps, no curator-only fields, and enough substance
// required that the queue can't fill up with empty records.
import { sanitizeSkill } from "./skill.js";
import { sanitizeStyle } from "./style.js";

// One submission may not exceed this serialized size — a big package should
// arrive as a source link, not inline files.
export const MAX_SUBMISSION_CHARS = 200000;

// Public packages keep fewer bundled files than admin uploads (20).
const MAX_PUBLIC_RESOURCES = 8;

export function buildSkillSubmission(input = {}) {
  const skill = sanitizeSkill(input);
  delete skill.rating; // curator-only; never taken from visitors
  skill.updated = ""; // stamped when the admin approves
  skill.resources = (skill.resources || []).slice(0, MAX_PUBLIC_RESOURCES);
  if (!String(input?.name ?? "").trim()) return { error: "Give the skill a name." };
  if (skill.instructions.length < 40 && !skill.link) {
    return { error: "Include the skill's instructions (at least a few sentences), or a source link." };
  }
  return { skill };
}

export function buildStyleSubmission(input = {}) {
  const style = sanitizeStyle(input);
  // Visitors can't upload images, and hotlinked URLs shouldn't reach the
  // library through the queue; the admin can add images after approving.
  style.images = [];
  style.sampleImage = "";
  if (!String(input?.style ?? "").trim()) return { error: "Give the style a name." };
  const detail = [style.type, style.icons, style.layout, style.charts, style.background, style.avoid, style.notebookLMPrompt]
    .join(" ")
    .trim();
  if (style.palette.length < 2 && detail.length < 40) {
    return { error: "Describe the style a bit more — add a palette or fill in a few of the fields." };
  }
  return { style };
}

export function submissionSize(record) {
  try {
    return JSON.stringify(record).length;
  } catch {
    return Infinity;
  }
}

// Case-insensitive name match against the live library, so the queue can flag
// "you already have one of these" for the reviewer.
export function findDuplicateName(name, existingNames = []) {
  const n = String(name || "").trim().toLowerCase();
  if (!n) return null;
  for (const existing of existingNames) {
    if (String(existing || "").trim().toLowerCase() === n) return existing;
  }
  return null;
}
