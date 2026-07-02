// Shared UI helpers: toast, clipboard, HTML escaping, and accessible modals.
import { extractVariables, applyVariables } from "./imagePrompt.js";

// Inline SVG icons (stroke, 16px) shared across the UI so the toolbar doesn't
// depend on platform emoji rendering.
const I = (body) =>
  `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;
export const ICONS = {
  dice: I('<rect x="3" y="3" width="18" height="18" rx="4"/><circle cx="8.5" cy="8.5" r="1.3" fill="currentColor" stroke="none"/><circle cx="15.5" cy="8.5" r="1.3" fill="currentColor" stroke="none"/><circle cx="8.5" cy="15.5" r="1.3" fill="currentColor" stroke="none"/><circle cx="15.5" cy="15.5" r="1.3" fill="currentColor" stroke="none"/><circle cx="12" cy="12" r="1.3" fill="currentColor" stroke="none"/>'),
  gear: I('<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09a1.65 1.65 0 0 0 1.51-1 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33h.01a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51h.01a1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82v.01a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>'),
  key: I('<circle cx="7.5" cy="15.5" r="4.5"/><path d="m11 12 9-9m-4 4 3 3m-6 0 2.5 2.5"/>'),
  dots: I('<circle cx="5" cy="12" r="1" fill="currentColor"/><circle cx="12" cy="12" r="1" fill="currentColor"/><circle cx="19" cy="12" r="1" fill="currentColor"/>'),
  sun: I('<circle cx="12" cy="12" r="4"/><path d="M12 2v2m0 16v2M4.93 4.93l1.41 1.41m11.32 11.32 1.41 1.41M2 12h2m16 0h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41"/>'),
  moon: I('<path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/>'),
  grid: I('<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>'),
  list: I('<path d="M8 6h13M8 12h13M8 18h13"/><circle cx="4" cy="6" r="1" fill="currentColor"/><circle cx="4" cy="12" r="1" fill="currentColor"/><circle cx="4" cy="18" r="1" fill="currentColor"/>'),
  star: I('<path d="m12 3 2.7 5.6 6.1.8-4.5 4.3 1.1 6-5.4-2.9-5.4 2.9 1.1-6L3.2 9.4l6.1-.8z"/>'),
  starFill: I('<path d="m12 3 2.7 5.6 6.1.8-4.5 4.3 1.1 6-5.4-2.9-5.4 2.9 1.1-6L3.2 9.4l6.1-.8z" fill="currentColor"/>'),
  plus: I('<path d="M12 5v14M5 12h14"/>'),
};

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
