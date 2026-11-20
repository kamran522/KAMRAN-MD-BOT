'use strict';
const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const { selectBrowserIdentity } = require('../core/wa-link-browser');
const os = require('node:os');
const vm = require('node:vm');
const { patchValidateConnection, patchCompanionPlatformId, patchInstalledBaileys } = require('../core/wa-business-patch');

test('Business pairing uses macOS Chrome Web identity only when opted in', () => {
  const original = ['Ubuntu', 'Chrome', '20.0.04'];
  assert.equal(selectBrowserIdentity(original, {}), original);
  assert.equal(selectBrowserIdentity(original, { WA_BUSINESS_LINK: '0' }), original);
  assert.equal(selectBrowserIdentity(original, { WA_BUSINESS_LINK: 'false' }), original);
  assert.deepEqual(selectBrowserIdentity(original, { WA_BUSINESS_LINK: '1' }),
    ['Mac OS', 'Chrome', '14.4.1']);
  assert.deepEqual(selectBrowserIdentity(original, { WA_BUSINESS_LINK: 'true' }),
    ['Mac OS', 'Chrome', '14.4.1']);
  assert.notEqual(selectBrowserIdentity(original, { WA_BUSINESS_LINK: '1' })[1], 'Desktop');
  assert.deepEqual(original, ['Ubuntu', 'Chrome', '20.0.04']);
});

test('WhatsApp socket uses current WA Web version with safe fallback', () => {
  const code = fs.readFileSync(path.join(__dirname, '../core/bot.js'), 'utf8');
  assert.match(code, /fetchLatestWaWebVersion:fetchLatestWaWebVersion/);
  assert.match(code, /\(fetchLatestWaWebVersion\|\|fetchLatestBaileysVersion\)\(\)/);
  assert.match(code, /'browser':require\('\.\/wa-link-browser'\)\.selectBrowserIdentity/);
});


test('explicit SMB Android identity is separate from existing macOS workaround', () => {
  const original = ['Ubuntu', 'Chrome', '22.04.4'];
  assert.deepEqual(selectBrowserIdentity(original, { WA_BUSINESS_LINK: 'smb_android' }),
    ['Android', 'Android', '']);
  assert.deepEqual(selectBrowserIdentity(original, { WA_BUSINESS_LINK: 'SMB_ANDROID' }),
    ['Android', 'Android', '']);
  assert.deepEqual(selectBrowserIdentity(original, { WA_BUSINESS_LINK: '1' }),
    ['Mac OS', 'Chrome', '14.4.1']);
  assert.equal(selectBrowserIdentity(original, { WA_BUSINESS_LINK: 'off' }), original);
});

const validateFixture = [
  'const getUserAgent = (config) => ({',
  "  platform: config.browser[1].toLocaleLowerCase().includes('android')",
  '    ? proto.ClientPayload.UserAgent.Platform.ANDROID',
  '    : proto.ClientPayload.UserAgent.Platform.WEB',
  '});',
  'const getClientPayload = (config) => {',
  '  const payload = { userAgent: getUserAgent(config) };',
  "  if (!config.browser[1].toLocaleLowerCase().includes('android')) {",
  "    payload.webInfo = { webSubPlatform: 'WEB_BROWSER' };",
  '  }',
  '  return payload;',
  '};'
].join('\n');

const companionFixture = [
  'const getCompanionWebClientType = () => 16;',
  'const getCompanionPlatformId = (browser) => {',
  '  return getCompanionWebClientType(browser).toString();',
  '};'
].join('\n');

test('patched registration emits SMB_ANDROID and keeps webInfo only when opted in', () => {
  const source = patchValidateConnection(validateFixture);
  assert.equal(patchValidateConnection(source), source); // idempotent
  const proto = { ClientPayload: { UserAgent: { Platform: { ANDROID: 0, SMB_ANDROID: 10, WEB: 12 } } } };

  const getPayload = (env) => vm.runInNewContext(source + '\ngetClientPayload',
    { process: { env }, proto });
  const business = getPayload({ WA_BUSINESS_LINK: 'smb_android' })({ browser: ['Android', 'Android', ''] });
  assert.equal(business.userAgent.platform, 10);
  assert.equal(business.webInfo.webSubPlatform, 'WEB_BROWSER');

  const standard = getPayload({})({ browser: ['Android', 'Android', ''] });
  assert.equal(standard.userAgent.platform, 0);
  assert.equal(standard.webInfo, undefined);
  const mac = getPayload({})({ browser: ['Mac OS', 'Chrome', '14.4.1'] });
  assert.equal(mac.userAgent.platform, 12);
  assert.equal(mac.webInfo.webSubPlatform, 'WEB_BROWSER');
});

test('patched QR and pairing code use Chrome companion ID only in SMB mode', () => {
  const source = patchCompanionPlatformId(companionFixture);
  assert.equal(patchCompanionPlatformId(source), source);
  const getId = (env) => vm.runInNewContext(source + '\ngetCompanionPlatformId',
    { process: { env } });
  assert.equal(getId({ WA_BUSINESS_LINK: 'smb_android' })(['Android', 'Android', '']), '1');
  assert.equal(getId({})(['Android', 'Android', '']), '16');
});

test('installed Baileys patch is opt-in, idempotent, and version-checked', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'kamran-baileys-test-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const dir = path.join(root, 'lib', 'Utils');
  fs.mkdirSync(dir, { recursive: true });
  const validationPath = path.join(dir, 'validate-connection.js');
  const companionPath = path.join(dir, 'companion-reg-client-utils.js');
  fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ version: '7.0.0-rc14' }));
  fs.writeFileSync(validationPath, validateFixture);
  fs.writeFileSync(companionPath, companionFixture);

  assert.equal(patchInstalledBaileys({}, root).status, 'disabled');
  assert.equal(fs.readFileSync(validationPath, 'utf8'), validateFixture);
  assert.equal(patchInstalledBaileys({ WA_BUSINESS_LINK: 'smb_android' }, root).status, 'patched');
  assert.equal(patchInstalledBaileys({ WA_BUSINESS_LINK: 'smb_android' }, root).status, 'already-patched');

  fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ version: '7.0.0-rc15' }));
  assert.throws(() => patchInstalledBaileys({ WA_BUSINESS_LINK: 'smb_android' }, root),
    /requires baileys@7.0.0-rc14/);
});

test('patch fails safely if upstream Baileys code changes', () => {
  assert.throws(() => patchValidateConnection('unrecognized'), /expected one match/);
  assert.throws(() => patchCompanionPlatformId('unrecognized'), /expected one match/);
  const helperCode = fs.readFileSync(path.join(__dirname, '../core/helpers.js'), 'utf8');
  assert.match(helperCode, /patchInstalledBaileys\(\)/);
});
