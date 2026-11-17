# Kamran Hasil Bot

A WhatsApp bot built with Baileys. This build contains **no closed-source code and no connection to the original authors' servers**. Everything runs on your own machine or server, and WhatsApp session credentials are stored locally. See [SECURITY-CHANGES.md](SECURITY-CHANGES.md) for details.

## Requirements

- Node.js 20 or newer and npm
- FFmpeg and WebP tools
- yt-dlp for media downloads
- PM2 (optional, for keeping the bot online)

### Install system dependencies (Ubuntu/Debian)

```bash
sudo apt update
sudo apt install -y ffmpeg webp pipx
pipx install yt-dlp
sudo npm install -g pm2
```

## Installation

Clone the repository and install its dependencies:

```bash
git clone https://github.com/kamran522/KAMRAN-MD-BOT.git
cd KAMRAN-MD-BOT
npm install
```

## Connect WhatsApp

### Option A: Pairing code (recommended for servers)

```bash
PAIR_NUMBER=923XXXXXXXXX node index.js
```

Enter the pairing code printed in the terminal in WhatsApp under **Linked devices → Link with phone number**.

### Option B: QR code

```bash
node index.js
```

Scan the QR code displayed in your terminal using WhatsApp's Linked devices feature.

Your credentials are stored in your local database (`./bot.db` by default). You can use PostgreSQL by setting `DATABASE_URL`. Keep your database private: anyone who obtains your session credentials may be able to access your WhatsApp account.

## Owner / SUDO configuration

The default owner number is:

```text
923111008401
```

To use a different owner number, set `SUDO` in your environment or configuration. Multiple owner numbers can be comma-separated:

```bash
SUDO=923111008401,923XXXXXXXXX
```

**Important:** An environment variable named `SUDO` overrides the default value in `config.js`. If you have set it in your hosting panel, update it there as well.

## Run continuously with PM2

```bash
pm2 start ecosystem.config.js
pm2 startup
# Run the command printed by pm2 startup
pm2 save
```

To restart after changing configuration:

```bash
pm2 restart all
```

Without PM2, you can run:

```bash
node index.js
```

## Configuration

The following environment variables are supported:

| Variable | Purpose |
|---|---|
| `SESSION` | Local session name(s); default is `main`. Multiple names can be comma-separated. |
| `SUDO` | Owner number(s), including country code, comma-separated. Default: `923111008401`. |
| `MODE` | Bot mode: `private` (default) or `public`. |
| `PAIR_NUMBER` | WhatsApp number used for pairing-code login. |
| `DATABASE_URL` | Database connection; defaults to local SQLite at `./bot.db`. |
| `YTDLP_PATH` | Optional path to the yt-dlp executable. |
| `YTDLP_ARGS` | Optional extra arguments passed to yt-dlp. |
| `YTDLP_COOKIES` | Optional path to a cookies file; Instagram downloads may require it. |
| `ACR_HOST`, `ACR_ACCESS_KEY`, `ACR_ACCESS_SECRET` | Credentials for your own ACRCloud music-identification project. |
| `WA_VERSION` | Optional WhatsApp Web version override. |

## Kimi AI chatbot (Moonshot AI only)

The `.ai` and `.chatbot` commands now use **Kimi by Moonshot AI only**.
GroqCloud, Amazon Bedrock, Ollama, and custom local AI backends have been
removed from the AI request path. Existing chatbot history, system prompts,
and the WhatsApp enable/disable commands are unchanged.

### Setup

Create a Moonshot API key at https://platform.kimi.ai/ and set these
environment variables on your hosting platform or in the ignored local
`config.env` file:

~~~env
KIMI_API_KEY=REPLACE_WITH_YOUR_MOONSHOT_KEY
KIMI_MODEL=kimi-k2.6
~~~

The official `MOONSHOT_API_KEY` name is supported as an alternative. When both
names are present, `KIMI_API_KEY` takes priority. `KIMI_MODEL` is optional and
defaults to `kimi-k2.6`; only IDs starting with `kimi-` are accepted.
Check that a selected Kimi model is accessible to your Moonshot account.

The fixed endpoint is `https://api.moonshot.ai/v1/chat/completions`, using
`Authorization: Bearer <API key>`. Set `KIMI_TIMEOUT=120000` to configure
the timeout in milliseconds (minimum 10000, maximum 300000).

**Migration:** Previous `AI_PROVIDER`, `GROQ_*`, `BEDROCK_*`,
`LOCAL_AI_*`, and AWS bearer-token settings are ignored by the AI module.
Remove those obsolete secrets and settings from your host; old Groq and Bedrock
keys cannot be used as Kimi credentials. The bot uses an internet-hosted
Moonshot service, not a locally hosted model. Usage may incur charges.

Do not commit your Moonshot API key or send it using WhatsApp commands such
as `.setvar` or `.setenv`. Kimi key values are hidden by `.getvar` and
`.allvar`. Setting or changing the API key on your host requires restarting
the bot.

### WhatsApp commands

- `.ai your question` sends a single request to Kimi.
- `.chatbot on` and `.chatbot off` control auto-replies in the current chat.
- `.chatbot status` shows Kimi model and whether a key is configured.
- `.chatbot clear` clears conversation history.
- `.chatbot on groups` / `.chatbot on dms` enable global auto-replies;
  monitor API usage and costs when enabling these modes.

The existing chatbot is **text-only**. Image understanding is not wired into
the WhatsApp commands. Verify behavior with `npm run test:ai` (offline tests).

Official Kimi API details: https://api.moonshot.ai/v1, with examples at
https://platform.kimi.ai.

## Instagram video playback on Android and iOS

Instagram Reels, stories, posts, and AutoDL now convert videos with local
FFmpeg before sending. Converted MP4 uses H.264 Baseline/yuv420p, optional
AAC audio, a fast-start index, at most 1280 pixels per side and 30 fps.
This applies to gallery-dl and yt-dlp fallback; photos are unchanged.

Install FFmpeg with libx264 and AAC support (included in the Docker image).
Set `FFMPEG_PATH` if FFmpeg is not on PATH. Transcoding takes extra CPU time.
Conversion failures stop the bot from sending unplayable source videos.
Previously sent WhatsApp videos cannot be fixed; resend after deployment.
## Media and optional services

- Media downloads use the locally installed yt-dlp executable.
- Instagram downloads may require a valid cookies file configured through `YTDLP_COOKIES`.
- Music identification requires your own ACRCloud credentials.
- Instagram stories/profile lookup, Pinterest search, and lyrics features from the original authors' server-side services are disabled. See `core/services.js` if you want to integrate a service you trust.

## Verify external hosts

Run the included audit script to list external hosts referenced in the code:

```bash
npm run audit:hosts
```

## Windows notes

- Install Node.js 20+ and make sure Node.js and npm are available in your terminal.
- Install FFmpeg and yt-dlp and add them to your PATH (for example, using `winget install yt-dlp ffmpeg`).
- Start the bot with `npm start` or `node index.js`.
- For PM2, use `pm2 start ecosystem.config.js`. If an old broken PM2 process exists, remove it with `pm2 delete kamran-hasil-bot` before starting again.

## License

Licensed under **GPL-3.0-or-later**. See [LICENSE](LICENSE).
