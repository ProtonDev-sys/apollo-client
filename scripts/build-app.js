#!/usr/bin/env node

const fs = require("node:fs");
const path = require("node:path");
const { build, transform } = require("esbuild");

const projectRoot = path.resolve(__dirname, "..");
const outputRoot = path.join(projectRoot, "dist-app");
const sourceRoot = path.join(projectRoot, "src");

const NODE_ENTRY_POINTS = [
  "main.js",
  "discord-presence.js",
  "discord-social-bridge.js",
  "src/listen-along-p2p.js",
  "src/main/async-log-writer.js",
  "src/main/discord-ipc.js",
  "preload.js",
  "src/preload/listen-along-signaling.js",
  "src/preload/mqtt-websocket.js",
  "src/preload/runtime-assets.js",
  "src/preload/state-store.js"
].map((relativePath) => path.join(projectRoot, relativePath));

function read(relativePath) {
  return fs.readFileSync(path.join(projectRoot, relativePath), "utf8");
}

function write(relativePath, content) {
  const targetPath = path.join(outputRoot, relativePath);
  fs.mkdirSync(path.dirname(targetPath), { recursive: true });
  fs.writeFileSync(targetPath, content);
}

function prepareHtml(source) {
  return source
    .replace(/\s*<link\b[^>]*href="https:\/\/fonts\.(?:googleapis|gstatic)\.com[^"]*"[^>]*>\s*/gi, "\n")
    .replace(/<!--(?:.|\n|\r)*?-->/g, "")
    .replace(/>\s+</g, "><")
    .trim();
}

function prepareCss(source) {
  const uiStack = 'system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif';
  const monoStack = 'ui-monospace,"SFMono-Regular",Consolas,"Liberation Mono",monospace';
  return source
    .replaceAll('"IBM Plex Sans", sans-serif', uiStack)
    .replaceAll('"Plus Jakarta Sans", sans-serif', uiStack)
    .replaceAll('"Space Grotesk", sans-serif', uiStack)
    .replaceAll('"IBM Plex Mono", monospace', monoStack);
}

function totalFileBytes(directoryPath) {
  return fs.readdirSync(directoryPath, { withFileTypes: true })
    .reduce((total, entry) => {
      const resolved = path.join(directoryPath, entry.name);
      return total + (entry.isDirectory() ? totalFileBytes(resolved) : fs.statSync(resolved).size);
    }, 0);
}

async function run() {
  fs.rmSync(outputRoot, { recursive: true, force: true });
  fs.mkdirSync(outputRoot, { recursive: true });

  await build({
    entryPoints: NODE_ENTRY_POINTS,
    outdir: outputRoot,
    outbase: projectRoot,
    bundle: false,
    platform: "node",
    format: "cjs",
    target: "node24",
    minify: true,
    legalComments: "none",
    sourcemap: false,
    charset: "utf8",
    logLevel: "warning"
  });

  await build({
    entryPoints: [path.join(sourceRoot, "renderer.js")],
    outfile: path.join(outputRoot, "src", "renderer.js"),
    bundle: true,
    platform: "browser",
    format: "esm",
    target: "chrome150",
    minify: true,
    treeShaking: true,
    legalComments: "none",
    sourcemap: false,
    charset: "utf8",
    logLevel: "warning"
  });

  const css = await transform(prepareCss(read("src/styles.css")), {
    loader: "css",
    minify: true,
    legalComments: "none",
    target: "chrome150"
  });
  write("src/styles.css", css.code.trim());
  write("src/index.html", prepareHtml(read("src/index.html")));

  const totalBytes = totalFileBytes(outputRoot);
  process.stdout.write(`Electron runtime bundle built: ${totalBytes} bytes across dist-app.\n`);
}

run().catch((error) => {
  process.stderr.write(`error: ${error?.stack || error?.message || error}\n`);
  process.exitCode = 1;
});
