// Style cards and the detail modal (palette, both prompts, admin image generation).
import { escapeHtml, highlight, copyText, toast, openModal, wireModalDismiss } from "./ui.js";
import { toImagePrompt } from "./imagePrompt.js";
import { isFavorite, toggleFavorite } from "./storage.js";
import * as api from "./api.js";

function swatchRow(palette) {
  return (palette || [])
    .map(
      (hex) =>
        `<button type="button" class="swatch" style="background:${escapeHtml(hex)}" data-hex="${escapeHtml(
          hex
        )}" title="${escapeHtml(hex)} — copy" aria-label="Copy ${escapeHtml(hex)}"></button>`
    )
    .join("");
}

function favBtn(style) {
  const on = isFavorite(style.id);
  return `<button type="button" class="fav ${on ? "on" : ""}" data-fav aria-pressed="${on}" title="${
    on ? "Unfavorite" : "Favorite"
  }">${on ? "★" : "☆"}</button>`;
}

export function buildCard(style, ctx, query = "") {
  const card = document.createElement("article");
  card.className = "card";
  card.tabIndex = 0;
  card.setAttribute("role", "button");
  card.setAttribute("aria-label", `Open ${style.style}`);

  card.innerHTML = `
    ${style.sampleImage ? `<img class="card-thumb" loading="lazy" alt="" src="${escapeHtml(style.sampleImage)}" />` : ""}
    <div class="card-body">
      <div class="card-head">
        <div class="card-title">${highlight(style.style || "Untitled style", query)}</div>
        ${favBtn(style)}
      </div>
      ${style.category ? `<div class="card-category">${highlight(style.category, query)}</div>` : ""}
    </div>
    ${style.palette?.length ? `<div class="swatches">${swatchRow(style.palette)}</div>` : ""}
    <div class="card-actions">
      <button type="button" class="btn btn-sm btn-ghost" data-img-prompt>Copy image prompt</button>
    </div>
  `;

  // the whole card opens the detail modal (click anywhere but the controls)
  const open = () => openDetail(style, ctx);
  card.addEventListener("click", (e) => {
    if (e.target.closest("button")) return;
    open();
  });
  card.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      open();
    }
  });
  card.querySelector("[data-img-prompt]").addEventListener("click", () =>
    copyText(toImagePrompt(style), "Image prompt copied")
  );
  card.querySelectorAll(".swatch").forEach((sw) =>
    sw.addEventListener("click", () => copyText(sw.dataset.hex, sw.dataset.hex))
  );
  const fav = card.querySelector("[data-fav]");
  fav.addEventListener("click", () => {
    const on = toggleFavorite(style.id);
    fav.classList.toggle("on", on);
    fav.textContent = on ? "★" : "☆";
    fav.setAttribute("aria-pressed", String(on));
    document.dispatchEvent(new CustomEvent("favorites-changed"));
  });

  return card;
}

function fieldBlock(label, value) {
  if (!value) return "";
  return `<div class="detail-field"><span class="detail-label">${label}</span><span>${escapeHtml(value)}</span></div>`;
}

export function openDetail(style, ctx) {
  const modal = document.getElementById("detailModal");
  const body = document.getElementById("detailBody");
  // Wire the close (✕) button and backdrop dismissal once; delegation on the
  // modal container survives the innerHTML rebuild below.
  if (!modal._dismissWired) {
    wireModalDismiss(modal);
    modal._dismissWired = true;
  }
  const imagePrompt = toImagePrompt(style);

  const adminBar =
    ctx.admin()
      ? `<div class="detail-admin">
           <button type="button" class="btn btn-sm" data-edit>Edit style</button>
           <button type="button" class="btn btn-sm" data-remix>Remix with AI</button>
           <button type="button" class="btn btn-sm btn-danger" data-delete>Delete</button>
         </div>`
      : "";

  body.innerHTML = `
    <div class="detail-head">
      <div>
        <h2 id="detailTitle">${escapeHtml(style.style || "Untitled")}</h2>
        <div class="badges">
          ${style.category ? `<span class="badge">${escapeHtml(style.category)}</span>` : ""}
          ${style._custom ? `<span class="badge">Custom</span>` : ""}
          ${style._edited ? `<span class="badge">Edited</span>` : ""}
        </div>
      </div>
      <button type="button" class="btn btn-icon" data-close aria-label="Close">✕</button>
    </div>

    ${style.sampleImage ? `<img class="detail-image" alt="Sample for ${escapeHtml(style.style)}" src="${escapeHtml(style.sampleImage)}" />` : ""}

    ${
      style.palette?.length
        ? `<div class="detail-palette">
             <div class="swatches lg">${swatchRow(style.palette)}</div>
             <div class="palette-actions">
               <button type="button" class="btn btn-sm" data-copy-hex>Copy all hex</button>
               <button type="button" class="btn btn-sm" data-copy-css>Copy as CSS vars</button>
             </div>
           </div>`
        : ""
    }

    <div class="detail-grid">
      ${fieldBlock("Type", style.type)}
      ${fieldBlock("Icons", style.icons)}
      ${fieldBlock("Layout", style.layout)}
      ${fieldBlock("Charts", style.charts)}
      ${fieldBlock("Background", style.background)}
      ${fieldBlock("Avoid", style.avoid)}
    </div>

    <div class="prompt-block">
      <div class="prompt-head"><span>OpenAI image prompt</span>
        <button type="button" class="btn btn-sm" data-copy-img>Copy</button></div>
      <pre class="prompt-text">${escapeHtml(imagePrompt)}</pre>
    </div>

    ${
      style.notebookLMPrompt
        ? `<div class="prompt-block">
             <div class="prompt-head"><span>NotebookLM prompt</span>
               <button type="button" class="btn btn-sm" data-copy-nb>Copy</button></div>
             <pre class="prompt-text">${escapeHtml(style.notebookLMPrompt)}</pre>
           </div>`
        : ""
    }

    ${adminBar}
  `;

  // wire copies
  body.querySelector("[data-copy-img]").addEventListener("click", () => copyText(imagePrompt, "Image prompt copied"));
  body.querySelector("[data-copy-nb]")?.addEventListener("click", () =>
    copyText(style.notebookLMPrompt, "NotebookLM prompt copied")
  );
  body.querySelectorAll(".swatch").forEach((sw) =>
    sw.addEventListener("click", () => copyText(sw.dataset.hex, sw.dataset.hex))
  );
  body.querySelector("[data-copy-hex]")?.addEventListener("click", () =>
    copyText((style.palette || []).join(" "), "Palette copied")
  );
  body.querySelector("[data-copy-css]")?.addEventListener("click", () => {
    const css = ":root {\n" + (style.palette || []).map((h, i) => `  --color-${i + 1}: ${h};`).join("\n") + "\n}";
    copyText(css, "CSS variables copied");
  });

  // admin actions
  body.querySelector("[data-edit]")?.addEventListener("click", () => ctx.onEdit(style));
  body.querySelector("[data-remix]")?.addEventListener("click", () => ctx.onRemix(style));
  body.querySelector("[data-delete]")?.addEventListener("click", async () => {
    if (!confirm(`Delete "${style.style}"? This affects everyone.`)) return;
    try {
      await api.deleteStyle({ id: style.id, kind: ctx.kindOf(style.id) });
      toast("Deleted");
      ctx.afterChange();
      document.getElementById("detailModal").hidden = true;
    } catch (err) {
      toast(err.message);
    }
  });

  openModal(modal);
}
