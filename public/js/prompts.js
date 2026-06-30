// LLM prompt library: a second section (Valkey-backed) for reusable prompts,
// with saved outputs and copy-time customization (tone/audience/length/format).
import * as api from "./api.js";
import { adminState } from "./admin.js";
import { extractVariables, applyVariables } from "./imagePrompt.js";
import { escapeHtml, copyText, toast, openModal, closeModal, wireModalDismiss } from "./ui.js";
import { getPromptView, setPromptView } from "./storage.js";

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

let list = [];
let query = "";
let loaded = false;
let editId = null;
let formResults = [];
let viewMode = "list"; // "grid" | "list"
let activeTags = new Set(); // lowercased tag names; AND-combined
let view, refs;

const byId = (id) => list.find((p) => p.id === id);

// Tags across all prompts, with counts, most-used first.
function allTags() {
  const counts = new Map();
  for (const p of list) for (const t of p.tags || []) counts.set(t, (counts.get(t) || 0) + 1);
  return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
}

function filtered() {
  const q = query.trim().toLowerCase();
  return list.filter((p) => {
    if (activeTags.size) {
      const tset = new Set((p.tags || []).map((t) => t.toLowerCase()));
      for (const t of activeTags) if (!tset.has(t)) return false;
    }
    if (!q) return true;
    return [p.title, p.category, p.body, (p.tags || []).join(" "), (p.models || []).join(" ")]
      .join(" ")
      .toLowerCase()
      .includes(q);
  });
}

function cardHTML(p, admin) {
  const tags = (p.tags || []).map((t) => `<span class="badge">${escapeHtml(t)}</span>`).join("");
  const models = (p.models || []).join(", ");
  const preview = p.body.length > 240 ? p.body.slice(0, 240) + "…" : p.body;
  const nResults = (p.results || []).length;
  return `<article class="card prompt-card">
    <div class="card-title">${escapeHtml(p.title)}</div>
    <div class="card-category">${escapeHtml(p.category)}${models ? ` · ${escapeHtml(models)}` : ""}</div>
    ${tags ? `<div class="badges">${tags}</div>` : ""}
    <pre class="prompt-preview">${escapeHtml(preview)}</pre>
    <div class="card-actions always">
      <button type="button" class="btn btn-sm btn-primary" data-use="${escapeHtml(p.id)}">Copy</button>
      ${nResults ? `<button type="button" class="btn btn-sm" data-results="${escapeHtml(p.id)}">Outputs (${nResults})</button>` : ""}
      ${
        admin
          ? `<button type="button" class="btn btn-sm" data-edit="${escapeHtml(p.id)}">Edit</button>
             <button type="button" class="btn btn-sm btn-ghost btn-danger" data-del="${escapeHtml(p.id)}">Delete</button>`
          : ""
      }
    </div>
  </article>`;
}

function controlsHTML() {
  const tags = allTags();
  const chips = tags
    .map(
      ([t, n]) =>
        `<button type="button" class="chip ${activeTags.has(t.toLowerCase()) ? "active" : ""}" data-tag="${escapeHtml(t)}">${escapeHtml(t)} <span class="chip-n">${n}</span></button>`
    )
    .join("");
  return `<div class="prompts-controls">
    <div class="seg-group" role="group" aria-label="Prompt layout">
      <button type="button" class="seg ${viewMode === "list" ? "active" : ""}" data-pview="list" aria-pressed="${viewMode === "list"}" title="List view">☰ List</button>
      <button type="button" class="seg ${viewMode === "grid" ? "active" : ""}" data-pview="grid" aria-pressed="${viewMode === "grid"}" title="Grid view">▦ Grid</button>
    </div>
    ${
      tags.length
        ? `<div class="prompt-tags" aria-label="Filter by tag">${chips}${
            activeTags.size ? `<button type="button" class="chip chip-clear" data-tag-clear>Clear tags</button>` : ""
          }</div>`
        : ""
    }
  </div>`;
}

function render() {
  if (!view) return;
  const admin = adminState().admin;
  const items = filtered();
  const hasFilter = !!query.trim() || activeTags.size > 0;
  const body = !items.length
    ? `<div class="empty">${
        !loaded ? "Loading…" : hasFilter ? "No prompts match your filters." : "No prompts yet."
      }${loaded && admin && !hasFilter ? ' Use "+ New prompt" to add one.' : ""}</div>`
    : `<div class="gallery ${viewMode === "list" ? "gallery--list" : ""}">${items.map((p) => cardHTML(p, admin)).join("")}</div>`;
  view.innerHTML = controlsHTML() + body;

  view.querySelectorAll("[data-pview]").forEach((b) =>
    b.addEventListener("click", () => {
      viewMode = b.dataset.pview === "grid" ? "grid" : "list";
      setPromptView(viewMode);
      render();
    })
  );
  view.querySelectorAll("[data-tag]").forEach((b) =>
    b.addEventListener("click", () => {
      const t = b.dataset.tag.toLowerCase();
      if (activeTags.has(t)) activeTags.delete(t);
      else activeTags.add(t);
      render();
    })
  );
  const clr = view.querySelector("[data-tag-clear]");
  if (clr) clr.addEventListener("click", () => { activeTags.clear(); render(); });

  view.querySelectorAll("[data-use]").forEach((b) => b.addEventListener("click", () => openUse(byId(b.dataset.use))));
  view.querySelectorAll("[data-results]").forEach((b) => b.addEventListener("click", () => openResults(byId(b.dataset.results))));
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

// ---------- customize & copy ----------
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
  refs.useCopy.onclick = () => {
    const values = {};
    refs.useVars.querySelectorAll("[data-uvar]").forEach((i) => (values[i.dataset.uvar] = i.value));
    const lengthInstr = (KNOBS.length.find((l) => l[0] === refs.useLength.value) || ["", ""])[1];
    const text = augment(applyVariables(p.body, values), {
      tone: refs.useTone.value,
      audience: refs.useAudience.value,
      length: lengthInstr,
      format: refs.useFormat.value,
    });
    closeModal(refs.useModal);
    copyText(text, "Prompt copied");
  };
  openModal(refs.useModal);
}

// ---------- saved outputs viewer ----------
function openResults(p) {
  refs.resTitle.textContent = `Saved outputs — ${p.title}`;
  refs.resBody.innerHTML = (p.results || [])
    .map(
      (r, i) =>
        `<div class="result-item">
           <div class="result-head"><span class="badge">${escapeHtml(r.model || "unknown model")}</span>
             ${r.at ? `<span class="muted">${escapeHtml(new Date(r.at).toLocaleDateString())}</span>` : ""}
             <button type="button" class="btn btn-sm" data-rcopy="${i}">Copy</button></div>
           <pre class="prompt-preview">${escapeHtml(r.output)}</pre>
         </div>`
    )
    .join("");
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
               <pre class="prompt-preview">${escapeHtml(r.output)}</pre>
             </div>`
        )
        .join("")
    : `<p class="field-help">No saved outputs yet.</p>`;
  refs.results.querySelectorAll("[data-rdel]").forEach((b) =>
    b.addEventListener("click", () => {
      formResults.splice(Number(b.dataset.rdel), 1);
      renderFormResults();
    })
  );
}

function setStatus(m, isErr = false) {
  refs.status.textContent = m;
  refs.status.classList.toggle("error", isErr);
}

function openForm(p) {
  editId = p?.id || null;
  refs.modalTitle.textContent = p ? "Edit prompt" : "New prompt";
  refs.title.value = p?.title || "";
  refs.category.value = p?.category || "";
  refs.models.value = (p?.models || []).join(", ");
  refs.tags.value = (p?.tags || []).join(", ");
  refs.body.value = p?.body || "";
  refs.notes.value = p?.notes || "";
  refs.nl.value = "";
  formResults = (p?.results || []).map((r) => ({ ...r }));
  refs.resultModel.value = "";
  refs.resultOutput.value = "";
  renderFormResults();
  setStatus("");
  openModal(refs.modal);
}

function addFormResult() {
  const output = refs.resultOutput.value.trim();
  if (!output) {
    setStatus("Paste the output before adding it.", true);
    return;
  }
  formResults.unshift({ model: refs.resultModel.value.trim(), output, at: new Date().toISOString() });
  refs.resultModel.value = "";
  refs.resultOutput.value = "";
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
    refs.models.value = (prompt.models || []).join(", ");
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
    models: refs.models.value,
    tags: refs.tags.value,
    body: refs.body.value.trim(),
    notes: refs.notes.value.trim(),
    results: formResults,
  };
  if (!prompt.title || !prompt.body) {
    setStatus("Title and body are required.", true);
    return;
  }
  refs.save.disabled = true;
  setStatus("Saving…");
  try {
    await api.savePrompt({ id: editId || undefined, prompt });
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
  list = (await api.getPrompts()).prompts || [];
  loaded = true;
}
async function refresh() {
  list = (await api.getPrompts()).prompts || [];
  loaded = true;
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
    models: el("pModels"),
    tags: el("pTags"),
    body: el("pBody"),
    notes: el("pNotes"),
    nl: el("pNl"),
    gen: el("pGenerate"),
    save: el("pSave"),
    status: el("pStatus"),
    newBtn: el("newPromptBtn"),
    results: el("pResults"),
    resultModel: el("pResultModel"),
    resultOutput: el("pResultOutput"),
    resultAdd: el("pResultAdd"),
    // use (customize & copy) modal
    useModal: el("promptUseModal"),
    useTitle: el("puTitle"),
    useVars: el("puVars"),
    useTone: el("puTone"),
    useAudience: el("puAudience"),
    useLength: el("puLength"),
    useFormat: el("puFormat"),
    useCopy: el("puCopy"),
    // results viewer modal
    resModal: el("promptResultsModal"),
    resTitle: el("prTitle"),
    resBody: el("prBody"),
  };
  wireModalDismiss(refs.modal);
  wireModalDismiss(refs.useModal);
  wireModalDismiss(refs.resModal);
  fillKnob(refs.useTone, KNOBS.tone);
  fillKnob(refs.useAudience, KNOBS.audience);
  fillKnob(refs.useLength, KNOBS.length);
  fillKnob(refs.useFormat, KNOBS.format);
  refs.newBtn.addEventListener("click", () => openForm());
  refs.gen.addEventListener("click", onGenerate);
  refs.save.addEventListener("click", onSave);
  refs.resultAdd.addEventListener("click", addFormResult);

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
  };
}
