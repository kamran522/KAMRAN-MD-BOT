# Chrome-backed WhatsApp Web login (isolated test)

This runs the **actual WhatsApp Web browser application** in Chromium using
[whatsapp-web.js](https://wwebjs.dev/) and Puppeteer. It is different from
Baileys, which connects directly over WebSocket without a browser.

**Scope:** This is a simple connection test and a `!ping` / `pong` reply.
It **does not run the existing KAMRAN-MD-BOT commands or plugins**. Those
commands are written against the Baileys API and would need porting to use
this browser engine. Do not treat a successful Chrome login as proof that
the full bot has been migrated.

## Three commands

From the KAMRAN-MD-BOT repository on your Linux server:

```bash
pm2 stop 4
npm install --prefix scripts/chrome-whatsapp-web
node scripts/chrome-whatsapp-web/index.js
```

1. Wait for `[Chrome] Scan this QR...` and scan the terminal QR in
   WhatsApp Business > Linked devices > Link a device.
2. Wait for `[Chrome] WhatsApp Web connected and ready.`
3. Send `!ping` to the linked account from another chat. The test replies
   `pong`. Press Ctrl+C to stop. The login remains saved.

The browser profile is saved **outside the Git repository** at
`~/.kamran-md-chrome-auth/`. Never share, delete casually, or commit this
directory. The test uses the same profile on each restart and should not
need a new QR when WhatsApp retains the linked session.

Keep the Baileys bot stopped while testing to avoid two clients trying
to use the same WhatsApp account during diagnosis.

## Google Chrome installation / headless server

By default Puppeteer downloads and runs a compatible Chromium browser
without requiring a desktop environment. To use a locally installed
Google Chrome binary instead:

```bash
CHROME_EXECUTABLE_PATH=/usr/bin/google-chrome node scripts/chrome-whatsapp-web/index.js
```

If your VPS lacks Chrome's sandbox prerequisites, follow
[the WhatsApp Web JS authentication guide](https://wwebjs.dev/guide/creating-your-bot/authentication.html)
for host dependencies. As a last resort **on a trusted server only**, you can
opt into `CHROME_NO_SANDBOX=1`. Disabling the browser sandbox reduces
isolation, so do not enable it without a need.

## Troubleshooting / rollback

- A Chrome or Puppeteer startup error is separate from WhatsApp login.
  Verify available disk space, libraries and browser executable.
- If the phone rejects the QR in the *real browser* too, the issue may
  involve account/server state or the host's network. Do not assume that
  a browser identity string in Baileys is equivalent.
- Do not run this script and the existing Baileys bot concurrently. To
  return to the previous Baileys installation, press Ctrl+C and run
  `pm2 restart 4 --update-env`. This restores the **old connection
  method**, not necessarily a working WhatsApp login.
- This code relies on an unofficial automation client. A working browser
  login today does not guarantee long-term compatibility.

Run the isolated unit tests without installing Puppeteer dependencies:

```bash
node --test scripts/chrome-whatsapp-web/test.js
```
