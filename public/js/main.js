// Boot + orchestration: History-API routing across the four pages (Home,
// Styles, Prompts, Skills Hub), the styles gallery + filters, and shared
// chrome (search, theme, admin, command palette, settings).
import { loadCatalog, getStyles, getCategories, kindOf } from "./catalog.js";
import { buildCard, openDetail } from "./card.js";
import { initCreator } from "./creator.js";
import { initPrompts } from "./prompts.js";
import { initSkills, skillSlug } from "./skills.js";
import { initAdmin, adminState } from "./admin.js";
import { isFavorite, favoriteCount, getTheme, setTheme, getView, setView, hasSeenIntro, markIntroSeen } from "./storage.js";
import { getPrompts, getSkills } from "./api.js";
import { toast, openModal, wireModalDismiss, closeModal, escapeHtml, ICONS } from "./ui.js";

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
  newSkillBtn: document.getElementById("newSkillBtn"),
  themeBtn: document.getElementById("themeBtn"),
  viewBtn: document.getElementById("viewBtn"),
  activeFilters: document.getElementById("activeFilters"),
  homeView: document.getElementById("homeView"),
  stylesView: document.getElementById("stylesView"),
  promptsWrap: document.getElementById("promptsWrap"),
  skillsWrap: document.getElementById("skillsWrap"),
  navHome: document.getElementById("navHome"),
  navStyles: document.getElementById("navStyles"),
  navPrompts: document.getElementById("navPrompts"),
  navSkills: document.getElementById("navSkills"),
  featured: document.getElementById("featured"),
  firstRun: document.getElementById("firstRun"),
  firstRunClose: document.getElementById("firstRunClose"),
  cmdk: document.getElementById("cmdk"),
  cmdkInput: document.getElementById("cmdkInput"),
  cmdkList: document.getElementById("cmdkList"),
};

let creator;
let promptsUI;
let skillsUI;
let section = "home"; // "home" | "styles" | "prompts" | "skills"
let pendingStyleId = null; // ?style=<id>, opened after first render
let pendingPromptId = null; // ?prompt=<id>

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

// ---------- routing (History API) ----------
// Paths: /  /styles  /prompts  /skills  /skills/<slug>
function parsePath(pathname = location.pathname) {
  const p = pathname.replace(/\/+$/, "") || "/";
  if (p === "/") return { section: "home" };
  if (p === "/styles") return { section: "styles" };
  if (p === "/prompts") return { section: "prompts" };
  if (p === "/skills") return { section: "skills" };
  const m = p.match(/^\/skills\/([^/]+)$/);
  if (m) return { section: "skills", skillSlug: decodeURIComponent(m[1]) };
  return null;
}

export function navigate(path, { replace = false } = {}) {
  history[replace ? "replaceState" : "pushState"](null, "", path);
  route();
}

function route() {
  const r = parsePath() || { section: "home" };
  setSection(r.section);
  if (r.section === "skills") {
    if (r.skillSlug) skillsUI.openBySlug(r.skillSlug);
    else skillsUI.showHub();
  }
  if (r.section === "prompts") {
    const id = new URLSearchParams(location.search).get("prompt");
    if (id) promptsUI.openById(id);
    else promptsUI.show();
  }
}

// Show one of the four page views and sync the chrome around it.
function setSection(next) {
  section = ["styles", "prompts", "skills"].includes(next) ? next : "home";
  const isStyles = section === "styles";

  els.homeView.hidden = section !== "home";
  els.stylesView.hidden = !isStyles;
  els.promptsWrap.hidden = section !== "prompts";
  els.skillsWrap.hidden = section !== "skills";

  for (const [link, name] of [
    [els.navStyles, "styles"],
    [els.navPrompts, "prompts"],
    [els.navSkills, "skills"],
  ]) {
    link.classList.toggle("active", section === name);
    if (section === name) link.setAttribute("aria-current", "page");
    else link.removeAttribute("aria-current");
  }

  closeTools();
  els.newStyleBtn.hidden = !isStyles || !adminState().admin;
  els.newPromptBtn.hidden = section !== "prompts" || !adminState().admin;
  els.newSkillBtn.hidden = section !== "skills" || !adminState().admin;
  els.search.placeholder =
    section === "prompts" ? "Search prompts…   ( / )"
    : section === "skills" ? "Search skills…   ( / )"
    : isStyles ? "Search styles…   ( / )"
    : "Search…   ( / )";
  updateLanding();
}

// ---------- theme ----------
function applyTheme(theme) {
  document.documentElement.dataset.theme = theme;
  if (els.themeBtn) {
    els.themeBtn.innerHTML = theme === "dark" ? ICONS.sun : ICONS.moon;
    els.themeBtn.setAttribute("aria-label", theme === "dark" ? "Switch to light theme" : "Switch to dark theme");
  }
}

// ---------- view (grid | list) ----------
function applyView(view) {
  const list = view === "list";
  els.gallery.classList.toggle("gallery--list", list);
  if (els.viewBtn) {
    els.viewBtn.innerHTML = list ? ICONS.grid : ICONS.list;
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
  updateLanding();
  syncURL();
}

// The featured-categories block is browsing furniture on the Styles page:
// shown on a pristine view, hidden once the user filters.
function updateLanding() {
  const hasFilter = !!(state.query.trim() || state.category || state.color || state.favOnly);
  if (els.featured) els.featured.hidden = section !== "styles" || hasFilter;
}

// ---------- home landing (stats, library counts, palette strip) ----------
function buildLanding() {
  const styles = getStyles();
  const cats = getCategories();

  const stats = document.getElementById("heroStats");
  if (stats) {
    stats.innerHTML =
      `<span class="stat"><strong>${styles.length.toLocaleString()}</strong><span>Styles</span></span>` +
      `<span class="stat"><strong>${cats.length}</strong><span>Categories</span></span>` +
      `<span class="stat" id="statPrompts"><strong>—</strong><span>Prompts</span></span>` +
      `<span class="stat" id="statSkills"><strong>—</strong><span>Skills</span></span>`;
  }
  const cs = document.getElementById("libCountStyles");
  if (cs) cs.textContent = styles.length.toLocaleString();

  // Color the Style Library card's strip with hues from real style palettes.
  const strip = document.getElementById("heroStrip");
  if (strip) {
    const pals = styles.filter((s) => (s.palette || []).length >= 4);
    const step = Math.max(1, Math.floor(pals.length / 24));
    const colors = [];
    for (let i = 0; i < pals.length && colors.length < 24; i += step) {
      colors.push(pals[i].palette[1] || pals[i].palette[0]);
    }
    if (colors.length > 1) {
      const seg = 100 / colors.length;
      const stops = colors.map((c, i) => `${c} ${(i * seg).toFixed(2)}% ${((i + 1) * seg).toFixed(2)}%`);
      strip.style.background = `linear-gradient(90deg, ${stops.join(", ")})`;
    }
  }

  const grid = document.getElementById("featuredGrid");
  if (grid) {
    const byCat = new Map();
    for (const s of styles) {
      if (!byCat.has(s.category)) byCat.set(s.category, []);
      byCat.get(s.category).push(s);
    }
    const top = cats.filter((c) => byCat.has(c.name)).slice(0, 8); // cats are sorted by count
    grid.innerHTML = top
      .map((c) => {
        const rep = byCat.get(c.name).find((s) => (s.palette || []).length >= 4) || byCat.get(c.name)[0];
        const sw = (rep?.palette || [])
          .slice(0, 5)
          .map((h) => `<span style="background:${escapeHtml(h)}"></span>`)
          .join("");
        return `<button type="button" class="featured-card" data-cat="${escapeHtml(c.name)}">
          <span class="featured-swatches" aria-hidden="true">${sw}</span>
          <span class="featured-name">${escapeHtml(c.name.replace(/^\*/, ""))}</span>
          <span class="featured-count">${c.count} styles</span>
        </button>`;
      })
      .join("");
    grid.querySelectorAll("[data-cat]").forEach((b) =>
      b.addEventListener("click", () => {
        state.category = b.dataset.cat;
        els.category.value = state.category;
        applyFilters();
        els.gallery.scrollIntoView({ behavior: "smooth", block: "start" });
      })
    );
  }
}

// Fill the prompt + skill counts once (hero stats, library cards, footer).
async function fillCounts() {
  let nPrompts = 0;
  let nSkills = 0;
  try {
    nPrompts = ((await getPrompts()).prompts || []).length;
    if (nPrompts) {
      const st = document.querySelector("#statPrompts strong");
      if (st) st.textContent = nPrompts.toLocaleString();
      const lc = document.getElementById("libCountPrompts");
      if (lc) lc.textContent = nPrompts.toLocaleString();
    }
  } catch { /* leave the placeholder */ }
  try {
    nSkills = ((await getSkills()).skills || []).length;
    if (nSkills) {
      const st = document.querySelector("#statSkills strong");
      if (st) st.textContent = nSkills.toLocaleString();
      const lc = document.getElementById("libCountSkills");
      if (lc) lc.textContent = nSkills.toLocaleString();
    }
  } catch { /* leave the placeholder */ }
  const fc = document.getElementById("footerCounts");
  if (fc) {
    const bits = [`${getStyles().length.toLocaleString()} styles`];
    if (nPrompts) bits.push(`${nPrompts.toLocaleString()} prompts`);
    if (nSkills) bits.push(`${nSkills.toLocaleString()} skills`);
    fc.innerHTML = bits.map((b) => `<span>${escapeHtml(b)}</span>`).join("");
  }
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
    els.favFilter.innerHTML = ICONS.star;
    els.favFilter.title = "Show favorites";
  }
  applyFilters();
}

// ---------- shareable URL state (styles filters live on /styles) ----------
function syncURL() {
  if (section !== "styles") return; // filters only own the URL on the Styles page
  const p = new URLSearchParams();
  if (state.query.trim()) p.set("q", state.query.trim());
  if (state.category) p.set("cat", state.category);
  if (state.color) p.set("color", state.color);
  if (state.favOnly) p.set("fav", "1");
  if (state.sort) p.set("sort", state.sort);
  if (!els.gallery.classList.contains("gallery--list")) p.set("view", "grid");
  const qs = p.toString();
  history.replaceState(null, "", qs ? `/styles?${qs}` : "/styles");
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
    els.favFilter.innerHTML = ICONS.starFill;
    els.favFilter.title = `Showing favorites (${favoriteCount()})`;
  }
  const v = p.get("view");
  if (v === "grid" || v === "list") applyView(v);

  // Captured before applyFilters()->syncURL() rewrites the URL and drops them.
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
  buildLanding();
  applyFilters();
}

// Legacy links: the pre-rebuild site kept everything at "/" with query params.
// Translate them so old bookmarks and shares keep working.
function redirectLegacyURL() {
  if (location.pathname !== "/") return;
  const p = new URLSearchParams(location.search);
  const skill = p.get("skill");
  if (skill) {
    history.replaceState(null, "", `/skills/${encodeURIComponent(skillSlug(skill))}`);
    return;
  }
  if (p.get("prompt")) {
    history.replaceState(null, "", `/prompts?prompt=${encodeURIComponent(p.get("prompt"))}`);
    return;
  }
  if (p.get("style") || p.get("q") || p.get("cat") || p.get("color") || p.get("fav") || p.get("sort")) {
    history.replaceState(null, "", `/styles${location.search}`);
  }
}

// ---------- boot ----------
async function init() {
  applyTheme(getTheme());
  applyView(getView());
  // Static toolbar icons (SVG, not platform emoji).
  els.randomBtn.innerHTML = ICONS.dice;
  els.toolsBtn.innerHTML = ICONS.dots;
  document.getElementById("settingsBtn").innerHTML = ICONS.gear;
  document.getElementById("adminBtn").innerHTML = ICONS.key;
  els.favFilter.innerHTML = ICONS.star;

  // On phones the toolbar stack is tall: hide it while scrolling down, bring
  // it back on the first upward scroll (desktop keeps it always visible).
  const topbar = document.querySelector(".topbar");
  let lastY = window.scrollY;
  window.addEventListener(
    "scroll",
    () => {
      const y = window.scrollY;
      if (window.matchMedia("(max-width: 760px)").matches) {
        topbar.classList.toggle("topbar--hidden", y > lastY && y > 180);
      } else {
        topbar.classList.remove("topbar--hidden");
      }
      lastY = y;
    },
    { passive: true }
  );
  const fy = document.getElementById("footerYear");
  if (fy) fy.textContent = String(new Date().getFullYear());

  redirectLegacyURL();

  renderSkeletons();
  await loadCatalog();
  buildCategoryOptions();
  buildLanding();
  readURLState();

  creator = initCreator(ctx);
  promptsUI = initPrompts();
  skillsUI = initSkills({ navigate });

  // Internal links (nav, brand, library cards, breadcrumbs) route client-side.
  document.addEventListener("click", (e) => {
    const a = e.target.closest("a[href]");
    if (!a || a.origin !== location.origin || a.target === "_blank") return;
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;
    if (!parsePath(a.pathname)) return; // not one of our pages
    e.preventDefault();
    navigate(a.pathname + a.search);
  });
  window.addEventListener("popstate", route);

  route(); // render the section for the current URL
  applyFilters();
  openStyleFromURL();
  fillCounts();

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

  await initAdmin({
    onChange: () => {
      els.newStyleBtn.hidden = section !== "styles" || !adminState().admin;
      els.newPromptBtn.hidden = section !== "prompts" || !adminState().admin;
      els.newSkillBtn.hidden = section !== "skills" || !adminState().admin;
      // Re-render the active section so admin-only controls appear/disappear.
      if (section === "prompts") promptsUI.rerender();
      else if (section === "skills") skillsUI.rerender();
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
      } else if (section === "skills") {
        skillsUI.setQuery(v);
      } else {
        if (section === "home" && v.trim()) navigate("/styles");
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
    els.favFilter.innerHTML = state.favOnly ? ICONS.starFill : ICONS.star;
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

  // First-run hint (shown once, on the home page).
  if (!hasSeenIntro() && els.firstRun) els.firstRun.hidden = false;
  els.firstRunClose?.addEventListener("click", () => {
    els.firstRun.hidden = true;
    markIntroSeen();
  });

  initCmdk();

  // Footer shortcuts reuse the topbar controls' handlers.
  document.getElementById("footExport")?.addEventListener("click", () => document.getElementById("settingsBtn").click());
  document.getElementById("footTheme")?.addEventListener("click", () => els.themeBtn.click());

  // ?prompt=<id> on /prompts is handled by route(); this covers the case where
  // readURLState captured it before route() rewrote the URL.
  if (pendingPromptId && section === "prompts") {
    const id = pendingPromptId;
    pendingPromptId = null;
    promptsUI.openById(id);
  }

  initSettings();
}

// ---------- command palette (⌘/Ctrl+K): jump to any style, prompt, or skill ----------
function initCmdk() {
  if (!els.cmdk) return;
  let promptsCache = null;
  let skillsCache = null;
  let items = [];
  let active = 0;

  const open = async () => {
    if (!els.cmdk.hidden) return;
    els.cmdk.hidden = false;
    els.cmdk._return = document.activeElement;
    els.cmdkInput.value = "";
    if (!promptsCache) {
      try {
        promptsCache = (await getPrompts()).prompts || [];
      } catch {
        promptsCache = [];
      }
    }
    // Palette-local cache (like prompts above): fetching here must not mark the
    // Skills section as loaded, or a failed fetch would latch it empty.
    if (!skillsCache) {
      try {
        skillsCache = (await getSkills()).skills || [];
      } catch {
        skillsCache = [];
      }
    }
    // Re-filter with whatever was typed while the caches were loading — a
    // fixed filter("") here would silently discard fast typing.
    filter(els.cmdkInput.value);
    els.cmdkInput.focus();
  };
  const close = () => {
    if (els.cmdk.hidden) return;
    els.cmdk.hidden = true;
    if (els.cmdk._return?.focus) els.cmdk._return.focus();
  };

  // Match when every term appears; rank by where the first term lands.
  const score = (text, terms) => {
    const t = text.toLowerCase();
    if (!terms.every((term) => t.includes(term))) return -1;
    return t.indexOf(terms[0]);
  };

  const filter = (raw) => {
    const q = raw.trim().toLowerCase();
    const terms = q.split(/\s+/).filter(Boolean);
    const results = [];
    if (terms.length) {
      for (const s of getStyles()) {
        const sc = score(`${s.style} ${s.category}`, terms);
        if (sc >= 0) results.push({ kind: "Style", title: s.style, sub: s.category, sc, style: s });
      }
      // The caches load async after open(); typing immediately must not race them.
      for (const p of promptsCache || []) {
        const sc = score(`${p.title} ${p.category}`, terms);
        if (sc >= 0) results.push({ kind: "Prompt", id: p.id, title: p.title, sub: p.category, sc });
      }
      for (const s of skillsCache || []) {
        const sc = score(`${s.name} ${s.platform} ${s.category}`, terms);
        if (sc >= 0) results.push({ kind: "Skill", id: s.id, title: s.name, sub: `${s.platform} · ${s.category}`, sc });
      }
      results.sort((a, b) => a.sc - b.sc || a.title.localeCompare(b.title));
    } else {
      for (const s of getStyles().slice(0, 8))
        results.push({ kind: "Style", title: s.style, sub: s.category, style: s });
    }
    items = results.slice(0, 25);
    active = 0;
    renderList();
  };

  const renderList = () => {
    els.cmdkList.innerHTML = items.length
      ? items
          .map(
            (it, i) =>
              `<li class="cmdk-item ${i === active ? "active" : ""}" data-i="${i}"><span class="cmdk-kind">${it.kind}</span><span>${escapeHtml(it.title)}</span><span class="cmdk-sub">${escapeHtml(it.sub || "")}</span></li>`
          )
          .join("")
      : `<li class="cmdk-empty">No matches.</li>`;
    els.cmdkList.querySelectorAll("[data-i]").forEach((li) => li.addEventListener("click", () => choose(Number(li.dataset.i))));
  };

  const scrollActive = () => {
    const el = els.cmdkList.querySelector(".cmdk-item.active");
    if (el) el.scrollIntoView({ block: "nearest" });
  };

  const choose = (i) => {
    const it = items[i];
    if (!it) return;
    close();
    if (it.kind === "Style") openDetail(it.style, ctx);
    else if (it.kind === "Skill") navigate(`/skills/${encodeURIComponent(skillSlug(it.id))}`);
    else {
      navigate("/prompts");
      promptsUI.openById(it.id);
    }
  };

  els.cmdkInput.addEventListener("input", (e) => filter(e.target.value));
  els.cmdkInput.addEventListener("keydown", (e) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      active = Math.min(active + 1, items.length - 1);
      renderList();
      scrollActive();
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      active = Math.max(active - 1, 0);
      renderList();
      scrollActive();
    } else if (e.key === "Enter") {
      e.preventDefault();
      choose(active);
    }
  });
  els.cmdk.addEventListener("click", (e) => {
    if (e.target === els.cmdk) close();
  });
  document.addEventListener("keydown", (e) => {
    if ((e.metaKey || e.ctrlKey) && (e.key === "k" || e.key === "K")) {
      e.preventDefault();
      open();
    } else if (e.key === "Escape" && !els.cmdk.hidden) {
      e.preventDefault();
      close();
    }
  });
}

// ---------- settings: export (all) + import (admin) ----------
function initSettings() {
  const modal = document.getElementById("settingsModal");
  const open = document.getElementById("settingsBtn");
  const exportBtn = document.getElementById("exportBtn");
  const importInput = document.getElementById("importInput");
  if (!modal) return;
  const favHint = document.getElementById("favCountHint");
  wireModalDismiss(modal);
  open.addEventListener("click", () => {
    document.getElementById("importRow").hidden = !adminState().admin;
    const n = favoriteCount();
    if (favHint) favHint.textContent = n ? `${n} starred.` : "No favorites yet.";
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

  const toCsv = (styles) => {
    const cell = (v) => {
      const s = String(v == null ? "" : v);
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const header = ["Category", "Style", "Palette", "Type", "Icons", "Layout", "Charts", "Background", "Avoid", "Pasteable prompt"];
    const rows = styles.map((s) =>
      [s.category, s.style, (s.palette || []).join(" "), s.type, s.icons, s.layout, s.charts, s.background, s.avoid, s.notebookLMPrompt]
        .map(cell)
        .join(",")
    );
    return [header.join(","), ...rows].join("\n");
  };
  const favorites = () => getStyles().filter((s) => isFavorite(s.id));

  exportBtn.addEventListener("click", () => {
    download(JSON.stringify(getStyles(), null, 2), "application/json", "ai-compendium-styles.json");
    toast("Catalog exported (JSON)");
  });

  const exportCsvBtn = document.getElementById("exportCsvBtn");
  exportCsvBtn?.addEventListener("click", () => {
    download(toCsv(getStyles()), "text/csv", "ai-compendium-styles.csv");
    toast("Catalog exported (CSV)");
  });

  document.getElementById("exportFavBtn")?.addEventListener("click", () => {
    const fav = favorites();
    if (!fav.length) return toast("No favorites to export");
    download(JSON.stringify(fav, null, 2), "application/json", "ai-compendium-favorites.json");
    toast(`Exported ${fav.length} favorites (JSON)`);
  });
  document.getElementById("exportFavCsvBtn")?.addEventListener("click", () => {
    const fav = favorites();
    if (!fav.length) return toast("No favorites to export");
    download(toCsv(fav), "text/csv", "ai-compendium-favorites.csv");
    toast(`Exported ${fav.length} favorites (CSV)`);
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

// Register the service worker for offline use + installability.
if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js").catch(() => {});
  });
}
