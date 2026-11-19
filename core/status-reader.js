"use strict";

/**
 * Status receipts use the posting member's JID as participant, not the
 * broadcast address. On linked devices WhatsApp may provide that member as
 * participant, participantAlt or remoteJidAlt, depending on addressing mode.
 */
async function readIncomingStatuses(upsert, client, config, logger = console) {
  if (config?.AUTO_READ_STATUS !== true &&
      String(config?.AUTO_READ_STATUS).toLowerCase() !== "true") return 0;
  if (!upsert || !Array.isArray(upsert.messages) || !client?.readMessages) return 0;

  let marked = 0;
  for (const item of upsert.messages) {
    const key = item?.key;
    if (!key || key.remoteJid !== "status@broadcast" || key.fromMe ||
        !key.id || !item.message) continue;
    const participant = key.participant || key.participantAlt || key.remoteJidAlt;
    if (!participant || participant === "status@broadcast") {
      logger.warn?.("[Status Read] Skipping status without a sender JID");
      continue;
    }
    try {
      await client.readMessages([{
        remoteJid: "status@broadcast",
        id: key.id,
        participant,
        fromMe: false,
      }]);
      marked++;
    } catch (error) {
      logger.warn?.("[Status Read] Could not mark incoming status as viewed", error);
    }
  }
  return marked;
}

module.exports = { readIncomingStatuses };
