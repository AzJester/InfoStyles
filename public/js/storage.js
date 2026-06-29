// Per-browser preferences: favorites, theme, and the preferred model for the creator.
// No API keys are ever stored client-side (they live as server env secrets).

const K_FAVORITES = "infostyles.favorites";
const K_THEME = "infostyles.theme";
const K_MODEL = "infostyles.model";
const K_VIEW = "infostyles.view";

export const DEFAULT_MODEL = "claude-sonnet-4-6";
export const MODELS = [
  { id: "claude-sonnet-4-6", label: "Claude Sonnet 4.6 (recommended)" },
  { id: "claude-opus-4-8", label: "Claude Opus 4.8 (highest quality)" },
  { id: "claude-haiku-4-5-20251001", label: "Claude Haiku 4.5 (fastest)" },
];

// --- favorites (set of style ids) ---
function readFavs() {
  try {
    return new Set(JSON.parse(localStorage.getItem(K_FAVORITES) || "[]"));
  } catch {
    return new Set();
  }
}
let favs = readFavs();

export function isFavorite(id) {
  return favs.has(id);
}
export function toggleFavorite(id) {
  if (favs.has(id)) favs.delete(id);
  else favs.add(id);
  localStorage.setItem(K_FAVORITES, JSON.stringify([...favs]));
  return favs.has(id);
}
export function favoriteCount() {
  return favs.size;
}

// --- theme ('light' | 'dark') ---
export function getTheme() {
  const saved = localStorage.getItem(K_THEME);
  if (saved === "light" || saved === "dark") return saved;
  return window.matchMedia?.("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}
export function setTheme(theme) {
  localStorage.setItem(K_THEME, theme);
}

// --- preferred model ---
export function getModel() {
  return localStorage.getItem(K_MODEL) || DEFAULT_MODEL;
}
export function setModel(m) {
  localStorage.setItem(K_MODEL, m || DEFAULT_MODEL);
}

// --- gallery view ('grid' | 'list') ---
export function getView() {
  return localStorage.getItem(K_VIEW) === "list" ? "list" : "grid";
}
export function setView(v) {
  localStorage.setItem(K_VIEW, v === "list" ? "list" : "grid");
}
