"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const twitterUrls = require("../plugins/utils/twitter");

function fixture(options = {}) {
  const modules = [];
  const events = [];
  const deleted = [];
  const config = {
    MODE: "private",
    HANDLERS: ".,",
    AUTODL: "group@g.us",
    AUTODL_ALL_GROUPS: "false",
    AUTODL_ALL_DMS: "false",
    ...options.config,
  };
  const results = {
    downloadGram: async () => ["/tmp/test-photo.jpg", "/tmp/test-video.mp4"],
    pinterestDl: async () => ({ status: true, result: "/tmp/test-pin.jpg" }),
    tiktok: async () => ({ url: "/tmp/test-tiktok.mp4" }),
    fb: async () => ({ url: "/tmp/test-fb.mp4" }),
    getVideoInfo: async () => ({
      title: "Test video",
      videoId: "7Rmnsy_7hAs",
      formats: [
        { type: "video", quality: "144p", size: "10 MB" },
        { type: "audio", quality: "audio", size: "2 MB" },
      ],
    }),
    downloadAudio: async () => ({ path: "/tmp/test-audio.m4a", title: "Audio" }),
    convertM4aToMp3: async () => "/tmp/test-audio.mp3",
    searchYoutube: async () => [{ url: "https://www.youtube.com/watch?v=7Rmnsy_7hAs" }],
    spotifyTrack: async () => ({ title: "Afsos", artist: "Anuv Jain" }),
    twitterSend: async (message, url) => {
      events.push({ type: "twitter", url });
      await message.sendMessage({ url: "/tmp/test-twitter.mp4" }, "video", { quoted: message.data, mimetype: "video/mp4" });
      return 1;
    },
    ...options.services,
  };
  const stores = {};
  const sandbox = {
    module: { exports: {} }, exports: {}, Buffer, URL, setTimeout(callback) { callback(); return 0; },
    console: { error(...args) { events.push({ type: "error", args }); }, warn(...args) { events.push({ type: "warn", args }); } },
    require(name) {
      if (name === "../main") return { Module(meta, handler) { modules.push({ meta, handler }); } };
      if (name === "../config") return config;
      if (name === "./manage") return { async setVar(key, value) { stores[key] = value; config[key] = value; } };
      if (name === "./utils") return {
        downloadGram: results.downloadGram,
        pinterestDl: results.pinterestDl,
        tiktok: results.tiktok,
        fb: results.fb,
      };
      if (name === "../core/services") return { spotifyTrack: results.spotifyTrack };
      if (name === "./utils/twitter") return {
        normalizeTwitterUrl: twitterUrls.normalizeTwitterUrl,
        findTwitterUrl: twitterUrls.findTwitterUrl,
        sendTwitterMedia: results.twitterSend,
        twitterFailureReason: (error) => "Post unavailable: " + error.message,
      };
      if (name === "./utils/yt") return {
        getVideoInfo: results.getVideoInfo,
        downloadAudio: results.downloadAudio,
        convertM4aToMp3: results.convertM4aToMp3,
        searchYoutube: results.searchYoutube,
      };
      if (name === "fs") return {
        existsSync(file) { return typeof file === "string" && file.startsWith("/tmp/"); },
        unlinkSync(file) { deleted.push(file); },
        createReadStream() { throw new Error("Media must be uploaded by file path"); },
      };
      throw new Error("Unexpected import: " + name);
    },
  };
  const source = fs.readFileSync(path.join(__dirname, "../plugins/autodl.js"), "utf8");
  vm.runInNewContext(source, sandbox, { filename: "plugins/autodl.js", timeout: 12000 });
  const watcher = modules.find(({ meta }) => meta.on === "text");
  const control = modules.find(({ meta }) => meta.pattern?.startsWith("autodl "));
  assert.ok(watcher, "AutoDL text watcher must load");
  assert.ok(control, "AutoDL control command must load");
  function message(text, jid = "group@g.us") {
    return {
      jid, text, fromMe: false, fromBot: false, data: { key: { remoteJid: jid, id: "q1" } },
      async react(emoji) { events.push({ type: "react", emoji }); },
      async sendMessage(media, kind, settings) {
        events.push({ type: "sendMessage", media, kind, settings });
      },
      async sendReply(media, kind, settings) {
        events.push({ type: "sendReply", media, kind, settings });
        return { key: { id: "status-1" } };
      },
      async edit(value) { events.push({ type: "edit", value }); },
    };
  }
  return { events, deleted, watcher, control, message, stores, config };
}

test("AutoDL private-mode watcher registers for ordinary group members", async () => {
  const f = fixture();
  assert.equal(f.watcher.meta.fromMe, false);
  const msg = f.message("https://youtu.be/7Rmnsy_7hAs");
  await f.watcher.handler(msg);
  const menu = f.events.find((e) => e.type === "sendReply" && typeof e.media === "string");
  assert.match(menu.media, /Select Video Quality/);
  assert.match(menu.media, /144p/);
  assert.match(menu.media, /Reply with a number to download/);
});

test("AutoDL avoids explicit download commands but not normal sentences mentioning a platform", async () => {
  const f = fixture();
  await f.watcher.handler(f.message(".ytv https://youtu.be/7Rmnsy_7hAs"));
  assert.equal(f.events.filter((e) => e.type === "sendReply").length, 0);
  await f.watcher.handler(f.message("A tiktok clip: https://vt.tiktok.com/ABCD12345/"));
  assert.ok(f.events.some((e) => e.type === "sendReply" && e.kind === "video"));
});

test("YouTube AutoDL audio uploads the converted file path and removes both audio files", async () => {
  const f = fixture();
  await f.watcher.handler(f.message("audio https://youtu.be/7Rmnsy_7hAs"));
  const audio = f.events.find((e) => e.type === "sendMessage" && e.kind === "document");
  assert.ok(audio);
  assert.equal(audio.media.url, "/tmp/test-audio.mp3");
  assert.equal(audio.settings.mimetype, "audio/mpeg");
  assert.ok(f.deleted.includes("/tmp/test-audio.mp3"));
  assert.ok(f.deleted.includes("/tmp/test-audio.m4a"));
});

test("Instagram AutoDL sends mixed carousel media as sequential image/video messages", async () => {
  const f = fixture();
  const msg = f.message("https://www.instagram.com/p/C123ABc/");
  await f.watcher.handler(msg);
  const media = f.events.filter((e) => e.type === "sendMessage");
  assert.deepEqual(media.map((e) => e.kind), ["image", "video"]);
  assert.deepEqual(media.map((e) => e.media.url), ["/tmp/test-photo.jpg", "/tmp/test-video.mp4"]);
  assert.equal(media[0].settings.quoted, msg.data);
  assert.ok(f.deleted.includes("/tmp/test-photo.jpg"));
  assert.ok(f.deleted.includes("/tmp/test-video.mp4"));
});

test("Pinterest AutoDL sends images as images, not unsupported video messages", async () => {
  const f = fixture();
  await f.watcher.handler(f.message("https://pin.it/ABC1234"));
  const picture = f.events.find((e) => e.type === "sendMessage");
  assert.ok(picture);
  assert.equal(picture.kind, "image");
  assert.equal(picture.media.url, "/tmp/test-pin.jpg");
  assert.ok(f.deleted.includes("/tmp/test-pin.jpg"));
});

test("TikTok and Facebook send local video paths and clean temporary files", async () => {
  const f = fixture();
  await f.watcher.handler(f.message("https://vt.tiktok.com/ABCD12345/"));
  await f.watcher.handler(f.message("https://www.facebook.com/watch?v=1234567"));
  const vids = f.events.filter((e) => e.type === "sendReply" && e.kind === "video");
  assert.equal(vids.length, 2);
  assert.deepEqual(vids.map((e) => e.media.url), ["/tmp/test-tiktok.mp4", "/tmp/test-fb.mp4"]);
  assert.ok(f.deleted.includes("/tmp/test-tiktok.mp4"));
  assert.ok(f.deleted.includes("/tmp/test-fb.mp4"));
});

test("Spotify AutoDL resolves the existing Spotify helper and uploads a file URL", async () => {
  const f = fixture();
  await f.watcher.handler(f.message("https://open.spotify.com/track/4Qm7r3ImER8S2Ori1gLMAf"));
  const audio = f.events.find((e) => e.type === "sendReply" && e.kind === "audio");
  assert.ok(audio);
  assert.equal(audio.media.url, "/tmp/test-audio.mp3");
  assert.equal(audio.settings.mimetype, "audio/mpeg");
});

test("AutoDL enabled-list and .autodl toggle commands still work", async () => {
  const f = fixture();
  const cmd = f.message(".autodl off");
  await f.control.handler(cmd, [".autodl off", "off"]);
  assert.equal(f.stores.AUTODL, "");
  await f.watcher.handler(f.message("https://youtu.be/7Rmnsy_7hAs"));
  assert.equal(f.events.filter((e) => e.type === "sendReply" && typeof e.media === "string" && e.media.includes("Select Video")).length, 0);
  await f.control.handler(cmd, [".autodl on", "on"]);
  assert.equal(f.stores.AUTODL, "group@g.us");
  await f.watcher.handler(f.message("https://youtu.be/7Rmnsy_7hAs"));
  assert.equal(f.events.filter((e) => e.type === "sendReply" && typeof e.media === "string" && e.media.includes("Select Video")).length, 1);
});


test("Twitter/X AutoDL downloads a tweet instead of saying the platform is unsupported", async () => {
  const f = fixture();
  await f.watcher.handler(f.message("Check https://x.com/researcher/status/1990123456789012345"));
  const dispatched = f.events.find(e => e.type === "twitter");
  assert.equal(dispatched.url, "https://x.com/researcher/status/1990123456789012345");
  const video = f.events.find(e => e.type === "sendMessage" && e.kind === "video");
  assert.equal(video.media.url, "/tmp/test-twitter.mp4");
  assert.ok(f.events.some(e => e.type === "react" && e.emoji === "✅"));
  assert.equal(f.events.some(e => e.type === "sendReply" && String(e.media).includes("not available in this build")), false);
});

test("Twitter AutoDL ignores explicit .twitter commands to avoid downloading twice", async () => {
  const f = fixture();
  await f.watcher.handler(f.message(".twitter https://x.com/researcher/status/1990123456789012345"));
  await f.watcher.handler(f.message(".x https://x.com/researcher/status/1990123456789012345"));
  assert.equal(f.events.some(e => e.type === "twitter"), false);
});

test("Twitter AutoDL reports a blocked post without interrupting other commands", async () => {
  const f = fixture({ services: {
    async twitterSend() { throw new Error("Login required"); },
  } });
  await f.watcher.handler(f.message("https://twitter.com/researcher/status/1990123456789012345"));
  assert.ok(f.events.some(e => e.type === "sendReply" && String(e.media).includes("Post unavailable")));
  assert.ok(f.events.some(e => e.type === "react" && e.emoji === "❌"));
});


test("AutoDL recognizes mobile.x.com photo links and canonicalizes to the post", async () => {
  const f = fixture();
  await f.watcher.handler(f.message(
    "https://mobile.x.com/researcher/status/1990123456789012345/photo/1?utm_source=share"
  ));
  const dispatched = f.events.find(e => e.type === "twitter");
  assert.ok(dispatched, "mobile X photo post must dispatch to Twitter AutoDL");
  assert.equal(dispatched.url, "https://x.com/researcher/status/1990123456789012345");
});

test("AutoDL recognizes bare x.com links without a URL scheme", async () => {
  const f = fixture();
  await f.watcher.handler(f.message("Look: x.com/researcher/status/1990123456789012345"));
  assert.equal(f.events.find(e => e.type === "twitter").url,
    "https://x.com/researcher/status/1990123456789012345");
});

test("AutoDL recognizes X video and old Twitter variants including trailing slash", async () => {
  const f = fixture();
  await f.watcher.handler(f.message(
    "https://twitter.com/researcher/status/1990123456789012345/video/1"
  ));
  await f.watcher.handler(f.message(
    "https://x.com/researcher/status/1990123456789012345/"
  ));
  assert.equal(f.events.filter(e => e.type === "twitter").length, 2);
  assert.ok(f.events.filter(e => e.type === "twitter").every(e =>
    e.url === "https://x.com/researcher/status/1990123456789012345"
  ));
});

test("AutoDL extracts a post URL from a WhatsApp link preview", async () => {
  const f = fixture();
  const msg = f.message("Shared an X post");
  msg.data.message = {
    extendedTextMessage: {
      text: "Shared an X post",
      canonicalUrl: "https://mobile.x.com/researcher/status/1990123456789012345/photo/1",
    },
  };
  await f.watcher.handler(msg);
  assert.equal(f.events.find(e => e.type === "twitter").url,
    "https://x.com/researcher/status/1990123456789012345");
});

test("AutoDL does not download unrecognized X profiles or lookalike domains", async () => {
  const f = fixture();
  await f.watcher.handler(f.message("https://x.com/researcher"));
  await f.watcher.handler(f.message("https://x.com.attacker.example/researcher/status/1990123456789012345"));
  assert.equal(f.events.filter(e => e.type === "twitter").length, 0);
});

test("X AutoDL honors per-chat enablement", async () => {
  const f = fixture({ config: { AUTODL: "", AUTODL_ALL_GROUPS: "false" } });
  await f.watcher.handler(f.message("https://x.com/researcher/status/1990123456789012345"));
  assert.equal(f.events.filter(e => e.type === "twitter").length, 0);
  const enabled = fixture({ config: { AUTODL: "", AUTODL_ALL_GROUPS: "true" } });
  await enabled.watcher.handler(enabled.message("https://x.com/researcher/status/1990123456789012345"));
  assert.equal(enabled.events.filter(e => e.type === "twitter").length, 1);
});
