import { requireAdmin } from "../lib/auth.js";
import { SKILL_PLATFORMS } from "../lib/skill.js";

// Given an uploaded skill's instructions, infer the metadata the file didn't
// declare (platform, category, description, tags, a cleaner name). The client
// only applies fields the admin hasn't already filled in.
const API_URL = "https://api.anthropic.com/v1/messages";
const API_VERSION = "2023-06-01";
const MODEL = "claude-sonnet-4-6"; // metadata extraction: fast model is plenty
const MAX_INSTRUCTIONS = 16000;

const TOOL = {
  name: "emit_skill_meta",
  description: "Return metadata describing an existing AI skill.",
  input_schema: {
    type: "object",
    properties: {
      name: { type: "string", description: "A clean, human-readable skill name (title case, no file extensions)." },
      platform: {
        type: "string",
        enum: SKILL_PLATFORMS,
        description:
          "The platform the instructions were written for. SKILL.md frontmatter/reference-file conventions mean Claude; " +
          "custom-GPT/knowledge-file language means ChatGPT; Gem language means Gemini; otherwise Other.",
      },
      category: { type: "string", description: "One short grouping, e.g. Writing, Sales, Productivity, Finance, Design, Content, Development." },
      description: { type: "string", description: "One or two sentences: what the skill does and when it triggers." },
      tags: { type: "array", items: { type: "string" }, description: "Three to five short lowercase tags." },
      notes: { type: "string", description: "Optional setup notes implied by the instructions (files to attach, where to install). Empty string if none." },
    },
    required: ["name", "platform", "category", "description", "tags", "notes"],
  },
};

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });
  if (!requireAdmin(req, res)) return;

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return res.status(500).json({ error: "ANTHROPIC_API_KEY is not configured on the server." });

  const { instructions, name, filename } = req.body || {};
  const text = String(instructions || "").trim();
  if (!text) return res.status(400).json({ error: "Instructions are required." });

  try {
    const r = await fetch(API_URL, {
      method: "POST",
      headers: { "content-type": "application/json", "x-api-key": apiKey, "anthropic-version": API_VERSION },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 1024,
        tools: [TOOL],
        tool_choice: { type: "tool", name: "emit_skill_meta" },
        messages: [
          {
            role: "user",
            content:
              "An existing AI skill was just uploaded. Infer its metadata from the instructions below. " +
              "Describe what is actually there; do not invent capabilities.\n\n" +
              (name ? `Known name: ${String(name).slice(0, 200)}\n` : "") +
              (filename ? `Uploaded filename: ${String(filename).slice(0, 200)}\n` : "") +
              `\nInstructions:\n"""\n${text.slice(0, MAX_INSTRUCTIONS)}\n"""\n\nUse the emit_skill_meta tool.`,
          },
        ],
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
    if (!toolUse) return res.status(502).json({ error: "Model did not return skill metadata." });
    const meta = toolUse.input || {};
    return res.status(200).json({
      meta: {
        name: String(meta.name || "").slice(0, 200),
        platform: SKILL_PLATFORMS.includes(meta.platform) ? meta.platform : "Other",
        category: String(meta.category || "").slice(0, 120),
        description: String(meta.description || "").slice(0, 2000),
        tags: (Array.isArray(meta.tags) ? meta.tags : []).map((t) => String(t).slice(0, 40)).slice(0, 8),
        notes: String(meta.notes || "").slice(0, 4000),
      },
    });
  } catch (err) {
    return res.status(502).json({ error: `Request failed: ${err?.message || err}` });
  }
}
