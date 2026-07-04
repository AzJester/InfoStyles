import { kvAvailable, upsertSubmission, bumpStudioDaily } from "../lib/store.js";
import { getPrompts as storedPrompts, getDeletedPromptIds } from "../lib/store.js";
import { mergePrompts } from "../lib/prompt.js";
import { seedPrompts } from "../lib/promptSeeds.js";
import { clientKey } from "../lib/ratelimit.js";

// Public Prompt Studio: a visitor drafts a prompt, Claude improves it, and the
// improved prompt is saved to the admin's private review queue whether or not
// the visitor copies it. Spend is capped hard:
//   - per visitor-hour: STUDIO_IP_HOURLY improve calls (default 6 = 3 prompts x 2 rounds)
//   - per day, site-wide: STUDIO_DAILY_CAP improve calls (default 100)
//   - STUDIO_DISABLED=1 turns the whole feature off
// ANTHROPIC_BASE_URL is overridable so tests can point at a mock.
const API_URL = `${process.env.ANTHROPIC_BASE_URL || "https://api.anthropic.com"}/v1/messages`;
const API_VERSION = "2023-06-01";
const MODEL = "claude-sonnet-4-6";
const DAILY_CAP = Math.max(1, Number(process.env.STUDIO_DAILY_CAP) || 100);
const IP_HOURLY = Math.max(1, Number(process.env.STUDIO_IP_HOURLY) || 6);
const MAX_DRAFT = 4000;

const hits = new Map(); // ip -> { count, first }
function withinIpLimit(key) {
  const now = Date.now();
  const rec = hits.get(key);
  if (!rec || now - rec.first > 60 * 60 * 1000) {
    hits.set(key, { count: 1, first: now });
    return true;
  }
  rec.count++;
  return rec.count <= IP_HOURLY;
}

const TOOL = {
  name: "emit_improved_prompt",
  description: "Return the improved, reusable version of a rough prompt draft.",
  input_schema: {
    type: "object",
    properties: {
      title: { type: "string", description: "Short, descriptive title for the prompt." },
      category: { type: "string", description: "One grouping, e.g. Research, Writing, Project Management, Business Dev." },
      tags: { type: "array", items: { type: "string" }, description: "Two to four short lowercase tags." },
      body: {
        type: "string",
        description:
          "The improved prompt. Keep the author's intent; add structure, constraints, and output shape. " +
          "Turn specifics into {{variable}} placeholders the next user fills in — single tokens only, " +
          "snake_case or hyphenated (e.g. {{project_name}}), never spaces inside the braces.",
      },
      whatChanged: { type: "string", description: "One or two sentences, plain language: what you improved and why." },
      quality: { type: "string", enum: ["solid", "weak", "spam"], description: "Honest quality read of the underlying idea: solid = library-worthy; weak = usable but thin; spam = promotional/nonsense." },
    },
    required: ["title", "category", "tags", "body", "whatChanged", "quality"],
  },
};

// A short deterministic id per submission (no Math.random: hash of content+time).
function subId(text) {
  let h = 0;
  const s = text + Date.now();
  for (let i = 0; i < s.length; i++) h = (Math.imul(31, h) + s.charCodeAt(i)) | 0;
  return `sub-${Math.abs(h).toString(36).toUpperCase().slice(0, 6)}`;
}

// Cheap near-duplicate check against the live library (word-set Jaccard).
async function findDuplicate(body) {
  try {
    const [saved, deleted] = await Promise.all([storedPrompts(), getDeletedPromptIds()]);
    const all = mergePrompts(seedPrompts(), saved, deleted);
    const words = (t) => new Set(String(t).toLowerCase().split(/\W+/).filter((w) => w.length > 3));
    const a = words(body);
    if (a.size < 5) return null;
    let best = null;
    let bestScore = 0;
    for (const p of all) {
      const b = words(p.body);
      let inter = 0;
      for (const w of a) if (b.has(w)) inter++;
      const score = inter / (a.size + b.size - inter);
      if (score > bestScore) {
        bestScore = score;
        best = p;
      }
    }
    return bestScore >= 0.6 ? { title: best.title, score: Math.round(bestScore * 100) } : null;
  } catch {
    return null;
  }
}

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });
  if (process.env.STUDIO_DISABLED === "1") return res.status(503).json({ error: "The Prompt Studio is currently turned off." });
  if (!kvAvailable()) return res.status(503).json({ error: "The Prompt Studio isn't available right now." });

  const { action = "improve", id, draft, credit, website } = req.body || {};

  // Honeypot: real users never fill this hidden field.
  if (website) return res.status(200).json({ ok: true });

  try {
    if (action === "copied") {
      if (!id) return res.status(400).json({ error: "id is required." });
      await upsertSubmission({ id: String(id).slice(0, 20), copied: true, ...(credit ? { credit: String(credit).slice(0, 80) } : {}) });
      return res.status(200).json({ ok: true });
    }

    // action: improve
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) return res.status(503).json({ error: "The Prompt Studio isn't available right now." });
    const text = String(draft || "").trim().slice(0, MAX_DRAFT);
    if (text.length < 20) return res.status(400).json({ error: "Write a bit more first — at least a sentence about what the prompt should do." });

    if (!withinIpLimit(clientKey(req))) {
      return res.status(429).json({ error: "You've hit the hourly limit — try again in a while." });
    }
    const daily = await bumpStudioDaily();
    if (daily > DAILY_CAP) {
      return res.status(429).json({ error: "The Studio hit its daily limit — come back tomorrow." });
    }

    const r = await fetch(API_URL, {
      method: "POST",
      headers: { "content-type": "application/json", "x-api-key": apiKey, "anthropic-version": API_VERSION },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 1500,
        tools: [TOOL],
        tool_choice: { type: "tool", name: "emit_improved_prompt" },
        messages: [
          {
            role: "user",
            content:
              "A visitor drafted this rough prompt. Improve it into a reusable, well-structured prompt: keep their " +
              "intent, add structure and constraints, define the output shape, and turn specifics into {{variable}} " +
              `placeholders. Judge the quality of the underlying idea honestly.\n\nDraft:\n"""\n${text}\n"""\n\nUse the emit_improved_prompt tool.`,
          },
        ],
      }),
    });
    if (!r.ok) {
      console.error("studio improve failed:", r.status, r.statusText);
      return res.status(502).json({ error: "The improver hiccuped — try again in a moment." });
    }
    const data = await r.json();
    const toolUse = (data.content || []).find((b) => b.type === "tool_use");
    if (!toolUse) return res.status(502).json({ error: "The improver hiccuped — try again in a moment." });
    const out = toolUse.input || {};
    const improved = {
      title: String(out.title || "Untitled prompt").slice(0, 200),
      category: String(out.category || "General").slice(0, 120),
      tags: (Array.isArray(out.tags) ? out.tags : []).map((t) => String(t).slice(0, 40)).slice(0, 6),
      body: String(out.body || "").slice(0, 20000),
      whatChanged: String(out.whatChanged || "").slice(0, 600),
      quality: ["solid", "weak", "spam"].includes(out.quality) ? out.quality : "weak",
    };

    const dup = await findDuplicate(improved.body);
    const submissionId = id ? String(id).slice(0, 20) : subId(text);
    await upsertSubmission({
      id: submissionId,
      title: improved.title,
      category: improved.category,
      tags: improved.tags,
      body: improved.body,
      draft: text,
      ...(credit ? { credit: String(credit).slice(0, 80) } : {}),
      verdict: { quality: improved.quality, note: improved.whatChanged, ...(dup ? { duplicateOf: dup.title, similarity: dup.score } : {}) },
      source: "studio",
      copied: false,
      at: new Date().toISOString(),
    });

    return res.status(200).json({ id: submissionId, prompt: improved, duplicate: dup });
  } catch (err) {
    console.error("studio error:", err);
    return res.status(500).json({ error: "Something went wrong — try again in a moment." });
  }
}
