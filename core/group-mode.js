'use strict';

// Only the owner can run the group-mode toggle while group processing is off.
function escapeRegex(value) {
  return value.replace(/[\\^$.*+?()[\]{}|]/g, '\\$&');
}

function isGroupModeToggle(message, config) {
  if (message?.key?.fromMe !== true) return false;

  const content = message?.message || {};
  const text = [
    content.conversation,
    content.extendedTextMessage?.text,
    content.imageMessage?.caption,
    content.videoMessage?.caption,
  ].find(value => typeof value === 'string');
  if (!text) return false;

  // Follow the same prefix rules as main.js (including MULTI_HANDLERS).
  const handlers = String(config.HANDLERS ?? '.,');
  let prefix = '^';
  if (handlers && handlers !== '^') {
    if (handlers.length > 1 && handlers[0] === handlers[1]) {
      prefix += escapeRegex(handlers) + (config.MULTI_HANDLERS ? '?' : '');
    } else {
      prefix += '(?:' + Array.from(handlers).map(escapeRegex).join('|') + ')' +
        (config.MULTI_HANDLERS ? '?' : '');
    }
  }

  return new RegExp(prefix + 'mode\\s+group\\s+(?:on|off)\\s*$', 'i').test(text.trim());
}

function shouldIgnoreGroupMessage(message, config) {
  if (!message?.key?.remoteJid?.endsWith('@g.us')) return false;
  if (config.GROUP_MODE !== false) return false;
  return !isGroupModeToggle(message, config);
}

module.exports = { isGroupModeToggle, shouldIgnoreGroupMessage };
