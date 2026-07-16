/* Codply chrome — tiny vanilla helpers (theme toggle, dropdown auto-close). */
(function () {
  "use strict";

  // Theme toggle: cycles light <-> dark, persists to localStorage.
  function currentTheme() {
    return document.documentElement.getAttribute("data-theme") === "light" ? "light" : "dark";
  }
  document.querySelectorAll("[data-theme-toggle]").forEach(function (btn) {
    btn.addEventListener("click", function () {
      var next = currentTheme() === "light" ? "dark" : "light";
      document.documentElement.setAttribute("data-theme", next);
      try {
        localStorage.setItem("fp_theme", next);
      } catch (e) {}
      var meta = document.querySelector('meta[name="theme-color"]');
      if (meta) meta.setAttribute("content", next === "light" ? "#f4f4f9" : "#0a0a0f");
    });
  });

  // <details data-menu> dropdowns: close on outside click / Escape.
  var menus = Array.prototype.slice.call(document.querySelectorAll("details[data-menu]"));
  document.addEventListener("click", function (e) {
    menus.forEach(function (d) {
      if (d.open && !d.contains(e.target)) d.open = false;
    });
  });
  document.addEventListener("keydown", function (e) {
    if (e.key === "Escape") menus.forEach(function (d) { d.open = false; });
  });
})();
