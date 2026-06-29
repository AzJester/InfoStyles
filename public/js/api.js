// Thin wrappers around the serverless /api endpoints. The browser never holds keys.

async function post(path, body) {
  const res = await fetch(path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body || {}),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status}).`);
  return data;
}

export async function getSession() {
  try {
    const res = await fetch("/api/session", { headers: { "cache-control": "no-store" } });
    if (!res.ok) return { admin: false, kv: false, imageEnabled: false };
    return await res.json();
  } catch {
    return { admin: false, kv: false, imageEnabled: false };
  }
}

export async function getCatalog() {
  try {
    const res = await fetch("/api/catalog", { headers: { "cache-control": "no-store" } });
    if (!res.ok) return { overrides: {}, custom: [], categories: [] };
    return await res.json();
  } catch {
    return { overrides: {}, custom: [], categories: [] };
  }
}

export const login = (password) => post("/api/login", { password });
export const logout = () => post("/api/logout", {});
export const generateStyle = (payload) => post("/api/generate-style", payload);
export const generateImage = (payload) => post("/api/generate-image", payload);
export const saveStyle = (payload) => post("/api/styles", { action: "save", ...payload });
export const deleteStyle = (payload) => post("/api/styles", { action: "delete", ...payload });
export const uploadImage = (dataUrl, filename) => post("/api/upload-image", { dataUrl, filename });
