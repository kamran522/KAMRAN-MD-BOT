'use strict';

// Some WhatsApp Business accounts reject Android companion identities when
// linking through Baileys. Keep the default browser unchanged unless an
// operator opts in to the isolated SMB_Android platform label for fresh
// Business pairing. scripts/patch-baileys-business.js teaches Baileys to
// encode it as SMB_ANDROID with webInfo and CHROME companion platform.
function selectBrowserIdentity(defaultBrowser, env = process.env) {
  const businessLink = /^(1|true|yes|on)$/i.test(
    String(env.WA_BUSINESS_LINK || '').trim()
  );
  if (!businessLink) return defaultBrowser;
  return ['Android', 'SMB_Android', '14.4.1'];
}

module.exports = { selectBrowserIdentity };
