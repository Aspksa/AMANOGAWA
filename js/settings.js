// AMANOGAWA — настройки: ключ Cloud.ru, модели, поиск, индексация (сохраняются в .env)

(function () {
  "use strict";

  const form = document.getElementById("settings-form");
  const status = document.getElementById("settings-status");
  const keyInput = document.getElementById("set-key");
  const keyHint = document.getElementById("set-key-hint");
  const checkBtn = document.getElementById("set-check");
  const modelList = document.getElementById("model-list");
  const saveBtn = document.querySelector('button[form="settings-form"]');

  function say(text, kind) {
    status.textContent = text;
    if (kind) status.dataset.kind = kind;
    else delete status.dataset.kind;
  }

  function fill(s) {
    for (const [k, v] of Object.entries(s.values)) {
      const el = form.elements[k];
      if (el) el.value = v;
    }
    keyInput.value = "";
    keyInput.placeholder = s.key_set ? `Ключ сохранён ${s.key_hint} — впишите новый, чтобы заменить` : "Вставьте ключ Foundation Models";
    keyHint.textContent = s.key_set
      ? "Ключ сохранён в файле .env на этом компьютере."
      : "Ключ ещё не задан. Он сохранится только в файле .env на этом компьютере.";
  }

  async function load() {
    try {
      fill(await AMA.api("settings"));
      say("");
    } catch (e) {
      say(e.message, "warn");
    }
  }

  async function loadModels() {
    checkBtn.disabled = true;
    say("Проверяю ключ…", "warn");
    try {
      const r = await AMA.api("models", {
        method: "POST",
        json: { api_key: keyInput.value, base_url: form.elements.CLOUDRU_BASE_URL.value },
      });
      modelList.replaceChildren(...r.models.map((m) => new Option(m)));
      say(`Ключ работает. Доступно моделей: ${r.models.length} — выберите их в полях ниже.`, "ok");
    } catch (e) {
      say(e.message, "error");
    }
    checkBtn.disabled = false;
  }

  checkBtn.addEventListener("click", loadModels);

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const values = {};
    for (const el of form.elements) {
      if (el.name && el.name !== "api_key") values[el.name] = el.value;
    }
    saveBtn.disabled = true;
    say("Сохраняю…", "warn");
    try {
      fill(await AMA.api("settings", { method: "PUT", json: { values, api_key: keyInput.value } }));
      say("Сохранено. Подключаюсь к Cloud.ru…", "warn");
      const s = await AMA.api("connect", { method: "POST" });
      say(`Сохранено и подключено: ${s.llm}, эмбеддинги ${s.embedding} (размер ${s.dim}).`, "ok");
    } catch (err) {
      say(err.message, "error");
    }
    saveBtn.disabled = false;
  });

  AMA.onView((name) => { if (name === "settings") load(); });
})();
