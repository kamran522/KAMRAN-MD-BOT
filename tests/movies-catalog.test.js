"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const { Readable } = require("node:stream");

const movies = require("../plugins/utils/movies");
const cc0 = "https://creativecommons.org/publicdomain/zero/1.0/";
const ccby = "https://creativecommons.org/licenses/by/4.0/";

function fakeResponse(data) {
  return { ok: true, status: 200, async json() { return data; } };
}

test("movie search uses licensed Internet Archive search with encoded title and filters unlicensed results", async () => {
  let url;
  const records = [
    { identifier: "nightoflivingdead", title: "Night of the Living Dead", year: "1968", licenseurl: cc0 },
    { identifier: "unlicensed", title: "Copyright film", licenseurl: null },
    { identifier: "../unsafe", title: "Unsafe identifier", licenseurl: cc0 },
    { identifier: "creativefilm", title: "Creative Film", licenseurl: ccby },
    { identifier: "nightoflivingdead", title: "Duplicate", licenseurl: cc0 },
    { identifier: "fake-rights", title: "Fake", licenseurl: "https://evil.example/license" },
  ];
  const response = await movies.searchMovies("Night of the Living Dead", {
    async fetchImpl(value) { url = String(value); return fakeResponse({ response: { docs: records } }); },
  });
  const query = new URL(url);
  assert.equal(query.hostname, "archive.org");
  assert.match(query.searchParams.get("q"), /mediatype:movies/);
  assert.match(query.searchParams.get("q"), /licenseurl:\*/);
  assert.match(query.searchParams.get("q"), /Night/);
  assert.deepEqual(response.map(r => r.identifier), ["nightoflivingdead", "creativefilm"]);
  assert.equal(response[0].license, "CC0");
  assert.equal(response[1].license, "CC BY");
});

test("movie name validation limits query size and neutralizes Solr operators", () => {
  assert.throws(() => movies.cleanQuery(""), /movie name/);
  assert.throws(() => movies.cleanQuery("x".repeat(101)), /movie name/);
  assert.deepEqual(movies.cleanQuery('Night AND mediatype:software "test"'), ["Night", "AND", "mediatype", "software", "test"]);
});

test("details verify license a second time and choose a full-length MP4", async () => {
  let target;
  const detail = await movies.getMovieDetails("classic-film", {
    async fetchImpl(url) {
      target = String(url);
      return fakeResponse({
        metadata: { title: "Classic Film", creator: "Public Domain Group", mediatype: "movies", licenseurl: ccby },
        files: [
          { name: "trailer.mp4", size: "20000000", length: "0:01:30" },
          { name: "classic-clip.mp4", size: "20000000", length: "0:03:00" },
          { name: "../unsafe.mp4", size: "30000000" },
          { name: "short.mp4", size: "30000000", length: "0:05:00" },
          { name: "classic film.mp4", size: "120000000", length: "01:28:40" },
          { name: "second.webm", size: "250000000", length: "01:28:40" },
          { name: "secret.mp4", size: "250000000", private: "true" },
        ],
      });
    },
  });
  assert.equal(target, "https://archive.org/metadata/classic-film");
  assert.equal(detail.file.name, "classic film.mp4");
  assert.equal(detail.file.url, "https://archive.org/download/classic-film/classic%20film.mp4");
  assert.equal(detail.license, "CC BY");
});

test("metadata without a supported declared license is not downloadable", async () => {
  const mk = (licenseurl) => ({
    metadata: { mediatype: "movies", title: "Restricted work", licenseurl },
    files: [{ name: "film.mp4", size: "150000000", length: "01:30:00" }],
  });
  await assert.rejects(() => movies.getMovieDetails("restricted", {
    async fetchImpl() { return fakeResponse(mk("All rights reserved")); },
  }), /supported sharing license/);
  await assert.rejects(() => movies.getMovieDetails("restricted", {
    async fetchImpl() { return fakeResponse(mk(undefined)); },
  }), /supported sharing license/);
});

test("download URL and archive identifiers cannot escape the approved host or path", () => {
  assert.throws(() => movies.movieDownloadUrl("../etc", "film.mp4"), /Invalid/);
  assert.throws(() => movies.movieDownloadUrl("good", "../film.mp4"), /Unsafe/);
  assert.throws(() => movies.movieDownloadUrl("good", "https://example.org/film.mp4"), /Unsafe/);
  assert.equal(movies.movieDownloadUrl("good", "film.mp4"), "https://archive.org/download/good/film.mp4");
});

test("small licensed movie downloads to a temporary file with a bounded stream", async () => {
  const movie = { identifier: "classic", file: {
    name: "classic.mp4", ext: ".mp4", size: 25 * 1024 * 1024,
    url: "https://archive.org/download/classic/classic.mp4",
  } };
  let url;
  const result = await movies.downloadMovieToTemp(movie, {
    maxBytes: 2048,
    async fetchImpl(value) {
      url = String(value);
      return {
        ok: true, status: 200, url, headers: { get() { return null; } },
        body: Readable.toWeb(Readable.from([Buffer.alloc(128, 1)])),
      };
    },
  }).catch(e => { assert.match(e.message, /upload limit/); return null; });
  assert.equal(result, null, "Declared sizes must be checked before streaming");

  const small = { ...movie, file: { ...movie.file, size: 1024 } };
  const downloaded = await movies.downloadMovieToTemp(small, {
    maxBytes: 2048,
    async fetchImpl(value) {
      url = String(value);
      return {
        ok: true, status: 200, url, headers: { get() { return "128"; } },
        body: Readable.toWeb(Readable.from([Buffer.alloc(128, 1)])),
      };
    },
  });
  assert.equal(fs.statSync(downloaded.path).size, 128);
  assert.equal(url, "https://archive.org/download/classic/classic.mp4");
  downloaded.cleanup();
  assert.equal(fs.existsSync(downloaded.path), false);
});

test("streaming stops when a server exceeds the declared size limit", async () => {
  const movie = { identifier: "classic", file: { name: "classic.mp4", ext: ".mp4", size: 200,
    url: "https://archive.org/download/classic/classic.mp4" } };
  await assert.rejects(() => movies.downloadMovieToTemp(movie, {
    maxBytes: 250,
    async fetchImpl() {
      return {
        ok: true, status: 200, headers: { get() { return null; } },
        body: Readable.toWeb(Readable.from([Buffer.alloc(150), Buffer.alloc(150)])),
      };
    },
  }), /upload limit/);
});
