'use strict';

const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const { buildChromeOptions } = require('./index');

test('uses a persistent profile and real headless Chromium by default', () => {
  const opts = buildChromeOptions({});
  assert.ok(path.isAbsolute(opts.authDirectory));
  assert.equal(opts.puppeteer.headless, true);
  assert.equal(opts.puppeteer.executablePath, undefined);
  assert.ok(opts.puppeteer.args.includes('--disable-dev-shm-usage'));
  assert.ok(!opts.puppeteer.args.includes('--no-sandbox'));
});

test('allows explicit Chrome executable without disabling sandbox', () => {
  const opts = buildChromeOptions({
    KAMRAN_CHROME_AUTH_DIR: '/tmp/test-chrome-session',
    CHROME_EXECUTABLE_PATH: '/usr/bin/google-chrome'
  });
  assert.equal(opts.authDirectory, '/tmp/test-chrome-session');
  assert.equal(opts.puppeteer.executablePath, '/usr/bin/google-chrome');
  assert.ok(!opts.puppeteer.args.includes('--no-sandbox'));
});

test('sandbox bypass requires a separate opt-in', () => {
  const opts = buildChromeOptions({ CHROME_NO_SANDBOX: '1' });
  assert.ok(opts.puppeteer.args.includes('--no-sandbox'));
  assert.ok(opts.puppeteer.args.includes('--disable-setuid-sandbox'));
});

test('browser probe does not load Baileys or pretend to run its plugins', () => {
  const script = fs.readFileSync(path.join(__dirname, 'index.js'), 'utf8');
  assert.match(script, /require\('whatsapp-web\.js'\)/);
  assert.match(script, /new LocalAuth/);
  assert.match(script, /client\.on\('ready'/);
  assert.match(script, /qrcode\.generate/);
  assert.doesNotMatch(script, /require\(['"]baileys['"]\)/);
});
