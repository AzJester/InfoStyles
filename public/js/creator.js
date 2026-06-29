// Style editor: AI-assisted create, AI remix, and manual edit — all saving to the
// server (KV) so changes are global. The form doubles as the editor for old styles.
import * as api from "./api.js";
import { openModal, closeModal, wireModalDismiss, toast, escapeHtml, openLightbox } from "./ui.js";
import { MODELS, getModel, setModel } from "./storage.js";
import { toNotebookLMPrompt } from "./imagePrompt.js";

const FIELD_IDS = {
  style: "fStyle",
  type: "fType",
  icons: "fIcons",
  layout: "fLayout",
  charts: "fCharts",
  background: "fBackground",
  avoid: "fAvoid",
  notebookLMPrompt: "fNotebook",
};

export function initCreator(ctx) {
  const modal = document.getElementById("createModal");
  const el = (id) => document.getElementById(id);
  const refs = {
    title: el("createTitle"),
    nl: el("nlInput"),
    model: el("genModel"),
    generate: el("generateBtn"),
    status: el("createStatus"),
    category: el("fCategory"),
    categoryNew: el("fCategoryNew"),
    palette: el("fPalette"),
    palettePreview: el("palettePreview"),
    save: el("saveStyleBtn"),
    aiHint: el("aiHint"),
    sampleRow: el("sampleRow"),
    sampleFile: el("fSampleFile"),
    dropzone: el("dropzone"),
    samplePreview: el("samplePreview"),
    sampleStatus: el("sampleStatus"),
  };

  let mode = "create"; // create | edit | remix
  let currentId = null;
  let currentKind = "custom";
  let baseStyle = null;
  let images = []; // example image URLs for this style

  for (const m of MODELS) {
    const o = document.createElement("option");
    o.value = m.id;
    o.textContent = m.label;
    refs.model.appendChild(o);
  }
  refs.model.value = getModel();
  refs.model.addEventListener("change", () => setModel(refs.model.value));

  wireModalDismiss(modal);

  function setStatus(msg, isError = false) {
    refs.status.textContent = msg;
    refs.status.classList.toggle("error", isError);
  }

  function renderPalettePreview() {
    const hexes = parsePalette(refs.palette.value);
    refs.palettePreview.innerHTML = hexes
      .map((h) => `<span class="swatch sm" style="background:${escapeHtml(h)}" title="${escapeHtml(h)}"></span>`)
      .join("");
  }
  refs.palette.addEventListener("input", renderPalettePreview);

  function populateCategories(selected) {
    const cats = ctx.getCategories();
    refs.category.innerHTML =
      cats.map((c) => `<option value="${escapeHtml(c.name)}">${escapeHtml(c.name)}</option>`).join("") +
      `<option value="__new__">＋ New category…</option>`;
    if (selected && cats.some((c) => c.name === selected)) {
      refs.category.value = selected;
      refs.categoryNew.hidden = true;
    } else if (selected) {
      refs.category.value = "__new__";
      refs.categoryNew.hidden = false;
      refs.categoryNew.value = selected;
    } else {
      refs.category.value = cats[0]?.name || "__new__";
      refs.categoryNew.hidden = refs.category.value !== "__new__";
    }
  }
  refs.category.addEventListener("change", () => {
    refs.categoryNew.hidden = refs.category.value !== "__new__";
    if (!refs.categoryNew.hidden) refs.categoryNew.focus();
  });

  function renderThumbs() {
    refs.samplePreview.innerHTML = images
      .map(
        (url, i) =>
          `<div class="thumb"><img src="${escapeHtml(url)}" alt="Example ${i + 1}" data-view="${i}" />` +
          `<button type="button" class="thumb-remove" data-remove="${i}" aria-label="Remove image" title="Remove">✕</button></div>`
      )
      .join("");
    refs.samplePreview.querySelectorAll("[data-view]").forEach((img) =>
      img.addEventListener("click", () => openLightbox(images[Number(img.dataset.view)]))
    );
    refs.samplePreview.querySelectorAll("[data-remove]").forEach((btn) =>
      btn.addEventListener("click", () => {
        images.splice(Number(btn.dataset.remove), 1);
        renderThumbs();
      })
    );
  }

  async function processFiles(fileList) {
    const files = [...(fileList || [])].filter((f) => f.type.startsWith("image/"));
    if (!files.length) return;
    refs.sampleStatus.classList.remove("error");
    let done = 0;
    for (const file of files) {
      refs.sampleStatus.textContent = `Uploading ${done + 1}/${files.length}…`;
      try {
        const dataUrl = await downscale(file, 1400, 0.82);
        const { url } = await api.uploadImage(dataUrl, file.name);
        images.push(url);
        renderThumbs();
        done++;
      } catch (err) {
        refs.sampleStatus.textContent = err.message;
        refs.sampleStatus.classList.add("error");
        return;
      }
    }
    refs.sampleStatus.textContent = `${done} image${done === 1 ? "" : "s"} added ✓`;
    refs.sampleFile.value = "";
  }

  function fillForm(style) {
    for (const [key, id] of Object.entries(FIELD_IDS)) {
      document.getElementById(id).value = style[key] || "";
    }
    refs.palette.value = (style.palette || []).join(" ");
    populateCategories(style.category || "");
    renderPalettePreview();
    images = Array.isArray(style.images) && style.images.length
      ? style.images.slice()
      : style.sampleImage
        ? [style.sampleImage]
        : [];
    refs.sampleStatus.textContent = "";
    refs.sampleFile.value = "";
    renderThumbs();
  }

  function readForm() {
    const out = {};
    for (const [key, id] of Object.entries(FIELD_IDS)) {
      out[key] = document.getElementById(id).value.trim();
    }
    out.category = refs.category.value === "__new__" ? refs.categoryNew.value.trim() : refs.category.value;
    out.palette = parsePalette(refs.palette.value);
    out.images = images.slice();
    out.sampleImage = images[0] || "";
    // Guarantee a NotebookLM prompt: derive one from the fields if left blank
    // (e.g. when the style was filled in by hand rather than AI-generated).
    if (!out.notebookLMPrompt) out.notebookLMPrompt = toNotebookLMPrompt(out);
    return out;
  }

  // Drag-and-drop + click-to-browse upload (admins with the disk configured).
  refs.sampleFile.addEventListener("change", (e) => processFiles(e.target.files));
  refs.dropzone.addEventListener("click", () => refs.sampleFile.click());
  refs.dropzone.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      refs.sampleFile.click();
    }
  });
  ["dragenter", "dragover"].forEach((ev) =>
    refs.dropzone.addEventListener(ev, (e) => {
      e.preventDefault();
      refs.dropzone.classList.add("dragover");
    })
  );
  ["dragleave", "drop"].forEach((ev) =>
    refs.dropzone.addEventListener(ev, (e) => {
      e.preventDefault();
      if (ev === "dragleave" && refs.dropzone.contains(e.relatedTarget)) return;
      refs.dropzone.classList.remove("dragover");
    })
  );
  refs.dropzone.addEventListener("drop", (e) => processFiles(e.dataTransfer?.files));

  function open(modeName, style) {
    mode = modeName;
    baseStyle = null;
    setStatus("");
    refs.sampleRow.hidden = !(ctx.uploadEnabled && ctx.uploadEnabled());
    if (modeName === "edit") {
      currentId = style.id;
      currentKind = ctx.kindOf(style.id);
      refs.title.textContent = "Edit style";
      refs.aiHint.textContent = "Optionally use AI to revise, or just edit the fields below.";
      refs.nl.placeholder = "How should AI revise this style? (optional)";
      refs.nl.value = "";
      fillForm(style);
    } else if (modeName === "remix") {
      currentId = null;
      currentKind = "custom";
      baseStyle = style;
      refs.title.textContent = `Remix: ${style.style}`;
      refs.aiHint.textContent = "Describe how to adapt this style, then Generate.";
      refs.nl.placeholder = "e.g. make it darker and aimed at a finance audience";
      refs.nl.value = "";
      fillForm(style);
    } else if (modeName === "duplicate") {
      currentId = null;
      currentKind = "custom";
      refs.title.textContent = "Duplicate style";
      refs.aiHint.textContent = "A copy of the style, prefilled below. Edit and Save as a new style.";
      refs.nl.placeholder = "Optionally describe a tweak, then Generate.";
      refs.nl.value = "";
      fillForm({ ...style, style: `${style.style} (copy)` });
    } else {
      currentId = null;
      currentKind = "custom";
      refs.title.textContent = "Create a new style";
      refs.aiHint.textContent = "Describe the style, then Generate — or fill the fields in by hand.";
      refs.nl.placeholder =
        "e.g. a retro 1980s synthwave style for a marketing deck — neon grid, bold geometric headers";
      refs.nl.value = "";
      fillForm({ palette: [] });
    }
    openModal(modal);
    refs.nl.focus();
  }

  refs.generate.addEventListener("click", async () => {
    const description = refs.nl.value.trim();
    if (!description) {
      setStatus("Describe what you want first.", true);
      return;
    }
    refs.generate.disabled = true;
    setStatus("Generating…");
    try {
      const { style } = await api.generateStyle({
        description,
        model: refs.model.value,
        baseStyle: baseStyle || undefined,
        hintCategory: refs.category.value === "__new__" ? refs.categoryNew.value.trim() : refs.category.value,
        hintPalette: refs.palette.value.trim(),
      });
      fillForm(style);
      setStatus("Draft generated — review and Save.");
    } catch (err) {
      setStatus(err.message, true);
    } finally {
      refs.generate.disabled = false;
    }
  });

  refs.save.addEventListener("click", async () => {
    const style = readForm();
    if (!style.style) {
      setStatus("A style name is required.", true);
      return;
    }
    refs.save.disabled = true;
    setStatus("Saving…");
    try {
      const payload =
        mode === "edit" ? { kind: currentKind, id: currentId, style } : { kind: "custom", style };
      const { style: saved } = await api.saveStyle(payload);
      toast("Saved ✓");
      closeModal(modal);
      ctx.afterSave(saved);
    } catch (err) {
      setStatus(err.message, true);
    } finally {
      refs.save.disabled = false;
    }
  });

  return {
    openCreate: () => open("create"),
    openEdit: (style) => open("edit", style),
    openRemix: (style) => open("remix", style),
    openDuplicate: (style) => open("duplicate", style),
  };
}

// Downscale an image file in the browser to keep the upload small and fast.
function downscale(file, maxDim, quality) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      URL.revokeObjectURL(url);
      const scale = Math.min(1, maxDim / Math.max(img.width, img.height));
      const w = Math.max(1, Math.round(img.width * scale));
      const h = Math.max(1, Math.round(img.height * scale));
      const c = document.createElement("canvas");
      c.width = w;
      c.height = h;
      c.getContext("2d").drawImage(img, 0, 0, w, h);
      resolve(c.toDataURL("image/jpeg", quality));
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("Could not read that image file."));
    };
    img.src = url;
  });
}

function parsePalette(raw) {
  const found = String(raw || "").match(/#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})\b/g) || [];
  const seen = new Set();
  const out = [];
  for (const h of found) {
    const u = h.toUpperCase();
    if (!seen.has(u)) {
      seen.add(u);
      out.push(u);
    }
  }
  return out;
}
