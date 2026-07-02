// Validates the generated seed data (public/data/prompts.json, built by
// build_prompts.py from the Airtable CSV export): it must load, have stable
// unique ids, and match what the server's sanitizer would produce, so a seed
// record round-trips through an admin edit without silently changing.
import { test } from "node:test";
import assert from "node:assert/strict";
import { seedPrompts } from "../lib/promptSeeds.js";
import { sanitizePrompt } from "../lib/prompt.js";

test("seed prompts load and are non-empty", () => {
  const seeds = seedPrompts();
  assert.ok(Array.isArray(seeds));
  assert.ok(seeds.length > 100, `expected 100+ seed prompts, got ${seeds.length}`);
});

test("seed prompt ids are unique and slug-like", () => {
  const seeds = seedPrompts();
  const ids = new Set(seeds.map((p) => p.id));
  assert.equal(ids.size, seeds.length);
  for (const p of seeds) assert.match(p.id, /^prompt-[a-z0-9-]+$/);
});

test("every seed prompt survives sanitizePrompt unchanged", () => {
  // build_prompts.py mirrors the caps in sanitizePrompt; this catches drift.
  for (const p of seedPrompts()) {
    const { id, ...fields } = p;
    assert.deepEqual(sanitizePrompt(fields), fields, `seed ${id} altered by sanitizePrompt`);
    assert.ok(fields.body, `seed ${id} has an empty body`);
  }
});

test("no two seed prompts have identical content", () => {
  // The build dedupes duplicate Airtable rows; this catches regressions.
  const seen = new Map();
  for (const { id, ...fields } of seedPrompts()) {
    const key = JSON.stringify(fields);
    assert.ok(!seen.has(key), `seeds ${seen.get(key)} and ${id} are identical`);
    seen.set(key, id);
  }
});
