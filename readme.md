# Kamran Hasil Bot

A WhatsApp bot built with Baileys. This build contains **no closed-source code and no connection to the original authors' servers**. Everything runs on your own machine or server, and WhatsApp session credentials are stored locally.

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

### WhatsApp Business account pairing

For some WhatsApp Business accounts, Baileys on an Android-like client reports
"Couldn't link device — You can only link to another WhatsApp Business app".
This bot supports an optional macOS **Chrome browser** identity for new
pairing attempts. It does **not** use the native macOS "Desktop" identity:
Baileys issue #2677 reports that Desktop advertises DARWIN, which WhatsApp
may reject with 428 before issuing a QR. This corrects the earlier
`WA_BUSINESS_LINK=1` setting. See:
https://github.com/WhiskeySockets/Baileys/issues/2677

Add to your bot's root `.env`:

~~~env
WA_BUSINESS_LINK=1
~~~

After pulling the new code, stop other instances of this bot and restart it
using PM2. Verify the selected identity:

~~~bash
node - <<'NODE'
require('dotenv').config();
const { selectBrowserIdentity } = require('./core/wa-link-browser');
console.log(selectBrowserIdentity(['Ubuntu', 'Chrome', '20.0.04']));
NODE
# Expected: [ 'Mac OS', 'Chrome', '14.4.1' ]
~~~

**Prefer QR linking over a pairing code** for this diagnostic. If
`PAIR_NUMBER` is set in the environment, this bot requests a pairing code.
Remove the `PAIR_NUMBER` setting from `.env` and from the PM2 environment,
then restart the bot so a QR is displayed in its terminal/logs. Link it from
**WhatsApp Business** → **Linked devices** → **Link a device** on the primary
phone. If PM2 retains an outdated `PAIR_NUMBER`, stop/delete only the PM2
*process* (not the database), then start it again with
`env -u PAIR_NUMBER pm2 start ecosystem.config.js`.

The setting is an unverified compatibility workaround, not a guarantee.
Baileys issue #2782 documents another solution using an explicitly emitted
SMB_ANDROID registration platform and other protocol fields. Simply
changing the browser string does not apply that deeper change:
https://github.com/WhiskeySockets/Baileys/issues/2782

The bot prefers a live WhatsApp Web client version from
`fetchLatestWaWebVersion()`, with a library-default fallback on fetch
failure; remove stale `WA_VERSION` overrides. If linking still fails, record
the status codes (401, 405, 428, 429 or 515) from
`pm2 logs kamran-MD-bot --lines 100 --nostream`, redacting QR, phone
numbers, pairing codes, and credentials. Official Web linking success means
the account can link a legitimate Web client, but does not rule out
Baileys fingerprint, protocol, rate-limit, or hosting-IP restrictions.

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

## Local AI with live internet search (Ollama + SearXNG)

Inference stays on your own hardware. An optional, self-hosted
[SearXNG](https://docs.searxng.org/) service searches public web indexes and
passes short result excerpts to Ollama for up-to-date answers. The search
engine is **not** a second AI provider. Search results include source URLs
and the time they were retrieved. They are not guaranteed to reflect events
instantly: search engines can index pages late, and the model can still make
mistakes. For important facts, verify the linked primary sources.

### Start local services with Docker

From the repository root:

~~~bash
docker compose -f compose.ai.yml up -d
docker compose -f compose.ai.yml exec ollama ollama pull qwen3:1.7b
docker compose -f compose.ai.yml exec ollama ollama pull qwen3:8b

# Verify search returns JSON and has internet access.
curl 'http://127.0.0.1:8080/search?q=latest+news&format=json'
~~~

Both services bind only to localhost on the host machine. The SearXNG
configuration enables JSON output. Replace the sample `server.secret_key` in
`searxng/settings.yml` with a random value before exposing the search service
to any other machine. Do not publicly expose Ollama or SearXNG.

Start the bot on the **same host** with Node.js, using these settings in its
environment or in a local `.env` file:

~~~env
LOCAL_AI_URL=http://127.0.0.1:11434
LOCAL_AI_SEARCH_URL=http://127.0.0.1:8080
LOCAL_AI_WEB_SEARCH=auto
LOCAL_AI_SEARCH_TIMEOUT_MS=10000
~~~

`LOCAL_AI_WEB_SEARCH` supports:
- `auto` (default when a search URL is configured): retrieve web results for
  likely time-sensitive questions, such as news, elections, weather, prices
  or questions mentioning "today", "latest" or "current".
- `on`: search the web for every AI question.
- `off`: disable internet searches completely.

If no search URL is set, ordinary `.ai` questions remain offline by default.
However, an **explicit** `.ai web ...` command attempts the localhost service at
`http://127.0.0.1:8080`, which is the address used by `compose.ai.yml`.
If SearXNG is not running there, the bot returns a connection error with
setup guidance. `LOCAL_AI_WEB_SEARCH=off` explicitly disables web searches,
including `.ai web ...`. `LOCAL_AI_SEARCH_URL` accepts localhost, private LAN
addresses, and local Docker service names, but rejects public search API
endpoints.

Use these WhatsApp commands (with the configured command prefix):

~~~text
.ai what time is it in Pakistan right now?   # precise Asia/Karachi clock
.ai What is DNS?                    # local model; no web in auto mode
.ai What is the latest news?        # searches in auto mode
.ai web What happened today?        # always search
.ai deep web Summarize recent AI research   # stronger local model + search
.ai offline Explain recent events  # never search
.chatbot on                         # auto replies use the same search rules
~~~

When using Docker **for the bot too**, put it on the same Compose network
as the services and set `LOCAL_AI_URL=http://ollama:11434` and
`LOCAL_AI_SEARCH_URL=http://searxng:8080`; `127.0.0.1` inside a container
refers only to that container. The supplied Compose file runs the two
support services, not the WhatsApp bot itself.

**Privacy:** Running the LLM locally does not make searches private.
For current-time requests about Pakistan and its major cities, the bot reads
its own system clock with the `Asia/Karachi` timezone instead of asking
Ollama or a web page to estimate the time. Keep the server clock synchronized
(e.g. inspect `timedatectl status`). This works even when search is disabled.

When `.ai web ...` cannot connect, check `docker compose -f compose.ai.yml ps`
and run `curl 'http://127.0.0.1:8080/search?q=Pakistan+news&format=json'`
from the bot host. The bot uses port 8080 on localhost only if it runs on the
host; a bot running inside Docker must set `LOCAL_AI_SEARCH_URL` to a reachable
SearXNG service such as `http://searxng:8080` on the same Docker network.
Setting `LOCAL_AI_WEB_SEARCH=auto` and `LOCAL_AI_SEARCH_URL` in the bot's root
`.env` enables automatic searches for time-sensitive questions, but the bot
process must be restarted to load these changes. A parent PM2 environment can
override `.env` values, so inspect PM2 configuration if settings do not apply.

When search is enabled, the search terms travel to SearXNG and its upstream
web search engines. Do not send passwords or confidential chat content in
search queries. Web pages and snippets are untrusted evidence, not instructions
to execute. The bot never executes commands or downloads pages on behalf of
AI-generated text.

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

The model handles text only and has no filesystem, browser automation,
command execution, or background-work capabilities. Optional SearXNG web
retrieval is described above; the model does not browse freely. It can draft plans, code,
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
