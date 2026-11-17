"use strict";

const axios = require("axios");
const GROQ_BASE_URL = "https://api.groq.com/openai/v1";
const DEFAULT_GROQ_MODEL = "openai/gpt-oss-20b";
const DEFAULT_BEDROCK_MODEL = "amazon.nova-lite-v1:0";
const DEFAULT_OLLAMA_URL = "http://127.0.0.1:11434";
const DEFAULT_OPENAI_URL = "http://127.0.0.1:8000/v1";
const DEFAULT_LOCAL_MODEL = "llama3.2:3b";

function getSettings() {
  const groqKey = String(process.env.GROQ_API_KEY || "").trim();
  const bedrockKey = String(process.env.BEDROCK_API_KEY ||
    process.env.AWS_BEARER_TOKEN_BEDROCK || "").trim();
  const selection = String(process.env.AI_PROVIDER ||
    (groqKey ? "groq" : bedrockKey ? "bedrock" : "ollama")).trim().toLowerCase();
  const provider = selection === "local" ? "ollama" :
    selection === "openai" ? "openai-compatible" :
    ["aws-bedrock", "amazon-bedrock"].includes(selection) ? "bedrock" : selection;
  if (!["groq", "bedrock", "ollama", "openai-compatible"].includes(provider)) {
    throw new Error("Invalid AI_PROVIDER. Use groq, bedrock, ollama, or openai-compatible.");
  }

  const bedrockRegion = String(process.env.BEDROCK_REGION ||
    process.env.AWS_REGION || "us-east-1").trim();
  if (provider === "bedrock" &&
      !/^[a-z]{2}(?:-[a-z]+){1,3}-[0-9]+$/.test(bedrockRegion)) {
    throw new Error("Invalid BEDROCK_REGION. Use a valid AWS Region, e.g. us-east-1.");
  }

  const configuredTimeout = Number(process.env.LOCAL_AI_TIMEOUT || 120000);
  const timeout = Number.isFinite(configuredTimeout)
    ? Math.max(10000, Math.min(300000, configuredTimeout))
    : 120000;
  const baseURL = provider === "groq" ? GROQ_BASE_URL :
    provider === "bedrock"
      ? "https://bedrock-runtime." + bedrockRegion +
        (bedrockRegion.startsWith("cn-") ? ".amazonaws.com.cn" : ".amazonaws.com")
      : String(process.env.LOCAL_AI_URL ||
          (provider === "ollama" ? DEFAULT_OLLAMA_URL : DEFAULT_OPENAI_URL))
        .trim().replace(/\/+$/, "");

  return {
    provider,
    baseURL,
    model: String(provider === "groq"
      ? (process.env.GROQ_MODEL || DEFAULT_GROQ_MODEL)
      : provider === "bedrock" ? (process.env.BEDROCK_MODEL || DEFAULT_BEDROCK_MODEL)
      : (process.env.LOCAL_AI_MODEL || DEFAULT_LOCAL_MODEL)).trim(),
    apiKey: provider === "groq" ? groqKey :
      provider === "bedrock" ? bedrockKey :
      provider === "openai-compatible" ?
        String(process.env.LOCAL_AI_API_KEY || "").trim() : "",
    timeout,
  };
}

function getProvider() {
  return getSettings().provider;
}

function getModel() {
  return getSettings().model;
}

function getBaseURL() {
  const raw = getSettings().baseURL;
  try {
    const safeURL = new URL(raw);
    safeURL.username = "";
    safeURL.password = "";
    safeURL.search = "";
    safeURL.hash = "";
    return safeURL.toString().replace(/\/$/, "");
  } catch (_) {
    return "(invalid endpoint URL)";
  }
}

function hasAPIKey() {
  return Boolean(getSettings().apiKey);
}

async function generate({ prompt, history = [], systemPrompt, images = [] }) {
  const settings = getSettings();
  if (images.length) throw new Error("The chatbot currently supports text messages only.");
  const question = String(prompt || "").trim();
  if (!question) throw new Error("Provide a text question.");
  if (settings.provider === "groq" && !settings.apiKey) {
    throw new Error("GROQ_API_KEY is missing. Set it in your hosting environment.");
  }
  if (settings.provider === "bedrock" && !settings.apiKey) {
    throw new Error("BEDROCK_API_KEY or AWS_BEARER_TOKEN_BEDROCK is missing. " +
      "Set an Amazon Bedrock API key in your hosting environment.");
  }

  const messages = [
    {
      role: "system",
      content: systemPrompt ||
        "You are Kamran Hasil Bot, a helpful and accurate assistant. " +
        "Answer clearly using WhatsApp-friendly formatting. Do not claim to have live internet access.",
    },
    ...history.filter((item) =>
      item && ["user", "assistant"].includes(item.role) &&
      typeof item.content === "string" && item.content.trim()
    ).slice(-12),
    { role: "user", content: question },
  ];

  const isOllama = settings.provider === "ollama";
  const isBedrock = settings.provider === "bedrock";
  // Keep version colons in Bedrock model IDs, while encoding slash in ARNs.
  const modelPath = encodeURIComponent(settings.model).replace(/%3A/gi, ":");
  const endpoint = settings.baseURL +
    (isBedrock ? "/model/" + modelPath + "/converse" :
      isOllama ? "/api/chat" : "/chat/completions");

  const headers = { "Content-Type": "application/json" };
  if (settings.apiKey) headers.Authorization = "Bearer " + settings.apiKey;
  const payload = isBedrock
    ? {
        system: [{ text: messages[0].content }],
        messages: messages.slice(1).map(({ role, content }) => ({
          role, content: [{ text: content }],
        })),
        inferenceConfig: { maxTokens: 1024, temperature: 0.7 },
      }
    : isOllama
      ? { model: settings.model, messages, stream: false,
          options: { temperature: 0.7, num_predict: 1024 } }
      : { model: settings.model, messages, stream: false,
          temperature: 0.7, max_completion_tokens: 2048 };

  try {
    const response = await axios.post(endpoint, payload, {
      headers, timeout: settings.timeout, maxRedirects: 0,
    });
    const rawAnswer = isBedrock
      ? response.data?.output?.message?.content
          ?.filter((part) => part && typeof part.text === "string")
          .map((part) => part.text).join("\n")
      : isOllama
        ? response.data?.message?.content
        : response.data?.choices?.[0]?.message?.content;
    const answer = typeof rawAnswer === "string" ? rawAnswer.trim() : "";
    if (!answer) throw new Error("The AI model returned an empty response.");
    return answer;
  } catch (error) {
    if (error.message === "The AI model returned an empty response.") throw error;
    const status = error.response?.status;
    if (status === 401 || status === 403) {
      throw new Error("AI authentication failed. Check the configured API key and access.");
    }
    if (status === 429) throw new Error("AI rate limit reached. Try again later.");
    if (status === 400 || status === 404) {
      throw new Error("AI request rejected. Check AI_PROVIDER, model, and AWS Region if using Bedrock.");
    }
    if (status >= 500) throw new Error("The AI provider is temporarily unavailable.");
    if (error.code === "ECONNABORTED" || error.code === "ETIMEDOUT") {
      throw new Error("The AI request timed out. Try again.");
    }
    if (["ECONNREFUSED", "ENOTFOUND", "EHOSTUNREACH", "ENETUNREACH"].includes(error.code)) {
      throw new Error(settings.provider === "groq"
        ? "Cannot reach GroqCloud. Check the network connection."
        : isBedrock
          ? "Cannot reach Amazon Bedrock. Check network access and the configured AWS Region."
          : "Cannot reach the local AI server at " + getBaseURL() + ". Check that it is running.");
    }
    throw new Error("AI request failed. Check the provider endpoint and settings.");
  }
}

module.exports = { generate, getProvider, getModel, getBaseURL, hasAPIKey };
