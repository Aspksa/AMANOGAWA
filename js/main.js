// AMANOGAWA — звёздное небо, меню и общий доступ к API

(function () {
  "use strict";

  document.documentElement.classList.add("js");

  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const finePointer = window.matchMedia("(hover: hover) and (pointer: fine)").matches;

  // ----- Запросы к серверу -----
  async function api(path, options = {}) {
    if (location.protocol === "file:") throw new Error("Сайт открыт как файл. Запустите AMANOGAWA.BAT.");
    const headers = { "X-Amanogawa": "1", ...(options.headers || {}) };
    if (options.json !== undefined) {
      headers["Content-Type"] = "application/json";
      options.body = JSON.stringify(options.json);
    }
    let res;
    try {
      res = await fetch("/api/" + path, { ...options, headers });
    } catch (_) {
      throw new Error("Сервер не запущен. Запустите AMANOGAWA.BAT.");
    }
    if (options.raw && res.ok) return res;
    let data = null;
    try { data = await res.json(); } catch (_) { /* не JSON */ }
    if (res.status === 404 && !data) throw new Error("Сервер базы знаний не запущен. Запустите AMANOGAWA.BAT.");
    if (!res.ok) throw new Error((data && (data.error || data.detail)) || `Ошибка ${res.status}`);
    return data;
  }

  // ----- Страницы и меню -----
  const views = [...document.querySelectorAll(".view")];
  const links = [...document.querySelectorAll(".rail__link")];
  const listeners = [];

  function route() {
    const name = (location.hash.replace(/^#\/?/, "") || "home");
    const view = views.find((v) => v.dataset.view === name) || views[0];
    views.forEach((v) => { v.hidden = v !== view; });
    document.body.dataset.view = view.dataset.view;
    links.forEach((a) => {
      if (a.getAttribute("href") === "#/" + view.dataset.view) a.setAttribute("aria-current", "page");
      else a.removeAttribute("aria-current");
    });
    document.title = view.dataset.view === "home" ? "AMANOGAWA" : `${view.dataset.title} · AMANOGAWA`;
    listeners.forEach((fn) => fn(view.dataset.view));
  }

  window.addEventListener("hashchange", route);
  listeners.push((name) => { if (name === "docs") refreshStatus(); });

  // Строка состояния подключения на страницах базы знаний
  async function refreshStatus() {
    const els = document.querySelectorAll("[data-status]");
    const set = (text, kind) => els.forEach((el) => { el.textContent = text; el.dataset.kind = kind; });
    try {
      const s = await api("status");
      if (!s.key) set("Нет ключа Cloud.ru — впишите его в «Настройках».", "warn");
      else if (s.error) set("Cloud.ru: " + s.error, "error");
      else set(`Cloud.ru · ${s.llm}`, s.ready ? "ok" : "warn");
      return s;
    } catch (e) {
      set(e.message, "warn");
      return null;
    }
  }

  window.AMA = {
    api,
    refreshStatus,
    onView(fn) { listeners.push(fn); },
    get view() { return (views.find((v) => !v.hidden) || views[0]).dataset.view; },
  };

  document.addEventListener("DOMContentLoaded", route);

  // Без сервера база знаний не работает — говорим об этом сразу
  if (location.protocol === "file:") {
    const note = document.createElement("div");
    note.className = "offline";
    note.setAttribute("role", "alert");
    note.innerHTML = "<strong>Сайт открыт как файл — сервер не запущен.</strong> Чат, документы, граф и настройки " +
      "работают только через <b>AMANOGAWA.BAT</b>: он запускает сервер и сам открывает сайт по адресу http://127.0.0.1:8000/. " +
      "Если окно BAT пишет, что Python не найден, — следуйте его подсказке.";
    document.body.append(note);
  }

  // ----- Параллакс звёзд за курсором -----
  const pointer = { x: 0, y: 0, tx: 0, ty: 0 }; // смещение, -1..1

  if (finePointer) {
    window.addEventListener("pointermove", (e) => {
      pointer.tx = (e.clientX / window.innerWidth) * 2 - 1;
      pointer.ty = (e.clientY / window.innerHeight) * 2 - 1;
    }, { passive: true });
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

    // Плавно догоняем курсор
    pointer.x += (pointer.tx - pointer.x) * 0.05;
    pointer.y += (pointer.ty - pointer.y) * 0.05;

    for (const s of stars) {
      const a = reduceMotion ? s.base : s.base * (0.55 + 0.45 * Math.sin(t * s.speed + s.phase));
      const x = s.x - pointer.x * 18 * s.depth;
      const y = s.y - pointer.y * 18 * s.depth;

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
