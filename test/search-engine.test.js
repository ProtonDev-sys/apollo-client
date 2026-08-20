const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

async function importSearchEngine() {
  const trackModelSource = fs.readFileSync(
    path.join(__dirname, "..", "src", "renderer", "track-model.js"),
    "utf8"
  );
  const trackModelUrl = `data:text/javascript;base64,${Buffer.from(trackModelSource).toString("base64")}#track-${Date.now()}-${Math.random()}`;
  const searchSource = fs.readFileSync(
    path.join(__dirname, "..", "src", "renderer", "search-engine.js"),
    "utf8"
  ).replace('from "./track-model.js"', `from "${trackModelUrl}"`);
  return import(`data:text/javascript;base64,${Buffer.from(searchSource).toString("base64")}#search-${Date.now()}-${Math.random()}`);
}

function createTracks() {
  return [
    {
      key: "library:1",
      provider: "library",
      resultSource: "library",
      title: "Midnight City",
      artist: "M83",
      album: "Hurry Up, We're Dreaming",
      genre: "Electronic"
    },
    {
      key: "spotify:2",
      provider: "spotify",
      title: "Midnight",
      artist: "Coldplay",
      album: "Ghost Stories",
      genre: "Alternative"
    },
    {
      key: "deezer:3",
      provider: "deezer",
      title: "City of Stars",
      artist: "Ryan Gosling, Emma Stone",
      album: "La La Land",
      genre: "Soundtrack"
    },
    {
      key: "youtube:4",
      provider: "youtube",
      title: "Beyoncé - Halo",
      artist: "Beyoncé",
      album: "I Am... Sasha Fierce",
      genre: "Pop"
    }
  ];
}

test("search text folds accents, punctuation, and whitespace", async () => {
  const { normaliseSearchText, tokenizeSearchQuery } = await importSearchEngine();

  assert.equal(normaliseSearchText("  Beyoncé — Halo!  "), "beyonce halo");
  assert.deepEqual(tokenizeSearchQuery("city city midnight"), ["city", "midnight"]);
});

test("indexed song search ranks exact title and title prefix above secondary fields", async () => {
  const {
    buildTrackSearchIndex,
    searchTrackIndex
  } = await importSearchEngine();
  const index = buildTrackSearchIndex(createTracks());

  assert.deepEqual(
    searchTrackIndex(index, "midnight").map((track) => track.key),
    ["spotify:2", "library:1"]
  );
  assert.deepEqual(
    searchTrackIndex(index, "city").map((track) => track.key),
    ["deezer:3", "library:1"]
  );
  assert.deepEqual(
    searchTrackIndex(index, "m83 city").map((track) => track.key),
    ["library:1"]
  );
});

test("song search handles accent-insensitive artist queries", async () => {
  const {
    buildTrackSearchIndex,
    searchTrackIndex
  } = await importSearchEngine();
  const index = buildTrackSearchIndex(createTracks());

  assert.deepEqual(
    searchTrackIndex(index, "beyonce").map((track) => track.key),
    ["youtube:4"]
  );
});

test("track search engine reuses and evicts collection indexes", async () => {
  const { createTrackSearchEngine } = await importSearchEngine();
  const engine = createTrackSearchEngine({ maxIndexes: 2 });
  const tracks = createTracks();

  engine.search(tracks, "city", { cacheKey: "library:1" });
  engine.search(tracks, "halo", { cacheKey: "library:2" });
  assert.equal(engine.size, 2);

  engine.search(tracks, "midnight", { cacheKey: "library:1" });
  engine.search(tracks, "stars", { cacheKey: "library:3" });
  assert.equal(engine.size, 2);
  assert.equal(engine.delete("library:2"), false);
  assert.equal(engine.delete("library:1"), true);
  engine.clear();
  assert.equal(engine.size, 0);
});

test("remote search gate suppresses one-character network queries", async () => {
  const { shouldSearchRemote } = await importSearchEngine();

  assert.equal(shouldSearchRemote("a"), false);
  assert.equal(shouldSearchRemote("a "), false);
  assert.equal(shouldSearchRemote("ab"), true);
  assert.equal(shouldSearchRemote("é"), false);
  assert.equal(shouldSearchRemote("éé"), true);
});

test("LRU TTL cache expires entries and refreshes recency on read", async () => {
  const { createLruTtlCache } = await importSearchEngine();
  let currentTime = 1000;
  const cache = createLruTtlCache({
    maxEntries: 2,
    ttlMs: 100,
    now: () => currentTime
  });

  cache.set("one", 1).set("two", 2);
  assert.equal(cache.get("one"), 1);
  cache.set("three", 3);
  assert.equal(cache.get("two"), undefined);
  assert.equal(cache.get("one"), 1);
  assert.equal(cache.get("three"), 3);

  currentTime = 1101;
  assert.equal(cache.has("one"), false);
  assert.equal(cache.get("three"), undefined);
  assert.equal(cache.size, 0);
});

test("bounded concurrency preserves result order and limits active work", async () => {
  const { mapWithConcurrency } = await importSearchEngine();
  let active = 0;
  let peakActive = 0;

  const results = await mapWithConcurrency([1, 2, 3, 4, 5], 2, async (value) => {
    active += 1;
    peakActive = Math.max(peakActive, active);
    await new Promise((resolve) => setTimeout(resolve, 5));
    active -= 1;
    return value * 10;
  });

  assert.deepEqual(results, [10, 20, 30, 40, 50]);
  assert.equal(peakActive, 2);
});
