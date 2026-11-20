'use strict';
const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const { summarizeAuthDisconnect, shouldPersistPairingOnClose, classifyDisconnectSource } = require('../core/wa-auth-diagnostics');

test('redacts stream error details and retains status + conflict reason', () => {
  const error = {
    output: { statusCode: 401 },
    data: {
      tag: 'stream:error',
      attrs: { code: '401' },
      content: [{ tag: 'conflict', attrs: { type: 'device_removed', jid: 'private-number' } }]
    },
    message: 'Stream Errored (conflict): Secret QR payload: 0123456789'
  };
  const result = summarizeAuthDisconnect(error,
    { registered: true, pairSuccessObserved: true, hasMeId: true, previouslyOpen: false, previousStatus: 515 });
  assert.equal(result,
    '[WA Auth] disconnect status=401 source=stream_error conflict=device_removed registered=true pairSuccessObserved=true hasMeId=true previouslyOpen=false previousStatus=515');
  assert.doesNotMatch(result, /private-number|0123456789|stream:error/);
});

test('reports expected restart without leaking arbitrary errors', () => {
  const error = { output: { statusCode: 515 }, data: { content: [{ tag: 'unexpected', attrs: { phone: 'secret' } }] } };
  assert.equal(summarizeAuthDisconnect(error),
    '[WA Auth] disconnect status=515 source=unknown conflict=none registered=false pairSuccessObserved=false hasMeId=false previouslyOpen=false previousStatus=none');
});

test('ignores unsafe and malformed rejection fields', () => {
  const error = { output: { statusCode: 'oops' }, data: [{ tag: 'conflict', attrs: { type: 'private phone 123' } }] };
  const result = summarizeAuthDisconnect(error, { previousStatus: Infinity });
  assert.match(result, /status=unknown source=unknown conflict=none/);
  assert.match(result, /previousStatus=none/);
  assert.doesNotMatch(result, /private phone/);
});

test('classifies 401 source using exact known error kinds and never logs free-form errors', () => {
  assert.equal(classifyDisconnectSource({ message: 'Connection Failure' }), 'server_failure');
  assert.equal(classifyDisconnectSource({ message: 'Stream Errored (unknown)' }), 'stream_error');
  assert.equal(classifyDisconnectSource({ message: '401: Secret phone +12345' }), 'unknown');
  const out = summarizeAuthDisconnect({
    message: 'Connection Failure',
    output: { statusCode: 401 },
    data: { reason: '401', phone: '+123456789', secret: 'auth-credential' }
  }, { hasMeId: true });
  assert.match(out, /status=401 source=server_failure conflict=none/);
  assert.doesNotMatch(out, /123456789|auth-credential/);
});

test('515 always persists credentials; 516 requires observed pair-success and a user ID', () => {
  assert.equal(shouldPersistPairingOnClose(515), true);
  assert.equal(shouldPersistPairingOnClose(516), false);
  assert.equal(shouldPersistPairingOnClose(516, { pairSuccessObserved: true, hasMeId: false }), false);
  assert.equal(shouldPersistPairingOnClose(516, { pairSuccessObserved: false, hasMeId: true }), false);
  assert.equal(shouldPersistPairingOnClose(516, { pairSuccessObserved: true, hasMeId: true }), true);
  assert.equal(shouldPersistPairingOnClose(401, { pairSuccessObserved: true, hasMeId: true }), false);
  assert.equal(shouldPersistPairingOnClose(428, { pairSuccessObserved: true, hasMeId: true }), false);
});

test('516 diagnostics distinguish pairing acknowledgement from a QR-only close', () => {
  const unpaired = summarizeAuthDisconnect({ output: { statusCode: 516 } });
  assert.match(unpaired, /status=516/);
  assert.match(unpaired, /pairSuccessObserved=false hasMeId=false/);
  const paired = summarizeAuthDisconnect({ output: { statusCode: 516 } }, {
    registered: false, pairSuccessObserved: true, hasMeId: true, previousStatus: 401
  });
  assert.match(paired, /registered=false pairSuccessObserved=true hasMeId=true/);
});

test('socket flushes paired credentials before reconnecting on 515 or verified post-pair 516', () => {
  const code = fs.readFileSync(path.join(__dirname, '../core/bot.js'), 'utf8');
  const guard = "if(require('./wa-auth-diagnostics').shouldPersistPairingOnClose";
  const flush = 'await this.authState.saveSession()';
  const logout = "if(_0x3021b6===DisconnectReason['loggedOut'])";
  assert.ok(code.indexOf(guard) >= 0);
  assert.ok(code.indexOf(guard) < code.indexOf(flush));
  assert.ok(code.indexOf(flush) < code.indexOf(logout));
  assert.match(code, /summarizeAuthDisconnect/);
  assert.match(code, /if\(_0xwaNewLogin===true\)/);
  assert.match(code, /_waSawPairSuccess=false/);
  assert.match(code, /socket init waVersion=/);
  assert.match(code, /businessMode=/);
});
