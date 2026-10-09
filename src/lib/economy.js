/**
 * 🛠 lib/economy.js — Phase 2 / 2.1
 * Unified economy helpers: money formatting, net-worth, tax.
 *
 * Replaces:
 *   - utils/helpers.js's calculateNetWorth (excluded cards — wrong)
 *   - User schema's netWorth virtual (included cards — correct)
 *   - economy.js's calculateTax (progressive 5/12/20%)
 *   - Various inline formatMoney reimplementations
 *
 * Decision (Phase 2 Appendix C #1): cards COUNT toward net worth,
 * matching the schema virtual. This affects .lb ranking and hacker
 * event targeting.
 */

// ─── Money formatting ─────────────────────────────────────────

/** Standard money format: 1234567 → "1,234,567" */
function formatMoney(val = 0) {
  return Math.floor(val).toLocaleString("en-US");
}

/** Short money format: 1500000 → "1.5M" */
function formatShort(val = 0) {
  if (val >= 1e9) return (val / 1e9).toFixed(1) + "B";
  if (val >= 1e6) return (val / 1e6).toFixed(1) + "M";
  if (val >= 1e3) return (val / 1e3).toFixed(1) + "K";
  return val.toString();
}

/** Format ms as a readable duration: "1h 5m", "5m 30s", "30s" */
function formatCooldown(ms) {
  if (!ms || ms <= 0) return "Ready";
  const seconds = Math.floor((ms / 1000) % 60);
  const minutes = Math.floor((ms / (1000 * 60)) % 60);
  const hours = Math.floor(ms / (1000 * 60 * 60));
  if (hours > 0) return `${hours}h ${minutes}m`;
  if (minutes > 0) return `${minutes}m ${seconds}s`;
  return `${seconds}s`;
}

// ─── Net worth ─────────────────────────────────────────────────

/** Sum of asset prices (businesses only) */
function getAssetValue(assets = []) {
  return (assets || []).reduce((sum, a) => sum + (a.price || 0), 0);
}

/** Sum of card worth (collection) */
function getCollectionValue(collection = []) {
  return (collection || []).reduce((sum, c) => sum + (c.worth || 0), 0);
}

/**
 * Unified net-worth calculation — INCLUDES card collection value.
 * This matches the User schema's `netWorth` virtual.
 *
 * Used by: .lb (leaderboard), .profile, hacker event eligibility,
 * .loan collateral evaluation, etc.
 */
function calculateNetWorth(user) {
  if (!user) return 0;
  const wallet = user.wallet || 0;
  const bank = user.bank || 0;
  const assets = getAssetValue(user.assets);
  const collection = getCollectionValue(user.collection);
  const debt = user.debt || 0;
  return wallet + bank + assets + collection - debt;
}

// ─── Progressive tax ──────────────────────────────────────────

/**
 * Progressive tax brackets — used by .daily (the main income source).
 * Brackets: 0-10k = 0%, 10k-1M = 5%, 1M-50M = 12%, 50M+ = 20%.
 *
 * Note: .burn and .auction currently use flat 5% (intentional
 * carve-out — see Phase 4.5 decision). This helper is the
 * progressive version; .burn/.auction keep their inline flat math.
 */
function calculateTax(grossAmount) {
  if (grossAmount <= 10000) {
    return { gross: grossAmount, tax: 0, net: grossAmount };
  }
  let tax;
  if (grossAmount <= 1000000) {
    tax = Math.floor(grossAmount * 0.05);
  } else if (grossAmount <= 50000000) {
    tax = Math.floor(grossAmount * 0.12);
  } else {
    tax = Math.floor(grossAmount * 0.20);
  }
  return { gross: grossAmount, tax, net: grossAmount - tax };
}

/** Convenience: 5% flat tax — used by .burn and .auction */
function flatTax(grossAmount, rate = 0.05) {
  const tax = Math.floor(grossAmount * rate);
  return { gross: grossAmount, tax, net: grossAmount - tax };
}

// ─── Misc helpers (kept here to consolidate economy-related logic) ──

const randomInt = (min, max) => Math.floor(Math.random() * (max - min + 1)) + min;
const chance = (probability) => Math.random() < probability;

/** Get YYYY-MM-DD for daily resets (server timezone) */
const getTodayString = () => new Date().toISOString().split("T")[0];

/** Daily streak multiplier — +5% per day, capped at 2x */
const getStreakMultiplier = (streak) => Math.min(2, 1 + (streak * 0.05));

module.exports = {
  // formatting
  formatMoney,
  formatShort,
  formatCooldown,
  // net worth
  getAssetValue,
  getCollectionValue,
  calculateNetWorth,
  // tax
  calculateTax,
  flatTax,
  // misc
  randomInt,
  chance,
  getTodayString,
  getStreakMultiplier,
};
