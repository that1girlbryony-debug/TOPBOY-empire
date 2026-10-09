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
        rob: 400000,          // 15 minutes (as set in new economy.js)
        daily: 86400000,      // 24 hours
        
        // Game Cooldowns
        cf: 60000,            // 1 minute
        bet: 60000,           // 1 minute
        slots: 60000,         // 1 minute
        casino: 120000,       // 2 minutes
        roulette: 60000       // 1 minute
    },

    // DATABASE CONFIGURATION
    // Note: It's best practice to keep this in your .env file
    mongoURI: process.env.MONGO_URI || "mongodb+srv://your_connection_string_here"
};