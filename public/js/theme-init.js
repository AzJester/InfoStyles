// Applies the saved theme before paint to avoid a flash.
// Classic script (not a module) so it runs synchronously in <head> and complies
// with a strict CSP (script-src 'self').
(function () {
  try {
    var t = localStorage.getItem("infostyles.theme");
    // Light is the site's primary look: new visitors get it regardless of the
    // OS preference; the toggle (persisted) still switches to dark.
    if (t !== "light" && t !== "dark") t = "light";
    document.documentElement.dataset.theme = t;
  } catch (e) {
    document.documentElement.dataset.theme = "light";
  }
})();
