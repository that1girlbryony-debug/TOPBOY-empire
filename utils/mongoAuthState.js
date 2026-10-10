/**
 * 🔐 MongoDB Auth State for Baileys
 *
 * Replaces useMultiFileAuthState (filesystem) with MongoDB storage.
 * This is REQUIRED for hosting platforms with ephemeral filesystems
 * like Render.com free tier — where the filesystem is wiped on
 * every deploy/restart.
 *
 * Stores all Baileys auth credentials (creds + signal keys) in a
 * MongoDB collection called "baileys_auth". Each document is
 * keyed by a session ID + filename, so multiple bots can share
 * the same database.
 *
 * Usage (replaces useMultiFileAuthState):
 *   const { state, saveCreds } = await useMongoAuthState(mongoose, "session_1");
 *   const sock = makeWASocket({ auth: { creds: state.creds, keys: state.keys } });
 */

const { proto } = require("@whiskeysockets/baileys");
const { BufferJSON } = require("@whiskeysockets/baileys/lib/Utils/generics.js");

// Fix filename the same way Baileys does internally
function fixFileName(file) {
  return file?.replace(/\//g, "__")?.replace(/:/g, "-");
}

/**
 * Create a MongoDB-backed auth state.
 *
 * @param {Object} mongoose — Mongoose instance (connected)
 * @param {string} sessionId — unique session identifier (default "default")
 * @returns {Promise<{ state: Object, saveCreds: Function }>}
 */
async function useMongoAuthState(mongoose, sessionId = "default") {
  // Use a simple collection (raw driver — no schema needed for binary auth data)
  const collection = mongoose.connection.collection("baileys_auth");

  // Ensure the session ID is safe for use as a MongoDB field
  const safeSessionId = sessionId.replace(/[^a-zA-Z0-9_-]/g, "");

  const writeData = async (data, file) => {
    const key = `${safeSessionId}:${fixFileName(file)}`;
    const serialized = JSON.stringify(data, BufferJSON.replacer);
    await collection.updateOne(
      { _id: key },
      { $set: { data: serialized, updatedAt: new Date() } },
      { upsert: true }
    );
  };

  const readData = async (file) => {
    const key = `${safeSessionId}:${fixFileName(file)}`;
    const doc = await collection.findOne({ _id: key });
    if (!doc) return null;
    try {
      return JSON.parse(doc.data, BufferJSON.reviver);
    } catch {
      return null;
    }
  };

  const removeData = async (file) => {
    const key = `${safeSessionId}:${fixFileName(file)}`;
    await collection.deleteOne({ _id: key });
  };

  // Initialize creds (same as Baileys' initAuthCreds)
  const { initAuthCreds } = require("@whiskeysockets/baileys/lib/Utils/auth-utils.js");
  const creds = (await readData("creds.json")) || initAuthCreds();

  return {
    state: {
      creds,
      keys: {
        get: async (type, ids) => {
          const data = {};
          await Promise.all(ids.map(async (id) => {
            let value = await readData(`${type}-${id}.json`);
            if (type === "app-state-sync-key" && value) {
              value = proto.Message.AppStateSyncKeyData.fromObject(value);
            }
            data[id] = value;
          }));
          return data;
        },
        set: async (data) => {
          const tasks = [];
          for (const category in data) {
            for (const id in data[category]) {
              const value = data[category][id];
              const file = `${category}-${id}.json`;
              tasks.push(value ? writeData(value, file) : removeData(file));
            }
          }
          await Promise.all(tasks);
        }
      }
    },
    saveCreds: async () => {
      return writeData(creds, "creds.json");
    }
  };
}

module.exports = { useMongoAuthState };
