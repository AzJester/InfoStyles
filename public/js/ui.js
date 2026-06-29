// Shared UI helpers: toast, clipboard, HTML escaping, and accessible modals.

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

// Global Escape closes the topmost modal; "/" focuses search when not typing.
document.addEventListener("keydown", (e) => {
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
