// Admin gate: checks the server session, wires the login/logout UI, and tracks
// whether AI features (style + image generation) should be available.
import * as api from "./api.js";
import { openModal, closeModal, wireModalDismiss, toast } from "./ui.js";

const state = { admin: false, kv: false, uploadEnabled: false };
let onChange = () => {};

export function adminState() {
  return state;
}

async function refreshSession() {
  const s = await api.getSession();
  state.admin = !!s.admin;
  state.kv = !!s.kv;
  state.uploadEnabled = !!s.uploadEnabled;
  reflect();
  onChange();
}

function reflect() {
  document.body.classList.toggle("is-admin", state.admin);
  const loginBtn = document.getElementById("adminBtn");
  if (loginBtn) {
    loginBtn.classList.toggle("active", state.admin);
    loginBtn.title = state.admin ? "Admin (signed in)" : "Admin sign in";
    loginBtn.setAttribute("aria-label", loginBtn.title);
  }
}

export async function initAdmin(opts = {}) {
  onChange = opts.onChange || (() => {});

  const modal = document.getElementById("loginModal");
  const btn = document.getElementById("adminBtn");
  const form = document.getElementById("loginForm");
  const input = document.getElementById("adminPassword");
  const status = document.getElementById("loginStatus");
  const logoutBtn = document.getElementById("logoutBtn");

  wireModalDismiss(modal);

  btn.addEventListener("click", () => {
    if (state.admin) {
      // already in: offer logout
      logoutBtn.hidden = false;
    } else {
      logoutBtn.hidden = true;
    }
    status.textContent = "";
    input.value = "";
    openModal(modal);
  });

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    status.textContent = "Signing in…";
    status.classList.remove("error");
    try {
      await api.login(input.value);
      await refreshSession();
      closeModal(modal);
      toast("Signed in as admin ✓");
    } catch (err) {
      status.textContent = err.message;
      status.classList.add("error");
    }
  });

  logoutBtn.addEventListener("click", async () => {
    await api.logout().catch(() => {});
    await refreshSession();
    closeModal(modal);
    toast("Signed out");
  });

  await refreshSession();
}
