'use strict';
const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const { selectBrowserIdentity } = require('../core/wa-link-browser');

test('Business pairing uses desktop identity only when explicitly opted in', () => {
  const original = ['Ubuntu', 'Chrome', '20.0.04'];
  assert.equal(selectBrowserIdentity(original, {}), original);
  assert.equal(selectBrowserIdentity(original, { WA_BUSINESS_LINK: '0' }), original);
  assert.equal(selectBrowserIdentity(original, { WA_BUSINESS_LINK: 'false' }), original);
  assert.deepEqual(selectBrowserIdentity(original, { WA_BUSINESS_LINK: '1' }),
    ['Mac OS', 'Desktop', '14.4.1']);
  assert.deepEqual(selectBrowserIdentity(original, { WA_BUSINESS_LINK: 'true' }),
    ['Mac OS', 'Desktop', '14.4.1']);
  assert.deepEqual(original, ['Ubuntu', 'Chrome', '20.0.04']);
});

test('WhatsApp socket uses current WA Web version with safe fallback', () => {
  const code = fs.readFileSync(path.join(__dirname, '../core/bot.js'), 'utf8');
  assert.match(code, /fetchLatestWaWebVersion:fetchLatestWaWebVersion/);
  assert.match(code, /\(fetchLatestWaWebVersion\|\|fetchLatestBaileysVersion\)\(\)/);
  assert.match(code, /'browser':require\('\.\/wa-link-browser'\)\.selectBrowserIdentity/);
});
