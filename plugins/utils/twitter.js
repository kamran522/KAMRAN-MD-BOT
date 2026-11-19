"use strict";

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFile } = require("node:child_process");

const MAX_FILES = 4;
const MAX_BYTES = 60 * 1024 * 1024;
const MEDIA_EXTENSIONS = new Set([".mp4", ".jpg", ".jpeg", ".png", ".webp"]);
const IMAGE_EXTENSIONS = new Set([".jpg", ".jpeg", ".png", ".webp"]);

function normalizeTwitterUrl(input) {
  let url;
  try {
    url = new URL(String(input || "").trim());
  } catch (_) {
    throw new Error("Provide a valid X/Twitter post link.");
  }
  const host = url.hostname.toLowerCase();
  if (!["x.com", "www.x.com", "mobile.x.com", "twitter.com", "www.twitter.com", "mobile.twitter.com"].includes(host) ||
      !["http:", "https:"].includes(url.protocol) || url.port || url.username || url.password) {
    throw new Error("Only x.com or twitter.com post links are supported.");
  }
  const match = url.pathname.match(/^\/([a-zA-Z0-9_]{1,15})\/status\/(\d{5,25})(?:\/(?:video|photo)\/\d+)?\/?$/i);
  if (!match) throw new Error("Use a direct post link containing /status/ and its post number.");
  return "https://x.com/" + match[1] + "/status/" + match[2];
}

function findTwitterUrl(text) {
  const candidates = String(text || "").match(/https?:\/\/[^\s<>"']+/gi) || [];
  for (const candidate of candidates) {
    const clean = candidate.replace(/[)\].,!?>;]+$/, "");
    try { return normalizeTwitterUrl(clean); } catch (_) {}
  }
  return null;
}

function resolveBinary(name, variable) {
  if (process.env[variable]) return process.env[variable];
  const local = path.resolve(__dirname, "../..", ".venv",
    process.platform === "win32" ? "Scripts" : "bin",
    process.platform === "win32" ? name + ".exe" : name);
  return fs.existsSync(local) ? local : name;
}

function run(binary, args, timeout = 8 * 60 * 1000) {
  return new Promise((resolve, reject) => {
    execFile(binary, args, {
      timeout, maxBuffer: 4 * 1024 * 1024, windowsHide: true,
    }, (error, stdout, stderr) => {
      if (!error) return resolve({ stdout, stderr });
      if (error.code === "ENOENT") return reject(
        new Error(path.basename(binary) + " is not installed. Install yt-dlp and gallery-dl in .venv, or set YTDLP_PATH / GALLERYDL_PATH.")
      );
      const detail = String(stderr || error.message).trim().split("\n").slice(-3).join(" | ").slice(0,500);
      reject(new Error(path.basename(binary) + ": " + (detail || error.message)));
    });
  });
}

function listDownloadedMedia(root, maxFiles = MAX_FILES) {
  const found = [];
  function walk(dir, depth) {
    if (depth > 5) return;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) {
        walk(fullPath, depth + 1);
      } else if (entry.isFile()) {
        const ext = path.extname(entry.name).toLowerCase();
        if (!MEDIA_EXTENSIONS.has(ext)) continue;
        const size = fs.statSync(fullPath).size;
        if (size > 0 && size <= MAX_BYTES) found.push(fullPath);
      }
    }
  }
  walk(root, 0);
  return found.sort().slice(0, maxFiles);
}

function twitterFailureReason(error) {
  const reason = String(error?.message || "Unknown error");
  if (/login|cookies|authentication|sign in|403|401|private/i.test(reason)) {
    return "This post may require login. Configure YTDLP_COOKIES_TWITTER with an authorized cookies.txt file.";
  }
  if (/404|not found|unavailable|deleted/i.test(reason)) {
    return "The post is deleted, unavailable, or does not contain supported media.";
  }
  if (/429|rate.limit/i.test(reason)) {
    return "X/Twitter is rate-limiting this VPS. Try again later.";
  }
  if (/ENOENT|not installed/i.test(reason)) {
    return "Install yt-dlp and gallery-dl in the bot's .venv, or configure their executable paths.";
  }
  if (/timed? out|ECONNRESET|ENOTFOUND|fetch failed/i.test(reason)) {
    return "Could not reach X/Twitter from the VPS. Check connectivity.";
  }
  return "Could not download media from that post. See [Twitter/X] in PM2 logs.";
}

async function downloadTwitterMedia(input, options = {}) {
  const url = normalizeTwitterUrl(input);
  const maxFiles = Math.min(MAX_FILES, Math.max(1, Number(options.maxFiles) || MAX_FILES));
  let parent;
  try {
    parent = require("../../core/helpers").getTempSubdir("twitter");
  } catch (_) {
    parent = path.join(os.tmpdir(), "kamran-bot", "twitter");
    fs.mkdirSync(parent, { recursive: true });
  }
  const workDir = fs.mkdtempSync(path.join(parent, "post-"));
  const clean = () => {
    try { fs.rmSync(workDir, { recursive: true, force: true }); }
    catch (error) { console.warn("[Twitter/X] temporary cleanup failed:", error?.message || error); }
  };
  const cookies = process.env.YTDLP_COOKIES_TWITTER || process.env.YTDLP_COOKIES;
  let lastError;

  try {
    const ytArgs = [
      "--no-warnings", "--yes-playlist", "--playlist-end", String(maxFiles),
      "--retries", "3", "--fragment-retries", "3", "--socket-timeout", "30",
      "-N", "1", "--max-filesize", "60M",
      "--restrict-filenames", "-f", "bv*[ext=mp4]+ba[ext=m4a]/b[ext=mp4]/b",
      "--merge-output-format", "mp4",
      "-o", path.join(workDir, "%(playlist_index)s_%(id)s.%(ext)s"),
    ];
    if (cookies) ytArgs.push("--cookies", cookies);
    ytArgs.push(url);
    try {
      await run(resolveBinary("yt-dlp", "YTDLP_PATH"), ytArgs);
    } catch (error) {
      lastError = error;
      console.warn("[Twitter/X] yt-dlp:", error?.message || error);
    }
    let files = listDownloadedMedia(workDir, maxFiles);
    if (files.length) return { files, cleanup: clean };

    // A photo-only post may have no playable video for yt-dlp; gallery-dl
    // retrieves the public images, GIF-derived videos and mixed galleries.
    const galleryArgs = [
      "--no-input", "--range", "1-" + maxFiles,
      "--directory", workDir,
    ];
    if (cookies) galleryArgs.push("--cookies", cookies);
    galleryArgs.push(url);
    try {
      await run(resolveBinary("gallery-dl", "GALLERYDL_PATH"), galleryArgs);
    } catch (error) {
      lastError = error;
      console.warn("[Twitter/X] gallery-dl:", error?.message || error);
    }
    files = listDownloadedMedia(workDir, maxFiles);
    if (files.length) return { files, cleanup: clean };

    throw lastError || new Error("No supported photo or video was found in this post.");
  } catch (error) {
    clean();
    throw error;
  }
}

async function sendTwitterMedia(message, input) {
  const { files, cleanup } = await downloadTwitterMedia(input);
  try {
    for (const file of files) {
      const ext = path.extname(file).toLowerCase();
      const type = IMAGE_EXTENSIONS.has(ext) ? "image" : "video";
      await message.sendMessage({ url: file }, type, {
        quoted: message.data,
        ...(type === "video" ? { mimetype: "video/mp4" } : {}),
      });
    }
    return files.length;
  } finally {
    cleanup();
  }
}

module.exports = {
  normalizeTwitterUrl,
  findTwitterUrl,
  downloadTwitterMedia,
  sendTwitterMedia,
  twitterFailureReason,
};
