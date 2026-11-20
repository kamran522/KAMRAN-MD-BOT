'use strict';

// Some WhatsApp Business accounts reject Android companion identities when
// linking through Baileys. Keep the default browser unchanged unless an
// operator opts in to a desktop identity for a fresh pairing attempt.
function selectBrowserIdentity(defaultBrowser, env = process.env) {
  const businessLink = /^(1|true|yes|on)$/i.test(
    String(env.WA_BUSINESS_LINK || '').trim()
  );
  if (!businessLink) return defaultBrowser;
  return ['Mac OS', 'Desktop', '14.4.1'];
}

module.exports = { selectBrowserIdentity };
