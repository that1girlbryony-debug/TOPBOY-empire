/**
 * 🛠 src/config/cooldowns.js — Phase 2
 * All command cooldowns in one place — single source of truth.
 *
 * 🛠 FIX (Phase 2): The old config.js had stale/wrong entries:
 *   - bet: 60000 (no .bet command exists — DEAD ENTRY, removed)
 *   - daily: 86400000 (was never read — .daily used user.lastDailyClaim
 *     instead. Now .daily uses handleCooldown like everything else,
 *     so this entry IS read. Old comment was wrong.)
 *   - rob comment said "15 minutes" but value was 6m40s (corrected)
 *   - work: was MISSING (added in Phase 0 — was an infinite money printer)
 */

module.exports = {
  // ── Economy cooldowns ─────────────────────────────────────
  beg: 120000,          // 2 minutes
  rob: 400000,          // 6 minutes 40 seconds
  work: 1200000,        // 20 minutes (added in Phase 0 — was missing)
  daily: 86400000,      // 24 hours (now actually used by .daily via handleCooldown)

  // ── Game cooldowns ────────────────────────────────────────
  cf: 60000,            // 1 minute — coinflip
  slots: 60000,         // 1 minute
  casino: 120000,       // 2 minutes
  roulette: 60000,      // 1 minute
  dice: 60000,          // 1 minute — head-to-head dice game

  // ── Mini-game cooldowns (not all currently used; left for future) ──
  // (Removed `bet` — no .bet command exists. Was a dead entry.)
};
