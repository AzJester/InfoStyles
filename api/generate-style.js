import { requireAdmin } from "../lib/auth.js";
import { sanitizeStyle } from "../lib/style.js";

const API_URL = "https://api.anthropic.com/v1/messages";
const API_VERSION = "2023-06-01";
const ALLOWED_MODELS = new Set([
  "claude-sonnet-4-6",
  "claude-opus-4-8",
  "claude-haiku-4-5-20251001",
]);
const DEFAULT_MODEL = "claude-sonnet-4-6";

const STYLE_TOOL = {
  name: "emit_style",
  description: "Return one fully specified infographic/slide style.",
  input_schema: {
    type: "object",
    properties: {
      style: { type: "string", description: "Short, evocative style name." },
      category: { type: "string", description: "A category label for grouping." },
      palette: { type: "array", items: { type: "string" }, description: "3-6 hex colors like #1F2537." },
      type: { type: "string", description: "Typography / visual treatment notes." },
      icons: { type: "string", description: "Icon and motif style." },
      layout: { type: "string", description: "Layout structure of the slide." },
      charts: { type: "string", description: "Data-visualization style." },
      background: { type: "string", description: "Background treatment." },
      avoid: { type: "string", description: "Things to avoid." },
      notebookLMPrompt: { type: "string", description: "Concise one-paragraph pasteable NotebookLM prompt." },
    },
    required: ["style", "category", "palette", "type", "icons", "layout", "charts", "background", "avoid", "notebookLMPrompt"],
  },
};

function buildPrompt({ description, hintCategory, hintPalette, baseStyle }) {
  let p = "";
  if (baseStyle) {
    p += `Start from this existing style and adapt it per the instruction below. Existing style:\n${JSON.stringify(baseStyle, null, 2)}\n\n`;
    p += `Instruction: "${description}"\n\n`;
  } else {
    p += `Create one infographic/slide style from this description:\n\n"${description}"\n\n`;
  }
  if (hintCategory) p += `Preferred category: ${hintCategory}.\n`;
  if (hintPalette) p += `Palette hints: ${hintPalette}.\n`;
  p += "\nReturn concrete, specific values for every field. Palette must be real hex codes. Keep the NotebookLM prompt to one terse paragraph. Use the emit_style tool.";
  return p;
}

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });
  if (!requireAdmin(req, res)) return;

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return res.status(500).json({ error: "ANTHROPIC_API_KEY is not configured on the server." });

  const { description, hintCategory, hintPalette, model, baseStyle } = req.body || {};
  if (!description || !String(description).trim()) {
    return res.status(400).json({ error: "A description is required." });
  }
  const chosenModel = ALLOWED_MODELS.has(model) ? model : DEFAULT_MODEL;

  try {
    const r = await fetch(API_URL, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": API_VERSION,
      },
      body: JSON.stringify({
        model: chosenModel,
        max_tokens: 1536,
        tools: [STYLE_TOOL],
        tool_choice: { type: "tool", name: "emit_style" },
        messages: [{ role: "user", content: buildPrompt({ description, hintCategory, hintPalette, baseStyle }) }],
      }),
    });

    if (!r.ok) {
      let detail = `${r.status} ${r.statusText}`;
      try {
        const body = await r.json();
        if (body?.error?.message) detail = body.error.message;
      } catch {}
      return res.status(502).json({ error: `Anthropic API error: ${detail}` });
    }

    const data = await r.json();
    const toolUse = (data.content || []).find((b) => b.type === "tool_use");
    if (!toolUse) return res.status(502).json({ error: "Model did not return a structured style." });

    return res.status(200).json({ style: sanitizeStyle(toolUse.input) });
  } catch (err) {
    return res.status(502).json({ error: `Request failed: ${err?.message || err}` });
  }
}
