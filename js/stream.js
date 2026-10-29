// Read NDJSON even when UTF-8 characters or the final line cross chunk boundaries.
(function () {
  "use strict";

  async function readStream(body, onEvent) {
    if (!body) throw new Error("Сервер не вернул поток ответа.");
    const reader = body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let complete = false;
    const consume = (line) => {
      if (!line.trim() || complete) return;
      const event = JSON.parse(line);
      onEvent(event);
      if (event.type === "done") complete = true;
    };
    try {
      for (;;) {
        const { value, done } = await reader.read();
        buffer += done ? decoder.decode() : decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop();
        lines.forEach(consume);
        if (done) {
          consume(buffer);
          if (!complete) throw new Error("Соединение прервано до завершения ответа. Повторите вопрос.");
          break;
        }
      }
    } finally {
      try { await reader.cancel(); } finally { reader.releaseLock(); }
    }
  }

  if (typeof module !== "undefined" && module.exports) module.exports = { readStream };
  else window.AMA.readStream = readStream;
})();
