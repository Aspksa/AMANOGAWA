// AMANOGAWA — звёздное небо и меню

(function () {
  "use strict";

  document.getElementById("year").textContent = new Date().getFullYear();

  // ----- Мобильное меню -----
  const toggle = document.querySelector(".menu-toggle");
  const nav = document.getElementById("nav");

  function setMenu(open) {
    toggle.setAttribute("aria-expanded", String(open));
    toggle.setAttribute("aria-label", open ? "Закрыть меню" : "Открыть меню");
    nav.classList.toggle("is-open", open);
  }

  toggle.addEventListener("click", () => setMenu(toggle.getAttribute("aria-expanded") !== "true"));
  nav.addEventListener("click", (e) => { if (e.target.closest("a")) setMenu(false); });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") setMenu(false); });

  // ----- Звёздное небо с полосой Млечного Пути -----
  const canvas = document.getElementById("sky");
  const ctx = canvas.getContext("2d");
  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  let stars = [];
  let width = 0;
  let height = 0;
  let dpr = 1;

  function gauss() {
    // Нормальное распределение (Бокс — Мюллер)
    return Math.sqrt(-2 * Math.log(1 - Math.random())) * Math.cos(2 * Math.PI * Math.random());
  }

  function createStars() {
    // Количество звёзд зависит от площади экрана
    const count = Math.min(900, Math.round((width * height) / 2600));
    const angle = -0.42; // наклон «реки»
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    const diag = Math.hypot(width, height);
    const band = Math.min(width, height) * 0.16;

    stars = [];
    for (let i = 0; i < count; i++) {
      let x, y;
      if (i % 5 < 3) {
        // Звёзды вдоль полосы Млечного Пути
        const t = (Math.random() - 0.5) * diag;
        const d = gauss() * band;
        x = width / 2 + t * cos - d * sin;
        y = height / 2 + t * sin + d * cos;
      } else {
        x = Math.random() * width;
        y = Math.random() * height;
      }
      const r = Math.random() < 0.04 ? 1.1 + Math.random() * 0.8 : 0.2 + Math.random() * 0.8;
      const hue = Math.random() < 0.15 ? 290 : 225 + Math.random() * 20;
      stars.push({
        x, y, r, hue,
        base: 0.35 + Math.random() * 0.65,
        speed: 0.4 + Math.random() * 1.6,
        phase: Math.random() * Math.PI * 2,
      });
    }
  }

  function resize() {
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    width = window.innerWidth;
    height = window.innerHeight;
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    createStars();
    if (reduceMotion) draw(0);
  }

  function draw(time) {
    ctx.clearRect(0, 0, width, height);
    const t = time / 1000;
    for (const s of stars) {
      const a = reduceMotion ? s.base : s.base * (0.6 + 0.4 * Math.sin(t * s.speed + s.phase));
      ctx.beginPath();
      ctx.fillStyle = `hsla(${s.hue}, 80%, 92%, ${a})`;
      ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2);
      ctx.fill();
      if (s.r > 1.1) {
        ctx.beginPath();
        ctx.fillStyle = `hsla(${s.hue}, 90%, 80%, ${a * 0.15})`;
        ctx.arc(s.x, s.y, s.r * 4, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }

  function loop(time) {
    draw(time);
    requestAnimationFrame(loop);
  }

  let resizeTimer;
  window.addEventListener("resize", () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(resize, 150);
  });

  resize();
  if (!reduceMotion) requestAnimationFrame(loop);
})();
