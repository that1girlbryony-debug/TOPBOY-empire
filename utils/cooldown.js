const { formatCooldown } = require("./helpers");

/**
 * Calculates remaining milliseconds
 */
const getRemainingMs = (lastUsed, durationMs) => {
    if (!lastUsed) return 0;
    const last = new Date(lastUsed).getTime();
    const diff = Date.now() - last;
    return durationMs - diff;
};

/**
 * Checks if a command is on cooldown
 */
const isOnCooldown = (user, command, durationMs) => {
    if (!user.cooldowns) return false;
    const lastUsed = user.cooldowns.get(command);
    if (!lastUsed) return false;

    const remaining = getRemainingMs(lastUsed, durationMs);
    if (remaining <= 0) {
        user.cooldowns.delete(command);
        return false;
    }
    return true;
};

/**
 * Returns formatted string of remaining time or "Ready"
 */
const getCooldownRemaining = (user, command, durationMs) => {
    if (!user.cooldowns) return "Ready";
    const lastUsed = user.cooldowns.get(command);
    if (!lastUsed) return "Ready";

    const remaining = getRemainingMs(lastUsed, durationMs);
    if (remaining <= 0) return "Ready";

    return formatCooldown(remaining);
};

/**
 * Sets the cooldown on the user object without saving to DB 
 * (Saving is handled by the main command function to save RAM)
 */
const setCooldown = (user, command) => {
    if (!user.cooldowns) user.cooldowns = new Map();
    user.cooldowns.set(command, new Date());
};

module.exports = {
    isOnCooldown,
    getCooldownRemaining,
    setCooldown
};