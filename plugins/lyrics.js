const { Module } = require("../main");
const config = require("../config");
const { lyrics } = require("./utils");

Module(
  {
    pattern: "lyrics ?(.*)",
    fromMe: config.isPrivate,
    desc: "Song lyrics (open lrclib.net database)",
    usage: ".lyrics song name",
    use: "search",
  },
  async (message, match) => {
    const q = match[1] || message.reply_message?.text;
    if (!q) return await message.sendReply("_Need a song name! Ex: .lyrics believer imagine dragons_");
    try {
      const r = await lyrics(q);
      return await message.sendReply(`*${r.title}* - _${r.artist}_\n\n${r.lyrics}`.slice(0, 6000));
    } catch (e) {
      return await message.sendReply(`_${e.message}_`);
    }
  }
);
