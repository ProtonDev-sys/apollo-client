const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const rendererPath = path.join(__dirname, "..", "src", "renderer.js");

function readRenderer() {
  return fs.readFileSync(rendererPath, "utf8");
}

test("renderer delegates indexed search and bounded cache policy", () => {
  const source = readRenderer();

  assert.match(source, /from "\.\/renderer\/search-index\.js";/);
  assert.match(source, /const localTrackSearch = createTrackSearchEngine\(/);
  assert.match(source, /const searchResultCache = createTimedLruCache\(/);
  assert.match(source, /const artistSearchCache = createTimedLruCache\(/);
  assert.match(source, /localTrackSearch\.search\(collection\.tracks, trimmedQuery,/);
  assert.match(source, /cacheKey: collection\.cacheKey/);
  assert.match(source, /limit: 250/);
  assert.match(source, /mergeSearchTracks\(localTracks, remoteResults,/);
  assert.doesNotMatch(source, /function matchesTrackQuery\(/);
  assert.doesNotMatch(source, /const searchResultCache = new Map\(\);/);
  assert.doesNotMatch(source, /const artistSearchCache = new Map\(\);/);
});

test("one-character searches remain local", () => {
  const source = readRenderer();

  assert.match(source, /shouldSearchRemote\(trimmedQuery\)/);
  assert.match(source, /shouldSearchRemote\(query\)/);
  assert.match(source, /if \(collectionScopedSearch \|\| !networkSearchEnabled\)/);
});

test("remote song search consumes progressive server events", () => {
  const source = readRenderer();

  assert.match(source, /requestJson\.requestEventStream\(/);
  assert.match(source, /&stream=1/);
  assert.match(source, /onProgress\(\{[\s\S]*?complete,/);
  assert.match(source, /onProgress\(\{ tracks, warnings, complete \}\)/);
});

test("song search does not fan out artist detail requests before selection", () => {
  const source = readRenderer();

  assert.doesNotMatch(source, /async function enrichArtistSearchResults\(/);
  assert.doesNotMatch(source, /return enrichArtistSearchResults\(artists/);
});

test("renderer search integration remains smaller after extraction", () => {
  const source = readRenderer();
  assert.ok(
    Buffer.byteLength(source, "utf8") < 345000,
    "renderer.js should remain below 345000 bytes"
  );
});
