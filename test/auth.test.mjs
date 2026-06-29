import { test } from "node:test";
import assert from "node:assert/strict";
import { sign, verify, passwordMatches, parseCookies } from "../lib/auth.js";

const SECRET = "test-secret-value";

test("a freshly signed token verifies", () => {
  const token = sign({ exp: Date.now() + 10000, role: "admin" }, SECRET);
  const payload = verify(token, SECRET);
  assert.equal(payload.role, "admin");
});

test("an expired token is rejected", () => {
  const token = sign({ exp: Date.now() - 1, role: "admin" }, SECRET);
  assert.equal(verify(token, SECRET), null);
});

test("a token signed with another secret is rejected", () => {
  const token = sign({ exp: Date.now() + 10000 }, SECRET);
  assert.equal(verify(token, "different-secret"), null);
});

test("a tampered token body is rejected", () => {
  const token = sign({ exp: Date.now() + 10000, role: "user" }, SECRET);
  const [, sig] = token.split(".");
  const forged = Buffer.from(JSON.stringify({ exp: Date.now() + 10000, role: "admin" })).toString("base64url") + "." + sig;
  assert.equal(verify(forged, SECRET), null);
});

test("password comparison matches only the exact password", () => {
  assert.equal(passwordMatches("hunter2", "hunter2"), true);
  assert.equal(passwordMatches("hunter2", "hunter3"), false);
  assert.equal(passwordMatches("short", "a-much-longer-password"), false);
  assert.equal(passwordMatches("anything", ""), false);
});

test("cookies parse into a map", () => {
  const req = { headers: { cookie: "sid=abc.def; theme=dark" } };
  const cookies = parseCookies(req);
  assert.equal(cookies.sid, "abc.def");
  assert.equal(cookies.theme, "dark");
});
