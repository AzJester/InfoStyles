// Shared UI helpers: toast, clipboard, HTML escaping, and accessible modals.
import { extractVariables, applyVariables } from "./imagePrompt.js";

export function escapeHtml(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])
  );
}

// Highlight occurrences of search terms inside already-escaped-safe text.
export function highlight(text, query) {
  const safe = escapeHtml(text);
  const q = (query || "").trim();
  if (!q) return safe;
  const terms = [...new Set(q.split(/\s+/).filter(Boolean))]
    .map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
    .sort((a, b) => b.length - a.length);
  if (!terms.length) return safe;
  const re = new RegExp(`(${terms.join("|")})`, "gi");
  return safe.replace(re, "<mark>$1</mark>");
}

let toastTimer;
export function toast(message) {
  const el = document.getElementById("toast");
  if (!el) return;
  el.textContent = message;
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (el.hidden = true), 1700);
}

export async function copyText(text, label = "Copied") {
  try {
    await navigator.clipboard.writeText(text);
    toast(`${label} ✓`);
  } catch {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    try {
      document.execCommand("copy");
      toast(`${label} ✓`);
    } catch {
      toast("Copy failed");
    }
    ta.remove();
  }
}

// Copy text, but if it contains {{variables}}, prompt to fill them first.
export function copyWithVariables(text, label = "Copied") {
  const vars = extractVariables(text);
  const modal = document.getElementById("varModal");
  const fields = document.getElementById("varFields");
  const copyBtn = document.getElementById("varCopyBtn");
  if (!vars.length || !modal || !fields || !copyBtn) return copyText(text, label);

  fields.innerHTML = vars
    .map(
      (v) =>
        `<label class="field"><span class="field-label">${escapeHtml(v)}</span>` +
        `<input class="input" data-var="${escapeHtml(v)}" /></label>`
    )
    .join("");
  if (!modal._dismissWired) {
    wireModalDismiss(modal);
    modal._dismissWired = true;
  }
  copyBtn.onclick = () => {
    const values = {};
    fields.querySelectorAll("[data-var]").forEach((i) => (values[i.dataset.var] = i.value));
    closeModal(modal);
    copyText(applyVariables(text, values), label);
  };
  openModal(modal);
}

// --- Modal management with a focus trap and a shared Escape handler ---
const openModals = [];
const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

function trap(e, modal) {
  if (e.key !== "Tab") return;
  const items = [...modal.querySelectorAll(FOCUSABLE)].filter((el) => el.offsetParent !== null);
  if (!items.length) return;
  const first = items[0];
  const last = items[items.length - 1];
  if (e.shiftKey && document.activeElement === first) {
    e.preventDefault();
    last.focus();
  } else if (!e.shiftKey && document.activeElement === last) {
    e.preventDefault();
    first.focus();
  }
}

export function openModal(modal) {
  if (!modal || !modal.hidden) return;
  modal.hidden = false;
  modal._returnFocus = document.activeElement;
  modal._trap = (e) => trap(e, modal);
  modal.addEventListener("keydown", modal._trap);
  openModals.push(modal);
  const first = modal.querySelector(FOCUSABLE);
  if (first) first.focus();
}

export function closeModal(modal) {
  if (!modal || modal.hidden) return;
  modal.hidden = true;
  modal.removeEventListener("keydown", modal._trap);
  const i = openModals.indexOf(modal);
  if (i >= 0) openModals.splice(i, 1);
  if (modal._returnFocus && modal._returnFocus.focus) modal._returnFocus.focus();
}

// Wire backdrop click + [data-close] buttons to close a modal.
export function wireModalDismiss(modal) {
  modal.addEventListener("click", (e) => {
    if (e.target === modal || e.target.closest("[data-close]")) closeModal(modal);
  });
}

// --- Lightbox: view an image full size ---
export function openLightbox(src, alt = "") {
  const lb = document.getElementById("lightbox");
  const img = document.getElementById("lightboxImg");
  if (!lb || !img) return;
  img.src = src;
  img.alt = alt;
  lb.hidden = false;
}
function closeLightbox() {
  const lb = document.getElementById("lightbox");
  if (lb && !lb.hidden) {
    lb.hidden = true;
    document.getElementById("lightboxImg").src = "";
    return true;
  }
  return false;
}
document.addEventListener("click", (e) => {
  const lb = document.getElementById("lightbox");
  if (lb && !lb.hidden && (e.target === lb || e.target.id === "lightboxImg" || e.target.closest("#lightbox"))) {
    closeLightbox();
  }
});

// Global Escape closes the lightbox, then the topmost modal; "/" focuses search.
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && closeLightbox()) return;
  if (e.key === "Escape" && openModals.length) {
    closeModal(openModals[openModals.length - 1]);
    return;
  }
  if (e.key === "/" && !openModals.length) {
    const tag = (document.activeElement?.tagName || "").toLowerCase();
    if (tag !== "input" && tag !== "textarea" && tag !== "select") {
      const search = document.getElementById("search");
      if (search) {
        e.preventDefault();
        search.focus();
      }
    }
  }
});
