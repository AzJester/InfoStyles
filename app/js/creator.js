// AI style creator: natural-language description -> Claude -> a 10-field style.
// Calls the Anthropic API directly from the browser (bring-your-own key).
import { getApiKey, getModel, saveCustomStyle } from "./storage.js";
import { toImagePrompt } from "./imagePrompt.js";

const API_URL = "https://api.anthropic.com/v1/messages";
const API_VERSION = "2023-06-01";

// Tool schema mirrors the CSV columns so generated styles slot straight into the gallery.
const STYLE_TOOL = {
  name: "emit_style",
  description: "Return one fully specified infographic/slide style.",
  input_schema: {
    type: "object",
    properties: {
      style: { type: "string", description: "Short, evocative style name." },
      category: { type: "string", description: "A category label for grouping." },
      palette: {
        type: "array",
        items: { type: "string", description: "Hex color like #1F2537" },
        description: "3–6 hex colors that define the palette.",
      },
      type: { type: "string", description: "Typography / visual treatment notes." },
      icons: { type: "string", description: "Icon and motif style." },
      layout: { type: "string", description: "Layout structure of the slide." },
      charts: { type: "string", description: "Data-visualization style." },
      background: { type: "string", description: "Background treatment." },
      avoid: { type: "string", description: "Things to avoid (used as negative guidance)." },
      notebookLMPrompt: {
        type: "string",
        description:
          "A concise one-paragraph pasteable prompt for NotebookLM, in the same terse style as existing prompts.",
      },
    },
    required: [
      "style", "category", "palette", "type", "icons",
      "layout", "charts", "background", "avoid", "notebookLMPrompt",
    ],
  },
};

function slugify(...parts) {
  return parts
    .filter(Boolean)
    .join("-")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function buildUserPrompt(description, hintCategory, hintPalette) {
  let p = `Create one infographic/slide style from this description:\n\n"${description}"\n\n`;
  if (hintCategory) p += `Preferred category: ${hintCategory}.\n`;
  if (hintPalette) p += `Palette hints: ${hintPalette}.\n`;
  p +=
    "\nReturn concrete, specific values for every field. Palette must be real hex codes. " +
    "Keep the NotebookLM prompt to one terse paragraph. Use the emit_style tool.";
  return p;
}

async function generateStyle({ description, hintCategory, hintPalette }) {
  const apiKey = getApiKey();
  if (!apiKey) {
    const err = new Error("No API key. Open Settings (⚙) and paste your Anthropic API key.");
    err.code = "NO_KEY";
    throw err;
  }

  const res = await fetch(API_URL, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": API_VERSION,
      "anthropic-dangerous-direct-browser-access": "true",
    },
    body: JSON.stringify({
      model: getModel(),
      max_tokens: 1024,
      tools: [STYLE_TOOL],
      tool_choice: { type: "tool", name: "emit_style" },
      messages: [{ role: "user", content: buildUserPrompt(description, hintCategory, hintPalette) }],
    }),
  });

  if (!res.ok) {
    let detail = `${res.status} ${res.statusText}`;
    try {
      const body = await res.json();
      if (body?.error?.message) detail = body.error.message;
    } catch {
      /* ignore */
    }
    throw new Error(`Anthropic API error: ${detail}`);
  }

  const data = await res.json();
  const toolUse = (data.content || []).find((b) => b.type === "tool_use");
  if (!toolUse) throw new Error("Model did not return a structured style. Try again.");

  const s = toolUse.input;
  const palette = Array.isArray(s.palette)
    ? s.palette.map((h) => String(h).trim().toUpperCase()).filter((h) => /^#([0-9A-F]{3}|[0-9A-F]{6})$/.test(h))
    : [];

  return {
    id: `custom-${slugify(s.category || "custom", s.style || "style")}-${Date.now().toString(36)}`,
    category: (s.category || "Custom").trim(),
    style: (s.style || "Untitled").trim(),
    palette,
    type: (s.type || "").trim(),
    icons: (s.icons || "").trim(),
    layout: (s.layout || "").trim(),
    charts: (s.charts || "").trim(),
    background: (s.background || "").trim(),
    avoid: (s.avoid || "").trim(),
    notebookLMPrompt: (s.notebookLMPrompt || "").trim(),
    _custom: true,
  };
}

function toCsvRow(style) {
  const cell = (v) => {
    const s = String(v == null ? "" : v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [
    style.category, style.style, (style.palette || []).join(" "), style.type,
    style.icons, style.layout, style.charts, style.background, style.avoid,
    style.notebookLMPrompt,
  ]
    .map(cell)
    .join(",");
}

export function initCreator({ toast, copyText, buildCard, onSaved }) {
  const modal = document.getElementById("createModal");
  const openBtn = document.getElementById("newStyleBtn");
  const nlInput = document.getElementById("nlInput");
  const hintCategory = document.getElementById("hintCategory");
  const hintPalette = document.getElementById("hintPalette");
  const generateBtn = document.getElementById("generateBtn");
  const status = document.getElementById("createStatus");
  const result = document.getElementById("createResult");

  function setStatus(msg, isError = false) {
    status.textContent = msg;
    status.classList.toggle("error", isError);
  }

  openBtn.addEventListener("click", () => {
    modal.hidden = false;
    nlInput.focus();
  });
  modal.addEventListener("click", (e) => {
    if (e.target === modal || e.target.hasAttribute("data-close")) modal.hidden = true;
  });

  generateBtn.addEventListener("click", async () => {
    const description = nlInput.value.trim();
    if (!description) {
      setStatus("Describe the style first.", true);
      return;
    }
    generateBtn.disabled = true;
    setStatus("Generating…");
    result.hidden = true;
    result.innerHTML = "";

    try {
      const style = await generateStyle({
        description,
        hintCategory: hintCategory.value.trim(),
        hintPalette: hintPalette.value.trim(),
      });
      setStatus("");
      renderResult(style);
    } catch (err) {
      setStatus(err.message, true);
    } finally {
      generateBtn.disabled = false;
    }
  });

  function renderResult(style) {
    result.hidden = false;
    result.innerHTML = "";

    result.appendChild(buildCard(style));

    const bar = document.createElement("div");
    bar.className = "card-actions";

    const save = document.createElement("button");
    save.className = "btn btn-sm btn-primary";
    save.textContent = "Save to my collection";
    save.addEventListener("click", () => {
      saveCustomStyle(style);
      toast("Saved ✓");
      onSaved();
      modal.hidden = true;
    });

    const csv = document.createElement("button");
    csv.className = "btn btn-sm";
    csv.textContent = "Copy as CSV row";
    csv.addEventListener("click", () => copyText(toCsvRow(style), "CSV row copied"));

    const json = document.createElement("button");
    json.className = "btn btn-sm";
    json.textContent = "Copy JSON";
    json.addEventListener("click", () => copyText(JSON.stringify(style, null, 2), "JSON copied"));

    const img = document.createElement("button");
    img.className = "btn btn-sm";
    img.textContent = "Copy image prompt";
    img.addEventListener("click", () => copyText(toImagePrompt(style), "Image prompt copied"));

    bar.append(save, csv, json, img);
    result.appendChild(bar);
  }
}
