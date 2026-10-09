/**
 * 🛠 lib/auth.js — Phase 2 / 2.1
 * Single source of truth for owner/admin checks.
 *
 * Replaces:
 *   - isOwnerJid (old index.js) — used normalizeJid (strip non-digits)
 *   - isBotOwner (old admin.js) — used sender.split("@")[0]
 *   - isOwnerTarget (Phase 1 admin.js) — used split("@")[0]
 *
 * All three were inconsistent on device-suffixed JIDs (":5@s.whatsapp.net"),
 * leading to bugs where the owner was denied access in some paths but
 * not others. This module exposes ONE function that handles all formats.
 */

const config = require("../config");

/**
 * Strip a JID down to its comparable numeric form.
 * Removes everything except digits — works for:
 *   "2349030784122@s.whatsapp.net" → "2349030784122"
 *   "2349030784122:5@s.whatsapp.net" → "23490307841225"  ❌ (loses device suffix)
 *
 * Wait — that's actually wrong for device-suffixed JIDs, because two
 * different devices of the same number become different "owners".
 * The CORRECT comparison for owner checks is the bare phone number
 * (without device suffix), so we split on ":" BEFORE stripping.
 */
function normalizeJid(jid) {
  if (!jid) return "";
  // Take the part before "@" (handles @lid, @s.whatsapp.net, @g.us)
  const base = String(jid).split("@")[0];
  // Take the part before ":" (handles device suffix like :5)
  const noDevice = base.split(":")[0];
  // Strip any remaining non-digits (handles "+", spaces, dashes)
  return noDevice.replace(/[^0-9]/g, "");
}

/**
 * Is this JID a bot owner?
 * Works for any input format: @s.whatsapp.net, @lid, device-suffixed, etc.
 */
function isOwnerJid(jid) {
  if (!jid) return false;
  const norm = normalizeJid(jid);
  if (!norm) return false;
  return config.ownerNumbers.some(owner => normalizeJid(owner) === norm);
}

/**
 * Is this JID a group admin (or superadmin) in the given metadata?
 * `metadata.participants` is the WhatsApp group metadata object.
 */
function isGroupAdminIn(jid, metadata) {
  if (!metadata || !metadata.participants) return false;
  const norm = normalizeJid(jid);
  const participant = metadata.participants.find(p => normalizeJid(p.id) === norm);
  return participant?.admin === "admin" || participant?.admin === "superadmin";
}

/**
 * Is the bot itself an admin in the given metadata?
 */
function isBotAdminIn(metadata) {
  return isGroupAdminIn(config.botLid, metadata);
}

/**
 * Combined check: group admin OR bot owner.
 * This is the typical "can run group-scoped admin commands" predicate.
 */
function isGroupAdminOrOwner(jid, metadata) {
  return isOwnerJid(jid) || isGroupAdminIn(jid, metadata);
}

module.exports = {
  normalizeJid,
  isOwnerJid,
  isGroupAdminIn,
  isBotAdminIn,
  isGroupAdminOrOwner,
};
