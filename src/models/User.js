/**
 * 🛠 models/User.js — Phase 2 / 2.3
 *
 * Changes from old schema:
 *   ✅ Added: banReason, bannedBy, bannedAt (were set via raw driver
 *      bypass in admin.js because they weren't in the schema — now
 *      declared so Mongoose doesn't strip them on User.updateOne)
 *   ✅ Added: afk, afkReason, afkSince (same situation as ban fields)
 *   ❌ Removed: isAdmin (was declared but never set to true — dead code
 *      and a landmine for future devs who assumed the schema reflected
 *      reality)
 *   ❌ Removed: isGroup + antilink (moved to GroupSettings model in
 *      Phase 2.2 — group state belongs on groups, not on User)
 *
 * Note: there's a transitional concern here. The old code stored
 * antilink settings on a fake User doc with userId === chat (the group
 * JID). When we deploy v3.0.0, we should run a one-time migration
 * script to move those settings to GroupSettings. For now, the new
 * code reads antilink from GroupSettings only — old antilink settings
 * on User docs are ignored (but the data is still in the DB if we
 * ever need to recover it).
 *
 * Similarly, the `heistFreeze` field is kept (it's still written by
 * the heist logic) but is effectively dead code — see Phase 1 audit.
 * Will be removed in a future cleanup once we verify nothing reads it.
 */

const mongoose = require("mongoose");

// ==============================
// 📦 Asset Schema
// ==============================
const assetSchema = new mongoose.Schema({
  name: { type: String, required: true },
  price: { type: Number, required: true },
  income: { type: Number, default: 0 },

  isCollateral: { type: Boolean, default: false },
  loanValue: { type: Number, default: 0 },
  loanTakenAt: { type: Date, default: null }
}, { _id: false });


// ==============================
// 🎁 Collection Item Schema
// ==============================
const collectionItemSchema = new mongoose.Schema({
  name: { type: String, required: true },
  tier: { type: String, required: true },
  worth: { type: Number, default: 0 },
  image: { type: String, required: true }
}, { _id: false });


// ==============================
// 💍 Marriage Schema
// ==============================
const marriageSchema = new mongoose.Schema({
  spouseId: { type: String, required: true },
  marriedAt: { type: Number, default: Date.now }
}, { _id: false });


// ==============================
// 👤 User Schema
// ==============================
const userSchema = new mongoose.Schema({

  userId: { type: String, required: true, unique: true, index: true },

  // 💰 Money
  wallet: { type: Number, default: 2000 },
  bank: { type: Number, default: 0 },
  debt: { type: Number, default: 0 },

  // 📈 Progress
  level: { type: Number, default: 1 },
  xp: { type: Number, default: 0 },
  streak: { type: Number, default: 0 },

  // 📅 Claims
  lastDailyClaim: { type: String, default: null },
  lastAssetClaim: { type: String, default: null },

  // 🏢 Businesses
  assets: {
    type: [assetSchema],
    default: []
  },

  // 🛠 Tools
  tools: {
    shield: { type: Number, default: 0 },
    gun: { type: Number, default: 0 }
  },

  // ⏳ Cooldowns (Map of command → Date)
  cooldowns: {
    type: Map,
    of: Date,
    default: {}
  },

  // 💳 Loan System
  loanDue: { type: Number, default: null },
  loanDueAt: { type: Number, default: null },
  loanAsset: { type: assetSchema, default: null },

  // 🚔 JAIL SYSTEM
  jailUntil: { type: Number, default: null },

  // 🚫 Heist freeze (kept for backward compat — Phase 1 audit noted
  // this field is written but never read. Will be removed in a future
  // cleanup once we verify nothing depends on it.)
  heistFreeze: { type: Boolean, default: false },

  // ── Moderation ────────────────────────────────────────────
  // 🛠 FIX (Phase 2 / 2.3): These fields were previously set via
  // `User.collection.updateOne` (raw MongoDB driver bypass) because
  // Mongoose's strict mode silently stripped them on `User.updateOne`.
  // Now they're declared in the schema, so we can use Mongoose's normal
  // API for them. (The raw-driver bypass still works — it just writes
  // to fields that are now also declared.)
  banned: { type: Boolean, default: false },
  banUntil: { type: Number, default: null },
  banReason: { type: String, default: null },
  bannedBy: { type: String, default: null },  // JID of the banner, or "system"
  bannedAt: { type: Number, default: null },

  // 🛠 FIX (Phase 2 / 2.3): AFK fields now in schema (same reason as ban)
  afk: { type: Boolean, default: false },
  afkReason: { type: String, default: null },
  afkSince: { type: Number, default: null },

  // ❌ REMOVED (Phase 2 / 2.3): isAdmin — was declared but never set
  //    to true anywhere in the codebase. Group admin checks now use
  //    isGroupAdminIn() from lib/auth.js, which reads WhatsApp's
  //    group metadata directly. Dead field was a landmine for future
  //    devs who assumed the schema reflected reality.

  // ❌ REMOVED (Phase 2 / 2.3): isGroup + antilink — moved to the
  //    GroupSettings model in Phase 2.2. Group state belongs on
  //    groups, not on the User model.

  // 📊 Stats
  totalEarned: { type: Number, default: 0 },
  totalLost: { type: Number, default: 0 },
  totalGambles: { type: Number, default: 0 },

  // 🎁 Collection (anime cards)
  collection: {
    type: [collectionItemSchema],
    default: []
  },

  // 🎴 Active Drop (deprecated — moved to global._activeDrops Map
  // in economy.js. Kept for backward-compat reads of old data.)
  activeDrop: {
    type: Object,
    default: null
  },

  // 🎰 Gamble Tracking (Map of {date, count})
  gambleStats: {
    type: Map,
    of: mongoose.Schema.Types.Mixed,
    default: {}
  },

  // 💍 Marriage
  marriage: {
    type: marriageSchema,
    default: null
  },

}, {
  timestamps: true
});


// ==============================
// 💎 Virtual: Net Worth
// ==============================
// 🛠 FIX (Phase 2 / 2.1): now matches lib/economy.js's calculateNetWorth()
// exactly — INCLUDES card collection value. Old virtual did the same
// thing, but the parallel helper in utils/helpers.js didn't. Now there
// is ONE source of truth (lib/economy.js) and this virtual delegates to it.
userSchema.virtual("netWorth").get(function () {
  // Inline the calc to avoid circular require (lib/economy.js doesn't
  // import this model, but model requires the helper — kept separate
  // to avoid runtime require cycles)
  const assetValue = (this.assets || []).reduce(
    (sum, a) => sum + (a.price || 0), 0
  );
  const collectionValue = (this.collection || []).reduce(
    (sum, c) => sum + (c.worth || 0), 0
  );
  return (this.wallet + this.bank + assetValue + collectionValue) - this.debt;
});


// ==============================
// 🚀 Export
// ==============================
module.exports = mongoose.model("User", userSchema);
