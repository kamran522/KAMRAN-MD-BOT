"use strict";

const { Module } = require("../main");
const config = require("../config");
const { setVar } = require("./manage");
const localAI = require("./utils/local-ai");

const chatbotStates = new Map();
const chatContexts = new Map();
const MAX_CONTEXT_MESSAGES = 20;

let globalSystemPrompt =
  "You are a helpful AI assistant named Kamran Hasil. Be concise, friendly, accurate, and informative. Use WhatsApp-friendly formatting.";

async function initChatbotData() {
  try {
    String(config.CHATBOT || "")
      .split(",")
      .map((jid) => jid.trim())
      .filter(Boolean)
      .forEach((jid) => chatbotStates.set(jid, true));

    if (config.CHATBOT_SYSTEM_PROMPT) {
      globalSystemPrompt = config.CHATBOT_SYSTEM_PROMPT;
    }
  } catch (error) {
    console.error("Error initializing chatbot data:", error);
  }
}

async function saveChatbotData() {
  const enabledChats = [...chatbotStates.entries()]
    .filter(([, enabled]) => enabled)
    .map(([jid]) => jid);
  await setVar("CHATBOT", enabledChats.join(","));
}

async function saveSystemPrompt(prompt) {
  globalSystemPrompt = prompt;
  await setVar("CHATBOT_SYSTEM_PROMPT", prompt);
}

function isChatbotEnabled(jid) {
  if (chatbotStates.get(jid) === true) return true;
  const isGroup = jid.endsWith("@g.us");
  if (isGroup && String(config.CHATBOT_ALL_GROUPS) === "true") return true;
  if (!isGroup && String(config.CHATBOT_ALL_DMS) === "true") return true;
  return false;
}

async function enableChatbot(jid) {
  chatbotStates.set(jid, true);
  chatContexts.delete(jid);
  await saveChatbotData();
}

async function disableChatbot(jid) {
  chatbotStates.set(jid, false);
  chatContexts.delete(jid);
  await saveChatbotData();
}

function clearContext(jid) {
  chatContexts.delete(jid);
}

function getHistory(jid) {
  return chatContexts.get(jid) || [];
}

function rememberExchange(jid, prompt, answer) {
  if (!chatContexts.has(jid)) {
    if (chatContexts.size >= 500) {
      const oldest = chatContexts.keys().next().value;
      if (oldest) chatContexts.delete(oldest);
    }
    chatContexts.set(jid, []);
  }
  const history = chatContexts.get(jid);
  history.push(
    { role: "user", content: prompt },
    { role: "assistant", content: answer },
  );
  if (history.length > MAX_CONTEXT_MESSAGES) {
    history.splice(0, history.length - MAX_CONTEXT_MESSAGES);
  }
}

async function getAIResponse(prompt, chatJid, useHistory = true) {
  try {
    const answer = await localAI.generate({
      prompt,
      history: useHistory ? getHistory(chatJid) : [],
      systemPrompt: globalSystemPrompt,
    });
    if (useHistory) rememberExchange(chatJid, prompt, answer);
    return answer;
  } catch (error) {
    console.error("Local AI error:", error.message);
    return "❌ Local AI error: " + error.message +
      "\n\nEnsure Ollama is running and the configured model is installed.";
  }
}

function commandHelp(jid) {
  return (
    "*🤖 Local AI Chatbot*\n\n" +
    "📊 Status: " + (isChatbotEnabled(jid) ? "Enabled ✅" : "Disabled ❌") + "\n" +
    "🧠 Model: " + localAI.getModel() + "\n" +
    "🌐 Ollama: " + localAI.getBaseURL() + "\n" +
    "💬 Context messages: " + getHistory(jid).length + "\n\n" +
    "*Commands*\n" +
    "• .chatbot on — enable in this chat\n" +
    "• .chatbot off — disable in this chat\n" +
    "• .chatbot on groups — enable in every group\n" +
    "• .chatbot off groups — disable global group mode\n" +
    "• .chatbot on dms — enable in every DM\n" +
    "• .chatbot off dms — disable global DM mode\n" +
    '• .chatbot set "instructions" — set assistant instructions\n' +
    "• .chatbot clear — clear this chat's history\n" +
    "• .chatbot status — show status\n" +
    "• .ai your question — ask AI directly\n\n" +
    "When enabled in a chat, the bot replies to ordinary text messages there. Group chats do not require a mention or reply."
  );
}

initChatbotData();

Module(
  {
    pattern: "chatbot ?(.*)",
    fromMe: true,
    desc: "Manage the local Ollama AI chatbot (no API key required)",
    usage: '.chatbot on/off | .chatbot on/off groups/dms | .chatbot set "prompt" | .chatbot clear | .chatbot status',
  },
  async (message, match) => {
    const input = match[1]?.trim() || "";
    const jid = message.jid;
    if (!input) return message.sendReply(commandHelp(jid));

    const parts = input.split(/\s+/);
    const action = parts[0].toLowerCase();
    const scope = (parts[1] || "").toLowerCase();

    switch (action) {
      case "on":
        if (scope === "groups" || scope === "dms") {
          const key = scope === "groups" ? "CHATBOT_ALL_GROUPS" : "CHATBOT_ALL_DMS";
          await setVar(key, "true");
          return message.sendReply(
            "🤖 Local chatbot enabled for all " + scope +
            ". It will answer ordinary text messages in those chats.\nModel: " +
            localAI.getModel(),
          );
        }
        await enableChatbot(jid);
        return message.sendReply(
          "🤖 Local chatbot enabled in this " +
          (jid.endsWith("@g.us") ? "group" : "private chat") +
          ".\nModel: " + localAI.getModel() +
          "\nNo API key is needed. I will answer ordinary text messages in this chat.",
        );

      case "off":
        if (scope === "groups" || scope === "dms") {
          const key = scope === "groups" ? "CHATBOT_ALL_GROUPS" : "CHATBOT_ALL_DMS";
          await setVar(key, "false");
          return message.sendReply(
            "Global chatbot mode disabled for all " + scope +
            ". Individual chat settings are unchanged.",
          );
        }
        await disableChatbot(jid);
        return message.sendReply("🤖 Local chatbot disabled in this chat. Its conversation history was cleared.");

      case "set": {
        const promptMatch = input.match(/^set\s+["“](.+)["”]$/s);
        if (!promptMatch) {
          return message.sendReply('Usage: .chatbot set "You are a helpful programming assistant."');
        }
        await saveSystemPrompt(promptMatch[1].trim());
        return message.sendReply("✅ Local AI system instructions updated.");
      }

      case "clear":
        if (scope === "groups" || scope === "dms") {
          for (const chatJid of chatContexts.keys()) {
            if (
              (scope === "groups" && chatJid.endsWith("@g.us")) ||
              (scope === "dms" && !chatJid.endsWith("@g.us"))
            ) {
              clearContext(chatJid);
            }
          }
          return message.sendReply("Conversation history cleared for all " + scope + ".");
        }
        clearContext(jid);
        return message.sendReply("💭 Conversation history cleared for this chat.");

      case "status":
        return message.sendReply(
          "*🤖 Local AI Status*\n\n" +
          "• Chatbot: " + (isChatbotEnabled(jid) ? "Enabled ✅" : "Disabled ❌") + "\n" +
          "• Model: " + localAI.getModel() + "\n" +
          "• Ollama URL: " + localAI.getBaseURL() + "\n" +
          "• Context messages: " + getHistory(jid).length + "\n" +
          "• API key: Not required",
        );

      default:
        return message.sendReply(commandHelp(jid));
    }
  },
);

Module(
  {
    on: "text",
    fromMe: false,
  },
  async (message) => {
    try {
      const jid = message.jid;
      if (!isChatbotEnabled(jid) || message.fromMe) return;

      const prompt = String(message.text || "").trim();
      if (prompt.length < 2) return;

      const prefixes =
        typeof config.HANDLERS === "string" && config.HANDLERS !== "false"
          ? config.HANDLERS.split("").filter((prefix) => prefix.trim())
          : [];
      if (prefixes.some((prefix) => prompt.startsWith(prefix))) return;

      const answer = await getAIResponse(prompt, jid, true);
      if (answer) await message.sendReply(answer);
    } catch (error) {
      console.error("Local chatbot message handler error:", error);
    }
  },
);

Module(
  {
    pattern: "ai ?(.*)",
    fromMe: config.MODE !== "public",
    desc: "Ask the locally hosted Ollama AI model (no API key required)",
    type: "ai",
  },
  async (message, match) => {
    let prompt = match[1]?.trim() || "";
    if (message.reply_message?.text && !prompt) {
      prompt = message.reply_message.text.trim();
    }
    if (!prompt) {
      return message.sendReply("Please provide a question or reply to a text message.\nExample: .ai explain JavaScript promises");
    }
    if (message.reply_message?.image) {
      return message.sendReply("The local text model currently supports text questions only. Image analysis is not enabled.");
    }
    const answer = await getAIResponse(prompt, message.jid, false);
    return message.sendReply(answer);
  },
);
