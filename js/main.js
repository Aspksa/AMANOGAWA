// AMANOGAWA — звёздное небо, эффекты и меню

(function () {
  "use strict";

  document.documentElement.classList.add("js");
  document.getElementById("year").textContent = new Date().getFullYear();

  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const finePointer = window.matchMedia("(hover: hover) and (pointer: fine)").matches;

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

  // ----- Шапка становится стеклянной при прокрутке -----
  const topbar = document.querySelector(".topbar");
  const onScroll = () => topbar.classList.toggle("is-scrolled", window.scrollY > 10);
  window.addEventListener("scroll", onScroll, { passive: true });
  onScroll();

  // ----- Появление блоков при прокрутке -----
  const reveals = document.querySelectorAll(".reveal");
  document.querySelectorAll(".grid").forEach((grid) => {
    [...grid.children].forEach((el, i) => el.style.setProperty("--d", `${i * 0.12}s`));
  });

  if ("IntersectionObserver" in window && !reduceMotion) {
    const io = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        if (entry.isIntersecting) {
          entry.target.classList.add("is-visible");
          io.unobserve(entry.target);
        }
      }
    }, { threshold: 0.15, rootMargin: "0px 0px -8% 0px" });
    reveals.forEach((el) => io.observe(el));
  } else {
    reveals.forEach((el) => el.classList.add("is-visible"));
  }

  // ----- Курсор: свечение и подсветка карточек -----
  const pointer = { x: 0, y: 0, tx: 0, ty: 0 }; // смещение для параллакса, -1..1

  if (finePointer) {
    const glow = document.querySelector(".cursor-glow");
    window.addEventListener("pointermove", (e) => {
      glow.classList.add("is-on");
      glow.style.transform = `translate3d(${e.clientX}px, ${e.clientY}px, 0)`;
      pointer.tx = (e.clientX / window.innerWidth) * 2 - 1;
      pointer.ty = (e.clientY / window.innerHeight) * 2 - 1;
    }, { passive: true });
    document.addEventListener("pointerleave", () => glow.classList.remove("is-on"));

    document.querySelectorAll(".card").forEach((card) => {
      card.addEventListener("pointermove", (e) => {
        const r = card.getBoundingClientRect();
        card.style.setProperty("--mx", `${e.clientX - r.left}px`);
        card.style.setProperty("--my", `${e.clientY - r.top}px`);
      });
    });
  }

  // ----- Звёздное небо с полосой Млечного Пути -----
  const canvas = document.getElementById("sky");
  const ctx = canvas.getContext("2d");

  let stars = [];
  let meteors = [];
  let width = 0;
  let height = 0;
  let dpr = 1;
  let nextMeteor = 0;

  function gauss() {
    // Нормальное распределение (Бокс — Мюллер)
    return Math.sqrt(-2 * Math.log(1 - Math.random())) * Math.cos(2 * Math.PI * Math.random());
  }

  function createStars() {
    // Количество звёзд зависит от площади экрана
    const count = Math.min(1100, Math.round((width * height) / 2200));
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
      const big = Math.random() < 0.04;
      const r = big ? 1.1 + Math.random() * 0.9 : 0.2 + Math.random() * 0.8;
      const roll = Math.random();
      const hue = roll < 0.12 ? 290 : roll < 0.2 ? 190 : 225 + Math.random() * 20;
      stars.push({
        x, y, r, hue,
        depth: big ? 1 : 0.2 + Math.random() * 0.6, // глубина для параллакса
        base: 0.35 + Math.random() * 0.65,
        speed: 0.4 + Math.random() * 1.6,
        phase: Math.random() * Math.PI * 2,
      });
    }
  }

  function spawnMeteor() {
    const fromLeft = Math.random() < 0.5;
    const speed = 900 + Math.random() * 700; // пикселей в секунду
    const angle = (fromLeft ? 0.35 : Math.PI - 0.35) + (Math.random() - 0.5) * 0.3;
    meteors.push({
      x: Math.random() * width,
      y: Math.random() * height * 0.5,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed,
      len: 120 + Math.random() * 140,
      life: 0,
      ttl: 0.7 + Math.random() * 0.5,
    });
  }

  function resize() {
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    width = window.innerWidth;
    height = window.innerHeight;
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    createStars();
    if (reduceMotion) draw(0, 0);
  }

  function draw(time, dt) {
    ctx.clearRect(0, 0, width, height);
    const t = time / 1000;

    // Плавно догоняем курсор и учитываем прокрутку
    pointer.x += (pointer.tx - pointer.x) * 0.05;
    pointer.y += (pointer.ty - pointer.y) * 0.05;
    const scroll = reduceMotion ? 0 : window.scrollY * 0.08;

    for (const s of stars) {
      const a = reduceMotion ? s.base : s.base * (0.55 + 0.45 * Math.sin(t * s.speed + s.phase));
      let x = s.x - pointer.x * 18 * s.depth;
      let y = s.y - pointer.y * 18 * s.depth - scroll * s.depth;
      y = ((y % height) + height) % height;

      ctx.beginPath();
      ctx.fillStyle = `hsla(${s.hue}, 80%, 92%, ${a})`;
      ctx.arc(x, y, s.r, 0, Math.PI * 2);
      ctx.fill();

      if (s.r > 1.1) {
        // Ореол и лучи у ярких звёзд
        ctx.beginPath();
        ctx.fillStyle = `hsla(${s.hue}, 90%, 80%, ${a * 0.14})`;
        ctx.arc(x, y, s.r * 4.5, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = `hsla(${s.hue}, 90%, 90%, ${a * 0.35})`;
        ctx.lineWidth = 0.6;
        const l = s.r * 6;
        ctx.beginPath();
        ctx.moveTo(x - l, y); ctx.lineTo(x + l, y);
        ctx.moveTo(x, y - l); ctx.lineTo(x, y + l);
        ctx.stroke();
      }
    }

    // Падающие звёзды
    if (!reduceMotion) {
      if (time > nextMeteor) {
        spawnMeteor();
        nextMeteor = time + 2500 + Math.random() * 5000;
      }
      meteors = meteors.filter((m) => m.life < m.ttl);
      for (const m of meteors) {
        m.life += dt;
        m.x += m.vx * dt;
        m.y += m.vy * dt;
        const k = Math.sin((m.life / m.ttl) * Math.PI); // плавно появляется и гаснет
        const v = Math.hypot(m.vx, m.vy);
        const tx = m.x - (m.vx / v) * m.len;
        const ty = m.y - (m.vy / v) * m.len;
        const grad = ctx.createLinearGradient(m.x, m.y, tx, ty);
        grad.addColorStop(0, `rgba(255, 255, 255, ${0.9 * k})`);
        grad.addColorStop(0.3, `rgba(199, 210, 254, ${0.4 * k})`);
        grad.addColorStop(1, "rgba(165, 180, 252, 0)");
        ctx.strokeStyle = grad;
        ctx.lineWidth = 1.4;
        ctx.lineCap = "round";
        ctx.beginPath();
        ctx.moveTo(m.x, m.y);
        ctx.lineTo(tx, ty);
        ctx.stroke();
      }
    }
  }

  let last = 0;
  function loop(time) {
    const dt = Math.min((time - last) / 1000, 0.05);
    last = time;
    draw(time, dt);
    requestAnimationFrame(loop);
  }

  let resizeTimer;
  window.addEventListener("resize", () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(resize, 150);
  });

  resize();
  if (!reduceMotion) {
    nextMeteor = 1200;
    requestAnimationFrame(loop);
  }
})();
