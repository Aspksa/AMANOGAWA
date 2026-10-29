// AMANOGAWA — вопросы к базе знаний: потоковый ответ, источники, память диалога

(function () {
  "use strict";

  const log = document.getElementById("chat-log");
  const form = document.getElementById("chat-form");
  const q = document.getElementById("chat-q");
  const mode = document.getElementById("chat-mode");
  const send = form.querySelector("button");
  const emptyHTML = log.innerHTML;

  let history = []; // [{role, content}] — уходит на сервер для уточняющих вопросов
  let defaultMode = null;

  // ----- Простая разметка Markdown (без HTML из ответа) -----
  function escape(text) {
    return text.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  }

  function inline(text) {
    return escape(text)
      .replace(/`([^`]+)`/g, "<code>$1</code>")
      .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
      .replace(/(^|[\s(])\*([^*\s][^*]*)\*/g, "$1<em>$2</em>");
  }

  function markdown(src) {
    const out = [];
    let list = null;
    let code = null;
    const closeList = () => { if (list) { out.push(`</${list}>`); list = null; } };

    for (const line of src.split("\n")) {
      if (code !== null) {
        if (/^```/.test(line)) { out.push(`<pre><code>${escape(code.join("\n"))}</code></pre>`); code = null; }
        else code.push(line);
        continue;
      }
      if (/^```/.test(line)) { closeList(); code = []; continue; }

      let m;
      if ((m = line.match(/^#{1,6}\s+(.*)/))) { closeList(); out.push(`<h3>${inline(m[1])}</h3>`); }
      else if ((m = line.match(/^\s*[-*•]\s+(.*)/))) {
        if (list !== "ul") { closeList(); out.push("<ul>"); list = "ul"; }
        out.push(`<li>${inline(m[1])}</li>`);
      } else if ((m = line.match(/^\s*\d+[.)]\s+(.*)/))) {
        if (list !== "ol") { closeList(); out.push("<ol>"); list = "ol"; }
        out.push(`<li>${inline(m[1])}</li>`);
      } else if (line.trim() === "") { closeList(); }
      else { closeList(); out.push(`<p>${inline(line)}</p>`); }
    }
    if (code !== null) out.push(`<pre><code>${escape(code.join("\n"))}</code></pre>`);
    closeList();
    return out.join("");
  }

  // ----- Сообщения -----
  function add(who) {
    log.querySelector(".empty")?.remove();
    const el = document.createElement("div");
    el.className = "msg msg--" + who;
    log.append(el);
    return el;
  }

  const atBottom = () => log.scrollHeight - log.scrollTop - log.clientHeight < 80;

  function showSources(el, sources) {
    const files = [...new Set(sources.map((s) => s.file).filter(Boolean))];
    if (!files.length) return;
    const box = document.createElement("div");
    box.className = "sources";
    box.setAttribute("aria-label", "Источники");
    for (const f of files) {
      const chip = document.createElement("span");
      chip.className = "source";
      chip.textContent = f;
      box.append(chip);
    }
    el.append(box);
  }

  async function ask(text) {
    const user = add("user");
    user.textContent = text;
    const bot = add("bot");
    bot.classList.add("is-pending");
    log.scrollTop = log.scrollHeight;
    send.disabled = true;

    let answer = "";
    let sources = [];
    let failed = false;
    try {
      const res = await AMA.api("query", {
        method: "POST",
        json: { question: text, mode: mode.value, history },
        raw: true,
      });
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop();
        for (const line of lines) {
          if (!line.trim()) continue;
          const ev = JSON.parse(line);
          if (ev.type === "sources") sources = ev.sources;
          else if (ev.type === "text") {
            const stick = atBottom();
            answer += ev.text;
            bot.innerHTML = markdown(answer);
            if (stick) log.scrollTop = log.scrollHeight;
          } else if (ev.type === "error") {
            failed = true;
            answer += (answer ? "\n\n" : "") + ev.error;
          }
        }
      }
    } catch (e) {
      failed = true;
      answer = e.message;
    }

    bot.classList.remove("is-pending");
    if (failed) {
      bot.classList.add("msg--error");
      bot.textContent = answer;
    } else {
      bot.innerHTML = markdown(answer || "Пустой ответ.");
      showSources(bot, sources);
      history.push({ role: "user", content: text }, { role: "assistant", content: answer });
      history = history.slice(-40);
    }
    log.scrollTop = log.scrollHeight;
    send.disabled = false;
    q.focus();
  }

  form.addEventListener("submit", (e) => {
    e.preventDefault();
    const text = q.value.trim();
    if (!text || send.disabled) return;
    q.value = "";
    grow();
    ask(text);
  });

  // Enter — отправить, Shift+Enter — новая строка
  q.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey && !e.isComposing) {
      e.preventDefault();
      form.requestSubmit();
    }
  });

  function grow() {
    q.style.height = "auto";
    q.style.height = q.scrollHeight + 2 + "px";
  }
  q.addEventListener("input", grow);

  document.getElementById("chat-new").addEventListener("click", () => {
    history = [];
    log.innerHTML = emptyHTML;
    q.focus();
  });

  AMA.onView(async (name) => {
    if (name !== "chat") return;
    if (defaultMode === null) {
      try {
        defaultMode = (await AMA.api("settings")).values.QUERY_MODE;
        mode.value = defaultMode;
      } catch (_) { defaultMode = ""; }
    }
    q.focus({ preventScroll: true });
  });
})();
