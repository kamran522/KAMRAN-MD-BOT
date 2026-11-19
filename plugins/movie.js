"use strict";

const { Module } = require("../main");
const config = require("../config");
const {
  MAX_WHATSAPP_BYTES, searchMovies, getMovieDetails,
  downloadMovieToTemp, friendlySize,
} = require("./utils/movies");

const SESSIONS = new Map();
const SESSION_TTL = 10 * 60 * 1000;
const RESULT_LIMIT = 6;
const MENU_MARKER = "*_Movie Search Results_*";

function sessionKey(message) {
  const user = message.fromMe ? "self" : (message.sender || message.jid);
  return String(message.jid) + ":" + String(user);
}

function purgeExpired(now = Date.now()) {
  for (const [key, value] of SESSIONS) {
    if (value.createdAt + SESSION_TTL < now) SESSIONS.delete(key);
  }
  while (SESSIONS.size > 100) SESSIONS.delete(SESSIONS.keys().next().value);
}

function hasAccess(message) {
  return config.MODE === "public" || message.fromOwner === true || message.fromMe === true;
}

function safeText(value) {
  return String(value || "").replace(/[\x60*_~]/g, "").replace(/\s+/g, " ").trim();
}

async function sendSelectedMovie(message, entry) {
  let detail;
  try {
    detail = await getMovieDetails(entry.identifier);
  } catch (error) {
    console.error("[Movies] metadata lookup failed:", error);
    return message.sendReply("_Movie unavailable: " + safeText(error.message).slice(0, 180) + "_");
  }
  const file = detail.file;
  // Always provide the archive page, file link and uploader-declared license.
  // Large movie files must not be loaded into WhatsApp as remote URL buffers.
  const info = [
    "🎬 *" + safeText(detail.title) + "*",
    detail.creator ? "_Creator:_ " + safeText(detail.creator) : "",
    "_File:_ " + friendlySize(file.size) + " · " + file.ext.slice(1).toUpperCase(),
    "_Declared license:_ " + detail.license,
    detail.licenseUrl,
    "",
    "*Full movie file:* " + file.url,
    "*Archive page:* " + detail.page,
    "",
    "_License details are supplied by the uploader; verify rights before sharing._",
  ].filter(Boolean).join("\n");
  await message.sendReply(info);

  if (file.size > MAX_WHATSAPP_BYTES) {
    return message.sendReply(
      "_This movie exceeds the safe WhatsApp upload limit (" +
      friendlySize(MAX_WHATSAPP_BYTES) + "). Use the full movie download link above._"
    );
  }

  let temp;
  try {
    await message.sendReply("_Downloading and preparing the movie for WhatsApp..._");
    temp = await downloadMovieToTemp(detail);
    const filename = safeText(detail.title).slice(0, 65) || "movie";
    await message.sendMessage({ url: temp.path }, "document", {
      fileName: filename + file.ext,
      mimetype: file.ext === ".webm" ? "video/webm" : "video/mp4",
      caption: "_Licensed archive movie: " + safeText(detail.title) + "_",
    });
  } catch (error) {
    console.error("[Movies] movie upload failed:", error);
    await message.sendReply(
      "_WhatsApp upload failed. The direct movie download link above is still available._"
    );
  } finally {
    if (temp) {
      try { temp.cleanup(); } catch (error) { console.warn("[Movies] cleanup failed:", error); }
    }
  }
}

async function movieCommand(message, match) {
  if (!hasAccess(message)) return;
  const input = String(match?.[1] || "").trim();
  if (!input) {
    return message.sendReply(
      "_Usage:_ *.movie movie name*\n" +
      "_Example:_ .movie Night of the Living Dead\n" +
      "_Reply with a result number, or use .movie 1 after searching._\n" +
      "_Searches only items with a declared Creative Commons / public-domain license._"
    );
  }
  purgeExpired();
  if (/^[1-6]$/.test(input)) {
    const key = sessionKey(message);
    const session = SESSIONS.get(key);
    if (!session) return message.sendReply("_No recent movie search. Send .movie <title> first._");
    const chosen = session.results[Number(input) - 1];
    if (!chosen) return message.sendReply("_That movie result number is not available._");
    SESSIONS.delete(key);
    return sendSelectedMovie(message, chosen);
  }
  try {
    const results = await searchMovies(input);
    if (!results.length) {
      return message.sendReply(
        "_No matches with supported license metadata. Try a classic film title or another search._"
      );
    }
    const key = sessionKey(message);
    const menu = [
      MENU_MARKER,
      "_Query: " + safeText(input).slice(0, 100) + "_",
      "",
      ...results.slice(0, RESULT_LIMIT).map((entry, i) =>
        "*" + (i + 1) + ".* " + safeText(entry.title) +
        (entry.year ? " (" + entry.year + ")" : "") +
        "\n   _" + entry.license + "_"
      ),
      "",
      "_Reply with a number (1-" + Math.min(RESULT_LIMIT, results.length) +
      "), or send .movie <number> within 10 minutes._",
      "_Files are supplied by the Internet Archive under uploader-declared licenses._",
    ].join("\n");
    const sent = await message.sendReply(menu);
    SESSIONS.set(key, { results, createdAt: Date.now(), menuId: sent?.key?.id || null });
    purgeExpired();
  } catch (error) {
    console.error("[Movies] catalog search failed:", error);
    return message.sendReply("_Movie search failed. Check the Internet Archive connection and retry._");
  }
}

Module({
  pattern: "movie ?(.*)",
  fromMe: config.MODE !== "public",
  desc: "Search and download public-domain or Creative Commons films",
  usage: ".movie Night of the Living Dead",
  use: "download",
}, movieCommand);

Module({
  pattern: "movies ?(.*)",
  fromMe: config.MODE !== "public",
  desc: "Alias for licensed movie search",
  usage: ".movies movie name",
  use: "download",
}, movieCommand);

Module({ on: "text", fromMe: false }, async (message) => {
  if (!hasAccess(message)) return;
  const text = String(message.text || message.message || "").trim();
  if (!/^[1-6]$/.test(text)) return;
  const quoted = String(message.reply_message?.text || message.reply_message?.message || "");
  if (!quoted.includes(MENU_MARKER)) return;
  purgeExpired();
  const key = sessionKey(message);
  const session = SESSIONS.get(key);
  if (!session) return;
  if (session.menuId && message.reply_message?.id &&
      message.reply_message.id !== session.menuId) return;
  const selected = session.results[Number(text) - 1];
  if (!selected) return message.sendReply("_Invalid movie selection._");
  SESSIONS.delete(key);
  await sendSelectedMovie(message, selected);
});
