'use strict';

// A separate, browser-backed WhatsApp Web login probe.
// This deliberately does not load Baileys or the existing Baileys-only commands.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

function buildChromeOptions(env = process.env) {
  const authDirectory = path.resolve(
    env.KAMRAN_CHROME_AUTH_DIR || path.join(os.homedir(), '.kamran-md-chrome-auth')
  );
  const args = ['--disable-dev-shm-usage'];
  // A sandbox is recommended. Use the opt-in only on a trusted VPS if Chrome
  // otherwise cannot start because its sandbox is unavailable.
  if (env.CHROME_NO_SANDBOX === '1') {
    args.push('--no-sandbox', '--disable-setuid-sandbox');
  }
  const puppeteer = { headless: true, args };
  if (env.CHROME_EXECUTABLE_PATH) puppeteer.executablePath = env.CHROME_EXECUTABLE_PATH;

  return { authDirectory, puppeteer };
}

async function start() {
  let Client, LocalAuth, qrcode;
  try {
    ({ Client, LocalAuth } = require('whatsapp-web.js'));
    qrcode = require('qrcode-terminal');
  } catch (error) {
    if (error?.code === 'MODULE_NOT_FOUND') {
      console.error('[Chrome] Install the isolated dependencies first: npm install --prefix scripts/chrome-whatsapp-web');
      process.exitCode = 1;
      return;
    }
    throw error;
  }

  // Keep the local Chrome profile private. This directory contains credentials.
  process.umask(0o077);
  const { authDirectory, puppeteer } = buildChromeOptions();
  fs.mkdirSync(authDirectory, { recursive: true, mode: 0o700 });

  const client = new Client({
    authStrategy: new LocalAuth({ clientId: 'main', dataPath: authDirectory }),
    puppeteer
  });

  client.on('qr', qr => {
    console.log('\n[Chrome] Scan this QR with WhatsApp Business → Linked devices → Link a device.');
    console.log('[Chrome] Keep this QR private; do not publish terminal screenshots.');
    qrcode.generate(qr, { small: true });
  });

  client.on('authenticated', () => console.log('[Chrome] Authenticated; finishing WhatsApp Web startup...'));
  client.on('ready', () => {
    console.log('[Chrome] WhatsApp Web connected and ready.');
    console.log('[Chrome] Send !ping from another chat to check the basic test reply.');
    console.log('[Chrome] This is a browser login test, not the existing Baileys command engine.');
  });
  client.on('auth_failure', () => {
    // Avoid printing arbitrary messages that may contain identifiers or session data.
    console.error('[Chrome] Authentication failed. Confirm the linked device on your phone.');
  });
  client.on('disconnected', reason => {
    const safeReason = typeof reason === 'string' && /^[\w-]{1,50}$/.test(reason) ? reason : 'unknown';
    console.warn('[Chrome] Disconnected:', safeReason);
  });
  client.on('message', async message => {
    if (message?.body?.trim() !== '!ping' || message.fromMe) return;
    try {
      await message.reply('pong');
    } catch {
      console.error('[Chrome] Cannot send the ping reply.');
    }
  });

  let stopping = false;
  const stop = async () => {
    if (stopping) return;
    stopping = true;
    console.log('[Chrome] Closing browser; saved login will remain.');
    try {
      await client.destroy();
    } catch {
      console.error('[Chrome] Browser shutdown was not clean.');
    }
  };
  process.once('SIGINT', stop);
  process.once('SIGTERM', stop);

  console.log('[Chrome] Starting real WhatsApp Web in Chromium...');
  try {
    await client.initialize();
  } catch (error) {
    console.error('[Chrome] Browser could not start:', error?.message || 'unknown failure');
    console.error('[Chrome] On a Linux VPS check installed browser libraries and Chrome sandbox requirements.');
    process.exitCode = 1;
    await stop();
  }
}

if (require.main === module) {
  start().catch(error => {
    console.error('[Chrome] Fatal startup failure:', error?.message || 'unknown');
    process.exitCode = 1;
  });
}

module.exports = { buildChromeOptions };
