'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { isGroupModeToggle, shouldIgnoreGroupMessage } = require('../core/group-mode');

function groupMessage(text, fromMe = false) {
  return {
    key: { remoteJid: '12345@g.us', fromMe },
    message: { conversation: text },
  };
}

test('group mode ON keeps existing group commands available', () => {
  assert.equal(shouldIgnoreGroupMessage(groupMessage('.ping'), { GROUP_MODE: true }), false);
});

test('group mode OFF ignores ordinary group messages from everyone, including owner', () => {
  const config = { GROUP_MODE: false, HANDLERS: '.,' };
  assert.equal(shouldIgnoreGroupMessage(groupMessage('.ping'), config), true);
  assert.equal(shouldIgnoreGroupMessage(groupMessage('.ping', true), config), true);
  assert.equal(shouldIgnoreGroupMessage(groupMessage('.mode group on', false), config), true);
});

test('group mode OFF can be re-enabled from inside the group by the owner', () => {
  const config = { GROUP_MODE: false, HANDLERS: '.,' };
  assert.equal(shouldIgnoreGroupMessage(groupMessage('.mode group on', true), config), false);
  assert.equal(shouldIgnoreGroupMessage(groupMessage(',mode group off', true), config), false);
  assert.equal(isGroupModeToggle(groupMessage('.mode group on', true), config), true);
  assert.equal(isGroupModeToggle(groupMessage('.mode gorup on', true), config), true);
  assert.equal(isGroupModeToggle(groupMessage('.mode group maybe', true), config), false);
});

test('custom prefixes and optional prefix respect the bot handler configuration', () => {
  const config = { GROUP_MODE: false, HANDLERS: '!', MULTI_HANDLERS: false };
  assert.equal(shouldIgnoreGroupMessage(groupMessage('!mode group on', true), config), false);
  assert.equal(shouldIgnoreGroupMessage(groupMessage('.mode group on', true), config), true);
  assert.equal(shouldIgnoreGroupMessage(groupMessage('mode group on', true), config), true);
  config.MULTI_HANDLERS = true;
  assert.equal(shouldIgnoreGroupMessage(groupMessage('mode group on', true), config), false);
});

test('private chats are unaffected even with group mode OFF', () => {
  const msg = groupMessage('.ping');
  msg.key.remoteJid = '123@s.whatsapp.net';
  assert.equal(shouldIgnoreGroupMessage(msg, { GROUP_MODE: false }), false);
});

test('owner may use caption and quoted text commands when group mode OFF', () => {
  const config = { GROUP_MODE: false, HANDLERS: '.,' };
  const msg = groupMessage('', true);
  msg.message = { extendedTextMessage: { text: '.mode group on' } };
  assert.equal(shouldIgnoreGroupMessage(msg, config), false);
  msg.message = { imageMessage: { caption: '.mode group on' } };
  assert.equal(shouldIgnoreGroupMessage(msg, config), false);
});

test('double-character handler prefixes require the correct prefix', () => {
  const config = { GROUP_MODE: false, HANDLERS: '!!' };
  assert.equal(shouldIgnoreGroupMessage(groupMessage('!!mode group on', true), config), false);
  assert.equal(shouldIgnoreGroupMessage(groupMessage('!mode group on', true), config), true);
});
