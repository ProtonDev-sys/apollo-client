const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const rendererPath = path.join(__dirname, "..", "src", "renderer.js");

function readRenderer() {
  return fs.readFileSync(rendererPath, "utf8");
}

test("renderer delegates track modeling to a focused module", () => {
  const source = readRenderer();

  assert.match(source, /from "\.\/renderer\/track-model\.js";/);
  [
    "buildTrackKey",
    "normaliseProviderIds",
    "normaliseMetadataText",
    "normaliseTrackArtists",
    "normaliseTrackNumberTag",
    "normaliseTrackReleaseDate",
    "normaliseTrackExplicitFlag",
    "buildTrackMetadataSnapshot",
    "getTrackNormalizedDuration",
    "getTrackNormalizedText",
    "hasMatchingProviderIds",
    "hasMatchingNormalizedMetadata",
    "areTracksEquivalent",
    "isGenericAlbumName",
    "isTrackLikelyPlayable"
  ].forEach((functionName) => {
    assert.doesNotMatch(
      source,
      new RegExp(`function\\s+${functionName}\\s*\\(`),
      `${functionName} should remain in track-model.js`
    );
  });
});

test("listen-along fallback uses a generation-guarded polling lifecycle", () => {
  const source = readRenderer();

  assert.match(source, /from "\.\/renderer\/polling-controller\.js";/);
  assert.match(source, /const joinedListenAlongPolling = createPollingController\(/);
  assert.match(
    source,
    /task: \(\{ isCurrent \}\) => refreshJoinedListenAlongSession\(\{ isCurrent \}\)/
  );
  assert.match(source, /joinedListenAlongPolling\.start\(\)/);
  assert.match(source, /joinedListenAlongPolling\.stop\(\)/);
  assert.match(source, /void joinedListenAlongPolling\.run\(\);/);
  assert.match(source, /function isJoinedListenAlongRefreshCurrent\(/);
  assert.match(
    source,
    /function setupListenAlongJoinDataChannel[\s\S]*?channel\.onopen = \(\) => \{[\s\S]*?joinedListenAlongPolling\.stop\(\);/
  );
  assert.match(
    source,
    /Direct peer connect timed out\.[\s\S]*?startJoinedListenAlongPolling\(sessionId,/
  );
  assert.match(
    source,
    /async function refreshJoinedListenAlongSession\(\{ isCurrent = \(\) => true \} = \{\}\)/
  );
  assert.doesNotMatch(source, /pollHandle\s*:/);
  assert.doesNotMatch(source, /listenAlongState\.pollHandle/);
  assert.doesNotMatch(source, /pollInFlight/);
});

test("listen-along captures the active playback deck", () => {
  const source = readRenderer();

  assert.match(
    source,
    /function getListenAlongCaptureStream\(\) \{[\s\S]*?const sourceElement = getActiveAudioElement\(\);/
  );
  assert.doesNotMatch(
    source,
    /function getListenAlongCaptureStream\(\) \{\s*if \(typeof audioPlayer\.captureStream/
  );
});

test("renderer decomposition reduces the top-level module size", () => {
  const source = readRenderer();
  const maximumBytes = 345000;

  assert.ok(
    Buffer.byteLength(source, "utf8") < maximumBytes,
    `renderer.js should stay below ${maximumBytes} bytes after extraction`
  );
});
