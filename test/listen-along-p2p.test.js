const test = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");
const { createListenAlongServer } = require("../src/listen-along-p2p");

async function waitFor(predicate, timeoutMs = 1500) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) {
      return;
    }

    await new Promise((resolve) => setTimeout(resolve, 10));
  }

  throw new Error("Timed out waiting for listen-along state change.");
}

async function requestJson({ port, path }) {
  return new Promise((resolve, reject) => {
    const request = http.request(
      {
        host: "127.0.0.1",
        port,
        path,
        method: "GET"
      },
      (response) => {
        let raw = "";
        response.on("data", (chunk) => {
          raw += chunk.toString();
        });
        response.on("end", () => {
          resolve({
            statusCode: response.statusCode,
            headers: response.headers,
            body: raw && String(response.headers["content-type"] || "").includes("application/json")
              ? JSON.parse(raw)
              : raw
          });
        });
      }
    );

    request.on("error", reject);
    request.end();
  });
}

test("listen-along stays idle until a valid session is published", async () => {
  const server = createListenAlongServer({
    enableUpnp: false
  });

  try {
    const initialState = await server.start();
    assert.equal(initialState.available, true);
    assert.equal(initialState.running, false);
    assert.equal(initialState.port, 0);
    assert.equal(initialState.upnpEnabled, false);

    await assert.rejects(
      server.publishSession({
        sessionId: "",
        trackId: "track-1",
        sourceStreamUrl: "http://127.0.0.1:9/audio.mp3"
      }),
      /payload is incomplete/
    );
    assert.equal(server.getState().running, false);

    const published = await server.publishSession({
      sessionId: "session-1",
      token: "test-token",
      trackId: "track-1",
      title: "Apollo",
      artist: "Tester",
      status: "playing",
      sourceStreamUrl: "http://127.0.0.1:9/audio.mp3"
    });

    assert.equal(published.running, true);
    assert.ok(published.port > 0);
    assert.equal(published.token, "test-token");

    const denied = await requestJson({
      port: published.port,
      path: "/session/session-1?token=wrong"
    });
    assert.equal(denied.statusCode, 403);

    const session = await requestJson({
      port: published.port,
      path: "/session/session-1?token=test-token"
    });
    assert.equal(session.statusCode, 200);
    assert.equal(session.body.sessionId, "session-1");
    assert.equal(session.body.trackId, "track-1");
    assert.equal(session.headers["cache-control"], "no-store");
    assert.equal(session.headers["x-content-type-options"], "nosniff");
    assert.equal(session.headers["referrer-policy"], "no-referrer");

    server.clearSession("session-1");
    await waitFor(() => !server.getState().running);
    assert.equal(server.getState().port, 0);
  } finally {
    await server.stop();
  }
});
