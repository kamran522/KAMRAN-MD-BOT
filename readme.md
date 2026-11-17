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

## Fully local AI chatbot (Ollama)

The bot's `.ai` and `.chatbot` commands now use **Ollama only**. Kimi, Moonshot,
GroqCloud, Bedrock and other hosted AI providers are not called. No AI API
key or paid inference service is required. This setup still needs an Ollama
server and a downloaded model; it does not run a model inside Node.js.

### Install and start the local inference server

Install Ollama from https://ollama.com/download, then download the suggested
reasoning model and start its service:

~~~bash
ollama pull qwen3:1.7b
ollama pull qwen3:8b
# Start Ollama ONLY if it is not already running:
ollama serve
~~~

On systems where Ollama is already running as a service, do not start a second
server; use `ollama list` to verify installed models and
`curl http://127.0.0.1:11434/api/tags` to test connectivity.

Qwen3 supports local reasoning. The bot now has **fast** and **deep** modes:
ordinary `.ai` questions and automatic chatbot replies default to the small
`qwen3:1.7b` model, with thinking disabled. `.ai deep` uses the stronger
`qwen3:8b` model with thinking enabled.

| Model | Approximate download | Purpose |
|---|---:|---|
| `qwen3:1.7b` (fast default) | 1.4 GB | Short, fast answers; less capable |
| `qwen3:4b` | 2.5 GB | Better quality, somewhat slower |
| `qwen3:8b` (deep default) | 5.2 GB | Difficult questions; requires more memory |
| `qwen3:14b` or `qwen3:32b` | 9.3 GB / 20 GB | Harder work on powerful hardware |

Download size is not runtime memory; context cache and concurrent tasks use
extra RAM/VRAM. Large models can run on CPUs but may be slow. For complex work,
pick the largest model that fits your hardware. No local model automatically
becomes a coding agent or a tool-using research system.

~~~env
LOCAL_AI_URL=http://127.0.0.1:11434
LOCAL_AI_FAST_MODEL=qwen3:1.7b
LOCAL_AI_DEEP_MODEL=qwen3:8b
LOCAL_AI_FAST_CONTEXT=2048
LOCAL_AI_DEEP_CONTEXT=16384
LOCAL_AI_FAST_NUM_PREDICT=512
LOCAL_AI_DEEP_NUM_PREDICT=8192
LOCAL_AI_FAST_HISTORY=4
LOCAL_AI_TIMEOUT=180000
LOCAL_AI_DEEP_TIMEOUT=900000
LOCAL_AI_MAX_PENDING=3
LOCAL_AI_CHATBOT_COOLDOWN_MS=5000
LOCAL_AI_KEEP_ALIVE=30m
LOCAL_AI_DEEP_KEEP_ALIVE=0
~~~

The `LOCAL_AI_URL` must resolve to a loopback/LAN address or an internal
Docker service name. Public API hosts are rejected by default so your
WhatsApp content is not sent to a remote inference vendor.

**Docker deployment:** `127.0.0.1` inside a container is that container,
not the host. Run Ollama in a separate container on the same Docker network
and use `LOCAL_AI_URL=http://ollama:11434`, or connect to a local host service
using `http://host.docker.internal:11434` with correct Docker networking.
The existing bot Docker image does not include Ollama or model weights.

**Migration:** Remove `KIMI_API_KEY`, `MOONSHOT_API_KEY`, `KIMI_MODEL` and
other unused cloud AI settings from the hosting platform after upgrading.
The bot ignores old keys and does not require any Kimi account balance.
Keep old API keys private and revoke ones you no longer use.

### Harder and longer questions

- `.ai What is a database index?` — fast local answer
- `.ai fast Explain DNS` — same fast mode explicitly
- `.ai deep Design a scalable database schema with migration plan` —
  requests thinking mode, a larger context and a higher output budget
- `.chatbot on`, `.chatbot off`, `.chatbot status`, `.chatbot clear` —
  normal existing chatbot controls

**Speed notes:** Normal replies use a 2,048-token context, at most four recent
history messages, and a 512-token output budget by default. This reduces
work for CPU-based machines. If you want maximum speed on a small VPS,
use `qwen3:1.7b`; for somewhat better answers, install `qwen3:4b` and set
`LOCAL_AI_FAST_MODEL=qwen3:4b`. A larger model may still be slow on CPU.
The older `LOCAL_AI_MODEL` setting (if present) now controls only the deep
model; `LOCAL_AI_FAST_MODEL` always controls normal replies. Legacy
`LOCAL_AI_CONTEXT` and `LOCAL_AI_NUM_PREDICT` values do not override the new
fast-mode limits.

If you already have Ollama running on port 11434, do not start another
`ollama serve` process. Use `ollama list` and `ollama ps` to diagnose
downloads and GPU versus CPU execution.

Deep requests can take several minutes and use significantly more memory.
Large answers are split across WhatsApp messages. By default the bot
serializes local inference, with at most three queued or running requests
to reduce memory pressure; extra requests receive a busy message.

The model handles text only and has no filesystem, browser, command execution,
external search, or background-work capabilities. It can draft plans, code,
analysis and documents in chat, but cannot independently perform a software
deployment or execute a large project. Provide relevant text and split very
large tasks into stages. Increase context only when hardware permits.

Test the local provider without an Ollama server using `npm run test:ai`.
Run the full JavaScript checks with `npm run check`.
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
