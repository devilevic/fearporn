(function () {
  const KEY = "fearporn_theme"; // "dark" or "light"

  function apply(theme) {
    document.body.classList.toggle("theme-light", theme === "light");

    const btn = document.getElementById("themeToggle");
    if (!btn) return;

    const icon = btn.querySelector(".theme-icon");
    const label = btn.querySelector(".theme-label");

    if (theme === "light") {
      if (icon) icon.textContent = "☀️";
      if (label) label.textContent = "Light";
    } else {
      if (icon) icon.textContent = "🌙";
      if (label) label.textContent = "Dark";
    }
  }

  function current() {
    const saved = localStorage.getItem(KEY);
    if (saved === "dark" || saved === "light") return saved;
    // default: respect system preference
    return window.matchMedia && window.matchMedia("(prefers-color-scheme: light)").matches
      ? "light"
      : "dark";
  }

  document.addEventListener("DOMContentLoaded", () => {
    let theme = current();
    apply(theme);

    const btn = document.getElementById("themeToggle");
    if (!btn) return;

    btn.addEventListener("click", () => {
      theme = document.body.classList.contains("theme-light") ? "dark" : "light";
      localStorage.setItem(KEY, theme);
      apply(theme);
    });
  });
})();