import { requireAdmin } from "../lib/auth.js";
import { sanitizeSkill, SKILL_PLATFORMS } from "../lib/skill.js";

const API_URL = "https://api.anthropic.com/v1/messages";
const API_VERSION = "2023-06-01";
const ALLOWED_MODELS = new Set(["claude-sonnet-4-6", "claude-opus-4-8", "claude-haiku-4-5-20251001"]);
const DEFAULT_MODEL = "claude-sonnet-4-6";

const TOOL = {
  name: "emit_skill",
  description: "Return one reusable AI skill (a Claude Skill, ChatGPT custom-GPT instruction set, or Gemini Gem).",
  input_schema: {
    type: "object",
    properties: {
      name: { type: "string", description: "Short, descriptive skill name." },
      platform: { type: "string", enum: SKILL_PLATFORMS, description: "Primary platform this skill targets." },
      category: { type: "string", description: "Grouping, e.g. Writing, Sales, Productivity, Design, Development." },
      description: { type: "string", description: "One or two sentences: what the skill does and when it triggers." },
      instructions: {
        type: "string",
        description:
          "The full skill body. For Claude: SKILL.md-style markdown instructions (when to trigger, rules, workflow). " +
          "For ChatGPT: the custom-GPT system instructions. For Gemini: the Gem instructions.",
      },
      tags: { type: "array", items: { type: "string" }, description: "A few short tags." },
      notes: { type: "string", description: "Optional setup notes (files to attach, where to install it)." },
    },
    required: ["name", "platform", "category", "description", "instructions", "tags", "notes"],
  },
};

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });
  if (!requireAdmin(req, res)) return;

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return res.status(500).json({ error: "ANTHROPIC_API_KEY is not configured on the server." });

  const { description, platform, model } = req.body || {};
  if (!description || !String(description).trim()) return res.status(400).json({ error: "A description is required." });
  const chosenModel = ALLOWED_MODELS.has(model) ? model : DEFAULT_MODEL;
  const targetPlatform = SKILL_PLATFORMS.includes(platform) ? platform : "Claude";

  try {
    const r = await fetch(API_URL, {
      method: "POST",
      headers: { "content-type": "application/json", "x-api-key": apiKey, "anthropic-version": API_VERSION },
      body: JSON.stringify({
        model: chosenModel,
        max_tokens: 4096,
        tools: [TOOL],
        tool_choice: { type: "tool", name: "emit_skill" },
        messages: [
          {
            role: "user",
            content:
              `Draft a high-quality, reusable AI skill targeting ${targetPlatform} for this need:\n\n"${description}"\n\n` +
              "Write complete, self-contained instructions: when the skill should trigger, the rules or workflow to " +
              "follow, and the expected output. Use the emit_skill tool.",
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
    if (!toolUse) return res.status(502).json({ error: "Model did not return a structured skill." });
    return res.status(200).json({ skill: sanitizeSkill(toolUse.input) });
  } catch (err) {
    return res.status(502).json({ error: `Request failed: ${err?.message || err}` });
  }
}
