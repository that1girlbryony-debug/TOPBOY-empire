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

  // ⏳ Cooldowns
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

  // 🚫 Heist freeze
  heistFreeze: { type: Boolean, default: false },

  // 🚫 Admin / Ban
  banned: { type: Boolean, default: false },
  banUntil: { type: Number, default: null },
  isAdmin: { type: Boolean, default: false },

  // 📊 Stats
  totalEarned: { type: Number, default: 0 },
  totalLost: { type: Number, default: 0 },
  totalGambles: { type: Number, default: 0 },

  // 🎁 Collection
  collection: {
    type: [collectionItemSchema],
    default: []
  },

  // 🎴 Active Drop
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

  // 🔗 Group settings
  isGroup: { type: Boolean, default: false },
  antilink: { type: Boolean, default: false }

}, {
  timestamps: true
});


// ==============================
// 💎 Virtual: Net Worth
// ==============================
userSchema.virtual("netWorth").get(function () {
  const assetValue = (this.assets || []).reduce(
    (sum, a) => sum + (a.price || 0),
    0
  );

  const collectionValue = (this.collection || []).reduce(
    (sum, c) => sum + (c.worth || 0),
    0
  );

  return (this.wallet + this.bank + assetValue + collectionValue) - this.debt;
});


// ==============================
// 🚀 Export
// ==============================
module.exports = mongoose.model("User", userSchema);
