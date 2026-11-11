const config = require("../config");
const cron = require("node-cron");

const {
  automute,
  autounmute,
  scheduledMessages,
} = require("../plugins/utils/db/schedulers");
const localPackageJson = require("../package.json");

const PRESENCE_INTERVAL = 10000;
const UPDATE_INTERVAL = 120000;

// db-wide cron jobs (automute, scheduled messages) run on one owner session only,
// otherwise multi-session setups would send everything n times
const activeTasks = new Map();
let ownerSessionId = null;

// sessionId -> { client, presenceTimer }
const sessions = new Map();



function destroyTasks() {
  activeTasks.forEach((task) => {
    try {
      task.destroy();
    } catch (_) {}
  });
  activeTasks.clear();
}

async function notifyOwners(text) {
  const sent = new Set();
  for (const { client } of sessions.values()) {
    const me = client.user?.id?.split(":")[0];
    const owner = (config.SUDO || "").split(",")[0].trim() || me;
    if (!owner || sent.has(owner)) continue;
    sent.add(owner);
    try {
      await client.sendMessage(owner + "@s.whatsapp.net", { text });
    } catch (_) {}
  }
}

async function buildTasks(client) {
const setupMuteSchedules = async () => {
  const autoMutes = await automute.get();
  const muteTaskPromises = [];

  if (!autoMutes || autoMutes.length === 0) {
    return;
  }

  for (const record of autoMutes) {
    const [hours, mins] = record.dataValues.time.split(" ");
    const jid = record.dataValues.chat;
    const taskName = `automute-${jid}`;

    muteTaskPromises.push(
      new Promise((resolve) => {
        const task = cron.schedule(
          `${mins} ${hours} * * *`,
          async () => {
            try {
              await client.groupSettingUpdate(jid, "announcement");
              await client.sendMessage(jid, { text: config.AUTOMUTE_MSG });
            } catch (error) {
              console.error(`Error in automute task for ${jid}:`, error);
            }
          },
          {
            scheduled: false,
          }
        );

        activeTasks.set(taskName, task);

        // Use setImmediate to defer the start to next event loop tick
        setImmediate(() => {
          task.start();
          resolve();
        });
      })
    );
  }

  const autoUnMutes = await autounmute.get();

  if (!autoUnMutes || autoUnMutes.length === 0) {
    await Promise.all(muteTaskPromises);
    return;
  }

  for (const record of autoUnMutes) {
    const [hours, mins] = record.dataValues.time.split(" ");
    const jid = record.dataValues.chat;
    const taskName = `autounmute-${jid}`;

    muteTaskPromises.push(
      new Promise((resolve) => {
        const task = cron.schedule(
          `${mins} ${hours} * * *`,
          async () => {
            try {
              await client.groupSettingUpdate(jid, "not_announcement");
              await client.sendMessage(jid, { text: config.AUTOUNMUTE_MSG });
            } catch (error) {
              console.error(`Error in autounmute task for ${jid}:`, error);
            }
          },
          {
            scheduled: false,
          }
        );

        activeTasks.set(taskName, task);

        // Use setImmediate to defer the start to next event loop tick
        setImmediate(() => {
          task.start();
          resolve();
        });
      })
    );
  }

  // Wait for all mute tasks to be set up (but not necessarily started)
  await Promise.all(muteTaskPromises);
};

const setupScheduledMessages = async () => {
  const pendingMessages = await scheduledMessages.getAllPending();

  if (!pendingMessages || pendingMessages.length === 0) {
    return;
  }

  const taskName = "scheduled-messages";

  return new Promise((resolve) => {
    const task = cron.schedule(
      "* * * * *",
      async () => {
        try {
          const messagesToSend = await scheduledMessages.getDueForSending();
          for (const msg of messagesToSend) {
            try {
              const jid = msg.dataValues.jid;
              let messageData;

              try {
                messageData = JSON.parse(msg.dataValues.message);
                if (messageData._mediaType) {
                  const mediaType = messageData._mediaType;
                  const base64Data = messageData[mediaType];

                  if (base64Data) {
                    const buffer = Buffer.from(base64Data, "base64");
                    messageData[mediaType] = buffer;
                    delete messageData._mediaType;
                  }
                }
              } catch (parseError) {
                messageData = { text: msg.dataValues.message };
              }

              await client.sendMessage(jid, messageData);
              await scheduledMessages.markAsSent(msg.dataValues.id);
              console.log(`✅ Sent scheduled message to ${jid}`);
            } catch (error) {
              console.error(
                `❌ Failed to send scheduled message to ${msg.dataValues.jid}:`,
                error
              );
            }
          }
        } catch (error) {
          console.error("Error in scheduled messages task:", error);
        }
      },
      {
        scheduled: false,
      }
    );

    activeTasks.set(taskName, task);

    // Use setImmediate to defer the start to next event loop tick
    setImmediate(() => {
      task.start();
      resolve();
    });
  });
};

  await Promise.all([setupMuteSchedules(), setupScheduledMessages()]);
}

async function sendOfflinePresence(sessionId) {
  if (config.ALWAYS_ONLINE) return;
  const entry = sessions.get(sessionId);
  if (!entry) return;
  try {
    await entry.client.sendPresenceUpdate("unavailable");
  } catch (_) {}
}

const Schedule = async (client, sessionId = client?.user?.id || "default") => {
  const existing = sessions.get(sessionId);
  if (existing?.presenceTimer) clearInterval(existing.presenceTimer);

  const presenceTimer = setInterval(
    () => sendOfflinePresence(sessionId),
    PRESENCE_INTERVAL,
  );
  presenceTimer.unref?.();
  sessions.set(sessionId, { client, presenceTimer });

  if (!ownerSessionId || !sessions.has(ownerSessionId)) {
    ownerSessionId = sessionId;
  }
  // rebuild cron jobs when the owner (re)connects so they bind to the live socket
  // and pick up rows added since the last connect
  if (ownerSessionId === sessionId) {
    destroyTasks();
    await buildTasks(client);
  }

};

// with a sessionId: drop only that session's timers. without: tear everything down.
Schedule.cleanup = async (sessionId) => {
  if (sessionId !== undefined) {
    const entry = sessions.get(sessionId);
    if (entry?.presenceTimer) clearInterval(entry.presenceTimer);
    sessions.delete(sessionId);
    if (ownerSessionId === sessionId) {
      destroyTasks();
      ownerSessionId = null;
    }
    return;
  }
  for (const entry of sessions.values()) {
    if (entry.presenceTimer) clearInterval(entry.presenceTimer);
  }
  sessions.clear();
  destroyTasks();
  ownerSessionId = null;
};

module.exports = Schedule;
