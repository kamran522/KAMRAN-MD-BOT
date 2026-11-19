"use strict";

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { Readable, Transform } = require("node:stream");
const { pipeline } = require("node:stream/promises");

const ARCHIVE_HOST = "archive.org";
const MAX_WHATSAPP_BYTES = 80 * 1024 * 1024;
const MIN_FEATURE_SECONDS = 40 * 60;
const MAX_RESULTS = 6;
const MOVIE_FORMATS = new Set([".mp4", ".m4v", ".webm"]);
const LICENSE_PATTERN = /https?:\/\/(?:www\.)?creativecommons\.org\/(?:publicdomain\/(?:zero|mark)\/\d+(?:\.\d+)?|licenses\/(?:by|by-sa|by-nd|by-nc|by-nc-sa|by-nc-nd)\/\d+(?:\.\d+)?)(?:\/|[?#]|$)/i;

function cleanQuery(input) {
  const text = String(input || "").replace(/\s+/g, " ").trim();
  if (text.length < 2 || text.length > 100) {
    throw new Error("Enter a movie name between 2 and 100 characters.");
  }
  const words = text.match(/[\p{L}\p{N}]+/gu) || [];
  if (!words.length) throw new Error("Enter a movie title.");
  return words.slice(0, 12);
}

function declaredLicense(input) {
  const strings = Array.isArray(input) ? input : [input];
  for (const value of strings) {
    const match = String(value || "").match(LICENSE_PATTERN);
    if (match) return match[0].replace(/[?#].*$/, "").replace(/\/?$/, "/");
  }
  return null;
}

function licenseLabel(url) {
  if (!url) return "Unknown";
  const pd = url.match(/\/publicdomain\/(zero|mark)\//i);
  if (pd) return pd[1].toLowerCase() === "zero" ? "CC0" : "Public Domain Mark";
  const cc = url.match(/\/licenses\/([^/]+)\//);
  return cc ? "CC " + cc[1].toUpperCase() : "Creative Commons";
}

function safeIdentifier(input) {
  const id = String(input || "");
  if (!/^[A-Za-z0-9_.-]{1,128}$/.test(id) || id === "." || id === "..") {
    throw new Error("Invalid Internet Archive item identifier.");
  }
  return id;
}

function safeFilename(input) {
  const name = String(input || "");
  if (!name || name.length > 250 || name.includes("\\") || /[\x00-\x1f]/.test(name)) {
    throw new Error("Unsafe movie filename.");
  }
  const parts = name.split("/");
  if (parts.some((part) => !part || part === "." || part === "..")) {
    throw new Error("Unsafe movie filename.");
  }
  return parts.map(encodeURIComponent).join("/");
}

function movieDownloadUrl(identifier, filename) {
  return "https://archive.org/download/" + encodeURIComponent(safeIdentifier(identifier)) + "/" + safeFilename(filename);
}

async function fetchJson(url, fetchImpl = fetch) {
  const res = await fetchImpl(url, {
    signal: AbortSignal.timeout(16000),
    headers: { "Accept": "application/json" },
  });
  if (!res?.ok) throw new Error("Movie catalog HTTP " + (res?.status || "unavailable"));
  const data = await res.json();
  if (!data || typeof data !== "object") throw new Error("Invalid movie catalog response");
  return data;
}

async function searchMovies(query, { fetchImpl = fetch } = {}) {
  const words = cleanQuery(query);
  const params = new URLSearchParams();
  // Internet Archive full-text search. Require explicit license metadata;
  // the item's exact license is checked again before returning a download.
  params.set("q", "mediatype:movies AND licenseurl:* AND title:(" + words.map((w) => '"' + w + '"').join(" ") + ")");
  for (const field of ["identifier", "title", "year", "date", "licenseurl", "downloads"]) {
    params.append("fl[]", field);
  }
  params.set("rows", "60");
  params.set("page", "1");
  params.append("sort[]", "downloads desc");
  params.set("output", "json");
  const response = await fetchJson("https://archive.org/advancedsearch.php?" + params, fetchImpl);
  const docs = Array.isArray(response?.response?.docs) ? response.response.docs : [];
  const output = [];
  const seen = new Set();
  for (const item of docs) {
    let id;
    try { id = safeIdentifier(item.identifier); } catch (_) { continue; }
    const licenseUrl = declaredLicense(item.licenseurl);
    if (!licenseUrl || seen.has(id)) continue;
    const title = String(Array.isArray(item.title) ? item.title[0] : item.title || "").trim().slice(0, 170);
    if (!title) continue;
    const year = String(item.year || item.date || "").match(/\b(?:18|19|20)\d{2}\b/)?.[0] || "";
    output.push({ identifier: id, title, year, licenseUrl, license: licenseLabel(licenseUrl) });
    seen.add(id);
    if (output.length === MAX_RESULTS) break;
  }
  return output;
}

function parseSeconds(value) {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (!value) return null;
  const text = String(value).trim();
  if (/^\d+(?:\.\d+)?$/.test(text)) return Number(text);
  if (!/^\d{1,3}:\d{2}(?::\d{2})?$/.test(text)) return null;
  const parts = text.split(":").map(Number);
  return parts.reduce((seconds, part) => seconds * 60 + part, 0);
}

async function getMovieDetails(identifier, { fetchImpl = fetch } = {}) {
  const id = safeIdentifier(identifier);
  const item = await fetchJson("https://archive.org/metadata/" + encodeURIComponent(id), fetchImpl);
  const metadata = item.metadata || {};
  const licenseUrl = declaredLicense(metadata.licenseurl);
  if (!licenseUrl) throw new Error("This archive item does not declare a supported sharing license.");
  if (metadata.mediatype !== "movies" || item.is_dark || item.is_dark === "true") {
    throw new Error("This item is not a public movie download.");
  }
  const files = (Array.isArray(item.files) ? item.files : []).flatMap((file) => {
    const filename = String(file?.name || "");
    try { safeFilename(filename); } catch (_) { return []; }
    const ext = path.posix.extname(filename).toLowerCase();
    const bytes = Number(file?.size);
    if (!MOVIE_FORMATS.has(ext) || !Number.isSafeInteger(bytes) ||
        bytes < 12 * 1024 * 1024 || file.private === true || file.private === "true" ||
        /\b(?:trailer|preview|sample|clip|thumbnail)\b/i.test(filename)) return [];
    const duration = parseSeconds(file.length);
    if (duration !== null && duration < MIN_FEATURE_SECONDS) return [];
    return [{
      name: filename, size: bytes, ext, duration,
      url: movieDownloadUrl(id, filename),
      source: file.source || "",
    }];
  }).sort((a, b) => {
    // Prefer MP4, then full-sized original media; avoid short low-res previews.
    const p = (f) => (f.ext === ".mp4" ? 10 : f.ext === ".m4v" ? 5 : 0);
    return p(b) - p(a) || b.size - a.size;
  });
  if (!files.length) throw new Error("No full-length MP4/WebM download file is listed for this movie.");
  return {
    identifier: id,
    title: String(Array.isArray(metadata.title) ? metadata.title[0] : metadata.title || id).slice(0, 180),
    creator: String(Array.isArray(metadata.creator) ? metadata.creator.join(", ") : metadata.creator || "").slice(0, 120),
    licenseUrl, license: licenseLabel(licenseUrl),
    page: "https://archive.org/details/" + encodeURIComponent(id),
    file: files[0],
  };
}

function friendlySize(bytes) {
  const num = Number(bytes);
  return num >= 1024 ** 3 ? (num / 1024 ** 3).toFixed(2) + " GB"
    : (num / 1024 ** 2).toFixed(1) + " MB";
}

async function downloadMovieToTemp(movie, { fetchImpl = fetch, maxBytes = MAX_WHATSAPP_BYTES } = {}) {
  if (!movie?.file?.url || !movie.file.size || movie.file.size > maxBytes) {
    throw new Error("Movie exceeds WhatsApp upload limit; use the archive download link.");
  }
  // Download only the canonical link computed from validated metadata.
  const url = movieDownloadUrl(movie.identifier, movie.file.name);
  const res = await fetchImpl(url, { signal: AbortSignal.timeout(10 * 60 * 1000) });
  if (!res?.ok || !res.body) throw new Error("Movie download HTTP " + (res?.status || "unavailable"));
  if (res.url) {
    const host = new URL(res.url).hostname;
    if (host !== ARCHIVE_HOST && !host.endsWith("." + ARCHIVE_HOST)) {
      throw new Error("Unexpected movie download redirect.");
    }
  }
  const headerSize = Number(res.headers?.get?.("content-length") || 0);
  if (headerSize > maxBytes) throw new Error("Movie exceeds WhatsApp upload limit.");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "kamran-movie-"));
  const file = path.join(dir, "film" + movie.file.ext);
  try {
    let downloaded = 0;
    const counter = new Transform({
      transform(chunk, encoding, callback) {
        downloaded += chunk.length;
        if (downloaded > maxBytes) callback(new Error("Movie exceeds WhatsApp upload limit."));
        else callback(null, chunk);
      },
    });
    await pipeline(Readable.fromWeb(res.body), counter, fs.createWriteStream(file));
    if (!downloaded) throw new Error("The movie download was empty.");
    return { path: file, cleanup() { fs.rmSync(dir, { recursive: true, force: true }); } };
  } catch (error) {
    fs.rmSync(dir, { recursive: true, force: true });
    throw error;
  }
}

module.exports = {
  MAX_WHATSAPP_BYTES,
  cleanQuery,
  declaredLicense,
  licenseLabel,
  safeIdentifier,
  movieDownloadUrl,
  searchMovies,
  getMovieDetails,
  downloadMovieToTemp,
  friendlySize,
};
