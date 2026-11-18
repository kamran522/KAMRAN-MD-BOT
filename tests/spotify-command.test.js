"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const TRACK_URL = "https://open.spotify.com/track/4Qm7r3ImER8S2Ori1gLMAf?si=824ac879b6df4f17";

function loadServices(fetchResponse) {
  const module = { exports: {} };
  const filename = path.join(__dirname, "../core/services.js");
  vm.runInNewContext(fs.readFileSync(filename, "utf8"), {
    module, exports: module.exports, require, __dirname: path.dirname(filename),
    URL, URLSearchParams, AbortSignal, Buffer, console, process, setTimeout, clearTimeout,
    fetch: fetchResponse,
  }, { filename, timeout: 15000 });
  return module.exports;
}

function spotifyFixture({ metadataError = null, searchError = null, downloadError = null, conversionError = null, sendError = null } = {}) {
  const calls = [];
  const commands = [];
  const filePath = "/tmp/test-song.m4a";
  const source = fs.readFileSync(path.join(__dirname, "../plugins/youtube.js"), "utf8");
  const module = { exports: {} };
  vm.runInNewContext(source, {
    module, exports: module.exports, URL, Buffer, process,
    console: { error(...values) { calls.push({ action: "console-error", values }); }, log() {} },
    setTimeout(callback) { callback(); return 0; },
    require(spec) {
      if (spec === "../main") return { Module(meta, handler) { commands.push({ meta, handler }); } };
      if (spec === "fs") return {
        existsSync() { return false; },
        createReadStream() { throw new Error("Spotify must upload file paths, not stream wrappers"); },
      };
      if (spec === "path") return path;
      if (spec === "./utils/yt") return {
        async downloadVideo() { throw new Error("Unexpected video download"); },
        async downloadAudio(url) {
          calls.push({ action: "download", url });
          if (downloadError) throw new Error(downloadError);
          return { path: filePath, title: "YouTube matching song", info: {} };
        },
        async searchYoutube(query, limit) {
          calls.push({ action: "search", query, limit });
          if (searchError) throw new Error(searchError);
          return [{ url: "https://www.youtube.com/watch?v=example1234" }];
        },
        async getVideoInfo() { return {}; },
        async convertM4aToMp3(input, metadata) {
          calls.push({ action: "convert", input, metadata });
          if (conversionError) throw new Error(conversionError);
          return input;
        },
      };
      if (spec === "./utils/misc") return {
        async spotifyTrack(url) {
          calls.push({ action: "metadata", url });
          if (metadataError) throw new Error(metadataError);
          return { title: "Afsos", artist: "Anuv Jain, AP Dhillon" };
        },
      };
      if (spec === "../config") return { MODE: "public" };
      throw new Error("Unexpected require: " + spec);
    },
  }, { filename: "plugins/youtube.js", timeout: 15000 });
  const spotify = commands.find((item) => item.meta.pattern?.startsWith("spotify "));
  assert.ok(spotify, "Spotify command must register");
  const message = {
    jid: "test@s.whatsapp.net",
    reply_message: null,
    async sendReply(content, type, options) {
      calls.push({ action: "send", content, type, options });
      if (type === "audio" && sendError) throw new Error(sendError);
      return { key: { id: "m-1" } };
    },
    async edit(content) { calls.push({ action: "edit", content }); },
  };
  return { calls, message, handler: spotify.handler, filePath };
}

test("Spotify page title extraction handles Afsos by both listed artists", async () => {
  const seen = [];
  const services = loadServices(async (url) => {
    seen.push(String(url));
    return { ok: true, async text() {
      return "<html><title>Afsos - song and lyrics by Anuv Jain, AP Dhillon | Spotify</title></html>";
    } };
  });
  const meta = await services.spotifyTrack(TRACK_URL);
  assert.deepEqual(JSON.parse(JSON.stringify(meta)), { title: "Afsos", artist: "Anuv Jain, AP Dhillon" });
  assert.deepEqual(seen, ["https://open.spotify.com/track/4Qm7r3ImER8S2Ori1gLMAf"]);
});

test("Spotify lookup falls back to official oEmbed metadata if the page is blocked", async () => {
  const seen = [];
  const services = loadServices(async (url) => {
    seen.push(String(url));
    if (String(url).includes("/oembed?")) {
      return { ok: true, async json() {
        return { title: "Afsos", thumbnail_url: "https://i.scdn.co/image/example" };
      } };
    }
    return { ok: false, status: 403 };
  });
  const meta = await services.spotifyTrack(TRACK_URL);
  assert.equal(meta.title, "Afsos");
  assert.equal(meta.artist, "");
  assert.equal(meta.thumbnail, "https://i.scdn.co/image/example");
  assert.equal(seen.length, 2);
  assert.equal(new URL(seen[1]).hostname, "open.spotify.com");
  assert.equal(new URL(seen[1]).searchParams.get("url"), seen[0]);
});

test("Spotify lookup rejects non-Spotify or non-track links without requesting them", async () => {
  let requests = 0;
  const services = loadServices(async () => { requests++; throw new Error("Should not fetch"); });
  await assert.rejects(() => services.spotifyTrack("https://open.spotify.com.evil.test/track/4Qm7r3ImER8S2Ori1gLMAf"), /Provide an open.spotify.com/);
  await assert.rejects(() => services.spotifyTrack("https://open.spotify.com/playlist/4Qm7r3ImER8S2Ori1gLMAf"), /Provide an open.spotify.com/);
  assert.equal(requests, 0);
});

test("Spotify lookup gives an actionable error if both methods fail", async () => {
  const services = loadServices(async () => ({ ok: false, status: 503 }));
  await assert.rejects(
    () => services.spotifyTrack(TRACK_URL),
    /Spotify track information is unavailable/
  );
});

test("Spotify command searches by title and artist then sends the local audio file path", async () => {
  const f = spotifyFixture();
  await f.handler(f.message, [".spotify " + TRACK_URL, TRACK_URL]);
  assert.equal(f.calls.find((call) => call.action === "search").query, "Afsos Anuv Jain, AP Dhillon audio");
  const upload = f.calls.find((call) => call.action === "send" && call.type === "audio");
  assert.ok(upload, "Audio should be sent to WhatsApp");
  assert.equal(upload.content.url, f.filePath);
  assert.equal(upload.options.mimetype, "audio/mp4");
  assert.equal(f.calls.filter((call) => call.action === "edit").at(-1).content, "_Download complete!_");
});

test("Spotify command reports when metadata cannot be obtained", async () => {
  const f = spotifyFixture({ metadataError: "Spotify track information is unavailable. Check the link or retry later." });
  await f.handler(f.message, [".spotify " + TRACK_URL, TRACK_URL]);
  const edit = f.calls.filter((call) => call.action === "edit").at(-1).content;
  assert.match(edit, /Spotify failed while fetching Spotify track information/);
  assert.match(edit, /track information is unavailable/);
  assert.equal(f.calls.filter((call) => call.type === "audio").length, 0);
});

test("Spotify command reports YouTube download errors rather than hiding them", async () => {
  const f = spotifyFixture({ downloadError: "yt-dlp failed: No such file or directory: /tmp/kamran-bot/yt/file.mp4.part-Frag97" });
  await f.handler(f.message, [".spotify " + TRACK_URL, TRACK_URL]);
  const edit = f.calls.filter((call) => call.action === "edit").at(-1).content;
  assert.match(edit, /lost a temporary file/);
});


test("Spotify reports YouTube search network failures separately from metadata", async () => {
  const f = spotifyFixture({ searchError: "fetch failed" });
  await f.handler(f.message, [".spotify " + TRACK_URL, TRACK_URL]);
  const edit = f.calls.filter((call) => call.action === "edit").at(-1).content;
  assert.match(edit, /Spotify failed while searching YouTube/);
  assert.match(edit, /YouTube search failed over the network/);
  assert.equal(f.calls.filter((call) => call.action === "download").length, 0);
});

test("Spotify reports audio downloader network failures as a YouTube audio problem", async () => {
  const f = spotifyFixture({ downloadError: "ETIMEDOUT fetching YouTube audio" });
  await f.handler(f.message, [".spotify " + TRACK_URL, TRACK_URL]);
  const edit = f.calls.filter((call) => call.action === "edit").at(-1).content;
  assert.match(edit, /Spotify failed while downloading YouTube audio/);
  assert.match(edit, /YouTube audio download failed over the network/);
});

test("Spotify distinguishes audio conversion from WhatsApp upload failures", async () => {
  const converting = spotifyFixture({ conversionError: "ffmpeg conversion failed" });
  await converting.handler(converting.message, [".spotify " + TRACK_URL, TRACK_URL]);
  assert.match(converting.calls.filter((call) => call.action === "edit").at(-1).content, /Spotify failed while converting audio/);

  const upload = spotifyFixture({ sendError: "ECONNRESET" });
  await upload.handler(upload.message, [".spotify " + TRACK_URL, TRACK_URL]);
  const last = upload.calls.filter((call) => call.action === "edit").at(-1).content;
  assert.match(last, /Spotify failed while sending audio to WhatsApp/);
  assert.match(last, /WhatsApp media upload failed over the network/);
});
