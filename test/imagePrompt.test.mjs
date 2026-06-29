import { test } from "node:test";
import assert from "node:assert/strict";
import { toImagePrompt } from "../public/js/imagePrompt.js";

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
