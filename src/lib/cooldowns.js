/**
 * 🛠 lib/cooldowns.js — Phase 2 / 2.1
 * Single cooldown system for all commands.
 *
 * Replaces:
 *   - utils/cooldown.js (the old generic cooldown helper)
 *   - The parallel user.lastDailyClaim check inside .daily
 *     (which .cd couldn't see, so it lied about daily's status)
 *
 * All cooldowns now go through handleCooldown() and are visible to .cd.
 */

const config = require("../config");
const { formatCooldown } = require("./economy");

/**
 * Get remaining ms on a cooldown. Returns 0 if ready.
 * @param {Object} user — Mongoose User doc
 * @param {string} command — cooldown key (e.g. "work", "daily", "rob")
 * @param {number} durationMs — cooldown duration in ms (from config.cooldowns)
 */
function getRemainingMs(user, command, durationMs) {
  if (!user?.cooldowns) return 0;
  const lastUsed = user.cooldowns.get?.(command) || user.cooldowns[command];
  if (!lastUsed) return 0;
  const last = new Date(lastUsed).getTime();
  const remaining = durationMs - (Date.now() - last);
  return remaining > 0 ? remaining : 0;
}

/**
 * Is this command currently on cooldown?
 * Side-effect: if expired, removes the stale entry.
 */
function isOnCooldown(user, command, durationMs) {
  const remaining = getRemainingMs(user, command, durationMs);
  if (remaining <= 0) {
    if (user?.cooldowns && typeof user.cooldowns.delete === "function") {
      user.cooldowns.delete(command);
    } else if (user?.cooldowns) {
      delete user.cooldowns[command];
    }
    return false;
  }
  return true;
}

/**
 * Returns formatted string of remaining time, or "Ready".
 */
function getCooldownRemaining(user, command, durationMs) {
  const remaining = getRemainingMs(user, command, durationMs);
  return remaining > 0 ? formatCooldown(remaining) : "Ready";
}

/**
 * Set the cooldown on the user object (does NOT save — caller saves
 * once at the end of the command, to save RAM).
 */
function setCooldown(user, command) {
  if (!user.cooldowns) user.cooldowns = new Map();
  if (typeof user.cooldowns.set === "function") {
    user.cooldowns.set(command, new Date());
  } else {
    user.cooldowns[command] = new Date();
  }
}

/**
 * Check + reply if on cooldown. Returns true if the caller should
 * early-return (i.e. user IS on cooldown). Returns false if the
 * caller should proceed (and then call setCooldown after the command).
 *
 * Usage:
 *   if (await handleCooldown(user, "work", reply)) return;
 *   // ... do the work ...
 *   setCooldown(user, "work");
 *   await user.save();
 */
async function handleCooldown(user, command, reply) {
  const durationMs = config.cooldowns[command];
  if (!durationMs) {
    // No cooldown configured for this command — log so devs notice
    console.warn(`⚠️ [cooldowns] No config.cooldowns.${command} entry — command has no cooldown`);
    return false;
  }
  if (isOnCooldown(user, command, durationMs)) {
    const remaining = getCooldownRemaining(user, command, durationMs);
    await reply(`⏳ Cooldown active — try again in ${remaining}.`);
    return true;
  }
  return false;
}

module.exports = {
  getRemainingMs,
  isOnCooldown,
  getCooldownRemaining,
  setCooldown,
  handleCooldown,
};
