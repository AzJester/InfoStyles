// Settings modal: Anthropic API key + model, persisted to localStorage.
import { getApiKey, setApiKey, getModel, setModel, MODELS } from "./storage.js";

export function initSettings({ toast }) {
  const modal = document.getElementById("settingsModal");
  const openBtn = document.getElementById("settingsBtn");
  const apiKeyInput = document.getElementById("apiKeyInput");
  const modelSelect = document.getElementById("modelSelect");
  const saveBtn = document.getElementById("saveSettingsBtn");
  const clearBtn = document.getElementById("clearKeyBtn");

  // populate model options once
  for (const m of MODELS) {
    const opt = document.createElement("option");
    opt.value = m.id;
    opt.textContent = m.label;
    modelSelect.appendChild(opt);
  }

  function open() {
    apiKeyInput.value = getApiKey();
    modelSelect.value = getModel();
    modal.hidden = false;
  }
  function close() {
    modal.hidden = true;
  }

  openBtn.addEventListener("click", open);
  modal.addEventListener("click", (e) => {
    if (e.target === modal || e.target.hasAttribute("data-close")) close();
  });

  saveBtn.addEventListener("click", () => {
    setApiKey(apiKeyInput.value.trim());
    setModel(modelSelect.value);
    close();
    toast("Settings saved ✓");
  });

  clearBtn.addEventListener("click", () => {
    setApiKey("");
    apiKeyInput.value = "";
    toast("API key cleared");
  });
}
