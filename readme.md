# Kamran Hasil Bot

A WhatsApp bot (Baileys). This build contains **no closed-source code and no connection to the original
authors' servers**. Everything runs on your machine; sessions are created and stored locally.
See `SECURITY-CHANGES.md` for exactly what was removed.

## Requirements
- Node.js 20+ and npm
- `ffmpeg` and libwebp tools:  `sudo apt install ffmpeg webp`
- `yt-dlp` (all downloads run locally):  `sudo apt install pipx && pipx install yt-dlp`  (or the official binary)
- PM2 for 24/7:  `sudo npm i -g pm2`

## Install
```bash
npm install
```

## First login (local — nobody else ever sees your session)
Option A — pairing code (best for a server):
```bash
PAIR_NUMBER=923XXXXXXXXX node index.js
# type the printed code in WhatsApp > Linked devices > Link with phone number
```
Option B — QR code: `node index.js` and scan the QR shown in the terminal.

Credentials are stored only in your own database (`./bot.db` by default; set `DATABASE_URL` to use PostgreSQL).
Keep `bot.db` private (`chmod 600 bot.db`) — whoever holds it can log in as you.

## Run 24/7
```bash
pm2 start ecosystem.config.js
pm2 startup   # run the command it prints
pm2 save
```

## Configuration (`config.env`, optional)
| Variable | Meaning |
|---|---|
| `SESSION` | local session name(s), default `main` (several: `main,second`) |
| `SUDO` | owner number(s) with country code, comma separated (default `9231118401`) |
| `MODE` | `private` (default) or `public` |
| `PAIR_NUMBER` | number for pairing-code login |
| `DATABASE_URL` | default sqlite `./bot.db`, or a PostgreSQL URL |
| `YTDLP_PATH` / `YTDLP_ARGS` / `YTDLP_COOKIES` | yt-dlp binary / extra args (e.g. `--js-runtimes node`) / cookies.txt |
| `ACR_HOST`, `ACR_ACCESS_KEY`, `ACR_ACCESS_SECRET` | your own ACRCloud project (music identify) |
| `WA_VERSION` | pin the WhatsApp Web version, e.g. `2.3000.1015901307` (stops the version lookup on GitHub) |

## Verify it yourself
```bash
npm run audit:hosts     # lists every external host mentioned in the code
```

## Features that need something you provide
Instagram usually needs `YTDLP_COOKIES`; music identify needs your ACRCloud keys. Instagram stories/profile lookup,
Pinterest search and lyrics were server-side features of the original authors and are disabled
(see `core/services.js` to plug in a source you trust).

Licensed under GPL-3.0-or-later (see `LICENSE`).

## Windows notes
- Use `npm start` (it now uses `ecosystem.config.js`, which works on Windows). If an old broken PM2 entry exists, run `pm2 delete kamran-hasil-bot` first.
- Simplest option without PM2: `npm run start:node` (or `node index.js`).
- Windows also needs `ffmpeg` and `yt-dlp` on your PATH (e.g. `winget install yt-dlp ffmpeg`); `anim_dump`/libwebp tools are only needed for webp->mp4.
