const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const {
  createAsyncLogWriter,
  sanitiseLogText
} = require("../src/main/async-log-writer");

test("async logger batches writes and removes embedded line breaks", async (context) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "apollo-log-writer-"));
  context.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const logPath = path.join(directory, "apollo.log");
  const writer = createAsyncLogWriter({
    fs,
    targetPath: logPath,
    now: () => new Date("2026-08-20T00:00:00.000Z")
  });

  writer.write("main", "first\nline");
  writer.write("discord", "second");
  await writer.flush();

  assert.equal(
    fs.readFileSync(logPath, "utf8"),
    "[2026-08-20T00:00:00.000Z] [main] first line\n"
      + "[2026-08-20T00:00:00.000Z] [discord] second\n"
  );
});

test("async logger rotates before the configured file budget is exceeded", async (context) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "apollo-log-writer-"));
  context.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const logPath = path.join(directory, "apollo.log");
  fs.writeFileSync(logPath, "x".repeat(1000));
  const writer = createAsyncLogWriter({
    fs,
    targetPath: logPath,
    maxBytes: 1024,
    now: () => new Date("2026-08-20T00:00:00.000Z")
  });

  writer.write("main", "rotated");
  await writer.flush();
  const result = fs.readFileSync(logPath, "utf8");
  assert.match(result, /rotated/);
  assert.ok(Buffer.byteLength(result) <= 1024);
});

test("async logger bounds queued memory and records dropped lines", async () => {
  const operations = [];
  let releaseStat;
  const fakeFs = {
    promises: {
      stat: () => new Promise((resolve) => {
        releaseStat = () => resolve({ size: 0 });
      }),
      mkdir: async () => {},
      appendFile: async (_path, data) => operations.push(Buffer.from(data).toString("utf8")),
      writeFile: async (_path, data) => operations.push(Buffer.from(data).toString("utf8"))
    }
  };
  const writer = createAsyncLogWriter({
    fs: fakeFs,
    targetPath: "/tmp/apollo.log",
    maxQueuedLines: 2
  });

  writer.write("app", "one");
  await new Promise(setImmediate);
  writer.write("app", "two");
  writer.write("app", "three");
  writer.write("app", "four");
  assert.ok(writer.getQueuedLineCount() <= 2);
  assert.equal(writer.getDroppedLineCount(), 1);
  releaseStat();
  await writer.flush();
  assert.match(operations.join(""), /dropped/);
});

test("log text is exactly byte bounded without corrupting UTF-8", () => {
  const value = sanitiseLogText("é".repeat(1000), 100);
  assert.ok(Buffer.byteLength(value) <= 100);
  assert.doesNotMatch(value, /�/);
  assert.match(value, /\.\.\.$/);
});
