"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const vm = require("node:vm");
const { test } = require("node:test");

function loadHelpers() {
  const module = { exports: {} };
  function FakeFfmpeg() {}
  FakeFfmpeg.prototype.run = () => {};
  const source = fs.readFileSync(path.join(__dirname, "../core/helpers.js"), "utf8");
  vm.runInNewContext(source, {
    module, exports: module.exports, __dirname: path.join(__dirname, "../core"),
    process, fs, path, os, console, Buffer, setInterval, setTimeout, clearTimeout,
    require(name) {
      if (name === "fluent-ffmpeg") return FakeFfmpeg;
      return require(name);
    },
  }, { filename: "core/helpers.js", timeout: 10000 });
  return module.exports;
}

test("temporary file cleanup never deletes an active yt-dlp directory", async () => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), "kamran-sweep-test-"));
  try {
    const yt = path.join(base, "yt");
    fs.mkdirSync(yt);
    const { sweepTempDir } = loadHelpers();
    // A running downloader may not have created the next fragment yet.
    await sweepTempDir(base, 30 * 60 * 1000);
    assert.equal(fs.existsSync(yt), true, "empty yt folder must not be removed");
    const current = path.join(yt, "file.mp4.part-Frag98");
    fs.writeFileSync(current, "active download");
    const stale = path.join(yt, "old-artifact.mp4");
    fs.writeFileSync(stale, "stale data");
    const oldTime = new Date(Date.now() - 4 * 60 * 60 * 1000);
    fs.utimesSync(stale, oldTime, oldTime);
    await sweepTempDir(base);
    assert.equal(fs.existsSync(yt), true, "yt directory must persist");
    assert.equal(fs.existsSync(current), true, "active download fragment must persist");
    assert.equal(fs.existsSync(stale), false, "old files should still be cleaned");
    fs.unlinkSync(current);
    await sweepTempDir(base);
    assert.equal(fs.existsSync(yt), true, "yt folder must remain usable for future downloads");
  } finally {
    fs.rmSync(base, { recursive: true, force: true });
  }
});
