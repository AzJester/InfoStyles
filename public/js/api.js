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
    if (!res.ok) return { admin: false, kv: false, uploadEnabled: false };
    return await res.json();
  } catch {
    return { admin: false, kv: false, uploadEnabled: false };
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
export const saveStyle = (payload) => post("/api/styles", { action: "save", ...payload });
export const deleteStyle = (payload) => post("/api/styles", { action: "delete", ...payload });
export const uploadImage = (dataUrl, filename) => post("/api/upload-image", { dataUrl, filename });

// Upload a document as raw bytes (filename via query). Returns { url, name }.
export async function uploadFile(file) {
  const res = await fetch(`/api/upload-file?filename=${encodeURIComponent(file.name)}`, {
    method: "POST",
    headers: { "content-type": file.type || "application/octet-stream" },
    body: file,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Upload failed (${res.status}).`);
  return data;
}

export async function getPrompts() {
  try {
    const res = await fetch("/api/prompts", { headers: { "cache-control": "no-store" } });
    if (!res.ok) return { prompts: [] };
    return await res.json();
  } catch {
    return { prompts: [] };
  }
}
export const savePrompt = (payload) => post("/api/prompts", { action: "save", ...payload });
export const deletePromptApi = (id) => post("/api/prompts", { action: "delete", id });
export const generatePrompt = (payload) => post("/api/generate-prompt", payload);

export async function getSkills() {
  try {
    const res = await fetch("/api/skills", { headers: { "cache-control": "no-store" } });
    if (!res.ok) return { skills: [] };
    return await res.json();
  } catch {
    return { skills: [] };
  }
}
export const saveSkill = (payload) => post("/api/skills", { action: "save", ...payload });
export const deleteSkillApi = (id) => post("/api/skills", { action: "delete", id });
export const generateSkill = (payload) => post("/api/generate-skill", payload);
export const analyzeSkill = (payload) => post("/api/analyze-skill", payload);

// Reset an edited seed back to its committed original (removes the overlay).
export const revertPrompt = (id) => post("/api/prompts", { action: "revert", id });
export const revertSkill = (id) => post("/api/skills", { action: "revert", id });
export const revertStyle = (id) => post("/api/styles", { action: "revert", id });

// Backup (admin): GET downloads everything the app stores; POST restores it.
export async function getBackup() {
  const res = await fetch("/api/backup", { headers: { "cache-control": "no-store" } });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status}).`);
  return data;
}
export const restoreBackup = (snapshot) => post("/api/backup", snapshot);

// Recently deleted (admin): list + restore by index.
export async function getTrash() {
  const res = await fetch("/api/trash", { headers: { "cache-control": "no-store" } });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status}).`);
  return data;
}
export const restoreTrash = (index) => post("/api/trash", { index });

// Fire-and-forget download counter; failures never surface to the user.
export const trackDownload = (id) => post("/api/track", { id }).catch(() => {});

// Prompt Studio (public): improve a draft; note that the visitor copied it.
export const studioImprove = (payload) => post("/api/studio", { action: "improve", ...payload });
export const studioCopied = (payload) => post("/api/studio", { action: "copied", ...payload }).catch(() => {});

// Public submissions: a visitor-built skill or style design, sent to the
// admin's private review queue.
export const submitToQueue = (payload) => post("/api/submit", payload);

// Review queue (admin).
export async function getSubmissions() {
  const res = await fetch("/api/submissions", { headers: { "cache-control": "no-store" } });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status}).`);
  return data;
}
export const submissionAction = (payload) => post("/api/submissions", payload);
