// AI skill library: the third section (Valkey-backed like prompts) for reusable
// skills — Claude Skills, ChatGPT custom-GPT instruction sets, and Gemini Gems.
// Visitors browse/search/copy/download; admins create, edit, and AI-draft.
import * as api from "./api.js";
import { adminState } from "./admin.js";
import { escapeHtml, copyText, toast, openModal, closeModal, wireModalDismiss, ICONS } from "./ui.js";
import { getSkillView, setSkillView, isSkillFavorite, toggleSkillFavorite, skillFavoriteCount } from "./storage.js";

// Platforms the UI knows how to badge/color. Anything else renders as "Other".
const PLATFORMS = ["Claude", "ChatGPT", "Gemini", "Other"];
const platformClass = (p) => `platform-badge platform-${(PLATFORMS.includes(p) ? p : "Other").toLowerCase()}`;

let list = [];
let query = "";
let loaded = false;
let editId = null;
let viewMode = "grid"; // "grid" | "list"
let activePlatform = ""; // "" = all
let activeCategory = "";
let activeTag = "";
let sort = ""; // "" newest | "name" | "platform"
let favOnly = false;
let view, refs;

const byId = (id) => list.find((s) => s.id === id);

// Platforms present across all skills, with counts, in PLATFORMS order first.
function allPlatforms() {
  const counts = new Map();
  for (const s of list) {
    const p = PLATFORMS.includes(s.platform) ? s.platform : "Other";
    counts.set(p, (counts.get(p) || 0) + 1);
  }
  return PLATFORMS.filter((p) => counts.has(p)).map((p) => [p, counts.get(p)]);
}

// Categories across all skills, with counts, alphabetical.
function allCategories() {
  const counts = new Map();
  for (const s of list) {
    const c = s.category || "General";
    counts.set(c, (counts.get(c) || 0) + 1);
  }
  return [...counts.entries()].sort((a, b) => a[0].localeCompare(b[0]));
}

// Tags across all skills, with counts, most-used first.
function allTags() {
  const counts = new Map();
  for (const s of list) for (const t of s.tags || []) counts.set(t, (counts.get(t) || 0) + 1);
  return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
}

function filtered() {
  const q = query.trim().toLowerCase();
  const out = list.filter((s) => {
    if (favOnly && !isSkillFavorite(s.id)) return false;
    if (activePlatform) {
      const p = PLATFORMS.includes(s.platform) ? s.platform : "Other";
      if (p !== activePlatform) return false;
    }
    if (activeCategory && (s.category || "General") !== activeCategory) return false;
    if (activeTag) {
      const tset = new Set((s.tags || []).map((t) => t.toLowerCase()));
      if (!tset.has(activeTag)) return false;
    }
    if (!q) return true;
    return [s.name, s.platform, s.category, s.description, s.instructions, (s.tags || []).join(" ")]
      .join(" ")
      .toLowerCase()
      .includes(q);
  });
  // Default order is the stored order (newest first, since saves unshift).
  if (sort === "name") out.sort((a, b) => (a.name || "").localeCompare(b.name || ""));
  else if (sort === "platform")
    out.sort((a, b) => (a.platform || "").localeCompare(b.platform || "") || (a.name || "").localeCompare(b.name || ""));
  return out;
}

function skillLink(id) {
  return `${location.origin}${location.pathname}?skill=${encodeURIComponent(id)}`;
}

// ---------- install file (SKILL.md for Claude, plain markdown otherwise) ----------
function fileSlug(name) {
  return String(name || "skill").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "skill";
}

function toSkillFile(s) {
  if (s.platform === "Claude") {
    // Claude Skills ship as SKILL.md with YAML frontmatter. The description is
    // emitted as a JSON string (valid YAML): unquoted prose with ": ", "#", or
    // a leading "[" would produce frontmatter YAML parsers reject.
    const desc = String(s.description || "").replace(/\s+/g, " ").trim();
    return {
      filename: "SKILL.md",
      text: `---\nname: ${fileSlug(s.name)}\ndescription: ${JSON.stringify(desc)}\n---\n\n${s.instructions || ""}\n`,
    };
  }
  const parts = [`# ${s.name}`];
  if (s.description) parts.push(s.description);
  if (s.instructions) parts.push(s.instructions);
  if (s.notes) parts.push(`## Notes\n\n${s.notes}`);
  return { filename: `${fileSlug(s.name)}.md`, text: parts.join("\n\n") + "\n" };
}

function downloadSkill(s) {
  const { filename, text } = toSkillFile(s);
  const url = URL.createObjectURL(new Blob([text], { type: "text/markdown" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
  toast(`Downloaded ${filename}`);
}

function cardHTML(s, admin) {
  const tags = (s.tags || []).map((t) => `<span class="badge">${escapeHtml(t)}</span>`).join("");
  const fav = isSkillFavorite(s.id);
  const desc = s.description || s.notes || "";
  const hasBody = !!(s.instructions || "").trim();
  return `<article class="card skill-card" data-id="${escapeHtml(s.id)}" tabindex="0" role="button" aria-label="Open ${escapeHtml(s.name)}">
    <div class="card-body">
      <div class="card-head">
        <div class="card-title">${escapeHtml(s.name)}</div>
        <button type="button" class="fav ${fav ? "on" : ""}" data-fav="${escapeHtml(s.id)}" aria-pressed="${fav}" title="${fav ? "Remove from favorites" : "Add to favorites"}" aria-label="Favorite">${fav ? "★" : "☆"}</button>
      </div>
      <div class="skill-meta">
        <span class="${platformClass(s.platform)}">${escapeHtml(s.platform || "Other")}</span>
        <span class="card-category">${escapeHtml(s.category || "General")}</span>
      </div>
      ${desc ? `<p class="skill-desc">${escapeHtml(desc)}</p>` : ""}
      ${tags ? `<div class="badges">${tags}</div>` : ""}
    </div>
    <div class="card-actions always">
      ${hasBody ? `<button type="button" class="btn btn-sm btn-primary" data-copy="${escapeHtml(s.id)}">Copy</button>` : ""}
      ${hasBody ? `<button type="button" class="btn btn-sm" data-dl="${escapeHtml(s.id)}">Download</button>` : ""}
      ${s.link ? `<a class="btn btn-sm" href="${escapeHtml(s.link)}" target="_blank" rel="noopener" data-ext>Open source ↗</a>` : ""}
      <button type="button" class="btn btn-sm btn-ghost" data-link="${escapeHtml(s.id)}" title="Copy a shareable link">Link</button>
      ${
        admin
          ? `<button type="button" class="btn btn-sm" data-edit="${escapeHtml(s.id)}">Edit</button>
             <button type="button" class="btn btn-sm btn-ghost btn-danger" data-del="${escapeHtml(s.id)}">Delete</button>`
          : ""
      }
    </div>
  </article>`;
}

function controlsHTML() {
  const platforms = allPlatforms();
  const cats = allCategories();
  const tags = allTags();
  const platBtns =
    `<button type="button" class="seg ${activePlatform === "" ? "active" : ""}" data-plat="">All (${list.length})</button>` +
    platforms
      .map(
        ([p, n]) =>
          `<button type="button" class="seg ${activePlatform === p ? "active" : ""}" data-plat="${escapeHtml(p)}">${escapeHtml(p)} (${n})</button>`
      )
      .join("");
  const catOpts =
    `<option value="">All categories</option>` +
    cats
      .map(
        ([c, n]) =>
          `<option value="${escapeHtml(c)}" ${activeCategory === c ? "selected" : ""}>${escapeHtml(c)} (${n})</option>`
      )
      .join("");
  const tagOpts =
    `<option value="">All tags</option>` +
    tags
      .map(
        ([t, n]) =>
          `<option value="${escapeHtml(t.toLowerCase())}" ${activeTag === t.toLowerCase() ? "selected" : ""}>${escapeHtml(t)} (${n})</option>`
      )
      .join("");
  const sortOpts = [
    ["", "Newest"],
    ["name", "Name A→Z"],
    ["platform", "Platform"],
  ]
    .map(([v, label]) => `<option value="${v}" ${sort === v ? "selected" : ""}>${label}</option>`)
    .join("");
  const favCount = skillFavoriteCount();
  return `<div class="prompts-controls">
    <div class="seg-group" role="group" aria-label="Filter by platform">${platBtns}</div>
    ${cats.length ? `<select id="sCatFilter" class="select" aria-label="Filter by category">${catOpts}</select>` : ""}
    ${tags.length ? `<select id="sTagFilter" class="select" aria-label="Filter by tag">${tagOpts}</select>` : ""}
    <select id="sSort" class="select" aria-label="Sort skills">${sortOpts}</select>
    <button type="button" id="sFav" class="btn btn-icon ${favOnly ? "active" : ""}" aria-pressed="${favOnly}" title="${favOnly ? `Showing favorites (${favCount})` : "Show favorites"}" aria-label="Show favorite skills">${favOnly ? ICONS.starFill : ICONS.star}</button>
    <div class="seg-group" role="group" aria-label="Skill layout">
      <button type="button" class="seg ${viewMode === "grid" ? "active" : ""}" data-sview="grid" aria-pressed="${viewMode === "grid"}" title="Grid view">${ICONS.grid} Grid</button>
      <button type="button" class="seg ${viewMode === "list" ? "active" : ""}" data-sview="list" aria-pressed="${viewMode === "list"}" title="List view">${ICONS.list} List</button>
    </div>
  </div>`;
}

function render() {
  if (!view) return;
  const admin = adminState().admin;
  const items = filtered();
  const hasFilter = !!query.trim() || !!activePlatform || !!activeCategory || !!activeTag || favOnly;
  const body = !items.length
    ? !loaded
      ? `<div class="gallery gallery--list">${Array.from({ length: 8 }, () => '<div class="skeleton skeleton-card"></div>').join("")}</div>`
      : `<div class="empty">${
          favOnly ? "No favorite skills yet — tap ☆ on a skill." : hasFilter ? "No skills match your filters." : "No skills yet."
        }${admin && !hasFilter ? ' Use "+ New skill" to add one.' : ""}</div>`
    : `<div class="gallery ${viewMode === "list" ? "gallery--list" : ""}">${items.map((s) => cardHTML(s, admin)).join("")}</div>`;
  view.innerHTML = controlsHTML() + body;

  view.querySelectorAll("[data-plat]").forEach((b) =>
    b.addEventListener("click", () => {
      activePlatform = b.dataset.plat;
      render();
    })
  );
  view.querySelectorAll("[data-sview]").forEach((b) =>
    b.addEventListener("click", () => {
      viewMode = b.dataset.sview === "list" ? "list" : "grid";
      setSkillView(viewMode);
      render();
    })
  );
  const catSel = view.querySelector("#sCatFilter");
  if (catSel) catSel.addEventListener("change", (e) => { activeCategory = e.target.value; render(); });
  const tagSel = view.querySelector("#sTagFilter");
  if (tagSel) tagSel.addEventListener("change", (e) => { activeTag = e.target.value; render(); });
  const sortSel = view.querySelector("#sSort");
  if (sortSel) sortSel.addEventListener("change", (e) => { sort = e.target.value; render(); });
  const favBtn = view.querySelector("#sFav");
  if (favBtn) favBtn.addEventListener("click", () => { favOnly = !favOnly; render(); });

  view.querySelectorAll("[data-copy]").forEach((b) =>
    b.addEventListener("click", () => copyText(byId(b.dataset.copy)?.instructions || "", "Skill instructions copied"))
  );
  view.querySelectorAll("[data-dl]").forEach((b) => b.addEventListener("click", () => downloadSkill(byId(b.dataset.dl))));
  view.querySelectorAll("[data-link]").forEach((b) =>
    b.addEventListener("click", () => copyText(skillLink(b.dataset.link), "Link copied"))
  );
  view.querySelectorAll("[data-fav]").forEach((b) =>
    b.addEventListener("click", () => {
      toggleSkillFavorite(b.dataset.fav);
      render();
    })
  );
  // Clicking anywhere on a card (except its buttons/links) opens the detail view.
  view.querySelectorAll(".skill-card").forEach((card) => {
    const open = () => {
      const s = byId(card.dataset.id);
      if (s) openSkillDetail(s);
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
      const s = byId(b.dataset.del);
      if (!confirm(`Delete skill "${s.name}"?`)) return;
      try {
        await api.deleteSkillApi(s.id);
        toast("Deleted");
        await refresh();
      } catch (e) {
        toast(e.message);
      }
    })
  );
}

// ---------- skill detail (click a card) ----------
function openSkillDetail(s) {
  const admin = adminState().admin;
  const fav = isSkillFavorite(s.id);
  const tags = (s.tags || []).map((t) => `<span class="badge">${escapeHtml(t)}</span>`).join("");
  const hasBody = !!(s.instructions || "").trim();
  refs.detailBody.innerHTML = `
    <div class="modal-head">
      <h2 id="sdTitle">${escapeHtml(s.name)}</h2>
      <div class="detail-head-actions">
        <button type="button" class="btn btn-icon fav ${fav ? "on" : ""}" data-sd-fav aria-pressed="${fav}" title="${fav ? "Remove from favorites" : "Add to favorites"}">${fav ? "★" : "☆"}</button>
        <button type="button" class="btn" data-sd-link title="Copy a shareable link">Copy link</button>
        <button type="button" class="btn btn-icon" data-close aria-label="Close">✕</button>
      </div>
    </div>
    <div class="skill-meta">
      <span class="${platformClass(s.platform)}">${escapeHtml(s.platform || "Other")}</span>
      <span class="card-category">${escapeHtml(s.category || "General")}</span>
    </div>
    ${s.description ? `<p class="skill-desc sd-desc">${escapeHtml(s.description)}</p>` : ""}
    ${tags ? `<div class="badges pd-badges">${tags}</div>` : ""}
    ${s.notes ? `<div class="pd-section"><span class="detail-label">Notes</span><p class="pd-notes">${escapeHtml(s.notes)}</p></div>` : ""}
    ${
      s.link
        ? `<div class="pd-section"><span class="detail-label">Source</span><p class="pd-notes"><a class="linkish" href="${escapeHtml(s.link)}" target="_blank" rel="noopener">${escapeHtml(s.link)}</a></p></div>`
        : ""
    }
    ${
      hasBody
        ? `<div class="prompt-block">
             <div class="prompt-head"><span>Instructions</span><button type="button" class="btn btn-sm" data-sd-copy>Copy</button></div>
             <pre class="prompt-text pd-text">${escapeHtml(s.instructions)}</pre>
           </div>`
        : `<p class="muted">No instructions captured yet${s.link ? " — see the source link above" : ""}.</p>`
    }
    <div class="pd-actions">
      ${hasBody ? `<button type="button" class="btn btn-primary" data-sd-dl>Download ${s.platform === "Claude" ? "SKILL.md" : "Markdown"}</button>` : ""}
      ${admin ? `<button type="button" class="btn" data-sd-edit>Edit</button><button type="button" class="btn btn-ghost btn-danger" data-sd-del>Delete</button>` : ""}
    </div>`;

  const q = (sel) => refs.detailBody.querySelector(sel);
  q("[data-sd-fav]").onclick = (e) => {
    toggleSkillFavorite(s.id);
    const on = isSkillFavorite(s.id);
    e.currentTarget.classList.toggle("on", on);
    e.currentTarget.textContent = on ? "★" : "☆";
    e.currentTarget.setAttribute("aria-pressed", String(on));
    render();
  };
  q("[data-sd-link]").onclick = () => copyText(skillLink(s.id), "Link copied");
  q("[data-sd-copy]")?.addEventListener("click", () => copyText(s.instructions, "Skill instructions copied"));
  q("[data-sd-dl]")?.addEventListener("click", () => downloadSkill(s));
  q("[data-sd-edit]")?.addEventListener("click", () => {
    closeModal(refs.detailModal);
    openForm(s);
  });
  q("[data-sd-del]")?.addEventListener("click", async () => {
    if (!confirm(`Delete skill "${s.name}"?`)) return;
    try {
      await api.deleteSkillApi(s.id);
      closeModal(refs.detailModal);
      toast("Deleted");
      await refresh();
    } catch (e) {
      toast(e.message);
    }
  });

  openModal(refs.detailModal);
}

// ---------- create / edit form (admin) ----------
function setStatus(m, isErr = false) {
  refs.status.textContent = m;
  refs.status.classList.toggle("error", isErr);
}

function openForm(s) {
  editId = s?.id || null;
  refs.modalTitle.textContent = s ? "Edit skill" : "New skill";
  refs.name.value = s?.name || "";
  // The select ships the four canonical platforms; a stored free-text platform
  // (allowed by the API) gets a temporary option so saving an untouched form
  // doesn't silently rewrite it.
  refs.platform.querySelector("option[data-custom]")?.remove();
  const platformValue = s?.platform || "Claude";
  if (!PLATFORMS.includes(platformValue)) {
    const o = document.createElement("option");
    o.value = platformValue;
    o.textContent = platformValue;
    o.dataset.custom = "1";
    refs.platform.appendChild(o);
  }
  refs.platform.value = platformValue;
  refs.category.value = s?.category || "";
  refs.description.value = s?.description || "";
  refs.link.value = s?.link || "";
  refs.tags.value = (s?.tags || []).join(", ");
  refs.instructions.value = s?.instructions || "";
  refs.notes.value = s?.notes || "";
  refs.nl.value = "";
  setStatus("");
  openModal(refs.modal);
}

async function onGenerate() {
  const d = refs.nl.value.trim();
  if (!d) {
    setStatus("Describe the skill first.", true);
    return;
  }
  refs.gen.disabled = true;
  setStatus("Drafting with Claude Opus 4.8…");
  try {
    const { skill } = await api.generateSkill({ description: d, platform: refs.platform.value, model: "claude-opus-4-8" });
    refs.name.value = skill.name;
    if (PLATFORMS.includes(skill.platform)) refs.platform.value = skill.platform;
    refs.category.value = skill.category;
    refs.description.value = skill.description;
    refs.tags.value = (skill.tags || []).join(", ");
    refs.instructions.value = skill.instructions;
    refs.notes.value = skill.notes || "";
    setStatus("Draft generated — review and Save.");
  } catch (e) {
    setStatus(e.message, true);
  } finally {
    refs.gen.disabled = false;
  }
}

async function onSave() {
  const skill = {
    name: refs.name.value.trim(),
    platform: refs.platform.value,
    category: refs.category.value.trim(),
    description: refs.description.value.trim(),
    link: refs.link.value.trim(),
    tags: refs.tags.value,
    instructions: refs.instructions.value.trim(),
    notes: refs.notes.value.trim(),
  };
  if (!skill.name) {
    setStatus("A name is required.", true);
    return;
  }
  refs.save.disabled = true;
  setStatus("Saving…");
  try {
    await api.saveSkill({ id: editId || undefined, skill });
    toast("Saved ✓");
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
  list = (await api.getSkills()).skills || [];
  loaded = true;
}
async function refresh() {
  list = (await api.getSkills()).skills || [];
  loaded = true;
  render();
}

export function initSkills() {
  view = document.getElementById("skillsView");
  viewMode = getSkillView();
  const el = (id) => document.getElementById(id);
  refs = {
    modal: el("skillModal"),
    modalTitle: el("sModalTitle"),
    name: el("sName"),
    platform: el("sPlatform"),
    category: el("sCategory"),
    description: el("sDescription"),
    link: el("sLink"),
    tags: el("sTags"),
    instructions: el("sInstructions"),
    notes: el("sNotes"),
    nl: el("sNl"),
    gen: el("sGenerate"),
    save: el("sSave"),
    status: el("sStatus"),
    newBtn: el("newSkillBtn"),
    detailModal: el("skillDetailModal"),
    detailBody: el("sdBody"),
  };
  wireModalDismiss(refs.modal);
  wireModalDismiss(refs.detailModal);
  refs.newBtn.addEventListener("click", () => openForm());
  refs.gen.addEventListener("click", onGenerate);
  refs.save.addEventListener("click", onSave);

  return {
    show: async () => {
      await ensureLoaded();
      render();
    },
    rerender: render,
    setQuery: (q) => {
      query = q;
      if (view && !view.hidden) render();
    },
    // Deep link (?skill=<id>): open that skill's detail view.
    openById: async (id) => {
      await ensureLoaded();
      render();
      const s = byId(id);
      if (s) openSkillDetail(s);
      return !!s;
    },
  };
}
