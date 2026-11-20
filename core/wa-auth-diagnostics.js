'use strict';

// Expose only protocol status and a known rejection category. Never print
// raw Baileys errors, BinaryNodes, QR data, JIDs, or session credentials.
function safeToken(value) {
  if (typeof value !== 'string' || !/^[a-z][a-z0-9_-]{0,47}$/i.test(value)) {
    return null;
  }
  return value;
}

function findConflictType(node, depth = 0) {
  if (!node || typeof node !== 'object' || depth > 4) return null;
  if (node.tag === 'conflict') {
    return safeToken(node.attrs?.type);
  }
  if (Array.isArray(node)) {
    for (const child of node) {
      const found = findConflictType(child, depth + 1);
      if (found) return found;
    }
  } else if (Array.isArray(node.content)) {
    return findConflictType(node.content, depth + 1);
  }
  return null;
}

// 516 is not part of Baileys rc14's DisconnectReason enum. It can occur
// after a real pair-success (see WhiskeySockets/Baileys#701), but must
// never be treated as proof of pairing on its own.
function shouldPersistPairingOnClose(statusCode, { pairSuccessObserved, hasMeId } = {}) {
  return Number(statusCode) === 515 ||
    (Number(statusCode) === 516 && pairSuccessObserved === true && hasMeId === true);
}

function summarizeAuthDisconnect(error, {
  registered, previouslyOpen, previousStatus, pairSuccessObserved, hasMeId
} = {}) {
  const status = Number(error?.output?.statusCode);
  const code = Number.isSafeInteger(status) && status >= 100 && status <= 599 ? status : 'unknown';
  const previous = Number(previousStatus);
  const previousCode = Number.isSafeInteger(previous) && previous >= 100 && previous <= 599
    ? previous : 'none';
  const conflict = findConflictType(error?.data);
  return '[WA Auth] disconnect status=' + code +
    ' conflict=' + (conflict || 'none') +
    ' registered=' + Boolean(registered) +
    ' pairSuccessObserved=' + Boolean(pairSuccessObserved) +
    ' hasMeId=' + Boolean(hasMeId) +
    ' previouslyOpen=' + Boolean(previouslyOpen) +
    ' previousStatus=' + previousCode;
}

module.exports = { summarizeAuthDisconnect, findConflictType, shouldPersistPairingOnClose };
