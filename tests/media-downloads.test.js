"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { test } = require("node:test");

const binDir = fs.mkdtempSync(path.join(os.tmpdir(), "kamran-media-test-"));
const ytPath = path.join(binDir, "fake-yt-dlp");
const galleryPath = path.join(binDir, "fake-gallery-dl");
const logPath = path.join(binDir, "yt-args.json");

fs.writeFileSync(ytPath, `#!/usr/bin/env node
const fs = require("fs");
const path = require("path");
const args = process.argv.slice(2);
fs.writeFileSync(process.env.FAKE_YT_ARGS, JSON.stringify(args));
if (args.includes("-J")) {
  if (process.env.FAKE_YT_INFO_FAIL === "1") {
    process.stderr.write("Simulated metadata error");
    process.exit(1);
  }
  console.log(JSON.stringify({
    id: "dQw4w9WgXcQ",
    title: "Test video",
    webpage_url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
    formats: [
      {vcodec:"h264",acodec:"none",height:360,filesize:1234567},
      {vcodec:"none",acodec:"aac",filesize:234567}
    ]
  }));
} else if (args.includes("-o")) {
  const format = args[args.indexOf("-o") + 1];
  const ext = args.includes("-x") ? "m4a" : "mp4";
  const filename = format.replace("%(autonumber)s", "00001").replace("%(ext)s", ext);
  fs.mkdirSync(path.dirname(filename), {recursive:true});
  fs.writeFileSync(filename, "fake-media");
} else {
  process.stderr.write("unexpected fake yt-dlp arguments");
  process.exitCode = 2;
}
`);
fs.writeFileSync(galleryPath, `#!/usr/bin/env node
const fs = require("fs");
const path = require("path");
const args = process.argv.slice(2);
if (process.env.FAKE_GALLERY_FAIL === "1") {
  process.stderr.write("simulated Instagram extractor failure");
  process.exit(1);
}
const dir = args[args.indexOf("--directory") + 1];
if (!dir) process.exit(2);
const nested = path.join(dir, "instagram", "example_account");
fs.mkdirSync(nested, {recursive:true});
fs.writeFileSync(path.join(nested, "01.jpg"), "fake-jpg");
fs.writeFileSync(path.join(nested, "02.mp4"), "fake-video");
`);
fs.chmodSync(ytPath, 0o755);
fs.chmodSync(galleryPath, 0o755);

const previous = {
  YTDLP_PATH: process.env.YTDLP_PATH,
  GALLERYDL_PATH: process.env.GALLERYDL_PATH,
  FAKE_YT_ARGS: process.env.FAKE_YT_ARGS,
  FAKE_GALLERY_FAIL: process.env.FAKE_GALLERY_FAIL,
  FAKE_YT_INFO_FAIL: process.env.FAKE_YT_INFO_FAIL,
};
process.env.YTDLP_PATH = ytPath;
process.env.GALLERYDL_PATH = galleryPath;
process.env.FAKE_YT_ARGS = logPath;

const services = require("../core/services");

function lastYtArgs() {
  return JSON.parse(fs.readFileSync(logPath, "utf8"));
}

test("YouTube metadata provides readable qualities and sizes", async () => {
  const info = await services.ytInfo("dQw4w9WgXcQ");
  assert.equal(info.video[0].quality, "360p");
  assert.match(info.video[0].size, /MB$/);
  assert.match(info.audio[0].size, /KB$/);
  const args = lastYtArgs();
  assert.deepEqual(args.slice(args.indexOf("--js-runtimes"), args.indexOf("--js-runtimes") + 2), ["--js-runtimes", "node"]);
});

test("YouTube audio is converted to m4a for WhatsApp", async () => {
  const file = await services.ytDownloadToFile("dQw4w9WgXcQ", "audio", binDir);
  assert.match(file, /\.m4a$/);
  assert.ok(fs.existsSync(file));
  const args = lastYtArgs();
  assert.ok(args.includes("-x"));
  assert.deepEqual(args.slice(args.indexOf("--audio-format"), args.indexOf("--audio-format") + 2), ["--audio-format", "m4a"]);
  fs.rmSync(file);
});

test("YouTube can download when metadata probe fails", async () => {
  process.env.FAKE_YT_INFO_FAIL = "1";
  try {
    const { downloadAudio, downloadVideo } = require("../plugins/utils/yt");
    const audio = await downloadAudio("https://www.youtube.com/watch?v=dQw4w9WgXcQ");
    assert.match(audio.path, /\.m4a$/);
    assert.ok(fs.existsSync(audio.path));
    fs.rmSync(audio.path);
    const video = await downloadVideo("https://www.youtube.com/watch?v=dQw4w9WgXcQ", "360p");
    assert.match(video.path, /\.mp4$/);
    assert.ok(fs.existsSync(video.path));
    fs.rmSync(video.path);
  } finally {
    delete process.env.FAKE_YT_INFO_FAIL;
  }
});

test("Instagram gallery returns photos and video in nested folders", async () => {
  const files = await services.instagram("https://www.instagram.com/p/ABC123xyz/");
  assert.equal(files.length, 2);
  assert.match(files[0], /01\.jpg$/);
  assert.match(files[1], /02\.mp4$/);
  assert.ok(files.every((file) => fs.existsSync(file)));
  for (const file of files) fs.rmSync(file);
});

test("Instagram Reels use yt-dlp fallback if gallery-dl fails", async () => {
  process.env.FAKE_GALLERY_FAIL = "1";
  try {
    const files = await services.instagram("https://www.instagram.com/reel/ABC123xyz/");
    assert.equal(files.length, 1);
    assert.match(files[0], /\.mp4$/);
    assert.ok(lastYtArgs().includes("--yes-playlist"));
    for (const file of files) fs.rmSync(file);
  } finally {
    delete process.env.FAKE_GALLERY_FAIL;
  }
});

test("Instagram refuses URLs on unrelated hosts", async () => {
  await assert.rejects(
    services.instagram("https://instagram.com.attacker.invalid/p/ABC123xyz/"),
    /supported instagram URL/,
  );
});

test.after(() => {
  for (const [key, value] of Object.entries(previous)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  fs.rmSync(binDir, {recursive:true, force:true});
});
