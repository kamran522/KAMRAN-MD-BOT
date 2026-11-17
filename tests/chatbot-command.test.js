"use strict";

const assert = require("node:assert/strict");
const { test } = require("node:test");
const Module = require("node:module");

test("WhatsApp .ai deep selects local thinking and long replies are split", async () => {
  const original = Module._load;
  const commands = [];
  const requests = [];
  let reply = "Local answer";
  const fakeAI = {
    generate: async (args) => { requests.push(args); return reply; },
    getModel: () => "qwen3:8b",
    getBaseURL: () => "http://127.0.0.1:11434",
    getRuntimeInfo: () => ({ context: 8192, deepContext: 16384 }),
  };
  Module._load = function (name, parent, isMain) {
    if (parent?.filename?.endsWith("/plugins/chatbot.js")) {
      if (name === "../main") return { Module: (info, fn) => commands.push({ info, fn }) };
      if (name === "../config") return { MODE: "private", HANDLERS: ".", CHATBOT: "" };
      if (name === "./manage") return { setVar: async () => true };
      if (name === "./utils/local-ai") return fakeAI;
    }
    return original.apply(this, arguments);
  };
  try {
    require("../plugins/chatbot");
  } finally {
    Module._load = original;
  }

  const ai = commands.find((cmd) => cmd.info.pattern === "ai ?(.*)");
  assert.ok(ai);
  const replies = [];
  const message = {
    jid: "test@s.whatsapp.net",
    reply_message: null,
    sendReply: async (text) => { replies.push(text); return text; },
  };
  await ai.fn(message, ["", "deep Design a large database"]);
  assert.equal(requests[0].deep, true);
  assert.equal(requests[0].prompt, "Design a large database");
  assert.deepEqual(replies, ["Local answer"]);

  replies.length = 0;
  reply = "X".repeat(7600);
  await ai.fn(message, ["", "ordinary question"]);
  assert.equal(requests[1].deep, false);
  assert.ok(replies.length > 1);
  assert.ok(replies.every((text) => text.length <= 3500));
  assert.equal(replies.join(""), reply);

  replies.length = 0;
  reply = "Quote answer";
  message.reply_message = { text: "Quoted request" };
  await ai.fn(message, ["", "deep"]);
  assert.equal(requests[2].deep, true);
  assert.equal(requests[2].prompt, "Quoted request");
  assert.deepEqual(replies, ["Quote answer"]);

  replies.length = 0;
  const chatbot = commands.find((cmd) => cmd.info.pattern === "chatbot ?(.*)");
  assert.ok(chatbot);
  await chatbot.fn(message, ["", "status"]);
  assert.match(replies[0], /Local Ollama/);
  assert.match(replies[0], /API key: Not required/);
  assert.doesNotMatch(replies[0], /Kimi|Moonshot|Bedrock|GroqCloud/);
});
