"use strict";

// Compatibility bridge for baileys 7.0.0-rc14, which does not register CB:status.
// Without it, some contacts' stories never reach messages.upsert and cannot be read.
// Make a narrow, validated patch before the dependency is loaded, and preserve the
// original top-level status node for its class=status acknowledgement.
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const MARKER = "KAMRAN_BAILEYS_STATUS_V1";

function patchBaileysStatusStanzas(options = {}) {
  const filename = options.filename || path.resolve(
    __dirname, "../node_modules/baileys/lib/Socket/messages-recv.js"
  );
  if (!fs.existsSync(filename)) {
    return { status: "missing", message: "Baileys receive module not installed: " + filename };
  }

  const original = fs.readFileSync(filename, "utf8");
  if (original.includes(MARKER)) return { status: "already-patched" };

  // Do not modify a future Baileys release which already supports status events.
  if (/ws\.on\(\s*['"]CB:status['"]/.test(original)) {
    return { status: "upstream-supported" };
  }

  const handler = /const handleMessage\s*=\s*async\s*\(\s*node\s*\)\s*=>\s*\{/;
  const decrypt = /\bdecryptMessageNode\(\s*node\s*,/g;
  const callback = /ws\.on\(\s*['"]CB:message['"]\s*,\s*async\s*\(\s*node\s*\)\s*=>\s*\{/;
  if (!handler.test(original) || [...original.matchAll(decrypt)].length !== 1 ||
      !callback.test(original)) {
    return {
      status: "unsupported",
      message: "The Baileys receive-handler structure differs from the supported version.",
    };
  }

  // When a story stanza is from an individual, Baileys would normally
  // interpret its from JID as a chat. Normalize the decryption *copy* to
  // status@broadcast and retain the original node for class=status ACKs.
  const translation = [
    "/* " + MARKER + " */",
    "const kamranStatusDecodeNode = (node) => {",
    "  if (!node || node.tag !== 'status' || !node.attrs) return node;",
    "  const sender = node.attrs.from || '';",
    "  if (!/@(?:s\\.whatsapp\\.net|lid)$/.test(sender) || sender === 'status@broadcast') return node;",
    "  if (node.attrs.recipient) return node;",
    "  return { ...node, attrs: { ...node.attrs, from: 'status@broadcast', participant: node.attrs.participant || sender } };",
    "};",
    "",
  ].join("\n");

  let updated = original.replace(handler, translation + "$&");
  updated = updated.replace(decrypt, "decryptMessageNode(kamranStatusDecodeNode(node),");

  const statusCallback = [
    "ws.on('CB:status', async (node) => {",
    "  try {",
    "    const attrs = node?.attrs || {};",
    "    const sender = String(attrs.from || '');",
    "    const content = Array.isArray(node?.content) ? node.content : [];",
    "    const encrypted = content.some(child => child && (child.tag === 'enc' || child.tag === 'plaintext'));",
    "    const isStory = sender === 'status@broadcast' || /@(?:s\\.whatsapp\\.net|lid)$/.test(sender);",
    "    if (attrs.id && encrypted && isStory) {",
    "      // Use the existing Baileys decryption and offline-message queue.",
    "      await processNode('message', node, 'processing incoming status', handleMessage);",
    "    }",
    "    // The original status stanza needs a class=status acknowledgement.",
    "    await sendMessageAck(node);",
    "  } catch (error) {",
    "    onUnexpectedError(error, 'processing incoming status stanza');",
    "  }",
    "});",
    "",
  ].join("\n");
  updated = updated.replace(callback, statusCallback + "$&");

  if (updated === original || !updated.includes(MARKER)) {
    return { status: "unsupported", message: "Status patch did not match safely." };
  }

  const temporary = filename + ".kamran-status.tmp.js";
  try {
    fs.writeFileSync(temporary, updated, { mode: fs.statSync(filename).mode });
    if (options.validateSyntax !== false) {
      const result = spawnSync(process.execPath, ["--check", temporary], {
        encoding: "utf8", timeout: 15000,
      });
      if (result.status !== 0) {
        return {
          status: "unsupported",
          message: "Patched Baileys syntax check failed: " +
            (result.stderr || result.error?.message || "unknown"),
        };
      }
    }
    const backup = filename + ".kamran-status-original";
    if (!fs.existsSync(backup)) fs.copyFileSync(filename, backup);
    fs.renameSync(temporary, filename);
    return { status: "patched" };
  } finally {
    try { if (fs.existsSync(temporary)) fs.unlinkSync(temporary); } catch (_) {}
  }
}

module.exports = { patchBaileysStatusStanzas, MARKER };
