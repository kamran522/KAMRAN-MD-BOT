'use strict';

// Opt-in workaround for WhatsApp Business companion registration with Baileys
// 7.0.0-rc14. Based on https://github.com/WhiskeySockets/Baileys/issues/2782
// Patch the installed ESM files synchronously BEFORE loadBaileys() imports them.
// Stock WhatsApp sessions and the existing WA_BUSINESS_LINK=1 mode are untouched.
const fs = require('node:fs');
const path = require('node:path');

const BUSINESS_MODE = 'smb_android';
const SUPPORTED_VERSION = '7.0.0-rc14';
const SMB_UA = '/* KAMRAN_SMB_USER_AGENT */';
const SMB_WEB = '/* KAMRAN_SMB_WEB_INFO */';
const SMB_PAIR = '/* KAMRAN_SMB_PAIRING_ID */';

function replaceOnce(source, marker, pattern, replacement, description) {
  if (source.includes(marker)) return source;
  const matches = source.match(new RegExp(pattern.source, 'g')) || [];
  if (matches.length !== 1) {
    throw new Error(
      'Cannot patch Baileys ' + description + ': expected one match, got ' + matches.length +
      '. Check the installed Baileys version.'
    );
  }
  return source.replace(pattern, replacement);
}

function patchValidateConnection(source) {
  let result = replaceOnce(
    source,
    SMB_UA,
    /(platform:\s*)config\.browser\[1\]\.toLocaleLowerCase\(\)\.includes\((['"])android\2\)/,
    (match, prefix) =>
      prefix + SMB_UA + " process.env.WA_BUSINESS_LINK === 'smb_android' " +
      '? proto.ClientPayload.UserAgent.Platform.SMB_ANDROID : ' +
      match.slice(prefix.length),
    'user-agent platform'
  );
  result = replaceOnce(
    result,
    SMB_WEB,
    /if\s*\(\s*!config\.browser\[1\]\.toLocaleLowerCase\(\)\.includes\((['"])android\1\)\s*\)/,
    (match, quote) =>
      'if (' + SMB_WEB +
      " process.env.WA_BUSINESS_LINK === 'smb_android' || " +
      '!config.browser[1].toLocaleLowerCase().includes(' + quote + 'android' + quote + '))',
    'webInfo'
  );
  return result;
}

function patchCompanionPlatformId(source) {
  return replaceOnce(
    source,
    SMB_PAIR,
    /return\s+getCompanionWebClientType\(browser\)\.toString\(\)/,
    'return ' + SMB_PAIR + " process.env.WA_BUSINESS_LINK === 'smb_android' " +
      "? '1' : getCompanionWebClientType(browser).toString()",
    'pairing client platform'
  );
}

function patchInstalledBaileys(env = process.env, installRoot = path.join(__dirname, '..', 'node_modules', 'baileys')) {
  if (String(env.WA_BUSINESS_LINK || '').trim().toLowerCase() !== BUSINESS_MODE) {
    return { status: 'disabled' };
  }

  const metadata = JSON.parse(fs.readFileSync(path.join(installRoot, 'package.json'), 'utf8'));
  if (metadata.version !== SUPPORTED_VERSION) {
    throw new Error(
      'WA_BUSINESS_LINK=smb_android requires baileys@' + SUPPORTED_VERSION +
      '; found ' + metadata.version + '. Disable the mode or update this patch.'
    );
  }

  const files = [
    {
      path: path.join(installRoot, 'lib', 'Utils', 'validate-connection.js'),
      patch: patchValidateConnection
    },
    {
      path: path.join(installRoot, 'lib', 'Utils', 'companion-reg-client-utils.js'),
      patch: patchCompanionPlatformId
    }
  ];

  // Validate BOTH transformations before writing either file.
  const changes = files.map(file => {
    const before = fs.readFileSync(file.path, 'utf8');
    return { ...file, before, after: file.patch(before) };
  });
  for (const change of changes) {
    if (change.after !== change.before) {
      fs.writeFileSync(change.path, change.after);
    }
  }

  return {
    status: changes.some(change => change.after !== change.before) ? 'patched' : 'already-patched'
  };
}

module.exports = {
  patchValidateConnection,
  patchCompanionPlatformId,
  patchInstalledBaileys
};
