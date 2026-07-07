// Minimal, safe Markdown renderer for saved prompt outputs. The input is
// untrusted text: every line is HTML-escaped first, then a small Markdown
// subset is layered on top — headings, **bold**, *italic*, `code`, fenced
// code blocks, bullet/numbered lists, > quotes, --- rules, and [links]()
// (http(s) or site-relative only). No raw HTML ever passes through.
// Pure (no DOM), so the same module runs in the browser and under node:test.

const ESC = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" };
const escapeHtml = (s) => String(s).replace(/[&<>"]/g, (c) => ESC[c]);

function inline(raw) {
  let t = escapeHtml(raw);
  t = t.replace(/`([^`]+)`/g, "<code>$1</code>");
  t = t.replace(/\*\*([^*]+)\*\*/g, "<b>$1</b>");
  t = t.replace(/\*([^*\s][^*]*)\*/g, "<i>$1</i>");
  t = t.replace(
    /\[([^\]]+)\]\((https?:\/\/[^\s)]+|\/[^\s)]+)\)/g,
    '<a href="$2" target="_blank" rel="noopener">$1</a>'
  );
  return t;
}

export function renderMarkdown(src) {
  const lines = String(src ?? "").replace(/\r\n?/g, "\n").split("\n");
  const html = [];
  let list = null; // "ul" | "ol" while inside a list
  let para = []; // consecutive plain lines -> one <p> with <br>s
  let quote = []; // consecutive "> " lines -> one <blockquote>
  let code = null; // array of escaped lines while inside a ``` fence

  const closeList = () => {
    if (list) {
      html.push(`</${list}>`);
      list = null;
    }
  };
  const flushPara = () => {
    if (para.length) {
      html.push(`<p>${para.join("<br>")}</p>`);
      para = [];
    }
  };
  const flushQuote = () => {
    if (quote.length) {
      html.push(`<blockquote>${quote.join("<br>")}</blockquote>`);
      quote = [];
    }
  };
  const flushAll = () => {
    flushPara();
    flushQuote();
    closeList();
  };

  for (const line of lines) {
    if (code) {
      if (/^```/.test(line)) {
        html.push(`<pre><code>${code.join("\n")}</code></pre>`);
        code = null;
      } else {
        code.push(escapeHtml(line));
      }
      continue;
    }
    if (/^```/.test(line)) {
      flushAll();
      code = [];
      continue;
    }
    if (!line.trim()) {
      flushAll();
      continue;
    }
    const h = /^(#{1,6})\s+(.+)$/.exec(line);
    if (h) {
      flushAll();
      const lvl = Math.min(h[1].length + 2, 6); // # -> h3 … so output never outranks the modal title
      html.push(`<h${lvl}>${inline(h[2])}</h${lvl}>`);
      continue;
    }
    if (/^(-{3,}|\*{3,}|_{3,})\s*$/.test(line)) {
      flushAll();
      html.push("<hr>");
      continue;
    }
    const q = /^>\s?(.*)$/.exec(line);
    if (q) {
      flushPara();
      closeList();
      quote.push(inline(q[1]));
      continue;
    }
    const ul = /^\s*[-*+]\s+(.+)$/.exec(line);
    const ol = /^\s*\d+[.)]\s+(.+)$/.exec(line);
    if (ul || ol) {
      flushPara();
      flushQuote();
      const kind = ul ? "ul" : "ol";
      if (list !== kind) {
        closeList();
        html.push(`<${kind}>`);
        list = kind;
      }
      html.push(`<li>${inline((ul || ol)[1])}</li>`);
      continue;
    }
    flushQuote();
    closeList();
    para.push(inline(line));
  }
  if (code) html.push(`<pre><code>${code.join("\n")}</code></pre>`); // unclosed fence
  flushAll();
  return html.join("");
}
