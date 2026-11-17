"use strict";

const assert = require("node:assert/strict");
const { test, after } = require("node:test");
const Module = require("node:module");

const originalLoad = Module._load;
const originalEnv = Object.fromEntries(
  ["AI_PROVIDER", "GROQ_API_KEY", "GROQ_MODEL", "LOCAL_AI_URL",
    "LOCAL_AI_MODEL", "LOCAL_AI_API_KEY", "LOCAL_AI_TIMEOUT"]
    .map((name) => [name, process.env[name]])
);
let requests = [];
let respond = async () => ({ data: { choices: [{ message: { content: "OK" } }] } });

Module._load = function (name, parent, isMain) {
  if (name === "axios" && parent?.filename?.endsWith("/plugins/utils/local-ai.js")) {
    return {
      post: async (url, payload, options) => {
        requests.push({ url, payload, options });
        return respond(url, payload, options);
      },
    };
  }
  return originalLoad.apply(this, arguments);
};
const ai = require("../plugins/utils/local-ai");
Module._load = originalLoad;

after(() => {
  for (const [name, value] of Object.entries(originalEnv)) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
});

function reset() {
  requests = [];
  for (const name of Object.keys(originalEnv)) delete process.env[name];
  respond = async () => ({ data: { choices: [{ message: { content: "OK" } }] } });
}

test("Groq uses the official endpoint and bearer key, not the Ollama format", async () => {
  reset();
  process.env.AI_PROVIDER = "groq";
  process.env.GROQ_API_KEY = "test-token-not-a-real-key";
  const answer = await ai.generate({ prompt: "hello", history: [
    { role: "user", content: "earlier" },
    { role: "assistant", content: "answer" },
    { role: "system", content: "untrusted" }
  ] });
  assert.equal(answer, "OK");
  assert.equal(requests.length, 1);
  const { url, payload, options } = requests[0];
  assert.equal(url, "https://api.groq.com/openai/v1/chat/completions");
  assert.equal(payload.model, "openai/gpt-oss-20b");
  assert.deepEqual(payload.messages.map((x) => x.role),
    ["system", "user", "assistant", "user"]);
  assert.equal(options.headers.Authorization, "Bearer test-token-not-a-real-key");
  assert.equal(options.maxRedirects, 0);
  assert.ok(!JSON.stringify(payload).includes("test-token-not-a-real-key"));
  assert.equal(ai.getProvider(), "groq");
  assert.equal(ai.getBaseURL(), "https://api.groq.com/openai/v1");
});

test("A Groq key selects Groq by default without changing commands", async () => {
  reset();
  process.env.GROQ_API_KEY = "test-token";
  await ai.generate({ prompt: "ping" });
  assert.equal(ai.getProvider(), "groq");
  assert.equal(requests[0].payload.model, "openai/gpt-oss-20b");
});

test("Explicit Ollama provider never sends the Groq key to localhost", async () => {
  reset();
  process.env.AI_PROVIDER = "ollama";
  process.env.GROQ_API_KEY = "secret-must-stay-off-localhost";
  respond = async () => ({ data: { message: { content: " Local answer " } } });
  assert.equal(await ai.generate({ prompt: "hello" }), "Local answer");
  assert.equal(requests[0].url, "http://127.0.0.1:11434/api/chat");
  assert.equal(requests[0].payload.options.num_predict, 1024);
  assert.equal(requests[0].options.headers.Authorization, undefined);
});

test("Self-hosted OpenAI-compatible provider uses its own optional key", async () => {
  reset();
  process.env.AI_PROVIDER = "openai-compatible";
  process.env.GROQ_API_KEY = "must-not-be-forwarded";
  process.env.LOCAL_AI_URL = "http://127.0.0.1:8000/v1/";
  process.env.LOCAL_AI_MODEL = "my-served-model";
  process.env.LOCAL_AI_API_KEY = "local-secret";
  assert.equal(await ai.generate({ prompt: "hello" }), "OK");
  assert.equal(requests[0].url, "http://127.0.0.1:8000/v1/chat/completions");
  assert.equal(requests[0].payload.model, "my-served-model");
  assert.equal(requests[0].options.headers.Authorization, "Bearer local-secret");
});

test("Missing Groq key returns a useful error without sending a request", async () => {
  reset();
  process.env.AI_PROVIDER = "groq";
  await assert.rejects(() => ai.generate({ prompt: "hi" }), /GROQ_API_KEY is missing/);
  assert.equal(requests.length, 0);
});

test("Provider error bodies never leak back to WhatsApp", async () => {
  reset();
  process.env.AI_PROVIDER = "groq";
  process.env.GROQ_API_KEY = "secret";
  respond = async () => {
    throw { response: { status: 401, data: { message: "secret-sensitive-detail" } } };
  };
  await assert.rejects(() => ai.generate({ prompt: "hi" }), (err) => {
    assert.match(err.message, /authentication failed/i);
    assert.ok(!err.message.includes("secret-sensitive-detail"));
    return true;
  });
});

test("Invalid provider and empty output are handled", async () => {
  reset();
  process.env.AI_PROVIDER = "unknown";
  await assert.rejects(() => ai.generate({ prompt: "hi" }), /Invalid AI_PROVIDER/);
  process.env.AI_PROVIDER = "groq";
  process.env.GROQ_API_KEY = "test-token";
  respond = async () => ({ data: { choices: [{ message: { content: " " } }] } });
  await assert.rejects(() => ai.generate({ prompt: "hi" }), /empty response/);
});
