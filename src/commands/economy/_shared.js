/**
 * 🛠 src/commands/economy/_shared.js — Phase 2.5
 *
 * Bridges the module-level helper functions from _economyLegacy.js
 * so that newly-migrated command modules can import them without
 * duplicating the code.
 *
 * Also provides a standalone `createRewardXP()` factory that replaces
 * the legacy `rewardXP()` function (which was defined INSIDE the
 * module.exports handler, closing over `user`, `command`, etc.).
 * New modules call `createRewardXP({ user, command })` to get a
 * function with the same semantics.
 */

const legacy = require("../_economyLegacy");
const { addXP, xpRewards } = legacy;

/**
 * Factory: create a rewardXP function bound to a specific user + command.
 *
 * The legacy rewardXP() was defined inside the handler and closed over:
 *   - user (the Mongoose doc)
 *   - command (the current command name, e.g. "daily")
 *   - xpGiven (a local boolean guarding double-reward)
 *
 * This factory produces a function with the same behavior but without
 * needing to be defined inside the handler scope.
 *
 * Usage:
 *   const rewardXP = createRewardXP({ user, command });
 *   // ... do the command ...
 *   await rewardXP();  // awards XP based on xpRewards[command]
 *
 * @param {Object} opts - { user, command }
 * @returns {Function} async function that awards XP (idempotent — safe to call multiple times)
 */
function createRewardXP({ user, command }) {
  let xpGiven = false;

  return async function rewardXP() {
    if (xpGiven) return;
    const reward = xpRewards[command];
    if (!reward) return;
    addXP(user, reward);
    xpGiven = true;
  };
}

module.exports = {
  // ── Cooldown helpers ───────────────────────────────────────
  ensureCooldownMap: legacy.ensureCooldownMap,
  getRemaining: legacy.getRemaining,
  handleCooldown: legacy.handleCooldown,
  formatTime: legacy.formatTime,
  getNigeriaDate: legacy.getNigeriaDate,
  checkGambleLimit: legacy.checkGambleLimit,

  // ── UI helpers (dead code in legacy, but exported for completeness) ──
  header: legacy.header,
  footer: legacy.footer,
  divider: legacy.divider,
  successBox: legacy.successBox,
  errorBox: legacy.errorBox,
  infoBox: legacy.infoBox,

  // ── XP / level system ──────────────────────────────────────
  xpForNextLevel: legacy.xpForNextLevel,
  addXP: legacy.addXP,
  createXPBar: legacy.createXPBar,

  // ── Titles ─────────────────────────────────────────────────
  getTitle: legacy.getTitle,

  // ── Tax (legacy returns a NUMBER, not the object that ──────
  //    src/lib/economy.calculateTax returns — kept for compat) ──
  calculateTax: legacy.calculateTax,

  // ── XP rewards table ───────────────────────────────────────
  xpRewards: legacy.xpRewards,

  // ── Shop / items ───────────────────────────────────────────
  shopItems: legacy.shopItems,
  powerItems: legacy.powerItems,
  dropItems: legacy.dropItems,
  MAX_COPIES_PER_ASSET: legacy.MAX_COPIES_PER_ASSET,
  MAX_TOTAL_ASSETS: legacy.MAX_TOTAL_ASSETS,

  // ── Drop limiter ───────────────────────────────────────────
  canFireInGroup: legacy.canFireInGroup,
  canDropInGroup: legacy.canDropInGroup,

  // ── Reward XP factory ──────────────────────────────────────
  createRewardXP,
};
