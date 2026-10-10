/**
 * config.js - Global settings for TOPBOY EMPIRE
 *
 * 🆕 v6.2: ownerNumbers now accept PLAIN PHONE NUMBERS (no @lid or
 * @s.whatsapp.net suffix needed). The bot auto-resolves them to LIDs
 * at runtime via Baileys' lidMapping API.
 *
 * botLid is REMOVED — auto-detected on connect (index.js:258).
 */

module.exports = {
    // The symbol used before commands
    prefix: ".", 

    // Bot Identity (botLid auto-detected on connect — no need to set here)
    botName: "TOPBOY EMPIRE",
    ownerName: "Top Boy",

    // Authorized Owners — just plain phone numbers (country code + digits)
    // The bot will auto-resolve these to LIDs at runtime.
    ownerNumbers: [
        "2348077016582"
    ],

    // Global Cooldowns (in milliseconds)
    cooldowns: {
        beg: 120000,          // 2 minutes
        rob: 400000,          // 6 minutes 40 seconds
        work: 1200000,        // 20 minutes — 🛠 E2: was missing entirely, making .work an infinite money printer
        daily: 86400000,      // 24 hours (note: .daily currently uses lastDailyClaim instead of handleCooldown — see refactor Phase 2)

        // Game Cooldowns
        cf: 60000,            // 1 minute
        bet: 60000,           // 1 minute (DEAD ENTRY — no .bet command exists; removed in Phase 2)
        slots: 60000,         // 1 minute
        casino: 120000,       // 2 minutes
        roulette: 60000,      // 1 minute
        blackjack: 60000     // 1 minute — Phase 6
    },

    // DATABASE CONFIGURATION
    // Note: It's best practice to keep this in your .env file
    mongoURI: process.env.MONGO_URI || "mongodb+srv://your_connection_string_here"
};