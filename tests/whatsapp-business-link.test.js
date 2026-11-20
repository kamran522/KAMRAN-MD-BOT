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
  assert.match(code, /'browser':_0xwaBrowserIdentity/);
  assert.match(code, /require\('\.\/wa-link-browser'\)\.selectBrowserIdentity/);
});

test('SMB patch is applied before loading Baileys in the bot entrypoint', () => {
  const entry = fs.readFileSync(path.join(__dirname, '../index.js'), 'utf8');
  const patch = entry.indexOf("require('./scripts/patch-baileys-business').applyBusinessProtocol()");
  const load = entry.indexOf("require('./core/helpers')");
  assert.ok(patch > 0 && patch < load, 'Business patch must run before Baileys is imported');
});

test('WEB login trial changes authenticated socket identity only, never new QR registration', () => {
  const defaultBrowser = ['Ubuntu', 'Chrome', '20.0.04'];
  const env = { WA_BUSINESS_LINK: '1', WA_BUSINESS_LOGIN_MODE: 'web' };
  assert.deepEqual(selectBrowserIdentity(defaultBrowser, env, { hasMeId: false }),
    ['Android', 'SMB_Android', '14.4.1']);
  assert.deepEqual(selectBrowserIdentity(defaultBrowser, env, { hasMeId: true }),
    ['Mac OS', 'Chrome', '14.4.1']);
  assert.deepEqual(selectBrowserIdentity(defaultBrowser,
    { WA_BUSINESS_LINK: '0', WA_BUSINESS_LOGIN_MODE: 'web' }, { hasMeId: true }),
    defaultBrowser);
  assert.deepEqual(selectBrowserIdentity(defaultBrowser,
    { WA_BUSINESS_LINK: '1', WA_BUSINESS_LOGIN_MODE: 'smb' }, { hasMeId: true }),
    ['Android', 'SMB_Android', '14.4.1']);
  assert.deepEqual(selectBrowserIdentity(defaultBrowser,
    { WA_BUSINESS_LINK: '1', WA_BUSINESS_LOGIN_MODE: 'invalid' }, { hasMeId: true }),
    ['Android', 'SMB_Android', '14.4.1']);
});

test('bot passes account presence into the login-only identity selector', () => {
  const code = fs.readFileSync(path.join(__dirname, '../core/bot.js'), 'utf8');
  assert.match(code, /hasMeId:Boolean\(this\.authState\?\.creds\?\.me\?\.id\)/);
  assert.match(code, /selected login identity=/);
});
