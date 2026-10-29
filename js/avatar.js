// AMANOGAWA — аватар на главной: клик открывает чат, перетаскивание двигает его по экрану

(function () {
  "use strict";

  const avatar = document.querySelector(".avatar");
  const KEY = "amanogawa.avatar";
  let offset = { x: 0, y: 0 }; // сдвиг от исходного места, px
  let drag = null;
  let justDragged = false;

  try {
    const saved = JSON.parse(localStorage.getItem(KEY));
    if (saved && Number.isFinite(saved.x) && Number.isFinite(saved.y)) offset = saved;
  } catch (_) { /* хранилище недоступно — аватар на месте по умолчанию */ }

  function apply() {
    avatar.style.translate = `${offset.x}px ${offset.y}px`;
  }

  // Не даём увести аватар за край экрана
  function clamp() {
    const r = avatar.getBoundingClientRect();
    if (!r.width) return;
    const keep = 80;
    if (r.right < keep) offset.x += keep - r.right;
    if (r.left > innerWidth - keep) offset.x -= r.left - (innerWidth - keep);
    if (r.bottom < keep) offset.y += keep - r.bottom;
    if (r.top > innerHeight - keep) offset.y -= r.top - (innerHeight - keep);
    apply();
  }

  avatar.addEventListener("pointerdown", (e) => {
    if (e.button !== 0) return;
    drag = { id: e.pointerId, sx: e.clientX, sy: e.clientY, ox: offset.x, oy: offset.y, moved: false };
  });

  avatar.addEventListener("pointermove", (e) => {
    if (!drag || e.pointerId !== drag.id) return;
    const dx = e.clientX - drag.sx;
    const dy = e.clientY - drag.sy;
    if (!drag.moved && Math.hypot(dx, dy) < 6) return;
    if (!drag.moved) {
      drag.moved = true;
      avatar.setPointerCapture(e.pointerId);
      avatar.classList.add("is-dragging");
    }
    offset = { x: drag.ox + dx, y: drag.oy + dy };
    apply();
  });

  function end(e) {
    if (!drag || e.pointerId !== drag.id) return;
    if (drag.moved) {
      justDragged = true;
      setTimeout(() => { justDragged = false; }, 0);
      avatar.classList.remove("is-dragging");
      clamp();
      try { localStorage.setItem(KEY, JSON.stringify(offset)); } catch (_) { /* не сохранится — не страшно */ }
    }
    drag = null;
  }
  avatar.addEventListener("pointerup", end);
  avatar.addEventListener("pointercancel", end);

  // После перетаскивания не открываем чат
  avatar.addEventListener("click", (e) => {
    if (justDragged) {
      e.stopImmediatePropagation();
      e.preventDefault();
    }
  }, true);

  // Двойной клик возвращает аватар на место
  avatar.addEventListener("dblclick", () => {
    offset = { x: 0, y: 0 };
    apply();
    try { localStorage.removeItem(KEY); } catch (_) { /* ничего */ }
  });

  window.addEventListener("resize", clamp);
  apply();
  AMA.onView((name) => { if (name === "home") requestAnimationFrame(clamp); });
})();
