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
export function toImagePrompt(style) {
  const name = clean(style.style);
  const parts = [];

  parts.push(
    `A wide 16:9 infographic slide${name ? ` in the style of "${name}"` : ""}.`
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

  const avoid = clause(style.avoid);
  if (avoid) parts.push(`Do NOT include: ${avoid}.`);

  return parts.join(" ");
}
