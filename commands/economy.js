/**
 * 🛠 commands/economy.js — Phase 2 / 2.7
 *
 * BACKWARD COMPATIBILITY SHIM.
 *
 * The original 6,065-line economy.js has been relocated to
 * src/commands/_economyLegacy.js (with require paths updated).
 *
 * This file exists so any external code that still does
 * `require("./commands/economy")` continues to work. It re-exports
 * everything the legacy file exports.
 *
 * 🛠 MIGRATION TARGET: Phase 2.5 will progressively migrate commands
 * out of _economyLegacy.js into proper domain modules under
 * src/commands/economy/{money,gamble,businesses,cards,social,events,
 * progression}.js. When migration is complete, _economyLegacy.js
 * will be deleted and this shim will become the new router.
 *
 * Until then: just re-export.
 */

module.exports = require("../src/commands/_economyLegacy");

// Re-export named exports too (spawnTrivia, spawnMultiTrivia, etc.)
const legacy = require("../src/commands/_economyLegacy");
Object.assign(module.exports, legacy);
