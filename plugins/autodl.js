const { Module } = require("../main");
const config = require("../config");
const { setVar } = require("./manage");
const { downloadGram, pinterestDl, tiktok, fb } = require("./utils");
const { spotifyTrack } = require("../core/services");
const { getVideoInfo, downloadAudio, convertM4aToMp3, searchYoutube } = require("./utils/yt");
const fs = require("fs");
const { normalizeTwitterUrl, findTwitterUrl, sendTwitterMedia, twitterFailureReason } =
  require("./utils/twitter");
// Explicitly enabled chats should process links sent by ordinary group members too.

const HANDLER_PREFIX =
  config.HANDLERS === "false" ? "" : (config.HANDLERS || ".").charAt(0);

const URL_PATTERNS = {
  instagram:
    /^https?:\/\/(?:www\.)?instagram\.com\/(?:p\/[A-Za-z0-9_-]+\/?|reel\/[A-Za-z0-9_-]+\/?|tv\/[A-Za-z0-9_-]+\/?|stories\/[A-Za-z0-9_.-]+\/\d+\/?)(?:\?.*)?$/i,
  youtube:
    /^https?:\/\/(?:www\.)?(?:youtube\.com\/(?:watch\?v=|shorts\/[A-Za-z0-9_-]+\/?)|youtu\.be\/)([A-Za-z0-9_-]{11})?(?:[\?&].*)?$/i,
  spotify:
    /^https?:\/\/(?:open\.)?spotify\.com\/(?:intl-[a-z]{2}\/)?track\/[A-Za-z0-9]+(?:\?.*)?$/i,
  tiktok:
    /^https?:\/\/(?:(?:www|m)\.)?tiktok\.com\/(?:@?[A-Za-z0-9_.-]+\/video\/\d+|t\/[A-Za-z0-9_-]+\/?)(?:\?.*)?$|^https?:\/\/(?:vm|vt|v)\.tiktok\.com\/[A-Za-z0-9_-]+\/?(?:\?.*)?$/i,
  pinterest:
    /^https?:\/\/(?:www\.)?(?:pinterest\.com\/(?:pin\/\d+\/?[A-Za-z0-9_-]*)\/?|pin\.it\/[A-Za-z0-9_-]+\/?)(?:\?.*)?$/i,
  twitter:
    /^https?:\/\/(?:www\.)?(?:twitter\.com|x\.com|mobile\.twitter\.com)\/[A-Za-z0-9_]{1,15}\/status\/\d+(?:\?.*)?$/i,
  facebook:
    /^https?:\/\/(?:www\.)?(?:fb\.watch\/[A-Za-z0-9_-]+\/?|(?:facebook\.com|m\.facebook\.com)\/(?:(?:watch(?:\/?|\?v=))|(?:.*\/videos?\/\d+)|(?:video\.php\?v=\d+)|(?:.*\/posts\/\d+))(?:[\s\S]*)?)$/i,
};

function getFirstUrl(text) {
  if (!text) return null;
  const urlMatch = text.match(/https?:\/\/\S+/i);
  if (!urlMatch) return null;
  return urlMatch[0].replace(/[)\]\.,!?>]*$/, "");
}

function getAllUrls(text) {
  const input = String(text || "");
  const matches = (input.match(/https?:\/\/\S+/gi) || [])
    .map((url) => url.replace(/[)\]\.,!?>]*$/, ""));
  // Include a bare x.com status link when WhatsApp does not prepend https://.
  const post = findTwitterUrl(input);
  if (post && !matches.some((url) => {
    try { return normalizeTwitterUrl(url) === post; } catch (_) { return false; }
  })) matches.push(post);
  return matches;
}

function detectPlatform(url) {
  // Match the same X variants accepted by the explicit .twitter command.
  // Avoid a second, stricter regex that silently drops mobile / photo URLs.
  try { normalizeTwitterUrl(url); return "twitter"; } catch (_) {}
  for (const [platform, re] of Object.entries(URL_PATTERNS)) {
    if (re.test(url)) return platform;
  }
  return null;
}

function isAlreadyCommand(text) {
  const input = String(text || "").trim();
  if (!input) return false;
  const handlerChars = config.HANDLERS === "false" ? "" : String(config.HANDLERS || ".");
  const rest = handlerChars
    ? (handlerChars.includes(input[0]) ? input.slice(1).trimStart() : "")
    : input;
  return /^(?:insta|instah|story|storyh|tiktok|tiktokh|pinterest|pinteresth|twitter|twitterh|x|xh|fb|fbh|play|playh|ytv|ytvh|yta|ytah|spotify|spotifyh)(?:\s|$)/i.test(rest);
}

function mediaKind(file) {
  return /\.(?:jpe?g|png|webp|heic)(?:\?.*)?$/i.test(String(file)) ? "image" : "video";
}

function cleanDownloads(paths) {
  for (const file of new Set(paths.filter((item) => typeof item === "string"))) {
    try {
      if (fs.existsSync(file)) fs.unlinkSync(file);
    } catch (error) {
      console.warn("[AutoDL cleanup]", error?.message || error);
    }
  }
}

async function sendMediaFiles(message, files) {
  for (const file of files) {
    const kind = mediaKind(file);
    await message.sendMessage({ url: file }, kind, {
      quoted: message.data,
      ...(kind === "video" ? { mimetype: "video/mp4" } : {}),
    });
  }
}

function formatBytes(bytes) {
  if (bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return Math.round((bytes / Math.pow(k, i)) * 100) / 100 + " " + sizes[i];
}

Module({ on: "text", fromMe: false }, async (message) => {
  try {
    if (message.fromBot) return;
    const chatJid = message.jid;
    const isGroup = chatJid.includes("@g.us");
    const autodlEnabledForChat = (() => {
      try {
        const enabledList = config.AUTODL || "";
        const enabled = enabledList
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean);
        if (enabled.includes(chatJid)) return true;
        if (isGroup && config.AUTODL_ALL_GROUPS === "true") return true;
        if (!isGroup && config.AUTODL_ALL_DMS === "true") return true;
        return false;
      } catch (e) {
        return false;
      }
    })();
    if (!autodlEnabledForChat) return;
    let text = message.text || "";
    if (isAlreadyCommand(text)) return;

    // Some WhatsApp link previews expose the URL separately from the caption.
    const preview = message.data?.message?.extendedTextMessage;
    const input = [text, preview?.canonicalUrl, preview?.matchedText]
      .filter((item) => typeof item === "string" && item.trim()).join(" ");
    const urls = getAllUrls(input);
    if (!urls.length) return;

    // group urls by platform
    const platformGroups = {};
    const unsupportedUrls = [];

    for (const url of urls) {
      const platform = detectPlatform(url);
      if (!platform) {
        unsupportedUrls.push(url);
      } else {
        if (!platformGroups[platform]) platformGroups[platform] = [];
        platformGroups[platform].push(platform === "twitter" ? normalizeTwitterUrl(url) : url);
      }
    }

    if (!Object.keys(platformGroups).length) return;

    await message.react("⬇️");

    try {
      // handle youtube separately (only process first url for yt)
      if (platformGroups["youtube"]) {
        let url = platformGroups["youtube"][0];

        // Convert YouTube Shorts URL to regular watch URL if needed
        if (url.includes("youtube.com/shorts/")) {
          const shortId = url.match(
            /youtube\.com\/shorts\/([A-Za-z0-9_-]+)/
          )?.[1];
          if (shortId) {
            url = `https://www.youtube.com/watch?v=${shortId}`;
          }
        }

        const lowerText = text.toLowerCase();
        const isAudioMode =
          /\baudio\b|\bmp3\b/.test(lowerText) && !isAlreadyCommand(text);

        try {
          // if message contains "audio" or "mp3", download as audio
          if (isAudioMode) {
            let downloadMsg;
            let audioPath;
            let originalPath;

            try {
              downloadMsg = await message.sendReply("_Downloading audio..._");
              const result = await downloadAudio(url);
              originalPath = result.path;
              audioPath = originalPath;

              audioPath = await convertM4aToMp3(originalPath, {
                title: result?.title,
                artist: result?.info?.channel?.name,
                thumbnail: result?.info?.thumbnail,
              });

              await message.edit("_Sending audio..._", message.jid, downloadMsg.key);
              await message.sendMessage({ url: audioPath }, "document", {
                fileName: (result.title || "YouTube audio") + (String(audioPath).toLowerCase().endsWith(".mp3") ? ".mp3" : ".m4a"),
                mimetype: String(audioPath).toLowerCase().endsWith(".mp3") ? "audio/mpeg" : "audio/mp4",
                caption: "_*" + (result.title || "YouTube audio") + "*_",
              });
              await message.edit("_Download complete!_", message.jid, downloadMsg.key);
            } catch (error) {
              console.error("[AutoDL YT Audio]", error);
              const hint = /part-Frag|ENOENT|No such file or directory/i.test(error?.message || "")
                ? "The downloader lost a temporary file. Check /tmp and update yt-dlp."
                : "See the bot's PM2 logs for the downloader error.";
              if (downloadMsg) {
                await message.edit("_YouTube audio download failed. " + hint + "_", message.jid, downloadMsg.key);
              } else {
                await message.sendReply("_YouTube audio download failed. " + hint + "_");
              }
            } finally {
              cleanDownloads([audioPath, originalPath]);
            }
            return;
          }

          // else download video with quality selection
          const info = await getVideoInfo(url);
          const videoFormats = info.formats
            .filter((f) => f.type === "video" && f.quality)
            .sort((a, b) => {
              const getRes = (q) => {
                const match = q.match(/(\d+)/);
                return match ? parseInt(match[1]) : 0;
              };
              return getRes(b.quality) - getRes(a.quality);
            });

          const uniqueQualities = [
            ...new Set(videoFormats.map((f) => f.quality)),
          ];

          const videoIdMatch = url.match(
            /(?:youtube\.com\/(?:watch\?v=|shorts\/)|youtu\.be\/)([^&\s/?]+)/
          );
          const videoId = videoIdMatch ? videoIdMatch[1] : info.videoId || "";

          let qualityText = "_*Select Video Quality*_\n\n";
          qualityText += `_*${info.title}*_\n\n(${videoId})\n\n`;

          if (uniqueQualities.length === 0) {
            await message.react("❌");
            return;
          }

          uniqueQualities.forEach((quality, index) => {
            const format = videoFormats.find((f) => f.quality === quality);
            const audioFormat = info.formats.find((f) => f.type === "audio");

            let sizeInfo = "";
            if (format.size && audioFormat?.size) {
              const parseSize = (sizeStr) => {
                const match = sizeStr.match(/([\d.]+)\s*(KB|MB|GB)/i);
                if (!match) return 0;
                const value = parseFloat(match[1]);
                const unit = match[2].toUpperCase();
                if (unit === "KB") return value * 1024;
                if (unit === "MB") return value * 1024 * 1024;
                if (unit === "GB") return value * 1024 * 1024 * 1024;
                return value;
              };

              const videoSize = parseSize(format.size);
              const audioSize = parseSize(audioFormat.size);
              const totalSize = videoSize + audioSize;

              if (totalSize > 0) {
                sizeInfo = ` ~ _${formatBytes(totalSize)}_`;
              }
            }

            qualityText += `*${index + 1}.* _*${quality}*_${sizeInfo}\n`;
          });

          const audioFormat = info.formats.find((f) => f.type === "audio");
          if (audioFormat) {
            let audioSizeInfo = "";
            if (audioFormat.size) {
              const parseSize = (sizeStr) => {
                const match = sizeStr.match(/([\d.]+)\s*(KB|MB|GB)/i);
                if (!match) return 0;
                const value = parseFloat(match[1]);
                const unit = match[2].toUpperCase();
                if (unit === "KB") return value * 1024;
                if (unit === "MB") return value * 1024 * 1024;
                if (unit === "GB") return value * 1024 * 1024 * 1024;
                return value;
              };
              const audioSize = parseSize(audioFormat.size);
              if (audioSize > 0) {
                audioSizeInfo = ` ~ _${formatBytes(audioSize)}_`;
              }
            }
            qualityText += `*${uniqueQualities.length + 1}.* _*Audio Only*_${audioSizeInfo}\n`;
          }

          qualityText += "\n_Reply with a number to download_";
          await message.sendReply(qualityText);
        } catch (err) {
          if (config.DEBUG) console.error("[AutoDL YT]", err?.message || err);
          await message.react("❌");
        }
        return;
      }

      // Instagram photos, Reels and carousels are returned as local files.
      if (platformGroups.instagram) {
        const files = [];
        const failures = [];
        try {
          for (const url of platformGroups.instagram) {
            try {
              const downloaded = await downloadGram(url);
              if (Array.isArray(downloaded)) files.push(...downloaded);
            } catch (error) {
              failures.push(error?.message || String(error));
              console.error("[AutoDL Instagram]", error);
            }
          }
          if (!files.length) {
            await message.sendReply("_Instagram download failed. " +
              (failures[0] ? "Check the PM2 log; Instagram may require valid cookies." : "No media was found.") + "_");
            await message.react("❌");
            return;
          }
          // Sequential uploads work even when the socket has no albumMessage method.
          await sendMediaFiles(message, files);
        } catch (error) {
          console.error("[AutoDL Instagram upload]", error);
          await message.sendReply("_Instagram media could not be sent. Check the PM2 log._");
          await message.react("❌");
        } finally {
          cleanDownloads(files);
        }
        return;
      }

      // TikTok returns a local video path inside {url}.
      if (platformGroups.tiktok) {
        let file;
        try {
          const result = await tiktok(platformGroups.tiktok[0]);
          file = result?.url;
          if (!file) throw new Error("TikTok downloader did not return a video file.");
          await message.sendReply({ url: file }, "video", { mimetype: "video/mp4" });
        } catch (error) {
          console.error("[AutoDL TikTok]", error);
          const reason = String(error?.message || "Unknown error").slice(0, 220);
          await message.sendReply("_TikTok download failed: " + reason + "_");
          await message.react("❌");
        } finally {
          cleanDownloads([file]);
        }
        return;
      }

      // Pinterest can contain images as well as video.
      if (platformGroups.pinterest) {
        const files = [];
        try {
          for (const url of platformGroups.pinterest) {
            const result = await pinterestDl(url);
            if (result?.status && result.result) files.push(result.result);
          }
          if (!files.length) throw new Error("No downloadable Pinterest media found.");
          await sendMediaFiles(message, files);
        } catch (error) {
          console.error("[AutoDL Pinterest]", error);
          await message.sendReply("_Pinterest download failed. Check the PM2 log._");
          await message.react("❌");
        } finally {
          cleanDownloads(files);
        }
        return;
      }

      // Facebook uses the local yt-dlp media file.
      if (platformGroups.facebook) {
        let file;
        try {
          const result = await fb(platformGroups.facebook[0]);
          file = result?.url;
          if (!file) throw new Error("Facebook downloader returned no file.");
          await message.sendReply({ url: file }, mediaKind(file));
        } catch (error) {
          console.error("[AutoDL Facebook]", error);
          await message.sendReply("_Facebook download failed. Check the PM2 log._");
          await message.react("❌");
        } finally {
          cleanDownloads([file]);
        }
        return;
      }

      // Spotify metadata is resolved locally; the matched audio is from YouTube.
      if (platformGroups.spotify) {
        let downloadMsg;
        let audioPath;
        let originalPath;
        try {
          downloadMsg = await message.sendReply("_Fetching Spotify info..._");
          const spotifyInfo = await spotifyTrack(platformGroups.spotify[0]);
          const { title, artist } = spotifyInfo;
          await message.edit("_Finding *" + title + "* on YouTube..._", message.jid, downloadMsg.key);
          const query = [title, artist, "audio"].filter(Boolean).join(" ");
          const results = await searchYoutube(query, 1);
          if (!results?.[0]?.url) throw new Error("No matching songs found on YouTube.");
          const result = await downloadAudio(results[0].url);
          originalPath = result.path;
          audioPath = await convertM4aToMp3(originalPath, {
            title: title || result?.title,
            artist: artist || result?.info?.channel?.name,
            thumbnail: spotifyInfo?.thumbnail || result?.info?.thumbnail,
          });
          await message.edit("_Sending audio..._", message.jid, downloadMsg.key);
          await message.sendReply({ url: audioPath }, "audio", {
            mimetype: String(audioPath).endsWith(".mp3") ? "audio/mpeg" : "audio/mp4",
          });
          await message.edit("_Download complete!_", message.jid, downloadMsg.key);
        } catch (error) {
          console.error("[AutoDL Spotify]", error);
          const hint = /fetch failed|ETIMEDOUT|ECONNRESET|ENOTFOUND/i.test(error?.message || "")
            ? "A network request failed. See the PM2 log for the exact error."
            : String(error?.message || "Check the PM2 log.").slice(0, 200);
          if (downloadMsg) {
            await message.edit("_Spotify AutoDL failed. " + hint + "_", message.jid, downloadMsg.key);
          } else {
            await message.sendReply("_Spotify AutoDL failed. " + hint + "_");
          }
        } finally {
          cleanDownloads([audioPath, originalPath]);
        }
        return;
      }

      // Twitter/X videos and photo galleries use the same local downloader
      // as the .twitter / .x commands; temporary files are cleaned after upload.
      if (platformGroups.twitter) {
        try {
          await sendTwitterMedia(message, platformGroups.twitter[0]);
          await message.react("✅");
        } catch (error) {
          console.error("[AutoDL Twitter/X]", error);
          await message.sendReply(
            "_Twitter/X AutoDL failed. " + twitterFailureReason(error) + "_"
          );
          await message.react("❌");
        }
        return;
      }
    } catch (err) {
      if (config.DEBUG) console.error("[AutoDL]", err?.message || err);
      await message.react("❌");
    }
  } catch (err) {
    if (config.DEBUG) console.error("[AutoDL]", err?.message || err);
  }
});

Module(
  {
    pattern: "autodl ?(.*)",
    fromMe: true,
    desc: "Auto-download URL watcher - enable in chats or globally",
    usage:
      ".autodl - show menu\n.autodl on/off - enable/disable in current chat\n.autodl on/off groups - enable/disable in all groups\n.autodl on/off dms - enable/disable in all DMs\n.autodl status - show current status",
  },
  async (message, match) => {
    const input = match[1]?.trim();
    const chatJid = message.jid;

    const readList = () => {
      try {
        const list = config.AUTODL || "";
        return list
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean);
      } catch (e) {
        return [];
      }
    };

    if (!input) {
      const enabledList = readList();
      const enabled = enabledList.includes(chatJid);
      const globalGroups = config.AUTODL_ALL_GROUPS === "true";
      const globalDMs = config.AUTODL_ALL_DMS === "true";

      return await message.sendReply(
        `*_⬇️ AutoDownload Manager_*\n\n` +
          `- _Current chat:_ ${chatJid.includes("@g.us") ? "Group" : "DM"}\n` +
          `- _Status:_ ${enabled ? "Enabled ✅" : "Disabled ❌"}\n` +
          `- _Global Groups:_ ${
            globalGroups ? "Enabled ✅" : "Disabled ❌"
          }\n` +
          `- _Global DMs:_ ${globalDMs ? "Enabled ✅" : "Disabled ❌"}\n\n` +
          `_Commands:_\n` +
          `- \`${HANDLER_PREFIX}autodl on/off\` - Sets in current chat\n` +
          `- \`${HANDLER_PREFIX}autodl on/off groups\` - Sets in all groups\n` +
          `- \`${HANDLER_PREFIX}autodl on dms\` - Sets in all DMs\n` +
          `- \`${HANDLER_PREFIX}autodl off dms\` - Sets in all DMs\n` +
          `- \`${HANDLER_PREFIX}autodl status\` - Show detailed status`
      );
    }

    const parts = input.split(" ");
    const cmd = parts[0].toLowerCase();
    const target = parts[1]?.toLowerCase();

    if (cmd === "on") {
      if (target === "groups") {
        await setVar("AUTODL_ALL_GROUPS", "true");
        return await message.sendReply(
          "_AutoDL enabled for all groups ✅_\n_Use .autodl off groups to disable_"
        );
      } else if (target === "dms") {
        await setVar("AUTODL_ALL_DMS", "true");
        return await message.sendReply(
          "_AutoDL enabled for all DMs ✅_\n_Use .autodl off dms to disable_"
        );
      } else {
        const enabledList = readList();
        if (!enabledList.includes(chatJid)) enabledList.push(chatJid);
        await setVar("AUTODL", enabledList.join(","));
        return await message.sendReply(
          "_AutoDL enabled in this chat ✅_\n_Send a message with a supported URL to auto-convert to download command_"
        );
      }
    }

    if (cmd === "off") {
      if (target === "groups") {
        await setVar("AUTODL_ALL_GROUPS", "false");
        return await message.sendReply(
          "_AutoDL disabled for all groups ❌_\n_Use .autodl on groups to enable_"
        );
      } else if (target === "dms") {
        await setVar("AUTODL_ALL_DMS", "false");
        return await message.sendReply(
          "_AutoDL disabled for all DMs ❌_\n_Use .autodl on dms to enable_"
        );
      } else {
        const enabledList = readList().filter((x) => x !== chatJid);
        await setVar("AUTODL", enabledList.join(","));
        return await message.sendReply(
          "_AutoDL disabled in this chat ❌_\n_Use .autodl on to re-enable_"
        );
      }
    }

    if (cmd === "status") {
      const enabledList = readList();
      const globalGroups = config.AUTODL_ALL_GROUPS === "true";
      const globalDMs = config.AUTODL_ALL_DMS === "true";
      return await message.sendReply(
        `*_AutoDL Status_*\n\n` +
          `• _Enabled chats:_ ${
            enabledList.length > 0 ? enabledList.join(", ") : "None"
          }\n` +
          `• _Global Groups:_ ${
            globalGroups ? "Enabled ✅" : "Disabled ❌"
          }\n` +
          `• _Global DMs:_ ${globalDMs ? "Enabled ✅" : "Disabled ❌"}`
      );
    }

    return await message.sendReply(`_Unknown option: ${cmd}_`);
  }
);
