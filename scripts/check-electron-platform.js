const fs = require("node:fs");
const path = require("node:path");

const PROJECT_ROOT = path.resolve(__dirname, "..");
const FORBIDDEN_ROOT_PATHS = [
  "src-tauri",
  "tauri.conf.json",
  "tauri.conf.json5",
  "tauri.conf.toml"
];
const SOURCE_DIRECTORIES = [
  "src",
  "scripts",
  "test",
  "docs"
];
const TAURI_REFERENCE_PATTERN = /@tauri-apps\/|\btauri::|\b__TAURI__\b|\btauri\.conf(?:\.json5?|\.toml)?\b/i;

function walkFiles(directoryPath) {
  if (!fs.existsSync(directoryPath)) {
    return [];
  }

  return fs.readdirSync(directoryPath, { withFileTypes: true })
    .flatMap((entry) => {
      const resolvedPath = path.join(directoryPath, entry.name);
      if (entry.isDirectory()) {
        return walkFiles(resolvedPath);
      }
      return entry.isFile() ? [resolvedPath] : [];
    });
}

function readPackageJson(projectRoot = PROJECT_ROOT) {
  return JSON.parse(fs.readFileSync(path.join(projectRoot, "package.json"), "utf8"));
}

function validateElectronPackage(packageJson) {
  const errors = [];
  const dependencies = {
    ...(packageJson.dependencies || {}),
    ...(packageJson.devDependencies || {}),
    ...(packageJson.optionalDependencies || {})
  };

  if (packageJson.main !== "main.js") {
    errors.push('package.json "main" must remain "main.js" for Electron.');
  }

  if (!String(packageJson.scripts?.start || "").includes("electron")) {
    errors.push("The start script must launch Electron.");
  }

  if (!dependencies.electron) {
    errors.push("Electron must remain an explicit dependency.");
  }

  if (!dependencies["electron-builder"]) {
    errors.push("electron-builder must remain an explicit packaging dependency.");
  }

  const tauriDependencies = Object.keys(dependencies)
    .filter((dependencyName) => dependencyName.startsWith("@tauri-apps/"));
  if (tauriDependencies.length) {
    errors.push(`Tauri dependencies are not permitted: ${tauriDependencies.join(", ")}.`);
  }

  return errors;
}

function validateElectronBoundary(projectRoot = PROJECT_ROOT) {
  const errors = validateElectronPackage(readPackageJson(projectRoot));

  FORBIDDEN_ROOT_PATHS.forEach((relativePath) => {
    if (fs.existsSync(path.join(projectRoot, relativePath))) {
      errors.push(`Tauri project artifact is not permitted: ${relativePath}.`);
    }
  });

  SOURCE_DIRECTORIES.forEach((relativeDirectory) => {
    walkFiles(path.join(projectRoot, relativeDirectory)).forEach((filePath) => {
      const relativePath = path.relative(projectRoot, filePath).replaceAll(path.sep, "/");
      if (relativePath === "scripts/check-electron-platform.js") {
        return;
      }

      const extension = path.extname(filePath).toLowerCase();
      if (![".js", ".mjs", ".cjs", ".json", ".html", ".css", ".md", ".toml", ".rs"].includes(extension)) {
        return;
      }

      const content = fs.readFileSync(filePath, "utf8");
      if (TAURI_REFERENCE_PATTERN.test(content)) {
        errors.push(`Tauri runtime reference is not permitted in ${relativePath}.`);
      }
    });
  });

  return errors;
}

function run() {
  const errors = validateElectronBoundary();
  if (errors.length) {
    errors.forEach((error) => process.stderr.write(`error ${error}\n`));
    process.exitCode = 1;
    return;
  }

  process.stdout.write("Electron platform boundary verified.\n");
}

if (require.main === module) {
  run();
}

module.exports = {
  FORBIDDEN_ROOT_PATHS,
  TAURI_REFERENCE_PATTERN,
  readPackageJson,
  validateElectronBoundary,
  validateElectronPackage,
  walkFiles
};
