const Base = require("./base");

class GroupUpdate extends Base {
  constructor(client, data) {
    super(client);
    if (data) this._patch(data);
  }

  _patch(data) {
    this.jid = data.id;
    this.action = data.action;

    // Baileys can deliver participant IDs as either JID strings or objects.
    this.participant = (data.participants || []).map((part) =>
      typeof part === "string" ? { id: part } : part
    );

    this.from = data.author || null;

    return super._patch(data);
  }
}

module.exports = GroupUpdate;
