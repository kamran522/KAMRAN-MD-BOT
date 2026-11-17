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

## AI chatbot: Amazon Bedrock, GroqCloud, or a local model

Both `.ai` and `.chatbot` use one configurable AI provider and keep the existing chat-history behavior. Bedrock and GroqCloud are hosted inference services; only Ollama and self-hosted OpenAI-compatible services run locally. **Groq** (with a q) is a hosted inference API, not xAI **Grok**. A `gsk_...` token is for GroqCloud and cannot access xAI Grok. GroqCloud requests are not locally hosted.

### Amazon Bedrock (hosted, API key required)

Generate an Amazon Bedrock API key in the [AWS Bedrock console](https://console.aws.amazon.com/bedrock) for your AWS Region, then set the key in your hosting environment (or manually in the ignored local `config.env` file):

~~~env
AI_PROVIDER=bedrock
BEDROCK_API_KEY=REPLACE_WITH_YOUR_BEDROCK_KEY
BEDROCK_REGION=us-east-1
BEDROCK_MODEL=amazon.nova-lite-v1:0
~~~

Both `.ai` and `.chatbot` use the [Amazon Bedrock Runtime Converse API](https://docs.aws.amazon.com/bedrock/latest/userguide/conversation-inference.html), using bearer-token authorization, system instructions, and chat history. Choose a model ID or inference profile supporting Converse in your configured AWS Region. The default is Amazon Nova Lite; inference incurs AWS charges. Model access and IAM permissions must be configured in AWS.

`AWS_BEARER_TOKEN_BEDROCK` can also supply the token, and `AWS_REGION` can supply the Region. The explicit `BEDROCK_*` variables take priority. This integration implements **Bedrock API key/Bearer authentication only** (not AWS access key/secret SigV4 authentication). AWS recommends short-term credentials for production, which require renewal; the bot reads a current key from its environment and does not refresh expired keys.

Never send API keys through WhatsApp commands such as `.setvar` or `.setenv` or commit them to GitHub. The bot hides Bedrock credentials from variable-output commands.

### Troubleshooting Amazon Bedrock HTTP 401 or 403

A successful `.chatbot on` means the WhatsApp handler is enabled; it does **not** verify AWS model access. A successful `.chatbot status` only reports whether an API key is configured, not whether AWS accepts it.

- **HTTP 401:** Check that `BEDROCK_API_KEY` is a genuine Amazon Bedrock API key, has not expired, and matches the AWS Region. Short-term keys expire within 12 hours (or sooner when their console session ends).
- **HTTP 403:** Check the IAM identity linked to the API key and any AWS Organizations policies. The identity needs permission to invoke the model (`bedrock:InvokeModel`) and must not be denied `bedrock:CallWithBearerToken`. Check account/model activation or billing restrictions as applicable.
- **Wrong Region:** Set `BEDROCK_REGION` to the Region where you generated your key (especially for short-term keys). Ensure `BEDROCK_MODEL` is available in that Region.
- **Wrong secret loaded:** `BEDROCK_API_KEY` takes precedence over `AWS_BEARER_TOKEN_BEDROCK`. If both are set, an old `BEDROCK_API_KEY` can override a fresh `AWS_BEARER_TOKEN_BEDROCK`. Restart the bot after replacing environment secrets.

You can test a non-streaming inference request directly from the bot's host without printing the key:

~~~bash
curl -sS -o /tmp/bedrock-check.json -w 'HTTP %{http_code}\n' \
  -X POST "https://bedrock-runtime.us-east-1.amazonaws.com/model/amazon.nova-lite-v1:0/converse" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $BEDROCK_API_KEY" \
  -d '{"messages":[{"role":"user","content":[{"text":"Say hello"}]}]}'
cat /tmp/bedrock-check.json
~~~

Use the same Region/model as your deployment (adjust the URL accordingly). Run this only where the `BEDROCK_API_KEY` environment variable is loaded. Never post API keys or complete HTTP request headers in a support chat. The AWS error body may help diagnose permissions; redact account identifiers before sharing logs.

AWS references: [API keys](https://docs.aws.amazon.com/bedrock/latest/userguide/api-keys.html), [Use an API key](https://docs.aws.amazon.com/bedrock/latest/userguide/api-keys-use.html), [Converse permissions](https://docs.aws.amazon.com/bedrock/latest/APIReference/API_runtime_Converse.html).

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

If `AI_PROVIDER` is omitted, the bot selects Groq if `GROQ_API_KEY` exists, otherwise Bedrock if a Bedrock key exists, or Ollama if neither key exists. If both keys exist, explicitly set `AI_PROVIDER=bedrock` to use Bedrock. For Docker, `127.0.0.1` is inside the container. Configure `LOCAL_AI_URL` to a reachable Ollama host address or run both services on a suitable shared network.

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

Use `.ai your question` for a single question, `.chatbot on` to auto-reply in the current chat, `.chatbot off` to disable, `.chatbot status` for provider/model info, and `.chatbot clear` to reset the chat context. Global `.chatbot on groups` and `.chatbot on dms` can generate a high number of cloud API requests and charges. Restart the bot after changing provider environment variables.

Run `node --test tests/ai-provider.test.js` to test provider routing without network access.

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
