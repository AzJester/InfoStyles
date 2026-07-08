// Shared admin review queue: community submissions — Prompt Studio prompts,
// visitor-submitted skills, and visitor-submitted styles — wait here,
// private, until the admin approves or rejects them. One queue modal and one
// banner, shared by all three library pages. Records carry kind: "skill" |
// "style"; anything else (incl. older records with no kind) is a prompt.
import * as api from "./api.js";
import { adminState } from "./admin.js";
import { escapeHtml, toast, openModal, closeModal, wireModalDismiss } from "./ui.js";

let subs = [];
let refs;
// Wired by main.js: how to open each kind's editor in approve mode, and what
// to refresh after the queue publishes/rejects something.
let handlers = {}; // { editPrompt, editSkill, editStyle, onChange(kind|null) }

export function queueCount() {
  return subs.length;
}

export async function loadQueue() {
  if (!adminState().admin) {
    subs = [];
    return;
  }
  try {
    subs = (await api.getSubmissions()).submissions || [];
  } catch {
    subs = [];
  }
}

// The admin-only "N submissions waiting" banner markup, identical on every
// library page. Callers inject it and then call wireQueueBanner on the root.
export function queueBannerHTML() {
  if (!adminState().admin || !subs.length) return "";
  return `<div class="queue-banner"><span class="queue-dot">${subs.length}</span> <b>${subs.length} submission${subs.length === 1 ? "" : "s"} waiting for review</b> <span class="muted">· visible only to you</span> <button type="button" class="btn btn-sm" data-open-queue>Open queue</button></div>`;
}

export function wireQueueBanner(rootEl) {
  rootEl?.querySelector("[data-open-queue]")?.addEventListener("click", openQueue);
}

function subKind(s) {
  return s.kind === "skill" || s.kind === "style" ? s.kind : "prompt";
}

function verdictChips(s) {
  const v = s.verdict || {};
  const chips = [];
  if (v.quality === "solid") chips.push(`<span class="chip-verdict ok">Claude: looks solid</span>`);
  else if (v.quality === "spam") chips.push(`<span class="chip-verdict bad">Claude: likely spam</span>`);
  else if (v.quality) chips.push(`<span class="chip-verdict warn">Claude: usable but thin</span>`);
  if (v.duplicateOf)
    chips.push(
      `<span class="chip-verdict warn">near-duplicate of “${escapeHtml(v.duplicateOf)}”${v.similarity ? ` (${v.similarity}%)` : ""}</span>`
    );
  if (s.copied) chips.push(`<span class="chip-verdict info">copied by creator</span>`);
  return chips.join("");
}

// Shared meta line: kind-specific bits + credit, timestamp, and reference id.
function metaLine(s, bits) {
  const parts = bits.filter(Boolean).map(escapeHtml);
  if (s.credit) parts.push(`credit: ${escapeHtml(s.credit)}`);
  if (s.at) parts.push(escapeHtml(new Date(s.at).toLocaleString()));
  parts.push(escapeHtml(s.id));
  return parts.join(" · ");
}

function actionsHTML(s) {
  return `<div class="pd-actions" style="justify-content:flex-start">
    <button type="button" class="btn btn-sm btn-primary" data-sapprove="${escapeHtml(s.id)}">✓ Approve</button>
    <button type="button" class="btn btn-sm" data-sedit="${escapeHtml(s.id)}">Edit &amp; approve</button>
    <button type="button" class="btn btn-sm btn-ghost btn-danger" data-sreject="${escapeHtml(s.id)}">Reject</button>
  </div>`;
}

function promptCardHTML(s) {
  return `<div class="result-item sub-card" data-sid="${escapeHtml(s.id)}">
    <div class="sub-head"><span class="badge">Prompt</span><b>${escapeHtml(s.title || "Untitled")}</b>${verdictChips(s)}</div>
    <div class="muted sub-meta">${metaLine(s, ["via Prompt Studio", s.category || "General", (s.tags || []).length ? `tags: ${(s.tags || []).join(", ")}` : ""])}</div>
    <pre class="prompt-preview">${escapeHtml(s.body || "")}</pre>
    ${s.verdict?.note ? `<p class="field-help">🤖 ${escapeHtml(s.verdict.note)}</p>` : ""}
    ${actionsHTML(s)}
  </div>`;
}

function skillCardHTML(s) {
  const k = s.skill || {};
  const nRes = (k.resources || []).length;
  return `<div class="result-item sub-card" data-sid="${escapeHtml(s.id)}">
    <div class="sub-head"><span class="badge">Skill</span><b>${escapeHtml(k.name || "Untitled skill")}</b>${verdictChips(s)}</div>
    <div class="muted sub-meta">${metaLine(s, [k.platform || "Other", k.category || "General", (k.tags || []).length ? `tags: ${(k.tags || []).join(", ")}` : "", nRes ? `${nRes} package file${nRes === 1 ? "" : "s"}` : ""])}</div>
    ${k.description ? `<p class="field-help">${escapeHtml(k.description)}</p>` : ""}
    ${k.instructions ? `<pre class="prompt-preview">${escapeHtml(k.instructions)}</pre>` : ""}
    ${k.link ? `<div class="muted sub-meta">source: <a href="${escapeHtml(k.link)}" target="_blank" rel="noopener">${escapeHtml(k.link)}</a></div>` : ""}
    ${actionsHTML(s)}
  </div>`;
}

function styleCardHTML(s) {
  const st = s.style || {};
  const swatches = (st.palette || [])
    .map((h) => `<span class="swatch sm" style="background:${escapeHtml(h)}" title="${escapeHtml(h)}"></span>`)
    .join("");
  const details = [
    ["Type", st.type],
    ["Icons", st.icons],
    ["Layout", st.layout],
    ["Charts", st.charts],
    ["Background", st.background],
    ["Avoid", st.avoid],
    ["NotebookLM prompt", st.notebookLMPrompt],
  ]
    .filter(([, v]) => v)
    .map(([label, v]) => `${label}: ${v}`)
    .join("\n");
  return `<div class="result-item sub-card" data-sid="${escapeHtml(s.id)}">
    <div class="sub-head"><span class="badge">Style</span><b>${escapeHtml(st.style || "Untitled")}</b>${verdictChips(s)}</div>
    <div class="muted sub-meta">${metaLine(s, [st.category || "Custom"])}</div>
    ${swatches ? `<span class="swatches">${swatches}</span>` : ""}
    ${details ? `<pre class="prompt-preview">${escapeHtml(details)}</pre>` : ""}
    ${actionsHTML(s)}
  </div>`;
}

export function openQueue() {
  const bodyEl = refs.body;
  bodyEl.innerHTML = subs.length
    ? subs
        .map((s) => {
          const k = subKind(s);
          return k === "skill" ? skillCardHTML(s) : k === "style" ? styleCardHTML(s) : promptCardHTML(s);
        })
        .join("")
    : `<p class="field-help">The queue is empty.</p>`;

  bodyEl.querySelectorAll("[data-sapprove]").forEach((b) =>
    b.addEventListener("click", async () => {
      const s = subs.find((x) => x.id === b.dataset.sapprove);
      try {
        await api.submissionAction({ action: "approve", id: b.dataset.sapprove });
        toast("Published to the library ✓");
        await loadQueue();
        openQueue();
        handlers.onChange?.(s ? subKind(s) : null);
      } catch (e) {
        toast(e.message);
      }
    })
  );
  bodyEl.querySelectorAll("[data-sedit]").forEach((b) =>
    b.addEventListener("click", () => {
      const s = subs.find((x) => x.id === b.dataset.sedit);
      if (!s) return;
      closeModal(refs.modal);
      const k = subKind(s);
      if (k === "skill") handlers.editSkill?.(s);
      else if (k === "style") handlers.editStyle?.(s);
      else handlers.editPrompt?.(s);
    })
  );
  bodyEl.querySelectorAll("[data-sreject]").forEach((b) =>
    b.addEventListener("click", async () => {
      if (!confirm("Reject this submission? It moves to the trash (restorable).")) return;
      try {
        await api.submissionAction({ action: "reject", id: b.dataset.sreject });
        toast("Rejected");
        await loadQueue();
        openQueue();
        handlers.onChange?.(null);
      } catch (e) {
        toast(e.message);
      }
    })
  );
  openModal(refs.modal);
}

export function initQueue(h = {}) {
  handlers = h;
  refs = {
    modal: document.getElementById("subsModal"),
    body: document.getElementById("subsBody"),
  };
  wireModalDismiss(refs.modal);
}
