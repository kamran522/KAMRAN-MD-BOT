# Instagram and YouTube downloads

The `.insta`, `.story`, `.video`, `.ytv`, `.yta`, and `.play` commands use local download tools. They do not need an external download API.

## Docker deployments

Rebuild the image after pulling the fixes. The Dockerfile installs:
- `yt-dlp[default]` (including the EJS YouTube challenge solver)
- `gallery-dl` (Instagram images, carousels, and video)
- Node.js 22 (already in the base image; enabled as the yt-dlp JavaScript runtime)
- `ffmpeg` (audio conversion and video merging)

Example:

```sh
docker build --pull -t kamran-md-bot .
```

Restart the container through your usual deployment process. Merely restarting an old image will not install these dependencies.

## Non-Docker deployments

On Ubuntu VPS hosts, use a virtual environment to avoid Python's
`externally-managed-environment` (PEP 668) error. Install Node.js 22+ and run
the following commands **from the bot repository root**:

```sh
sudo apt update
sudo apt install -y python3-venv ffmpeg
python3 -m venv .venv
./.venv/bin/python -m pip install -U 'yt-dlp[default]' gallery-dl
./.venv/bin/yt-dlp --version
./.venv/bin/gallery-dl --version
node --version
```

The bot automatically detects `.venv/bin/yt-dlp` and
`.venv/bin/gallery-dl`, even when PM2 does not inherit interactive shell
exports. You can still override their locations through `YTDLP_PATH` and
`GALLERYDL_PATH`. `core/services.js` enables `--js-runtimes node` for
yt-dlp; `YTDLP_ARGS` can provide extra options.

After pulling the latest code, restart PM2:

```sh
git pull origin main
pm2 restart kamran-MD-bot --update-env
```

## Instagram and YouTube login-required content

YouTube can return `Sign in to confirm you're not a bot` for server IP
addresses, and Instagram can redirect anonymous downloads to the login page.
These are site-side authentication restrictions, **not an installation error**.

Export authorized cookies from **your own logged-in browser sessions** for
the relevant sites, using Netscape `cookies.txt` format. For YouTube, follow
[yt-dlp's official export instructions](https://github.com/yt-dlp/yt-dlp/wiki/Extractors#exporting-youtube-cookies).
Keep the two cookie files separate. Never commit, paste, or send these files
to anyone: they grant access to your browser sessions.

Store them outside the Git repository (example locations on an Ubuntu VPS):

```text
/home/ubuntu/.config/kamran-md/youtube-cookies.txt
/home/ubuntu/.config/kamran-md/instagram-cookies.txt
```

Create the private directory on the VPS and copy the exported files there
using a secure transfer (for example, `scp`). Then set permissions:

```sh
mkdir -p "$HOME/.config/kamran-md"
chmod 700 "$HOME/.config/kamran-md"
chmod 600 "$HOME/.config/kamran-md/"*cookies.txt
```

To configure the **existing** PM2 process, run from the bot directory:

```sh
YTDLP_COOKIES_YOUTUBE="$HOME/.config/kamran-md/youtube-cookies.txt" \
YTDLP_COOKIES_INSTAGRAM="$HOME/.config/kamran-md/instagram-cookies.txt" \
pm2 restart kamran-MD-bot --update-env

pm2 save
```

The bot passes `YTDLP_COOKIES_YOUTUBE` only to YouTube requests, and
`YTDLP_COOKIES_INSTAGRAM` to Instagram requests from both `gallery-dl`
and `yt-dlp`. The old `YTDLP_COOKIES` variable remains a fallback for
older deployments but should not be used to share a site's session cookies
with another site. For Instagram stories, an Instagram cookie file is required.
The account must already have access to the requested content.

You can test the cookie files **locally on the VPS**, without showing their
contents to anyone:

```sh
./.venv/bin/yt-dlp --js-runtimes node \
  --cookies "$HOME/.config/kamran-md/youtube-cookies.txt" \
  -F 'https://youtube.com/shorts/-rumnXioCL8'

./.venv/bin/gallery-dl \
  --cookies "$HOME/.config/kamran-md/instagram-cookies.txt" \
  --range 1-10 'https://www.instagram.com/reel/Dfvwcy1sA5_/'
```

Cookies can expire or be revoked. Even valid cookies may not solve YouTube
IP-based challenges or Instagram rate limits. If access is still denied,
check the site in your browser, wait for rate limits to clear, or use a
permitted download method; do not repeatedly retry blocked requests.

## YouTube playback client on AWS EC2

The authenticated YouTube Shorts download on the AWS VPS succeeded using
the `web_safari` player client, a running bgutil PO-token provider on
`127.0.0.1:4416`, Node.js 22, and refreshed YouTube cookies. The bot
now automatically adds `--extractor-args youtube:player_client=web_safari`
to **YouTube-only** yt-dlp commands (metadata, video, and audio).

The Python `bgutil-ytdlp-pot-provider` package and its local token server
are separate VPS dependencies; merely pulling the bot from GitHub does not
install or launch the token server. Check:

```sh
pm2 list
./.venv/bin/python -m pip show bgutil-ytdlp-pot-provider
```

Use `YTDLP_YOUTUBE_CLIENT=mweb` (or another client supported by your yt-dlp
version) to override the default for your environment. Use
`YTDLP_YOUTUBE_CLIENT=default` to leave the selection to yt-dlp. Instagram
downloads are unaffected.

After updating the bot, restart PM2 with your private cookie paths:

```sh
cd ~/KAMRAN-MD-BOT
git pull origin main

YTDLP_COOKIES_YOUTUBE="$HOME/.config/kamran-md/youtube-cookies.txt" \
YTDLP_COOKIES_INSTAGRAM="$HOME/.config/kamran-md/instagram-cookies.txt" \
pm2 restart kamran-MD-bot --update-env
pm2 save
```

A successful command-line test proves that those particular video fragments
were accessible when tested. It does not guarantee that every YouTube video
will work or that credentials will stay valid.

## Check a failing URL

Try the URL in the container or server first:

```sh
yt-dlp --js-runtimes node -F 'https://www.youtube.com/watch?v=VIDEO_ID'
gallery-dl --range 1-10 'https://www.instagram.com/p/POST_ID/'
```

If YouTube fails with a challenge or signature error, update `yt-dlp[default]` and verify Node 22+ is installed. If Instagram returns a login or 429 error, check the cookies and account access. The `.story` command requires cookies.

To run the offline regression tests without connecting to Instagram or YouTube:

```sh
node --test tests/media-downloads.test.js
```

## Diagnose persistent errors on a VPS

Run the following from the bot's root folder (these do not change your code):

```sh
./.venv/bin/yt-dlp --js-runtimes node -F 'https://youtube.com/shorts/-rumnXioCL8'
./.venv/bin/gallery-dl --range 1-10 'https://www.instagram.com/reel/Dfvwcy1sA5_/'
pm2 logs kamran-MD-bot --lines 80 --nostream
```

If yt-dlp reports an EJS or JavaScript challenge issue, upgrade
`yt-dlp[default]` in the venv and verify Node.js is v22 or newer. If the
extractor reports HTTP 403, 429, or login required, the site may be rejecting
the server IP or requiring valid cookies. Instagram can require valid cookies
even for some public Reels; a bot update alone cannot overcome server-side
restrictions. Never post session cookies or credentials in issue logs.
