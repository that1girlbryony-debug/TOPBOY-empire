/**
 * 🛠 src/config/index.js — Phase 2
 * Main config — bot identity, prefix, owners.
 *
 * Split out from the old monolithic config.js so cooldowns and constants
 * can live in their own files (config/cooldowns.js, config/constants.js).
 */

module.exports = {
  // The symbol used before commands
  prefix: ".",

  // Bot Identity
  botName: "TOPBOY EMPIRE",
  botLid: "222140758532267@lid",
  ownerName: "Top Boy",

  // Authorized Owners (looked up via lib/auth.js isOwnerJid)
  ownerNumbers: [
    "65215555178563@lid",
    "2349030784122@s.whatsapp.net"
  ],

  // Official group link (shown when bot refuses unauthorized groups).
  // Set via env var BOT_GROUP_LINK so we don't commit a real link.
  officialGroupLink: process.env.BOT_GROUP_LINK || "",

  // Database
  mongoURI: process.env.MONGO_URI || "mongodb+srv://your_connection_string_here",

  // Express server port (for keepalive / health check)
  port: process.env.PORT || 3000,
};
