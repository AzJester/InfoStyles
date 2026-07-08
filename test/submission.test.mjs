import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildSkillSubmission,
  buildStyleSubmission,
  submissionSize,
  findDuplicateName,
  MAX_SUBMISSION_CHARS,
} from "../lib/submission.js";

const LONG_INSTRUCTIONS = "Step one: do the thing. Step two: check the thing. Step three: report the thing.";

test("buildSkillSubmission requires a name", () => {
  const out = buildSkillSubmission({ instructions: LONG_INSTRUCTIONS });
  assert.match(out.error, /name/i);
});

test("buildSkillSubmission requires instructions or a source link", () => {
  assert.match(buildSkillSubmission({ name: "X", instructions: "too short" }).error, /instructions/i);
  // A source link substitutes for pasted instructions.
  const linked = buildSkillSubmission({ name: "X", link: "https://example.com/skill" });
  assert.ok(linked.skill);
  assert.equal(linked.skill.link, "https://example.com/skill");
});

test("buildSkillSubmission sanitizes and strips curator-only fields", () => {
  const out = buildSkillSubmission({
    name: "Meeting Notes",
    platform: "Claude",
    instructions: LONG_INSTRUCTIONS,
    tags: "notes, meetings",
    rating: 5, // visitors can't rate
    updated: "2020-01-01", // stamped on approve, not on submit
  });
  assert.ok(out.skill);
  assert.ok(!("rating" in out.skill));
  assert.equal(out.skill.updated, "");
  assert.deepEqual(out.skill.tags, ["notes", "meetings"]);
});

test("buildSkillSubmission caps bundled resources below the admin limit", () => {
  const resources = Array.from({ length: 20 }, (_, i) => ({ path: `ref/${i}.md`, text: "content" }));
  const out = buildSkillSubmission({ name: "X", instructions: LONG_INSTRUCTIONS, resources });
  assert.equal(out.skill.resources.length, 8);
});

test("buildStyleSubmission requires a name and some substance", () => {
  assert.match(buildStyleSubmission({ layout: "modular grid with generous whitespace everywhere" }).error, /name/i);
  assert.match(buildStyleSubmission({ style: "Bare" }).error, /describe/i);
  // Two palette colors alone are enough substance.
  assert.ok(buildStyleSubmission({ style: "Duo", palette: "#112233 #445566" }).style);
  // …as is enough descriptive text.
  assert.ok(buildStyleSubmission({ style: "Wordy", layout: "modular grid with generous whitespace everywhere" }).style);
});

test("buildStyleSubmission strips images (visitors can't upload)", () => {
  const out = buildStyleSubmission({
    style: "Pic",
    palette: "#112233 #445566",
    images: ["https://example.com/x.png"],
    sampleImage: "https://example.com/x.png",
  });
  assert.deepEqual(out.style.images, []);
  assert.equal(out.style.sampleImage, "");
});

test("submissionSize measures the serialized record", () => {
  assert.ok(submissionSize({ a: "b" }) > 0);
  assert.ok(submissionSize({ big: "x".repeat(MAX_SUBMISSION_CHARS) }) > MAX_SUBMISSION_CHARS);
});

test("findDuplicateName matches case-insensitively and ignores whitespace", () => {
  assert.equal(findDuplicateName("meeting notes", ["Other", "Meeting Notes "]), "Meeting Notes ");
  assert.equal(findDuplicateName("Fresh", ["Other"]), null);
  assert.equal(findDuplicateName("", ["Other"]), null);
});
