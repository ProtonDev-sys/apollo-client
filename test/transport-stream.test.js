const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

async function importTransport() {
  const eventStreamSource = fs.readFileSync(
    path.join(__dirname, "..", "src", "renderer", "event-stream.js"),
    "utf8"
  );
  const eventStreamUrl = `data:text/javascript;base64,${Buffer.from(eventStreamSource).toString("base64")}`;
  const transportSource = fs.readFileSync(
    path.join(__dirname, "..", "src", "renderer", "transport.js"),
    "utf8"
  ).replace('"./event-stream.js"', JSON.stringify(eventStreamUrl));
  return import(`data:text/javascript;base64,${Buffer.from(transportSource).toString("base64")}#${Date.now()}-${Math.random()}`);
}

function streamResponse(chunks) {
  const encoder = new TextEncoder();
  return new Response(new ReadableStream({
    start(controller) {
      chunks.forEach((chunk) => controller.enqueue(encoder.encode(chunk)));
      controller.close();
    }
  }), {
    status: 200,
    headers: {
      "content-type": "text/event-stream; charset=utf-8"
    }
  });
}

function createTransport(createApolloTransport, overrides = {}) {
  return createApolloTransport({
    getApiBase: () => "http://127.0.0.1:4848",
    getAuthorizationHeader: () => "Bearer token",
    onConnectionRecovered: overrides.onConnectionRecovered,
    onConnectionFailure: overrides.onConnectionFailure,
    onAuthFailure: overrides.onAuthFailure
  });
}

test("event-stream requests send auth, client headers, and progressive events", async (context) => {
  const { createApolloTransport } = await importTransport();
  const originalFetch = global.fetch;
  const requests = [];
  context.after(() => {
    global.fetch = originalFetch;
  });

  global.fetch = async (url, options) => {
    requests.push({ url, options });
    return streamResponse([
      'event: snapshot\ndata: {"remote":{"items":[{"id":"one"}]}}\n\n',
      'event: done\ndata: {"remote":{"items":[{"id":"one"},{"id":"two"}]}}\n\n'
    ]);
  };

  const events = [];
  const requestJson = createTransport(createApolloTransport);
  const lastEvent = await requestJson.requestEventStream(
    "/api/search?query=test&stream=1",
    {
      headers: {
        "X-Client-Id": "client-one"
      }
    },
    (event) => events.push(event)
  );

  assert.equal(events.length, 2);
  assert.equal(events[0].event, "snapshot");
  assert.equal(events[1].event, "done");
  assert.equal(lastEvent.data.remote.items.length, 2);
  assert.equal(lastEvent.done, true);
  assert.equal(requests[0].options.headers.get("Accept"), "text/event-stream");
  assert.equal(requests[0].options.headers.get("Authorization"), "Bearer token");
  assert.equal(requests[0].options.headers.get("X-Client-Id"), "client-one");
});

test("event-stream transport rejects an incomplete stream instead of caching a partial result", async (context) => {
  const { createApolloTransport } = await importTransport();
  const originalFetch = global.fetch;
  context.after(() => {
    global.fetch = originalFetch;
  });

  global.fetch = async () => streamResponse([
    'event: snapshot\ndata: {"remote":{"items":[{"id":"partial"}],"progress":{"complete":false}}}\n\n'
  ]);

  const events = [];
  const requestJson = createTransport(createApolloTransport);
  await assert.rejects(
    requestJson.requestEventStream("/api/search?stream=1", {}, (event) => events.push(event)),
    (error) => error?.code === "APOLLO_INCOMPLETE_STREAM"
  );
  assert.equal(events.length, 1);
  assert.equal(events[0].event, "snapshot");
});

test("event-stream transport accepts JSON from older servers as one done event", async (context) => {
  const { createApolloTransport } = await importTransport();
  const originalFetch = global.fetch;
  context.after(() => {
    global.fetch = originalFetch;
  });

  global.fetch = async () => new Response(JSON.stringify({
    remote: {
      items: [{ id: "one" }]
    }
  }), {
    status: 200,
    headers: {
      "content-type": "application/json"
    }
  });

  const events = [];
  const requestJson = createTransport(createApolloTransport);
  const event = await requestJson.requestEventStream("/api/search", {}, (nextEvent) => {
    events.push(nextEvent);
  });

  assert.equal(events.length, 1);
  assert.equal(event.event, "done");
  assert.equal(event.done, true);
  assert.deepEqual(event.data.remote.items, [{ id: "one" }]);
});

test("event-stream transport propagates auth failures through the normal handler", async (context) => {
  const { createApolloTransport } = await importTransport();
  const originalFetch = global.fetch;
  const authMessages = [];
  context.after(() => {
    global.fetch = originalFetch;
  });

  global.fetch = async () => new Response(JSON.stringify({ error: "Session expired" }), {
    status: 401,
    headers: {
      "content-type": "application/json"
    }
  });

  const requestJson = createTransport(createApolloTransport, {
    onAuthFailure: (message) => authMessages.push(message)
  });

  await assert.rejects(
    requestJson.requestEventStream("/api/search"),
    (error) => error?.code === "AUTH_REQUIRED" && error.message === "Session expired"
  );
  assert.deepEqual(authMessages, ["Session expired"]);
});

test("aborted event-stream requests do not trigger connection failure UI", async (context) => {
  const { createApolloTransport } = await importTransport();
  const originalFetch = global.fetch;
  const failures = [];
  context.after(() => {
    global.fetch = originalFetch;
  });

  global.fetch = async () => {
    throw new DOMException("superseded", "AbortError");
  };

  const requestJson = createTransport(createApolloTransport, {
    onConnectionFailure: (error) => failures.push(error)
  });

  await assert.rejects(
    requestJson.requestEventStream("/api/search"),
    (error) => error?.name === "AbortError"
  );
  assert.deepEqual(failures, []);
});
