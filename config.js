/**
 * config.js - Global settings for TOPBOY EMPIRE
 */

module.exports = {
    // The symbol used before commands
    prefix: ".", 

    // Bot Identity
    botName: "TOPBOY EMPIRE",
    botLid: "222140758532267@lid",
    ownerName: "Top Boy",

    // Authorized Owners (The list admin.js looks for)
    ownerNumbers: [
        "65215555178563@lid",
        "2349030784122@s.whatsapp.net"
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