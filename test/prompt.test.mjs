import { test } from "node:test";
import assert from "node:assert/strict";
import { sanitizePrompt, slugify, mergePrompts } from "../lib/prompt.js";

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

test("sanitizePrompt normalizes saved outputs and drops empty ones", () => {
  const p = sanitizePrompt({
    title: "X",
    body: "Y",
    results: [
      { model: "Claude Opus 4.8", output: "hello", at: "2026-06-29T00:00:00.000Z" },
      { model: "GPT-5.5", output: "" }, // dropped: no output
      { output: "no model is fine" },
    ],
  });
  assert.equal(p.results.length, 2);
  assert.equal(p.results[0].model, "Claude Opus 4.8");
  assert.equal(p.results[0].output, "hello");
  assert.equal(p.results[1].output, "no model is fine");
});

test("sanitizePrompt tolerates a missing/invalid results field", () => {
  assert.deepEqual(sanitizePrompt({ title: "X", body: "Y" }).results, []);
  assert.deepEqual(sanitizePrompt({ title: "X", body: "Y", results: "nope" }).results, []);
});

test("sanitizePrompt keeps credit only when present", () => {
  assert.equal(sanitizePrompt({ title: "X", body: "Y", credit: "Jamie R." }).credit, "Jamie R.");
  assert.ok(!("credit" in sanitizePrompt({ title: "X", body: "Y" })));
  assert.ok(!("credit" in sanitizePrompt({ title: "X", body: "Y", credit: "   " })));
});

test("sanitizePrompt keeps valid ratings and omits the key otherwise", () => {
  assert.equal(sanitizePrompt({ title: "X", body: "Y", rating: 4 }).rating, 4);
  assert.equal(sanitizePrompt({ title: "X", body: "Y", rating: "5" }).rating, 5);
  // unrated / invalid / out of range: the key must be absent so seed records
  // round-trip unchanged and clearing a rating removes it
  assert.ok(!("rating" in sanitizePrompt({ title: "X", body: "Y" })));
  assert.ok(!("rating" in sanitizePrompt({ title: "X", body: "Y", rating: 0 })));
  assert.ok(!("rating" in sanitizePrompt({ title: "X", body: "Y", rating: 9 })));
  assert.ok(!("rating" in sanitizePrompt({ title: "X", body: "Y", rating: -2 })));
  assert.ok(!("rating" in sanitizePrompt({ title: "X", body: "Y", rating: "great" })));
});

test("slugify is url-safe", () => {
  assert.equal(slugify("Research", "My Prompt!"), "research-my-prompt");
});

test("mergePrompts puts saved prompts first, then unshadowed seeds", () => {
  const seeds = [{ id: "s1", title: "Seed 1" }, { id: "s2", title: "Seed 2" }];
  const saved = [{ id: "new", title: "Admin" }, { id: "s2", title: "Seed 2 (edited)" }];
  const merged = mergePrompts(seeds, saved, []);
  assert.deepEqual(
    merged.map((p) => p.id),
    ["new", "s2", "s1"]
  );
  assert.equal(merged.find((p) => p.id === "s2").title, "Seed 2 (edited)"); // saved wins
});

test("mergePrompts drops tombstoned ids from both layers", () => {
  const seeds = [{ id: "s1" }, { id: "s2" }];
  const saved = [{ id: "new" }];
  assert.deepEqual(
    mergePrompts(seeds, saved, ["s1", "new"]).map((p) => p.id),
    ["s2"]
  );
});

test("mergePrompts handles missing arguments", () => {
  assert.deepEqual(mergePrompts(), []);
  assert.deepEqual(mergePrompts([{ id: "s1" }]).map((p) => p.id), ["s1"]);
});

test("mergePrompts marks saved records that shadow a seed with _seed", () => {
  const merged = mergePrompts([{ id: "s1" }], [{ id: "s1", title: "edited" }, { id: "new" }], []);
  assert.equal(merged.find((p) => p.id === "s1")._seed, true);
  assert.ok(!("_seed" in merged.find((p) => p.id === "new")));
});
