// Skills Hub: the shareable repository of AI skills — Claude Skills, ChatGPT
// custom-GPT instruction sets, and Gemini Gems. Renders two page modes inside
// #skillsView: the hub (cards + filters + install guide) and a per-skill
// detail page at /skills/<slug>. Visitors browse/copy/download; admins
// create, edit, and AI-draft.
import * as api from "./api.js";
import { adminState } from "./admin.js";
import { escapeHtml, copyText, toast, openModal, closeModal, wireModalDismiss, ICONS } from "./ui.js";
import { getSkillView, setSkillView, isSkillFavorite, toggleSkillFavorite, skillFavoriteCount } from "./storage.js";

// Platforms the UI knows how to badge/color. Anything else renders as "Other".
const PLATFORMS = ["Claude", "ChatGPT", "Gemini", "Other"];
const platformClass = (p) => `platform-badge platform-${(PLATFORMS.includes(p) ? p : "Other").toLowerCase()}`;
const platformLabel = (p) =>
  p === "Claude" ? "Claude Skill" : p === "ChatGPT" ? "ChatGPT GPT" : p === "Gemini" ? "Gemini Gem" : p || "Other";

// The public URL path segment for a skill (mirrors lib/skill.js).
export function skillSlug(id) {
  return String(id || "").replace(/^skill-/, "");
}

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
let detailSlug = null; // non-null => detail page mode
let formResources = []; // package files attached to the skill being edited
let view, refs;
let navigate = () => {};

const byId = (id) => list.find((s) => s.id === id);
const bySlug = (slug) => list.find((s) => skillSlug(s.id) === slug || s.id === slug);

// Platforms present across all skills, with counts, in PLATFORMS order.
function allPlatforms() {
  const counts = new Map();
  for (const s of list) {
    const p = PLATFORMS.includes(s.platform) ? s.platform : "Other";
    counts.set(p, (counts.get(p) || 0) + 1);
  }
  return PLATFORMS.filter((p) => counts.has(p)).map((p) => [p, counts.get(p)]);
}

function allCategories() {
  const counts = new Map();
  for (const s of list) {
    const c = s.category || "General";
    counts.set(c, (counts.get(c) || 0) + 1);
  }
  return [...counts.entries()].sort((a, b) => a[0].localeCompare(b[0]));
}

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
  // Default order: most recently updated first, then the stored order.
  if (sort === "name") out.sort((a, b) => (a.name || "").localeCompare(b.name || ""));
  else if (sort === "platform")
    out.sort((a, b) => (a.platform || "").localeCompare(b.platform || "") || (a.name || "").localeCompare(b.name || ""));
  else out.sort((a, b) => (b.updated || "").localeCompare(a.updated || ""));
  return out;
}

function skillURL(s) {
  return `${location.origin}/skills/${encodeURIComponent(skillSlug(s.id))}`;
}

function formatDate(iso) {
  if (!iso) return "";
  const d = new Date(`${iso}T00:00:00`);
  if (isNaN(d)) return "";
  return d.toLocaleDateString(undefined, { month: "short", year: "numeric" });
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

// ---------- zip writer (STORE method) for full skill packages ----------
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(bytes) {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

// Build an uncompressed (STORE) zip from [{path, text}] — no library needed.
function buildZip(files) {
  const enc = new TextEncoder();
  const chunks = [];
  const central = [];
  let offset = 0;
  for (const f of files) {
    const nameB = enc.encode(f.path);
    const data = enc.encode(f.text);
    const crc = crc32(data);
    const lh = new DataView(new ArrayBuffer(30));
    lh.setUint32(0, 0x04034b50, true);
    lh.setUint16(4, 20, true); // version needed; flags/method/time/date stay 0 (STORE)
    lh.setUint32(14, crc, true);
    lh.setUint32(18, data.length, true);
    lh.setUint32(22, data.length, true);
    lh.setUint16(26, nameB.length, true);
    chunks.push(new Uint8Array(lh.buffer), nameB, data);
    central.push({ nameB, crc, size: data.length, offset });
    offset += 30 + nameB.length + data.length;
  }
  const cdStart = offset;
  for (const e of central) {
    const cd = new DataView(new ArrayBuffer(46));
    cd.setUint32(0, 0x02014b50, true);
    cd.setUint16(4, 20, true); // version made by
    cd.setUint16(6, 20, true); // version needed
    cd.setUint32(16, e.crc, true);
    cd.setUint32(20, e.size, true);
    cd.setUint32(24, e.size, true);
    cd.setUint16(28, e.nameB.length, true);
    cd.setUint32(42, e.offset, true);
    chunks.push(new Uint8Array(cd.buffer), e.nameB);
    offset += 46 + e.nameB.length;
  }
  const eocd = new DataView(new ArrayBuffer(22));
  eocd.setUint32(0, 0x06054b50, true);
  eocd.setUint16(8, central.length, true);
  eocd.setUint16(10, central.length, true);
  eocd.setUint32(12, offset - cdStart, true);
  eocd.setUint32(16, cdStart, true);
  chunks.push(new Uint8Array(eocd.buffer));
  return new Blob(chunks, { type: "application/zip" });
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
  toast(`Downloaded ${filename}`);
}

// With package files (references, patterns…) stored, download the whole
// folder as a zip; otherwise just the single markdown file.
function downloadSkill(s) {
  const main = toSkillFile(s);
  if ((s.resources || []).length) {
    const zip = buildZip([{ path: main.filename, text: main.text }, ...s.resources]);
    downloadBlob(zip, `${fileSlug(s.name)}.zip`);
    return;
  }
  downloadBlob(new Blob([main.text], { type: "text/markdown" }), main.filename);
}

const hasPackage = (s) => (s.resources || []).length > 0;

// Per-platform install steps shown on detail pages and the hub guide.
function installSteps(s) {
  const p = PLATFORMS.includes(s.platform) ? s.platform : "Other";
  if (p === "Claude")
    return [
      `<b>Download SKILL.md</b>${s.files?.length > 1 ? " and the reference files listed in the sidebar" : ""}.`,
      `Add it under <b>Settings → Capabilities → Skills</b> on claude.ai, or drop the folder into <code>~/.claude/skills</code> for Claude Code.`,
      `Ask Claude for a matching task — the skill triggers automatically.`,
    ];
  if (p === "ChatGPT")
    return [
      `<b>Copy the instructions</b> below.`,
      `In ChatGPT, open <b>Explore GPTs → Create</b> and paste them into the <b>Instructions</b> field.`,
      `Add any knowledge files listed in the sidebar, then save your GPT.`,
    ];
  if (p === "Gemini")
    return [
      `<b>Copy the instructions</b> below.`,
      `In Gemini, open <b>Gems → New Gem</b> and paste them as the Gem's instructions.`,
      `Attach the source files listed in the sidebar, then save the Gem.`,
    ];
  return [`<b>Copy the instructions</b> below and adapt them to your tool.`];
}

// ---------- hub cards ----------
function cardHTML(s, admin) {
  const tags = (s.tags || []).map((t) => `<span class="badge">${escapeHtml(t)}</span>`).join("");
  const fav = isSkillFavorite(s.id);
  const desc = s.description || s.notes || "";
  const hasBody = !!(s.instructions || "").trim();
  const when = formatDate(s.updated);
  const slug = skillSlug(s.id);
  return `<article class="card skill-card" data-id="${escapeHtml(s.id)}" data-slug="${escapeHtml(slug)}" tabindex="0" role="button" aria-label="Open ${escapeHtml(s.name)}">
    <div class="card-body">
      <div class="card-head">
        <h5 class="card-title">${escapeHtml(s.name)}${s.version ? ` <span class="ver-chip">v${escapeHtml(s.version)}</span>` : ""}</h5>
        <button type="button" class="fav ${fav ? "on" : ""}" data-fav="${escapeHtml(s.id)}" aria-pressed="${fav}" title="${fav ? "Remove from favorites" : "Add to favorites"}" aria-label="Favorite">${fav ? "★" : "☆"}</button>
      </div>
      <div class="skill-meta">
        <span class="${platformClass(s.platform)}">${escapeHtml(platformLabel(s.platform))}</span>
        <span class="card-category">${escapeHtml(s.category || "General")}</span>
      </div>
      ${desc ? `<p class="skill-desc">${escapeHtml(desc)}</p>` : ""}
      ${tags ? `<div class="badges">${tags}</div>` : ""}
    </div>
    <div class="sk-foot">
      <span class="sk-when">${when ? `Updated ${escapeHtml(when)}` : ""}</span>
      ${hasBody ? `<button type="button" class="btn btn-sm" data-copy="${escapeHtml(s.id)}">Copy</button>` : ""}
      ${hasBody ? `<button type="button" class="btn btn-sm btn-primary" data-dl="${escapeHtml(s.id)}">${hasPackage(s) ? "Package ↓" : s.platform === "Claude" ? "SKILL.md ↓" : ".md ↓"}</button>` : ""}
      ${!hasBody && s.link ? `<a class="btn btn-sm" href="${escapeHtml(s.link)}" target="_blank" rel="noopener">Open source ↗</a>` : ""}
      ${
        admin
          ? `<button type="button" class="btn btn-sm btn-ghost" data-edit="${escapeHtml(s.id)}">Edit</button>
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
    ["", "Recently updated"],
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

const INSTALL_GUIDE = `<div class="install-guide">
  <h6>How to install</h6>
  <div class="install-cols">
    <div><b>Claude</b><p>Download SKILL.md and add it under Settings → Capabilities → Skills, or drop the folder into <code>~/.claude/skills</code> for Claude Code.</p></div>
    <div><b>ChatGPT</b><p>Copy the instruction block into your GPT's Instructions field in the GPT builder, then add the listed knowledge files.</p></div>
    <div><b>Gemini</b><p>Create a Gem, paste the instructions, and attach the referenced source files (e.g. Guardrails + Text DNA).</p></div>
  </div>
</div>`;

function render() {
  if (!view) return;
  if (detailSlug) {
    renderDetail();
    return;
  }
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

  view.innerHTML = `
    <div class="sh-head">
      <div>
        <h2>Skills Hub</h2>
        <p>Every skill here is install-ready: download the file, copy the instructions, or share the link.</p>
      </div>
    </div>
    ${controlsHTML()}${body}${INSTALL_GUIDE}`;

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
  view.querySelectorAll("[data-fav]").forEach((b) =>
    b.addEventListener("click", () => {
      toggleSkillFavorite(b.dataset.fav);
      render();
    })
  );
  // Clicking anywhere on a card (except its buttons/links) opens the detail page.
  view.querySelectorAll(".skill-card").forEach((card) => {
    const open = () => navigate(`/skills/${encodeURIComponent(card.dataset.slug)}`);
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

// ---------- skill detail page (/skills/<slug>) ----------
function renderDetail() {
  const s = bySlug(detailSlug);
  if (!s) {
    view.innerHTML = `
      <div class="sd-crumb"><a href="/skills">Skills Hub</a> / <b>Not found</b></div>
      <div class="empty">That skill doesn't exist (it may have been deleted).</div>`;
    return;
  }
  const admin = adminState().admin;
  const fav = isSkillFavorite(s.id);
  const tags = (s.tags || []).map((t) => `<span class="badge">${escapeHtml(t)}</span>`).join("");
  const hasBody = !!(s.instructions || "").trim();
  const steps = installSteps(s)
    .map((step, i) => `<div class="sd-step"><i>${i + 1}</i><span>${step}</span></div>`)
    .join("");
  const files = (s.files || []).length
    ? s.files.map((f) => escapeHtml(f)).join("<br>")
    : hasBody
      ? escapeHtml(s.platform === "Claude" ? "SKILL.md" : `${fileSlug(s.name)}.md`)
      : "—";

  view.innerHTML = `
    <div class="sd-crumb"><a href="/skills">Skills Hub</a> / <b>${escapeHtml(s.name)}</b></div>
    <div class="sd-layout">
      <div class="sd-main">
        <span class="${platformClass(s.platform)}">${escapeHtml(platformLabel(s.platform))}</span>
        <h2>${escapeHtml(s.name)}${s.version ? ` <span class="ver-chip">v${escapeHtml(s.version)}</span>` : ""}
          <button type="button" class="fav ${fav ? "on" : ""}" data-sd-fav aria-pressed="${fav}" title="${fav ? "Remove from favorites" : "Add to favorites"}">${fav ? "★" : "☆"}</button>
        </h2>
        ${s.description ? `<p class="sd-desc">${escapeHtml(s.description)}</p>` : ""}
        ${tags ? `<div class="badges" style="margin-bottom:18px">${tags}</div>` : ""}
        ${
          hasBody
            ? `<div class="sd-code">
                 <div class="sd-codehead"><span>${s.platform === "Claude" ? "SKILL.md" : "Instructions"}</span><button type="button" class="btn btn-sm" data-sd-copy>Copy</button></div>
                 <pre class="sd-codebody">${escapeHtml(s.instructions)}</pre>
               </div>`
            : `<p class="muted">No instructions captured yet${s.link ? " — see the source link in the sidebar" : ""}.</p>`
        }
        ${
          hasPackage(s)
            ? `<div class="sd-steps"><h6>Package files</h6>${s.resources
                .map(
                  (r, i) =>
                    `<details class="sd-resource"><summary><span>${escapeHtml(r.path)}</span><span class="muted">${(r.text.length / 1024).toFixed(1)} KB</span><button type="button" class="btn btn-sm" data-rescopy="${i}">Copy</button></summary><pre class="sd-codebody">${escapeHtml(r.text)}</pre></details>`
                )
                .join("")}</div>`
            : ""
        }
        ${hasBody ? `<div class="sd-steps"><h6>Install in ${escapeHtml(PLATFORMS.includes(s.platform) ? s.platform : "your tool")}</h6>${steps}</div>` : ""}
        ${s.notes ? `<p class="sd-notes"><b>Notes.</b> ${escapeHtml(s.notes)}</p>` : ""}
      </div>
      <aside class="sd-aside">
        <div class="sd-meta-row"><span>Platform</span><b>${escapeHtml(s.platform || "Other")}</b></div>
        <div class="sd-meta-row"><span>Category</span><b>${escapeHtml(s.category || "General")}</b></div>
        ${s.version ? `<div class="sd-meta-row"><span>Version</span><b>${escapeHtml(s.version)}</b></div>` : ""}
        ${s.updated ? `<div class="sd-meta-row"><span>Updated</span><b>${escapeHtml(formatDate(s.updated))}</b></div>` : ""}
        ${s.author ? `<div class="sd-meta-row"><span>Author</span><b>${escapeHtml(s.author)}</b></div>` : ""}
        <div class="sd-meta-row"><span>Files</span><b>${files}</b></div>
        ${hasBody ? `<button type="button" class="btn btn-primary" data-sd-dl>Download ${hasPackage(s) ? "package (.zip)" : s.platform === "Claude" ? "SKILL.md" : "Markdown"}</button>` : ""}
        ${hasBody ? `<button type="button" class="btn" data-sd-copy2>Copy instructions</button>` : ""}
        <button type="button" class="btn" data-sd-link>Copy share link</button>
        ${s.link ? `<a class="btn" href="${escapeHtml(s.link)}" target="_blank" rel="noopener">Open source ↗</a>` : ""}
        ${admin ? `<button type="button" class="btn" data-sd-edit>Edit</button><button type="button" class="btn btn-ghost btn-danger" data-sd-del>Delete</button>` : ""}
      </aside>
    </div>`;

  const q = (sel) => view.querySelector(sel);
  q("[data-sd-fav]").onclick = (e) => {
    toggleSkillFavorite(s.id);
    const on = isSkillFavorite(s.id);
    e.currentTarget.classList.toggle("on", on);
    e.currentTarget.textContent = on ? "★" : "☆";
    e.currentTarget.setAttribute("aria-pressed", String(on));
  };
  q("[data-sd-copy]")?.addEventListener("click", () => copyText(s.instructions, "Skill instructions copied"));
  q("[data-sd-copy2]")?.addEventListener("click", () => copyText(s.instructions, "Skill instructions copied"));
  view.querySelectorAll("[data-rescopy]").forEach((b) =>
    b.addEventListener("click", (e) => {
      e.preventDefault(); // keep the <details> from toggling
      copyText(s.resources[Number(b.dataset.rescopy)].text, "File copied");
    })
  );
  q("[data-sd-dl]")?.addEventListener("click", () => downloadSkill(s));
  q("[data-sd-link]").addEventListener("click", () => copyText(skillURL(s), "Link copied"));
  q("[data-sd-edit]")?.addEventListener("click", () => openForm(s));
  q("[data-sd-del]")?.addEventListener("click", async () => {
    if (!confirm(`Delete skill "${s.name}"?`)) return;
    try {
      await api.deleteSkillApi(s.id);
      toast("Deleted");
      await refresh();
      navigate("/skills", { replace: true });
    } catch (e) {
      toast(e.message);
    }
  });
}

// ---------- create / edit form (admin) ----------
function setStatus(m, isErr = false) {
  refs.status.textContent = m;
  refs.status.classList.toggle("error", isErr);
}

// ---------- import existing skills (SKILL.md / .zip / .skill / .json) ----------
// Parse a SKILL.md: optional YAML frontmatter (name, description, version,
// author — description may be a JSON-quoted scalar, which is how this site
// emits it), body becomes the instructions.
function parseSkillMarkdown(text) {
  const out = { instructions: text.trim(), hasFrontmatter: false };
  const m = text.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
  if (!m) return out;
  out.hasFrontmatter = true;
  out.instructions = text.slice(m[0].length).trim();
  for (const line of m[1].split(/\r?\n/)) {
    const kv = line.match(/^(name|description|version|author):\s*(.*)$/);
    if (!kv) continue;
    let v = kv[2].trim();
    if (v.startsWith('"')) {
      try {
        v = JSON.parse(v);
      } catch {
        v = v.replace(/^"+|"+$/g, "");
      }
    }
    out[kv[1]] = v;
  }
  return out;
}

// "ai-fingerprint" / "meeting-notes.skill.zip" -> "Ai Fingerprint" / "Meeting Notes"
function titleize(s) {
  let out = String(s || "");
  // Strip stacked extensions (e.g. ".skill.zip").
  for (let prev = ""; prev !== out; ) {
    prev = out;
    out = out.replace(/\.(md|markdown|txt|zip|skill|json)$/i, "");
  }
  return out.replace(/[-_]+/g, " ").trim().replace(/\b\w/g, (c) => c.toUpperCase());
}

// Minimal zip reader — enough to list entries and extract text files. Uses the
// central directory for names/sizes and DecompressionStream for deflate, so no
// library is needed (CSP allows same-origin scripts only).
async function readZip(file) {
  const buf = new Uint8Array(await file.arrayBuffer());
  const dv = new DataView(buf.buffer);
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 22 - 65535); i--) {
    if (dv.getUint32(i, true) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error("That doesn't look like a valid .zip file.");
  const count = dv.getUint16(eocd + 10, true);
  let off = dv.getUint32(eocd + 16, true);
  const entries = [];
  for (let i = 0; i < count; i++) {
    if (dv.getUint32(off, true) !== 0x02014b50) break;
    const method = dv.getUint16(off + 10, true);
    const csize = dv.getUint32(off + 20, true);
    const nameLen = dv.getUint16(off + 28, true);
    const extraLen = dv.getUint16(off + 30, true);
    const cmtLen = dv.getUint16(off + 32, true);
    const lho = dv.getUint32(off + 42, true);
    const name = new TextDecoder().decode(buf.subarray(off + 46, off + 46 + nameLen));
    entries.push({ name, method, csize, lho });
    off += 46 + nameLen + extraLen + cmtLen;
  }
  const readBytes = async (e) => {
    // The local header's own name/extra lengths locate the data (they can
    // differ from the central directory's).
    const lnameLen = dv.getUint16(e.lho + 26, true);
    const lextraLen = dv.getUint16(e.lho + 28, true);
    const start = e.lho + 30 + lnameLen + lextraLen;
    const data = buf.slice(start, start + e.csize);
    if (e.method === 0) return data;
    if (e.method === 8) {
      const ds = new DecompressionStream("deflate-raw");
      const ab = await new Response(new Blob([data]).stream().pipeThrough(ds)).arrayBuffer();
      return new Uint8Array(ab);
    }
    throw new Error(`Unsupported zip compression (method ${e.method}).`);
  };
  // fatal: true rejects binary files instead of silently mangling them.
  const readText = async (e, fatal = false) => new TextDecoder("utf-8", { fatal }).decode(await readBytes(e));
  return { entries, readText };
}

function fillFormFromImport(parsed, files, filename) {
  refs.name.value = titleize(parsed.name) || titleize(filename) || refs.name.value;
  if (parsed.description) refs.description.value = parsed.description;
  refs.instructions.value = parsed.instructions || "";
  if (parsed.version) refs.version.value = parsed.version;
  if (parsed.author) refs.author.value = parsed.author;
  if (files.length) refs.files.value = files.join(", ");
  // Frontmatter means it's a Claude SKILL.md package.
  if (parsed.hasFrontmatter) refs.platform.value = "Claude";
}

// Captured package files shown in the editor, each removable.
function renderFormResources() {
  const box = refs.resources;
  if (!box) return;
  box.hidden = !formResources.length;
  box.innerHTML = formResources.length
    ? `<span class="field-label">Package files (stored with the skill)</span>` +
      formResources
        .map(
          (r, i) =>
            `<div class="resource-row"><span class="resource-path">${escapeHtml(r.path)}</span><span class="muted">${(r.text.length / 1024).toFixed(1)} KB</span><button type="button" class="btn btn-sm btn-ghost btn-danger" data-resdel="${i}" aria-label="Remove ${escapeHtml(r.path)}">✕</button></div>`
        )
        .join("")
    : "";
  box.querySelectorAll("[data-resdel]").forEach((b) =>
    b.addEventListener("click", () => {
      formResources.splice(Number(b.dataset.resdel), 1);
      renderFormResources();
    })
  );
}

// ---------- post-import auto-fill + "still needed" checklist ----------
// After an upload, Claude fills in whatever the file didn't declare; anything
// that still needs a human answer is surfaced as a highlighted checklist.
const CHECKLIST_FIELDS = [
  ["description", "Add a one-line description"],
  ["category", "Pick a category"],
  ["tags", "Add a few tags"],
  ["version", "Set a version (e.g. 1.0)"],
  ["author", "Say who built it"],
];
let checklistActive = false;

function missingFields() {
  return CHECKLIST_FIELDS.filter(([k]) => !refs[k].value.trim());
}

function renderChecklist() {
  const box = refs.checklist;
  if (!box) return;
  for (const [k] of CHECKLIST_FIELDS) {
    refs[k].closest(".field")?.classList.toggle("field-attn", checklistActive && !refs[k].value.trim());
  }
  const missing = checklistActive ? missingFields() : [];
  if (!missing.length) {
    box.hidden = true;
    box.innerHTML = "";
    return;
  }
  box.hidden = false;
  box.innerHTML =
    `<span class="checklist-label">Still needed:</span>` +
    missing
      .map(([k, label]) => `<button type="button" class="btn btn-sm" data-focus="${k}">${escapeHtml(label)}</button>`)
      .join("");
  box.querySelectorAll("[data-focus]").forEach((b) =>
    b.addEventListener("click", () => refs[b.dataset.focus].focus())
  );
}

// Ask the server to infer metadata from the uploaded instructions, filling
// only fields the file (or the admin) hasn't already set. `platformImplied`
// stops the AI from second-guessing a platform the file declared.
async function autoCompleteImport(filename, platformImplied, statusSuffix = "") {
  checklistActive = true;
  const instructions = refs.instructions.value.trim();
  const missing = missingFields().map(([k]) => k);
  if (!instructions || !["description", "category", "tags"].some((k) => missing.includes(k))) {
    setStatus(`Imported — review and Save.${statusSuffix}`);
    renderChecklist();
    return;
  }
  setStatus("Imported — asking Claude to fill in the details…");
  try {
    const { meta } = await api.analyzeSkill({ instructions, name: refs.name.value.trim(), filename });
    if (!refs.description.value.trim() && meta.description) refs.description.value = meta.description;
    if (!refs.category.value.trim() && meta.category) refs.category.value = meta.category;
    if (!refs.tags.value.trim() && meta.tags?.length) refs.tags.value = meta.tags.join(", ");
    if (!refs.notes.value.trim() && meta.notes) refs.notes.value = meta.notes;
    if (!platformImplied && PLATFORMS.includes(meta.platform)) refs.platform.value = meta.platform;
    if (!refs.name.value.trim() && meta.name) refs.name.value = meta.name;
    const left = missingFields();
    setStatus(
      (left.length
        ? "Auto-filled with Claude — a few details still need you (highlighted)."
        : "Auto-filled with Claude — review and Save.") + statusSuffix
    );
  } catch (e) {
    setStatus(`Imported. AI auto-fill unavailable (${e.message}) — fill the highlighted fields.${statusSuffix}`);
  }
  renderChecklist();
}

async function importSkillFile(file) {
  const ext = (file.name.toLowerCase().match(/\.([a-z0-9]+)$/) || [])[1] || "";
  setStatus(`Reading ${file.name}…`);
  try {
    if (ext === "json") {
      const parsed = JSON.parse(await file.text());
      if (Array.isArray(parsed)) {
        await bulkImport(parsed);
        return;
      }
      fillFormFromImport(
        { ...parsed, hasFrontmatter: parsed.platform === "Claude", instructions: parsed.instructions || "" },
        parsed.files || [],
        file.name
      );
      if (parsed.platform) refs.platform.value = PLATFORMS.includes(parsed.platform) ? parsed.platform : "Other";
      if (parsed.category) refs.category.value = parsed.category;
      if (parsed.tags) refs.tags.value = Array.isArray(parsed.tags) ? parsed.tags.join(", ") : String(parsed.tags);
      if (parsed.link) refs.link.value = parsed.link;
      if (parsed.notes) refs.notes.value = parsed.notes;
      await autoCompleteImport(file.name, !!parsed.platform);
      return;
    }
    if (ext === "zip" || ext === "skill") {
      const { entries, readText } = await readZip(file);
      const files = entries.filter((e) => !e.name.endsWith("/")).map((e) => e.name);
      const md = entries.find((e) => /(^|\/)skill\.md$/i.test(e.name));
      if (!md) throw new Error("No SKILL.md found inside the archive.");
      const parsed = parseSkillMarkdown(await readText(md));
      fillFormFromImport(parsed, files, file.name);
      // Capture every text file that ships with the skill (references,
      // patterns, scripts…) so the download can rebuild the full package.
      formResources = [];
      let skipped = 0;
      for (const e of entries) {
        if (e === md || e.name.endsWith("/")) continue;
        if (formResources.length >= 20 || e.csize > 400000) {
          skipped++;
          continue;
        }
        try {
          formResources.push({ path: e.name, text: (await readText(e, true)).slice(0, 200000) });
        } catch {
          skipped++; // binary file (images etc.) — listed in Files, not stored
        }
      }
      renderFormResources();
      await autoCompleteImport(
        file.name,
        parsed.hasFrontmatter,
        (formResources.length ? ` Captured ${formResources.length} package file${formResources.length === 1 ? "" : "s"}.` : "") +
          (skipped ? ` ${skipped} binary/oversized file${skipped === 1 ? "" : "s"} listed but not stored.` : "")
      );
      return;
    }
    // .md / .markdown / .txt
    const parsed = parseSkillMarkdown(await file.text());
    fillFormFromImport(parsed, [], file.name);
    await autoCompleteImport(file.name, parsed.hasFrontmatter);
  } catch (e) {
    setStatus(`Import failed: ${e.message}`, true);
  }
}

// A .json array bulk-saves every skill in it (shared store, admin-gated).
async function bulkImport(items) {
  let ok = 0;
  let firstError = "";
  for (const item of items) {
    try {
      await api.saveSkill({ skill: item });
      ok++;
    } catch (e) {
      if (!firstError) firstError = e.message;
    }
  }
  await refresh();
  if (ok === items.length) {
    toast(`Imported ${ok} skills`);
    closeModal(refs.modal);
  } else {
    setStatus(`Imported ${ok}/${items.length} skills.${firstError ? ` First error: ${firstError}` : ""}`, ok === 0);
  }
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
  refs.version.value = s?.version || "";
  refs.author.value = s?.author || "";
  refs.files.value = (s?.files || []).join(", ");
  refs.nl.value = "";
  formResources = (s?.resources || []).map((r) => ({ ...r }));
  renderFormResources();
  checklistActive = false;
  renderChecklist();
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
    if (!refs.version.value) refs.version.value = "1.0";
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
    version: refs.version.value.trim(),
    author: refs.author.value.trim(),
    files: refs.files.value,
    resources: formResources,
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

export function initSkills(opts = {}) {
  navigate = opts.navigate || (() => {});
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
    version: el("sVersion"),
    author: el("sAuthor"),
    files: el("sFiles"),
    nl: el("sNl"),
    gen: el("sGenerate"),
    save: el("sSave"),
    status: el("sStatus"),
    newBtn: el("newSkillBtn"),
    dropzone: el("sDropzone"),
    file: el("sFile"),
    checklist: el("sChecklist"),
    resources: el("sResources"),
  };
  // The "still needed" checklist tracks typing after an import.
  for (const [k] of CHECKLIST_FIELDS) {
    refs[k].addEventListener("input", () => {
      if (checklistActive) renderChecklist();
    });
  }
  wireModalDismiss(refs.modal);
  refs.newBtn.addEventListener("click", () => openForm());
  refs.gen.addEventListener("click", onGenerate);
  refs.save.addEventListener("click", onSave);

  // Upload an existing skill: click, keyboard, or drag & drop onto the zone.
  refs.dropzone.addEventListener("click", () => refs.file.click());
  refs.dropzone.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      refs.file.click();
    }
  });
  refs.file.addEventListener("change", async (e) => {
    const f = e.target.files?.[0];
    if (f) await importSkillFile(f);
    refs.file.value = "";
  });
  for (const ev of ["dragover", "dragenter"]) {
    refs.dropzone.addEventListener(ev, (e) => {
      e.preventDefault();
      refs.dropzone.classList.add("dragover");
    });
  }
  for (const ev of ["dragleave", "drop"]) {
    refs.dropzone.addEventListener(ev, (e) => {
      e.preventDefault();
      refs.dropzone.classList.remove("dragover");
    });
  }
  refs.dropzone.addEventListener("drop", async (e) => {
    const f = e.dataTransfer?.files?.[0];
    if (f) await importSkillFile(f);
  });

  return {
    // /skills — the hub.
    showHub: async () => {
      detailSlug = null;
      await ensureLoaded();
      render();
    },
    // /skills/<slug> — a skill's own page.
    openBySlug: async (slug) => {
      detailSlug = slug;
      render(); // skeleton/instant if already loaded
      await ensureLoaded();
      render();
    },
    rerender: render,
    setQuery: (q) => {
      query = q;
      if (view && !view.closest("section")?.hidden && detailSlug) {
        // Searching from a detail page returns to the filtered hub.
        detailSlug = null;
        navigate("/skills", { replace: true });
      }
      if (view && !view.closest("section")?.hidden) render();
    },
  };
}
