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

Install Node.js 22+, Python 3.11+, `ffmpeg`, and both downloaders in the same environment as the bot:

```sh
python3 -m pip install -U 'yt-dlp[default]' gallery-dl
yt-dlp --version
gallery-dl --version
node --version
```

Ensure the `yt-dlp` and `gallery-dl` commands are on `PATH`, or set `YTDLP_PATH` and `GALLERYDL_PATH`. `core/services.js` enables `--js-runtimes node` for yt-dlp; `YTDLP_ARGS` can still provide extra options.

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
