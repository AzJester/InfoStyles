import { test } from "node:test";
import assert from "node:assert/strict";
import { toImagePrompt, toNotebookLMPrompt, extractVariables, applyVariables } from "../public/js/imagePrompt.js";

test("includes the palette as an exact-color instruction", () => {
  const p = toImagePrompt({ style: "Test", palette: ["#1F2537", "#FFFFFF"] });
  assert.match(p, /Use ONLY this exact color palette: #1F2537, #FFFFFF\./);
});

test("frames 'avoid' as a positive constraint, not a bare negative", () => {
  const p = toImagePrompt({ style: "X", avoid: "gradients; neon" });
  assert.match(p, /keep the design free of gradients; neon/);
  assert.doesNotMatch(p, /Do NOT include/);
});

test("skips empty fields cleanly", () => {
  const p = toImagePrompt({ style: "Minimal", palette: [], type: "", layout: "Grid" });
  assert.match(p, /Layout: Grid\./);
  assert.doesNotMatch(p, /color palette/);
  assert.doesNotMatch(p, /Visual \/ typographic style/);
});

test("names the style", () => {
  const p = toImagePrompt({ style: "Synthwave" });
  assert.match(p, /in the style of "Synthwave"/);
});

test("toImagePrompt respects aspect ratio and model", () => {
  const sq = toImagePrompt({ style: "X" }, { aspect: "1:1" });
  assert.match(sq, /A square infographic slide/);
  assert.match(sq, /Aspect ratio: 1:1\.$/);
  const mj = toImagePrompt({ style: "X" }, { model: "midjourney", aspect: "9:16" });
  assert.match(mj, /--ar 9:16 --v 6$/);
  // default
  assert.match(toImagePrompt({ style: "X" }), /A wide 16:9 infographic slide/);
});

test("extractVariables / applyVariables handle {{tokens}}", () => {
  assert.deepEqual(extractVariables("Hi {{name}}, about {{topic}} and {{name}}"), ["name", "topic"]);
  assert.equal(applyVariables("Hi {{name}}", { name: "Sam" }), "Hi Sam");
  assert.equal(applyVariables("Hi {{name}}", {}), "Hi {{name}}"); // unfilled left intact
});

test("toNotebookLMPrompt builds a terse paragraph from fields", () => {
  const p = toNotebookLMPrompt({
    style: "PMO Status Board",
    type: "Functional sans",
    layout: "Workstream lanes",
    charts: "Gantt; burn-up",
    palette: ["#1F2537"],
    avoid: "Over-decoration",
  });
  assert.match(p, /^PMO Status Board infographic slide, /);
  assert.match(p, /functional sans/);
  assert.match(p, /use only the given palette/);
  assert.match(p, /Avoid over-decoration\.$/);
});

test("toNotebookLMPrompt handles a near-empty style", () => {
  assert.equal(toNotebookLMPrompt({ style: "Bare" }), "Bare infographic slide.");
  assert.match(toNotebookLMPrompt({}), /^Infographic slide\.?$/);
});
