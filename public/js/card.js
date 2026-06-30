// Style cards and the detail modal (palette, both prompts, admin image generation).
import { escapeHtml, highlight, copyText, copyWithVariables, toast, openModal, wireModalDismiss } from "./ui.js";
import { toImagePrompt, toNotebookLMPrompt } from "./imagePrompt.js";
import { isFavorite, toggleFavorite } from "./storage.js";
import { openLightbox } from "./ui.js";
import { bestTextColor, paletteFormats, randomPalette } from "./palette.js";
import * as api from "./api.js";

// Large detail swatches show an "Aa" in the most readable text color (contrast check).
function detailSwatchRow(palette) {
  return (palette || [])
    .map((hex) => {
      const fg = bestTextColor(hex);
      return `<button type="button" class="swatch" style="background:${escapeHtml(hex)};color:${fg}" data-hex="${escapeHtml(
        hex
      )}" title="${escapeHtml(hex)} — copy" aria-label="Copy ${escapeHtml(hex)}"><span class="swatch-aa">Aa</span></button>`;
    })
    .join("");
}

// Example images for a style (back-compat: fall back to the legacy single sampleImage).
function imagesOf(style) {
  if (Array.isArray(style.images) && style.images.length) return style.images;
  return style.sampleImage ? [style.sampleImage] : [];
}

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

  const thumb = imagesOf(style)[0];
  card.innerHTML = `
    ${thumb ? `<img class="card-thumb" loading="lazy" alt="" src="${escapeHtml(thumb)}" />` : ""}
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
      ${ctx.admin() ? `<button type="button" class="btn btn-sm btn-ghost btn-danger" data-card-delete title="Delete style">Delete</button>` : ""}
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
  card.querySelector("[data-card-delete]")?.addEventListener("click", async (e) => {
    e.stopPropagation();
    if (!confirm(`Delete "${style.style}"? This affects everyone.`)) return;
    try {
      await api.deleteStyle({ id: style.id, kind: ctx.kindOf(style.id) });
      toast("Deleted");
      ctx.afterChange();
    } catch (err) {
      toast(err.message);
    }
  });
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

function toMarkdown(style, palette, imgPrompt, nbPrompt) {
  let md = `## ${style.style || "Untitled"}\n`;
  if (style.category) md += `**Category:** ${style.category}\n`;
  if (palette.length) md += `**Palette:** ${palette.join(" ")}\n`;
  md += `\n### Image prompt\n${imgPrompt}\n\n### NotebookLM prompt\n${nbPrompt}\n`;
  return md;
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
  const notebookPrompt = style.notebookLMPrompt || toNotebookLMPrompt(style);
  const imgs = imagesOf(style);

  // Live state: palette can be "rolled", and the image prompt reflects aspect/model.
  const original = (style.palette || []).slice();
  let palette = original.slice();
  const imgOpts = { aspect: "16:9", model: "openai" };
  let currentImagePrompt = "";

  const adminBar =
    ctx.admin()
      ? `<div class="detail-admin">
           <button type="button" class="btn btn-sm" data-edit>Edit style</button>
           <button type="button" class="btn btn-sm" data-duplicate>Duplicate</button>
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
      <div class="detail-head-actions">
        <button type="button" class="btn btn-sm" data-copy-link>Copy link</button>
        <button type="button" class="btn btn-icon" data-close aria-label="Close">✕</button>
      </div>
    </div>

    ${
      imgs.length
        ? `<div class="detail-images">${imgs
            .map(
              (u, i) =>
                `<img class="detail-thumb" data-img="${i}" loading="lazy" alt="Example ${i + 1} for ${escapeHtml(style.style)}" src="${escapeHtml(u)}" />`
            )
            .join("")}</div>`
        : ""
    }

    <div class="detail-palette" id="detailPalette"></div>

    <div class="detail-grid">
      ${fieldBlock("Type", style.type)}
      ${fieldBlock("Icons", style.icons)}
      ${fieldBlock("Layout", style.layout)}
      ${fieldBlock("Charts", style.charts)}
      ${fieldBlock("Background", style.background)}
      ${fieldBlock("Avoid", style.avoid)}
    </div>

    <div class="prompt-block">
      <div class="prompt-head">
        <span>Image prompt</span>
        <span class="prompt-opts">
          <select id="aspectSel" class="select" aria-label="Aspect ratio">
            <option value="16:9">16:9</option>
            <option value="1:1">1:1</option>
            <option value="4:5">4:5</option>
            <option value="9:16">9:16</option>
          </select>
          <select id="modelSel" class="select" aria-label="Target model">
            <option value="openai">OpenAI</option>
            <option value="gemini">Gemini</option>
            <option value="dalle">DALL·E 3</option>
            <option value="midjourney">Midjourney</option>
            <option value="generic">Generic</option>
          </select>
          <button type="button" class="btn btn-sm" data-copy-img>Copy</button>
        </span>
      </div>
      <pre class="prompt-text" id="imgPromptText"></pre>
    </div>

    <div class="prompt-block">
      <div class="prompt-head"><span>NotebookLM prompt</span>
        <button type="button" class="btn btn-sm" data-copy-nb>Copy</button></div>
      <pre class="prompt-text">${escapeHtml(notebookPrompt)}</pre>
    </div>

    <div class="detail-foot">
      <button type="button" class="btn btn-sm" data-copy-md>Copy as Markdown</button>
    </div>

    ${adminBar}
  `;

  function renderImagePrompt() {
    currentImagePrompt = toImagePrompt({ ...style, palette }, imgOpts);
    body.querySelector("#imgPromptText").textContent = currentImagePrompt;
  }

  function renderPalette() {
    const el = body.querySelector("#detailPalette");
    if (!original.length) {
      el.hidden = true;
      return;
    }
    const same = palette.length === original.length && palette.every((c, i) => c === original[i]);
    el.innerHTML = `
      <div class="swatches lg">${detailSwatchRow(palette)}</div>
      <div class="palette-actions">
        <span class="palette-actions-label">Copy palette:</span>
        <button type="button" class="btn btn-sm" data-pal="hex">Hex</button>
        <button type="button" class="btn btn-sm" data-pal="css">CSS</button>
        <button type="button" class="btn btn-sm" data-pal="scss">SCSS</button>
        <button type="button" class="btn btn-sm" data-pal="tailwind">Tailwind</button>
        <button type="button" class="btn btn-sm" data-pal="json">JSON</button>
        <button type="button" class="btn btn-sm" data-roll title="Generate a different palette">🎲 Shuffle palette</button>
        ${same ? "" : `<button type="button" class="btn btn-sm" data-reset>Reset</button>`}
      </div>`;
    el.querySelectorAll(".swatch").forEach((sw) =>
      sw.addEventListener("click", () => copyText(sw.dataset.hex, sw.dataset.hex))
    );
    const pf = paletteFormats(palette);
    el.querySelectorAll("[data-pal]").forEach((btn) =>
      btn.addEventListener("click", () => copyText(pf[btn.dataset.pal], `Palette copied (${btn.dataset.pal})`))
    );
    el.querySelector("[data-roll]").addEventListener("click", () => {
      palette = randomPalette(original.length || 5);
      renderPalette();
      renderImagePrompt();
      toast("New palette rolled 🎲");
    });
    el.querySelector("[data-reset]")?.addEventListener("click", () => {
      palette = original.slice();
      renderPalette();
      renderImagePrompt();
    });
  }

  renderPalette();
  renderImagePrompt();

  // copies
  body.querySelector("[data-copy-img]").addEventListener("click", () =>
    copyWithVariables(currentImagePrompt, "Image prompt copied")
  );
  body.querySelector("[data-copy-nb]")?.addEventListener("click", () =>
    copyWithVariables(notebookPrompt, "NotebookLM prompt copied")
  );
  body.querySelector("#aspectSel").addEventListener("change", (e) => {
    imgOpts.aspect = e.target.value;
    renderImagePrompt();
  });
  body.querySelector("#modelSel").addEventListener("change", (e) => {
    imgOpts.model = e.target.value;
    renderImagePrompt();
  });
  body.querySelector("[data-copy-md]").addEventListener("click", () =>
    copyText(toMarkdown(style, palette, currentImagePrompt, notebookPrompt), "Copied as Markdown")
  );
  body.querySelectorAll("[data-img]").forEach((el) =>
    el.addEventListener("click", () => openLightbox(imgs[Number(el.dataset.img)], el.alt))
  );
  body.querySelector("[data-copy-link]")?.addEventListener("click", () =>
    copyText(`${location.origin}${location.pathname}?style=${encodeURIComponent(style.id)}`, "Link copied")
  );

  // admin actions
  body.querySelector("[data-edit]")?.addEventListener("click", () => ctx.onEdit(style));
  body.querySelector("[data-duplicate]")?.addEventListener("click", () => ctx.onDuplicate(style));
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
