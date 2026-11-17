"use strict";

const axios = require("axios");

// Kimi (Moonshot AI) is the only supported AI provider.
const KIMI_BASE_URL = "https://api.moonshot.ai/v1";
const DEFAULT_KIMI_MODEL = "kimi-k2.6";

function getSettings() {
  const apiKey = String(process.env.KIMI_API_KEY || process.env.MOONSHOT_API_KEY || "").trim();
  const model = String(process.env.KIMI_MODEL || DEFAULT_KIMI_MODEL).trim();
  // Only Kimi model IDs may be selected. AI_PROVIDER and old provider keys
  // are deliberately ignored, so no legacy backend can be used.
  if (!/^kimi-[a-z0-9][a-z0-9._-]*$/i.test(model)) {
    throw new Error("Invalid KIMI_MODEL. Use a supported Kimi model ID (e.g. kimi-k2.6).");
  }
  const requestedTimeout = Number(process.env.KIMI_TIMEOUT || 120000);
  const timeout = Number.isFinite(requestedTimeout)
    ? Math.max(10000, Math.min(300000, requestedTimeout))
    : 120000;
  return { apiKey, model, timeout, baseURL: KIMI_BASE_URL };
}

function getProvider() {
  return "kimi";
}

function getModel() {
  return getSettings().model;
}

function getBaseURL() {
  return KIMI_BASE_URL;
}

function hasAPIKey() {
  return Boolean(getSettings().apiKey);
}

async function generate({ prompt, history = [], systemPrompt, images = [] }) {
  const settings = getSettings();
  if (images.length) {
    throw new Error("The Kimi chatbot currently supports text messages only.");
  }
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

  try {
    const response = await axios.post(
      KIMI_BASE_URL + "/chat/completions",
      {
        model: settings.model,
        messages,
        stream: false,
        max_completion_tokens: 2048,
      },
      {
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer " + settings.apiKey,
        },
        timeout: settings.timeout,
        maxRedirects: 0,
      },
    );
    const raw = response.data?.choices?.[0]?.message?.content;
    const answer = typeof raw === "string" ? raw.trim() : "";
    if (!answer) throw new Error("Kimi returned an empty response.");
    return answer;
  } catch (error) {
    if (error.message === "Kimi returned an empty response.") throw error;
    const status = error.response?.status;
    if (status === 401 || status === 403) {
      throw new Error("Kimi authentication failed. Check your Moonshot API key and access.");
    }
    if (status === 402) {
      throw new Error("Kimi account has insufficient API balance or billing access.");
    }
    if (status === 429) {
      throw new Error("Kimi rate limit reached. Try again later.");
    }
    if (status === 400 || status === 404) {
      throw new Error("Kimi rejected the request. Check that KIMI_MODEL is available to your account.");
    }
    if (status >= 500) {
      throw new Error("Kimi API is temporarily unavailable.");
    }
    if (error.code === "ECONNABORTED" || error.code === "ETIMEDOUT") {
      throw new Error("Kimi request timed out. Try again.");
    }
    if (["ECONNREFUSED", "ENOTFOUND", "EHOSTUNREACH", "ENETUNREACH"].includes(error.code)) {
      throw new Error("Cannot reach Moonshot AI. Check your server's internet connection.");
    }
    // Never forward raw provider errors; they can contain sensitive metadata.
    throw new Error("Kimi request failed. Check the API key, model, and network settings.");
  }
}

module.exports = { generate, getProvider, getModel, getBaseURL, hasAPIKey };
