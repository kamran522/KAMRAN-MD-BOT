# What was changed from upstream Raganork-MD 7.0.0

## Found
`core/private.js` was an 81 KB obfuscated, closed-source blob (webcrack + a string-table decoder were needed to read it).
It was not logic — it was a client for the authors' servers:

- Hardcoded hosts: raganork-api-n4bp.onrender.com, raganork-network.vercel.app, a koyeb.app service,
  sandbox.rgnk.site, h85.raganork.site, events.rgnk.site/events (live event stream), api1.rgnk.site, yt.rgnk.site
- `fetchInitialSession` — your WhatsApp session was fetched from / held by their backend (the bot could not log in without it)
- `createAnnouncementFeed` — kept an EventSource connection to events.rgnk.site, reported your bot version and number
  of connected sessions, and let them push messages to your owner chat
- All downloaders (Instagram, Facebook, TikTok, Pinterest, Spotify, YouTube), lyrics, music-id, attp and webp->mp4 ran on their servers
- Hardcoded API tokens/keys for those servers
- Auto-update forced ON (`AUTO_UPDATE: ... || true`): every 2 minutes `git reset --hard && git pull` from the author's
  GitHub, then restart — they could ship any code to every instance
- Default group JIDs hardcoded in config.js (`RG`, `ANTI_SPAM`)

## Removed
- (round 2) `plugins/external-plugin.js` (`.install`/`.plugin`/`.remove`: downloaded and ran code from any URL) and `plugins/sql/plugin.js`
- (round 2) boot-time loop in `core/handler.js` that re-downloaded and `require()`d plugin code from saved URLs on every start
- (round 2) dead update-checker code in `core/schedulers.js`
- core/private.js (replaced by readable core/services.js)
- remote session backend; announcement feed / version + session-count reporting
- auto-update scheduler, update notifier, `plugins/updater.js`, `simple-git` and `eventsource` dependencies
- hardcoded group JIDs; Dockerfile `git clone` of upstream; links to the author's session site in README

## Added
- Local login: fresh credentials + QR or pairing code (`PAIR_NUMBER`). The original could NOT log in without the authors' backend.
- core/services.js: open implementations — YouTube/TikTok/Facebook/Instagram/Pinterest via local yt-dlp, webp->mp4 via
  anim_dump+ffmpeg, animated text via Jimp+ffmpeg, optional ACRCloud with your own keys, Spotify title read from the page you link
- `npm run audit:hosts`; session ids accept plain names (default `main`)

## Re-added (round 3, open / local only)
- Instagram profile (`.ig`): direct request to instagram.com from your machine
- Instagram stories (`.story`): local yt-dlp, needs your own `YTDLP_COOKIES` file
- Pinterest search: Pinterest's own public search endpoint
- Lyrics (`.lyrics`): lrclib.net, an open-source community lyrics database
- Downloader hardening: yt-dlp retries, fragment retries, 30s socket timeout, 4 parallel fragments; Docker installs latest yt-dlp via pip

## Rebrand (round 3)
Name/owner set to Kamran Hasil, default SUDO 9231118401. Original GPL-3.0 LICENSE and attribution to Sourav K kept in NOTICE.md as the license requires.

## Kept (not phone-home)
Owner-only `>` eval (your own account/SUDO only), KickBot (pings YOUR OWN hosting URL on Render/Koyeb/Railway only),
Gemini/chatbot, TTS, translate, catbox/imgbb uploads and Render API — all user-triggered with your own keys.
Baileys itself looks up the latest WhatsApp Web version on GitHub (library behaviour; disable with `WA_VERSION`).

## Not changed (branding — your call)
Name "Raganork", author credit "Sourav K" in package.json, sticker-pack links to github.com/souravkl11, `SUPPORT_GROUP`
(t.me/raganork_in), help/menu text. GPL-3.0 requires keeping the license and copyright notices.
