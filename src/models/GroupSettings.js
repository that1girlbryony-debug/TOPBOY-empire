/**
 * 🛠 models/GroupSettings.js — Phase 2 / 2.2
 * NEW: persistent moderation state per group.
 *
 * Replaces the in-memory state that used to evaporate on every bot
 * restart:
 *   - global._disabledGroups Set → GroupSettings.disabled
 *   - global._slowmode Map → GroupSettings.slowmodeSeconds
 *   - global._groupAdders Map → GroupSettings.addedBy (who added the bot)
 *   - global._groupViolations Map → GroupSettings.violationCount
 *   - User({ userId: chat, antilink }) → GroupSettings.antilink
 *
 * On startup, the bot calls GroupSettings.loadAll() to rehydrate the
 * in-memory caches for fast access during message handling.
 *
 * Warnings and freezes are still in-memory (per-user, per-group) —
 * those are scheduled to move to a ModerationAction collection in
 * Phase 4.1.
 */

const mongoose = require("mongoose");

const groupSettingsSchema = new mongoose.Schema({
  groupId: { type: String, required: true, unique: true, index: true },

  // ── Bot state ─────────────────────────────────────────────
  /** True = bot commands disabled in this group only (owner still passes) */
  disabled: { type: Boolean, default: false },

  /** True = bot globally disabled (overrides per-group). Only set on the
   *  special "__global__" record. */
  globalDisable: { type: Boolean, default: false },

  // ── Moderation ─────────────────────────────────────────────
  /** Antilink enforcement (regex covers chat.whatsapp.com, wa.me/, etc.) */
  antilink: { type: Boolean, default: false },

  /** Slowmode seconds for non-admins (null = off). */
  slowmodeSeconds: { type: Number, default: null },

  /** Who added the bot to this group (JID). Used by the unauthorized-group
   *  check to ban the adder if the group turns out unauthorized. */
  addedBy: { type: String, default: null },

  /** Unauthorized-group violation counter. 3 strikes → bot leaves +
   *  adder gets banned. Reset to 0 when the group becomes authorized. */
  violationCount: { type: Number, default: 0 },

  // ── Bookkeeping ───────────────────────────────────────────
  lastSeenAt: { type: Number, default: Date.now },
}, {
  timestamps: true,
});

// ── Static helpers ─────────────────────────────────────────────

/**
 * Get or create settings for a group.
 * Returns a plain object (not a Mongoose doc) for fast in-memory use.
 */
groupSettingsSchema.statics.getFor = async function (groupId) {
  let doc = await this.findOne({ groupId });
  if (!doc) {
    doc = await this.create({ groupId });
  }
  return doc;
};

/**
 * Atomic update of a single field. Used by event handlers that need
 * to persist state without doing a full read-modify-write cycle.
 */
groupSettingsSchema.statics.patch = async function (groupId, patch) {
  return this.findOneAndUpdate(
    { groupId },
    { $set: patch },
    { upsert: true, new: true }
  );
};

/**
 * Increment the violation counter atomically.
 * Returns the new count.
 */
groupSettingsSchema.statics.incrementViolations = async function (groupId) {
  const doc = await this.findOneAndUpdate(
    { groupId },
    { $inc: { violationCount: 1 }, $set: { lastSeenAt: Date.now() } },
    { upsert: true, new: true }
  );
  return doc.violationCount;
};

/**
 * Reset violations to 0 (called when group becomes authorized).
 */
groupSettingsSchema.statics.resetViolations = async function (groupId) {
  return this.updateOne(
    { groupId },
    { $set: { violationCount: 0 } }
  );
};

/**
 * Get the global disable flag (stored on the "__global__" record).
 */
groupSettingsSchema.statics.getGlobalDisable = async function () {
  const doc = await this.findOne({ groupId: "__global__" });
  return doc?.globalDisable || false;
};

/**
 * Set the global disable flag.
 */
groupSettingsSchema.statics.setGlobalDisable = async function (value) {
  return this.findOneAndUpdate(
    { groupId: "__global__" },
    { $set: { globalDisable: !!value } },
    { upsert: true, new: true }
  );
};

module.exports = mongoose.model("GroupSettings", groupSettingsSchema);
