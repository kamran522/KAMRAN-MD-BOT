"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { test } = require("node:test");

const repoRoot = path.resolve(__dirname, "..");

function loadUptimeCommands(seconds) {
  const registered = [];
  const filename = path.join(repoRoot, "plugins/test.js");
  const module = { exports: {} };
  vm.runInNewContext(fs.readFileSync(filename, "utf8"), {
    module, exports: module.exports,
    process: { uptime() { return seconds; }, hrtime: process.hrtime },
    require(name) {
      if (name === "../main") return {
        Module(meta, handler) { registered.push({ meta, handler }); },
      };
      throw new Error("Unexpected dependency: " + name);
    },
  }, { filename, timeout: 10000 });
  return registered;
}

test(".uptime is registered and reports the current process uptime", async () => {
  const commands = loadUptimeCommands(3661);
  const uptime = commands.find((cmd) => cmd.meta.pattern === "uptime");
  assert.ok(uptime, "the .uptime command should be registered");
  assert.equal(uptime.meta.usage, ".uptime");
  let reply = "";
  await uptime.handler({ async sendReply(value) { reply = value; } }, [".uptime", ""]);
  assert.match(reply, /Bot uptime/);
  assert.match(reply, /1 hour/);
  assert.match(reply, /1 minute/);
  assert.match(reply, /1 second/);
});

test(".uptime handles a freshly started bot without returning a blank value", async () => {
  const uptime = loadUptimeCommands(0).find((cmd) => cmd.meta.pattern === "uptime");
  let reply;
  await uptime.handler({ async sendReply(value) { reply = value; } });
  assert.match(reply, /0 seconds/);
});

function loadSettings() {
  const registered = [];
  const stored = [];
  const config = {
    HANDLERS: ".",
    settingsMenu: [
      { title: "Auto read all messages", env_var: "READ_MESSAGES" },
      { title: "Auto read status updates", env_var: "AUTO_READ_STATUS" },
      { title: "Auto reject calls", env_var: "REJECT_CALLS" },
    ],
    READ_MESSAGES: false,
    AUTO_READ_STATUS: false,
    REJECT_CALLS: false,
    loadFromDB(values) {
      for (const [key, value] of Object.entries(values)) {
        this[key] = value === "true" ? true : value === "false" ? false : value;
      }
    },
  };
  const module = { exports: {} };
  const filename = path.join(repoRoot, "plugins/manage.js");
  vm.runInNewContext(fs.readFileSync(filename, "utf8"), {
    module, exports: module.exports, process, Buffer, console,
    require(name) {
      if (name === "../main") {
        return { Module(meta, handler) { registered.push({ meta, handler }); } };
      }
      if (name === "../config") return config;
      if (name === "./utils") return {
        filter: {}, groupAdminGuard: async () => true,
      };
      if (name === "../core/database") {
        return {
          BotVariable: {
            async upsert(record) { stored.push(record); },
            async destroy() { return 1; },
          },
        };
      }
      if (name === "fs") return fs;
      throw new Error("Unexpected import: " + name);
    },
  }, { filename, timeout: 15000 });
  return { commands: registered, settings: module.exports, stored, config };
}

test(".settings menu replies select options and persist ON/OFF immediately", async () => {
  const f = loadSettings();
  const replies = [];
  const message = (text, quotedText, fromOwner = true) => ({
    fromOwner,
    message: text,
    reply_message: quotedText ? { text: quotedText } : false,
    async sendReply(value) { replies.push(value); },
  });
  const settingsCommand = f.commands.find(({ meta }) => meta.pattern?.startsWith("settings "));
  assert.ok(settingsCommand);
  await settingsCommand.handler(message("", ""), [".settings", ""]);
  const menu = replies.at(-1);
  assert.match(menu, /Settings configuration menu/);

  // Quote the menu, then choose the auto-status-read option (2).
  assert.equal(await f.settings.handleSettingsReply(message("2", menu)), true);
  const panel = replies.at(-1);
  assert.match(panel, /Auto read status updates/);
  assert.match(panel, /1\. ON/);
  assert.match(panel, /2\. OFF/);

  // The quoted message may have no key/participant information on linked devices.
  assert.equal(await f.settings.handleSettingsReply(message("1", panel)), true);
  assert.equal(f.config.AUTO_READ_STATUS, true);
  assert.equal(f.stored.at(-1).key, "AUTO_READ_STATUS");
  assert.equal(f.stored.at(-1).value, "true");
  assert.match(replies.at(-1), /Auto read status updates set to true/);

  assert.equal(await f.settings.handleSettingsReply(message("2", panel)), true);
  assert.equal(f.config.AUTO_READ_STATUS, false);
  assert.equal(f.stored.at(-1).value, "false");
});

test(".settings ignores other users and unrelated numeric replies such as YouTube quality", async () => {
  const f = loadSettings();
  const sent = [];
  const reply = (message, quote, fromOwner = true) => ({
    fromOwner, message, reply_message: { text: quote },
    async sendReply(value) { sent.push(value); },
  });
  assert.equal(
    await f.settings.handleSettingsReply(reply("1", "_*Auto read status updates*_\n_Now:_ OFF ❌\n\n1. ON\n2. OFF", false)),
    false
  );
  assert.equal(await f.settings.handleSettingsReply(reply("6", "Select Video Quality\n6. 144p")), false);
  assert.equal(await f.settings.handleSettingsReply(reply("1", "Select Video Quality\n1. 1080p")), false);
  assert.equal(await f.settings.handleSettingsReply(reply("not a number", "Settings configuration menu")), false);
  assert.equal(f.stored.length, 0);
  assert.equal(sent.length, 0);
});

test("the real message handler routes settings replies before generic text listeners", async () => {
  const registered = [];
  const main = { commands: [{
    on: "text", fromMe: false, function() { registered.push("ordinary text watcher"); },
  }] };
  const saved = [];
  const syncModel = () => ({ async sync() {} });
  const settings = [];
  const config = {
    READ_MESSAGES: false,
    READ_COMMAND: false,
    AUTO_READ_STATUS: false,
    BLOCK_CHAT: "",
    RG: "",
    PM_ANTISPAM: false,
    PMB_VAR: false,
    DIS_PM: false,
    ANTISPAM_COUNT: "5/60",
    sequelize: syncModel(),
    async loadFromDB() {},
  };
  const store = {
    storeMessage: async (msg) => { saved.push(msg); },
    trackSpamMessage: async () => {},
    getRecentMessageCount: async () => 0,
    ensureFullContentColumnExists: async () => {},
    Chat: syncModel(), User: syncModel(), UserStats: syncModel(),
    SpamTracker: syncModel(), AntiDeleteCache: syncModel(),
  };
  const schedulers = {
    stickcmd: { get: async () => [] },
    AutoMuteDB: syncModel(), AutoUnMuteDB: syncModel(),
    StickyCmdDB: syncModel(), ScheduledMessageDB: syncModel(),
  };
  const senderMessage = class Message {
    constructor(client, data) {
      this.message = data.message.extendedTextMessage.text;
      this.fromOwner = data.key.fromMe;
    }
  };
  const fakeRequire = (name) => {
    if (name === "../config") return config;
    if (name === "fs") return { readdirSync() { return []; } };
    if (name === "path") return path;
    if (name === "../core/database") return {
      BotVariable: {
        async sync() {}, async findAll() { return []; },
      },
    };
    if (name === "./constructors") return {
      Message: senderMessage, Image: senderMessage, Video: senderMessage,
      GroupUpdate: class {},
    };
    if (name === "../plugins/utils") return {
      antibot: { get: async () => [] }, antispam: { get: async () => [] },
    };
    if (name === "../plugins/utils/db/schedulers") return schedulers;
    if (name === "../core/store") return store;
    if (name === "../plugins/utils/db/functions") return {
      filter: { async checkMatch() { return null; } },
    };
    if (name === "./sudo") return {
      getSudoMap() { return []; }, getSudoList() { return []; },
      isSudo() { return false; },
    };
    if (name === "../main") return main;
    if (name === "../plugins/manage") return {
      async handleSettingsReply(message) {
        settings.push(message.message);
        return true;
      },
    };
    throw new Error("Unexpected handler import " + name);
  };
  const module = { exports: {} };
  const filename = path.join(repoRoot, "core/handler.js");
  vm.runInNewContext(fs.readFileSync(filename, "utf8"), {
    module, exports: module.exports, require: fakeRequire,
    console, process, setTimeout, clearTimeout, Buffer,
  }, { filename, timeout: 15000 });

  const message = {
    key: { remoteJid: "owner@s.whatsapp.net", id: "message-1", fromMe: true },
    message: {
      extendedTextMessage: {
        text: "1",
        contextInfo: {
          quotedMessage: { conversation: "*_Settings configuration menu_*" },
          stanzaId: "settings-menu-1",
        },
      },
    },
  };
  const client = { user: { lid: "12345:1@lid" } };
  await module.exports.handler({ type: "notify", messages: [message] }, client);
  assert.deepEqual(settings, ["1"]);
  assert.equal(registered.length, 0, "settings replies must not reach generic text watchers");
  assert.equal(saved.length, 1);
});

const { readIncomingStatuses } = require("../core/status-reader");

function status(id, participant, extra = {}) {
  return { key: {
    remoteJid: "status@broadcast", id, ...(participant ? { participant } : {}), ...extra,
  }, message: { extendedTextMessage: { text: "Status text" } } };
}

test("auto status read uses the posting member JID, including alternate addressing", async () => {
  const sent = [];
  const client = { async readMessages(keys) { sent.push(...keys); } };
  const count = await readIncomingStatuses({
    type: "notify",
    messages: [
      status("a", "poster1@lid"),
      status("b", null, { participantAlt: "poster2@s.whatsapp.net" }),
      status("c", null, { remoteJidAlt: "poster3@lid" }),
      status("self", "me@lid", { fromMe: true }),
      { key: { remoteJid: "chat@g.us", id: "x" }, message: { conversation: "Hi" } },
    ],
  }, client, { AUTO_READ_STATUS: true });
  assert.equal(count, 3);
  assert.deepEqual(sent.map((key) => key.participant), [
    "poster1@lid", "poster2@s.whatsapp.net", "poster3@lid",
  ]);
  assert.ok(sent.every((key) => key.remoteJid === "status@broadcast" && key.fromMe === false));
});

test("auto status read works for append batches and respects the OFF setting", async () => {
  const sent = [];
  const client = { async readMessages(keys) { sent.push(...keys); } };
  const batch = { type: "append", messages: [status("test", "poster@lid")] };
  assert.equal(await readIncomingStatuses(batch, client, { AUTO_READ_STATUS: false }), 0);
  assert.equal(sent.length, 0);
  assert.equal(await readIncomingStatuses(batch, client, { AUTO_READ_STATUS: "true" }), 1);
  assert.equal(sent.length, 1);
});

test("a bad status does not stop other status receipts or message processing", async () => {
  const sent = [];
  const warnings = [];
  const client = {
    async readMessages(keys) {
      sent.push(...keys);
      if (keys[0].id === "bad") throw new Error("server read receipt failed");
    },
  };
  const count = await readIncomingStatuses({
    type: "notify",
    messages: [status("missing", null), status("bad", "poster@lid"), status("good", "other@lid")],
  }, client, { AUTO_READ_STATUS: true }, { warn(...args) { warnings.push(args); } });
  assert.equal(count, 1);
  assert.deepEqual(sent.map((key) => key.id), ["bad", "good"]);
  assert.equal(warnings.length, 2);
});
