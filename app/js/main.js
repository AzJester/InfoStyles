// Boot: load data, render the gallery, wire search/filter/settings/creator.
import { toImagePrompt } from "./imagePrompt.js";
import { getCustomStyles, deleteCustomStyle } from "./storage.js";
import { initCreator } from "./creator.js";
import { initSettings } from "./settings.js";

const PAGE_SIZE = 60; // cards rendered per batch (incremental rendering)

const state = {
  all: [], // CSV styles + custom styles
  filtered: [],
  rendered: 0,
  query: "",
  category: "",
};

const els = {
  gallery: document.getElementById("gallery"),
  empty: document.getElementById("empty"),
  sentinel: document.getElementById("sentinel"),
  search: document.getElementById("search"),
  categoryFilter: document.getElementById("categoryFilter"),
  resultCount: document.getElementById("resultCount"),
  toast: document.getElementById("toast"),
};

// ---------- utilities ----------
function escapeHtml(s) {
  return (s || "").replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])
  );
}

let toastTimer;
export function toast(message) {
  els.toast.textContent = message;
  els.toast.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (els.toast.hidden = true), 1600);
}

export async function copyText(text, label = "Copied") {
  try {
    await navigator.clipboard.writeText(text);
    toast(`${label} ✓`);
  } catch {
    // Fallback for non-secure contexts
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    try {
      document.execCommand("copy");
      toast(`${label} ✓`);
    } catch {
      toast("Copy failed");
    }
    ta.remove();
  }
}

// ---------- card rendering ----------
function fieldLine(label, value) {
  if (!value) return "";
  return `<p class="field-line"><dt>${label}:</dt> <dd>${escapeHtml(value)}</dd></p>`;
}

export function buildCard(style) {
  const card = document.createElement("article");
  card.className = "card";

  const swatches = (style.palette || [])
    .map(
      (hex) =>
        `<span class="swatch" style="background:${escapeHtml(
          hex
        )}" data-hex="${escapeHtml(hex)}" title="${escapeHtml(hex)} — click to copy"></span>`
    )
    .join("");

  const customBadge = style._custom
    ? `<span class="badge badge-custom">Custom</span>`
    : "";

  card.innerHTML = `
    <div class="card-head">
      <div class="card-title">${escapeHtml(style.style) || "Untitled style"}</div>
      <div class="badges">
        ${style.category ? `<span class="badge">${escapeHtml(style.category)}</span>` : ""}
        ${customBadge}
      </div>
    </div>
    ${swatches ? `<div class="swatches">${swatches}</div>` : ""}
    <dl class="fields">
      ${fieldLine("Type", style.type)}
      ${fieldLine("Layout", style.layout)}
    </dl>
    <details class="more">
      <summary>More details</summary>
      <dl class="fields">
        ${fieldLine("Icons", style.icons)}
        ${fieldLine("Charts", style.charts)}
        ${fieldLine("Background", style.background)}
        ${fieldLine("Avoid", style.avoid)}
      </dl>
    </details>
    <div class="card-actions"></div>
  `;

  // swatch click-to-copy
  card.querySelectorAll(".swatch").forEach((sw) => {
    sw.addEventListener("click", () => copyText(sw.dataset.hex, sw.dataset.hex));
  });

  const actions = card.querySelector(".card-actions");

  if (style.notebookLMPrompt) {
    const b = document.createElement("button");
    b.className = "btn btn-sm";
    b.textContent = "Copy NotebookLM prompt";
    b.addEventListener("click", () => copyText(style.notebookLMPrompt, "NotebookLM prompt copied"));
    actions.appendChild(b);
  }

  const imgBtn = document.createElement("button");
  imgBtn.className = "btn btn-sm btn-primary";
  imgBtn.textContent = "Copy OpenAI image prompt";
  imgBtn.addEventListener("click", () => copyText(toImagePrompt(style), "Image prompt copied"));
  actions.appendChild(imgBtn);

  if (style._custom) {
    const del = document.createElement("button");
    del.className = "btn btn-sm";
    del.textContent = "Delete";
    del.addEventListener("click", () => {
      deleteCustomStyle(style.id);
      toast("Deleted");
      refreshData();
    });
    actions.appendChild(del);
  }

  return card;
}

// ---------- filtering + incremental render ----------
function matches(style, q) {
  if (!q) return true;
  const hay = [
    style.style, style.category, style.type, style.icons, style.layout,
    style.charts, style.background, style.avoid, style.notebookLMPrompt,
    (style.palette || []).join(" "),
  ]
    .join(" ")
    .toLowerCase();
  return q.split(/\s+/).every((term) => hay.includes(term));
}

function applyFilters() {
  const q = state.query.trim().toLowerCase();
  state.filtered = state.all.filter(
    (s) => (!state.category || s.category === state.category) && matches(s, q)
  );
  state.rendered = 0;
  els.gallery.innerHTML = "";
  els.empty.hidden = state.filtered.length > 0;
  els.resultCount.textContent = `${state.filtered.length.toLocaleString()} styles`;
  renderMore();
}

function renderMore() {
  const next = state.filtered.slice(state.rendered, state.rendered + PAGE_SIZE);
  const frag = document.createDocumentFragment();
  next.forEach((s) => frag.appendChild(buildCard(s)));
  els.gallery.appendChild(frag);
  state.rendered += next.length;
}

// ---------- data wiring ----------
let csvStyles = [];
export function refreshData() {
  const custom = getCustomStyles().map((s) => ({ ...s, _custom: true }));
  state.all = [...custom, ...csvStyles];
  applyFilters();
}

function populateCategories(categories) {
  for (const c of categories) {
    const opt = document.createElement("option");
    opt.value = c.name;
    opt.textContent = `${c.name} (${c.count})`;
    els.categoryFilter.appendChild(opt);
  }
}

async function init() {
  const [styles, categories] = await Promise.all([
    fetch("data/styles.json").then((r) => r.json()),
    fetch("data/categories.json").then((r) => r.json()),
  ]);
  csvStyles = styles;
  populateCategories(categories);
  refreshData();

  // search (debounced)
  let t;
  els.search.addEventListener("input", (e) => {
    clearTimeout(t);
    const v = e.target.value;
    t = setTimeout(() => {
      state.query = v;
      applyFilters();
    }, 120);
  });

  els.categoryFilter.addEventListener("change", (e) => {
    state.category = e.target.value;
    applyFilters();
  });

  // infinite scroll
  const io = new IntersectionObserver(
    (entries) => {
      if (entries[0].isIntersecting && state.rendered < state.filtered.length) {
        renderMore();
      }
    },
    { rootMargin: "600px" }
  );
  io.observe(els.sentinel);

  initSettings({ toast });
  initCreator({ toast, copyText, buildCard, onSaved: refreshData });
}

init().catch((err) => {
  console.error(err);
  els.empty.hidden = false;
  els.empty.textContent = "Failed to load styles. Try a hard refresh.";
});
