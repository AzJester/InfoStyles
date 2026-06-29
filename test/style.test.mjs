import { test } from "node:test";
import assert from "node:assert/strict";
import { sanitizeStyle, normalizePalette, slugify } from "../lib/style.js";

test("normalizePalette keeps valid unique hex, uppercased", () => {
  assert.deepEqual(normalizePalette("#1f2537 #FFF #1F2537 nope"), ["#1F2537", "#FFF"]);
  assert.deepEqual(normalizePalette(["#abc", "#ABC", "bad"]), ["#ABC"]);
});

test("sanitizeStyle only accepts an https sample image URL", () => {
  assert.equal(sanitizeStyle({ sampleImage: "https://blob.example/x.png" }).sampleImage, "https://blob.example/x.png");
  assert.equal(sanitizeStyle({ sampleImage: "http://insecure/x.png" }).sampleImage, "");
  assert.equal(sanitizeStyle({ sampleImage: "javascript:alert(1)" }).sampleImage, "");
  assert.equal(sanitizeStyle({ sampleImage: "data:image/png;base64,AAAA" }).sampleImage, "");
  assert.equal(sanitizeStyle({}).sampleImage, "");
});

test("sanitizeStyle fills sensible defaults", () => {
  const s = sanitizeStyle({});
  assert.equal(s.style, "Untitled");
  assert.equal(s.category, "Custom");
  assert.deepEqual(s.palette, []);
});

test("slugify is url-safe", () => {
  assert.equal(slugify("AI", "My Cool Style!"), "ai-my-cool-style");
});
