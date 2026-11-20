'use strict';

// Opt-in, version-pinned patch of Baileys' installed ESM build for WhatsApp
// Business companion registration. No credentials are read or modified.
// Details: https://github.com/WhiskeySockets/Baileys/issues/2782
const fs = require('node:fs');
const path = require('node:path');
const PATCH_MARKER = 'KAMRAN_BUSINESS_SMB_ANDROID_V1';
const EXPECTED_VERSION = '7.0.0-rc14';

function replaceExactlyOnce(source, regex, replacement, label) {
  const matches = [...source.matchAll(new RegExp(regex.source, 'g'))];
  if (matches.length !== 1) {
    throw new Error('Cannot safely patch Baileys ' + label + ': expected 1 matching location, found ' + matches.length);
  }
  return source.replace(regex, replacement);
}

function patchValidateConnection(source) {
  if (source.includes(PATCH_MARKER)) return source;
  let out = replaceExactlyOnce(source,
    /platform:\s*config\.browser\[1\]\.toLocaleLowerCase\(\)\.includes\('android'\)\s*\?\s*proto\.ClientPayload\.UserAgent\.Platform\.ANDROID\s*:\s*proto\.ClientPayload\.UserAgent\.Platform\.WEB/,
    "platform: config.browser[1] === 'SMB_Android'\n            ? proto.ClientPayload.UserAgent.Platform.SMB_ANDROID\n            : config.browser[1].toLocaleLowerCase().includes('android')\n                ? proto.ClientPayload.UserAgent.Platform.ANDROID\n                : proto.ClientPayload.UserAgent.Platform.WEB",
    'UserAgent.platform');
  out = replaceExactlyOnce(out,
    /if\s*\(\s*!config\.browser\[1\]\.toLocaleLowerCase\(\)\.includes\('android'\)\s*\)\s*\{\s*payload\.webInfo\s*=\s*getWebInfo\(config\)/,
    "if (config.browser[1] === 'SMB_Android' || !config.browser[1].toLocaleLowerCase().includes('android')) {\n        payload.webInfo = getWebInfo(config)",
    'ClientPayload.webInfo');
  out = replaceExactlyOnce(out,
    /if\s*\(platformType\s*===\s*'ANDROID'\)\s*\{/,
    "if (platformType === 'ANDROID' || platformType === 'SMB_ANDROID') {",
    'DeviceProps.platformType');
  return '// ' + PATCH_MARKER + '\n' + out;
}

function patchCompanionClient(source) {
  if (source.includes(PATCH_MARKER)) return source;
  const out = replaceExactlyOnce(source,
    /export\s+const\s+getCompanionWebClientType\s*=\s*\(\[os,\s*browserName\]\)\s*=>\s*\{/,
    "export const getCompanionWebClientType = ([os, browserName]) => {\n    if (browserName === 'SMB_Android') return CompanionWebClientType.CHROME;",
    'companion_platform_id');
  return '// ' + PATCH_MARKER + '\n' + out;
}

function applyBusinessProtocol({ root = path.resolve(__dirname, '..', 'node_modules', 'baileys'), dryRun = false } = {}) {
  const manifest = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  if (manifest.name !== 'baileys' || manifest.version !== EXPECTED_VERSION) {
    throw new Error('Business protocol patch supports only baileys@' + EXPECTED_VERSION +
      ' (installed: ' + manifest.name + '@' + manifest.version + ')');
  }
  const files = [
    { name: 'lib/Utils/validate-connection.js', transform: patchValidateConnection },
    { name: 'lib/Utils/companion-reg-client-utils.js', transform: patchCompanionClient }
  ];
  // Check both source layouts before any file is modified; never guess or
  // quietly fall back to a plain Android identity if package internals change.
  const planned = files.map(({ name, transform }) => {
    const file = path.join(root, name);
    const original = fs.readFileSync(file, 'utf8');
    const updated = transform(original);
    return { file, original, updated, changed: original !== updated };
  });
  if (!dryRun) {
    for (const { file, original, updated, changed } of planned) {
      if (!changed) continue;
      const backup = file + '.kamran-business-original';
      if (!fs.existsSync(backup)) fs.writeFileSync(backup, original, 'utf8');
      const temporary = file + '.kamran-business-tmp';
      fs.writeFileSync(temporary, updated, 'utf8');
      fs.renameSync(temporary, file);
    }
  }
  return { version: EXPECTED_VERSION, filesPatched: planned.filter(p => p.changed).length, dryRun };
}

if (require.main === module) {
  if (!/^(1|true|yes|on)$/i.test(String(process.env.WA_BUSINESS_LINK || '').trim())) {
    console.log('[Business pairing] Disabled (set WA_BUSINESS_LINK=1 to enable).');
  } else {
    try {
      console.log('[Business pairing] ' + JSON.stringify(applyBusinessProtocol()));
    } catch (error) {
      console.error('[Business pairing] ' + error.message);
      process.exitCode = 1;
    }
  }
}

module.exports = { applyBusinessProtocol, patchValidateConnection, patchCompanionClient, PATCH_MARKER };
