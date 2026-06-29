import { test } from "node:test";
import assert from "node:assert/strict";
import { sanitizeStyle, normalizePalette, slugify } from "../lib/style.js";

test("normalizePalette keeps valid unique hex, uppercased", () => {
  assert.deepEqual(normalizePalette("#1f2537 #FFF #1F2537 nope"), ["#1F2537", "#FFF"]);
  assert.deepEqual(normalizePalette(["#abc", "#ABC", "bad"]), ["#ABC"]);
});

test("sanitizeStyle accepts an https URL or a safe /uploads path for the sample image", () => {
  assert.equal(sanitizeStyle({ sampleImage: "https://cdn.example/x.png" }).sampleImage, "https://cdn.example/x.png");
  assert.equal(sanitizeStyle({ sampleImage: "/uploads/samples/eagle-ab12cd.jpg" }).sampleImage, "/uploads/samples/eagle-ab12cd.jpg");
  // rejected: insecure, scripty, data URIs, traversal, non-image, empty
  assert.equal(sanitizeStyle({ sampleImage: "http://insecure/x.png" }).sampleImage, "");
  assert.equal(sanitizeStyle({ sampleImage: "javascript:alert(1)" }).sampleImage, "");
  assert.equal(sanitizeStyle({ sampleImage: "data:image/png;base64,AAAA" }).sampleImage, "");
  assert.equal(sanitizeStyle({ sampleImage: "/uploads/../../etc/passwd" }).sampleImage, "");
  assert.equal(sanitizeStyle({ sampleImage: "/uploads/evil.svg" }).sampleImage, "");
  assert.equal(sanitizeStyle({}).sampleImage, "");
});

test("sanitizeStyle validates the images array and keeps the first as sampleImage", () => {
  const s = sanitizeStyle({ images: ["https://a.example/x.png", "javascript:bad", "/uploads/s/y.jpg", "/uploads/evil.svg"] });
  assert.deepEqual(s.images, ["https://a.example/x.png", "/uploads/s/y.jpg"]);
  assert.equal(s.sampleImage, "https://a.example/x.png");
});

test("sanitizeStyle migrates a legacy single sampleImage into images", () => {
  const s = sanitizeStyle({ sampleImage: "/uploads/s/old.png" });
  assert.deepEqual(s.images, ["/uploads/s/old.png"]);
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
