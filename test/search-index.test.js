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
    provider: "library",
    resultSource: "library",
    ...overrides
  };
}

test("search text normalization handles accents, punctuation, and short tokens", async () => {
  const { normaliseSearchText, shouldSearchRemote, tokenizeSearchQuery } = await importSearchIndex();

  assert.equal(normaliseSearchText("  Beyoncé — Halo  "), "beyonce halo");
  assert.equal(normaliseSearchText("U2: One"), "u2 one");
  assert.deepEqual(tokenizeSearchQuery("Halo halo Beyoncé"), ["halo", "beyonce"]);
  assert.equal(shouldSearchRemote("a"), false);
  assert.equal(shouldSearchRemote("u2"), true);
});

test("collection search engine ranks title and artist combinations above incidental matches", async () => {
  const { createTrackSearchEngine } = await importSearchIndex();
  const engine = createTrackSearchEngine();
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

  const result = engine.search(tracks, "daft punk one more time", {
    cacheKey: "library:1"
  });
  assert.equal(result[0].id, "correct");
  assert.equal(result.length, 2);
  assert.equal(engine.getSize(), 1);
});

test("collection indexes support prefixes, infixes, limits, and revision refreshes", async () => {
  const { createTrackSearchEngine } = await importSearchIndex();
  const engine = createTrackSearchEngine({ maxIndexes: 2 });
  const original = track({
    key: "library:one",
    id: "one",
    title: "Old Name",
    artist: "Artist"
  });

  assert.deepEqual(
    engine.search([original], "ol", { cacheKey: "library:1" }).map((item) => item.id),
    ["one"]
  );
  assert.deepEqual(
    engine.search([original], "ld na", { cacheKey: "library:1" }).map((item) => item.id),
    ["one"]
  );

  const updated = {
    ...original,
    title: "New Name"
  };
  assert.deepEqual(engine.search([updated], "old", { cacheKey: "library:2" }), []);
  assert.deepEqual(
    engine.search([updated], "new", { cacheKey: "library:2", limit: 1 }).map((item) => item.id),
    ["one"]
  );

  engine.search([track({ id: "playlist", title: "Playlist Song" })], "song", {
    cacheKey: "playlist:one:1"
  });
  assert.equal(engine.getSize(), 2);
});

test("local search result limits are applied after relevance ranking", async () => {
  const { createTrackSearchEngine } = await importSearchIndex();
  const engine = createTrackSearchEngine();
  const tracks = Array.from({ length: 300 }, (_, index) => track({
    id: `track-${index}`,
    key: `library:${index}`,
    title: index === 299 ? "Song" : `Song ${index}`,
    artist: "Artist"
  }));

  const results = engine.search(tracks, "song", {
    cacheKey: "library:1",
    limit: 250
  });

  assert.equal(results.length, 250);
  assert.equal(results[0].id, "track-299");
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

test("timed LRU cache clones values and supports non-expiring entries", async () => {
  const { createTimedLruCache } = await importSearchIndex();
  const cache = createTimedLruCache({ ttlMs: 0 });
  const value = { nested: { count: 1 } };
  cache.set("value", value);
  value.nested.count = 2;

  const cached = cache.get("value");
  assert.equal(cached.nested.count, 1);
  cached.nested.count = 3;
  assert.equal(cache.get("value").nested.count, 1);
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
    provider: "spotify",
    resultSource: "remote"
  });
  const remoteUnique = track({
    key: "spotify:two",
    id: "spotify-two",
    title: "Digital Love",
    artist: "Daft Punk",
    provider: "spotify",
    resultSource: "remote"
  });

  const merged = mergeSearchTracks([local], [remoteDuplicate, remoteUnique], {
    isEquivalent: (left, right) => left.title === right.title && left.artist === right.artist
  });

  assert.deepEqual(merged.map((item) => item.key), ["library:one", "spotify:two"]);
});
