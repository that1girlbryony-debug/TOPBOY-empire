/**
 * 🛠 commands/economy.js — BACKWARD COMPATIBILITY SHIM
 *
 * ROOT CAUSE FIX: This shim was forwarding to the legacy handler
 * (src/commands/_economyLegacy.js), but ALL commands have been
 * migrated to src/commands/economy/*.js modules and are now routed
 * through src/commands/_router.js. The legacy handler's MIGRATED
 * guard intercepts every migrated command, logs a warning, and
 * returns — so the bot silently did nothing.
 *
 * FIX: Forward to the router instead of the legacy handler.
 * The router checks MIGRATED_COMMANDS first (handles all 78
 * commands via the 12 domain modules), then falls back to legacy
 * for any unmigrated commands (there are none, but it's safe).
 *
 * Named exports (spawnTrivia, checkQuickDraw, handleDMAction, etc.)
 * are still re-exported from the legacy file since the router
 * doesn't provide those — they're game-engine functions used by
 * index.js and admin.js directly.
 */

// Route command handling through the router
const router = require("../src/commands/_router");

// The router exports `route(ctx, opts)` which is async and returns
// a boolean. But index.js calls `handleEconomy(ctx)` expecting it
// to be an async function that handles the command. So we wrap it.
const handleEconomy = async (ctx) => {
  await router.route(ctx, {});
};

// Re-export named functions from legacy (these are game-engine
// functions called directly by index.js, not through the router)
const legacy = require("../src/commands/_economyLegacy");

module.exports = handleEconomy;
module.exports.checkQuickDraw = legacy.checkQuickDraw;
module.exports.handleDMAction = legacy.handleDMAction;
module.exports.spawnTrivia = legacy.spawnTrivia;
module.exports.spawnMultiTrivia = legacy.spawnMultiTrivia;
module.exports.activeDrops = legacy.activeDrops;
module.exports.checkGifSetup = legacy.checkGifSetup;
