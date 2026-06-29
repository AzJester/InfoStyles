// Applies the saved (or system) theme before paint to avoid a flash.
// Classic script (not a module) so it runs synchronously in <head> and complies
// with a strict CSP (script-src 'self').
(function () {
  try {
    var t = localStorage.getItem("infostyles.theme");
    if (t !== "light" && t !== "dark") {
      t = matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
    }
    document.documentElement.dataset.theme = t;
  } catch (e) {}
})();
