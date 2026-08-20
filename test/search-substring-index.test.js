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

function track(id, title) {
  return {
    id,
    key: `library:${id}`,
    title,
    artist: "Daft Punk",
    provider: "library",
    resultSource: "library"
  };
}

test("substring matches are retained when another result has a prefix match", async () => {
  const { createTrackSearchEngine } = await importSearchIndex();
  const engine = createTrackSearchEngine();
  const results = engine.search([
    track("prefix", "Git Song"),
    track("substring", "Digital Love"),
    track("unrelated", "Around the World")
  ], "git", {
    cacheKey: "library:1"
  });

  assert.deepEqual(results.map((item) => item.id), ["prefix", "substring"]);
});

test("long substring queries use the compact gram index", async () => {
  const { buildTrackSearchIndex, searchTrackIndex } = await importSearchIndex();
  const index = buildTrackSearchIndex([
    track("match", "Something About Us"),
    track("other", "Voyager")
  ]);

  assert.ok(index.substringGramIndex.size > 0);
  assert.deepEqual(
    searchTrackIndex(index, "mething").map((item) => item.id),
    ["match"]
  );
});
