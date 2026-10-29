// AMANOGAWA — документы базы знаний: загрузка, статус индексации, удаление

(function () {
  "use strict";

  const list = document.getElementById("docs-list");
  const input = document.getElementById("docs-file");
  const drop = document.getElementById("docs-drop");

  const STATUS = { queued: "в очереди", processing: "индексируется", done: "готово", error: "ошибка" };
  let timer = null;
  let lastError = null;
  let wasBusy = false;

  function when(iso) {
    if (!iso) return "";
    const d = new Date(iso);
    return isNaN(d) ? "" : d.toLocaleString("ru-RU", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
  }

  function render(docs) {
    if (!docs.length) {
      const li = document.createElement("li");
      li.className = "empty";
      li.textContent = lastError || "Документов пока нет.";
      list.replaceChildren(li);
      return;
    }
    list.replaceChildren(...docs.map((d) => {
      const li = document.createElement("li");
      li.className = "doc doc--" + d.status;

      const name = document.createElement("span");
      name.className = "doc__name";
      name.textContent = d.name;
      const meta = document.createElement("small");
      meta.className = "doc__meta";
      meta.textContent = [d.chunks ? `${d.chunks} фрагм.` : "", when(d.updated)].filter(Boolean).join(" · ");
      name.append(meta);

      const st = document.createElement("span");
      st.className = "doc__status";
      st.textContent = STATUS[d.status] || d.status;

      const del = document.createElement("button");
      del.className = "doc__del";
      del.type = "button";
      del.textContent = "×";
      del.title = "Удалить из базы";
      del.setAttribute("aria-label", `Удалить ${d.name}`);
      del.disabled = d.status === "queued" || d.status === "processing";
      del.addEventListener("click", () => remove(d, del));

      li.append(name, st, del);
      if (d.error) {
        const err = document.createElement("small");
        err.className = "doc__error";
        err.textContent = d.error;
        li.append(err);
      }
      return li;
    }));
  }

  async function refresh() {
    clearTimeout(timer);
    try {
      const docs = await AMA.api("documents");
      lastError = null;
      render(docs);
      const busy = docs.some((d) => d.status === "queued" || d.status === "processing");
      if (busy) timer = setTimeout(refresh, 2000);
      else if (wasBusy) AMA.refreshStatus(); // база только что запустилась или обновилась
      wasBusy = busy;
    } catch (e) {
      lastError = e.message;
      render([]);
    }
  }

  async function remove(doc, button) {
    if (!confirm(`Удалить «${doc.name}» из базы знаний? Связанные сущности графа тоже удалятся.`)) return;
    button.disabled = true;
    try {
      await AMA.api("documents/" + encodeURIComponent(doc.id), { method: "DELETE" });
    } catch (e) {
      alert(e.message);
    }
    refresh();
  }

  async function upload(files) {
    clearTimeout(timer);
    for (const file of files) {
      const body = new FormData();
      body.append("file", file);
      try {
        await AMA.api("upload", { method: "POST", body });
      } catch (e) {
        const status = document.querySelector('[data-view="docs"] [data-status]');
        status.textContent = `${file.name}: ${e.message}`;
        status.dataset.kind = "error";
      }
    }
    refresh();
  }

  input.addEventListener("change", () => {
    upload([...input.files]);
    input.value = "";
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

  AMA.onView((name) => {
    if (name === "docs") refresh();
    else clearTimeout(timer);
  });
})();
