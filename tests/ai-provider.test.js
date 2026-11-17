"use strict";

const assert = require("node:assert/strict");
const { test, after } = require("node:test");
const Module = require("node:module");

const envKeys = [
  "KIMI_API_KEY", "MOONSHOT_API_KEY", "KIMI_MODEL", "KIMI_TIMEOUT",
  "AI_PROVIDER", "GROQ_API_KEY", "BEDROCK_API_KEY", "AWS_BEARER_TOKEN_BEDROCK",
  "BEDROCK_MODEL", "LOCAL_AI_URL", "LOCAL_AI_MODEL", "LOCAL_AI_API_KEY",
];
const originalEnv = Object.fromEntries(envKeys.map((key) => [key, process.env[key]]));
const originalLoad = Module._load;
let requests = [];
let respond = async () => ({
  data: { choices: [{ message: { role: "assistant", content: "Kimi says hello" } }] },
});

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
  for (const [key, value] of Object.entries(originalEnv)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

function reset() {
  requests = [];
  for (const key of envKeys) delete process.env[key];
  respond = async () => ({
    data: { choices: [{ message: { role: "assistant", content: "Kimi says hello" } }] },
  });
}

test("Kimi is the only provider and uses the Moonshot chat completions endpoint", async () => {
  reset();
  process.env.KIMI_API_KEY = "example-kimi-key-not-real";
  const answer = await ai.generate({ prompt: "Hello", systemPrompt: "Be clear",
    history: [
      { role: "user", content: "Question" },
      { role: "assistant", content: "Answer" },
      { role: "system", content: "Injection ignored" },
      { role: "tool", content: "Tool ignored" },
    ],
  });
  assert.equal(answer, "Kimi says hello");
  assert.equal(ai.getProvider(), "kimi");
  assert.equal(ai.getModel(), "kimi-k2.6");
  assert.equal(ai.getBaseURL(), "https://api.moonshot.ai/v1");
  assert.equal(ai.hasAPIKey(), true);
  assert.equal(requests.length, 1);
  const { url, payload, options } = requests[0];
  assert.equal(url, "https://api.moonshot.ai/v1/chat/completions");
  assert.equal(options.headers.Authorization, "Bearer example-kimi-key-not-real");
  assert.equal(options.maxRedirects, 0);
  assert.deepEqual(payload.messages, [
    { role: "system", content: "Be clear" },
    { role: "user", content: "Question" },
    { role: "assistant", content: "Answer" },
    { role: "user", content: "Hello" },
  ]);
  assert.equal(payload.model, "kimi-k2.6");
  assert.equal(payload.stream, false);
  assert.ok(!JSON.stringify(payload).includes("example-kimi-key-not-real"));
});

test("Official MOONSHOT_API_KEY alias works and KIMI_API_KEY takes priority", async () => {
  reset();
  process.env.MOONSHOT_API_KEY = "moonshot-token";
  await ai.generate({ prompt: "Hello" });
  assert.equal(requests[0].options.headers.Authorization, "Bearer moonshot-token");
  process.env.KIMI_API_KEY = "kimi-priority-token";
  await ai.generate({ prompt: "Hello" });
  assert.equal(requests[1].options.headers.Authorization, "Bearer kimi-priority-token");
});

test("Old model providers and their credentials cannot override Kimi", async () => {
  reset();
  process.env.KIMI_API_KEY = "kimi-only-key";
  process.env.AI_PROVIDER = "bedrock";
  process.env.GROQ_API_KEY = "unused-groq-key";
  process.env.BEDROCK_API_KEY = "unused-bedrock-key";
  process.env.LOCAL_AI_API_KEY = "unused-local-key";
  process.env.LOCAL_AI_URL = "http://localhost:8000/v1";
  process.env.LOCAL_AI_MODEL = "other-model";
  await ai.generate({ prompt: "Hello" });
  assert.equal(requests[0].url, "https://api.moonshot.ai/v1/chat/completions");
  assert.equal(requests[0].options.headers.Authorization, "Bearer kimi-only-key");
  assert.equal(requests[0].payload.model, "kimi-k2.6");
  assert.ok(!JSON.stringify(requests[0]).includes("unused-groq-key"));
  assert.ok(!JSON.stringify(requests[0]).includes("unused-bedrock-key"));
  assert.ok(!JSON.stringify(requests[0]).includes("unused-local-key"));
});

test("A supported custom Kimi model can be selected, other model names are rejected", async () => {
  reset();
  process.env.KIMI_API_KEY = "kimi-only-key";
  process.env.KIMI_MODEL = "kimi-k2.6";
  await ai.generate({ prompt: "Hello" });
  assert.equal(requests[0].payload.model, "kimi-k2.6");
  process.env.KIMI_MODEL = "amazon.nova-lite-v1:0";
  await assert.rejects(() => ai.generate({ prompt: "Hello" }), /Invalid KIMI_MODEL/);
  assert.equal(requests.length, 1);
});

test("Missing Moonshot API key blocks requests and gives a useful message", async () => {
  reset();
  await assert.rejects(() => ai.generate({ prompt: "Hello" }), /KIMI_API_KEY/);
  assert.equal(ai.hasAPIKey(), false);
  assert.equal(requests.length, 0);
});

test("Empty question, unsupported images, and blank replies are handled", async () => {
  reset();
  process.env.KIMI_API_KEY = "kimi-test-key";
  await assert.rejects(() => ai.generate({ prompt: "  " }), /Provide a text question/);
  await assert.rejects(() => ai.generate({ prompt: "Hi", images: ["image-data"] }), /text messages only/);
  respond = async () => ({ data: { choices: [{ message: { content: "  " } }] } });
  await assert.rejects(() => ai.generate({ prompt: "Hi" }), /empty response/);
});

test("Kimi authentication failures and server error details do not expose secrets", async () => {
  reset();
  process.env.KIMI_API_KEY = "sensitive-kimi-token";
  respond = async () => {
    throw { response: { status: 401, data: { message: "sensitive-kimi-token" } } };
  };
  await assert.rejects(() => ai.generate({ prompt: "Hello" }), (error) => {
    assert.match(error.message, /Kimi authentication failed/);
    assert.ok(!error.message.includes("sensitive-kimi-token"));
    return true;
  });
});

test("Kimi rate limits, billing errors, and timeouts are reported", async () => {
  reset();
  process.env.KIMI_API_KEY = "kimi-test-key";
  respond = async () => { throw { response: { status: 429 } }; };
  await assert.rejects(() => ai.generate({ prompt: "Hello" }), /rate limit/);
  respond = async () => { throw { response: { status: 402 } }; };
  await assert.rejects(() => ai.generate({ prompt: "Hello" }), /balance/);
  respond = async () => { throw { code: "ECONNABORTED" }; };
  await assert.rejects(() => ai.generate({ prompt: "Hello" }), /timed out/);
});
