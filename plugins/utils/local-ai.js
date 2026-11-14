"use strict";

const axios = require("axios");
const DEFAULT_URL = "http://127.0.0.1:11434";
const DEFAULT_MODEL = "llama3.2:3b";

function getSettings() {
  return {
    baseURL: String(process.env.LOCAL_AI_URL || DEFAULT_URL).replace(/\/+$/, ""),
    model: process.env.LOCAL_AI_MODEL || DEFAULT_MODEL,
    timeout: Math.max(10000, Number(process.env.LOCAL_AI_TIMEOUT || 120000)),
  };
}

async function generate({ prompt, history = [], systemPrompt, images = [] }) {
  const settings = getSettings();
  if (images.length) {
    throw new Error("The local chatbot currently supports text messages only.");
  }

  const messages = [
    {
      role: "system",
      content: systemPrompt ||
        "You are Kamran Hasil Bot, a helpful, accurate, friendly assistant. Answer naturally and clearly. Use WhatsApp-friendly formatting and do not claim to have live internet access.",
    },
    ...history.filter((item) =>
      item &&
      ["user", "assistant"].includes(item.role) &&
      typeof item.content === "string" &&
      item.content.trim()
    ).slice(-12),
    { role: "user", content: String(prompt || "") },
  ];

  try {
    const response = await axios.post(
      settings.baseURL + "/api/chat",
      {
        model: settings.model,
        messages,
        stream: false,
        options: { temperature: 0.7, num_predict: 1024 },
      },
      {
        timeout: settings.timeout,
        headers: { "Content-Type": "application/json" },
      },
    );

    const answer = response.data?.message?.content?.trim();
    if (!answer) throw new Error("The local AI model returned an empty response.");
    return answer;
  } catch (error) {
    if (error.code === "ECONNREFUSED" || error.code === "ENOTFOUND") {
      throw new Error(
        "Cannot reach Ollama at " + settings.baseURL +
        '. Install/start Ollama and pull the model "' + settings.model + '".',
      );
    }
    if (error.code === "ECONNABORTED") {
      throw new Error("The local AI took too long to respond. Try again.");
    }
    const detail = error.response?.data?.error || error.response?.data?.message || error.message;
    throw new Error(String(detail || "Unknown local AI error"));
  }
}

function getModel() {
  return getSettings().model;
}

function getBaseURL() {
  return getSettings().baseURL;
}

module.exports = { generate, getModel, getBaseURL };
