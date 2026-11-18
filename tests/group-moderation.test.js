"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const path = require("node:path");
const detector = require("../plugins/utils/link-detector");

const root = path.resolve(__dirname, "..");
function loadModule(filename, imports, extra = {}) {
  const module = { exports: {} };
  const context = {
    module,
    exports: module.exports,
    require(name) {
      if (Object.hasOwn(imports, name)) return imports[name];
      throw new Error("Unexpected import: " + name);
    },
    console, Buffer, URL, setTimeout, clearTimeout, setImmediate, clearImmediate,
    setInterval, clearInterval, process,
    ...extra,
  };
  vm.runInNewContext(fs.readFileSync(path.join(root, filename), "utf8"), context, {
    filename, timeout: 10000,
  });
  return module.exports;
}

function antiFixture() {
  const commands = [];
  const policies = new Map();
  const warnCounts = new Map();
  const calls = [];
  let botAdmin = true;
  const db = {
    async get(jid) { return policies.get(jid) || null; },
    async set(jid, settings) { policies.set(jid, { ...settings }); return policies.get(jid); },
    async update(jid, settings) {
      policies.set(jid, { ...(policies.get(jid) || {}), ...settings });
      return policies.get(jid);
    },
  };
  const utils = {
    antilinkConfig: db,
    linkDetector: detector,
    async isAdmin(m, user) { return user ? user === "admin@lid" : botAdmin; },
    async setWarn(chat, user) {
      const key = chat + ":" + user;
      warnCounts.set(key, (warnCounts.get(key) || 0) + 1);
    },
    async getWarn(chat, user, limit) {
      const current = warnCounts.get(chat + ":" + user) || 0;
      return { current, exceeded: current >= limit };
    },
  };
  const api = loadModule("plugins/antilink.js", {
    "../main": { Module(info, fn) { commands.push({ info, fn }); } },
    "../config": { ADMIN_ACCESS: true, WARN: "2" },
    "./utils": utils,
  });
  function msg(sender = "member@lid", content = "See https://example.com") {
    return {
      isGroup: true, fromOwner: false, fromMe: false,
      jid: "group@g.us", sender,
      data: { key: { remoteJid: "group@g.us", id: "message-1", fromMe: false }, message: { conversation: content } },
      client: {
        user: { id: "123@s.whatsapp.net", lid: "123@lid" },
        async sendMessage(jid, payload) { calls.push({ type: "message", jid, payload }); },
        async groupParticipantsUpdate(jid, members, action) { calls.push({ type: "participants", jid, members, action }); },
      },
      async sendReply(text) { calls.push({ type: "reply", text }); },
    };
  }
  const command = commands.find((c) => c.info.pattern && c.info.pattern.startsWith("antilink"));
  const listener = commands.find((c) => c.info.on === "message");
  assert.ok(command, "antilink command registered");
  assert.ok(listener, "automatic link handler registered");
  return {
    api, policies, warnCounts, calls, command, listener, msg,
    setBotAdmin(value) { botAdmin = value; },
    async sendCommand(action, message = msg()) {
      message.fromOwner = true;
      return command.fn(message, [".antilink " + action, action]);
    },
  };
}

test("anti-link domain matching is exact and covers subdomains", () => {
  const f = antiFixture();
  assert.equal(f.api.parseDomains("https://www.Example.com/path, second.net"), "example.com,second.net");
  assert.equal(f.api.parseDomains("bad host"), null);
  assert.equal(f.api.isBlocked("https://example.com/something", { isWhitelist: true, allowedLinks: "example.com" }), false);
  assert.equal(f.api.isBlocked("https://sub.example.com", { isWhitelist: true, allowedLinks: "example.com" }), false);
  assert.equal(f.api.isBlocked("https://notexample.com", { isWhitelist: true, allowedLinks: "example.com" }), true);
  assert.equal(f.api.isBlocked("https://example.com", { isWhitelist: false, blockedLinks: "example.com" }), true);
  assert.equal(f.api.isBlocked("https://example.net", { isWhitelist: false, blockedLinks: "example.com" }), false);
});

test("anti-link on blocks posted links and ignores non-links, admins and owners", async () => {
  const f = antiFixture();
  await f.sendCommand("on");
  assert.equal(f.policies.get("group@g.us").enabled, true);
  const m = f.msg();
  await f.listener.fn(m);
  assert.equal(f.calls.filter((c) => c.payload?.delete).length, 1);
  await f.listener.fn(f.msg("admin@lid"));
  await f.listener.fn(f.msg("member@lid", "A normal message"));
  const owner = f.msg();
  owner.fromOwner = true;
  await f.listener.fn(owner);
  assert.equal(f.calls.filter((c) => c.payload?.delete).length, 1);
});

test("allowlist and blocklist policies enforce the chosen domains", async () => {
  const f = antiFixture();
  await f.sendCommand("allow youtube.com");
  await f.listener.fn(f.msg("member@lid", "https://youtu.be/video"));
  assert.equal(f.calls.filter((c) => c.payload?.delete).length, 1);
  await f.listener.fn(f.msg("member@lid", "https://youtube.com/watch?v=123"));
  assert.equal(f.calls.filter((c) => c.payload?.delete).length, 1);
  await f.sendCommand("block example.com");
  await f.listener.fn(f.msg("member@lid", "https://youtube.com/watch?v=123"));
  assert.equal(f.calls.filter((c) => c.payload?.delete).length, 1);
  await f.listener.fn(f.msg("member@lid", "https://example.com"));
  assert.equal(f.calls.filter((c) => c.payload?.delete).length, 2);
});

test("warn mode tracks warnings and removes members at configured limit", async () => {
  const f = antiFixture();
  await f.sendCommand("warn");
  await f.listener.fn(f.msg());
  await f.listener.fn(f.msg());
  assert.equal(f.calls.filter((c) => c.payload?.delete).length, 2);
  assert.equal(f.calls.filter((c) => c.type === "participants" && c.action === "remove").length, 1);
  await f.sendCommand("off");
  await f.listener.fn(f.msg());
  assert.equal(f.calls.filter((c) => c.payload?.delete).length, 2);
});

test("anti-link cannot be enabled without bot group admin rights", async () => {
  const f = antiFixture();
  f.setBotAdmin(false);
  await f.sendCommand("on");
  assert.equal(f.policies.size, 0);
  assert.match(f.calls.at(-1).text, /group admin/i);
});

test("group-update normalizes string participants to objects", () => {
  class Base { constructor(client) { this.client = client; } _patch() { return this; } }
  const GroupUpdate = loadModule("core/constructors/group-update.js", { "./base": Base });
  const obj = new GroupUpdate({}, {
    id: "group@g.us", action: "add", participants: ["123@lid", { id: "456@lid" }],
  });
  assert.equal(obj.participant[0].id, "123@lid");
  assert.equal(obj.participant[1].id, "456@lid");
});

test("group admin check uses exact IDs and supports both LID and phone JIDs", async () => {
  const misc = loadModule("plugins/utils/misc.js", {
    fs: {},
    "../../config": {},
    "../../core/helpers": {},
    "google-tts-api": {},
    "../../core/services": {},
  });
  const m = {
    jid: "group@g.us",
    client: {
      user: { id: "222:1@s.whatsapp.net", lid: "999:2@lid" },
      async groupMetadata() {
        return { participants: [
          { id: "999@lid", admin: "admin" },
          { id: "333@lid", phoneNumber: "333@s.whatsapp.net", admin: "admin" },
          { id: "33311@lid", admin: null },
        ] };
      },
    },
  };
  assert.equal(await misc.isAdmin(m), true);
  assert.equal(await misc.isAdmin(m, "333:6@s.whatsapp.net"), true);
  assert.equal(await misc.isAdmin(m, "33311@lid"), false);
  assert.equal(await misc.isAdmin(m, "3331@lid"), false);
});

test("unmute-only schedules are registered even without automute", async () => {
  const cronNames = [];
  const schedule = loadModule("core/schedulers.js", {
    "../config": { ALWAYS_ONLINE: false, SUDO: "" },
    "node-cron": {
      schedule(expression) {
        cronNames.push(expression);
        return { start() {}, destroy() {} };
      },
    },
    "../plugins/utils/db/schedulers": {
      automute: { async get() { return []; } },
      autounmute: { async get() { return [{ dataValues: { chat: "group@g.us", time: "08 15" } }]; } },
      scheduledMessages: { async getAllPending() { return []; } },
    },
    "../package.json": { version: "7" },
  }, {
    setInterval() { return { unref() {} }; },
    setImmediate(fn) { fn(); },
  });
  await schedule({ user: { id: "bot" } }, "session");
  assert.ok(cronNames.includes("15 08 * * *"), "unmute-only task registered");
  await schedule.cleanup();
});
