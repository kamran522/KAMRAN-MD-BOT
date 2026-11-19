"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

function fixture(filename, mocks = {}, extra = {}) {
  const registered = [];
  const module = { exports: {} };
  const mockMain = { commands: [], Module(meta, handler) { registered.push({ meta, handler }); } };
  const code = fs.readFileSync(path.join(__dirname, "..", filename), "utf8");
  vm.runInNewContext(code, {
    module, exports: module.exports, process, Buffer, URL, console,
    __dirname: path.join(__dirname, "..", path.dirname(filename)),
    setTimeout(callback) { callback(); return 0; },
    clearTimeout() {},
    require(name) {
      if (name === "../main") return mockMain;
      if (Object.hasOwn(mocks, name)) return mocks[name];
      if (["os", "path", "fs"].includes(name)) return require(name);
      throw new Error("Unexpected dependency in " + filename + ": " + name);
    },
    ...extra,
  }, { filename, timeout: 15000 });
  return registered;
}
function pick(commands, prefix) {
  const item = commands.find(({ meta }) => meta.pattern?.startsWith(prefix));
  assert.ok(item, "Expected registered command " + prefix);
  return item.handler;
}

test("setalive is reflected immediately by .alive and .setalive get without restarting", async () => {
  const config = { MODE: "private", HANDLERS: ".", ALIVE: "Old status", VERSION: "1" };
  const events = [];
  const modules = fixture("plugins/commands.js", {
    "../config": config,
    "./utils/upload": { uploadToImgbb: async () => ({ url: "" }) },
    "./manage": { async setVar(key, value) { config[key] = value; } },
    "../core/store": { async getTotalUserCount() { return 1; } },
    "./utils/alive-parser": { async parseAliveMessage() { return ""; }, async sendAliveMessage() {} },
    "../core/auth": {},
  });
  const setalive = pick(modules, "setalive");
  const alive = pick(modules, "alive");
  const message = { async sendReply(value) { events.push(value); } };
  await setalive(message, [".setalive New status", "New status"]);
  await alive(message, [".alive", ""]);
  assert.equal(events.at(-1), "New status");
  await setalive(message, [".setalive get", "get"]);
  assert.match(events.at(-1), /Current Alive Message:\*\n\nNew status/);
  await setalive(message, [".setalive del", "del"]);
  await alive(message, [".alive", ""]);
  assert.equal(events.at(-1), "I'm alive!");
});

test(".msgs works when replying to a member without any mentions", async () => {
  const result = [];
  const modules = fixture("plugins/message-stats.js", {
    "./utils": { isAdmin: async () => true, mentionjid: () => "" },
    "../config": { ADMIN_ACCESS: false },
    "../core/store": {
      async fetchFromStore() { return [
        { userJid: "member@lid", totalMessages: 3, textMessages: 3, lastMessageAt: new Date(), User: { name: "Member" } },
      ]; },
      getTopUsers: async () => [],
      getGlobalTopUsers: async () => [],
    },
  });
  const message = {
    isGroup: true, fromOwner: true, jid: "room@g.us", sender: "owner@lid",
    reply_message: { jid: "member@lid" },
    // Intentionally no .mention array.
    client: { groupMetadata: async () => ({ participants: [{ id: "member@lid" }] }) },
    async sendReply(value) { result.push(value); },
  };
  await pick(modules, "msgs")(message, [".msgs", ""]);
  assert.match(result.at(-1), /Total msgs: \*3\*/);
});

test(".inactive kick never removes the bot itself, even when the socket uses LID", async () => {
  const removed = [];
  const modules = fixture("plugins/message-stats.js", {
    "./utils": { isAdmin: async () => true, mentionjid: () => "" },
    "../config": { ADMIN_ACCESS: false },
    "../core/store": {
      fetchFromStore: async () => [],
      getTopUsers: async () => [],
      getGlobalTopUsers: async () => [],
    },
  });
  const message = {
    isGroup: true, fromOwner: true, jid: "room@g.us", sender: "owner@lid",
    client: {
      user: { lid: "999:2@lid", id: "123:1@s.whatsapp.net" },
      async groupMetadata() { return { participants: [
        { id: "999@lid", admin: null },
        { id: "admin@lid", admin: "admin" },
        { id: "member@lid", admin: null },
      ] }; },
      async sendMessage() {},
      async groupParticipantsUpdate(jid, members) { removed.push(members[0]); },
    },
    async sendReply(value) { throw new Error("Unexpected error: " + value); },
    async send() {},
  };
  await pick(modules, "inactive")(message, [".inactive 1d kick", "1d kick"]);
  assert.deepEqual(removed, ["member@lid"]);
});

test(".mp4 and .url give clear replies rather than throwing when no media is quoted", async () => {
  const events = [];
  const modules = fixture("plugins/take.js", {
    "./utils": {
      addExif() {}, webp2mp4() {}, addID3() {}, getBuffer() {},
      uploadToImgbb() {}, uploadToCatbox() {},
    },
    "../config": { STICKER_DATA: "pack;author;😂", AUDIO_DATA: "default" },
    "../core/helpers": { getTempPath(name) { return "/tmp/" + name; } },
  });
  const msg = { reply_message: null, async sendReply(txt) { events.push(txt); } };
  await pick(modules, "mp4")(msg, [".mp4", ""]);
  await pick(modules, "url")(msg, [".url", ""]);
  assert.equal(events.length, 2);
  assert.match(events[0], /Reply to an animated sticker/);
  assert.match(events[1], /Reply to an image/);
  const unsupported = { ...msg, reply_message: { text: "text only" } };
  await pick(modules, "url")(unsupported, [".url", ""]);
  assert.match(events.at(-1), /Reply to an image/);
});

function pinterestFixture() {
  const sent = [];
  const modules = fixture("plugins/social.js", {
    "./utils": {
      pinterestDl: async () => ({ status: true, result: "/tmp/photo.jpg" }),
      pinterestSearch: async () => ({ status: true, result: [
        "https://cdn.example/a.jpg", "https://cdn.example/b.jpg",
        "https://cdn.example/c.jpg", "https://cdn.example/d.jpg",
      ] }),
    },
    "../config": { MODE: "public" },
    axios: { get: async () => ({ request: {} }) },
  });
  const message = {
    data: { key: { id: "msg" } },
    jid: "room@g.us",
    reply_message: null,
    client: { albumMessage: async () => { throw new Error("album upload failed"); } },
    async sendMessage(content, kind, opts) { sent.push({ content, kind, opts }); },
    async sendReply(text) { sent.push({ text }); },
  };
  return { sent, message, pinterest: pick(modules, "pinterest") };
}

test(".pinterest sends photo pin links as images rather than videos", async () => {
  const f = pinterestFixture();
  await f.pinterest(f.message, [".pinterest https://pin.it/xYz", "https://pin.it/xYz"]);
  const media = f.sent.find((entry) => entry.kind);
  assert.equal(media.kind, "image");
  assert.equal(media.content.url, "/tmp/photo.jpg");
});

test(".pinterest search only sends requested number of results if album upload fails", async () => {
  const f = pinterestFixture();
  await f.pinterest(f.message, [".pinterest cats,2", "cats,2"]);
  const media = f.sent.filter((entry) => entry.kind === "image");
  assert.equal(media.length, 2);
  assert.deepEqual(media.map((x) => x.content.url), ["https://cdn.example/a.jpg", "https://cdn.example/b.jpg"]);
});
