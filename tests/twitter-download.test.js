"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const { normalizeTwitterUrl, findTwitterUrl, downloadTwitterMedia, sendTwitterMedia, twitterFailureReason } =
  require("../plugins/utils/twitter");

const root = fs.mkdtempSync(path.join(os.tmpdir(), "kamran-twitter-test-"));
const ytBinary = path.join(root, "yt-dlp");
const galleryBinary = path.join(root, "gallery-dl");
const logFile = path.join(root, "calls.jsonl");
const previous = {};
for (const key of [
  "YTDLP_PATH", "GALLERYDL_PATH", "FAKE_TWITTER_MODE",
  "FAKE_GALLERY_MODE", "FAKE_TWITTER_LOG", "YTDLP_COOKIES_TWITTER", "YTDLP_COOKIES"
]) previous[key] = process.env[key];

fs.writeFileSync(ytBinary, [
  "#!/usr/bin/env node",
  "const fs = require('fs'); const path = require('path');",
  "const args = process.argv.slice(2);",
  "fs.appendFileSync(process.env.FAKE_TWITTER_LOG, JSON.stringify({ tool: 'yt-dlp', args }) + '\\n');",
  "if (process.env.FAKE_TWITTER_MODE === 'video') {",
  "  const pattern = args[args.indexOf('-o') + 1];",
  "  const output = pattern.replace('%(playlist_index)s', '1').replace('%(id)s', '12345').replace('%(ext)s', 'mp4');",
  "  fs.mkdirSync(path.dirname(output), { recursive: true });",
  "  fs.writeFileSync(output, Buffer.alloc(2048));",
  "  process.exit(0);",
  "}",
  "console.error('ERROR: No downloadable video found'); process.exit(1);"
].join("\n") + "\n");
fs.writeFileSync(galleryBinary, [
  "#!/usr/bin/env node",
  "const fs = require('fs'); const path = require('path');",
  "const args = process.argv.slice(2);",
  "fs.appendFileSync(process.env.FAKE_TWITTER_LOG, JSON.stringify({ tool: 'gallery-dl', args }) + '\\n');",
  "if (process.env.FAKE_GALLERY_MODE === 'photo') {",
  "  const dir = args[args.indexOf('--directory') + 1];",
  "  fs.mkdirSync(dir, { recursive: true });",
  "  fs.writeFileSync(path.join(dir, 'first.jpg'), Buffer.alloc(1024));",
  "  fs.writeFileSync(path.join(dir, 'second.png'), Buffer.alloc(1024));",
  "  process.exit(0);",
  "}",
  "console.error('ERROR: Login required'); process.exit(1);"
].join("\n") + "\n");
fs.chmodSync(ytBinary, 0o755);
fs.chmodSync(galleryBinary, 0o755);
process.env.YTDLP_PATH = ytBinary;
process.env.GALLERYDL_PATH = galleryBinary;
process.env.FAKE_TWITTER_LOG = logFile;
process.env.FAKE_TWITTER_MODE = "video";
process.env.FAKE_GALLERY_MODE = "none";
delete process.env.YTDLP_COOKIES;
delete process.env.YTDLP_COOKIES_TWITTER;

test.after(() => {
  for (const [name, value] of Object.entries(previous)) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
  fs.rmSync(root, { recursive: true, force: true });
});

const tweet = "https://x.com/researcher/status/1990123456789012345";

function calls() {
  return fs.existsSync(logFile) ? fs.readFileSync(logFile, "utf8").trim().split("\n")
    .filter(Boolean).map(JSON.parse) : [];
}

test("validates and canonicalizes x.com, twitter.com and mobile variants without following redirects", () => {
  assert.equal(normalizeTwitterUrl("https://twitter.com/researcher/status/1990123456789012345?ref=copy"), tweet);
  assert.equal(normalizeTwitterUrl("https://mobile.x.com/researcher/status/1990123456789012345/photo/1"), tweet);
  assert.equal(normalizeTwitterUrl("https://x.com/i/status/1990123456789012345"), "https://x.com/i/status/1990123456789012345");
  assert.equal(findTwitterUrl("Post " + tweet + " !"), tweet);
  assert.equal(findTwitterUrl("not a URL"), null);
  for (const bad of [
    "https://x.com.evil.example/researcher/status/1990123456789012345",
    "https://x.com/researcher",
    "https://x.com/researcher/status/1",
    "https://x.com/researcher/status/1990123456789012345/../../x",
    "https://other.example/researcher/status/1990123456789012345",
  ]) assert.throws(() => normalizeTwitterUrl(bad));
});

test("findTwitterUrl recognizes mobile, bare and image-specific links without accepting false hosts", () => {
  assert.equal(findTwitterUrl("x.com/researcher/status/1990123456789012345"), tweet);
  assert.equal(findTwitterUrl("Look (https://mobile.x.com/researcher/status/1990123456789012345/photo/1)"), tweet);
  assert.equal(findTwitterUrl("https://twitter.com/researcher/status/1990123456789012345/video/1?ref=share"), tweet);
  assert.equal(normalizeTwitterUrl("https://m.x.com/researcher/status/1990123456789012345/"), tweet);
  assert.equal(findTwitterUrl("https://evil.x.com/researcher/status/1990123456789012345"), null);
  assert.equal(findTwitterUrl("https://x.com.attacker.example/researcher/status/1990123456789012345"), null);
});

test("video posts download through local yt-dlp, then upload MP4 and clean temporary data", async () => {
  process.env.FAKE_TWITTER_MODE = "video";
  process.env.FAKE_GALLERY_MODE = "none";
  fs.writeFileSync(logFile, "");
  const sent = [];
  const message = { data: { key: { id: "quoted" } }, async sendMessage(media, kind, options) {
    assert.equal(fs.existsSync(media.url), true, "media must exist during upload");
    sent.push({ media, kind, options });
  } };
  const count = await sendTwitterMedia(message, tweet);
  assert.equal(count, 1);
  assert.equal(sent[0].kind, "video");
  assert.equal(sent[0].options.mimetype, "video/mp4");
  assert.equal(sent[0].options.quoted, message.data);
  assert.equal(fs.existsSync(sent[0].media.url), false, "temporary video must be removed after upload");
  const executions = calls();
  assert.equal(executions.length, 1);
  assert.equal(executions[0].tool, "yt-dlp");
  assert.equal(executions[0].args.at(-1), tweet);
  assert.equal(executions[0].args[executions[0].args.indexOf("--playlist-end") + 1], "4");
});

test("photo-only posts fall back to gallery-dl and send each image", async () => {
  process.env.FAKE_TWITTER_MODE = "none";
  process.env.FAKE_GALLERY_MODE = "photo";
  fs.writeFileSync(logFile, "");
  const sent = [];
  const result = await sendTwitterMedia({
    data: { key: { id: "status1" } },
    async sendMessage(media, kind) { sent.push({ media, kind }); },
  }, tweet);
  assert.equal(result, 2);
  assert.deepEqual(sent.map(x => x.kind), ["image", "image"]);
  assert.ok(sent.every(x => !fs.existsSync(x.media.url)));
  assert.deepEqual(calls().map(x => x.tool), ["yt-dlp", "gallery-dl"]);
});

test("download passes optional X-specific cookies without affecting other sites", async () => {
  process.env.FAKE_TWITTER_MODE = "video";
  fs.writeFileSync(logFile, "");
  process.env.YTDLP_COOKIES_TWITTER = "/tmp/cookies-x-authorized.txt";
  try {
    const result = await downloadTwitterMedia(tweet);
    try {
      const run = calls()[0].args;
      assert.equal(run[run.indexOf("--cookies") + 1], "/tmp/cookies-x-authorized.txt");
    } finally { result.cleanup(); }
  } finally { delete process.env.YTDLP_COOKIES_TWITTER; }
});

test("upload failure cleans the local media without sending duplicates", async () => {
  process.env.FAKE_TWITTER_MODE = "video";
  await assert.rejects(
    () => sendTwitterMedia({
      data: { key: {} },
      async sendMessage() { throw new Error("WhatsApp upload rejected"); },
    }, tweet),
    /WhatsApp upload rejected/
  );
});

test("unsupported or blocked posts give actionable errors and remove temporary files", async () => {
  process.env.FAKE_TWITTER_MODE = "none";
  process.env.FAKE_GALLERY_MODE = "none";
  await assert.rejects(() => downloadTwitterMedia(tweet), /gallery-dl|Login required/);
  assert.match(twitterFailureReason(new Error("HTTP 403 Login required")), /cookies.txt/);
  assert.match(twitterFailureReason(new Error("HTTP 429 Too Many Requests")), /rate-limiting/);
});
