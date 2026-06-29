import { test } from "node:test";
import assert from "node:assert/strict";
import { sanitizePrompt, slugify } from "../lib/prompt.js";

test("sanitizePrompt fills defaults and splits comma lists", () => {
  const p = sanitizePrompt({ title: "Lit review", body: "Find sources on {{topic}}", models: "Claude, GPT-4o , Claude", tags: "research,sources" });
  assert.equal(p.title, "Lit review");
  assert.equal(p.category, "General");
  assert.deepEqual(p.models, ["Claude", "GPT-4o"]); // trimmed + de-duped
  assert.deepEqual(p.tags, ["research", "sources"]);
  assert.match(p.body, /\{\{topic\}\}/);
});

test("sanitizePrompt defaults a missing title/body", () => {
  const p = sanitizePrompt({});
  assert.equal(p.title, "Untitled prompt");
  assert.equal(p.body, "");
  assert.deepEqual(p.models, []);
});

test("slugify is url-safe", () => {
  assert.equal(slugify("Research", "My Prompt!"), "research-my-prompt");
});
