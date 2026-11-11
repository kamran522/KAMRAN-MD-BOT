"use strict";

const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const root = path.resolve(__dirname, "..");
const ignored = new Set([".git", "node_modules", "temp"]);
const files = [];

function collect(directory) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (!ignored.has(entry.name)) collect(path.join(directory, entry.name));
    } else if (entry.isFile() && entry.name.endsWith(".js")) {
      files.push(path.join(directory, entry.name));
    }
  }
}

collect(root);
files.sort();

let failed = false;
for (const file of files) {
  const result = spawnSync(process.execPath, ["--check", file], { encoding: "utf8" });
  if (result.status !== 0) {
    failed = true;
    process.stderr.write(`\nSyntax error in ${path.relative(root, file)}\n`);
    process.stderr.write(result.stderr || result.stdout || "Node syntax check failed.\n");
  }
}

if (failed) {
  process.exitCode = 1;
} else {
  console.log(`Syntax check passed for ${files.length} JavaScript files.`);
}
