const { Module } = require("../main");
const {
  pinterestSearch,
  downloadGram,
  pinterestDl,
  tiktok,
  igStalk,
  fb,
  story,
} = require("./utils");
const botConfig = require("../config");
const axios = require("axios");
const isFromMe = botConfig.MODE === "public" ? false : true;

async function checkRedirect(url) {
  // Only follow Instagram share links. Do not request unrelated URLs.
  let parsed;
  try {
    parsed = new URL(url);
  } catch (_) {
    return null;
  }
  if (!["instagram.com", "www.instagram.com", "instagr.am", "www.instagr.am"].includes(parsed.hostname)) {
    return null;
  }
  if (!parsed.pathname.startsWith("/share/")) return parsed.href;
  try {
    const res = await axios.get(parsed.href, { timeout: 10000, maxRedirects: 5 });
    const redirected = res.request?.res?.responseUrl;
    const target = new URL(redirected || parsed.href);
    return ["instagram.com", "www.instagram.com"].includes(target.hostname) ? target.href : null;
  } catch (_) {
    return null;
  }
}
Module(
  {
    pattern: "insta ?(.*)",
    fromMe: isFromMe,
    desc: "Instagram post/reel/tv/highlights downloader - supports multiple links",
    usage: "insta link(s) or reply to link(s)",
    use: "download",
  },
  async (message, match) => {
    let mediaLinks = (match?.[1] || message.reply_message?.text || "").trim();
    if (mediaLinks?.startsWith("ll")) return;
    if (!mediaLinks)
      return await message.sendReply("_*Need Instagram link(s)*_");

    // extract all urls from the text
    const allUrls = mediaLinks.match(/\bhttps?:\/\/\S+/gi) || [];
    if (!allUrls.length)
      return await message.sendReply("_*Need Instagram link(s)*_");

    // filter and validate instagram urls
    const instagramUrls = [];
    const instagramRegex =
      /^https?:\/\/(?:www\.)?instagram\.com\/(?:p|reel|tv)\/[\w-]+/i;

    for (let url of allUrls) {
      if (url.includes("gist") || url.includes("youtu") || url.startsWith("ll"))
        continue;

      url = await checkRedirect(url.replace(/[)\].,!?>]*$/, ""));
      if (url && instagramRegex.test(url)) {
        instagramUrls.push(url);
      }
    }

    if (!instagramUrls.length)
      return await message.sendReply("_Need valid Instagram link(s)_");

    try {
      const allMediaUrls = [];
      const quotedMessage = message.reply_message
        ? message.quoted
        : message.data;

      // download from all urls
      for (const url of instagramUrls) {
        try {
          const downloadResult = await downloadGram(url);
          if (downloadResult && downloadResult.length) {
            allMediaUrls.push(...downloadResult);
          }
        } catch (err) {
          console.error("Error downloading from:", url, err?.message);
        }
      }

      if (!allMediaUrls.length)
        return await message.sendReply(
          "_Instagram download failed. Check that the link is public, or configure YTDLP_COOKIES for login-required media._"
        );

      // send as single media or album
      if (allMediaUrls.length === 1) {
        return await message.sendMessage(
          { url: allMediaUrls[0] },
          /\.(jpg|jpeg|png|webp|heic)(\?|$)/i.test(allMediaUrls[0])
            ? "image"
            : "video",
          {
            quoted: quotedMessage,
            ...(/\.mp4$/i.test(allMediaUrls[0]) ? { mimetype: "video/mp4" } : {}),
          }
        );
      }

      // send as album
      const albumObject = allMediaUrls.map((mediaUrl) => {
        return /\.(jpg|jpeg|png|webp|heic)(\?|$)/i.test(mediaUrl)
          ? { image: mediaUrl }
          : { video: mediaUrl, mimetype: "video/mp4" };
      });
      albumObject[0].caption = `_Download complete! (${allMediaUrls.length} items)_`;
      return await message.client.albumMessage(
        message.jid,
        albumObject,
        message.data
      );
    } catch (err) {
      console.error("Insta command error:", err?.message || err);
      return await message.sendReply(
        "_Something went wrong, Please try again!_"
      );
    }
  }
);

Module(
  {
    pattern: "fb ?(.*)",
    fromMe: isFromMe,
    desc: "Facebook video downloader",
    usage: "fb link or reply to a link",
    use: "download",
  },
  async (message, match) => {
    let videoLink = !message.reply_message?.message
      ? match[1]
      : message.reply_message.message;

    if (/\bhttps?:\/\/\S+/gi.test(videoLink)) {
      videoLink = videoLink.match(/\bhttps?:\/\/\S+/gi)[0];
    }
    if (!videoLink) return await message.sendReply("_Need facebook link_");
    try {
      const { url } = await fb(videoLink);
      return await message.sendReply({ url }, "video");
    } catch (e) {
      console.error("Facebook download error:", e.message);
      return await message.sendReply(
        "_Something went wrong, Please try again!_"
      );
    }
  }
);

Module(
  {
    pattern: "ig ?(.*)",
    fromMe: isFromMe,
    desc: "Gets account info from instagram",
    usage: "ig username",
    excludeFromCommands: true,
    use: "search",
  },
  async (message, match) => {
    if (!match[1]) return await message.sendReply("_Need Instagram username!_");

    if (match[1].startsWith("https") && match[1].includes("instagram")) {
      const usernameRegex = /instagram\.com\/([^/?]+)/i;
      const usernameMatch = match[1].match(usernameRegex);
      match[1] = usernameMatch && usernameMatch[1];
    }

    try {
      var accountInfo = await igStalk(encodeURIComponent(match[1]));
    } catch {
      return await message.sendReply("_Server busy!_");
    }

    await message.sendMessage({ url: accountInfo.profile_pic }, "image", {
      caption: `_*Name:*_ ${accountInfo.full_name}\n_*Followers:*_ ${
        accountInfo.followers
      }\n_*Following:*_ ${accountInfo.following}\n_*Bio:*_ ${
        accountInfo.bio
      }\n_*Private account:*_ ${
        accountInfo.is_private ? "Yes" : "No"
      } \n_*Posts:*_ ${accountInfo.posts}`,
      quoted: message.data,
    });
  }
);

Module(
  {
    pattern: "story ?(.*)",
    fromMe: isFromMe,
    desc: "Instagram stories downloader",
    usage: ".story username or link",
    use: "download",
  },
  async (message, match) => {
    let userIdentifier =
      (match?.[1] || message.reply_message?.text || "").trim();

    if (
      userIdentifier &&
      (userIdentifier.includes("/reel/") ||
        userIdentifier.includes("/tv/") ||
        userIdentifier.includes("/p/"))
    )
      return;
    if (!userIdentifier)
      return await message.sendReply("_Need an Instagram username or link!_");

    userIdentifier = !/\bhttps?:\/\/\S+/gi.test(userIdentifier)
      ? `https://instagram.com/stories/${userIdentifier}/`
      : userIdentifier.match(/\bhttps?:\/\/\S+/gi)[0];

    try {
      var storyData = await story(userIdentifier);
    } catch (err) {
      console.error("Instagram story download error:", err?.message || err);
      return await message.sendReply(
        "_Story download or video conversion failed. Check logs, cookies and FFmpeg installation._"
      );
    }
    if (!storyData || !storyData.length)
      return await message.sendReply("*_Not found!_*");
    if (storyData.length === 1)
      return await message.sendReply(
        { url: storyData[0] },
        /\.(jpg|jpeg|png|webp)(\?|$)/i.test(storyData[0]) ? "image" : "video",
        /\.(jpg|jpeg|png|webp)(\?|$)/i.test(storyData[0]) ? {} : { mimetype: "video/mp4" }
      );
    userIdentifier = userIdentifier
      .replace("https://instagram.com/stories/", "")
      .split("/")[0];
    let albumObject = storyData.map((storyMediaUrl) => {
      return /\.(jpg|jpeg|png|webp)(\?|$)/i.test(storyMediaUrl)
        ? { image: storyMediaUrl }
        : { video: storyMediaUrl, mimetype: "video/mp4" };
    });
    albumObject[0].caption = `_Stories from ${userIdentifier}_`;
    return await message.client.albumMessage(
      message.jid,
      albumObject,
      message.data
    );
  }
);

Module(
  {
    pattern: "pinterest ?(.*)",
    fromMe: isFromMe,
    desc: "Pinterest downloader",
    usage: ".pinterest query or link",
    use: "download",
  },
  async (message, match) => {
    let userQuery = (match?.[1] || message.reply_message?.text || "").trim();
    if (userQuery === "g") return;
    if (!userQuery)
      return await message.sendReply("_Need search term or pin video link_");

    if (/\bhttps?:\/\/\S+/gi.test(userQuery)) {
      userQuery = userQuery.match(/\bhttps?:\/\/\S+/gi)[0];
      let pinterestResult;
      try {
        pinterestResult = await pinterestDl(userQuery);
      } catch (err) {
        console.error("pinterestDl error:", err?.message || err);
        return await message.sendReply("_Server error_");
      }

      if (
        !pinterestResult ||
        !pinterestResult.status ||
        !pinterestResult.result
      )
        return await message.sendReply(
          "_No downloadable media found for this link_"
        );

      const url = pinterestResult.result;
      const quotedMessage = message.reply_message
        ? message.quoted
        : message.data;
      await message.sendMessage(
        { url },
        /\.(?:jpe?g|png|webp|heic)(?:\?|$)/i.test(url) ? "image" : "video",
        { quoted: quotedMessage }
      );
    } else {
      let desiredCount = parseInt(userQuery.split(",")[1]) || 5;
      let searchQuery = userQuery.split(",")[0] || userQuery;
      let searchResults;
      try {
        const res = await pinterestSearch(searchQuery, desiredCount);
        if (!res || !res.status || !Array.isArray(res.result)) {
          return await message.sendReply("_No results found for this query_");
        }
        searchResults = res.result;
      } catch (err) {
        console.error("pinterestSearch error:", err?.message || err);
        return await message.sendReply(
          "_Server error while searching Pinterest_"
        );
      }

      const toDownload = Math.min(Math.max(desiredCount, 1), searchResults.length, 10);
      if (toDownload === 0) return await message.sendReply("_No Pinterest results found._");
      await message.sendReply(
        `_Downloading ${toDownload} results for ${searchQuery} from Pinterest_`
      );

      const imagesToSend = searchResults
        .slice(0, toDownload)
        .map((url) => ({ image: url }));
      imagesToSend[0].caption = `_Pinterest results for ${searchQuery}_`;
      try {
        await message.client.albumMessage(
          message.jid,
          imagesToSend,
          message.data
        );
      } catch (error) {
        console.log(
          "Album send failed, falling back to individual sends:",
          error
        );
        for (const url of searchResults.slice(0, toDownload)) {
          try {
            await message.sendMessage({ url }, "image");
          } catch (error) {
            console.error(
              "Error downloading pinterest item:",
              error?.message || error
            );
          }
        }
      }
    }
  }
);

Module(
  {
    pattern: "tiktok ?(.*)",
    fromMe: isFromMe,
    desc: "TikTok video downloader",
    usage: ".tiktok reply or link",
    use: "download",
  },
  async (message, match) => {
    let videoLink = (match?.[1] || message.reply_message?.text || "").trim();
    if (!videoLink) return await message.sendReply("_Need a TikTok URL_");
    videoLink = videoLink.match(/\bhttps?:\/\/\S+/i)?.[0]?.replace(/[)\].,!?>]*$/, "");
    if (!videoLink) return await message.sendReply("_Need a valid TikTok URL_");
    let downloadResult;
    try {
      downloadResult = await tiktok(videoLink);
      if (!downloadResult?.url) throw new Error("TikTok returned no video file.");
      return await message.sendReply(downloadResult, "video");
    } catch (error) {
      console.error("TikTok download error:", error?.message || error);
      const reason = String(error?.message || "Unknown error").slice(0, 300);
      return await message.sendReply(`_TikTok download failed: ${reason}_`);
    }
  }
);


// Download media from a single X/Twitter post, or a quoted post link.
// The download and upload share the same local implementation as AutoDL.
async function twitterCommand(message, match) {
  const { findTwitterUrl, sendTwitterMedia, twitterFailureReason } =
    require("./utils/twitter");
  const text = String(match?.[1] || message.reply_message?.text ||
    message.reply_message?.message || "").trim();
  const url = findTwitterUrl(text);
  if (!url) {
    return await message.sendReply("_Send a valid X/Twitter post URL or reply to one._");
  }
  try {
    await sendTwitterMedia(message, url);
  } catch (error) {
    console.error("[Twitter/X] command download failed:", error);
    return await message.sendReply(
      "_Twitter/X download failed. " + twitterFailureReason(error) + "_"
    );
  }
}

Module(
  {
    pattern: "twitter ?(.*)",
    fromMe: isFromMe,
    desc: "Download public X/Twitter post videos and photos",
    usage: ".twitter https://x.com/user/status/1234567890123456789",
    use: "download",
  },
  twitterCommand
);

Module(
  {
    pattern: "x ?(.*)",
    fromMe: isFromMe,
    desc: "Alias for Twitter/X media download",
    usage: ".x https://x.com/user/status/1234567890123456789",
    use: "download",
  },
  twitterCommand
);
