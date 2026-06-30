import { requireAdmin } from "../lib/auth.js";
import { sanitizePrompt } from "../lib/prompt.js";

const API_URL = "https://api.anthropic.com/v1/messages";
const API_VERSION = "2023-06-01";
const ALLOWED_MODELS = new Set(["claude-sonnet-4-6", "claude-opus-4-8", "claude-haiku-4-5-20251001"]);
const DEFAULT_MODEL = "claude-sonnet-4-6";

const TOOL = {
  name: "emit_prompt",
  description: "Return one reusable LLM prompt.",
  input_schema: {
    type: "object",
    properties: {
      title: { type: "string", description: "Short, descriptive title." },
      category: { type: "string", description: "Grouping, e.g. Research, Chat, Coding, Writing." },
      body: { type: "string", description: "The full prompt text. Use {{variable}} placeholders where the user should fill in specifics." },
      models: { type: "array", items: { type: "string" }, description: "Models it suits. Refer to ChatGPT as \"ChatGPT (GPT-5.5)\"; e.g. Claude Opus 4.8, ChatGPT (GPT-5.5), Gemini." },
      tags: { type: "array", items: { type: "string" }, description: "A few short tags." },
      notes: { type: "string", description: "Optional notes on usage or expected output." },
    },
    required: ["title", "category", "body", "models", "tags", "notes"],
  },
};

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });
  if (!requireAdmin(req, res)) return;

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return res.status(500).json({ error: "ANTHROPIC_API_KEY is not configured on the server." });

  const { description, model } = req.body || {};
  if (!description || !String(description).trim()) return res.status(400).json({ error: "A description is required." });
  const chosenModel = ALLOWED_MODELS.has(model) ? model : DEFAULT_MODEL;

  try {
    const r = await fetch(API_URL, {
      method: "POST",
      headers: { "content-type": "application/json", "x-api-key": apiKey, "anthropic-version": API_VERSION },
      body: JSON.stringify({
        model: chosenModel,
        max_tokens: 1536,
        tools: [TOOL],
        tool_choice: { type: "tool", name: "emit_prompt" },
        messages: [
          {
            role: "user",
            content:
              `Draft a high-quality, reusable LLM prompt for this need:\n\n"${description}"\n\n` +
              "Use {{variable}} placeholders for parts the user should customize. Use the emit_prompt tool.",
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
    if (!toolUse) return res.status(502).json({ error: "Model did not return a structured prompt." });
    return res.status(200).json({ prompt: sanitizePrompt(toolUse.input) });
  } catch (err) {
    return res.status(502).json({ error: `Request failed: ${err?.message || err}` });
  }
}
