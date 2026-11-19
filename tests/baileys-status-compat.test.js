"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { test } = require("node:test");
const { patchBaileysStatusStanzas, MARKER } = require("../scripts/patch-baileys-status");
const { readIncomingStatuses } = require("../core/status-reader");

function mockBaileysModule() {
  // Match the relevant compiled v7.0.0-rc14 function boundaries.
  return String.raw`
const callbacks = {};
const decoded = [];
const acked = [];
const ws = { on(event, callback) { callbacks[event] = callback; } };
const decryptMessageNode = (node) => node;
const sendMessageAck = async (node) => { acked.push({ tag: node.tag, from: node.attrs.from }); };
const processNode = async (type, node, description, callback) => await callback(node);
const onUnexpectedError = (error) => { throw error; };
const handleMessage = async (node) => {
  const content = decryptMessageNode(node, 'me@lid');
  decoded.push({
    from: content.attrs.from,
    participant: content.attrs.participant,
    tag: content.tag,
  });
};
ws.on('CB:message', async (node) => {
  await processNode('message', node, 'processing message', handleMessage);
});
module.exports = { callbacks, decoded, acked };
`;
}

function withModule(content, callback) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "kamran-status-compat-test-"));
  const filename = path.join(dir, "messages-recv.js");
  fs.writeFileSync(filename, content);
  return Promise.resolve().then(() => callback(filename)).finally(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });
}

test("new status stanza is decrypted as status@broadcast and original status node is acknowledged", async () => {
  await withModule(mockBaileysModule(), async (filename) => {
    const applied = patchBaileysStatusStanzas({ filename });
    assert.equal(applied.status, "patched");
    const compiled = fs.readFileSync(filename, "utf8");
    assert.ok(compiled.includes(MARKER));
    assert.equal(fs.existsSync(filename + ".kamran-status-original"), true);
    const patched = require(filename);
    const stanza = {
      tag: "status",
      attrs: { id: "story-1", from: "poster@lid", t: "100" },
      content: [{ tag: "enc", attrs: { type: "msg" }, content: Buffer.from("x") }],
    };
    await patched.callbacks["CB:status"](stanza);
    assert.deepEqual(patched.decoded, [
      { from: "status@broadcast", participant: "poster@lid", tag: "status" },
    ]);
    assert.deepEqual(patched.acked, [{ tag: "status", from: "poster@lid" }]);
    assert.equal(stanza.attrs.from, "poster@lid", "the incoming stanza must not be mutated");
    const toRead = [];
    await readIncomingStatuses({
      type: "notify", messages: [{
        key: { remoteJid: patched.decoded[0].from, participant: patched.decoded[0].participant, id: "story-1" },
        message: { imageMessage: {} },
      }],
    }, { async readMessages(keys) { toRead.push(...keys); } }, { AUTO_READ_STATUS: true });
    assert.equal(toRead[0].participant, "poster@lid");
  });
});

test("status patch is idempotent, and ordinary messages are unchanged", async () => {
  await withModule(mockBaileysModule(), async (filename) => {
    assert.equal(patchBaileysStatusStanzas({ filename }).status, "patched");
    const first = fs.readFileSync(filename, "utf8");
    assert.equal(patchBaileysStatusStanzas({ filename }).status, "already-patched");
    assert.equal(fs.readFileSync(filename, "utf8"), first);
    const patched = require(filename);
    await patched.callbacks["CB:message"]({
      tag: "message", attrs: { id: "normal", from: "friend@lid" },
    });
    assert.deepEqual(patched.decoded, [
      { from: "friend@lid", participant: undefined, tag: "message" },
    ]);
  });
});

test("unencrypted status gets an ack but is not misreported as viewed", async () => {
  await withModule(mockBaileysModule(), async (filename) => {
    patchBaileysStatusStanzas({ filename });
    const patched = require(filename);
    await patched.callbacks["CB:status"]({ tag: "status", attrs: { id: "s2", from: "poster@s.whatsapp.net" }, content: [] });
    assert.equal(patched.decoded.length, 0);
    assert.deepEqual(patched.acked, [{ tag: "status", from: "poster@s.whatsapp.net" }]);
  });
});

test("unsupported and already fixed Baileys files are not overwritten", async () => {
  await withModule("const other = true;", async (filename) => {
    assert.equal(patchBaileysStatusStanzas({ filename }).status, "unsupported");
    assert.equal(fs.readFileSync(filename, "utf8"), "const other = true;");
    assert.equal(fs.existsSync(filename + ".kamran-status-original"), false);
  });
  await withModule("ws.on('CB:status', () => {});", async (filename) => {
    assert.equal(patchBaileysStatusStanzas({ filename }).status, "upstream-supported");
    assert.equal(fs.existsSync(filename + ".kamran-status-original"), false);
  });
});
