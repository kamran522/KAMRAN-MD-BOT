'use strict';
const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const { selectBrowserIdentity } = require('../core/wa-link-browser');

test('Business pairing opts into SMB_Android protocol label only when enabled', () => {
  const original = ['Ubuntu', 'Chrome', '20.0.04'];
  assert.equal(selectBrowserIdentity(original, {}), original);
  assert.equal(selectBrowserIdentity(original, { WA_BUSINESS_LINK: '0' }), original);
  assert.equal(selectBrowserIdentity(original, { WA_BUSINESS_LINK: 'false' }), original);
  assert.deepEqual(selectBrowserIdentity(original, { WA_BUSINESS_LINK: '1' }),
    ['Android', 'SMB_Android', '14.4.1']);
  assert.deepEqual(selectBrowserIdentity(original, { WA_BUSINESS_LINK: 'true' }),
    ['Android', 'SMB_Android', '14.4.1']);
  assert.equal(selectBrowserIdentity(original, { WA_BUSINESS_LINK: '1' })[1], 'SMB_Android');
  assert.deepEqual(original, ['Ubuntu', 'Chrome', '20.0.04']);
});

test('WhatsApp socket uses current WA Web version with safe fallback', () => {
  const code = fs.readFileSync(path.join(__dirname, '../core/bot.js'), 'utf8');
  assert.match(code, /fetchLatestWaWebVersion:fetchLatestWaWebVersion/);
  assert.match(code, /\(fetchLatestWaWebVersion\|\|fetchLatestBaileysVersion\)\(\)/);
  assert.match(code, /'browser':require\('\.\/wa-link-browser'\)\.selectBrowserIdentity/);
});

test('SMB patch is applied before loading Baileys in the bot entrypoint', () => {
  const entry = fs.readFileSync(path.join(__dirname, '../index.js'), 'utf8');
  const patch = entry.indexOf("require('./scripts/patch-baileys-business').applyBusinessProtocol()");
  const load = entry.indexOf("require('./core/helpers')");
  assert.ok(patch > 0 && patch < load, 'Business patch must run before Baileys is imported');
});
