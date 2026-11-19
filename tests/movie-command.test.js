"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

function fixture({ mode = "public", bytes = 200 * 1024 * 1024, failDownload = false, failSearch = false } = {}) {
  const calls = [];
  const commands = [];
  const selected = [];
  const film = {
    identifier: "classic-film", title: "Classic Film", license: "CC0", licenseUrl: "https://creativecommons.org/publicdomain/zero/1.0/",
    creator: "Classic Archive", page: "https://archive.org/details/classic-film",
    file: { ext: ".mp4", name: "classic.mp4", size: bytes, url: "https://archive.org/download/classic-film/classic.mp4" },
  };
  const movieServices = {
    MAX_WHATSAPP_BYTES: 80 * 1024 * 1024,
    friendlySize(n) { return (n / (1024 * 1024)).toFixed(1) + " MB"; },
    async searchMovies(query) {
      calls.push({ op: "search", query });
      if (failSearch) throw new Error("Network error");
      return [
        { identifier: "classic-film", title: "Classic Film", year: "1968", license: "CC0" },
        { identifier: "another-film", title: "Another Film", license: "CC BY" },
      ];
    },
    async getMovieDetails(id) {
      calls.push({ op: "detail", id });
      selected.push(id);
      return { ...film, identifier: id };
    },
    async downloadMovieToTemp(movie) {
      calls.push({ op: "download", movie });
      if (failDownload) throw new Error("Download timeout");
      return { path: "/tmp/test-movie.mp4", cleanup() { calls.push({ op: "cleanup" }); } };
    },
  };
  const module = { exports: {} };
  vm.runInNewContext(fs.readFileSync(path.resolve(__dirname, "../plugins/movie.js"), "utf8"), {
    module, exports: module.exports, process, Buffer, URL, Date, console: {
      error(...args) { calls.push({ op: "error", args }); },
      warn(...args) { calls.push({ op: "warn", args }); },
    },
    require(name) {
      if (name === "../main") return { Module(meta, handler) { commands.push({ meta, handler }); } };
      if (name === "../config") return { MODE: mode };
      if (name === "./utils/movies") return movieServices;
      throw new Error("Unexpected require " + name);
    },
  }, { filename: "plugins/movie.js", timeout: 15000 });

  const cmd = commands.find(x => x.meta.pattern === "movie ?(.*)");
  const alias = commands.find(x => x.meta.pattern === "movies ?(.*)");
  const watcher = commands.find(x => x.meta.on === "text");
  assert.ok(cmd && alias && watcher, "both movie aliases and numbered reply watcher must register");

  function message(text = "", { jid = "group@g.us", sender = "user@lid", quote = null, owner = true } = {}) {
    return {
      text, message: text, jid, sender, fromMe: false, fromOwner: owner,
      reply_message: quote ? { text: quote, id: "menu-1" } : false,
      data: { key: { remoteJid: jid } },
      async sendReply(value) {
        calls.push({ op: "reply", value, sender });
        return { key: { id: "menu-1" } };
      },
      async sendMessage(media, type, opts) { calls.push({ op: "sendMedia", media, type, opts }); },
    };
  }
  return { cmd, alias, watcher, message, calls, selected };
}

test(".movie and .movies register as download commands and respect bot mode", () => {
  const f = fixture();
  assert.equal(f.cmd.meta.fromMe, false);
  assert.equal(f.alias.meta.fromMe, false);
  assert.equal(f.cmd.meta.use, "download");
  assert.equal(fixture({ mode: "private" }).cmd.meta.fromMe, true);
});

test(".movie title lists licensed films; numbered reply selects a full movie link", async () => {
  const f = fixture();
  await f.cmd.handler(f.message(".movie Classic Film"), [".movie Classic Film", "Classic Film"]);
  const menu = f.calls.find(c => c.op === "reply").value;
  assert.match(menu, /Movie Search Results/);
  assert.match(menu, /Classic Film/);
  assert.match(menu, /1.*Classic Film/);
  assert.match(menu, /2.*Another Film/);
  const reply = f.message("1", { quote: menu });
  await f.watcher.handler(reply);
  assert.deepEqual(f.selected, ["classic-film"]);
  assert.ok(f.calls.some(c => c.op === "reply" && String(c.value).includes("https://archive.org/download/classic-film/classic.mp4")));
  assert.ok(f.calls.some(c => c.op === "reply" && String(c.value).includes("license")));
  assert.ok(f.calls.some(c => c.op === "reply" && String(c.value).includes("upload limit")));
  assert.equal(f.calls.some(c => c.op === "download"), false, "large movie must use the direct link only");
});

test(".movie number after a search works without quoting a bot reply", async () => {
  const f = fixture();
  await f.cmd.handler(f.message(".movie Classic"), [".movie Classic", "Classic"]);
  await f.alias.handler(f.message(".movies 2"), [".movies 2", "2"]);
  assert.deepEqual(f.selected, ["another-film"]);
});

test("a movie reply never consumes YouTube quality choices or another member's search", async () => {
  const f = fixture();
  await f.cmd.handler(f.message(".movie Classic"), [".movie Classic", "Classic"]);
  const menu = f.calls.find(c => c.op === "reply").value;
  await f.watcher.handler(f.message("1", { quote: "Select Video Quality\n1. 720p" }));
  await f.watcher.handler(f.message("1", { quote: menu, sender: "other@lid" }));
  assert.equal(f.selected.length, 0);
  await f.watcher.handler(f.message("1", { quote: menu }));
  assert.deepEqual(f.selected, ["classic-film"]);
});

test("private mode prevents non-owner numeric selections", async () => {
  const f = fixture({ mode: "private" });
  await f.cmd.handler(f.message(".movie Classic"), [".movie Classic", "Classic"]);
  const menu = f.calls.find(c => c.op === "reply").value;
  await f.watcher.handler(f.message("1", { quote: menu, owner: false }));
  assert.equal(f.selected.length, 0);
});

test("small movie uploads as a local document and always cleans up", async () => {
  const f = fixture({ bytes: 30 * 1024 * 1024 });
  await f.cmd.handler(f.message(".movie Classic"), [".movie Classic", "Classic"]);
  await f.cmd.handler(f.message(".movie 1"), [".movie 1", "1"]);
  const upload = f.calls.find(c => c.op === "sendMedia");
  assert.equal(upload.type, "document");
  assert.equal(upload.media.url, "/tmp/test-movie.mp4");
  assert.equal(upload.opts.mimetype, "video/mp4");
  assert.ok(f.calls.some(c => c.op === "cleanup"));
});

test("a failed WhatsApp-sized download keeps the direct file link available", async () => {
  const f = fixture({ bytes: 30 * 1024 * 1024, failDownload: true });
  await f.cmd.handler(f.message(".movie Classic"), [".movie Classic", "Classic"]);
  await f.cmd.handler(f.message(".movie 1"), [".movie 1", "1"]);
  assert.ok(f.calls.some(c => c.op === "reply" && String(c.value).includes("Full movie file")));
  assert.ok(f.calls.some(c => c.op === "reply" && String(c.value).includes("upload failed")));
});

test("search failure and empty query show useful instructions", async () => {
  const f = fixture({ failSearch: true });
  await f.cmd.handler(f.message(".movie"), [".movie", ""]);
  assert.match(f.calls.at(-1).value, /Usage/);
  await f.cmd.handler(f.message(".movie unknown film"), [".movie unknown film", "unknown film"]);
  assert.match(f.calls.at(-1).value, /Movie search failed/);
});
