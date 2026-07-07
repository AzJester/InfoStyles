// LLM prompt library: a second section (Valkey-backed) for reusable prompts,
// with saved outputs and copy-time customization (tone/audience/length/format).
import * as api from "./api.js";
import { adminState } from "./admin.js";
import { extractVariables, applyVariables } from "./imagePrompt.js";
import { renderMarkdown } from "./markdown.js";
import { escapeHtml, copyText, toast, openModal, closeModal, wireModalDismiss, openLightbox, downscaleImage, ICONS } from "./ui.js";
import { getPromptView, setPromptView, isPromptFavorite, togglePromptFavorite, promptFavoriteCount } from "./storage.js";

// External tools an end user might send a prompt to. ChatGPT and Claude accept
// the prompt text in the URL (?q=), so those open pre-filled; Gemini and
// NotebookLM have no prefill URL, so for them the flow is copy-then-paste.
// The buttons are real <a target="_blank"> links (not window.open) so popup
// blockers and installed-PWA windows can't swallow the navigation.
//
// Mobile: gemini.google.com/app bounces on phones (Android hands the URL to
// an app link and, when that fails, drops the user straight back). On Android
// we use an explicit intent:// URL that opens the Gemini app when installed
// and falls back to the web app otherwise; everywhere else the root URL
// survives the redirect dance better than /app.
const IS_ANDROID = /Android/i.test(navigator.userAgent);
const GEMINI_URL = IS_ANDROID
  ? "intent://gemini.google.com/#Intent;scheme=https;package=com.google.android.apps.bard;S.browser_fallback_url=https%3A%2F%2Fgemini.google.com%2F;end"
  : "https://gemini.google.com/";
const TOOLS = {
  chatgpt: { name: "ChatGPT", url: "https://chatgpt.com/", prefill: (t) => `https://chatgpt.com/?q=${encodeURIComponent(t)}` },
  claude: { name: "Claude", url: "https://claude.ai/new", prefill: (t) => `https://claude.ai/new?q=${encodeURIComponent(t)}` },
  gemini: { name: "Gemini", url: GEMINI_URL },
  notebooklm: { name: "NotebookLM", url: "https://notebooklm.google.com/" },
};
// Both prefill targets sit behind Cloudflare (rejects URLs past ~32k); stay
// well under. Longer prompts fall back to the tool's plain URL and rely on
// the clipboard copy.
const MAX_PREFILL_URL = 24000;

function toolHref(key, text) {
  const t = TOOLS[key];
  if (!t) return null;
  if (t.prefill) {
    const u = t.prefill(text);
    if (u.length <= MAX_PREFILL_URL) return u;
  }
  return t.url;
}

// Copy-time customization knobs end users may want. value = instruction text.
const KNOBS = {
  tone: ["", "Formal", "Professional", "Conversational", "Friendly", "Persuasive", "Technical", "Playful", "Neutral"],
  audience: ["", "General audience", "Executives / leadership", "Engineers / technical", "Students", "Researchers", "Beginners", "Children"],
  length: [
    ["", ""],
    ["Very short (~50 words)", "very short, around 50 words"],
    ["Short (~150 words)", "short, around 150 words"],
    ["Medium (~400 words)", "medium, around 400 words"],
    ["Long (~800 words)", "long, around 800 words"],
    ["Comprehensive", "comprehensive and detailed"],
  ],
  format: ["", "Prose paragraphs", "Bullet points", "Numbered steps", "Table", "Q&A", "Outline"],
};

function augment(body, opts) {
  const lines = [];
  if (opts.tone) lines.push(`- Tone: ${opts.tone}.`);
  if (opts.audience) lines.push(`- Audience: ${opts.audience}.`);
  if (opts.length) lines.push(`- Target length: ${opts.length}.`);
  if (opts.format) lines.push(`- Format: ${opts.format}.`);
  if (!lines.length) return body;
  return `${body}\n\nConstraints:\n${lines.join("\n")}`;
}

// Known AI models offered in the Models / "Model used" dropdowns. The list also
// grows with whatever models appear on saved prompts (see allModels()).
const BASE_MODELS = [
  "ChatGPT (GPT-5.5)",
  "Claude Opus 4.8",
  "Claude Sonnet 4.6",
  "Claude Haiku 4.5",
  "Gemini",
  "Grok",
  "Llama",
  "DeepSeek",
  "Perplexity",
];

let list = [];
let query = "";
let loaded = false;
let editId = null;
let formResults = [];
let formResultImages = []; // uploaded image URLs queued for the next "+ Add output"
let formResultFiles = []; // uploaded documents ({url, name}) queued for the next "+ Add output"
let formModels = []; // models attached to the prompt being edited
let formRating = 0; // curator rating (0 = unrated) for the prompt being edited
let viewMode = "list"; // "grid" | "list"
let activeTag = ""; // lowercased tag name selected in the filter dropdown
let activeCategory = ""; // category selected in the filter dropdown
let minRating = ""; // "" any | "1".."5" (at least N stars) | "unrated"
let sort = ""; // "" newest | "rating" | "title" | "outputs"
let favOnly = false;
let subs = []; // pending Prompt Studio submissions (admin only)
let approveId = null; // when set, saving the form approves this submission
const studio = { id: null, left: 0, body: "" }; // public studio state
let view, refs;

const byId = (id) => list.find((p) => p.id === id);

// Tags across all prompts, with counts, most-used first.
function allTags() {
  const counts = new Map();
  for (const p of list) for (const t of p.tags || []) counts.set(t, (counts.get(t) || 0) + 1);
  return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
}

// Categories offered even before any prompt uses them, so prompts get filed
// consistently (image-generation prompts under "Images").
const BASE_CATEGORIES = ["Images"];

// Categories across all prompts, with counts, alphabetical. Base categories
// are always present (count 0 when unused) so they show up in the filter and
// the form's category picker from day one.
function allCategories() {
  const counts = new Map();
  for (const c of BASE_CATEGORIES) counts.set(c, 0);
  for (const p of list) {
    const c = p.category || "General";
    counts.set(c, (counts.get(c) || 0) + 1);
  }
  return [...counts.entries()].sort((a, b) => a[0].localeCompare(b[0]));
}

// Base models plus any model named on an existing prompt or saved output, deduped
// (case-insensitive). New models added on a prompt show up here next time.
function allModels() {
  const seen = new Map(); // lowercase -> display label
  const add = (m) => {
    const k = String(m || "").trim();
    if (k && !seen.has(k.toLowerCase())) seen.set(k.toLowerCase(), k);
  };
  BASE_MODELS.forEach(add);
  for (const p of list) {
    (p.models || []).forEach(add);
    (p.results || []).forEach((r) => add(r.model));
  }
  return [...seen.values()];
}

function filtered() {
  const q = query.trim().toLowerCase();
  const out = list.filter((p) => {
    if (favOnly && !isPromptFavorite(p.id)) return false;
    if (activeCategory && (p.category || "General") !== activeCategory) return false;
    if (minRating === "unrated" && p.rating) return false;
    if (minRating && minRating !== "unrated" && (p.rating || 0) < Number(minRating)) return false;
    if (activeTag) {
      const tset = new Set((p.tags || []).map((t) => t.toLowerCase()));
      if (!tset.has(activeTag)) return false;
    }
    if (!q) return true;
    return [p.title, p.category, p.body, (p.tags || []).join(" "), (p.models || []).join(" ")]
      .join(" ")
      .toLowerCase()
      .includes(q);
  });
  // Default order is the stored order (newest first, since saves unshift).
  if (sort === "title") out.sort((a, b) => (a.title || "").localeCompare(b.title || ""));
  else if (sort === "outputs") out.sort((a, b) => (b.results || []).length - (a.results || []).length);
  else if (sort === "rating") out.sort((a, b) => (b.rating || 0) - (a.rating || 0));
  return out;
}

// "2026-07-03" -> "Jul 2026" (empty/invalid dates render nothing).
function formatUpdated(iso) {
  if (!iso) return "";
  const d = new Date(`${iso}T00:00:00`);
  if (isNaN(d)) return "";
  return d.toLocaleDateString(undefined, { month: "short", year: "numeric" });
}

// Read-only star row for a curator rating (1-5); unrated renders nothing.
function ratingHTML(r) {
  if (!r) return "";
  return `<span class="rating" role="img" aria-label="Rated ${r} of 5" title="Rated ${r} of 5">${"★".repeat(r)}<span class="rating-off" aria-hidden="true">${"★".repeat(5 - r)}</span></span>`;
}

function cardHTML(p, admin) {
  const tags = (p.tags || []).map((t) => `<span class="badge">${escapeHtml(t)}</span>`).join("");
  const models = (p.models || []).join(", ");
  const preview = p.body.length > 240 ? p.body.slice(0, 240) + "…" : p.body;
  const nResults = (p.results || []).length;
  const fav = isPromptFavorite(p.id);
  const when = formatUpdated(p.updated);
  return `<article class="card prompt-card" data-id="${escapeHtml(p.id)}" tabindex="0" role="button" aria-label="Open ${escapeHtml(p.title)}">
    <div class="card-body">
      <div class="card-head">
        <div class="card-title">${escapeHtml(p.title)}</div>
        <button type="button" class="fav ${fav ? "on" : ""}" data-fav="${escapeHtml(p.id)}" aria-pressed="${fav}" title="${fav ? "Remove from favorites" : "Add to favorites"}" aria-label="Favorite">${fav ? "★" : "☆"}</button>
      </div>
      <div class="card-category">${ratingHTML(p.rating)}${p.rating ? " · " : ""}${escapeHtml(p.category)}${models ? ` · ${escapeHtml(models)}` : ""}${p.credit ? ` · by ${escapeHtml(p.credit)}` : ""}</div>
      ${when ? `<div class="card-updated">Updated ${escapeHtml(when)}</div>` : ""}
      ${tags ? `<div class="badges">${tags}</div>` : ""}
      <pre class="prompt-preview">${escapeHtml(preview)}</pre>
    </div>
    <div class="card-actions always">
      <button type="button" class="btn btn-sm btn-primary" data-use="${escapeHtml(p.id)}">Copy</button>
      ${nResults ? `<button type="button" class="btn btn-sm" data-results="${escapeHtml(p.id)}">Outputs (${nResults})</button>` : ""}
      <button type="button" class="btn btn-sm btn-ghost" data-link="${escapeHtml(p.id)}" title="Copy a shareable link">Link</button>
      ${
        admin
          ? `<button type="button" class="btn btn-sm" data-edit="${escapeHtml(p.id)}">Edit</button>
             <button type="button" class="btn btn-sm btn-ghost btn-danger" data-del="${escapeHtml(p.id)}">Delete</button>`
          : ""
      }
    </div>
  </article>`;
}

function promptLink(id) {
  return `${location.origin}/prompts?prompt=${encodeURIComponent(id)}`;
}

function controlsHTML() {
  const tags = allTags();
  const cats = allCategories();
  // Tag / category options grow automatically as prompts are created.
  const tagOpts =
    `<option value="">All tags</option>` +
    tags
      .map(
        ([t, n]) =>
          `<option value="${escapeHtml(t.toLowerCase())}" ${activeTag === t.toLowerCase() ? "selected" : ""}>${escapeHtml(t)} (${n})</option>`
      )
      .join("");
  const catOpts =
    `<option value="">All categories (${list.length})</option>` +
    cats
      .map(
        ([c, n]) =>
          `<option value="${escapeHtml(c)}" ${activeCategory === c ? "selected" : ""}>${escapeHtml(c)} (${n})</option>`
      )
      .join("");
  const sortOpts = [
    ["", "Newest"],
    ["rating", "Top rated"],
    ["title", "Title A→Z"],
    ["outputs", "Most outputs"],
  ]
    .map(([v, label]) => `<option value="${v}" ${sort === v ? "selected" : ""}>${label}</option>`)
    .join("");
  // Filter by curator rating: "at least N stars", plus "Unrated" so the
  // curator can find prompts still waiting for a score.
  const nAtLeast = (n) => list.filter((p) => (p.rating || 0) >= n).length;
  const nUnrated = list.filter((p) => !p.rating).length;
  const ratingSelect =
    `<select id="pRatingFilter" class="select" aria-label="Filter by rating">` +
    `<option value="">Any rating</option>` +
    [5, 4, 3, 2, 1]
      .map(
        (n) =>
          `<option value="${n}" ${minRating === String(n) ? "selected" : ""}>${"★".repeat(n)}${n < 5 ? " & up" : ""} (${nAtLeast(n)})</option>`
      )
      .join("") +
    `<option value="unrated" ${minRating === "unrated" ? "selected" : ""}>Unrated (${nUnrated})</option>` +
    `</select>`;
  const favCount = promptFavoriteCount();
  return `<div class="prompts-controls">
    <div class="seg-group" role="group" aria-label="Prompt layout">
      <button type="button" class="seg ${viewMode === "list" ? "active" : ""}" data-pview="list" aria-pressed="${viewMode === "list"}" title="List view">${ICONS.list} List</button>
      <button type="button" class="seg ${viewMode === "grid" ? "active" : ""}" data-pview="grid" aria-pressed="${viewMode === "grid"}" title="Grid view">${ICONS.grid} Grid</button>
    </div>
    ${cats.length ? `<select id="pCatFilter" class="select" aria-label="Filter by category">${catOpts}</select>` : ""}
    ${tags.length ? `<select id="pTagFilter" class="select" aria-label="Filter by tag">${tagOpts}</select>` : ""}
    ${ratingSelect}
    <select id="pSort" class="select" aria-label="Sort prompts">${sortOpts}</select>
    <button type="button" id="pFav" class="btn btn-icon ${favOnly ? "active" : ""}" aria-pressed="${favOnly}" title="${favOnly ? `Showing favorites (${favCount})` : "Show favorites"}" aria-label="Show favorite prompts">${favOnly ? ICONS.starFill : ICONS.star}</button>
  </div>`;
}

function render() {
  if (!view) return;
  const admin = adminState().admin;
  const items = filtered();
  const hasFilter = !!query.trim() || !!activeTag || !!activeCategory || !!minRating || favOnly;
  const body = !items.length
    ? !loaded
      ? `<div class="gallery gallery--list">${Array.from({ length: 8 }, () => '<div class="skeleton skeleton-card"></div>').join("")}</div>`
      : `<div class="empty">${
          favOnly ? "No favorite prompts yet — tap ☆ on a prompt." : hasFilter ? "No prompts match your filters." : "No prompts yet."
        }${admin && !hasFilter ? ' Use "+ New prompt" to add one.' : ""}</div>`
    : `<div class="gallery ${viewMode === "list" ? "gallery--list" : ""}">${items.map((p) => cardHTML(p, admin)).join("")}</div>`;
  // Admin-only banner: pending Prompt Studio submissions.
  const banner =
    admin && subs.length
      ? `<div class="queue-banner"><span class="queue-dot">${subs.length}</span> <b>${subs.length} submission${subs.length === 1 ? "" : "s"} waiting for review</b> <span class="muted">· visible only to you</span> <button type="button" class="btn btn-sm" data-open-queue>Open queue</button></div>`
      : "";
  view.innerHTML = banner + controlsHTML() + body;
  view.querySelector("[data-open-queue]")?.addEventListener("click", openQueue);

  view.querySelectorAll("[data-pview]").forEach((b) =>
    b.addEventListener("click", () => {
      viewMode = b.dataset.pview === "grid" ? "grid" : "list";
      setPromptView(viewMode);
      render();
    })
  );
  const catSel = view.querySelector("#pCatFilter");
  if (catSel) catSel.addEventListener("change", (e) => { activeCategory = e.target.value; render(); });
  const tagSel = view.querySelector("#pTagFilter");
  if (tagSel) tagSel.addEventListener("change", (e) => { activeTag = e.target.value; render(); });
  const ratingSel = view.querySelector("#pRatingFilter");
  if (ratingSel) ratingSel.addEventListener("change", (e) => { minRating = e.target.value; render(); });
  const sortSel = view.querySelector("#pSort");
  if (sortSel) sortSel.addEventListener("change", (e) => { sort = e.target.value; render(); });
  const favBtn = view.querySelector("#pFav");
  if (favBtn) favBtn.addEventListener("click", () => { favOnly = !favOnly; render(); });

  view.querySelectorAll("[data-use]").forEach((b) => b.addEventListener("click", () => openUse(byId(b.dataset.use))));
  view.querySelectorAll("[data-results]").forEach((b) => b.addEventListener("click", () => openResults(byId(b.dataset.results))));
  view.querySelectorAll("[data-link]").forEach((b) =>
    b.addEventListener("click", () => copyText(promptLink(b.dataset.link), "Link copied"))
  );
  view.querySelectorAll("[data-fav]").forEach((b) =>
    b.addEventListener("click", () => {
      togglePromptFavorite(b.dataset.fav);
      render();
    })
  );
  // Clicking anywhere on a card (except its buttons/links) opens the detail view.
  view.querySelectorAll(".prompt-card").forEach((card) => {
    const open = () => {
      const p = byId(card.dataset.id);
      if (p) openPromptDetail(p);
    };
    card.addEventListener("click", (e) => {
      if (e.target.closest("button, a")) return;
      open();
    });
    card.addEventListener("keydown", (e) => {
      if ((e.key === "Enter" || e.key === " ") && e.target === card) {
        e.preventDefault();
        open();
      }
    });
  });
  view.querySelectorAll("[data-edit]").forEach((b) => b.addEventListener("click", () => openForm(byId(b.dataset.edit))));
  view.querySelectorAll("[data-del]").forEach((b) =>
    b.addEventListener("click", async () => {
      const p = byId(b.dataset.del);
      if (!confirm(`Delete prompt "${p.title}"?`)) return;
      try {
        await api.deletePromptApi(p.id);
        toast("Deleted");
        await refresh();
      } catch (e) {
        toast(e.message);
      }
    })
  );
}

// ---------- prompt detail (click a card) ----------
function openPromptDetail(p) {
  const admin = adminState().admin;
  const fav = isPromptFavorite(p.id);
  const models = (p.models || []).map((m) => `<span class="badge">${escapeHtml(m)}</span>`).join("");
  const tags = (p.tags || []).map((t) => `<span class="badge">${escapeHtml(t)}</span>`).join("");
  const nResults = (p.results || []).length;
  // Images from the saved outputs, surfaced right on the detail view — for
  // image-generation prompts they ARE the example.
  const exampleImgs = (p.results || []).flatMap((r) => r.images || []).slice(0, 12);
  const exampleHTML = exampleImgs.length
    ? `<div class="pd-section"><span class="detail-label">Example images</span><div class="thumb-grid">${exampleImgs
        .map(
          (u, i) =>
            `<div class="thumb"><img src="${escapeHtml(u)}" alt="Example image ${i + 1}" data-pd-img="${i}" loading="lazy" /></div>`
        )
        .join("")}</div></div>`
    : "";
  refs.detailBody.innerHTML = `
    <div class="modal-head">
      <h2 id="pdTitle">${escapeHtml(p.title)}</h2>
      <div class="detail-head-actions">
        <button type="button" class="btn btn-icon fav ${fav ? "on" : ""}" data-pd-fav aria-pressed="${fav}" title="${fav ? "Remove from favorites" : "Add to favorites"}">${fav ? "★" : "☆"}</button>
        <button type="button" class="btn" data-pd-link title="Copy a shareable link">Copy link</button>
        <button type="button" class="btn btn-icon" data-close aria-label="Close">✕</button>
      </div>
    </div>
    <div class="card-category">${ratingHTML(p.rating)}${p.rating ? " · " : ""}${escapeHtml(p.category)}${p.credit ? ` · Submitted by ${escapeHtml(p.credit)}` : ""}</div>
    ${p.updated ? `<div class="card-updated">Last updated ${escapeHtml(formatUpdated(p.updated))}</div>` : ""}
    ${models || tags ? `<div class="badges pd-badges">${models}${tags}</div>` : ""}
    ${p.notes ? `<div class="pd-section"><span class="detail-label">Notes</span><p class="pd-notes">${escapeHtml(p.notes)}</p></div>` : ""}
    ${exampleHTML}
    <div class="prompt-block">
      <div class="prompt-head"><span>Prompt</span><button type="button" class="btn btn-sm" data-pd-copy>Copy</button></div>
      <pre class="prompt-text pd-text">${escapeHtml(p.body)}</pre>
    </div>
    <div class="pd-actions">
      <button type="button" class="btn btn-primary" data-pd-use>Customize &amp; copy</button>
      ${nResults ? `<button type="button" class="btn" data-pd-results>Saved outputs (${nResults})</button>` : ""}
      ${admin ? `<button type="button" class="btn" data-pd-edit>Edit</button>` : ""}
      ${admin && p._seed ? `<button type="button" class="btn" data-pd-revert title="Discard your edits; the original seed returns">Reset to original</button>` : ""}
      ${admin ? `<button type="button" class="btn btn-ghost btn-danger" data-pd-del>Delete</button>` : ""}
    </div>`;

  const q = (sel) => refs.detailBody.querySelector(sel);
  refs.detailBody.querySelectorAll("[data-pd-img]").forEach((img) =>
    img.addEventListener("click", () => openLightbox(exampleImgs[Number(img.dataset.pdImg)], img.alt))
  );
  q("[data-pd-fav]").onclick = (e) => {
    togglePromptFavorite(p.id);
    const on = isPromptFavorite(p.id);
    e.currentTarget.classList.toggle("on", on);
    e.currentTarget.textContent = on ? "★" : "☆";
    e.currentTarget.setAttribute("aria-pressed", String(on));
    render();
  };
  q("[data-pd-link]").onclick = () => copyText(promptLink(p.id), "Link copied");
  q("[data-pd-copy]").onclick = () => copyText(p.body, "Prompt copied");
  q("[data-pd-use]").onclick = () => {
    closeModal(refs.detailModal);
    openUse(p);
  };
  q("[data-pd-results]")?.addEventListener("click", () => {
    closeModal(refs.detailModal);
    openResults(p);
  });
  q("[data-pd-edit]")?.addEventListener("click", () => {
    closeModal(refs.detailModal);
    openForm(p);
  });
  q("[data-pd-revert]")?.addEventListener("click", async () => {
    if (!confirm(`Reset "${p.title}" to its original version? Your edits are discarded.`)) return;
    try {
      await api.revertPrompt(p.id);
      closeModal(refs.detailModal);
      toast("Reset to original");
      await refresh();
    } catch (e) {
      toast(e.message);
    }
  });
  q("[data-pd-del]")?.addEventListener("click", async () => {
    if (!confirm(`Delete prompt "${p.title}"?`)) return;
    try {
      await api.deletePromptApi(p.id);
      closeModal(refs.detailModal);
      toast("Deleted");
      await refresh();
    } catch (e) {
      toast(e.message);
    }
  });

  openModal(refs.detailModal);
}

// ---------- review queue (admin): Prompt Studio submissions ----------
async function loadSubs() {
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

function verdictChips(s) {
  const v = s.verdict || {};
  const chips = [];
  if (v.quality === "solid") chips.push(`<span class="chip-verdict ok">Claude: looks solid</span>`);
  else if (v.quality === "spam") chips.push(`<span class="chip-verdict bad">Claude: likely spam</span>`);
  else if (v.quality) chips.push(`<span class="chip-verdict warn">Claude: usable but thin</span>`);
  if (v.duplicateOf) chips.push(`<span class="chip-verdict warn">near-duplicate of “${escapeHtml(v.duplicateOf)}” (${v.similarity}%)</span>`);
  if (s.copied) chips.push(`<span class="chip-verdict info">copied by creator</span>`);
  return chips.join("");
}

function openQueue() {
  const bodyEl = refs.subsBody;
  bodyEl.innerHTML = subs.length
    ? subs
        .map(
          (s) => `<div class="result-item sub-card" data-sid="${escapeHtml(s.id)}">
            <div class="sub-head"><b>${escapeHtml(s.title || "Untitled")}</b>${verdictChips(s)}</div>
            <div class="muted sub-meta">via Prompt Studio · ${escapeHtml(s.category || "General")}${(s.tags || []).length ? ` · tags: ${escapeHtml(s.tags.join(", "))}` : ""}${s.credit ? ` · credit: ${escapeHtml(s.credit)}` : ""}${s.at ? ` · ${escapeHtml(new Date(s.at).toLocaleString())}` : ""} · ${escapeHtml(s.id)}</div>
            <pre class="prompt-preview">${escapeHtml(s.body || "")}</pre>
            ${s.verdict?.note ? `<p class="field-help">🤖 ${escapeHtml(s.verdict.note)}</p>` : ""}
            <div class="pd-actions" style="justify-content:flex-start">
              <button type="button" class="btn btn-sm btn-primary" data-sapprove="${escapeHtml(s.id)}">✓ Approve</button>
              <button type="button" class="btn btn-sm" data-sedit="${escapeHtml(s.id)}">Edit &amp; approve</button>
              <button type="button" class="btn btn-sm btn-ghost btn-danger" data-sreject="${escapeHtml(s.id)}">Reject</button>
            </div>
          </div>`
        )
        .join("")
    : `<p class="field-help">The queue is empty.</p>`;

  bodyEl.querySelectorAll("[data-sapprove]").forEach((b) =>
    b.addEventListener("click", async () => {
      try {
        await api.submissionAction({ action: "approve", id: b.dataset.sapprove });
        toast("Published to the library ✓");
        await loadSubs();
        openQueue();
        await refresh();
      } catch (e) {
        toast(e.message);
      }
    })
  );
  bodyEl.querySelectorAll("[data-sedit]").forEach((b) =>
    b.addEventListener("click", () => {
      const s = subs.find((x) => x.id === b.dataset.sedit);
      if (!s) return;
      closeModal(refs.subsModal);
      openForm({ title: s.title, category: s.category, tags: s.tags, body: s.body, credit: s.credit });
      approveId = s.id;
      refs.modalTitle.textContent = "Edit & approve submission";
    })
  );
  bodyEl.querySelectorAll("[data-sreject]").forEach((b) =>
    b.addEventListener("click", async () => {
      if (!confirm("Reject this submission? It moves to the trash (restorable).")) return;
      try {
        await api.submissionAction({ action: "reject", id: b.dataset.sreject });
        toast("Rejected");
        await loadSubs();
        openQueue();
        render();
      } catch (e) {
        toast(e.message);
      }
    })
  );
  openModal(refs.subsModal);
}

// ---------- Prompt Studio (public): draft -> improve -> copy ----------
function resetStudio() {
  studio.id = null;
  studio.left = 2;
  studio.body = "";
  refs.stDraft.value = "";
  refs.stCredit.value = "";
  refs.stWebsite.value = "";
  refs.stResult.hidden = true;
  refs.stCopy.disabled = true;
  refs.stWork.hidden = false;
  refs.stDone.hidden = true;
  refs.stOut.hidden = true;
  refs.stImprove.disabled = false;
  refs.stLeft.textContent = "";
  refs.stStatus.textContent =
    "Prompts created here are saved to the site owner's private review queue and may be published to the library.";
  refs.stStatus.classList.remove("error");
}

// The daily allowance is gone: show the disclaimer and lock the improver.
function studioOutOfTokens() {
  refs.stOut.hidden = false;
  refs.stImprove.disabled = true;
  refs.stStatus.textContent = "Out of AI improvements for today — the Studio resets at midnight UTC.";
  refs.stStatus.classList.remove("error");
}

// On open, ask the server whether today's allowance is already used up so the
// disclaimer shows before the visitor types anything.
async function checkStudioOpen() {
  try {
    const res = await fetch("/api/studio", { headers: { "cache-control": "no-store" } });
    const d = await res.json();
    if (d && d.open === false && d.reason === "daily") studioOutOfTokens();
  } catch {
    /* fail open — the improve call still enforces the cap */
  }
}

async function studioImprove() {
  const draft = refs.stDraft.value.trim();
  if (draft.length < 20) {
    refs.stStatus.textContent = "Write a bit more first — at least a sentence about what the prompt should do.";
    refs.stStatus.classList.add("error");
    return;
  }
  if (studio.left <= 0) return;
  refs.stImprove.disabled = true;
  refs.stStatus.classList.remove("error");
  refs.stStatus.textContent = "Improving with Claude…";
  try {
    const out = await api.studioImprove({
      draft,
      id: studio.id || undefined,
      credit: refs.stCredit.value.trim() || undefined,
      website: refs.stWebsite.value, // honeypot
    });
    studio.id = out.id;
    studio.left--;
    studio.body = out.prompt.body;
    refs.stResult.hidden = false;
    refs.stTitle.textContent = out.prompt.title;
    refs.stBody.textContent = out.prompt.body;
    refs.stChips.innerHTML = extractVariables(out.prompt.body)
      .map((v) => `<span class="badge">{{${escapeHtml(v)}}}</span>`)
      .join("");
    refs.stChanged.textContent = `🤖 What changed: ${out.prompt.whatChanged}`;
    refs.stCopy.disabled = false;
    refs.stLeft.textContent = studio.left > 0 ? `${studio.left} improvement${studio.left === 1 ? "" : "s"} left for this prompt` : "No improvements left for this prompt";
    refs.stImprove.disabled = studio.left <= 0;
    refs.stStatus.textContent =
      "Prompts created here are saved to the site owner's private review queue and may be published to the library.";
  } catch (e) {
    if (/daily limit/i.test(e.message)) {
      // The cap was crossed mid-session: swap to the disclaimer state.
      studioOutOfTokens();
      return;
    }
    refs.stStatus.textContent = e.message;
    refs.stStatus.classList.add("error");
    refs.stImprove.disabled = false;
  }
}

function studioCopy() {
  if (!studio.body) return;
  copyText(studio.body, "Prompt copied");
  api.studioCopied({ id: studio.id, credit: refs.stCredit.value.trim() || undefined });
  refs.stWork.hidden = true;
  refs.stDone.hidden = false;
  refs.stRef.textContent = `Reference: ${studio.id || ""}`;
}

// ---------- customize & copy ----------
function countWords(s) {
  const t = s.trim();
  return t ? t.split(/\s+/).length : 0;
}

function openUse(p) {
  const vars = extractVariables(p.body);
  refs.useTitle.textContent = p.title;
  refs.useVars.innerHTML = vars.length
    ? `<div class="field-label">Fill in</div>` +
      vars
        .map(
          (v) =>
            `<label class="field"><span class="field-label">${escapeHtml(v)}</span><input class="input" data-uvar="${escapeHtml(v)}" /></label>`
        )
        .join("")
    : "";

  // Assemble the final prompt text from the current variable + knob values.
  const compute = () => {
    const values = {};
    refs.useVars.querySelectorAll("[data-uvar]").forEach((i) => (values[i.dataset.uvar] = i.value));
    const lengthInstr = (KNOBS.length.find((l) => l[0] === refs.useLength.value) || ["", ""])[1];
    return augment(applyVariables(p.body, values), {
      tone: refs.useTone.value,
      audience: refs.useAudience.value,
      length: lengthInstr,
      format: refs.useFormat.value,
    });
  };
  const refresh = () => {
    const text = compute();
    refs.usePreview.textContent = text;
    refs.useCount.textContent = `${countWords(text).toLocaleString()} words · ${text.length.toLocaleString()} chars`;
    // Keep the tool links pointing at the current text so ChatGPT/Claude open
    // with the prompt already filled in.
    refs.useModal.querySelectorAll("[data-open-tool]").forEach((a) => {
      a.href = toolHref(a.dataset.openTool, text) || a.href;
    });
  };

  // Live-update the preview as the user edits variables or knobs.
  [refs.useTone, refs.useAudience, refs.useLength, refs.useFormat].forEach((s) => (s.onchange = refresh));
  refs.useVars.querySelectorAll("[data-uvar]").forEach((i) => (i.oninput = refresh));

  refs.useCopy.onclick = () => {
    closeModal(refs.useModal);
    copyText(compute(), "Prompt copied");
  };
  // Open-in-tool: the anchor itself navigates (new tab); we just copy as a
  // safety net, since some tools can't prefill and long prompts fall back.
  refs.useModal.querySelectorAll("[data-open-tool]").forEach((a) => {
    a.onclick = () => {
      const t = TOOLS[a.dataset.openTool];
      if (!t) return;
      const prefilled = a.getAttribute("href")?.includes("?q=");
      copyText(compute(), prefilled ? `Opening ${t.name} pre-filled (copied too)` : `Copied — paste into ${t.name}`);
    };
  });

  refresh();
  openModal(refs.useModal);
}

// ---------- saved outputs viewer ----------
// Thumbnails for the images attached to a saved output (form list + viewer).
function resultImagesHTML(r, ri) {
  const imgs = r.images || [];
  if (!imgs.length) return "";
  return `<div class="thumb-grid">${imgs
    .map(
      (u, i) =>
        `<div class="thumb"><img src="${escapeHtml(u)}" alt="Example image ${i + 1}" data-rimg="${ri}:${i}" loading="lazy" /></div>`
    )
    .join("")}</div>`;
}

// Click a saved-output thumbnail to view it full size.
function wireResultImageZoom(rootEl, results) {
  rootEl.querySelectorAll("[data-rimg]").forEach((img) =>
    img.addEventListener("click", () => {
      const [ri, ii] = img.dataset.rimg.split(":").map(Number);
      const u = results[ri]?.images?.[ii];
      if (u) openLightbox(u, img.alt);
    })
  );
}

// Download links for the documents attached to a saved output.
function resultFilesHTML(r) {
  const files = r.files || [];
  if (!files.length) return "";
  return `<div class="file-links">${files
    .map(
      (f) =>
        `<a class="badge file-link" href="${escapeHtml(f.url)}" target="_blank" rel="noopener">📎 ${escapeHtml(f.name || "file")}</a>`
    )
    .join("")}</div>`;
}

// A saved output's text, rendered as rich text (Markdown subset).
function resultOutputHTML(r) {
  return r.output ? `<div class="md-body">${renderMarkdown(r.output)}</div>` : "";
}

function openResults(p) {
  refs.resTitle.textContent = `Saved outputs — ${p.title}`;
  refs.resBody.innerHTML = (p.results || [])
    .map(
      (r, i) =>
        `<div class="result-item">
           <div class="result-head"><span class="badge">${escapeHtml(r.model || "unknown model")}</span>
             ${r.at ? `<span class="muted">${escapeHtml(new Date(r.at).toLocaleDateString())}</span>` : ""}
             ${r.output ? `<button type="button" class="btn btn-sm" data-rcopy="${i}">Copy</button>` : ""}</div>
           ${resultImagesHTML(r, i)}
           ${resultFilesHTML(r)}
           ${resultOutputHTML(r)}
         </div>`
    )
    .join("");
  wireResultImageZoom(refs.resBody, p.results || []);
  refs.resBody.querySelectorAll("[data-rcopy]").forEach((b) =>
    b.addEventListener("click", () => copyText(p.results[Number(b.dataset.rcopy)].output, "Output copied"))
  );
  openModal(refs.resModal);
}

// ---------- create / edit form (admin) ----------
function renderFormResults() {
  refs.results.innerHTML = formResults.length
    ? formResults
        .map(
          (r, i) =>
            `<div class="result-item">
               <div class="result-head"><span class="badge">${escapeHtml(r.model || "unknown model")}</span>
                 <button type="button" class="btn btn-sm btn-ghost btn-danger" data-rdel="${i}">Remove</button></div>
               ${resultImagesHTML(r, i)}
               ${resultFilesHTML(r)}
               ${resultOutputHTML(r)}
             </div>`
        )
        .join("")
    : `<p class="field-help">No saved outputs yet.</p>`;
  wireResultImageZoom(refs.results, formResults);
  refs.results.querySelectorAll("[data-rdel]").forEach((b) =>
    b.addEventListener("click", () => {
      formResults.splice(Number(b.dataset.rdel), 1);
      renderFormResults();
    })
  );
}

// ---------- images attached to the output being composed ----------
function renderPendingImages() {
  refs.resultImages.innerHTML = formResultImages
    .map(
      (url, i) =>
        `<div class="thumb"><img src="${escapeHtml(url)}" alt="Attached image ${i + 1}" data-iview="${i}" />` +
        `<button type="button" class="thumb-remove" data-idel="${i}" aria-label="Remove image" title="Remove">✕</button></div>`
    )
    .join("");
  refs.resultImages.querySelectorAll("[data-iview]").forEach((img) =>
    img.addEventListener("click", () => openLightbox(formResultImages[Number(img.dataset.iview)], img.alt))
  );
  refs.resultImages.querySelectorAll("[data-idel]").forEach((b) =>
    b.addEventListener("click", () => {
      formResultImages.splice(Number(b.dataset.idel), 1);
      renderPendingImages();
    })
  );
}

// Downscale in the browser, upload to /uploads (admin-only endpoint shared
// with the style creator), and queue the returned URLs for "+ Add output".
async function attachResultImages(fileList) {
  const files = [...(fileList || [])].filter((f) => f.type.startsWith("image/"));
  if (!files.length) return;
  refs.resultImgStatus.classList.remove("error");
  let done = 0;
  for (const file of files) {
    refs.resultImgStatus.textContent = `Uploading ${done + 1}/${files.length}…`;
    try {
      const dataUrl = await downscaleImage(file, 1400, 0.82);
      const { url } = await api.uploadImage(dataUrl, file.name);
      formResultImages.push(url);
      renderPendingImages();
      done++;
    } catch (err) {
      refs.resultImgStatus.textContent = err.message;
      refs.resultImgStatus.classList.add("error");
      return;
    }
  }
  refs.resultImgStatus.textContent = `${done} image${done === 1 ? "" : "s"} attached — “+ Add output” saves them to this prompt`;
  refs.resultFile.value = "";
}

// Documents queued for the next "+ Add output", as removable chips.
function renderPendingFiles() {
  refs.resultFiles.innerHTML = formResultFiles
    .map(
      (f, i) =>
        `<span class="token">📎 ${escapeHtml(f.name)}<button type="button" class="token-x" data-fdel="${i}" aria-label="Remove ${escapeHtml(f.name)}">✕</button></span>`
    )
    .join("");
  refs.resultFiles.querySelectorAll("[data-fdel]").forEach((b) =>
    b.addEventListener("click", () => {
      formResultFiles.splice(Number(b.dataset.fdel), 1);
      renderPendingFiles();
    })
  );
}

// Upload documents (raw bytes, no downscale) and queue them for "+ Add output".
async function attachResultDocs(fileList) {
  const files = [...(fileList || [])];
  if (!files.length) return;
  refs.resultImgStatus.classList.remove("error");
  let done = 0;
  for (const file of files) {
    refs.resultImgStatus.textContent = `Uploading ${done + 1}/${files.length}…`;
    try {
      const { url, name } = await api.uploadFile(file);
      formResultFiles.push({ url, name: name || file.name });
      renderPendingFiles();
      done++;
    } catch (err) {
      refs.resultImgStatus.textContent = err.message;
      refs.resultImgStatus.classList.add("error");
      return;
    }
  }
  refs.resultImgStatus.textContent = `${done} document${done === 1 ? "" : "s"} attached — “+ Add output” saves them to this prompt`;
  refs.resultDoc.value = "";
}

function setStatus(m, isErr = false) {
  refs.status.textContent = m;
  refs.status.classList.toggle("error", isErr);
}

// ---------- rating picker (admin form) ----------
function renderRatingPicker() {
  refs.rating.innerHTML =
    [1, 2, 3, 4, 5]
      .map(
        (n) =>
          `<button type="button" class="rate-star ${n <= formRating ? "on" : ""}" data-rate="${n}" aria-pressed="${n <= formRating}" aria-label="${n} star${n > 1 ? "s" : ""}">★</button>`
      )
      .join("") +
    (formRating ? `<button type="button" class="btn btn-sm btn-ghost" data-rate="0">Clear</button>` : `<span class="field-help">Not rated</span>`);
  refs.rating.querySelectorAll("[data-rate]").forEach((b) =>
    b.addEventListener("click", () => {
      formRating = Number(b.dataset.rate);
      renderRatingPicker();
    })
  );
}

// ---------- model pickers (dropdown + chips) ----------
function renderModelChips() {
  refs.modelChips.innerHTML = formModels.length
    ? formModels
        .map(
          (m, i) =>
            `<span class="token">${escapeHtml(m)}<button type="button" class="token-x" data-mdel="${i}" aria-label="Remove ${escapeHtml(m)}">✕</button></span>`
        )
        .join("")
    : `<span class="field-help">No models added yet.</span>`;
  refs.modelChips.querySelectorAll("[data-mdel]").forEach((b) =>
    b.addEventListener("click", () => {
      formModels.splice(Number(b.dataset.mdel), 1);
      renderModelChips();
      fillModelPick();
    })
  );
}

// Populate the "add a model" dropdown with everything not already attached.
function fillModelPick() {
  const taken = new Set(formModels.map((m) => m.toLowerCase()));
  const avail = allModels().filter((m) => !taken.has(m.toLowerCase()));
  refs.modelPick.innerHTML =
    `<option value="">Add a model…</option>` +
    avail.map((m) => `<option value="${escapeHtml(m)}">${escapeHtml(m)}</option>`).join("");
}

function addModel(name) {
  const m = String(name || "").trim();
  if (!m) return;
  if (!formModels.some((s) => s.toLowerCase() === m.toLowerCase())) formModels.push(m);
  renderModelChips();
  fillModelPick();
}

// Populate the saved-output "Model used" dropdown (single choice + custom).
function fillResultModel() {
  refs.resultModel.innerHTML =
    `<option value="">Model used…</option>` +
    allModels().map((m) => `<option value="${escapeHtml(m)}">${escapeHtml(m)}</option>`).join("") +
    `<option value="__other__">➕ Other…</option>`;
  refs.resultModelOther.hidden = true;
  refs.resultModelOther.value = "";
}

function openForm(p) {
  editId = p?.id || null;
  approveId = null; // only the Edit & approve path re-sets this after calling
  refs.modalTitle.textContent = p ? "Edit prompt" : "New prompt";
  refs.title.value = p?.title || "";
  refs.category.value = p?.category || "";
  // Category picker: every known category (incl. the always-on base ones)
  // as datalist suggestions; free text still works for brand-new categories.
  refs.categoryList.innerHTML = allCategories()
    .map(([c]) => `<option value="${escapeHtml(c)}"></option>`)
    .join("");
  refs.tags.value = (p?.tags || []).join(", ");
  refs.credit.value = p?.credit || "";
  refs.body.value = p?.body || "";
  refs.notes.value = p?.notes || "";
  refs.nl.value = "";
  formRating = p?.rating || 0;
  renderRatingPicker();
  formModels = (p?.models || []).slice();
  renderModelChips();
  fillModelPick();
  refs.modelNew.value = "";
  formResults = (p?.results || []).map((r) => ({ ...r }));
  fillResultModel();
  refs.resultOutput.value = "";
  // Image/document attach needs the uploads disk (same gate as the style creator).
  refs.resultImgRow.hidden = !adminState().uploadEnabled;
  formResultImages = [];
  renderPendingImages();
  formResultFiles = [];
  renderPendingFiles();
  refs.resultImgStatus.textContent = "";
  refs.resultFile.value = "";
  refs.resultDoc.value = "";
  renderFormResults();
  setStatus("");
  openModal(refs.modal);
}

function addFormResult() {
  const output = refs.resultOutput.value.trim();
  const images = formResultImages.slice();
  const files = formResultFiles.slice();
  if (!output && !images.length && !files.length) {
    setStatus("Paste the output or attach an image/document before adding it.", true);
    return;
  }
  const model =
    refs.resultModel.value === "__other__" ? refs.resultModelOther.value.trim() : refs.resultModel.value;
  const rec = { model, output, at: new Date().toISOString() };
  if (images.length) rec.images = images;
  if (files.length) rec.files = files;
  formResults.unshift(rec);
  fillResultModel();
  refs.resultOutput.value = "";
  formResultImages = [];
  renderPendingImages();
  formResultFiles = [];
  renderPendingFiles();
  refs.resultImgStatus.textContent = "";
  setStatus("");
  renderFormResults();
}

async function onGenerate() {
  const d = refs.nl.value.trim();
  if (!d) {
    setStatus("Describe the prompt first.", true);
    return;
  }
  refs.gen.disabled = true;
  setStatus("Drafting with Claude Opus 4.8…");
  try {
    const { prompt } = await api.generatePrompt({ description: d, model: "claude-opus-4-8" });
    refs.title.value = prompt.title;
    refs.category.value = prompt.category;
    formModels = (prompt.models || []).slice();
    renderModelChips();
    fillModelPick();
    refs.tags.value = (prompt.tags || []).join(", ");
    refs.body.value = prompt.body;
    refs.notes.value = prompt.notes || "";
    setStatus("Draft generated — review and Save.");
  } catch (e) {
    setStatus(e.message, true);
  } finally {
    refs.gen.disabled = false;
  }
}

async function onSave() {
  const prompt = {
    title: refs.title.value.trim(),
    category: refs.category.value.trim(),
    models: formModels,
    tags: refs.tags.value,
    body: refs.body.value.trim(),
    notes: refs.notes.value.trim(),
    results: formResults,
    rating: formRating,
    credit: refs.credit.value.trim(),
  };
  if (!prompt.title || !prompt.body) {
    setStatus("Title and body are required.", true);
    return;
  }
  refs.save.disabled = true;
  setStatus("Saving…");
  try {
    if (approveId) {
      // Edit & approve: publish the submission with the edited fields.
      await api.submissionAction({ action: "approve", id: approveId, prompt });
      approveId = null;
      await loadSubs();
      toast("Published to the library ✓");
    } else {
      await api.savePrompt({ id: editId || undefined, prompt });
      toast("Saved ✓");
    }
    closeModal(refs.modal);
    await refresh();
  } catch (e) {
    setStatus(e.message, true);
  } finally {
    refs.save.disabled = false;
  }
}

async function ensureLoaded() {
  if (loaded) return;
  list = (await api.getPrompts()).prompts || [];
  loaded = true;
}
async function refresh() {
  list = (await api.getPrompts()).prompts || [];
  loaded = true;
  await loadSubs();
  render();
}

function fillKnob(sel, options) {
  sel.innerHTML = options
    .map((o) => {
      const val = Array.isArray(o) ? o[0] : o;
      return `<option value="${escapeHtml(val)}">${escapeHtml(val || "—")}</option>`;
    })
    .join("");
}

export function initPrompts() {
  view = document.getElementById("promptsView");
  viewMode = getPromptView();
  const el = (id) => document.getElementById(id);
  refs = {
    modal: el("promptModal"),
    modalTitle: el("pModalTitle"),
    title: el("pTitle"),
    category: el("pCategory"),
    categoryList: el("pCategoryList"),
    tags: el("pTags"),
    rating: el("pRating"),
    credit: el("pCredit"),
    body: el("pBody"),
    notes: el("pNotes"),
    // review queue (admin)
    subsModal: el("subsModal"),
    subsBody: el("subsBody"),
    // Prompt Studio (public)
    studioBtn: el("studioBtn"),
    studioModal: el("studioModal"),
    stWork: el("stWork"),
    stDone: el("stDone"),
    stDraft: el("stDraft"),
    stWebsite: el("stWebsite"),
    stImprove: el("stImprove"),
    stLeft: el("stLeft"),
    stResult: el("stResult"),
    stTitle: el("stTitle"),
    stBody: el("stBody"),
    stChips: el("stChips"),
    stChanged: el("stChanged"),
    stCredit: el("stCredit"),
    stCopy: el("stCopy"),
    stStatus: el("stStatus"),
    stRef: el("stRef"),
    stAgain: el("stAgain"),
    stOut: el("stOut"),
    nl: el("pNl"),
    gen: el("pGenerate"),
    save: el("pSave"),
    status: el("pStatus"),
    newBtn: el("newPromptBtn"),
    // models picker (chips + dropdown + custom)
    modelChips: el("pModelChips"),
    modelPick: el("pModelPick"),
    modelNew: el("pModelNew"),
    modelAdd: el("pModelAdd"),
    results: el("pResults"),
    resultModel: el("pResultModel"),
    resultModelOther: el("pResultModelOther"),
    resultOutput: el("pResultOutput"),
    resultAdd: el("pResultAdd"),
    // saved-output image / document attachments
    resultImgRow: el("pResultImgRow"),
    resultImages: el("pResultImages"),
    resultFile: el("pResultFile"),
    resultAttach: el("pResultAttach"),
    resultDoc: el("pResultDoc"),
    resultDocBtn: el("pResultDocBtn"),
    resultFiles: el("pResultFiles"),
    resultImgStatus: el("pResultImgStatus"),
    // use (customize & copy) modal
    useModal: el("promptUseModal"),
    useTitle: el("puTitle"),
    useVars: el("puVars"),
    useTone: el("puTone"),
    useAudience: el("puAudience"),
    useLength: el("puLength"),
    useFormat: el("puFormat"),
    useCopy: el("puCopy"),
    usePreview: el("puPreview"),
    useCount: el("puCount"),
    // results viewer modal
    resModal: el("promptResultsModal"),
    resTitle: el("prTitle"),
    resBody: el("prBody"),
    // detail modal
    detailModal: el("promptDetailModal"),
    detailBody: el("pdBody"),
  };
  wireModalDismiss(refs.modal);
  wireModalDismiss(refs.useModal);
  wireModalDismiss(refs.resModal);
  wireModalDismiss(refs.detailModal);
  wireModalDismiss(refs.studioModal);
  wireModalDismiss(refs.subsModal);
  refs.studioBtn.addEventListener("click", () => {
    resetStudio();
    openModal(refs.studioModal);
    checkStudioOpen();
  });
  refs.stImprove.addEventListener("click", studioImprove);
  refs.stCopy.addEventListener("click", studioCopy);
  refs.stAgain.addEventListener("click", resetStudio);
  fillKnob(refs.useTone, KNOBS.tone);
  fillKnob(refs.useAudience, KNOBS.audience);
  fillKnob(refs.useLength, KNOBS.length);
  fillKnob(refs.useFormat, KNOBS.format);
  refs.newBtn.addEventListener("click", () => openForm());
  refs.gen.addEventListener("click", onGenerate);
  refs.save.addEventListener("click", onSave);
  refs.resultAdd.addEventListener("click", addFormResult);
  refs.resultAttach.addEventListener("click", () => refs.resultFile.click());
  refs.resultFile.addEventListener("change", (e) => attachResultImages(e.target.files));
  refs.resultDocBtn.addEventListener("click", () => refs.resultDoc.click());
  refs.resultDoc.addEventListener("change", (e) => attachResultDocs(e.target.files));

  // Models picker: pick from the dropdown, or type a new one and Add / Enter.
  refs.modelPick.addEventListener("change", (e) => {
    if (e.target.value) addModel(e.target.value);
  });
  refs.modelAdd.addEventListener("click", () => {
    addModel(refs.modelNew.value);
    refs.modelNew.value = "";
  });
  refs.modelNew.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      addModel(refs.modelNew.value);
      refs.modelNew.value = "";
    }
  });
  // Saved-output model: reveal the custom field when "Other…" is chosen.
  refs.resultModel.addEventListener("change", (e) => {
    const other = e.target.value === "__other__";
    refs.resultModelOther.hidden = !other;
    if (other) refs.resultModelOther.focus();
  });

  return {
    show: async () => {
      await ensureLoaded();
      await loadSubs();
      render();
    },
    // Re-check the queue too: admin may have just signed in.
    rerender: () => loadSubs().then(render),
    setQuery: (q) => {
      query = q;
      if (view && !view.hidden) render();
    },
    // Deep link (?prompt=<id>): open that prompt's detail view.
    openById: async (id) => {
      await ensureLoaded();
      render();
      const p = byId(id);
      if (p) openPromptDetail(p);
      return !!p;
    },
  };
}
