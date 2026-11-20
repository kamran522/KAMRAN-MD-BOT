'use strict';
const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const { summarizeAuthDisconnect } = require('../core/wa-auth-diagnostics');

test('redacts stream error details and retains status + conflict reason', () => {
  const error = {
    output: { statusCode: 401 },
    data: {
      tag: 'stream:error',
      attrs: { code: '401' },
      content: [{ tag: 'conflict', attrs: { type: 'device_removed', jid: 'private-number' } }]
    },
    message: 'Secret QR payload: 0123456789'
  };
  const result = summarizeAuthDisconnect(error,
    { registered: true, previouslyOpen: false, previousStatus: 515 });
  assert.equal(result,
    '[WA Auth] disconnect status=401 conflict=device_removed registered=true previouslyOpen=false previousStatus=515');
  assert.doesNotMatch(result, /private-number|0123456789|stream:error/);
});

test('reports expected restart without leaking arbitrary errors', () => {
  const error = { output: { statusCode: 515 }, data: { content: [{ tag: 'unexpected', attrs: { phone: 'secret' } }] } };
  assert.equal(summarizeAuthDisconnect(error),
    '[WA Auth] disconnect status=515 conflict=none registered=false previouslyOpen=false previousStatus=none');
});

test('ignores unsafe and malformed rejection fields', () => {
  const error = { output: { statusCode: 'oops' }, data: [{ tag: 'conflict', attrs: { type: 'private phone 123' } }] };
  const result = summarizeAuthDisconnect(error, { previousStatus: Infinity });
  assert.match(result, /status=unknown conflict=none/);
  assert.match(result, /previousStatus=none/);
  assert.doesNotMatch(result, /private phone/);
});

test('socket flushes credentials before reconnecting on 515', () => {
  const code = fs.readFileSync(path.join(__dirname, '../core/bot.js'), 'utf8');
  const guard = "if(_0x3021b6===DisconnectReason['restartRequired'])";
  const flush = 'await this.authState.saveSession()';
  const logout = "if(_0x3021b6===DisconnectReason['loggedOut'])";
  assert.ok(code.indexOf(guard) >= 0);
  assert.ok(code.indexOf(guard) < code.indexOf(flush));
  assert.ok(code.indexOf(flush) < code.indexOf(logout));
  assert.match(code, /summarizeAuthDisconnect/);
});
