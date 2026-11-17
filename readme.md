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

## AI chatbot: GroqCloud or a local model

Both `.ai` and `.chatbot` use one configurable AI provider and keep the existing chat-history behavior. **Groq** (with a q) is a hosted inference API, not xAI **Grok**. A `gsk_...` token is for GroqCloud and cannot access xAI Grok. GroqCloud requests are not locally hosted.

### GroqCloud (hosted, API key required)

Create a **new** key in https://console.groq.com/keys and add these variables to your deployment environment (or the ignored local `config.env` file):

~~~env
AI_PROVIDER=groq
GROQ_API_KEY=REPLACE_WITH_A_NEW_KEY
GROQ_MODEL=openai/gpt-oss-20b
~~~

Never commit your key or send it in a WhatsApp command. If a key has been shared, rotate it in GroqCloud first. The default Groq model is `openai/gpt-oss-20b`; you can change `GROQ_MODEL` to another supported Groq model. GroqCloud may charge for requests. Groq API availability, model selection and limits are managed by Groq.

### Self-hosted Ollama (no key required)

Install https://ollama.com and run:

~~~bash
ollama pull llama3.2:3b
ollama serve
~~~

Use these environment variables:

~~~env
AI_PROVIDER=ollama
LOCAL_AI_URL=http://127.0.0.1:11434
LOCAL_AI_MODEL=llama3.2:3b
~~~

If `AI_PROVIDER` is omitted, the bot selects Groq when `GROQ_API_KEY` exists; otherwise it selects Ollama. For Docker, `127.0.0.1` is inside the container. Configure `LOCAL_AI_URL` to a reachable Ollama host address or run both services on a suitable shared network.

### Another self-hosted OpenAI-compatible endpoint

To connect a self-hosted model server exposing `/v1/chat/completions` (for example vLLM), configure:

~~~env
AI_PROVIDER=openai-compatible
LOCAL_AI_URL=http://127.0.0.1:8000/v1
LOCAL_AI_MODEL=YOUR_SERVED_MODEL_ID
# Optional if your local server requires authentication:
# LOCAL_AI_API_KEY=YOUR_LOCAL_SERVER_KEY
~~~

`LOCAL_AI_TIMEOUT=120000` sets the request timeout in milliseconds (minimum 10000, maximum 300000). The bot supports text only. It does not download or provide any Grok model weights; use only a model you are authorized and able to host.

### WhatsApp commands

Use `.ai your question` for a single question, `.chatbot on` to auto-reply in the current chat, `.chatbot off` to disable, `.chatbot status` for provider/model info, and `.chatbot clear` to reset the chat context. Global `.chatbot on groups` and `.chatbot on dms` can generate a high number of cloud API requests. Restart the bot after changing provider environment variables.

Run `node --test tests/ai-provider.test.js` to test provider routing without network access.

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
