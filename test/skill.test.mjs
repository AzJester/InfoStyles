import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { sanitizeSkill, slugify, mergeSkills, SKILL_PLATFORMS } from "../lib/skill.js";
import { seedSkills } from "../lib/skillSeeds.js";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");

test("sanitizeSkill fills defaults and splits comma lists", () => {
  const s = sanitizeSkill({ name: "Meeting Notes", platform: "Claude", tags: "notes, meetings , notes" });
  assert.equal(s.name, "Meeting Notes");
  assert.equal(s.platform, "Claude");
  assert.equal(s.category, "General");
  assert.deepEqual(s.tags, ["notes", "meetings"]); // trimmed + de-duped
});

test("sanitizeSkill defaults a missing name/platform", () => {
  const s = sanitizeSkill({});
  assert.equal(s.name, "Untitled skill");
  assert.equal(s.platform, "Other");
  assert.equal(s.instructions, "");
  assert.deepEqual(s.tags, []);
});

test("sanitizeSkill keeps http(s) links and drops everything else", () => {
  assert.equal(sanitizeSkill({ link: "https://example.com/a" }).link, "https://example.com/a");
  assert.equal(sanitizeSkill({ link: "javascript:alert(1)" }).link, "");
  assert.equal(sanitizeSkill({ link: "not a url" }).link, "");
  assert.equal(sanitizeSkill({ link: "" }).link, "");
});

test("slugify is url-safe", () => {
  assert.equal(slugify("Claude", "My Skill!"), "claude-my-skill");
});

test("sanitizeSkill keeps valid ratings and omits the key otherwise", () => {
  assert.equal(sanitizeSkill({ name: "X", rating: 4 }).rating, 4);
  assert.ok(!("rating" in sanitizeSkill({ name: "X" })));
  assert.ok(!("rating" in sanitizeSkill({ name: "X", rating: 0 })));
  assert.ok(!("rating" in sanitizeSkill({ name: "X", rating: 9 })));
});

test("sanitizeSkill keeps base64 resources and rejects fake base64", () => {
  const s = sanitizeSkill({
    name: "X",
    resources: [
      { path: "assets/logo.png", text: "aGVsbG8=", encoding: "base64" },
      { path: "assets/fake.png", text: "<not base64!>", encoding: "base64" },
      { path: "notes.md", text: "plain text" },
    ],
  });
  assert.deepEqual(
    s.resources.map((r) => [r.path, r.encoding || "text"]),
    [["assets/logo.png", "base64"], ["notes.md", "text"]]
  );
});

test("mergeSkills marks saved records that shadow a seed with _seed", () => {
  const merged = mergeSkills([{ id: "a" }, { id: "b" }], [{ id: "a", name: "edited" }, { id: "new" }], []);
  assert.equal(merged.find((s) => s.id === "a")._seed, true);
  assert.ok(!("_seed" in merged.find((s) => s.id === "new")));
});

test("sanitizeSkill keeps package resources, drops junk and traversal paths", () => {
  const s = sanitizeSkill({
    name: "X",
    resources: [
      { path: "references/GUARDRAILS.md", text: "rules" },
      { path: "/leading/slash.md", text: "kept, slash stripped" },
      { path: "../evil.md", text: "dropped" },
      { path: "references/GUARDRAILS.md", text: "duplicate dropped" },
      { path: "empty.md", text: "" },
      "not an object",
    ],
  });
  assert.deepEqual(
    s.resources.map((r) => r.path),
    ["references/GUARDRAILS.md", "leading/slash.md"]
  );
  assert.equal(s.resources[0].text, "rules");
});

// The platform list lives in three places (lib/skill.js, public/js/skills.js,
// and the #sPlatform <select> in index.html) because the static frontend can't
// import server code. This guards against the copies drifting apart.
test("the platform list matches across lib, frontend module, and form markup", () => {
  const skillsJs = readFileSync(path.join(ROOT, "public", "js", "skills.js"), "utf8");
  const uiList = JSON.parse(skillsJs.match(/const PLATFORMS = (\[[^\]]*\])/)?.[1].replace(/'/g, '"') || "null");
  assert.deepEqual(uiList, SKILL_PLATFORMS, "public/js/skills.js PLATFORMS drifted from lib/skill.js");

  const html = readFileSync(path.join(ROOT, "public", "index.html"), "utf8");
  const select = html.match(/<select id="sPlatform"[\s\S]*?<\/select>/)?.[0] || "";
  const options = [...select.matchAll(/<option value="([^"]*)"/g)].map((m) => m[1]);
  assert.deepEqual(options, SKILL_PLATFORMS, "index.html #sPlatform options drifted from lib/skill.js");
});

test("mergeSkills puts saved skills first, then unshadowed seeds", () => {
  const seeds = [{ id: "s1", name: "Seed 1" }, { id: "s2", name: "Seed 2" }];
  const saved = [{ id: "new", name: "Admin" }, { id: "s2", name: "Seed 2 (edited)" }];
  const merged = mergeSkills(seeds, saved, []);
  assert.deepEqual(
    merged.map((s) => s.id),
    ["new", "s2", "s1"]
  );
  assert.equal(merged.find((s) => s.id === "s2").name, "Seed 2 (edited)"); // saved wins
});

test("mergeSkills drops tombstoned ids from both layers", () => {
  const seeds = [{ id: "s1" }, { id: "s2" }];
  const saved = [{ id: "new" }];
  assert.deepEqual(
    mergeSkills(seeds, saved, ["s1", "new"]).map((s) => s.id),
    ["s2"]
  );
});

test("mergeSkills handles missing arguments", () => {
  assert.deepEqual(mergeSkills(), []);
  assert.deepEqual(mergeSkills([{ id: "s1" }]).map((s) => s.id), ["s1"]);
});

// --- seed data (public/data/skills.json) ---

test("seed skills load and are non-empty", () => {
  const seeds = seedSkills();
  assert.ok(Array.isArray(seeds));
  assert.ok(seeds.length >= 15, `expected 15+ seed skills, got ${seeds.length}`);
});

test("seed skill ids are unique and slug-like", () => {
  const seeds = seedSkills();
  const ids = new Set(seeds.map((s) => s.id));
  assert.equal(ids.size, seeds.length);
  for (const s of seeds) assert.match(s.id, /^skill-[a-z0-9-]+$/);
});

test("every seed skill survives sanitizeSkill unchanged", () => {
  // skills.json is hand-edited (no build step), so this catches an edit that
  // exceeds sanitizeSkill's caps and would silently change on admin save.
  for (const s of seedSkills()) {
    const { id, ...fields } = s;
    assert.deepEqual(sanitizeSkill(fields), fields, `seed ${id} altered by sanitizeSkill`);
    assert.ok(fields.name, `seed ${id} has an empty name`);
    assert.ok(fields.description || fields.instructions, `seed ${id} has no description or instructions`);
  }
});

test("seed skills only use platforms the UI can badge", () => {
  for (const s of seedSkills()) {
    assert.ok(SKILL_PLATFORMS.includes(s.platform), `seed ${s.id} has unknown platform ${s.platform}`);
  }
});
