/**
 * 🛠 src/config/index.js — Phase 2 + v6.2 LID normalization
 * Main config — bot identity, prefix, owners.
 *
 * 🆕 v6.2: ownerNumbers now accept PLAIN PHONE NUMBERS. The bot
 * auto-resolves them to LIDs at runtime via Baileys' lidMapping API.
 * botLid is REMOVED — auto-detected on connect.
 *
 * This file re-exports from the root config.js so there's ONE source
 * of truth for owner numbers. The root config.js is what users edit.
 */

const rootConfig = require("../../config");

module.exports = {
  // The symbol used before commands
  prefix: rootConfig.prefix,

  // Bot Identity (botLid auto-detected on connect — not set here)
  botName: rootConfig.botName,
  ownerName: rootConfig.ownerName,

  // Authorized Owners — plain phone numbers from root config.js
  // lib/auth.js resolves these to LIDs at runtime
  ownerNumbers: rootConfig.ownerNumbers,

  // Official group link (shown when bot refuses unauthorized groups).
  officialGroupLink: process.env.BOT_GROUP_LINK || "",

  // Database
  mongoURI: process.env.MONGO_URI || rootConfig.mongoURI,

  // Express server port (for keepalive / health check)
  port: process.env.PORT || 3000,

  // Cooldowns (re-exported from root config)
  cooldowns: rootConfig.cooldowns,
};
