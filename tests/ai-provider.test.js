"use strict";

const assert = require("node:assert/strict");
const { test, after } = require("node:test");
const Module = require("node:module");

const originalLoad = Module._load;
const originalEnv = Object.fromEntries(
  ["AI_PROVIDER", "GROQ_API_KEY", "GROQ_MODEL", "LOCAL_AI_URL",
    "LOCAL_AI_MODEL", "LOCAL_AI_API_KEY", "LOCAL_AI_TIMEOUT",
    "BEDROCK_API_KEY", "AWS_BEARER_TOKEN_BEDROCK",
    "BEDROCK_REGION", "AWS_REGION", "BEDROCK_MODEL"]
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


test("Bedrock Converse sends bearer key, model, system and message history", async () => {
  reset();
  process.env.AI_PROVIDER = "bedrock";
  process.env.BEDROCK_API_KEY = "bedrock-mock-key";
  process.env.BEDROCK_REGION = "us-east-1";
  respond = async () => ({ data: { output: {
    message: { content: [{ text: "Part one" }, { text: "part two" }] },
  } } });
  assert.equal(await ai.generate({
    prompt: "Now", systemPrompt: "Be precise", history: [
      { role: "user", content: "Before" },
      { role: "assistant", content: "Reply" },
      { role: "system", content: "Not allowed" },
    ],
  }), "Part one\npart two");
  assert.equal(ai.getProvider(), "bedrock");
  assert.equal(ai.getBaseURL(), "https://bedrock-runtime.us-east-1.amazonaws.com");
  assert.equal(ai.getModel(), "amazon.nova-lite-v1:0");
  assert.equal(requests[0].url,
    "https://bedrock-runtime.us-east-1.amazonaws.com/model/amazon.nova-lite-v1:0/converse");
  assert.equal(requests[0].options.headers.Authorization, "Bearer bedrock-mock-key");
  assert.equal(requests[0].options.maxRedirects, 0);
  assert.deepEqual(requests[0].payload.system, [{ text: "Be precise" }]);
  assert.deepEqual(requests[0].payload.messages, [
    { role: "user", content: [{ text: "Before" }] },
    { role: "assistant", content: [{ text: "Reply" }] },
    { role: "user", content: [{ text: "Now" }] },
  ]);
  assert.equal(requests[0].payload.inferenceConfig.maxTokens, 1024);
  assert.ok(!JSON.stringify(requests[0].payload).includes("bedrock-mock-key"));
});

test("Bedrock supports official AWS token environment, custom Region and model", async () => {
  reset();
  process.env.AI_PROVIDER = "amazon-bedrock";
  process.env.AWS_BEARER_TOKEN_BEDROCK = "aws-mock-token";
  process.env.AWS_REGION = "eu-west-1";
  process.env.BEDROCK_MODEL = "eu.amazon.nova-lite-v1:0";
  respond = async () => ({ data: { output: {
    message: { content: [{ text: "AWS response" }] },
  } } });
  assert.equal(await ai.generate({ prompt: "Hi" }), "AWS response");
  assert.equal(requests[0].url,
    "https://bedrock-runtime.eu-west-1.amazonaws.com/model/eu.amazon.nova-lite-v1:0/converse");
  assert.equal(requests[0].options.headers.Authorization, "Bearer aws-mock-token");
});

test("Bedrock token never leaks to another provider", async () => {
  reset();
  process.env.GROQ_API_KEY = "groq-key";
  process.env.BEDROCK_API_KEY = "bedrock-secret";
  await ai.generate({ prompt: "Hi" });
  assert.equal(ai.getProvider(), "groq");
  assert.equal(requests[0].options.headers.Authorization, "Bearer groq-key");

  reset();
  process.env.AI_PROVIDER = "ollama";
  process.env.BEDROCK_API_KEY = "bedrock-secret";
  respond = async () => ({ data: { message: { content: "Local" } } });
  assert.equal(await ai.generate({ prompt: "Hi" }), "Local");
  assert.equal(requests[0].options.headers.Authorization, undefined);

  reset();
  process.env.AI_PROVIDER = "openai-compatible";
  process.env.BEDROCK_API_KEY = "bedrock-secret";
  await ai.generate({ prompt: "Hi" });
  assert.equal(requests[0].options.headers.Authorization, undefined);
});

test("Bedrock selects automatically when no Groq key is present", async () => {
  reset();
  process.env.BEDROCK_API_KEY = "mock-token";
  respond = async () => ({ data: { output: {
    message: { content: [{ text: "Automatic" }] },
  } } });
  assert.equal(await ai.generate({ prompt: "Hi" }), "Automatic");
  assert.equal(ai.getProvider(), "bedrock");
});

test("Missing Bedrock key and malformed Region fail before network requests", async () => {
  reset();
  process.env.AI_PROVIDER = "bedrock";
  await assert.rejects(() => ai.generate({ prompt: "Hi" }), /BEDROCK_API_KEY/);
  assert.equal(requests.length, 0);

  process.env.BEDROCK_API_KEY = "mock-token";
  process.env.BEDROCK_REGION = "us-east-1.evil.example";
  await assert.rejects(() => ai.generate({ prompt: "Hi" }), /Invalid BEDROCK_REGION/);
  assert.equal(requests.length, 0);
});

test("Bedrock errors are sanitized before reaching the user", async () => {
  reset();
  process.env.AI_PROVIDER = "bedrock";
  process.env.BEDROCK_API_KEY = "sensitive-token";
  respond = async () => {
    throw { response: { status: 403, data: { message: "sensitive-token" } } };
  };
  await assert.rejects(() => ai.generate({ prompt: "Hi" }), (err) => {
    assert.match(err.message, /HTTP 403: access denied/i);
    assert.match(err.message, /bedrock:CallWithBearerToken/);
    assert.ok(!err.message.includes("sensitive-token"));
    return true;
  });
});


test("Bedrock HTTP 401 identifies API key failure without disclosing error bodies", async () => {
  reset();
  process.env.AI_PROVIDER = "bedrock";
  process.env.BEDROCK_API_KEY = "test-hidden-secret";
  respond = async () => {
    throw { response: { status: 401, data: { message: "test-hidden-secret" } } };
  };
  await assert.rejects(() => ai.generate({ prompt: "Hi" }), (error) => {
    assert.match(error.message, /Amazon Bedrock HTTP 401/);
    assert.match(error.message, /API key authentication failed/);
    assert.ok(!error.message.includes("test-hidden-secret"));
    return true;
  });
});

test("Groq HTTP 401 retains existing error behavior", async () => {
  reset();
  process.env.AI_PROVIDER = "groq";
  process.env.GROQ_API_KEY = "test-hidden-secret";
  respond = async () => {
    throw { response: { status: 401, data: { message: "test-hidden-secret" } } };
  };
  await assert.rejects(() => ai.generate({ prompt: "Hi" }), (error) => {
    assert.match(error.message, /AI authentication failed/);
    assert.ok(!error.message.includes("test-hidden-secret"));
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
