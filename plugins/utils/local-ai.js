"use strict";

const axios = require("axios");
const net = require("node:net");

const DEFAULT_MODEL = "qwen3:8b";
const DEFAULT_ENDPOINT = "http://127.0.0.1:11434";

function numberSetting(key, fallback, min, max) {
  const raw = process.env[key];
  if (raw === undefined || raw === "") return fallback;
  const value = Number(raw);
  return Number.isFinite(value) ? Math.max(min, Math.min(max, Math.floor(value))) : fallback;
}

function isPrivateHost(hostname) {
  const host = hostname.replace(/^\[|\]$/g, "").toLowerCase();
  if (host === "localhost" || host === "host.docker.internal" ||
      host === "host.containers.internal" || host.endsWith(".local") ||
      /^[a-z0-9-]+$/.test(host)) return true;
  const version = net.isIP(host);
  if (version === 4) {
    const [a, b] = host.split(".").map(Number);
    return a === 10 || a === 127 || (a === 192 && b === 168) ||
      (a === 172 && b >= 16 && b <= 31);
  }
  if (version === 6) {
    return host === "::1" || /^(fc|fd|fe8|fe9|fea|feb)/i.test(host);
  }
  return false;
}

function localEndpoint(input) {
  let url;
  try { url = new URL(String(input).trim()); }
  catch (_) { throw new Error("Invalid LOCAL_AI_URL. Provide a local Ollama URL."); }
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password ||
      url.pathname !== "/" || url.search || url.hash ||
      !isPrivateHost(url.hostname)) {
    throw new Error("LOCAL_AI_URL must point to a trusted local/LAN Ollama server; " +
      "public endpoints, credentials and extra URL paths are not allowed.");
  }
  return url.origin;
}

function getSettings() {
  const model = String(process.env.LOCAL_AI_MODEL || DEFAULT_MODEL).trim();
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._:/-]{0,149}$/.test(model)) {
    throw new Error("Invalid LOCAL_AI_MODEL. Use an installed Ollama model name.");
  }
  const keepAlive = String(process.env.LOCAL_AI_KEEP_ALIVE || "15m").trim();
  if (!/^(?:\d+(?:ms|s|m|h)|-1)$/.test(keepAlive)) {
    throw new Error("Invalid LOCAL_AI_KEEP_ALIVE. Use e.g. 15m, 1h or -1.");
  }
  return {
    model,
    endpoint: localEndpoint(process.env.LOCAL_AI_URL || DEFAULT_ENDPOINT),
    timeout: numberSetting("LOCAL_AI_TIMEOUT", 300000, 10000, 1800000),
    deepTimeout: numberSetting("LOCAL_AI_DEEP_TIMEOUT", 900000, 10000, 1800000),
    context: numberSetting("LOCAL_AI_CONTEXT", 8192, 2048, 131072),
    deepContext: numberSetting("LOCAL_AI_DEEP_CONTEXT", 16384, 2048, 262144),
    predict: numberSetting("LOCAL_AI_NUM_PREDICT", 2048, 128, 16384),
    deepPredict: numberSetting("LOCAL_AI_DEEP_NUM_PREDICT", 8192, 256, 32768),
    maxPending: numberSetting("LOCAL_AI_MAX_PENDING", 3, 1, 20),
    keepAlive,
  };
}

function getProvider() { return "ollama"; }
function getModel() { return getSettings().model; }
function getBaseURL() { return getSettings().endpoint; }
function getRuntimeInfo() {
  const settings = getSettings();
  return {
    context: settings.context, deepContext: settings.deepContext,
    predict: settings.predict, deepPredict: settings.deepPredict,
  };
}

// One Ollama request at a time by default, avoiding excessive model memory
// usage when multiple chats ask large questions simultaneously.
let queueTail = Promise.resolve();
let pending = 0;
async function withLocalSlot(settings, fn) {
  if (pending >= settings.maxPending) {
    throw new Error("Local AI is busy. Try again after the current requests finish.");
  }
  pending++;
  const task = queueTail.then(fn);
  queueTail = task.then(() => {}, () => {});
  try { return await task; }
  finally { pending--; }
}

async function generate({ prompt, history = [], systemPrompt, images = [], deep = false }) {
  const settings = getSettings();
  if (images.length) throw new Error("This local AI chatbot currently supports text only.");
  const question = String(prompt || "").trim();
  if (!question) throw new Error("Provide a text question.");

  const messages = [
    {
      role: "system",
      content: systemPrompt ||
        "You are Kamran Hasil Bot, a careful local AI assistant. " +
        "Analyze difficult questions logically, explain assumptions and limitations, " +
        "and provide actionable answers in WhatsApp-friendly formatting. " +
        "Do not claim to browse the internet or access files or tools.",
    },
    ...(Array.isArray(history) ? history : []).filter((item) =>
      item && ["user", "assistant"].includes(item.role) &&
      typeof item.content === "string" && item.content.trim()
    ).slice(-12).map(({ role, content }) => ({ role, content: content.slice(-8000) })),
    { role: "user", content: question },
  ];

  return withLocalSlot(settings, async () => {
    try {
      const response = await axios.post(
        settings.endpoint + "/api/chat",
        {
          model: settings.model,
          messages,
          stream: false,
          think: Boolean(deep),
          keep_alive: settings.keepAlive,
          options: {
            num_ctx: deep ? settings.deepContext : settings.context,
            num_predict: deep ? settings.deepPredict : settings.predict,
            temperature: 0.6,
            top_p: 0.95,
          },
        },
        {
          headers: { "Content-Type": "application/json" },
          timeout: deep ? settings.deepTimeout : settings.timeout,
          maxRedirects: 0,
        },
      );
      const raw = response.data?.message?.content;
      const answer = typeof raw === "string" ? raw.trim() : "";
      if (!answer) {
        throw new Error("Local AI returned no final answer. " +
          "Try a shorter prompt or increase LOCAL_AI_DEEP_NUM_PREDICT.");
      }
      return answer;
    } catch (error) {
      if (error.message.startsWith("Local AI returned no final answer.")) throw error;
      const status = error.response?.status;
      if (status === 404) {
        throw new Error("Ollama model not found. Run: ollama pull " + settings.model);
      }
      if (status === 400) {
        throw new Error("Ollama rejected the request. Check the model's support " +
          "for thinking mode and the configured context settings.");
      }
      if (status === 500 || status === 503) {
        throw new Error("Local inference failed. Check Ollama logs and available " +
          "RAM/VRAM; try a smaller model or lower LOCAL_AI_DEEP_CONTEXT.");
      }
      if (error.code === "ECONNABORTED" || error.code === "ETIMEDOUT") {
        throw new Error("Local AI timed out. Try a smaller model or increase LOCAL_AI_DEEP_TIMEOUT.");
      }
      if (["ECONNREFUSED", "ENOTFOUND", "EHOSTUNREACH", "ENETUNREACH"].includes(error.code)) {
        throw new Error("Cannot reach Ollama at " + settings.endpoint +
          ". Start 'ollama serve' and check LOCAL_AI_URL (including Docker networking).");
      }
      throw new Error("Local Ollama request failed. Check the Ollama service and server logs.");
    }
  });
}

module.exports = { generate, getProvider, getModel, getBaseURL, getRuntimeInfo };
