// AMANOGAWA — граф знаний: силовая раскладка на canvas, масштаб, перетаскивание, карточка узла

(function () {
  "use strict";

  const canvas = document.getElementById("graph-canvas");
  const ctx = canvas.getContext("2d");
  const info = document.getElementById("graph-info");
  const form = document.getElementById("graph-form");
  const labelInput = document.getElementById("graph-label");
  const maxSelect = document.getElementById("graph-max");
  const labelsList = document.getElementById("graph-labels");
  const card = document.getElementById("graph-card");

  const PALETTE = ["#a5b4fc", "#f0abfc", "#67e8f9", "#fcd34d", "#86efac", "#fda4af", "#c4b5fd", "#7dd3fc"];
  const typeColor = new Map();
  const colorOf = (type) => {
    if (!typeColor.has(type)) typeColor.set(type, PALETTE[typeColor.size % PALETTE.length]);
    return typeColor.get(type);
  };

  let nodes = [];
  let edges = [];
  let byId = new Map();
  let selected = null;
  let hover = null;
  let view = { x: 0, y: 0, k: 1 }; // сдвиг и масштаб
  let width = 0;
  let height = 0;
  let heat = 0; // «температура» раскладки: пока > 0, узлы двигаются
  let running = false;
  let loaded = false;
  let userMoved = false; // пока пользователь не двигал вид, граф сам вписывается в экран

  // ----- Данные -----
  async function load() {
    info.textContent = "Загружаю граф…";
    info.dataset.kind = "warn";
    try {
      const params = new URLSearchParams({ label: labelInput.value.trim() || "*", max_nodes: maxSelect.value });
      const g = await AMA.api("graph?" + params);
      build(g);
      loaded = true;
      info.dataset.kind = "ok";
      info.textContent = nodes.length
        ? `${nodes.length} сущностей · ${edges.length} связей${g.truncated ? " · показана часть" : ""}`
        : "Граф пуст: загрузите документы.";
      AMA.api("graph/labels").then((r) => {
        labelsList.replaceChildren(...r.labels.slice(0, 500).map((l) => new Option(l)));
      }).catch(() => {});
    } catch (e) {
      info.textContent = e.message;
      info.dataset.kind = "error";
      build({ nodes: [], edges: [] });
    }
  }

  function build(g) {
    const r = Math.sqrt(g.nodes.length) * 40 + 40;
    nodes = g.nodes.map((n, i) => {
      const a = i * 2.399963; // золотой угол — ровная начальная спираль
      const d = r * Math.sqrt((i + 0.5) / Math.max(g.nodes.length, 1));
      return { ...n, x: Math.cos(a) * d, y: Math.sin(a) * d, vx: 0, vy: 0, deg: 0 };
    });
    byId = new Map(nodes.map((n) => [n.id, n]));
    edges = g.edges.filter((e) => byId.has(e.source) && byId.has(e.target))
      .map((e) => ({ ...e, s: byId.get(e.source), t: byId.get(e.target) }));
    edges.forEach((e) => { e.s.deg++; e.t.deg++; });
    nodes.forEach((n) => { n.r = 4 + Math.min(10, Math.sqrt(n.deg) * 2.2); });
    select(null);
    view = { x: 0, y: 0, k: 1 };
    userMoved = false;
    heat = 1;
    start();
  }

  // ----- Раскладка -----
  function step() {
    const n = nodes.length;
    const repulse = 900;
    // Отталкивание (O(n²) достаточно для ~1000 узлов при затухании)
    for (let i = 0; i < n; i++) {
      const a = nodes[i];
      for (let j = i + 1; j < n; j++) {
        const b = nodes[j];
        let dx = a.x - b.x;
        let dy = a.y - b.y;
        let d2 = dx * dx + dy * dy;
        if (d2 < 0.01) { dx = Math.random(); dy = Math.random(); d2 = 1; }
        if (d2 > 250000) continue;
        const f = repulse / d2;
        a.vx += dx * f; a.vy += dy * f;
        b.vx -= dx * f; b.vy -= dy * f;
      }
    }
    // Пружины связей
    for (const e of edges) {
      const dx = e.t.x - e.s.x;
      const dy = e.t.y - e.s.y;
      const d = Math.hypot(dx, dy) || 1;
      const f = (d - 70) * 0.02;
      const fx = (dx / d) * f;
      const fy = (dy / d) * f;
      e.s.vx += fx; e.s.vy += fy;
      e.t.vx -= fx; e.t.vy -= fy;
    }
    // Притяжение к центру и затухание
    for (const p of nodes) {
      p.vx -= p.x * 0.004;
      p.vy -= p.y * 0.004;
      if (p === drag.node) { p.vx = p.vy = 0; continue; }
      p.vx *= 0.6; p.vy *= 0.6;
      p.x += p.vx * heat;
      p.y += p.vy * heat;
    }
    heat *= 0.985;
  }

  // ----- Отрисовка -----
  function resize() {
    if (!userMoved) requestAnimationFrame(() => { fit(); draw(); });
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    width = canvas.clientWidth;
    height = canvas.clientHeight;
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    draw();
  }

  const toScreen = (p) => [width / 2 + (p.x + view.x) * view.k, height / 2 + (p.y + view.y) * view.k];
  const toWorld = (sx, sy) => [(sx - width / 2) / view.k - view.x, (sy - height / 2) / view.k - view.y];

  function neighbours(n) {
    const set = new Set();
    for (const e of edges) {
      if (e.s === n) set.add(e.t);
      if (e.t === n) set.add(e.s);
    }
    return set;
  }

  function draw() {
    ctx.clearRect(0, 0, width, height);
    if (!nodes.length) return;
    const focus = selected || hover;
    const near = focus ? neighbours(focus) : null;

    ctx.lineWidth = 1;
    for (const e of edges) {
      const on = focus && (e.s === focus || e.t === focus);
      ctx.strokeStyle = on ? "rgba(240, 171, 252, 0.7)" : focus ? "rgba(165, 180, 252, 0.06)" : "rgba(165, 180, 252, 0.18)";
      const [x1, y1] = toScreen(e.s);
      const [x2, y2] = toScreen(e.t);
      ctx.beginPath();
      ctx.moveTo(x1, y1);
      ctx.lineTo(x2, y2);
      ctx.stroke();
    }

    const showLabels = view.k > 0.75 || nodes.length < 60;
    ctx.font = "12px Inter, system-ui, sans-serif";
    ctx.textAlign = "center";
    for (const p of nodes) {
      const [x, y] = toScreen(p);
      if (x < -40 || y < -40 || x > width + 40 || y > height + 40) continue;
      const dim = focus && p !== focus && !near.has(p);
      const r = p.r * Math.max(0.6, Math.min(view.k, 1.6));
      ctx.globalAlpha = dim ? 0.2 : 1;
      ctx.beginPath();
      ctx.fillStyle = colorOf(p.type);
      ctx.shadowColor = colorOf(p.type);
      ctx.shadowBlur = p === focus ? 18 : 6;
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fill();
      ctx.shadowBlur = 0;
      if (p === selected) {
        ctx.strokeStyle = "#fff";
        ctx.lineWidth = 1.5;
        ctx.stroke();
      }
      if ((showLabels && !dim) || p === focus || (near && near.has(p))) {
        ctx.fillStyle = "rgba(238, 240, 251, 0.9)";
        ctx.fillText(p.id.length > 28 ? p.id.slice(0, 27) + "…" : p.id, x, y + r + 14);
      }
    }
    ctx.globalAlpha = 1;
  }

  function fit() {
    if (!nodes.length || !width) return;
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const p of nodes) {
      x0 = Math.min(x0, p.x); y0 = Math.min(y0, p.y);
      x1 = Math.max(x1, p.x); y1 = Math.max(y1, p.y);
    }
    const pad = 70;
    view.k = Math.max(0.15, Math.min(1.6, (width - pad * 2) / (x1 - x0 || 1), (height - pad * 2) / (y1 - y0 || 1)));
    view.x = -(x0 + x1) / 2;
    view.y = -(y0 + y1) / 2;
  }

  function frame() {
    if (heat > 0.02) step();
    if (!userMoved && !drag.node) fit();
    draw();
    if (heat > 0.02 || drag.node) requestAnimationFrame(frame);
    else running = false;
  }

  function start() {
    if (running || AMA.view !== "graph") return;
    running = true;
    requestAnimationFrame(frame);
  }

  // ----- Карточка узла -----
  function select(n) {
    selected = n;
    if (!n) { card.hidden = true; draw(); return; }
    card.hidden = false;
    card.querySelector("h2").textContent = n.id;
    card.querySelector(".graph__type").textContent = n.type || "сущность";
    card.querySelector(".graph__desc").textContent = (n.description || "").split("<SEP>").join("\n\n");
    const links = card.querySelector(".graph__links");
    links.replaceChildren(...edges.filter((e) => e.s === n || e.t === n).slice(0, 40).map((e) => {
      const other = e.s === n ? e.t : e.s;
      const li = document.createElement("li");
      const b = document.createElement("button");
      b.type = "button";
      b.textContent = other.id;
      b.addEventListener("click", () => { select(other); center(other); });
      li.append(b);
      if (e.keywords) li.append(" — " + e.keywords.split("<SEP>")[0]);
      return li;
    }));
    draw();
  }

  function center(n) {
    userMoved = true;
    view.x = -n.x;
    view.y = -n.y;
    draw();
  }

  card.querySelector(".graph__close").addEventListener("click", () => select(null));

  // ----- Мышь и касания -----
  const drag = { node: null, pan: false, moved: false, sx: 0, sy: 0 };
  const pointers = new Map();
  let pinch = null;

  function hit(sx, sy) {
    const [wx, wy] = toWorld(sx, sy);
    let best = null;
    let bestD = Infinity;
    for (const p of nodes) {
      const d = Math.hypot(p.x - wx, p.y - wy);
      const r = (p.r + 6) / Math.min(view.k, 1);
      if (d < r && d < bestD) { best = p; bestD = d; }
    }
    return best;
  }

  const pos = (e) => {
    const rect = canvas.getBoundingClientRect();
    return [e.clientX - rect.left, e.clientY - rect.top];
  };

  canvas.addEventListener("pointerdown", (e) => {
    canvas.setPointerCapture(e.pointerId);
    pointers.set(e.pointerId, pos(e));
    if (pointers.size === 2) {
      const [a, b] = [...pointers.values()];
      pinch = { d: Math.hypot(a[0] - b[0], a[1] - b[1]), k: view.k };
      drag.node = null;
      drag.pan = false;
      return;
    }
    const [sx, sy] = pos(e);
    drag.node = hit(sx, sy);
    drag.pan = !drag.node;
    drag.moved = false;
    drag.sx = sx;
    drag.sy = sy;
    canvas.classList.add("is-dragging");
    if (drag.node) { heat = Math.max(heat, 0.3); start(); }
  });

  canvas.addEventListener("pointermove", (e) => {
    const [sx, sy] = pos(e);
    if (pointers.has(e.pointerId)) pointers.set(e.pointerId, [sx, sy]);
    if (pinch && pointers.size === 2) {
      const [a, b] = [...pointers.values()];
      userMoved = true;
      view.k = Math.max(0.15, Math.min(4, pinch.k * Math.hypot(a[0] - b[0], a[1] - b[1]) / pinch.d));
      draw();
      return;
    }
    if (!drag.node && !drag.pan) {
      const h = hit(sx, sy);
      if (h !== hover) { hover = h; canvas.style.cursor = h ? "pointer" : ""; draw(); }
      return;
    }
    if (Math.hypot(sx - drag.sx, sy - drag.sy) > 3) drag.moved = true;
    if (drag.node) {
      const [wx, wy] = toWorld(sx, sy);
      drag.node.x = wx;
      drag.node.y = wy;
      heat = Math.max(heat, 0.3);
    } else {
      userMoved = true;
      view.x += (sx - drag.sx) / view.k;
      view.y += (sy - drag.sy) / view.k;
      drag.sx = sx;
      drag.sy = sy;
      draw();
    }
  });

  function end(e) {
    pointers.delete(e.pointerId);
    if (pointers.size < 2) pinch = null;
    if (!drag.moved && (drag.node || drag.pan)) select(drag.node);
    drag.node = null;
    drag.pan = false;
    canvas.classList.remove("is-dragging");
  }
  canvas.addEventListener("pointerup", end);
  canvas.addEventListener("pointercancel", end);

  canvas.addEventListener("wheel", (e) => {
    e.preventDefault();
    userMoved = true;
    const [sx, sy] = pos(e);
    const [wx, wy] = toWorld(sx, sy);
    view.k = Math.max(0.15, Math.min(4, view.k * Math.exp(-e.deltaY * 0.0015)));
    // Масштаб вокруг курсора
    view.x = (sx - width / 2) / view.k - wx;
    view.y = (sy - height / 2) / view.k - wy;
    draw();
  }, { passive: false });

  form.addEventListener("submit", (e) => {
    e.preventDefault();
    const label = labelInput.value.trim();
    const node = byId.get(label);
    if (node && maxSelect.value === String(lastMax)) { select(node); center(node); return; }
    lastMax = maxSelect.value;
    load();
  });
  let lastMax = maxSelect.value;

  new ResizeObserver(resize).observe(canvas);

  AMA.onView((name) => {
    if (name !== "graph") return;
    resize();
    if (!loaded) load();
    else start();
  });
})();
