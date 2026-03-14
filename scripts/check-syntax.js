const fs = require("node:fs");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

const PROJECT_ROOT = path.resolve(__dirname, "..");
const IGNORED_DIRECTORIES = new Set([
  ".git",
  "backend-audit",
  "node_modules",
  "release",
  "native-bin",
  "vendor"
]);

function collectJavaScriptFiles(directoryPath, files = []) {
  const entries = fs.readdirSync(directoryPath, {
    withFileTypes: true
  });

  for (const entry of entries) {
    if (IGNORED_DIRECTORIES.has(entry.name)) {
      continue;
    }

    const entryPath = path.join(directoryPath, entry.name);
    if (entry.isDirectory()) {
      collectJavaScriptFiles(entryPath, files);
      continue;
    }

    if (entry.isFile() && entry.name.endsWith(".js")) {
      files.push(entryPath);
    }
  }

  return files;
}

function parseFile(filePath) {
  const source = fs.readFileSync(filePath, "utf8");

  execFileSync(process.execPath, [
    "--input-type=module",
    "--check",
  ], {
    cwd: PROJECT_ROOT,
    input: source,
    stdio: "pipe"
  });
}

async function main() {
  const files = collectJavaScriptFiles(PROJECT_ROOT).sort();
  const failures = [];

  for (const filePath of files) {
    try {
      parseFile(filePath);
      process.stdout.write(`ok ${path.relative(PROJECT_ROOT, filePath)}\n`);
    } catch (error) {
      failures.push({
        filePath,
        message: String(error?.stderr || error?.stdout || error?.message || "Unknown syntax error").trim()
      });
    }
  }

  if (failures.length) {
    for (const failure of failures) {
      process.stderr.write(`\n${path.relative(PROJECT_ROOT, failure.filePath)}\n`);
      process.stderr.write(`${failure.message}\n`);
    }

    process.exitCode = 1;
    return;
  }

  process.stdout.write(`\nChecked ${files.length} JavaScript files.\n`);
}

void main();
