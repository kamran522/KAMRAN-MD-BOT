"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { test, after } = require("node:test");

const root = fs.mkdtempSync(path.join(os.tmpdir(), "kamran-yt-fragment-test-"));
const fakeYtdlp = path.join(root, "yt-dlp");
const argsLog = path.join(root, "args.log");
fs.writeFileSync(fakeYtdlp, String.raw`#!/usr/bin/env node
const fs = require("fs");
const path = require("path");
const args = process.argv.slice(2);
fs.appendFileSync(process.env.FAKE_YT_LOG, JSON.stringify(args) + "\n");
if (!args.includes("-o")) {
  process.stderr.write("Expected download arguments.");
  process.exit(2);
}
const outputTemplate = args[args.indexOf("-o") + 1];
const target = outputTemplate.replace("%(ext)s", "mp4");
fs.mkdirSync(path.dirname(target), { recursive: true });
if (process.env.FAKE_YT_ALWAYS_FAIL === "1" ||
    (process.env.FAKE_YT_FAIL_FIRST === "1" && !args.includes("--no-part"))) {
  fs.writeFileSync(target + ".part-Frag98", "interrupted");
  process.stderr.write("ERROR: Unable to download video: [Errno 2] No such file or directory: '" +
    target + ".part-Frag98'");
  process.exit(1);
}
fs.writeFileSync(target, Buffer.alloc(128, 7));
`);
fs.chmodSync(fakeYtdlp, 0o755);
const previousEnv = {};
for (const key of ["YTDLP_PATH", "YTDLP_ARGS", "FAKE_YT_LOG", "FAKE_YT_FAIL_FIRST", "FAKE_YT_ALWAYS_FAIL"]) {
  previousEnv[key] = process.env[key];
}
process.env.YTDLP_PATH = fakeYtdlp;
process.env.FAKE_YT_LOG = argsLog;
delete process.env.YTDLP_ARGS;
delete process.env.FAKE_YT_FAIL_FIRST;
delete process.env.FAKE_YT_ALWAYS_FAIL;
const services = require("../core/services");
after(() => {
  for (const [name, value] of Object.entries(previousEnv)) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
  fs.rmSync(root, { recursive: true, force: true });
});

function lastArgs() {
  return fs.readFileSync(argsLog, "utf8").trim().split("\n")
    .filter(Boolean).map((line) => JSON.parse(line));
}

test("144p YouTube option retries missing fragments with serial downloads and never upgrades quality", async () => {
  fs.writeFileSync(argsLog, "");
  process.env.FAKE_YT_FAIL_FIRST = "1";
  const outputDir = path.join(root, "video-144");
  try {
    const result = await services.ytDownloadToFile("7Rmnsy_7hAs", "144p", outputDir);
    assert.equal(fs.existsSync(result), true);
    assert.match(result, /\.mp4$/);
    const calls = lastArgs();
    assert.equal(calls.length, 2, "first fragment failure should trigger one retry");
    assert.equal(calls[0].includes("--no-part"), false);
    assert.ok(calls[1].includes("--no-part"), "retry must avoid partial files");
    assert.ok(calls[1].includes("--no-continue"), "retry must not resume corrupt partial file");
    for (const args of calls) {
      const format = args[args.indexOf("-f") + 1];
      assert.ok(format, "quality format selector should be provided");
      assert.ok(format.includes("height<=144"), "must not select above 144p");
      assert.doesNotMatch(format, /\/best(?:\/|$)/, "unrestricted best-quality fallback is forbidden");
      assert.equal(args[args.lastIndexOf("-N") + 1], "1", "fragment downloads must be serial");
      assert.equal(args.at(-1), "https://www.youtube.com/watch?v=7Rmnsy_7hAs");
    }
    assert.equal(fs.readdirSync(outputDir).filter((name) => name.includes(".part-Frag")).length, 0,
      "failed attempt fragments should be cleaned");
    fs.unlinkSync(result);
  } finally {
    delete process.env.FAKE_YT_FAIL_FIRST;
  }
});

test("360p path still produces a video on the first attempt", async () => {
  fs.writeFileSync(argsLog, "");
  const result = await services.ytDownloadToFile("dQw4w9WgXcQ", "360p", path.join(root, "video-360"));
  assert.ok(fs.statSync(result).size > 0);
  const calls = lastArgs();
  assert.equal(calls.length, 1, "do not retry a successful download");
  assert.ok(calls[0][calls[0].indexOf("-f") + 1].includes("height<=360"));
});

test("persistent fragment failures report the selected resolution and real error", async () => {
  fs.writeFileSync(argsLog, "");
  process.env.FAKE_YT_ALWAYS_FAIL = "1";
  try {
    await assert.rejects(
      () => services.ytDownloadToFile("7Rmnsy_7hAs", "144p", path.join(root, "video-fail")),
      (error) => /144p/.test(error.message) && /part-Frag98/.test(error.message)
    );
    assert.equal(lastArgs().length, 2);
  } finally {
    delete process.env.FAKE_YT_ALWAYS_FAIL;
  }
});
