"use strict";

const assert = require("node:assert/strict");
const { test, after } = require("node:test");
const Module = require("node:module");

const envNames = [
  "LOCAL_AI_URL", "LOCAL_AI_MODEL", "LOCAL_AI_TIMEOUT",
  "LOCAL_AI_DEEP_TIMEOUT", "LOCAL_AI_CONTEXT", "LOCAL_AI_DEEP_CONTEXT",
  "LOCAL_AI_NUM_PREDICT", "LOCAL_AI_DEEP_NUM_PREDICT",
  "LOCAL_AI_MAX_PENDING", "LOCAL_AI_KEEP_ALIVE",
  "LOCAL_AI_FAST_MODEL", "LOCAL_AI_DEEP_MODEL", "LOCAL_AI_FAST_CONTEXT",
  "LOCAL_AI_FAST_NUM_PREDICT", "LOCAL_AI_FAST_HISTORY", "LOCAL_AI_DEEP_KEEP_ALIVE",
  "KIMI_API_KEY", "MOONSHOT_API_KEY", "KIMI_MODEL", "AI_PROVIDER",
  "GROQ_API_KEY", "BEDROCK_API_KEY",
];
const savedEnv = Object.fromEntries(envNames.map((key) => [key, process.env[key]]));
const oldLoad = Module._load;
let calls = [];
let respond = async () => ({ data: { message: { role: "assistant", content: "Local answer" } } });

Module._load = function (name, parent, isMain) {
  if (name === "axios" && parent?.filename?.endsWith("/plugins/utils/local-ai.js")) {
    return {
      post: async (url, payload, options) => {
        calls.push({ url, payload, options });
        return respond(url, payload, options);
      },
    };
  }
  return oldLoad.apply(this, arguments);
};
const ai = require("../plugins/utils/local-ai");
Module._load = oldLoad;

after(() => {
  for (const [key, value] of Object.entries(savedEnv)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

function reset() {
  calls = [];
  for (const key of envNames) delete process.env[key];
  respond = async () => ({ data: { message: { role: "assistant", content: "Local answer" } } });
}

test("Ollama is the only provider; no API key or hosted endpoint is used", async () => {
  reset();
  process.env.AI_PROVIDER = "kimi";
  process.env.KIMI_API_KEY = "not-used-secret";
  process.env.GROQ_API_KEY = "unused-groq";
  process.env.BEDROCK_API_KEY = "unused-bedrock";
  assert.equal(await ai.generate({ prompt: "Hello", systemPrompt: "Be accurate",
    history: [
      { role: "user", content: "Earlier" },
      { role: "assistant", content: "Previous" },
      { role: "system", content: "Untrusted" },
    ],
  }), "Local answer");
  assert.equal(ai.getProvider(), "ollama");
  assert.equal(ai.getModel(), "qwen3:1.7b");
  assert.equal(ai.getDeepModel(), "qwen3:8b");
  assert.equal(ai.getBaseURL(), "http://127.0.0.1:11434");
  assert.equal(calls[0].url, "http://127.0.0.1:11434/api/chat");
  assert.equal(calls[0].options.headers.Authorization, undefined);
  assert.equal(calls[0].options.maxRedirects, 0);
  assert.deepEqual(calls[0].payload.messages, [
    { role: "system", content: "Be accurate" },
    { role: "user", content: "Earlier" },
    { role: "assistant", content: "Previous" },
    { role: "user", content: "Hello" },
  ]);
  assert.equal(calls[0].payload.stream, false);
  assert.equal(calls[0].payload.think, false);
  assert.equal(calls[0].payload.keep_alive, "30m");
  assert.equal(calls[0].payload.model, "qwen3:1.7b");
  assert.deepEqual(calls[0].payload.options, {
    num_ctx: 2048, num_predict: 512, temperature: 0.6, top_p: 0.95,
  });
  for (const token of ["not-used-secret", "unused-groq", "unused-bedrock"]) {
    assert.ok(!JSON.stringify(calls[0]).includes(token));
  }
});

test("Deep mode uses local reasoning and a larger context/output budget", async () => {
  reset();
  process.env.LOCAL_AI_MODEL = "qwen3:32b";
  process.env.LOCAL_AI_FAST_CONTEXT = "4096";
  process.env.LOCAL_AI_DEEP_CONTEXT = "32768";
  process.env.LOCAL_AI_FAST_NUM_PREDICT = "1024";
  process.env.LOCAL_AI_DEEP_NUM_PREDICT = "10000";
  process.env.LOCAL_AI_DEEP_TIMEOUT = "1200000";
  assert.equal(await ai.generate({ prompt: "Solve this", deep: true }), "Local answer");
  const call = calls[0];
  assert.equal(call.payload.model, "qwen3:32b");
  assert.equal(call.payload.keep_alive, "0");
  assert.equal(call.payload.think, true);
  assert.equal(call.payload.options.num_ctx, 32768);
  assert.equal(call.payload.options.num_predict, 10000);
  assert.equal(call.options.timeout, 1200000);
  assert.equal(ai.getRuntimeInfo().context, 4096);
  assert.equal(ai.getRuntimeInfo().deepContext, 32768);
});

test("Local server URLs accept localhost, RFC1918 LAN, and Docker service names", async () => {
  reset();
  for (const url of [
    "http://localhost:11434", "http://192.168.1.10:11434",
    "http://10.0.0.5:11434", "http://172.20.0.2:11434",
    "http://host.docker.internal:11434", "http://ollama:11434",
  ]) {
    process.env.LOCAL_AI_URL = url;
    assert.equal(await ai.generate({ prompt: "Hello" }), "Local answer");
    assert.equal(calls[calls.length - 1].url, url + "/api/chat");
  }
});

test("Public URLs, unsafe endpoints, and embedded credentials are rejected", async () => {
  reset();
  for (const url of [
    "https://api.moonshot.ai/v1", "http://8.8.8.8:11434",
    "http://169.254.169.254:80", "http://user:pass@127.0.0.1:11434",
    "http://127.0.0.1:11434/other",
  ]) {
    process.env.LOCAL_AI_URL = url;
    await assert.rejects(() => ai.generate({ prompt: "Hello" }), /LOCAL_AI_URL/);
  }
  assert.equal(calls.length, 0);
});

test("Missing Ollama model returns helpful pull command, without leaking response data", async () => {
  reset();
  respond = async () => { throw { response: { status: 404, data: { message: "secret-in-error" } } }; };
  await assert.rejects(() => ai.generate({ prompt: "Hello" }), (error) => {
    assert.match(error.message, /ollama pull qwen3:1.7b/i);
    assert.ok(!error.message.includes("secret-in-error"));
    return true;
  });
});

test("Unavailable Ollama server and out-of-memory errors have useful messages", async () => {
  reset();
  respond = async () => { throw { code: "ECONNREFUSED" }; };
  await assert.rejects(() => ai.generate({ prompt: "Hello" }), /Cannot reach Ollama/);
  respond = async () => { throw { response: { status: 500 } }; };
  await assert.rejects(() => ai.generate({ prompt: "Hello", deep: true }), /RAM\/VRAM/);
});

test("Thinking is not exposed as the answer and empty final output is reported", async () => {
  reset();
  respond = async () => ({
    data: { message: { role: "assistant", thinking: "private intermediate reasoning", content: "Final result" } },
  });
  assert.equal(await ai.generate({ prompt: "Hello", deep: true }), "Final result");
  respond = async () => ({
    data: { message: { role: "assistant", thinking: "only thinking", content: "" } },
  });
  await assert.rejects(() => ai.generate({ prompt: "Hello", deep: true }), /no final answer/);
});

test("Queue is bounded when many chats ask difficult questions simultaneously", async () => {
  reset();
  process.env.LOCAL_AI_MAX_PENDING = "1";
  let finish;
  respond = () => new Promise((resolve) => { finish = resolve; });
  const first = ai.generate({ prompt: "First" });
  await new Promise((resolve) => setImmediate(resolve));
  await assert.rejects(() => ai.generate({ prompt: "Second" }), /Local AI is busy/);
  finish({ data: { message: { content: "Complete" } } });
  assert.equal(await first, "Complete");
  assert.equal(calls.length, 1);
});

test("Validates empty questions, unsupported images and model names", async () => {
  reset();
  await assert.rejects(() => ai.generate({ prompt: " " }), /text question/);
  await assert.rejects(() => ai.generate({ prompt: "Question", images: ["data"] }), /text only/);
  process.env.LOCAL_AI_FAST_MODEL = "other-model ; dangerous";
  await assert.rejects(() => ai.generate({ prompt: "Question" }), /Invalid LOCAL_AI_FAST_MODEL/);
});


test("Fast mode uses a lightweight model; old LOCAL_AI_MODEL affects deep only", async () => {
  reset();
  process.env.LOCAL_AI_MODEL = "qwen3:14b";
  await ai.generate({ prompt: "quick" });
  await ai.generate({ prompt: "complex", deep: true });
  assert.equal(calls[0].payload.model, "qwen3:1.7b");
  assert.equal(calls[0].payload.think, false);
  assert.equal(calls[0].payload.options.num_predict, 512);
  assert.equal(calls[1].payload.model, "qwen3:14b");
  assert.equal(calls[1].payload.think, true);
  assert.equal(ai.getDeepModel(), "qwen3:14b");
});

test("Fast and deep models can be chosen independently", async () => {
  reset();
  process.env.LOCAL_AI_FAST_MODEL = "qwen3:4b";
  process.env.LOCAL_AI_DEEP_MODEL = "qwen3:8b";
  process.env.LOCAL_AI_FAST_NUM_PREDICT = "256";
  process.env.LOCAL_AI_FAST_CONTEXT = "1024";
  await ai.generate({ prompt: "fast question" });
  assert.equal(calls[0].payload.model, "qwen3:4b");
  assert.equal(calls[0].payload.options.num_ctx, 1024);
  assert.equal(calls[0].payload.options.num_predict, 256);
  await ai.generate({ prompt: "hard question", deep: true });
  assert.equal(calls[1].payload.model, "qwen3:8b");
  assert.equal(calls[1].payload.options.num_ctx, 16384);
  assert.equal(calls[1].payload.options.num_predict, 8192);
});

test("Fast replies carry only limited recent chat history", async () => {
  reset();
  const history = Array.from({ length: 10 }, (_, i) => ({
    role: i % 2 ? "assistant" : "user",
    content: "Earlier " + i + " " + "x".repeat(2000),
  }));
  await ai.generate({ prompt: "answer", history });
  const quick = calls[0].payload.messages;
  assert.equal(quick.length, 6);
  assert.ok(quick.slice(1, -1).every(item => item.content.length <= 1600));
  await ai.generate({ prompt: "answer", history, deep: true });
  assert.equal(calls[1].payload.messages.length, 12);
  process.env.LOCAL_AI_FAST_HISTORY = "0";
  await ai.generate({ prompt: "answer", history });
  assert.equal(calls[2].payload.messages.length, 2);
});

test("Missing deep model error tells operator what to install", async () => {
  reset();
  respond = async () => { throw { response: { status: 404 } }; };
  await assert.rejects(() => ai.generate({ prompt: "difficult", deep: true }),
    /ollama pull qwen3:8b/);
});
