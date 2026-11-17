"use strict";

const axios = require("axios");
const KIMI_BASE_URL = "https://api.moonshot.ai/v1";
const DEFAULT_KIMI_MODEL = "kimi-k2.6";

function boundedNumber(name, fallback, minimum, maximum) {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return fallback;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ?
    Math.max(minimum, Math.min(maximum, Math.floor(parsed))) : fallback;
}

function getSettings() {
  const apiKey = String(process.env.KIMI_API_KEY || process.env.MOONSHOT_API_KEY || "").trim();
  const model = String(process.env.KIMI_MODEL || DEFAULT_KIMI_MODEL).trim();
  if (!/^kimi-[a-z0-9][a-z0-9._-]*$/i.test(model)) {
    throw new Error("Invalid KIMI_MODEL. Use a supported Kimi model ID (e.g. kimi-k2.6).");
  }
  return {
    apiKey, model, baseURL: KIMI_BASE_URL,
    timeout: boundedNumber("KIMI_TIMEOUT", 120000, 10000, 300000),
    outputTokens: boundedNumber("KIMI_MAX_COMPLETION_TOKENS", 1024, 128, 8192),
    minInterval: boundedNumber("KIMI_MIN_INTERVAL_MS", 2000, 0, 60000),
    maxPending: boundedNumber("KIMI_MAX_PENDING", 10, 1, 100),
    maxRetries: boundedNumber("KIMI_OVERLOAD_RETRIES", 1, 0, 2),
    retryBaseMs: boundedNumber("KIMI_RETRY_BASE_MS", 1000, 1, 10000),
    cooldownMs: boundedNumber("KIMI_RATE_LIMIT_COOLDOWN_MS", 60000, 0, 300000),
  };
}

function getProvider() { return "kimi"; }
function getModel() { return getSettings().model; }
function getBaseURL() { return KIMI_BASE_URL; }
function hasAPIKey() { return Boolean(getSettings().apiKey); }

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// In-process shared queue: reduces concurrent Kimi requests from group/DM
// chatbot triggers. A bounded queue prevents unlimited resource consumption.
let requestTail = Promise.resolve();
let pending = 0;
let nextAllowedStart = 0;
let cooldownUntil = 0;

function cooldownMessage() {
  const seconds = Math.max(1, Math.ceil((cooldownUntil - Date.now()) / 1000));
  return "Kimi requests are temporarily paused after a 429 response. " +
    "Try again in about " + seconds + " seconds. Check your API limits and balance.";
}

async function withRequestSlot(settings, operation) {
  if (pending >= settings.maxPending) {
    throw new Error("Kimi is busy processing messages. Try again shortly.");
  }
  pending++;
  const task = requestTail.then(async () => {
    if (Date.now() < cooldownUntil) throw new Error(cooldownMessage());
    const pauseMs = Math.max(0, nextAllowedStart - Date.now());
    if (pauseMs) await sleep(pauseMs);
    if (Date.now() < cooldownUntil) throw new Error(cooldownMessage());
    nextAllowedStart = Date.now() + settings.minInterval;
    return operation();
  });
  requestTail = task.then(() => {}, () => {});
  try {
    return await task;
  } finally {
    pending--;
  }
}

function retryAfterMs(headers) {
  const value = headers?.["retry-after"] ?? headers?.["Retry-After"];
  if (value === undefined || value === null) return null;
  const raw = Array.isArray(value) ? value[0] : String(value);
  if (/^\d+(?:\.\d+)?$/.test(raw.trim())) {
    return Math.max(0, Math.min(300000, Math.ceil(Number(raw) * 1000)));
  }
  const parsed = Date.parse(raw);
  return Number.isFinite(parsed)
    ? Math.max(0, Math.min(300000, parsed - Date.now())) : null;
}

function applyCooldown(settings, headers, fallbackMs = settings.cooldownMs) {
  cooldownUntil = Math.max(
    cooldownUntil,
    Date.now() + (retryAfterMs(headers) ?? fallbackMs),
  );
}

async function requestKimi(settings, messages) {
  const endpoint = KIMI_BASE_URL + "/chat/completions";
  const payload = {
    model: settings.model, messages, stream: false,
    max_completion_tokens: settings.outputTokens,
  };
  const options = {
    headers: {
      "Content-Type": "application/json",
      Authorization: "Bearer " + settings.apiKey,
    },
    timeout: settings.timeout,
    maxRedirects: 0,
  };

  for (let attempt = 0; attempt <= settings.maxRetries; attempt++) {
    try {
      const response = await axios.post(endpoint, payload, options);
      const raw = response.data?.choices?.[0]?.message?.content;
      const answer = typeof raw === "string" ? raw.trim() : "";
      if (!answer) throw new Error("Kimi returned an empty response.");
      return answer;
    } catch (error) {
      if (error.message === "Kimi returned an empty response.") throw error;
      const status = error.response?.status;
      const type = error.response?.data?.error?.type;
      if (status === 429) {
        if (type === "exceeded_current_quota_error") {
          applyCooldown(settings, error.response?.headers);
          throw new Error("Kimi API quota or balance exhausted. " +
            "Check available balance and billing at platform.kimi.ai.");
        }
        if (type === "rate_limit_reached_error") {
          applyCooldown(settings, error.response?.headers);
          throw new Error("Kimi account rate limit reached (RPM, TPM, TPD or concurrency). " +
            "Check your Kimi API tier and usage at platform.kimi.ai.");
        }
        if (type === "engine_overloaded_error") {
          const retryMs = retryAfterMs(error.response?.headers) ??
            settings.retryBaseMs * (2 ** attempt);
          if (attempt < settings.maxRetries && retryMs <= 15000) {
            await sleep(retryMs);
            continue;
          }
          applyCooldown(settings, error.response?.headers, Math.max(5000, settings.cooldownMs));
          throw new Error("Kimi service is overloaded. Try again after the provider recovers.");
        }
        // Unrecognized 429 must not trigger blind automatic retries.
        applyCooldown(settings, error.response?.headers);
        throw new Error("Kimi returned HTTP 429. Check your API quota, balance, and rate limits.");
      }
      if (status === 401 || status === 403) {
        throw new Error("Kimi API authentication or permission failed. Check your API key and access.");
      }
      if (status === 402) {
        throw new Error("Kimi API balance or billing is insufficient.");
      }
      if (status === 400 || status === 404) {
        throw new Error("Kimi rejected the request. Check that KIMI_MODEL is available to your account.");
      }
      if (status >= 500) throw new Error("Kimi API is temporarily unavailable.");
      if (error.code === "ECONNABORTED" || error.code === "ETIMEDOUT") {
        throw new Error("Kimi request timed out. Try again.");
      }
      if (["ECONNREFUSED", "ENOTFOUND", "EHOSTUNREACH", "ENETUNREACH"].includes(error.code)) {
        throw new Error("Cannot reach Moonshot AI. Check your server's internet connection.");
      }
      // Never include raw Kimi response bodies or credentials in WhatsApp replies.
      throw new Error("Kimi request failed. Check API settings and network connection.");
    }
  }
}

async function generate({ prompt, history = [], systemPrompt, images = [] }) {
  const settings = getSettings();
  if (images.length) throw new Error("The Kimi chatbot currently supports text messages only.");
  const question = String(prompt || "").trim();
  if (!question) throw new Error("Provide a text question.");
  if (!settings.apiKey) {
    throw new Error("KIMI_API_KEY (or MOONSHOT_API_KEY) is missing. " +
      "Set a Moonshot AI API key in your hosting environment.");
  }
  const messages = [
    {
      role: "system",
      content: systemPrompt ||
        "You are Kamran Hasil Bot, a helpful and accurate assistant powered by Kimi. " +
        "Answer clearly using WhatsApp-friendly formatting. Do not claim to have live internet access.",
    },
    ...(Array.isArray(history) ? history : []).filter((item) =>
      item && ["user", "assistant"].includes(item.role) &&
      typeof item.content === "string" && item.content.trim()
    ).slice(-12),
    { role: "user", content: question },
  ];
  return withRequestSlot(settings, () => requestKimi(settings, messages));
}

module.exports = { generate, getProvider, getModel, getBaseURL, hasAPIKey };
