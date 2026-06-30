// Boot + orchestration: load the merged catalog, render the gallery, and wire
// search / filters / favorites / theme / admin / creator / detail.
import { loadCatalog, getStyles, getCategories, kindOf } from "./catalog.js";
import { buildCard, openDetail } from "./card.js";
import { initCreator } from "./creator.js";
import { initPrompts } from "./prompts.js";
import { initAdmin, adminState } from "./admin.js";
import { isFavorite, favoriteCount, getTheme, setTheme, getView, setView } from "./storage.js";
import { toast, openModal, wireModalDismiss, closeModal, escapeHtml } from "./ui.js";

const PAGE_SIZE = 60;

const state = { query: "", category: "", favOnly: false, color: "", sort: "", filtered: [], rendered: 0 };

const els = {
  gallery: document.getElementById("gallery"),
  empty: document.getElementById("empty"),
  sentinel: document.getElementById("sentinel"),
  search: document.getElementById("search"),
  category: document.getElementById("categoryFilter"),
  sortSelect: document.getElementById("sortSelect"),
  resultCount: document.getElementById("resultCount"),
  favFilter: document.getElementById("favFilter"),
  randomBtn: document.getElementById("randomBtn"),
  colorFilter: document.getElementById("colorFilter"),
  colorClear: document.getElementById("colorClear"),
  toolsBtn: document.getElementById("toolsBtn"),
  toolsPanel: document.getElementById("toolsPanel"),
  newStyleBtn: document.getElementById("newStyleBtn"),
  newPromptBtn: document.getElementById("newPromptBtn"),
  themeBtn: document.getElementById("themeBtn"),
  viewBtn: document.getElementById("viewBtn"),
  activeFilters: document.getElementById("activeFilters"),
  promptsView: document.getElementById("promptsView"),
  secStyles: document.getElementById("secStyles"),
  secPrompts: document.getElementById("secPrompts"),
  intro: document.querySelector(".intro"),
};

let creator;
let promptsUI;
let section = "styles"; // "styles" | "prompts"

// --- tools popover ---
function closeTools() {
  if (!els.toolsPanel) return;
  els.toolsPanel.hidden = true;
  els.toolsBtn.setAttribute("aria-expanded", "false");
  els.toolsBtn.classList.remove("active");
}
function toggleTools() {
  const open = els.toolsPanel.hidden;
  els.toolsPanel.hidden = !open;
  els.toolsBtn.setAttribute("aria-expanded", String(open));
  els.toolsBtn.classList.toggle("active", open);
}

// Toggle between the Styles catalog and the Prompts library.
function setSection(next) {
  section = next === "prompts" ? "prompts" : "styles";
  const isPrompts = section === "prompts";
  els.secStyles.classList.toggle("active", !isPrompts);
  els.secPrompts.classList.toggle("active", isPrompts);
  els.secStyles.setAttribute("aria-selected", String(!isPrompts));
  els.secPrompts.setAttribute("aria-selected", String(isPrompts));

  // Style-only controls + areas (sort/color/random live inside the tools popover).
  for (const el of [els.category, els.favFilter, els.viewBtn, els.toolsBtn, els.gallery, els.sentinel, els.activeFilters]) {
    if (el) el.hidden = isPrompts;
  }
  closeTools();
  els.empty.hidden = true;
  if (els.intro) els.intro.hidden = isPrompts; // intro is styles-specific
  els.promptsView.hidden = !isPrompts;
  els.newStyleBtn.hidden = isPrompts || !adminState().admin;
  els.newPromptBtn.hidden = !isPrompts || !adminState().admin;
  els.search.placeholder = isPrompts ? "Search prompts…   ( / )" : "Search styles…   ( / )";

  if (isPrompts) promptsUI.show();
}
let pendingStyleId = null; // ?style=<id> from the initial URL, opened after first render
let pendingPromptId = null; // ?prompt=<id> from the initial URL

// ---------- theme ----------
function applyTheme(theme) {
  document.documentElement.dataset.theme = theme;
  if (els.themeBtn) {
    els.themeBtn.textContent = theme === "dark" ? "☀" : "☾";
    els.themeBtn.setAttribute("aria-label", theme === "dark" ? "Switch to light theme" : "Switch to dark theme");
  }
}

// ---------- view (grid | list) ----------
function applyView(view) {
  const list = view === "list";
  els.gallery.classList.toggle("gallery--list", list);
  if (els.viewBtn) {
    els.viewBtn.textContent = list ? "▦" : "☰";
    const label = list ? "Switch to grid view" : "Switch to list view";
    els.viewBtn.title = label;
    els.viewBtn.setAttribute("aria-label", label);
  }
}

// ---------- color matching ----------
function hexToRgb(hex) {
  let h = hex.replace("#", "");
  if (h.length === 3) h = h.split("").map((c) => c + c).join("");
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}
function colorDistance(a, b) {
  const [r1, g1, b1] = hexToRgb(a);
  const [r2, g2, b2] = hexToRgb(b);
  return Math.sqrt((r1 - r2) ** 2 + (g1 - g2) ** 2 + (b1 - b2) ** 2);
}
function paletteHasColor(palette, target) {
  return (palette || []).some((hex) => {
    try {
      return colorDistance(hex, target) <= 60;
    } catch {
      return false;
    }
  });
}

// ---------- category select with optgroups ----------
function groupOf(name) {
  if (name.includes(" - ")) return name.split(" - ")[0];
  if (name.startsWith("*")) return "Brand";
  return "General";
}

function buildCategoryOptions() {
  const cats = getCategories();
  const total = cats.reduce((n, c) => n + c.count, 0);
  els.category.innerHTML = `<option value="">All categories (${total.toLocaleString()})</option>`;
  const groups = new Map();
  for (const c of cats) {
    const g = groupOf(c.name);
    if (!groups.has(g)) groups.set(g, []);
    groups.get(g).push(c);
  }
  for (const [g, list] of [...groups.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    const og = document.createElement("optgroup");
    og.label = g;
    for (const c of list) {
      const o = document.createElement("option");
      o.value = c.name;
      o.textContent = `${c.name} (${c.count})`;
      og.appendChild(o);
    }
    els.category.appendChild(og);
  }
  els.category.value = state.category;
}

// ---------- filtering + rendering ----------
function matches(style, q) {
  if (!q) return true;
  const hay = [
    style.style, style.category, style.type, style.icons, style.layout,
    style.charts, style.background, style.avoid, style.notebookLMPrompt,
    (style.palette || []).join(" "),
  ].join(" ").toLowerCase();
  return q.split(/\s+/).every((term) => hay.includes(term));
}

const ctx = {
  admin: () => adminState().admin,
  uploadEnabled: () => adminState().uploadEnabled,
  kindOf,
  getCategories,
  onEdit: (style) => {
    closeModal(document.getElementById("detailModal"));
    creator.openEdit(style);
  },
  onRemix: (style) => {
    closeModal(document.getElementById("detailModal"));
    creator.openRemix(style);
  },
  onDuplicate: (style) => {
    closeModal(document.getElementById("detailModal"));
    creator.openDuplicate(style);
  },
  afterChange: () => reloadAndRender(),
  afterSave: () => reloadAndRender(),
};

function sortStyles(arr) {
  if (!state.sort) return arr;
  const out = arr.slice();
  const byName = (a, b) => (a.style || "").localeCompare(b.style || "");
  if (state.sort === "name-asc") out.sort(byName);
  else if (state.sort === "name-desc") out.sort((a, b) => byName(b, a));
  else if (state.sort === "category")
    out.sort((a, b) => (a.category || "").localeCompare(b.category || "") || byName(a, b));
  return out;
}

function applyFilters() {
  const q = state.query.trim().toLowerCase();
  state.filtered = sortStyles(
    getStyles().filter(
      (s) =>
        (!state.category || s.category === state.category) &&
        (!state.favOnly || isFavorite(s.id)) &&
        (!state.color || paletteHasColor(s.palette, state.color)) &&
        matches(s, q)
    )
  );
  state.rendered = 0;
  els.gallery.innerHTML = "";
  els.empty.hidden = state.filtered.length > 0;
  els.resultCount.textContent = `${state.filtered.length.toLocaleString()} styles`;
  renderMore();
  renderActiveFilters();
  syncURL();
}

// ---------- active-filter chips ----------
function renderActiveFilters() {
  const chips = [];
  if (state.query.trim()) chips.push(["search", `“${state.query.trim()}”`]);
  if (state.category) chips.push(["category", state.category]);
  if (state.color) chips.push(["color", state.color]);
  if (state.favOnly) chips.push(["fav", "Favorites"]);
  if (!chips.length) {
    els.activeFilters.hidden = true;
    els.activeFilters.innerHTML = "";
    return;
  }
  els.activeFilters.hidden = false;
  els.activeFilters.innerHTML =
    chips
      .map(
        ([k, label]) =>
          `<button type="button" class="chip" data-clear="${k}">` +
          (k === "color" ? `<span class="chip-swatch" style="background:${escapeHtml(label)}"></span>` : "") +
          `${escapeHtml(label)} <span class="chip-x">✕</span></button>`
      )
      .join("") + `<button type="button" class="chip chip-clear" data-clear="all">Clear all</button>`;
}

function clearFilter(which) {
  if (which === "all" || which === "search") {
    state.query = "";
    els.search.value = "";
  }
  if (which === "all" || which === "category") {
    state.category = "";
    els.category.value = "";
  }
  if (which === "all" || which === "color") {
    state.color = "";
    els.colorClear.hidden = true;
    els.colorFilter.value = "#000000";
  }
  if (which === "all" || which === "fav") {
    state.favOnly = false;
    els.favFilter.classList.remove("active");
    els.favFilter.setAttribute("aria-pressed", "false");
    els.favFilter.textContent = "☆";
    els.favFilter.title = "Show favorites";
  }
  applyFilters();
}

// ---------- shareable URL state ----------
function syncURL() {
  const p = new URLSearchParams();
  if (state.query.trim()) p.set("q", state.query.trim());
  if (state.category) p.set("cat", state.category);
  if (state.color) p.set("color", state.color);
  if (state.favOnly) p.set("fav", "1");
  if (state.sort) p.set("sort", state.sort);
  if (!els.gallery.classList.contains("gallery--list")) p.set("view", "grid");
  const qs = p.toString();
  history.replaceState(null, "", qs ? `?${qs}` : location.pathname);
}

function readURLState() {
  const p = new URLSearchParams(location.search);
  state.query = p.get("q") || "";
  state.color = p.get("color") || "";
  state.favOnly = p.get("fav") === "1";
  state.sort = p.get("sort") || "";

  const cat = p.get("cat") || "";
  state.category = cat && [...els.category.options].some((o) => o.value === cat) ? cat : "";

  els.search.value = state.query;
  els.category.value = state.category;
  if (els.sortSelect) els.sortSelect.value = state.sort;
  if (state.color) {
    els.colorFilter.value = state.color;
    els.colorClear.hidden = false;
  }
  if (state.favOnly) {
    els.favFilter.classList.add("active");
    els.favFilter.setAttribute("aria-pressed", "true");
    els.favFilter.textContent = "★";
    els.favFilter.title = `Showing favorites (${favoriteCount()})`;
  }
  const v = p.get("view");
  if (v === "grid" || v === "list") applyView(v);

  // Captured before applyFilters()->syncURL() rewrites the URL and drops it.
  pendingStyleId = p.get("style") || null;
  pendingPromptId = p.get("prompt") || null;
}

function openStyleFromURL() {
  if (!pendingStyleId) return;
  const s = getStyles().find((x) => x.id === pendingStyleId);
  pendingStyleId = null;
  if (s) openDetail(s, ctx);
}

function renderMore() {
  const next = state.filtered.slice(state.rendered, state.rendered + PAGE_SIZE);
  const frag = document.createDocumentFragment();
  for (const s of next) frag.appendChild(buildCard(s, ctx, state.query));
  els.gallery.appendChild(frag);
  state.rendered += next.length;
}

// Placeholder cards shown while the catalog JSON loads.
function renderSkeletons(n = 12) {
  els.gallery.innerHTML = Array.from({ length: n }, () => `<div class="skeleton skeleton-card"></div>`).join("");
}

async function reloadAndRender() {
  await loadCatalog();
  buildCategoryOptions();
  applyFilters();
}

// ---------- boot ----------
async function init() {
  applyTheme(getTheme());
  applyView(getView());
  const fy = document.getElementById("footerYear");
  if (fy) fy.textContent = String(new Date().getFullYear());

  renderSkeletons();
  await loadCatalog();
  buildCategoryOptions();
  readURLState();
  applyFilters();
  openStyleFromURL();

  creator = initCreator(ctx);
  promptsUI = initPrompts();

  els.secStyles.addEventListener("click", () => setSection("styles"));
  els.secPrompts.addEventListener("click", () => setSection("prompts"));

  // Tools popover: toggle, close on outside click / Escape, close when a control inside is used.
  els.toolsBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    toggleTools();
  });
  els.toolsPanel.addEventListener("click", (e) => e.stopPropagation());
  document.addEventListener("click", () => closeTools());
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") closeTools();
  });
  els.randomBtn.addEventListener("click", () => closeTools());

  await initAdmin({
    onChange: () => {
      els.newStyleBtn.hidden = section === "prompts" || !adminState().admin;
      els.newPromptBtn.hidden = section !== "prompts" || !adminState().admin;
      // Re-render the active section so admin-only controls appear/disappear.
      if (section === "prompts") promptsUI.rerender();
      else applyFilters();
    },
  });

  let t;
  els.search.addEventListener("input", (e) => {
    clearTimeout(t);
    const v = e.target.value;
    t = setTimeout(() => {
      if (section === "prompts") {
        promptsUI.setQuery(v);
      } else {
        state.query = v;
        applyFilters();
      }
    }, 120);
  });

  els.category.addEventListener("change", (e) => {
    state.category = e.target.value;
    applyFilters();
  });

  els.sortSelect.addEventListener("change", (e) => {
    state.sort = e.target.value;
    applyFilters();
  });

  els.randomBtn.addEventListener("click", () => {
    const pool = state.filtered.length ? state.filtered : getStyles();
    if (!pool.length) return;
    openDetail(pool[Math.floor(Math.random() * pool.length)], ctx);
  });

  els.activeFilters.addEventListener("click", (e) => {
    const btn = e.target.closest("[data-clear]");
    if (btn) clearFilter(btn.dataset.clear);
  });

  els.favFilter.addEventListener("click", () => {
    state.favOnly = !state.favOnly;
    els.favFilter.classList.toggle("active", state.favOnly);
    els.favFilter.setAttribute("aria-pressed", String(state.favOnly));
    els.favFilter.textContent = state.favOnly ? "★" : "☆";
    els.favFilter.title = state.favOnly ? `Showing favorites (${favoriteCount()})` : "Show favorites";
    applyFilters();
  });

  els.colorFilter.addEventListener("input", (e) => {
    state.color = e.target.value;
    els.colorClear.hidden = false;
    applyFilters();
  });
  els.colorClear.addEventListener("click", () => {
    state.color = "";
    els.colorClear.hidden = true;
    els.colorFilter.value = "#000000";
    applyFilters();
  });

  els.newStyleBtn.addEventListener("click", () => creator.openCreate());

  els.themeBtn.addEventListener("click", () => {
    const next = document.documentElement.dataset.theme === "dark" ? "light" : "dark";
    setTheme(next);
    applyTheme(next);
  });

  els.viewBtn.addEventListener("click", () => {
    const next = els.gallery.classList.contains("gallery--list") ? "grid" : "list";
    setView(next);
    applyView(next);
  });

  document.addEventListener("favorites-changed", () => {
    if (state.favOnly) applyFilters();
  });

  const io = new IntersectionObserver(
    (entries) => {
      if (entries[0].isIntersecting && state.rendered < state.filtered.length) renderMore();
    },
    { rootMargin: "600px" }
  );
  io.observe(els.sentinel);

  // Arrow-key navigation across cards (cards are focusable; Enter/Space opens).
  els.gallery.addEventListener("keydown", (e) => {
    if (!["ArrowRight", "ArrowLeft", "ArrowUp", "ArrowDown"].includes(e.key)) return;
    const cards = [...els.gallery.querySelectorAll(".card")];
    const idx = cards.indexOf(document.activeElement);
    if (idx === -1) return;
    e.preventDefault();
    const fwd = e.key === "ArrowRight" || e.key === "ArrowDown";
    const next = cards[idx + (fwd ? 1 : -1)];
    if (next) next.focus();
  });

  // ?prompt=<id> deep link: jump to the Prompts section and open that prompt.
  if (pendingPromptId) {
    const id = pendingPromptId;
    pendingPromptId = null;
    setSection("prompts");
    promptsUI.openById(id);
  }

  initSettings();
}

// ---------- settings: export (all) + import (admin) ----------
function initSettings() {
  const modal = document.getElementById("settingsModal");
  const open = document.getElementById("settingsBtn");
  const exportBtn = document.getElementById("exportBtn");
  const importInput = document.getElementById("importInput");
  if (!modal) return;
  wireModalDismiss(modal);
  open.addEventListener("click", () => {
    document.getElementById("importRow").hidden = !adminState().admin;
    openModal(modal);
  });

  const download = (data, type, filename) => {
    const url = URL.createObjectURL(new Blob([data], { type }));
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  };

  exportBtn.addEventListener("click", () => {
    download(JSON.stringify(getStyles(), null, 2), "application/json", "infostyles-catalog.json");
    toast("Catalog exported (JSON)");
  });

  const exportCsvBtn = document.getElementById("exportCsvBtn");
  exportCsvBtn?.addEventListener("click", () => {
    const cell = (v) => {
      const s = String(v == null ? "" : v);
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const header = ["Category", "Style", "Palette", "Type", "Icons", "Layout", "Charts", "Background", "Avoid", "Pasteable prompt"];
    const rows = getStyles().map((s) =>
      [s.category, s.style, (s.palette || []).join(" "), s.type, s.icons, s.layout, s.charts, s.background, s.avoid, s.notebookLMPrompt]
        .map(cell)
        .join(",")
    );
    download([header.join(","), ...rows].join("\n"), "text/csv", "infostyles-catalog.csv");
    toast("Catalog exported (CSV)");
  });

  importInput?.addEventListener("change", async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    let items;
    try {
      items = JSON.parse(await file.text());
      if (!Array.isArray(items)) throw new Error("Expected a JSON array of styles.");
    } catch (err) {
      toast(`Import failed: ${err.message}`);
      return;
    }
    const { saveStyle } = await import("./api.js");
    let ok = 0;
    for (const s of items) {
      try {
        await saveStyle({ kind: "custom", style: s });
        ok++;
      } catch {
        /* skip bad rows */
      }
    }
    toast(`Imported ${ok}/${items.length} styles`);
    await reloadAndRender();
    importInput.value = "";
  });
}

init().catch((err) => {
  console.error(err);
  els.empty.hidden = false;
  els.empty.textContent = "Failed to load styles. Try a hard refresh.";
});
