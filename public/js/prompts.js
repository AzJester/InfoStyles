// LLM prompt library: a second section (Valkey-backed) for reusable prompts.
import * as api from "./api.js";
import { adminState } from "./admin.js";
import { getModel } from "./storage.js";
import { escapeHtml, copyWithVariables, toast, openModal, closeModal, wireModalDismiss } from "./ui.js";

let list = [];
let query = "";
let loaded = false;
let editId = null;
let view, refs;

function byId(id) {
  return list.find((p) => p.id === id);
}

function filtered() {
  const q = query.trim().toLowerCase();
  if (!q) return list;
  return list.filter((p) =>
    [p.title, p.category, p.body, (p.tags || []).join(" "), (p.models || []).join(" ")]
      .join(" ")
      .toLowerCase()
      .includes(q)
  );
}

function cardHTML(p, admin) {
  const tags = (p.tags || []).map((t) => `<span class="badge">${escapeHtml(t)}</span>`).join("");
  const models = (p.models || []).join(", ");
  const preview = p.body.length > 240 ? p.body.slice(0, 240) + "…" : p.body;
  return `<article class="card prompt-card">
    <div class="card-title">${escapeHtml(p.title)}</div>
    <div class="card-category">${escapeHtml(p.category)}${models ? ` · ${escapeHtml(models)}` : ""}</div>
    ${tags ? `<div class="badges">${tags}</div>` : ""}
    <pre class="prompt-preview">${escapeHtml(preview)}</pre>
    <div class="card-actions always">
      <button type="button" class="btn btn-sm" data-copy="${escapeHtml(p.id)}">Copy</button>
      ${
        admin
          ? `<button type="button" class="btn btn-sm" data-edit="${escapeHtml(p.id)}">Edit</button>
             <button type="button" class="btn btn-sm btn-ghost btn-danger" data-del="${escapeHtml(p.id)}">Delete</button>`
          : ""
      }
    </div>
  </article>`;
}

function render() {
  if (!view) return;
  const admin = adminState().admin;
  const items = filtered();
  if (!items.length) {
    view.innerHTML = `<div class="empty">${
      !loaded ? "Loading…" : query ? "No prompts match your search." : "No prompts yet."
    }${loaded && admin && !query ? ' Use "+ New prompt" to add one.' : ""}</div>`;
    return;
  }
  view.innerHTML = `<div class="gallery">${items.map((p) => cardHTML(p, admin)).join("")}</div>`;
  view.querySelectorAll("[data-copy]").forEach((btn) =>
    btn.addEventListener("click", () => copyWithVariables(byId(btn.dataset.copy).body, "Prompt copied"))
  );
  view.querySelectorAll("[data-edit]").forEach((btn) =>
    btn.addEventListener("click", () => openForm(byId(btn.dataset.edit)))
  );
  view.querySelectorAll("[data-del]").forEach((btn) =>
    btn.addEventListener("click", async () => {
      const p = byId(btn.dataset.del);
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
  setStatus("");
  openModal(refs.modal);
}

async function onGenerate() {
  const d = refs.nl.value.trim();
  if (!d) {
    setStatus("Describe the prompt first.", true);
    return;
  }
  refs.gen.disabled = true;
  setStatus("Generating…");
  try {
    const { prompt } = await api.generatePrompt({ description: d, model: getModel() });
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
  const r = await api.getPrompts();
  list = r.prompts || [];
  loaded = true;
}

async function refresh() {
  const r = await api.getPrompts();
  list = r.prompts || [];
  loaded = true;
  render();
}

export function initPrompts() {
  view = document.getElementById("promptsView");
  refs = {
    modal: document.getElementById("promptModal"),
    modalTitle: document.getElementById("pModalTitle"),
    title: document.getElementById("pTitle"),
    category: document.getElementById("pCategory"),
    models: document.getElementById("pModels"),
    tags: document.getElementById("pTags"),
    body: document.getElementById("pBody"),
    notes: document.getElementById("pNotes"),
    nl: document.getElementById("pNl"),
    gen: document.getElementById("pGenerate"),
    save: document.getElementById("pSave"),
    status: document.getElementById("pStatus"),
    newBtn: document.getElementById("newPromptBtn"),
  };
  wireModalDismiss(refs.modal);
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
  };
}
