"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

function fixture({ failDownload = false } = {}) {
  const commands = [];
  const calls = [];
  const youtube = {
    downloadVideo: async (url, quality) => {
      calls.push({ op: "downloadVideo", url, quality });
      if (failDownload) throw new Error("yt-dlp failed: fragment path missing");
      return { path: "/tmp/mock-video.mp4", title: "Example" };
    },
    downloadAudio: async () => { throw new Error("Not expected to download audio"); },
    searchYoutube: async () => [],
    getVideoInfo: async () => ({}),
    convertM4aToMp3: async () => {},
  };
  const module = { exports: {} };
  const source = fs.readFileSync(path.join(__dirname, "../plugins/youtube.js"), "utf8");
  vm.runInNewContext(source, {
    module, exports: module.exports, console, Buffer, URL, process,
    setTimeout(callback) { callback(); return 0; },
    require(name) {
      if (name === "../main") return { Module(meta, fn) { commands.push({ meta, fn }); } };
      if (name === "fs") return {
        statSync: () => ({ size: 1024 }),
        existsSync: () => false,
        createReadStream() { throw new Error("Should send local file path, not stream wrapper"); },
      };
      if (name === "path") return path;
      if (name === "./utils/yt") return youtube;
      if (name === "./utils/misc") return { spotifyTrack: async () => ({}) };
      if (name === "../config") return { MODE: "public" };
      throw new Error("Unexpected require: " + name);
    },
  }, { filename: "plugins/youtube.js", timeout: 10000 });
  const listener = commands.find((x) => x.meta.on === "text");
  assert.ok(listener);
  const message = {
    text: "2",
    jid: "12345@s.whatsapp.net",
    reply_message: {
      fromMe: true,
      message: [
        "_*Select Video Quality*_",
        "",
        "_*Example video*_",
        "",
        "(dQw4w9WgXcQ)",
        "",
        "*1.* _*720p*_",
        "*2.* _*360p*_",
        "",
        "_Reply with a number to download_",
      ].join("\n"),
    },
    async sendReply(payload, type, opts) {
      calls.push({ op: "sendReply", payload, type, opts });
      return { key: { id: "msg-1" } };
    },
    async sendMessage(payload, type, opts) {
      calls.push({ op: "sendMessage", payload, type, opts });
    },
    async edit(value) { calls.push({ op: "edit", value }); },
  };
  return { calls, listener, message };
}

test("replying 2 to the video-quality menu downloads 360p and uploads a local file path", async () => {
  const f = fixture();
  await f.listener.fn(f.message, ["2"]);
  assert.deepEqual(JSON.parse(JSON.stringify(
    f.calls.filter((x) => x.op === "downloadVideo").map(({ url, quality }) => ({ url, quality }))
  )), [{ url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ", quality: "360p" }]);
  const uploaded = f.calls.find((x) => x.op === "sendReply" && x.type === "video");
  assert.ok(uploaded, "local video must be sent");
  assert.equal(uploaded.payload.url, "/tmp/mock-video.mp4");
  assert.equal(f.calls.at(-1).value, "_Download complete!_");
});

test("YouTube quality selection shows a useful error instead of bare 'Download failed!'", async () => {
  const f = fixture({ failDownload: true });
  await f.listener.fn(f.message, ["2"]);
  const lastEdit = f.calls.filter((x) => x.op === "edit").at(-1);
  assert.match(lastEdit.value, /Download failed\./);
  assert.match(lastEdit.value, /PM2 logs/);
});
