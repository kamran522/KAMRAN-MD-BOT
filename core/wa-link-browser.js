'use strict';

// Some WhatsApp Business accounts reject Android companion identities when
// linking through Baileys. Keep the default browser unchanged unless an
// operator opts in to a macOS Chrome WEB_BROWSER identity for fresh pairing.
// Do not use 'Desktop' here: macOS Desktop can advertise DARWIN and trigger
// connection termination before QR registration (Baileys issue #2677).
function selectBrowserIdentity(defaultBrowser, env = process.env) {
  const businessLink = /^(1|true|yes|on)$/i.test(
    String(env.WA_BUSINESS_LINK || '').trim()
  );
  if (!businessLink) return defaultBrowser;
  return ['Mac OS', 'Chrome', '14.4.1'];
}

module.exports = { selectBrowserIdentity };
