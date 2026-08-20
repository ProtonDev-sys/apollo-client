const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

async function importSearchIndex() {
  const source = fs.readFileSync(
    path.join(__dirname, "..", "src", "renderer", "search-index.js"),
    "utf8"
  );
  return import(`data:text/javascript;base64,${Buffer.from(source).toString("base64")}#${Date.now()}-${Math.random()}`);
}

function track(overrides = {}) {
  return {
    key: overrides.key || `library:${overrides.title || "track"}`,
    id: overrides.id || overrides.title || "track",
    title: "Untitled",
    artist: "Unknown Artist",
    album: "",
    ...overrides
  };
}

test("search text normalization handles accents, punctuation, and short tokens", async () => {
  const { normaliseSearchText } = await importSearchIndex();

  assert.equal(normaliseSearchText("  Beyoncé — Halo  "), "beyonce halo");
  assert.equal(normaliseSearchText("U2: One"), "u2 one");
});

test("track search index ranks title and artist combinations above incidental matches", async () => {
  const { createTrackSearchIndex } = await importSearchIndex();
  const index = createTrackSearchIndex();
  const tracks = [
    track({
      key: "library:incidental",
      id: "incidental",
      title: "Tribute Mix",
      artist: "Other Artist",
      album: "Daft Punk One More Time Collection"
    }),
    track({
      key: "library:correct",
      id: "correct",
      title: "One More Time",
      artist: "Daft Punk",
      album: "Discovery"
    }),
    track({
      key: "library:artist-only",
      id: "artist-only",
      title: "Aerodynamic",
      artist: "Daft Punk",
      album: "Discovery"
    })
  ];

  const result = index.search(tracks, "daft punk one more time");
  assert.equal(result[0].id, "correct");
  assert.equal(result.length, 2);
  assert.equal(index.getSize(), 3);
});

test("track search index reuses documents and refreshes changed metadata", async () => {
  const { createTrackSearchIndex } = await importSearchIndex();
  const index = createTrackSearchIndex();
  const original = track({
    key: "library:one",
    id: "one",
    title: "Old Name",
    artist: "Artist"
  });

  assert.deepEqual(index.search([original], "old name").map((item) => item.id), ["one"]);
  assert.equal(index.getSize(), 1);
  assert.deepEqual(index.search([original], "old name").map((item) => item.id), ["one"]);
  assert.equal(index.getSize(), 1);

  const updated = {
    ...original,
    title: "New Name"
  };
  assert.deepEqual(index.search([updated], "old name"), []);
  assert.deepEqual(index.search([updated], "new name").map((item) => item.id), ["one"]);
  assert.equal(index.getSize(), 1);
});

test("timed LRU cache expires entries and refreshes access order", async () => {
  const { createTimedLruCache } = await importSearchIndex();
  let now = 1000;
  const cache = createTimedLruCache({
    maxEntries: 2,
    ttlMs: 100,
    now: () => now
  });

  cache.set("one", { value: 1 });
  cache.set("two", { value: 2 });
  assert.deepEqual(cache.get("one"), { value: 1 });
  cache.set("three", { value: 3 });

  assert.equal(cache.get("two"), null);
  assert.deepEqual(cache.get("one"), { value: 1 });
  now = 1101;
  assert.equal(cache.get("one"), null);
  assert.equal(cache.get("three"), null);
});

test("cache keys canonicalize query and provider ordering", async () => {
  const { buildSearchCacheKey } = await importSearchIndex();
  const first = buildSearchCacheKey({
    query: " Beyoncé   Halo ",
    scope: "REMOTE",
    provider: "all",
    providers: ["youtube", "deezer"],
    apiBase: "HTTP://LOCALHOST:4848/"
  });
  const second = buildSearchCacheKey({
    query: "beyonce halo",
    scope: "remote",
    provider: "all",
    providers: ["deezer", "youtube"],
    apiBase: "http://localhost:4848"
  });

  assert.equal(first, second);
});

test("merged results keep local tracks and suppress equivalent remote duplicates", async () => {
  const { mergeSearchTracks } = await importSearchIndex();
  const local = track({
    key: "library:one",
    id: "one",
    title: "One More Time",
    artist: "Daft Punk"
  });
  const remoteDuplicate = track({
    key: "spotify:one",
    id: "spotify-one",
    title: "One More Time",
    artist: "Daft Punk",
    provider: "spotify"
  });
  const remoteUnique = track({
    key: "spotify:two",
    id: "spotify-two",
    title: "Digital Love",
    artist: "Daft Punk",
    provider: "spotify"
  });

  const merged = mergeSearchTracks([local], [remoteDuplicate, remoteUnique], {
    isEquivalent: (left, right) => left.title === right.title && left.artist === right.artist
  });

  assert.deepEqual(merged.map((item) => item.key), ["library:one", "spotify:two"]);
});
