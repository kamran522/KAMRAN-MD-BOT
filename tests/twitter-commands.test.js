"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const POST_URL = "https://x.com/researcher/status/1990123456789012345";

function setup(mode = "private", fail = false) {
  const calls = [];
  const registered = [];
  const source = fs.readFileSync(path.resolve(__dirname, "../plugins/social.js"), "utf8");
  const module = { exports: {} };
  const { findTwitterUrl } = require("../plugins/utils/twitter");
  vm.runInNewContext(source, {
    module, exports: module.exports, Buffer, URL, console,
    require(name) {
      if (name === "../main") return { Module(meta, handler) { registered.push({ meta, handler }); } };
      if (name === "./utils") return {
        pinterestSearch() {}, downloadGram() {}, pinterestDl() {}, tiktok() {},
        igStalk() {}, fb() {}, story() {},
      };
      if (name === "../config") return { MODE: mode };
      if (name === "axios") return {};
      if (name === "./utils/twitter") return {
        findTwitterUrl,
        async sendTwitterMedia(message, url) {
          if (fail) throw new Error("Login required");
          calls.push({ url });
          await message.sendMessage({ url: "/tmp/video.mp4" }, "video");
          return 1;
        },
        twitterFailureReason(error) { return "Post unavailable: " + error.message; },
      };
      throw new Error("Unexpected import " + name);
    },
  }, { filename: "plugins/social.js", timeout: 10000 });
  function message(reply) {
    return {
      reply_message: reply ? { text: reply } : null,
      async sendMessage(media, kind) { calls.push({ media, kind }); },
      async sendReply(text) { calls.push({ text }); },
    };
  }
  const command = (label) => {
    const found = registered.find(({ meta }) => meta.pattern === label + " ?(.*)");
    assert.ok(found, label + " command must be registered");
    return found;
  };
  return { calls, command, message };
}

test("both .twitter and .x commands are registered with the same public/private permissions as other downloaders", () => {
  const privateSetup = setup("private");
  assert.equal(privateSetup.command("twitter").meta.fromMe, true);
  assert.equal(privateSetup.command("x").meta.fromMe, true);
  const publicSetup = setup("public");
  assert.equal(publicSetup.command("twitter").meta.fromMe, false);
  assert.equal(publicSetup.command("x").meta.fromMe, false);
});

test(".twitter and .x accept direct X and legacy Twitter post links", async () => {
  const f = setup();
  await f.command("twitter").handler(f.message(), [".twitter " + POST_URL, POST_URL]);
  assert.equal(f.calls.find(x => x.url).url, POST_URL);
  const oldUrl = "https://twitter.com/researcher/status/1990123456789012345?ref=copy";
  await f.command("x").handler(f.message(), [".x " + oldUrl, oldUrl]);
  assert.equal(f.calls.filter(x => x.url).at(-1).url, POST_URL);
  assert.equal(f.calls.filter(x => x.kind === "video").length, 2);
});

test(".twitter accepts a post link from a replied message", async () => {
  const f = setup();
  await f.command("twitter").handler(f.message("Look at " + POST_URL), [".twitter", ""]);
  assert.equal(f.calls.find(x => x.url).url, POST_URL);
});

test(".x reports invalid post URLs and download restrictions without crashing the bot", async () => {
  const f = setup("private", true);
  await f.command("x").handler(f.message(), [".x invalid", "invalid"]);
  assert.match(f.calls.at(-1).text, /valid X\/Twitter post URL/);
  await f.command("x").handler(f.message(), [".x " + POST_URL, POST_URL]);
  assert.match(f.calls.at(-1).text, /Post unavailable: Login required/);
});
