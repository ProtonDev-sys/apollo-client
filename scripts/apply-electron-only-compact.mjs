#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { gunzipSync } from "node:zlib";

const partDirectory = path.resolve("scripts", ".electron-compact-payload");
const payload = fs.readdirSync(partDirectory)
  .sort()
  .map((name) => fs.readFileSync(path.join(partDirectory, name), "utf8"))
  .join("");
const generatedFiles = JSON.parse(gunzipSync(Buffer.from(payload, "base64")).toString("utf8"));
for (const [relativePath, content] of Object.entries(generatedFiles)) {
  const targetPath = path.resolve(relativePath);
  fs.mkdirSync(path.dirname(targetPath), { recursive: true });
  fs.writeFileSync(targetPath, content);
}
await import(`${pathToFileURL(path.resolve("scripts", ".electron-compact-transform.mjs"))}?${Date.now()}`);
