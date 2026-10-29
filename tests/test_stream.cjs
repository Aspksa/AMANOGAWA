const test = require('node:test');
const assert = require('node:assert/strict');
const { readStream } = require('../js/stream.js');

function stream(chunks) {
  return new ReadableStream({ start(controller) {
    for (const chunk of chunks) controller.enqueue(chunk);
    controller.close();
  }});
}

test('UTF-8 across chunks and final line without newline', async () => {
  const encoded = new TextEncoder().encode('{"type":"text","text":"Привет"}\n{"type":"done"}');
  const events = [];
  await readStream(stream(Array.from(encoded, byte => new Uint8Array([byte]))), event => events.push(event));
  assert.deepEqual(events, [{ type: 'text', text: 'Привет' }, { type: 'done' }]);
});

test('interrupted answer is not treated as complete', async () => {
  await assert.rejects(readStream(stream([new TextEncoder().encode('{"type":"text","text":"partial"}\n')]), () => {}), /Соединение прервано/);
});

test('provider error and done are both delivered', async () => {
  const events = [];
  await readStream(stream([new TextEncoder().encode('{"type":"error","error":"failed"}\n{"type":"done"}\n')]), event => events.push(event));
  assert.equal(events[0].type, 'error');
  assert.equal(events[1].type, 'done');
});
