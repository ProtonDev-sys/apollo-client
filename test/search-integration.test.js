const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const rendererPath = path.join(__dirname, "..", "src", "renderer.js");
const packagePath = path.join(__dirname, "..", "package.json");
const workflowPath = path.join(__dirname, "..", ".github", "workflows", "ci.yml");

function readRenderer() {
  return fs.readFileSync(rendererPath, "utf8");
}

test("renderer delegates local ranking and bounded search utilities", () => {
  const source = readRenderer();

  assert.match(source, /from "\.\/renderer\/search-engine\.js";/);
  assert.match(source, /const localTrackSearch = createTrackSearchEngine\(/);
  assert.match(source, /localTrackSearch\.search\(collection\.tracks, trimmedQuery/);
  assert.match(source, /createLruTtlCache\(\{/);
  assert.match(source, /mapWithConcurrency\(/);
  assert.match(source, /shouldSearchRemote\(trimmedQuery\)/);
  assert.doesNotMatch(source, /const searchResultCache = new Map\(\);/);
  assert.doesNotMatch(source, /const artistSearchCache = new Map\(\);/);
  assert.doesNotMatch(source, /function matchesTrackQuery\(/);
  assert.doesNotMatch(source, /if \(searchResultCache\.size <= 20\)/);
  assert.doesNotMatch(source, /if \(artistSearchCache\.size <= 20\)/);
});

test("Electron platform verification remains part of local and CI validation", () => {
  const packageJson = JSON.parse(fs.readFileSync(packagePath, "utf8"));
  const workflow = fs.readFileSync(workflowPath, "utf8");

  assert.equal(packageJson.main, "main.js");
  assert.match(packageJson.scripts.start, /electron/);
  assert.equal(packageJson.scripts["check:platform"], "node scripts/check-electron-platform.js");
  assert.match(packageJson.scripts.verify, /npm run check:platform/);
  assert.match(workflow, /Verify Electron platform boundary/);
  assert.match(workflow, /npm run check:platform/);
});
