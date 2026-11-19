"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const root = path.resolve(__dirname, "..");
const desired = "923111008401";

function loadCommandModule(name) {
  const registered = [];
  const module = { exports: {} };
  const config = {
    HANDLERS: ".,", MODE: "private", ADMIN_ACCESS: false,
    settingsMenu: [], AUTODL: "", SUDO: desired,
  };
  const language = new Proxy({}, { get: (_, prop) => String(prop) });
  const sandbox = {
    module, exports: module.exports, Buffer, console, process,
    setTimeout, clearTimeout, setInterval, clearInterval,
    require(request) {
      if (request === "../main") {
        return { Module(meta, handler) { registered.push({ meta, handler }); }, commands: [] };
      }
      if (request === "./utils/lang") return { getString() { return language; } };
      if (request === "../core/helpers") return { loadBaileys: async () => ({ delay: async () => {} }) };
      if (request === "./utils") return {
        isAdmin: async () => false, isNumeric: () => false, mentionjid: () => "",
        filter: {}, groupAdminGuard: async () => true,
      };
      if (request === "../config") return config;
      if (request === "../core/store") return {};
      if (request === "./utils/db/schedulers") return { scheduledMessages: {} };
      if (request === "../core/database") return { BotVariable: {} };
      if (request === "moment") return () => ({});
      if (request === "fs") return fs;
      throw new Error("Unexpected import " + request);
    },
  };
  const filename = path.join(root, name);
  vm.runInNewContext(fs.readFileSync(filename, "utf8"), sandbox, { filename: name, timeout: 10000 });
  return registered;
}

test(".info add displays the requested example phone number", () => {
  const modules = loadCommandModule("plugins/group.js");
  const add = modules.find((entry) => entry.meta.pattern?.startsWith("add "));
  assert.ok(add, "add command must be registered");
  assert.equal(add.meta.usage, ".add " + desired);
  assert.equal(add.meta.usage.includes("919876543210"), false);
  const tag = modules.find((entry) => entry.meta.pattern?.startsWith("tag("));
  assert.match(tag.meta.usage, /<group-id>@g\.us/);
});

test(".schedule validation help uses the same example phone number for phone and LID formats", async () => {
  const modules = loadCommandModule("plugins/schedule.js");
  const schedule = modules.find((entry) => entry.meta.pattern?.startsWith("schedule "));
  assert.ok(schedule);
  let reply;
  const message = {
    reply_message: { text: "test" },
    async sendReply(value) { reply = value; },
  };
  await schedule.handler(message, [".schedule", ""]);
  assert.equal((reply.match(/923111008401/g) || []).length, 3);
  assert.doesNotMatch(reply, /919876543210/);
});

test("anti-delete JID help uses the new phone number and a group ID placeholder", async () => {
  const modules = loadCommandModule("plugins/manage.js");
  const antiDelete = modules.find((entry) => entry.meta.pattern?.startsWith("antidelete "));
  assert.ok(antiDelete);
  let reply;
  await antiDelete.handler({
    jid: desired + "@s.whatsapp.net",
    async sendReply(value) { reply = value; },
  }, [".antidelete invalid@bad-domain", "invalid@bad-domain"]);
  assert.match(reply, /923111008401@s\.whatsapp\.net/);
  assert.match(reply, /<group-id>@g\.us/);
  assert.doesNotMatch(reply, /123020340234/);
});

test("repository contact numbers in notices and default config are consistent", () => {
  for (const name of ["NOTICE.md", "REPORT.md"]) {
    const content = fs.readFileSync(path.join(root, name), "utf8");
    assert.ok(content.includes(desired), name + " should show the current contact number");
    assert.ok(!content.includes("9231118401"), name + " should not show the older contact number");
  }
  const config = fs.readFileSync(path.join(root, "config.js"), "utf8");
  assert.ok(config.includes(desired), "the existing config default must remain unchanged");
});
