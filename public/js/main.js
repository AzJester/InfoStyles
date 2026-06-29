// Boot + orchestration: load the merged catalog, render the gallery, and wire
// search / filters / favorites / theme / admin / creator / detail.
import { loadCatalog, getStyles, getCategories, kindOf } from "./catalog.js";
import { buildCard } from "./card.js";
import { initCreator } from "./creator.js";
import { initAdmin, adminState } from "./admin.js";
import { isFavorite, favoriteCount, getTheme, setTheme } from "./storage.js";
import { toast, openModal, wireModalDismiss, closeModal } from "./ui.js";

const PAGE_SIZE = 60;

const state = { query: "", category: "", favOnly: false, color: "", filtered: [], rendered: 0 };

const els = {
  gallery: document.getElementById("gallery"),
  empty: document.getElementById("empty"),
  sentinel: document.getElementById("sentinel"),
  search: document.getElementById("search"),
  category: document.getElementById("categoryFilter"),
  resultCount: document.getElementById("resultCount"),
  favFilter: document.getElementById("favFilter"),
  colorFilter: document.getElementById("colorFilter"),
  colorClear: document.getElementById("colorClear"),
  newStyleBtn: document.getElementById("newStyleBtn"),
  themeBtn: document.getElementById("themeBtn"),
};

let creator;

// ---------- theme ----------
function applyTheme(theme) {
  document.documentElement.dataset.theme = theme;
  if (els.themeBtn) {
    els.themeBtn.textContent = theme === "dark" ? "☀" : "☾";
    els.themeBtn.setAttribute("aria-label", theme === "dark" ? "Switch to light theme" : "Switch to dark theme");
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
  imageEnabled: () => adminState().imageEnabled,
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
  afterChange: () => reloadAndRender(),
  afterSave: () => reloadAndRender(),
};

function applyFilters() {
  const q = state.query.trim().toLowerCase();
  state.filtered = getStyles().filter(
    (s) =>
      (!state.category || s.category === state.category) &&
      (!state.favOnly || isFavorite(s.id)) &&
      (!state.color || paletteHasColor(s.palette, state.color)) &&
      matches(s, q)
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
  for (const s of next) frag.appendChild(buildCard(s, ctx, state.query));
  els.gallery.appendChild(frag);
  state.rendered += next.length;
}

async function reloadAndRender() {
  await loadCatalog();
  buildCategoryOptions();
  applyFilters();
}

// ---------- boot ----------
async function init() {
  applyTheme(getTheme());

  await loadCatalog();
  buildCategoryOptions();
  applyFilters();

  creator = initCreator(ctx);

  await initAdmin({
    onChange: () => {
      els.newStyleBtn.hidden = !adminState().admin;
    },
  });

  let t;
  els.search.addEventListener("input", (e) => {
    clearTimeout(t);
    const v = e.target.value;
    t = setTimeout(() => {
      state.query = v;
      applyFilters();
    }, 120);
  });

  els.category.addEventListener("change", (e) => {
    state.category = e.target.value;
    applyFilters();
  });

  els.favFilter.addEventListener("click", () => {
    state.favOnly = !state.favOnly;
    els.favFilter.classList.toggle("active", state.favOnly);
    els.favFilter.setAttribute("aria-pressed", String(state.favOnly));
    els.favFilter.textContent = state.favOnly ? `★ Favorites (${favoriteCount()})` : "☆ Favorites";
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

  exportBtn.addEventListener("click", () => {
    const blob = new Blob([JSON.stringify(getStyles(), null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "infostyles-catalog.json";
    a.click();
    URL.revokeObjectURL(url);
    toast("Catalog exported");
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
