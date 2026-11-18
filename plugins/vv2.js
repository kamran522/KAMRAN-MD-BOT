const { Module } = require('../main');
const { loadBaileys } = require('../core/helpers');

const MAX_MEDIA_BYTES = 50 * 1024 * 1024;
const MISSING_MEDIA_MESSAGE =
  'WhatsApp did not provide a downloadable file for this view-once message. ' +
  'Linked devices may receive only a placeholder. Ask the sender to resend it as regular media.';
const MEDIA_TYPES = {
  imageMessage: 'image',
  videoMessage: 'video',
  audioMessage: 'audio',
};

function extractViewOnce(input) {
  let current = input;
  let wrapped = false;
  for (let i = 0; current && i < 8; i++) {
    if (current.ephemeralMessage?.message) {
      current = current.ephemeralMessage.message;
      continue;
    }
    if (current.documentWithCaptionMessage?.message) {
      current = current.documentWithCaptionMessage.message;
      continue;
    }
    const key = ['viewOnceMessageV2Extension', 'viewOnceMessageV2', 'viewOnceMessage']
      .find((name) => current[name]?.message);
    if (key) {
      wrapped = true;
      current = current[key].message;
      continue;
    }
    break;
  }
  if (!current) return null;
  const type = Object.keys(MEDIA_TYPES).find((name) => current[name]);
  if (!type || (!wrapped && !current[type].viewOnce)) return null;
  return { type, media: current[type] };
}

function directJid(m) {
  const raw = m.data?.key?.fromMe
    ? m.client.user?.id || m.client.user?.lid
    : m.data?.key?.participantAlt || m.data?.key?.participant ||
      m.data?.key?.remoteJidAlt || m.sender || m.jid;
  if (!raw || raw.endsWith('@g.us') || raw.endsWith('@broadcast')) return null;
  return raw.replace(/:\d+@/, '@');
}

Module(
  {
    pattern: 'vv ?(.*)',
    fromMe: true,
    desc: 'Download accessible replied view-once media and send it to your DM',
    usage: '.vv (reply to a view-once photo, video or audio)',
    use: 'utility',
  },
  async (m) => {
    const fail = (message) => m.sendReply(message);
    const quoted = m.data?.message?.extendedTextMessage?.contextInfo?.quotedMessage ||
      m.data?.message?.imageMessage?.contextInfo?.quotedMessage ||
      m.data?.message?.videoMessage?.contextInfo?.quotedMessage ||
      m.quoted?.message;
    if (!quoted) return fail('Reply directly to a view-once photo, video or audio.');

    const item = extractViewOnce(quoted);
    if (!item) {
      return fail('The quoted reply does not contain accessible view-once media. WhatsApp may have sent only a placeholder.');
    }
    // A quoted view-once message may contain metadata without any downloadable file.
    // Do not attempt a media download unless WhatsApp supplied an actual location.
    if (!item.media?.url && !item.media?.directPath) {
      return fail(MISSING_MEDIA_MESSAGE);
    }

    const dest = directJid(m);
    if (!dest) return fail('Could not determine the sender DM destination.');

    try {
      const baileys = await loadBaileys();
      if (typeof baileys.downloadContentFromMessage !== 'function') {
        throw new Error('downloadContentFromMessage is not available in this Baileys build');
      }
      const stream = await baileys.downloadContentFromMessage(item.media, MEDIA_TYPES[item.type]);
      const chunks = [];
      let size = 0;
      for await (const chunk of stream) {
        size += chunk.length;
        if (size > MAX_MEDIA_BYTES) throw new Error('Media exceeds the 50 MB safety limit');
        chunks.push(chunk);
      }
      if (!size) throw new Error('Media download returned no data');
      const buffer = Buffer.concat(chunks, size);
      const caption = item.media.caption || '';
      const payload = item.type === 'imageMessage'
        ? { image: buffer, caption, mimetype: item.media.mimetype || 'image/jpeg' }
        : item.type === 'videoMessage'
          ? { video: buffer, caption, mimetype: item.media.mimetype || 'video/mp4' }
          : { audio: buffer, ptt: Boolean(item.media.ptt), mimetype: item.media.mimetype || 'audio/ogg; codecs=opus' };
      await m.client.sendMessage(dest, payload);
      if (dest !== m.jid) await fail('Media sent to your DM. Delivery to the device is not yet confirmed.');
    } catch (error) {
      console.error('[vv2] media download/send failed:', error?.message || error);
      if (/No valid media URL or directPath/i.test(error?.message || '')) {
        return fail(MISSING_MEDIA_MESSAGE);
      }
      return fail('Could not download or send this view-once media: ' + (error?.message || 'Unknown error'));
    }
  }
);
