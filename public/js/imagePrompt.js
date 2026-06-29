// Shared transform: a structured style record -> an OpenAI image-generation prompt.
// Used by both the gallery (for all CSV styles) and the AI creator (for new styles),
// so generated styles produce image prompts exactly the same way.

function clean(value) {
  return (value || "").trim().replace(/\s+/g, " ");
}

// Strip a trailing period so we can join clauses with our own punctuation.
function clause(value) {
  return clean(value).replace(/[.;]+$/, "");
}

/**
 * Build an image-generation prompt from a style's fields.
 * @param {object} style - { style, type, palette[], layout, icons, charts, background, avoid }
 * @returns {string}
 */
const ASPECT_WORD = {
  "16:9": "wide 16:9",
  "1:1": "square",
  "4:5": "portrait 4:5",
  "9:16": "tall 9:16",
};

/**
 * Build an image-generation prompt.
 * @param {object} style
 * @param {object} [opts] - { aspect: "16:9"|"1:1"|"4:5"|"9:16", model: "openai"|"midjourney"|"dalle"|"generic" }
 */
export function toImagePrompt(style, opts = {}) {
  const aspect = ASPECT_WORD[opts.aspect] ? opts.aspect : "16:9";
  const model = opts.model || "openai";
  const name = clean(style.style);
  const parts = [];

  parts.push(
    `A ${ASPECT_WORD[aspect]} infographic slide${name ? ` in the style of "${name}"` : ""}.`
  );

  const visual = clause(style.type);
  if (visual) parts.push(`Visual / typographic style: ${visual}.`);

  const palette = Array.isArray(style.palette) ? style.palette.filter(Boolean) : [];
  if (palette.length) {
    parts.push(`Use ONLY this exact color palette: ${palette.join(", ")}.`);
  }

  const layout = clause(style.layout);
  if (layout) parts.push(`Layout: ${layout}.`);

  const icons = clause(style.icons);
  if (icons) parts.push(`Icons / motifs: ${icons}.`);

  const charts = clause(style.charts);
  if (charts) parts.push(`Data visualization: ${charts}.`);

  const background = clause(style.background);
  if (background) parts.push(`Background: ${background}.`);

  parts.push(
    "Clean vector look, crisp typography, high readability, balanced whitespace, professional infographic composition."
  );

  // Phrased as a positive constraint: image models tend to add things named in a
  // bare "do not include X", so frame avoidance as something to keep the design free of.
  const avoid = clause(style.avoid);
  if (avoid) parts.push(`Style constraints to respect: keep the design free of ${avoid}.`);

  let out = parts.join(" ");
  // Model-specific tail: Midjourney uses --ar flags; others get a plain clause.
  if (model === "midjourney") out += ` --ar ${aspect} --v 6`;
  else out += ` Aspect ratio: ${aspect}.`;
  return out;
}

// --- {{variable}} templating in prompts ---
const VAR_RE = /\{\{\s*([\w-]+)\s*\}\}/g;

export function extractVariables(text) {
  const seen = new Set();
  let m;
  VAR_RE.lastIndex = 0;
  while ((m = VAR_RE.exec(String(text || "")))) seen.add(m[1]);
  return [...seen];
}

export function applyVariables(text, values) {
  return String(text || "").replace(VAR_RE, (whole, name) =>
    values[name] != null && values[name] !== "" ? values[name] : whole
  );
}

/**
 * Build a terse, one-paragraph NotebookLM prompt from a style's fields.
 * Used as a fallback when a style has no hand-written / AI-written prompt, so
 * every style always has a pasteable NotebookLM prompt. Mirrors the terse,
 * comma-joined phrasing of the original dataset.
 * @param {object} style
 * @returns {string}
 */
export function toNotebookLMPrompt(style) {
  const name = clean(style.style);
  const parts = [name ? `${name} infographic slide` : "Infographic slide"];

  const add = (value) => {
    const c = clause(value);
    if (c) parts.push(c.toLowerCase());
  };
  add(style.type);
  add(style.layout);
  add(style.charts);
  add(style.icons);
  add(style.background);

  const palette = Array.isArray(style.palette) ? style.palette.filter(Boolean) : [];
  if (palette.length) parts.push("use only the given palette");

  let out = parts.join(", ") + ".";
  const avoid = clause(style.avoid);
  if (avoid) out += ` Avoid ${avoid.toLowerCase()}.`;
  return out;
}
