"use strict";
/**
 * core/services.js
 *
 * Open-source replacement for the former closed-source `core/private.js`.
 *
 * Design rules
 *  - Everything runs on YOUR machine. No request is ever sent to a server owned by the
 *    original bot authors (no session backend, no announcement feed, no download proxies,
 *    no version/session-count reporting).
 *  - Media downloads are done locally with `yt-dlp` (open source, https://github.com/yt-dlp/yt-dlp)
 *    which talks only to the site whose link you gave it (YouTube, TikTok, Facebook, ...).
 *  - Conversions use your local `ffmpeg` and libwebp tools (`anim_dump`).
 *  - Features that cannot be done locally without a third-party service are disabled and
 *    throw a clear error instead of silently calling someone's server.
 *
 * Environment variables (all optional)
 *  YTDLP_PATH     path to the yt-dlp binary            (default: "yt-dlp")
 *  YTDLP_ARGS     extra yt-dlp arguments, space-separated, e.g. "--js-runtimes node"
 *  YTDLP_USER_AGENT optional browser User-Agent for sites such as TikTok
 *  YTDLP_COOKIES  path to a cookies.txt file (needed by Instagram and some YouTube videos)
 *  ACR_HOST, ACR_ACCESS_KEY, ACR_ACCESS_SECRET   YOUR OWN ACRCloud project (music identify)
 */

const fs = require("fs");
const os = require("os");
const path = require("path");
const { execFile } = require("child_process");
const { Readable } = require("stream");
const { pipeline } = require("stream/promises");

// ---------------------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------------------

function tmpDir(name) {
  let dir;
  try {
    dir = require("./helpers").getTempSubdir(name);
  } catch (_) {
    dir = path.join(os.tmpdir(), "kamran-bot", name);
  }
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

const uid = () => `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

function run(cmd, args, { timeout = 120000, input } = {}) {
  return new Promise((resolve, reject) => {
    const child = execFile(
      cmd,
      args,
      { timeout, maxBuffer: 128 * 1024 * 1024, windowsHide: true },
      (err, stdout, stderr) => {
        if (err) {
          if (err.code === "ENOENT") {
            return reject(
              new Error(
                `"${cmd}" was not found. Install it (yt-dlp: https://github.com/yt-dlp/yt-dlp , ` +
                  `ffmpeg/webp: apt install ffmpeg webp) or set YTDLP_PATH.`,
              ),
            );
          }
          const detail = String(stderr || err.message).trim().split("\n").slice(-3).join(" | ");
          return reject(new Error(`${path.basename(cmd)} failed: ${detail}`));
        }
        resolve({ stdout: String(stdout), stderr: String(stderr) });
      },
    );
    if (input) child.stdin.end(input);
  });
}

function ytdlpBase() {
  // retries + parallel fragments + socket timeout = fewer failed / stalled downloads
  const args = ["--no-warnings", "--no-playlist", "--retries", "4", "--fragment-retries", "4", "--socket-timeout", "30", "-N", "4"];
  if (process.env.YTDLP_COOKIES) args.push("--cookies", process.env.YTDLP_COOKIES);
  if (process.env.YTDLP_ARGS) args.push(...process.env.YTDLP_ARGS.split(/\s+/).filter(Boolean));
  return args;
}

const ytdlp = (args, opts) => run(process.env.YTDLP_PATH || "yt-dlp", [...ytdlpBase(), ...args], opts);

const normalizeYoutube = (u) => (/^[\w-]{11}$/.test(String(u)) ? `https://www.youtube.com/watch?v=${u}` : String(u));

/** Download one URL with yt-dlp into a temp dir and return the produced file paths. */
async function downloadFiles(url, { playlist = false, format, userAgent } = {}) {
  const dir = tmpDir("dl");
  const id = uid();
  const args = ["-o", path.join(dir, `${id}_%(autonumber)s.%(ext)s`)];
  if (playlist) args.push("--yes-playlist", "--max-downloads", "10");
  args.push("-f", format || "b[ext=mp4]/bv*[ext=mp4]+ba[ext=m4a]/b", "--merge-output-format", "mp4");
  if (userAgent) args.push("--user-agent", userAgent);
  args.push(url);
  try {
    await ytdlp(args, { timeout: 10 * 60 * 1000 });
  } catch (e) {
    // --max-downloads makes yt-dlp exit non-zero once the cap is hit; keep what we got
    if (!/max-downloads|Maximum number of downloads/i.test(e.message)) throw e;
  }
  const files = fs
    .readdirSync(dir)
    .filter((n) => n.startsWith(id + "_"))
    .sort()
    .map((n) => path.join(dir, n));
  if (!files.length) throw new Error("Nothing could be downloaded from that link");
  return files;
}

const unsupported = (what, hint) => {
  throw new Error(
    `${what} is not available in this open-source build because it required the original authors' ` +
      `private servers.${hint ? " " + hint : ""}`,
  );
};

// ---------------------------------------------------------------------------------------
// Session / remote-control hooks: intentionally inert
// ---------------------------------------------------------------------------------------

/** Sessions are created and stored locally only (QR code or pairing code). */
async function fetchInitialSession() {
  return null;
}

/** No announcement feed, no telemetry, no remote messages. */
function createAnnouncementFeed() {
  return { refresh() {}, close() {} };
}

async function apiCall() {
  return unsupported("apiCall");
}

// ---------------------------------------------------------------------------------------
// YouTube (local yt-dlp)
// ---------------------------------------------------------------------------------------

/**
 * Metadata + available qualities. `isRestricted: true` tells plugins/utils/yt.js to download
 * through ytDownloadToFile() (local yt-dlp + ffmpeg) instead of raw CDN URLs.
 */
async function ytInfo(input) {
  const url = normalizeYoutube(input);
  const { stdout } = await ytdlp(["-J", url], { timeout: 120000 });
  const j = JSON.parse(stdout);
  const page = j.webpage_url || url;

  const sizes = new Map(); // height -> approx size
  for (const f of j.formats || []) {
    if (f.vcodec && f.vcodec !== "none" && f.height) {
      const size = f.filesize || f.filesize_approx || null;
      if (!sizes.has(f.height) || (size && size > sizes.get(f.height))) sizes.set(f.height, size);
    }
  }
  const video = [...sizes.keys()]
    .sort((a, b) => a - b)
    .map((h) => ({ quality: `${h}p`, url: page, hasAudio: false, size: sizes.get(h), requiresExternalDownload: true }));
  const bestAudio = (j.formats || []).filter((f) => f.acodec && f.acodec !== "none" && (!f.vcodec || f.vcodec === "none"));
  const audio = [
    {
      quality: "audio",
      url: page,
      hasAudio: true,
      size: bestAudio.length ? bestAudio[bestAudio.length - 1].filesize || null : null,
      requiresExternalDownload: true,
    },
  ];
  return {
    title: j.title,
    videoId: j.id,
    duration: j.duration,
    thumbnail: j.thumbnail,
    channel: j.channel || j.uploader,
    isRestricted: true,
    audio,
    video,
  };
}

/**
 * Download a YouTube video/audio to a local file and return its path.
 * @param {string} input   URL or 11-char video id
 * @param {string} quality "audio" | "mp3" | "m4a" | "360p" | "720p" | ...
 * @param {string} dir     destination directory
 */
async function ytDownloadToFile(input, quality = "360p", dir = tmpDir("yt")) {
  const url = normalizeYoutube(input);
  const isAudio = /^(audio|mp3|m4a)$/i.test(String(quality));
  const id = uid();
  const args = ["-o", path.join(dir, `${id}.%(ext)s`)];
  if (isAudio) {
    args.push("-f", "bestaudio[ext=m4a]/bestaudio/best");
  } else {
    const h = parseInt(quality, 10) || 360;
    args.push(
      "-f",
      `bestvideo[height<=${h}][ext=mp4]+bestaudio[ext=m4a]/best[height<=${h}][ext=mp4]/bestvideo[height<=${h}]+bestaudio/best[height<=${h}]/best`,
      "--merge-output-format",
      "mp4",
    );
  }
  args.push(url);
  await ytdlp(args, { timeout: 15 * 60 * 1000 });
  const file = fs.readdirSync(dir).find((n) => n.startsWith(id + "."));
  if (!file) throw new Error("yt-dlp finished but produced no file");
  return path.join(dir, file);
}

// ---------------------------------------------------------------------------------------
// Social downloaders (local yt-dlp) -> files are stored locally and returned as local paths.
// Baileys accepts { url: "/local/path" } so the existing plugins keep working unchanged.
// ---------------------------------------------------------------------------------------

const SOCIAL_USER_AGENT = process.env.YTDLP_USER_AGENT ||
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/157.0.0.0 Safari/537.36 Edg/157.0.0.0";

function validateSocialUrl(input, platform) {
  let parsed;
  try {
    parsed = new URL(String(input || "").trim());
  } catch (_) {
    throw new Error("Please provide a valid social-media URL.");
  }
  if (!["http:", "https:"].includes(parsed.protocol)) {
    throw new Error("Only HTTP and HTTPS links are supported.");
  }
  const allowedHosts = {
    instagram: ["instagram.com", "instagr.am"],
    tiktok: ["tiktok.com"],
  }[platform];
  if (!allowedHosts || !allowedHosts.some(
    (host) => parsed.hostname === host || parsed.hostname.endsWith("." + host)
  )) {
    throw new Error(`That link is not a supported ${platform} URL.`);
  }
  return parsed.href;
}

function selectDirectVideoFormat(entry) {
  const formats = Array.isArray(entry?.formats) ? entry.formats : [];
  const candidates = formats.filter(
    (format) => format?.url && format.vcodec && format.vcodec !== "none" &&
      /^https?:\/\//i.test(format.url),
  );
  candidates.sort((a, b) => {
    const score = (format) =>
      (format.ext === "mp4" ? 100000 : 0) +
      (format.acodec && format.acodec !== "none" ? 50000 : 0) +
      (Number(format.height) || 0);
    return score(b) - score(a);
  });
  if (candidates.length) return candidates[0];
  if (entry?.url && /^https?:\/\//i.test(entry.url) &&
      (!entry.vcodec || entry.vcodec !== "none")) return entry;
  return null;
}

/** Extract locally with yt-dlp, then stream the returned media URL directly to disk. */
async function downloadExtractedMedia(entry, sourceUrl, directory, index) {
  const format = selectDirectVideoFormat(entry);
  if (!format?.url) return null;
  const mediaUrl = new URL(format.url);
  if (!["http:", "https:"].includes(mediaUrl.protocol)) {
    throw new Error("The extractor returned an unsupported media URL.");
  }
  const extension = /^[a-z0-9]{2,5}$/i.test(String(format.ext || ""))
    ? format.ext.toLowerCase() : "mp4";
  const filePath = path.join(directory, `${uid()}_${index}.${extension}`);
  const headers = { ...(entry.http_headers || {}), ...(format.http_headers || {}) };
  if (!Object.keys(headers).some((key) => key.toLowerCase() === "user-agent")) {
    headers["User-Agent"] = SOCIAL_USER_AGENT;
  }
  if (!Object.keys(headers).some((key) => key.toLowerCase() === "referer")) {
    headers.Referer = sourceUrl;
  }
  const response = await fetch(mediaUrl, {
    headers, signal: AbortSignal.timeout(120000),
  });
  if (!response.ok || !response.body) {
    throw new Error(`Direct media request failed with HTTP ${response.status}.`);
  }
  const contentType = (response.headers.get("content-type") || "").toLowerCase();
  if (contentType.includes("text/html") || contentType.includes("application/json")) {
    throw new Error("The media URL returned a page instead of a video.");
  }
  try {
    await pipeline(Readable.fromWeb(response.body), fs.createWriteStream(filePath));
    const stat = await fs.promises.stat(filePath);
    if (!stat.size) throw new Error("The extracted media file is empty.");
    return filePath;
  } catch (error) {
    await fs.promises.rm(filePath, { force: true }).catch(() => {});
    throw error;
  }
}

async function downloadWithExtractedUrls(url, platform) {
  const directory = tmpDir(`${platform}-direct`);
  const args = ["--dump-single-json"];
  if (platform === "tiktok") args.push("--user-agent", SOCIAL_USER_AGENT);
  if (platform === "instagram") args.push("--yes-playlist", "--playlist-end", "10");
  args.push(url);
  const { stdout } = await ytdlp(args, { timeout: 180000 });
  let metadata;
  try {
    metadata = JSON.parse(stdout);
  } catch (_) {
    throw new Error("yt-dlp did not return valid media metadata.");
  }
  const entries = Array.isArray(metadata.entries)
    ? metadata.entries.filter(Boolean).slice(0, platform === "instagram" ? 10 : 1)
    : [metadata];
  const downloaded = [];
  const failures = [];
  for (let index = 0; index < entries.length; index++) {
    try {
      const file = await downloadExtractedMedia(entries[index], url, directory, index);
      if (file) downloaded.push(file);
    } catch (error) {
      failures.push(error.message);
    }
  }
  if (!downloaded.length) {
    throw new Error(failures[0] || "No direct video URL was found.");
  }
  return downloaded;
}

async function downloadSocialMedia(input, platform) {
  const url = validateSocialUrl(input, platform);
  try {
    return await downloadFiles(url, {
      playlist: platform === "instagram",
      format: "best[ext=mp4]/best",
      userAgent: platform === "tiktok" ? SOCIAL_USER_AGENT : undefined,
    });
  } catch (primaryError) {
    try {
      return await downloadWithExtractedUrls(url, platform);
    } catch (fallbackError) {
      throw new Error(
        `${platform} download failed. yt-dlp: ${primaryError.message}; direct-stream fallback: ${fallbackError.message}`,
      );
    }
  }
}

/** Instagram posts/reels -> local media files. Private posts may need YTDLP_COOKIES. */
async function instagram(url) {
  return downloadSocialMedia(url, "instagram");
}

async function facebook(url) {
  const [file] = await downloadFiles(url);
  return { url: file };
}

/** TikTok -> local video file with the extractor/direct-stream fallback. */
async function tiktok(url) {
  const [file] = await downloadSocialMedia(url, "tiktok");
  return { url: file };
}

async function pinterestDl(url) {
  const [file] = await downloadFiles(url, { format: "b/bv*+ba" });
  return { status: true, result: file };
}

/** Reads only the public title of the Spotify page you linked (no Spotify login/API). */
async function spotifyTrack(url) {
  const res = await fetch(String(url), {
    headers: { "User-Agent": "Mozilla/5.0 (compatible; open-source-bot)" },
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) throw new Error(`Spotify page returned HTTP ${res.status}`);
  const html = await res.text();
  const title = (html.match(/<title>([^<]+)<\/title>/i) || [])[1] || "";
  const m = title.match(/^(.*?)\s+-\s+(?:song|single|track)(?:\s+and\s+lyrics)?\s+by\s+(.*?)\s*\|\s*Spotify$/i);
  if (!m) throw new Error("Could not read the track title from that Spotify link");
  return { title: m[1].trim(), artist: m[2].trim() };
}

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";

/** Public Instagram profile info, fetched straight from instagram.com from YOUR machine. */
async function igStalk(username) {
  const user = decodeURIComponent(String(username || "")).replace(/^@/, "").trim();
  if (!/^[\w.]{1,30}$/.test(user)) throw new Error("Invalid Instagram username");
  const res = await fetch(
    `https://i.instagram.com/api/v1/users/web_profile_info/?username=${encodeURIComponent(user)}`,
    { headers: { "User-Agent": UA, "x-ig-app-id": "936619743392459" }, signal: AbortSignal.timeout(20000) },
  );
  if (!res.ok) throw new Error(`Instagram returned HTTP ${res.status} (rate limited or not found)`);
  const u = (await res.json())?.data?.user;
  if (!u) throw new Error("Instagram profile not found");
  return {
    username: u.username,
    full_name: u.full_name || user,
    bio: u.biography || "",
    followers: u.edge_followed_by?.count ?? 0,
    following: u.edge_follow?.count ?? 0,
    posts: u.edge_owner_to_timeline_media?.count ?? 0,
    is_private: !!u.is_private,
    profile_pic: u.profile_pic_url_hd || u.profile_pic_url,
  };
}

/** Stories are downloaded through yt-dlp. Instagram only serves them to logged-in users: set YTDLP_COOKIES. */
async function instagramStory(user) {
  const u = String(user || "");
  const url = /^https?:\/\//i.test(u) ? u : `https://www.instagram.com/stories/${u.replace(/^@/, "")}/`;
  if (!process.env.YTDLP_COOKIES) {
    throw new Error("Instagram stories need a logged-in cookies file: set YTDLP_COOKIES=/path/cookies.txt");
  }
  return instagram(url);
}

/** Pinterest image search through Pinterest's own public search endpoint. Returns { status, result: [imageUrl] }. */
async function pinterestSearch(query, limit = 5) {
  const q = String(query || "").trim();
  if (!q) return { status: false, result: [] };
  const data = JSON.stringify({ options: { query: q, scope: "pins" }, context: {} });
  const res = await fetch(
    `https://www.pinterest.com/resource/BaseSearchResource/get/?source_url=${encodeURIComponent("/search/pins/?q=" + q)}&data=${encodeURIComponent(data)}`,
    { headers: { "User-Agent": UA, "x-pinterest-pws-handler": "www/search/[scope].js", Accept: "application/json" }, signal: AbortSignal.timeout(20000) },
  );
  if (!res.ok) throw new Error(`Pinterest returned HTTP ${res.status}`);
  const pins = (await res.json())?.resource_response?.data?.results || [];
  const urls = pins
    .map((p) => p?.images?.orig?.url || p?.images?.["736x"]?.url)
    .filter(Boolean)
    .slice(0, Math.max(1, Number(limit) || 5));
  return { status: urls.length > 0, result: urls };
}

/** Lyrics from lrclib.net (free, open-source community lyrics database). Returns { title, artist, lyrics }. */
async function lyrics(query) {
  const q = String(query || "").trim();
  if (!q) throw new Error("Need a song name");
  const res = await fetch(`https://lrclib.net/api/search?q=${encodeURIComponent(q)}`, {
    headers: { "User-Agent": "wa-bot-open-build" },
    signal: AbortSignal.timeout(20000),
  });
  if (!res.ok) throw new Error(`lrclib returned HTTP ${res.status}`);
  const hit = (await res.json()).find((r) => r.plainLyrics);
  if (!hit) throw new Error("No lyrics found");
  return { title: hit.trackName, artist: hit.artistName, lyrics: hit.plainLyrics };
}

// ---------------------------------------------------------------------------------------
// Music identification (your own ACRCloud account; opt-in)
// ---------------------------------------------------------------------------------------

async function identifyMusic(buffer) {
  const { ACR_HOST, ACR_ACCESS_KEY, ACR_ACCESS_SECRET } = process.env;
  if (!ACR_HOST || !ACR_ACCESS_KEY || !ACR_ACCESS_SECRET) {
    throw new Error(
      "Music identification needs YOUR OWN ACRCloud keys: set ACR_HOST, ACR_ACCESS_KEY and ACR_ACCESS_SECRET.",
    );
  }
  const ACRCloud = require("acrcloud");
  const acr = new ACRCloud({ host: ACR_HOST, access_key: ACR_ACCESS_KEY, access_secret: ACR_ACCESS_SECRET });
  const res = await acr.identify(buffer);
  if (!res || !res.status || res.status.code !== 0) return null;
  return res.metadata?.music?.[0] || null;
}

// ---------------------------------------------------------------------------------------
// Local conversions
// ---------------------------------------------------------------------------------------

/** Animated (or still) WebP -> MP4 buffer, using libwebp's anim_dump + ffmpeg. */
async function webpToMp4(inputPath) {
  const dir = tmpDir(`webp2mp4/${uid()}`);
  const out = path.join(dir, "out.mp4");
  const vf = "scale=trunc(iw/2)*2:trunc(ih/2)*2:flags=lanczos,format=yuv420p";
  try {
    const info = (await run("webpmux", ["-info", inputPath]).catch(() => ({ stdout: "" }))).stdout;
    const durations = [];
    for (const line of info.split("\n")) {
      // frame rows: "  1:   512   512   yes        0        0     80    none    no  ..."
      const m = line.match(/^\s*\d+:\s+\d+\s+\d+\s+\S+\s+\d+\s+\d+\s+(\d+)\s/);
      if (m) durations.push(Math.max(parseInt(m[1], 10), 10) / 1000);
    }
    if (durations.length > 1) {
      await run("anim_dump", ["-folder", dir, "-prefix", "f_", inputPath]);
      const frames = fs.readdirSync(dir).filter((n) => /^f_\d+\.png$/.test(n)).sort();
      const list = frames
        .map((n, i) => `file '${path.join(dir, n)}'\nduration ${durations[i] ?? durations[durations.length - 1]}`)
        .concat(frames.length ? [`file '${path.join(dir, frames[frames.length - 1])}'`] : [])
        .join("\n");
      fs.writeFileSync(path.join(dir, "list.txt"), list);
      await run("ffmpeg", [
        "-y", "-f", "concat", "-safe", "0", "-i", path.join(dir, "list.txt"),
        "-vf", vf, "-c:v", "libx264", "-movflags", "+faststart", "-r", "25", "-an", out,
      ], { timeout: 180000 });
    } else {
      await run("ffmpeg", [
        "-y", "-loop", "1", "-i", inputPath, "-t", "2",
        "-vf", vf, "-c:v", "libx264", "-movflags", "+faststart", "-r", "25", "-an", out,
      ], { timeout: 120000 });
    }
    return fs.readFileSync(out);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

/** "Animated text to picture": returns an animated WebP sticker buffer (512x512). */
async function attp(text) {
  const Jimp = require("jimp");
  const dir = tmpDir(`attp/${uid()}`);
  const colors = [0xff489aff, 0x016018ff, 0x8cf5f0ff, 0x750eafff, 0x486eeeff];
  try {
    const clean = String(text || "").trim().slice(0, 200);
    const fontName = clean.length > 40 ? Jimp.FONT_SANS_32_BLACK : Jimp.FONT_SANS_64_BLACK;
    const font = await Jimp.loadFont(fontName);
    const mask = new Jimp(512, 512, 0x00000000);
    mask.print(font, 0, 0, { text: clean, alignmentX: Jimp.HORIZONTAL_ALIGN_CENTER, alignmentY: Jimp.VERTICAL_ALIGN_MIDDLE }, 512, 512);
    for (let i = 0; i < colors.length; i++) {
      const c = Jimp.intToRGBA(colors[i]);
      const frame = mask.clone();
      frame.scan(0, 0, 512, 512, function (x, y, idx) {
        const a = this.bitmap.data[idx + 3];
        if (a > 0) {
          this.bitmap.data[idx] = c.r;
          this.bitmap.data[idx + 1] = c.g;
          this.bitmap.data[idx + 2] = c.b;
        }
      });
      await frame.writeAsync(path.join(dir, `f${i}.png`));
    }
    const out = path.join(dir, "out.webp");
    await run("ffmpeg", [
      "-y", "-framerate", "4", "-i", path.join(dir, "f%d.png"),
      "-vcodec", "libwebp", "-lossless", "1", "-loop", "0", "-an", "-vsync", "0", out,
    ], { timeout: 60000 });
    return fs.readFileSync(out);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

module.exports = {
  fetchInitialSession,
  createAnnouncementFeed,
  apiCall,
  ytInfo,
  ytDownloadToFile,
  instagram,
  instagramStory,
  igStalk,
  facebook,
  tiktok,
  pinterestDl,
  pinterestSearch,
  spotifyTrack,
  lyrics,
  identifyMusic,
  webpToMp4,
  attp,
};
