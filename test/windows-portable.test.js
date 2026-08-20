const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const {
  ARCHIVE_ARGUMENTS,
  buildWindowsPortable,
  resolvePositiveLimit,
  resolveSevenZip
} = require("../scripts/build-windows-portable");

function createProject() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "apollo-portable-"));
  fs.mkdirSync(path.join(root, "release", "win-unpacked"), { recursive: true });
  fs.writeFileSync(
    path.join(root, "package.json"),
    JSON.stringify({ name: "apollo-client", version: "9.8.7" })
  );
  fs.writeFileSync(
    path.join(root, "release", "win-unpacked", "Apollo Client.exe"),
    Buffer.alloc(32)
  );
  return root;
}

test("portable byte budgets are finite positive values", () => {
  assert.equal(resolvePositiveLimit(undefined, 123), 123);
  assert.equal(resolvePositiveLimit("456", 123), 456);
  assert.throws(() => resolvePositiveLimit(0), /finite positive number/);
  assert.throws(() => resolvePositiveLimit(Number.POSITIVE_INFINITY), /finite positive number/);
});

test("7-Zip resolution prefers explicit installed paths", (context) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "apollo-sevenzip-"));
  context.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const explicitPath = path.join(root, "7z.exe");
  fs.writeFileSync(explicitPath, "binary");

  assert.equal(resolveSevenZip({
    env: { APOLLO_7ZIP_PATH: explicitPath }
  }), explicitPath);
  assert.equal(resolveSevenZip({ env: {} }), "7z.exe");
});

test("portable builder creates and bounds the verified release archive", (context) => {
  const root = createProject();
  context.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const invocations = [];
  const output = [];

  const result = buildWindowsPortable({
    projectRoot: root,
    platform: "win32",
    maxPortableBytes: 100,
    sevenZipPath: "test-7z.exe",
    stdout: { write: (value) => output.push(String(value)) },
    stderr: { write() {} },
    spawnSyncImpl(command, args, options) {
      invocations.push({ command, args, options });
      fs.writeFileSync(args[ARCHIVE_ARGUMENTS.length], Buffer.alloc(64));
      return { status: 0, stdout: "archive ok\n", stderr: "" };
    }
  });

  assert.equal(result.size, 64);
  assert.match(result.archivePath, /Apollo-Client-Portable-9\.8\.7\.7z$/);
  assert.equal(invocations.length, 1);
  assert.equal(invocations[0].command, "test-7z.exe");
  assert.deepEqual(
    invocations[0].args.slice(0, ARCHIVE_ARGUMENTS.length),
    [...ARCHIVE_ARGUMENTS]
  );
  assert.equal(invocations[0].args.at(-1), ".\\*");
  assert.equal(invocations[0].options.cwd, path.join(root, "release", "win-unpacked"));
  assert.match(output.join(""), /Windows portable archive verified/);
});

test("portable builder rejects unsupported hosts, missing output, and oversized archives", (context) => {
  const root = createProject();
  context.after(() => fs.rmSync(root, { recursive: true, force: true }));

  assert.throws(
    () => buildWindowsPortable({ projectRoot: root, platform: "linux" }),
    /only be built on Windows/
  );
  assert.throws(
    () => buildWindowsPortable({
      projectRoot: root,
      platform: "win32",
      sevenZipPath: "test-7z.exe",
      spawnSyncImpl: () => ({ status: 0, stdout: "", stderr: "" }),
      stdout: { write() {} },
      stderr: { write() {} }
    }),
    /did not create/
  );
  assert.throws(
    () => buildWindowsPortable({
      projectRoot: root,
      platform: "win32",
      maxPortableBytes: 10,
      sevenZipPath: "test-7z.exe",
      spawnSyncImpl(_command, args) {
        fs.writeFileSync(args[ARCHIVE_ARGUMENTS.length], Buffer.alloc(20));
        return { status: 0, stdout: "", stderr: "" };
      },
      stdout: { write() {} },
      stderr: { write() {} }
    }),
    /exceeds the 10-byte budget/
  );
});
