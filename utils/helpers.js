/**
 * 🛠 TOPBOY EMPIRE HELPERS
 * Optimized for 512MB RAM
 */

const randomInt = (min, max) => Math.floor(Math.random() * (max - min + 1)) + min;

const chance = (probability) => Math.random() < probability;

// Standard Money Format (1,000,000)
const formatMoney = (val = 0) => {
    return Math.floor(val).toLocaleString('en-US');
};

// Short Money Format (1.5M)
const formatShort = (val = 0) => {
    if (val >= 1e9) return (val / 1e9).toFixed(1) + "B";
    if (val >= 1e6) return (val / 1e6).toFixed(1) + "M";
    if (val >= 1e3) return (val / 1e3).toFixed(1) + "K";
    return val.toString();
};

// Handle both @s.whatsapp.net and @lid formats
const cleanId = (id) => {
    if (!id) return "Citizen";
    // Strip everything after @ (handles @lid, @s.whatsapp.net, @g.us)
    const base = id.split("@")[0];
    // Also strip any device suffix like :123
    return base.split(":")[0];
};

// Normalize any JID to a comparable number
const normalizeJid = (jid) => {
    if (!jid) return "";
    // Remove everything except digits
    return jid.replace(/[^0-9]/g, "");
};

const getRankBadge = (rank) => {
    const badges = ["🥇", "🥈", "🥉"];
    return badges[rank - 1] || `${rank}.`;
};

// Calculate total value of assets
const getAssetValue = (assets = []) => assets.reduce((t, a) => t + (a.price || 0), 0);

// Total wealth minus debt
const calculateNetWorth = (user) => {
    const assets = getAssetValue(user.assets);
    return (user.wallet || 0) + (user.bank || 0) + assets - (user.debt || 0);
};

// Formats MS into readable time
const formatCooldown = (ms) => {
    if (!ms || ms <= 0) return "Ready";
    const seconds = Math.floor((ms / 1000) % 60);
    const minutes = Math.floor((ms / (1000 * 60)) % 60);
    const hours = Math.floor(ms / (1000 * 60 * 60));

    if (hours > 0) return `${hours}h ${minutes}m`;
    if (minutes > 0) return `${minutes}m ${seconds}s`;
    return `${seconds}s`;
};

// Get YYYY-MM-DD for daily resets (Nigeria timezone)
const getTodayString = () => new Date().toISOString().split('T')[0];

const getStreakMultiplier = (streak) => 1 + (streak * 0.05);

// 💰 Tax: 5% on amounts over threshold
const applyTax = (amount, threshold = 10000) => {
    if (amount <= threshold) return { gross: amount, tax: 0, net: amount };
    const tax = Math.floor(amount * 0.05);
    return { gross: amount, tax, net: amount - tax };
};

// Extract mentioned JID from message context
const getMentioned = (msg) => {
    return msg.message?.extendedTextMessage?.contextInfo?.mentionedJid?.[0] || null;
};

// Extract replied-to participant
const getReplied = (msg) => {
    return msg.message?.extendedTextMessage?.contextInfo?.participant || null;
};

// Get target from mention OR reply
const getTarget = (msg) => {
    return getMentioned(msg) || getReplied(msg) || null;
};

// Safe number parse
const safeInt = (val, fallback = 0) => {
    const n = parseInt(val);
    return isNaN(n) ? fallback : n;
};

module.exports = {
    randomInt,
    chance,
    formatMoney,
    formatShort,
    cleanId,
    normalizeJid,
    getRankBadge,
    getAssetValue,
    calculateNetWorth,
    formatCooldown,
    getTodayString,
    getStreakMultiplier,
    applyTax,
    getMentioned,
    getReplied,
    getTarget,
    safeInt
};
