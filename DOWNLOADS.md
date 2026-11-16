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

## Instagram login-required content

For posts/stories needing Instagram login, export **your own** browser session cookies in Netscape `cookies.txt` format, then set:

```sh
YTDLP_COOKIES=/secure/path/instagram-cookies.txt
```

The same file is passed to `gallery-dl` and `yt-dlp`. Make the file readable by the bot process, keep it private, never commit it to Git, and replace it if expired. The account must have permission to view the content. Some content remains unavailable due to website restrictions, rate limits, region restrictions, or unavailable extractor support.

If you also need YouTube cookies, use the appropriate cookies file for the site you are downloading; the single `YTDLP_COOKIES` setting applies to both downloaders.

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
