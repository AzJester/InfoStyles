// localStorage helpers: Anthropic API key, chosen model, and user-created styles.
// Nothing here is ever committed or sent anywhere except the user's own browser
// -> Anthropic API call.

const KEY_API = "infostyles.apiKey";
const KEY_MODEL = "infostyles.model";
const KEY_CUSTOM = "infostyles.customStyles";

export const DEFAULT_MODEL = "claude-sonnet-4-6";

export const MODELS = [
  { id: "claude-sonnet-4-6", label: "Claude Sonnet 4.6 (recommended)" },
  { id: "claude-opus-4-8", label: "Claude Opus 4.8 (highest quality)" },
  { id: "claude-haiku-4-5-20251001", label: "Claude Haiku 4.5 (fastest)" },
];

export function getApiKey() {
  return localStorage.getItem(KEY_API) || "";
}
export function setApiKey(value) {
  if (value) localStorage.setItem(KEY_API, value);
  else localStorage.removeItem(KEY_API);
}

export function getModel() {
  return localStorage.getItem(KEY_MODEL) || DEFAULT_MODEL;
}
export function setModel(value) {
  localStorage.setItem(KEY_MODEL, value || DEFAULT_MODEL);
}

export function getCustomStyles() {
  try {
    const raw = localStorage.getItem(KEY_CUSTOM);
    const list = raw ? JSON.parse(raw) : [];
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

export function saveCustomStyle(style) {
  const list = getCustomStyles();
  // de-dupe by id; newest wins and sorts first
  const filtered = list.filter((s) => s.id !== style.id);
  filtered.unshift(style);
  localStorage.setItem(KEY_CUSTOM, JSON.stringify(filtered));
  return filtered;
}

export function deleteCustomStyle(id) {
  const list = getCustomStyles().filter((s) => s.id !== id);
  localStorage.setItem(KEY_CUSTOM, JSON.stringify(list));
  return list;
}
