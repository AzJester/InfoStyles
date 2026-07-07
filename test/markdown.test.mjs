import { test } from "node:test";
import assert from "node:assert/strict";
import { renderMarkdown } from "../public/js/markdown.js";

test("renderMarkdown escapes HTML — no raw markup ever passes through", () => {
  const html = renderMarkdown('<img src=x onerror=alert(1)> & "quotes"');
  assert.ok(!html.includes("<img"));
  assert.ok(html.includes("&lt;img"));
  assert.ok(html.includes("&amp;"));
  assert.ok(html.includes("&quot;quotes&quot;"));
});

test("renderMarkdown handles emphasis, code, and headings", () => {
  const html = renderMarkdown("# Title\nSome **bold** and *italic* and `code`.");
  assert.ok(html.includes("<h3>Title</h3>"));
  assert.ok(html.includes("<b>bold</b>"));
  assert.ok(html.includes("<i>italic</i>"));
  assert.ok(html.includes("<code>code</code>"));
});

test("renderMarkdown builds lists and separates them from paragraphs", () => {
  const html = renderMarkdown("intro\n- one\n- two\n1. first\n2. second\noutro");
  assert.ok(html.includes("<p>intro</p>"));
  assert.ok(html.includes("<ul><li>one</li><li>two</li></ul>"));
  assert.ok(html.includes("<ol><li>first</li><li>second</li></ol>"));
  assert.ok(html.includes("<p>outro</p>"));
});

test("renderMarkdown keeps fenced code verbatim (escaped, no inline formatting)", () => {
  const html = renderMarkdown("```\n**not bold** <b>\n```");
  assert.ok(html.includes("<pre><code>**not bold** &lt;b&gt;</code></pre>"));
});

test("renderMarkdown closes an unclosed fence instead of eating the text", () => {
  assert.ok(renderMarkdown("```\ndangling").includes("<pre><code>dangling</code></pre>"));
});

test("renderMarkdown links only http(s) and site-relative URLs", () => {
  const ok = renderMarkdown("[docs](https://example.com/a) and [local](/uploads/files/x.pdf)");
  assert.ok(ok.includes('<a href="https://example.com/a" target="_blank" rel="noopener">docs</a>'));
  assert.ok(ok.includes('<a href="/uploads/files/x.pdf"'));
  const bad = renderMarkdown("[x](javascript:alert(1))");
  assert.ok(!bad.includes("<a "));
});

test("renderMarkdown renders quotes, rules, and line breaks", () => {
  const html = renderMarkdown("> quoted\n\n---\nline one\nline two");
  assert.ok(html.includes("<blockquote>quoted</blockquote>"));
  assert.ok(html.includes("<hr>"));
  assert.ok(html.includes("<p>line one<br>line two</p>"));
});

test("renderMarkdown tolerates empty/nullish input", () => {
  assert.equal(renderMarkdown(""), "");
  assert.equal(renderMarkdown(null), "");
  assert.equal(renderMarkdown(undefined), "");
});
