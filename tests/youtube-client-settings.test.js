'use strict';

const assert = require('node:assert/strict');
const { test, after } = require('node:test');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'kamran-youtube-client-'));
const fakeYtdlp = path.join(root, 'yt-dlp');
const argsLog = path.join(root, 'calls.jsonl');

fs.writeFileSync(fakeYtdlp, [
  '#!/usr/bin/env node',
  "const fs = require('node:fs');",
  "const path = require('node:path');",
  'const args = process.argv.slice(2);',
  "fs.appendFileSync(process.env.FAKE_YT_LOG, JSON.stringify(args) + '\\n');",
  "if (args.includes('-J')) {",
  "  process.stdout.write(JSON.stringify({title: 'YouTube fixture', id: 'dQw4w9WgXcQ', formats: [",
  "    { ext: 'mp4', height: 360, vcodec: 'avc1', acodec: 'none', filesize: 123456 },",
  "    { ext: 'm4a', vcodec: 'none', acodec: 'mp4a', filesize: 12345 },",
  '  ]}));',
  '  process.exit(0);',
  '}',
  "const outputIndex = args.indexOf('-o');",
  'if (outputIndex < 0) process.exit(2);',
  "const file = args[outputIndex + 1].replace('%(ext)s', 'mp4');",
  'fs.mkdirSync(path.dirname(file), { recursive: true });',
  'fs.writeFileSync(file, Buffer.alloc(16, 7));',
].join('\n'), 'utf8');
fs.chmodSync(fakeYtdlp, 0o755);
const envKeys = ['YTDLP_PATH', 'YTDLP_PLAYER_CLIENT', 'YTDLP_JS_RUNTIME', 'YTDLP_ARGS', 'FAKE_YT_LOG'];
const priorEnv = Object.fromEntries(envKeys.map(key => [key, process.env[key]]));
process.env.YTDLP_PATH = fakeYtdlp;
process.env.FAKE_YT_LOG = argsLog;
delete process.env.YTDLP_PLAYER_CLIENT;
delete process.env.YTDLP_JS_RUNTIME;
delete process.env.YTDLP_ARGS;
const services = require('../core/services');

after(() => {
  for (const [key, value] of Object.entries(priorEnv)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  fs.rmSync(root, { recursive: true, force: true });
});

function getLastArgs() {
  return JSON.parse(fs.readFileSync(argsLog, 'utf8').trim().split('\n').at(-1));
}

const youtubeUrl = 'https://www.youtube.com/watch?v=dQw4w9WgXcQ';

test('metadata uses yt-dlp defaults and enables Node.js for challenge solving', async () => {
  await services.ytInfo(youtubeUrl);
  const args = getLastArgs();
  assert.ok(args.includes('-J'));
  assert.equal(args.includes('--extractor-args'), false);
  assert.equal(args[args.indexOf('--js-runtimes') + 1], 'node');
});

test('download uses the same runtime configuration', async () => {
  const saved = await services.ytDownloadToFile(youtubeUrl, '360p', path.join(root, 'video'));
  assert.ok(fs.statSync(saved).size > 0);
  const args = getLastArgs();
  assert.equal(args[args.indexOf('--js-runtimes') + 1], 'node');
  assert.equal(args.includes('--extractor-args'), false);
});

test('explicit YouTube player clients can still be configured', async () => {
  process.env.YTDLP_PLAYER_CLIENT = 'web_safari';
  try {
    await services.ytInfo(youtubeUrl);
    const args = getLastArgs();
    assert.equal(args[args.indexOf('--extractor-args') + 1], 'youtube:player_client=web_safari');
  } finally {
    delete process.env.YTDLP_PLAYER_CLIENT;
  }
});

test('JavaScript runtime can be overridden or disabled', async () => {
  process.env.YTDLP_JS_RUNTIME = 'deno';
  try {
    await services.ytInfo(youtubeUrl);
    let args = getLastArgs();
    assert.equal(args[args.indexOf('--js-runtimes') + 1], 'deno');
    process.env.YTDLP_JS_RUNTIME = 'off';
    await services.ytInfo(youtubeUrl);
    args = getLastArgs();
    assert.equal(args.includes('--js-runtimes'), false);
  } finally {
    delete process.env.YTDLP_JS_RUNTIME;
  }
});
