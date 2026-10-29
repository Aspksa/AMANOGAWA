// AMANOGAWA — база знаний: загрузка документов и вопросы к RAG-Anything

(function () {
  "use strict";

  const $ = (id) => document.getElementById(id);
  const statusEl = $("rag-status");
  const fileInput = $("rag-file");
  const drop = $("rag-drop");
  const docsEl = $("rag-docs");
  const chat = $("rag-chat");
  const form = $("rag-form");
  const q = $("rag-q");
  const mode = $("rag-mode");

  const STATUS = { queued: "в очереди", processing: "индексируется", done: "готово", error: "ошибка" };
  let online = false;
  let polling = null;

  async function api(path, options) {
    const res = await fetch("/api/" + path, options);
    let data = null;
    try { data = await res.json(); } catch (_) { /* не JSON */ }
    if (!res.ok) throw new Error((data && (data.error || data.detail)) || `Ошибка ${res.status}`);
    return data;
  }

  function setStatus(text, kind) {
    statusEl.textContent = text;
    statusEl.dataset.kind = kind || "";
  }

  async function checkStatus() {
    if (location.protocol === "file:") {
      setStatus("Сайт открыт как файл. Запустите AMANOGAWA.BAT, чтобы включить базу знаний.", "warn");
      return;
    }
    try {
      const s = await api("status");
      online = true;
      if (!s.key) {
        setStatus("Нет ключа Cloud.ru: впишите CLOUDRU_API_KEY в файл .env и перезапустите AMANOGAWA.BAT.", "warn");
      } else if (s.error) {
        setStatus("Cloud.ru: " + s.error, "error");
      } else {
        setStatus(`Cloud.ru подключён · ${s.llm} · эмбеддинги ${s.embedding}`, "ok");
      }
      refreshDocs();
    } catch (_) {
      setStatus("Сервер базы знаний не запущен. Запустите AMANOGAWA.BAT.", "warn");
    }
  }

  function renderDocs(list) {
    docsEl.replaceChildren(...list.map((d) => {
      const li = document.createElement("li");
      li.className = "doc doc--" + d.status;
      const name = document.createElement("span");
      name.className = "doc__name";
      name.textContent = d.name;
      const st = document.createElement("span");
      st.className = "doc__status";
      st.textContent = STATUS[d.status] || d.status;
      li.append(name, st);
      if (d.error) {
        const err = document.createElement("small");
        err.className = "doc__error";
        err.textContent = d.error;
        li.append(err);
      }
      return li;
    }));
  }

  async function refreshDocs() {
    try {
      const list = await api("documents");
      renderDocs(list);
      const busy = list.some((d) => d.status === "queued" || d.status === "processing");
      clearTimeout(polling);
      if (busy) polling = setTimeout(refreshDocs, 2000);
    } catch (_) { /* сервер недоступен */ }
  }

  async function upload(files) {
    if (!online) { checkStatus(); return; }
    for (const file of files) {
      const body = new FormData();
      body.append("file", file);
      try {
        await api("upload", { method: "POST", body });
      } catch (e) {
        setStatus(`${file.name}: ${e.message}`, "error");
      }
    }
    refreshDocs();
  }

  fileInput.addEventListener("change", () => {
    upload([...fileInput.files]);
    fileInput.value = "";
  });

  ["dragenter", "dragover"].forEach((t) => drop.addEventListener(t, (e) => {
    e.preventDefault();
    drop.classList.add("is-over");
  }));
  ["dragleave", "drop"].forEach((t) => drop.addEventListener(t, (e) => {
    e.preventDefault();
    drop.classList.remove("is-over");
  }));
  drop.addEventListener("drop", (e) => upload([...e.dataTransfer.files]));

  function addMessage(text, who) {
    chat.querySelector(".chat__empty")?.remove();
    const p = document.createElement("div");
    p.className = "msg msg--" + who;
    p.textContent = text;
    chat.append(p);
    chat.scrollTop = chat.scrollHeight;
    return p;
  }

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const text = q.value.trim();
    if (!text) return;
    if (!online) { checkStatus(); return; }
    addMessage(text, "user");
    q.value = "";
    const pending = addMessage("Думаю…", "bot");
    pending.classList.add("is-pending");
    const button = form.querySelector("button");
    button.disabled = true;
    try {
      const r = await api("query", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question: text, mode: mode.value }),
      });
      pending.textContent = r.answer;
    } catch (err) {
      pending.textContent = err.message;
      pending.classList.add("msg--error");
    }
    pending.classList.remove("is-pending");
    button.disabled = false;
    checkStatus();
  });

  q.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      form.requestSubmit();
    }
  });

  checkStatus();
})();
