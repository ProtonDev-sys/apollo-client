#!/usr/bin/env node

const fs = require("node:fs");
const path = require("node:path");

const projectRoot = path.resolve(__dirname, "..");
const sourcePackage = JSON.parse(
  fs.readFileSync(path.join(projectRoot, "package.json"), "utf8")
);
const outputDirectory = path.join(projectRoot, "dist-app");
const runtimeManifest = {
  name: sourcePackage.name,
  version: sourcePackage.version,
  description: sourcePackage.description,
  main: "main.js",
  author: sourcePackage.author,
  license: sourcePackage.license,
  private: true
};

fs.mkdirSync(outputDirectory, { recursive: true });
fs.writeFileSync(
  path.join(outputDirectory, "package.json"),
  `${JSON.stringify(runtimeManifest)}
`
);
