// Per-browser preferences: favorites, theme, and the preferred model for the creator.
// No API keys are ever stored client-side (they live as server env secrets).

const K_FAVORITES = "infostyles.favorites";
const K_PFAVORITES = "infostyles.promptFavorites";
const K_THEME = "infostyles.theme";
const K_MODEL = "infostyles.model";
const K_VIEW = "infostyles.view";
const K_PVIEW = "infostyles.promptView";
const K_SEEN = "infostyles.seenIntro";

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

// --- prompt favorites (set of prompt ids) ---
function readPFavs() {
  try {
    return new Set(JSON.parse(localStorage.getItem(K_PFAVORITES) || "[]"));
  } catch {
    return new Set();
  }
}
let pfavs = readPFavs();

export function isPromptFavorite(id) {
  return pfavs.has(id);
}
export function togglePromptFavorite(id) {
  if (pfavs.has(id)) pfavs.delete(id);
  else pfavs.add(id);
  localStorage.setItem(K_PFAVORITES, JSON.stringify([...pfavs]));
  return pfavs.has(id);
}
export function promptFavoriteCount() {
  return pfavs.size;
}

// --- theme ('light' | 'dark') ---
export function getTheme() {
  const saved = localStorage.getItem(K_THEME);
  if (saved === "light" || saved === "dark") return saved;
  return "dark"; // dark is the site's primary look (see theme-init.js)
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

// --- gallery view ('grid' | 'list'), defaults to list ---
export function getView() {
  return localStorage.getItem(K_VIEW) === "grid" ? "grid" : "list";
}
export function setView(v) {
  localStorage.setItem(K_VIEW, v === "list" ? "list" : "grid");
}

// --- prompts view ('grid' | 'list'), defaults to list ---
export function getPromptView() {
  return localStorage.getItem(K_PVIEW) === "grid" ? "grid" : "list";
}
export function setPromptView(v) {
  localStorage.setItem(K_PVIEW, v === "grid" ? "grid" : "list");
}

// --- first-run hint (shown once) ---
export function hasSeenIntro() {
  return localStorage.getItem(K_SEEN) === "1";
}
export function markIntroSeen() {
  localStorage.setItem(K_SEEN, "1");
}
