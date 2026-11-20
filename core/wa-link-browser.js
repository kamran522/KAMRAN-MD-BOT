'use strict';

// WhatsApp Business can reject stock Android companion registration.
// Keep SMB_Android for new pairing; it requires the patched Baileys rc14
// registration fields. The optional WEB login test is deliberately separate
// and applies only after a stored account identity exists.
//
// No guarantee that WhatsApp will accept a different post-pair login identity.
function selectBrowserIdentity(defaultBrowser, env = process.env, { hasMeId = false } = {}) {
  const businessLink = /^(1|true|yes|on)$/i.test(
    String(env.WA_BUSINESS_LINK || '').trim()
  );
  if (!businessLink) return defaultBrowser;

  const loginMode = String(env.WA_BUSINESS_LOGIN_MODE || '').trim().toLowerCase();
  if (loginMode === 'web' && hasMeId === true) {
    // Baileys generates UserAgent.platform=WEB and webInfo=WEB_BROWSER.
    // This identity is never used for fresh QR or pairing-code registration.
    return ['Mac OS', 'Chrome', '14.4.1'];
  }

  return ['Android', 'SMB_Android', '14.4.1'];
}

module.exports = { selectBrowserIdentity };
