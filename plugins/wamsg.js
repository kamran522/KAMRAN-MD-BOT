const { Module } = require("../main");
const { isAdmin } = require("./utils");
const { ADMIN_ACCESS, MODE } = require("../config");
const isPrivateMode = MODE !== "public";
Module(
  {
    pattern: "react ?(.*)",
    fromMe: true,
    use: "whatsapp",
  },
  async (m, t) => {
    let msg = {
      remoteJid: m.reply_message?.jid,
      id: m.reply_message.id,
    };
    const reactionMessage = {
      react: {
        text: t[1],
        key: msg,
      },
    };

    await m.client.sendMessage(m.jid, reactionMessage);
  }
);
Module(
  {
    pattern: "edit ?(.*)",
    fromMe: true,
    use: "whatsapp",
  },
  async (m, t) => {
    if (t[1] && m.reply_message?.text && m.quoted.key.fromMe) {
      await m.edit(t[1], m.jid, m.quoted.key);
    }
  }
);
Module(
  {
    pattern: "send ?(.*)",
    fromMe: true,
    desc: "Forwards replied message to the given jid",
    use: "whatsapp",
  },
  async (m, t) => {
    if (!m.reply_message) return await m.sendReply("_Reply to a message_");
    const query = t[1] || m.jid;
    const jidMap = query.split(" ").filter((x) => x.includes("@"));
    if (!jidMap.length) {
      return await m.sendReply(
        "_No valid JID found in the query, use `send jid1 jid2 ...`_"
      );
    }
    for (const jid of jidMap) {
      await m.forwardMessage(jid, m.quoted, {
        contextInfo: { isForwarded: false },
      });
    }
  }
);
Module(
  {
    pattern: "forward ?(.*)",
    fromMe: true,
    desc: "Forwards replied message to the given jid",
    use: "whatsapp",
  },
  async (m, t) => {
    if (!m.reply_message) return await m.sendReply("_Reply to a message_");
    const query = t[1] || m.jid;
    const jidMap = query.split(" ").filter((x) => x.includes("@"));
    if (!jidMap.length) {
      return await m.sendReply(
        "_No valid JID found in the query, use `forward jid1 jid2 ...`_"
      );
    }
    for (const jid of jidMap) {
      await m.forwardMessage(jid, m.quoted, {
        contextInfo: { isForwarded: true, forwardingScore: 2 },
      });
    }
  }
);
Module(
  {
    pattern: "retry ?(.*)",
    fromMe: isPrivateMode,
    desc: "Retries replied command to run the command again",
    use: "misc",
  },
  async (m, t) => {
    if (!m.reply_message)
      return await m.sendReply("_Reply to a command message_");
    await m.client.ev.emit("messages.upsert", {
      messages: [m.quoted],
      type: "notify",
    });
  }
);
// Unwrap WhatsApp's ephemeral/document wrappers and remove the view-once
// flag from a cloned payload so the original quoted object is not mutated.
function unwrapViewOnceMessage(input) {
  if (!input || typeof input !== "object") return null;

  let current = JSON.parse(JSON.stringify(input));
  let foundViewOnceWrapper = false;

  for (let depth = 0; depth < 5; depth++) {
    if (current.ephemeralMessage?.message) {
      current = current.ephemeralMessage.message;
      continue;
    }
    if (current.documentWithCaptionMessage?.message) {
      current = current.documentWithCaptionMessage.message;
      continue;
    }

    const wrapper = [
      "viewOnceMessage",
      "viewOnceMessageV2",
      "viewOnceMessageV2Extension",
    ].find((key) => current[key]?.message);

    if (wrapper) {
      foundViewOnceWrapper = true;
      current = current[wrapper].message;
      continue;
    }
    break;
  }

  const mediaType = [
    "imageMessage",
    "videoMessage",
    "audioMessage",
    "documentMessage",
  ].find((type) => current[type]);

  if (!mediaType) return null;

  const media = current[mediaType];
  if (!foundViewOnceWrapper && !media.viewOnce) return null;

  delete media.viewOnce;
  return { [mediaType]: media };
}

Module(
  {
    pattern: "vv ?(.*)",
    fromMe: true,
    desc: "Recover and forward replied view-once media",
    usage: ".vv (reply to a view-once photo, video, audio or document)",
    use: "utility",
  },
  async (m, match) => {
    const debug = async (text) => {
      try {
        await m.sendReply(text);
      } catch (sendError) {
        console.error(".vv could not send diagnostic to chat:", sendError);
      }
    };

    // This message confirms that the command matcher reached the .vv handler.
    await debug("🔎 .vv diagnostic: command received. Checking the quoted message...");

    try {
      if (!m.reply_message || !m.quoted?.message) {
        return debug(
          "❌ .vv error: no quoted message was detected. Reply directly to the View Once media, then send .vv."
        );
      }

      const quotedKeys = Object.keys(m.quoted.message || {});
      const cleanMessage = unwrapViewOnceMessage(m.quoted.message);
      if (!cleanMessage) {
        return debug(
          "❌ .vv error: the quoted message does not contain supported View Once media.\n" +
          "Detected message keys: " + (quotedKeys.join(", ") || "(none)") + "\n" +
          "Supported: image, video, audio, document."
        );
      }

      const target = (match?.[1] || "").trim();
      if (target) {
        if (target.includes("@")) {
          m.jid = target;
        } else {
          const digits = target.replace(/\D/g, "");
          if (digits.length < 7) {
            return debug("❌ .vv error: invalid destination. Provide a WhatsApp number or JID.");
          }
          m.jid = digits + "@s.whatsapp.net";
        }
      }

      const forwarded = {
        key: { ...m.quoted.key },
        message: cleanMessage,
      };

      try {
        await m.forwardMessage(m.jid, forwarded, {
          contextInfo: { isForwarded: false },
        });
      } catch (error) {
        console.error(".vv forwarding error:", error);
        const detail = String(error?.stack || error?.message || error).slice(0, 2500);
        await debug(
          "❌ .vv forwarding failed.\n" +
          "Error: " + String(error?.message || error) + "\n\n" +
          "Diagnostic details:\n" + detail
        );
        return;
      }
    } catch (error) {
      console.error(".vv handler error:", error);
      const detail = String(error?.stack || error?.message || error).slice(0, 2500);
      await debug(
        "❌ .vv handler crashed.\n" +
        "Error: " + String(error?.message || error) + "\n\n" +
        "Diagnostic details:\n" + detail
      );
    }
  }
);
Module(
  {
    pattern: "delete",
    fromMe: true,
    desc: "Deletes message for everyone. Supports admin deletion",
  },
  async (m, t) => {
    let adminAccesValidated = ADMIN_ACCESS ? await isAdmin(m, m.sender) : false;
    if (!m.reply_message) return;
    if (m.fromOwner || adminAccesValidated) {
      m.jid = m.quoted.key.remoteJid;
      if (m.quoted.key.fromMe)
        return await m.client.sendMessage(m.jid, { delete: m.quoted.key });
      if (!m.quoted.key.fromMe) {
        var admin = await isAdmin(m);
        if (!admin) return await m.sendReply("_I'm not an admin!_");
        return await m.client.sendMessage(m.jid, { delete: m.quoted.key });
      }
    }
  }
);
