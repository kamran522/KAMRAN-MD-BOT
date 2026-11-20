'use strict';
const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const {
  applyBusinessProtocol,
  patchValidateConnection,
  patchCompanionClient,
  PATCH_MARKER
} = require('../scripts/patch-baileys-business');

const validateSource = `const getUserAgent = (config) => {
  return {
    platform: config.browser[1].toLocaleLowerCase().includes('android')
      ? proto.ClientPayload.UserAgent.Platform.ANDROID
      : proto.ClientPayload.UserAgent.Platform.WEB
  };
};
const getClientPayload = (config) => {
  const payload = {};
  if (!config.browser[1].toLocaleLowerCase().includes('android')) {
    payload.webInfo = getWebInfo(config);
  }
  return payload;
};
const getPlatformType = (platform) => {
  const platformType = platform.toUpperCase();
  if (platformType === 'ANDROID') {
    return proto.DeviceProps.PlatformType.ANDROID_PHONE;
  }
};
`;
const companionSource = `export const getCompanionWebClientType = ([os, browserName]) => {
  if (browserName === 'Desktop') return CompanionWebClientType.ELECTRON;
  return CompanionWebClientType.OTHER_WEB_CLIENT;
};
`;

test('compiled Baileys patch emits SMB_ANDROID, preserves webInfo and Android DeviceProps', () => {
  const out = patchValidateConnection(validateSource);
  assert.match(out, /config\.browser\[1\] === 'SMB_Android'\s*\?\s*proto\.ClientPayload\.UserAgent\.Platform\.SMB_ANDROID/);
  assert.match(out, /config\.browser\[1\] === 'SMB_Android' \|\| !config\.browser\[1\]/);
  assert.match(out, /platformType === 'ANDROID' \|\| platformType === 'SMB_ANDROID'/);
  assert.equal(patchValidateConnection(out), out);
});

test('compiled Baileys patch selects Chrome companion_platform_id for SMB_Android', () => {
  const out = patchCompanionClient(companionSource);
  assert.match(out, /browserName === 'SMB_Android'.*CompanionWebClientType\.CHROME/);
  assert.equal(patchCompanionClient(out), out);
});

test('patch rejects unsupported compiled code rather than making partial changes', () => {
  assert.throws(() => patchValidateConnection('export const x = 5'), /Cannot safely patch/);
  assert.throws(() => patchCompanionClient('export const x = 5'), /Cannot safely patch/);
});

function makeFixture(root, version = '7.0.0-rc14', valid = true) {
  const directory = path.join(root, 'lib', 'Utils');
  fs.mkdirSync(directory, { recursive: true });
  fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ name: 'baileys', version }));
  fs.writeFileSync(path.join(directory, 'validate-connection.js'), valid ? validateSource : 'not a compatible Baileys build');
  fs.writeFileSync(path.join(directory, 'companion-reg-client-utils.js'), companionSource);
}

test('patch applies atomically on known version, backs up files and is idempotent', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'kamran-baileys-'));
  try {
    makeFixture(root);
    const planned = applyBusinessProtocol({ root, dryRun: true });
    assert.equal(planned.filesPatched, 2);
    assert.doesNotMatch(fs.readFileSync(path.join(root, 'lib/Utils/validate-connection.js'), 'utf8'), /SMB_ANDROID_V1/);
    const result = applyBusinessProtocol({ root });
    assert.equal(result.filesPatched, 2);
    assert.equal(applyBusinessProtocol({ root }).filesPatched, 0);
    assert.match(fs.readFileSync(path.join(root, 'lib/Utils/validate-connection.js'), 'utf8'), new RegExp(PATCH_MARKER));
    assert.match(fs.readFileSync(path.join(root, 'lib/Utils/companion-reg-client-utils.js'), 'utf8'), new RegExp(PATCH_MARKER));
    assert.ok(fs.existsSync(path.join(root, 'lib/Utils/validate-connection.js.kamran-business-original')));
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('patch never edits unsupported or unexpectedly changed Baileys', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'kamran-baileys-invalid-'));
  try {
    makeFixture(root, '7.0.0-rc99');
    assert.throws(() => applyBusinessProtocol({ root }), /supports only/);
    makeFixture(root, '7.0.0-rc14', false);
    assert.throws(() => applyBusinessProtocol({ root }), /Cannot safely patch/);
    assert.equal(fs.readFileSync(path.join(root, 'lib/Utils/companion-reg-client-utils.js'), 'utf8'), companionSource);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('published Baileys rc14 package is compatible when BAILEYS_FIXTURE_ROOT is set', () => {
  const root = process.env.BAILEYS_FIXTURE_ROOT;
  if (!root) return;
  const planned = applyBusinessProtocol({ root, dryRun: true });
  assert.equal(planned.filesPatched, 2, 'upstream rc14 package matches patch patterns');
  const result = applyBusinessProtocol({ root });
  assert.equal(result.filesPatched, 2);
  assert.equal(applyBusinessProtocol({ root }).filesPatched, 0);
});
