const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

async function importEventStream() {
  const source = fs.readFileSync(
    path.join(__dirname, "..", "src", "renderer", "event-stream.js"),
    "utf8"
  );
  return import(`data:text/javascript;base64,${Buffer.from(source).toString("base64")}#${Date.now()}-${Math.random()}`);
}

function createResponse(chunks, contentType = "text/event-stream; charset=utf-8") {
  const encoder = new TextEncoder();
  return new Response(new ReadableStream({
    start(controller) {
      chunks.forEach((chunk) => controller.enqueue(encoder.encode(chunk)));
      controller.close();
    }
  }), {
    headers: {
      "content-type": contentType
    }
  });
}

test("event-stream parser handles chunk boundaries and multiple events", async () => {
  const { createJsonEventStreamParser } = await importEventStream();
  const events = [];
  const parser = createJsonEventStreamParser({
    onEvent: (event) => events.push(event)
  });

  await parser.push("event: snap");
  await parser.push("shot\ndata: {\"remote\":");
  await parser.push("{\"items\":[1]}}\n\nevent: done\r\ndata: {\"ok\":true}\r\n\r\n");
  await parser.finish();

  assert.deepEqual(events.map((event) => event.event), ["snapshot", "done"]);
  assert.deepEqual(events[0].data, { remote: { items: [1] } });
  assert.deepEqual(events[1].data, { ok: true });
  assert.equal(events[0].done, false);
  assert.equal(events[1].done, true);
});

test("event-stream parser preserves CRLF boundaries split across chunks", async () => {
  const { createJsonEventStreamParser } = await importEventStream();
  const events = [];
  const parser = createJsonEventStreamParser({
    onEvent: (event) => events.push(event)
  });

  await parser.push('event: snapshot\r');
  await parser.push('\ndata: {"items":[1]}\r');
  await parser.push('\n\r');
  await parser.push('\nevent: done\r\ndata: {"items":[1,2]}\r\n\r\n');
  await parser.finish();

  assert.deepEqual(events.map((event) => event.event), ["snapshot", "done"]);
  assert.deepEqual(events[0].data, { items: [1] });
  assert.deepEqual(events[1].data, { items: [1, 2] });
});

test("event-stream parser joins multiline data before JSON decoding", async () => {
  const { createJsonEventStreamParser } = await importEventStream();
  const events = [];
  const parser = createJsonEventStreamParser({
    onEvent: (event) => events.push(event)
  });

  await parser.push('event: snapshot\ndata: {"items": [\ndata: 1, 2]}\n\n');
  await parser.finish();

  assert.deepEqual(events[0].data, { items: [1, 2] });
});

test("event-stream consumer yields progressive snapshots and the final result", async () => {
  const { consumeJsonEventStream } = await importEventStream();
  const events = [];
  const response = createResponse([
    'event: snapshot\ndata: {"remote":{"items":[{"id":"one"}],"progress":{"complete":false}}}\n\n',
    'event: done\ndata: {"remote":{"items":[{"id":"one"},{"id":"two"}],"progress":{"complete":true}}}\n\n'
  ]);

  const lastEvent = await consumeJsonEventStream(response, {
    onEvent: (event) => events.push(event)
  });

  assert.equal(events.length, 2);
  assert.equal(events[0].data.remote.items.length, 1);
  assert.equal(events[1].data.remote.items.length, 2);
  assert.equal(lastEvent.event, "done");
  assert.equal(lastEvent.done, true);
});

test("event-stream parser reports invalid JSON with event context", async () => {
  const { createJsonEventStreamParser } = await importEventStream();
  const parser = createJsonEventStreamParser();

  await assert.rejects(
    parser.push("event: snapshot\ndata: not-json\n\n"),
    /invalid JSON in the snapshot search event/
  );
});

test("event-stream consumer honours an aborted search", async () => {
  const { consumeJsonEventStream } = await importEventStream();
  const abortController = new AbortController();
  abortController.abort(new DOMException("superseded", "AbortError"));

  await assert.rejects(
    consumeJsonEventStream(createResponse([]), {
      signal: abortController.signal
    }),
    (error) => error?.name === "AbortError"
  );
});
