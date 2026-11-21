'use strict';

const axios = require('axios');
const { Module } = require('../main');
const config = require('../config');
const { setVar } = require('./manage');

const MAX_PROMPT_LENGTH = 12000;
const MAX_REPLY_CHUNK = 3500;
const MAX_OUTPUT_CHUNKS = 8;
const activeChats = new Set();

async function generateGemini(prompt) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error('GEMINI_API_KEY is missing. Add it to your hosting environment.');
  const model = process.env.GEMINI_MODEL || 'gemini-2.5-flash';
  if (!/^[a-zA-Z0-9._-]+$/.test(model)) throw new Error('Invalid GEMINI_MODEL.');
  const response = await axios.post(
    'https://generativelanguage.googleapis.com/v1beta/models/' + model + ':generateContent',
    { contents: [{ role: 'user', parts: [{ text: prompt }] }], generationConfig: { maxOutputTokens: 2048 } },
    { headers: { 'x-goog-api-key': apiKey, 'Content-Type': 'application/json' }, timeout: 60000, maxRedirects: 0 }
  );
  const answer = (response.data?.candidates?.[0]?.content?.parts || [])
    .map(part => part.text || '').join('').trim();
  if (!answer) throw new Error('Gemini returned no text. The request may have been blocked.');
  return answer;
}

async function replyInChunks(message, answer) {
  let remaining = answer;
  let count = 0;
  while (remaining && count < MAX_OUTPUT_CHUNKS) {
    let split = Math.min(MAX_REPLY_CHUNK, remaining.length);
    if (split < remaining.length) {
      const newline = remaining.lastIndexOf('\n', split);
      if (newline > split / 2) split = newline + 1;
    }
    await message.sendReply(remaining.slice(0, split));
    remaining = remaining.slice(split).trimStart();
    count++;
  }
  if (remaining) await message.sendReply('Response truncated.');
}

Module({
  pattern: 'gemini ?(.*)',
  fromMe: config.MODE !== 'public',
  desc: 'Ask Google Gemini a question (requires GEMINI_API_KEY)',
  type: 'ai'
}, async (message, match) => {
  const prompt = String(match?.[1] || message.reply_message?.text || '').trim();
  if (!prompt) return message.sendReply('Usage: .gemini your question');
  if (prompt.length > MAX_PROMPT_LENGTH) return message.sendReply('Question is too long.');
  const chatId = message.jid || 'default';
  if (activeChats.has(chatId)) return message.sendReply('Please wait for the previous Gemini answer.');
  activeChats.add(chatId);
  try {
    await replyInChunks(message, await generateGemini(prompt));
  } catch (error) {
    const status = error.response?.status;
    const explanation = status === 429 ? 'Gemini rate limit or free quota reached.'
      : status === 400 ? 'Gemini rejected the request. Check the model and prompt.'
      : status === 401 || status === 403 ? 'Gemini API key is invalid or does not have access.'
      : status === 404 ? 'Gemini model not found. Check GEMINI_MODEL.'
      : error.response ? 'Gemini request failed (HTTP ' + status + ').'
      : error.message;
    await message.sendReply('Gemini error: ' + explanation);
  } finally {
    activeChats.delete(chatId);
  }
});

function chatbotEnabled() {
  return config.CHATBOT === true || ['true', 'on', '1'].includes(String(config.CHATBOT).toLowerCase());
}

Module({
  pattern: 'chatbot ?(.*)',
  fromMe: true,
  desc: 'Turn Gemini-powered automatic private-chat replies on or off',
  type: 'ai'
}, async (message, match) => {
  const option = String(match?.[1] || '').trim().toLowerCase();
  if (!['on', 'off'].includes(option)) {
    return message.sendReply('Chatbot is ' + (chatbotEnabled() ? 'ON' : 'OFF') + '. Usage: .chatbot on or .chatbot off');
  }
  await setVar('CHATBOT', option === 'on' ? 'true' : 'false');
  config.CHATBOT = option === 'on';
  await message.sendReply('Gemini chatbot ' + option.toUpperCase() + '.');
});

Module({ on: 'text', fromMe: false }, async (message) => {
  if (!chatbotEnabled() || !process.env.GEMINI_API_KEY) return;
  // Automatic chat replies are private-only to avoid unsolicited group responses.
  const chatId = message.jid;
  if (!chatId || chatId.endsWith('@g.us') || chatId === 'status@broadcast') return;
  const prompt = String(message.text || '').trim();
  if (!prompt || prompt.length > MAX_PROMPT_LENGTH) return;
  // Never intercept bot commands, including the Gemini and chatbot commands.
  const prefixes = String(config.HANDLERS || '.,');
  if (prefixes.split('').some(prefix => prompt.startsWith(prefix))) return;
  if (activeChats.has(chatId)) return;
  activeChats.add(chatId);
  try {
    await replyInChunks(message, await generateGemini(prompt));
  } catch (error) {
    const status = error.response?.status;
    console.error('Gemini chatbot request failed:', status || error.message);
    if (status === 429) await message.sendReply('Gemini free quota reached. Please try again later.');
  } finally {
    activeChats.delete(chatId);
  }
});
