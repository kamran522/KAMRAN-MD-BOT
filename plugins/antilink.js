"use strict";

const { Module } = require("../main");
const config = require("../config");
const { antilinkConfig, linkDetector, isAdmin, setWarn, getWarn } = require("./utils");

const DEFAULT_POLICY = {
  mode: "delete",
  enabled: true,
  isWhitelist: true,
  allowedLinks: "",
  blockedLinks: "",
};
const HELP = [
  "*Anti-link controls (group only)*",
  ".antilink on | off | status",
  ".antilink delete | warn | kick",
  ".antilink allow youtube.com,example.com (only these domains allowed)",
  ".antilink allow none (block every domain)",
  ".antilink block example.com,spam.net (only these domains blocked)",
].join("\n");

function parseDomains(raw) {
  if (String(raw).trim().toLowerCase() === "none") return "";
  const entries = String(raw).split(",").map((x) => x.trim().toLowerCase()).filter(Boolean);
  if (!entries.length || entries.length > 50) return null;
  const normalized = entries.map((item) => {
    const host = item.replace(/^https?:\/\//, "").replace(/^www\./, "").split(/[/?#]/)[0];
    if (!/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+$/.test(host)) return null;
    return host;
  });
  return normalized.some((x) => !x) ? null : [...new Set(normalized)].join(",");
}

function getHost(link) {
  const host = linkDetector.extractDomain(String(link).replace(/[).,!?:;]+$/, ""));
  return host.split(":")[0].toLowerCase();
}
function domainMatches(host, domain) {
  return host === domain || host.endsWith("." + domain);
}
function isBlocked(link, policy) {
  const host = getHost(link);
  if (!host) return false;
  const list = policy.isWhitelist ? policy.allowedLinks : policy.blockedLinks;
  const domains = String(list || "")
    .split(",")
    .map((x) => x.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/^www\./, "").split("/")[0])
    .filter(Boolean);
  const matching = domains.some((domain) => domainMatches(host, domain));
  return policy.isWhitelist ? !matching : matching;
}
function getText(raw) {
  let node = raw;
  for (let i = 0; i < 4 && node; i++) {
    if (node.ephemeralMessage?.message) node = node.ephemeralMessage.message;
    else if (node.viewOnceMessageV2?.message) node = node.viewOnceMessageV2.message;
    else if (node.documentWithCaptionMessage?.message) node = node.documentWithCaptionMessage.message;
    else break;
  }
  return [
    node?.conversation,
    node?.extendedTextMessage?.text,
    node?.imageMessage?.caption,
    node?.videoMessage?.caption,
    node?.documentMessage?.caption,
  ].filter((x) => typeof x === "string").join("\n");
}
function viewPolicy(row) {
  const obj = row?.get?.({ plain: true }) || row?.dataValues || row || {};
  return {
    mode: obj.mode || "delete",
    enabled: obj.enabled === true || obj.enabled === 1 || obj.enabled === "true",
    isWhitelist: obj.isWhitelist === true || obj.isWhitelist === 1 || obj.isWhitelist === "true",
    allowedLinks: obj.allowedLinks || "",
    blockedLinks: obj.blockedLinks || "",
    customMessage: obj.customMessage || "",
  };
}
async function setPolicy(jid, changes) {
  const previous = await antilinkConfig.get(jid);
  if (!previous) return antilinkConfig.set(jid, { ...DEFAULT_POLICY, ...changes });
  return antilinkConfig.update(jid, changes);
}

Module(
  {
    pattern: "antilink ?(.*)",
    fromMe: false,
    use: "group",
    desc: "Configure group link moderation (delete, warn, kick; allowlist or blocklist)",
    usage: ".antilink on | off | status | delete | warn | kick | allow domains | block domains",
  },
  async (m, match) => {
    if (!m.isGroup) return m.sendReply("_Anti-link is for groups only._");
    if (!(m.fromOwner || (config.ADMIN_ACCESS && await isAdmin(m, m.sender)))) return;
    const input = String(match?.[1] || "").trim().toLowerCase();
    const [action, ...rest] = input.split(/\s+/);
    const arg = rest.join(" ").trim();
    const record = await antilinkConfig.get(m.jid);
    const policy = viewPolicy(record);

    if (!action || action === "status") {
      return m.sendReply(
        HELP + "\n\n*Status:* " + (policy.enabled ? "ON" : "OFF") +
        "\n*Action:* " + policy.mode + "\n*Policy:* " + (policy.isWhitelist ? "allowlist" : "blocklist") +
        "\n*Domains:* " + (policy.isWhitelist ? policy.allowedLinks || "(none; all links blocked)" : policy.blockedLinks || "(none)")
      );
    }
    if (action === "off") {
      if (record) await antilinkConfig.update(m.jid, { enabled: false });
      return m.sendReply("_Anti-link disabled for this group._");
    }
    if (!await isAdmin(m)) {
      return m.sendReply("_Make the bot a group admin before enabling link moderation._");
    }
    if (action === "on") {
      await setPolicy(m.jid, { enabled: true });
      return m.sendReply("_Anti-link enabled. Use .antilink status to see the policy._");
    }
    if (["delete", "warn", "kick"].includes(action)) {
      await setPolicy(m.jid, { enabled: true, mode: action });
      return m.sendReply("_Anti-link enabled: " + action + " mode._");
    }
    if (action === "allow" || action === "block") {
      const domains = parseDomains(arg);
      if (domains === null) return m.sendReply("_Invalid domains. Separate domain names with commas, or use 'allow none'._");
      if (action === "block" && !domains) return m.sendReply("_Specify at least one blocked domain._");
      await setPolicy(m.jid, {
        enabled: true,
        isWhitelist: action === "allow",
        ...(action === "allow" ? { allowedLinks: domains } : { blockedLinks: domains }),
      });
      return m.sendReply("_Anti-link " + (action === "allow" ? "allowlist" : "blocklist") + " updated._");
    }
    return m.sendReply(HELP);
  }
);

Module({ on: "message", fromMe: false }, async (m) => {
  if (!m.isGroup || m.fromMe || m.fromOwner || m.data?.key?.fromMe || !m.sender) return;
  const body = getText(m.data?.message);
  if (!body) return;
  const links = linkDetector.detectLinks(body);
  if (!links.length) return;
  try {
    const row = await antilinkConfig.get(m.jid);
    if (!row) return;
    const policy = viewPolicy(row);
    if (!policy.enabled || !links.some((link) => isBlocked(link, policy))) return;
    if (await isAdmin(m, m.sender)) return;
    if (!await isAdmin(m)) return;
    await m.client.sendMessage(m.jid, { delete: m.data.key });
    if (policy.mode === "kick") {
      await m.client.groupParticipantsUpdate(m.jid, [m.sender], "remove");
    } else if (policy.mode === "warn") {
      const botId = m.client.user?.lid || m.client.user?.id || "bot@s.whatsapp.net";
      await setWarn(m.jid, m.sender, "Anti-link: prohibited link", botId);
      const limit = Math.max(1, Number.parseInt(config.WARN, 10) || 4);
      const info = await getWarn(m.jid, m.sender, limit);
      if (info?.exceeded) {
        await m.client.groupParticipantsUpdate(m.jid, [m.sender], "remove");
      } else {
        await m.client.sendMessage(m.jid, {
          text: "@" + m.sender.split("@")[0] + " link removed. Warning " + (info?.current || 1) + "/" + limit + ".",
          mentions: [m.sender],
        });
      }
    } else if (policy.customMessage) {
      await m.client.sendMessage(m.jid, { text: policy.customMessage });
    }
  } catch (error) {
    console.error("[antilink] moderation failed:", error?.message || error);
  }
});

module.exports = { parseDomains, isBlocked, getText };
