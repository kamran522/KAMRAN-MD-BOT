# Raganork-MD clean build: audit report

## 1. What was sending data to / taking orders from the authors (all removed)
| Item | What it did | Status |
|---|---|---|
| `core/private.js` (81 KB obfuscated) | Client for 8 author-run servers (rgnk.site hosts, onrender, vercel, koyeb) with hardcoded API tokens | Removed, replaced by readable `core/services.js` |
| Session backend (`fetchInitialSession`) | Your WhatsApp login session was fetched from / held on their server | Removed; local login (QR / pairing code) |
| Announcement feed (`createAnnouncementFeed`) | Live connection to events.rgnk.site; reported bot version and session count; could push messages to your owner chat | Removed |
| Auto-update (forced ON) | Every 2 min `git reset --hard && git pull` from author's GitHub, then restart: remote code execution on every instance | Removed, `AUTO_UPDATE` fixed false, `plugins/updater.js`, `simple-git`, `eventsource` deleted |
| Remote plugin installer (round 2) | `.install <url>` downloaded and ran arbitrary code; saved URLs were re-downloaded and executed on every boot | Removed (`external-plugin.js`, `sql/plugin.js`, boot loop) |
| Server-side downloaders | IG/FB/TikTok/Pinterest/Spotify/YouTube, lyrics, music-id, attp, webp->mp4 ran on their servers (they saw every link you sent) | Replaced with local yt-dlp / ffmpeg / Jimp |
| Hardcoded group JIDs (`RG`, `ANTI_SPAM`) | Bot auto-joined/acted in author-chosen groups | Removed |
| Dockerfile `git clone` of upstream | Pulled author's latest code at build | Now copies your local folder |
| Dead update code (round 2) | Leftover version-compare / timers | Removed |

## 2. Verified clean
- No author-owned host remains in any `.js/.json` file (`npm run audit:hosts` passes).
- All 564 lockfile packages resolve to registry.npmjs.org only; no git/file dependencies.
- No obfuscated code, `new Function`, `vm`, or dynamic remote `require`. No environment, hostname or user-info collection. No hardcoded phone numbers.
- Every `.js` file passes `node --check`.

## 3. Still connects out, only when YOU use the feature (third-party, not the authors)
Instagram, Pinterest and lrclib.net (the re-added features), Google Translate, Google image search, Google input tools (manglish), Gemini chatbot (your key), ttsmp3 (text-to-speech), catbox.moe and imgbb (uploads), Render API (your key), optional ACRCloud (your keys), and WhatsApp itself. Also Baileys checks the latest WhatsApp Web version on GitHub (set `WA_VERSION` to stop it). yt-dlp contacts the video sites you link. These are closed third-party services; if you want zero of them, delete the matching plugin file.

## 4. Kept on purpose
- Owner-only `>` eval (your own account/SUDO only).
- KickBot: pings only YOUR OWN host URL on Render/Koyeb/Railway.

## 5. Re-added (round 3)
Instagram profile, Instagram stories (needs your cookies file), Pinterest search, lyrics, plus yt-dlp retry/timeout hardening. All open or local; none use the authors' servers.

## 5b. Rebrand
Name/owner: Kamran Hasil. Default SUDO/owner: 9231118401. Author's GitHub/Telegram links removed. NOTICE.md and LICENSE keep the GPL-3.0 attribution to the original author.

## 6. Not done / caveats
- Not run against a real WhatsApp login or with yt-dlp installed; the install and login path needs a live test.
- Postgres connections use `rejectUnauthorized:false` (original behaviour, weakens TLS verification). SQLite default is unaffected.
- Branding left alone: name, "Sourav K" credit, sticker-pack links to github.com/souravkl11, t.me/raganork_in. GPL-3.0 requires keeping the license and copyright notices.
