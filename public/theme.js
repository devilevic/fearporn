(() => {
  const KEY = "fearporn_theme"; // "dark" | "light"

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

  function currentTheme() {
    const saved = localStorage.getItem(KEY);
    if (saved === "light" || saved === "dark") return saved;
    const prefersLight =
      window.matchMedia &&
      window.matchMedia("(prefers-color-scheme: light)").matches;
    return prefersLight ? "light" : "dark";
  }

  document.addEventListener("DOMContentLoaded", () => {
    let theme = currentTheme();
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