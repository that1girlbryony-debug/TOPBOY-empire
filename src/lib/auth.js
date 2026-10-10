/**
 * 🛠 src/lib/auth.js — v6.2: LID Normalization Engine
 *
 * Replaces the old digit-stripping normalizeJid with a proper
 * LID↔PN resolver. Config now stores plain phone numbers;
 * this module resolves them to whatever format WhatsApp sends
 * (LID or PN) at comparison time.
 *
 * How it works:
 *   1. At boot, index.js calls setSocket(sock) to give us access
 *      to Baileys' lidMapping API.
 *   2. index.js registers sock.ev.on("lid-mapping.update") which
 *      warms our local cache (phone ↔ lid pairs).
 *   3. On the first connection, Baileys also loads persisted mappings
 *      from its auth keys, so the cache is hot within seconds.
 *   4. isOwnerJid(jid) stays SYNC — it checks:
 *        a) Does jid's phone digits match any owner phone digits? → ✅
 *        b) Does jid's LID appear in our lid→phone cache, and does
 *           that phone match an owner phone? → ✅
 *        c) Cache miss → digit-strip fallback (works when both sides
 *           are same format, which covers most cases)
 *   5. For high-stakes async paths, isOwnerJidAsync(jid) calls
 *      sock.signalRepository.lidMapping.getPNForLID() on cache miss.
 */

const config = require("../../config");

// ── LID↔PN cache (warmed by lid-mapping.update events) ───────
// lid (digits) → phone (digits)
const _lidToPnCache = new Map();
// phone (digits) → lid (digits)
const _pnToLidCache = new Map();

// Socket reference (set once at boot)
let _sock = null;

/**
 * Called once at boot to give auth.js access to the Baileys socket
 * for LID resolution API calls.
 */
function setSocket(sock) {
  _sock = sock;
}

/**
 * Called when Baileys fires "lid-mapping.update" event.
 * Warms the cache so sync isOwnerJid can resolve LIDs.
 * @param {Object} mapping — { pn: string, lid: string }
 */
function cacheLidMapping(mapping) {
  if (!mapping?.pn || !mapping?.lid) return;

  // Normalize both sides to digits-only for consistent comparison
  const pnDigits = mapping.pn.replace(/[^0-9]/g, "");
  const lidDigits = mapping.lid.replace(/[^0-9]/g, "");

  if (pnDigits && lidDigits) {
    _lidToPnCache.set(lidDigits, pnDigits);
    _pnToLidCache.set(pnDigits, lidDigits);
  }
}

/**
 * Strip a JID down to its comparable numeric form.
 * "2349030784122@s.whatsapp.net" → "2349030784122"
 * "2349030784122:5@s.whatsapp.net" → "2349030784122"
 * "65215555178563@lid" → "65215555178563"
 */
function normalizeJid(jid) {
  if (!jid) return "";
  const base = String(jid).split("@")[0];
  const noDevice = base.split(":")[0];
  return noDevice.replace(/[^0-9]/g, "");
}

/**
 * Check if a JID ends with @lid
 */
function isLidUser(jid) {
  return jid?.endsWith?.("@lid") || false;
}

/**
 * Check if a JID ends with @s.whatsapp.net
 */
function isPnUser(jid) {
  return jid?.endsWith?.("@s.whatsapp.net") || false;
}

/**
 * Get all owner identifiers as a Set of digit-strings.
 * Includes both the raw phone digits AND any cached LID digits
 * that map to those phones.
 */
function getOwnerIdentifiers() {
  const ids = new Set();

  for (const ownerNum of config.ownerNumbers) {
    const phoneDigits = ownerNum.replace(/[^0-9]/g, "");
    ids.add(phoneDigits);

    // If we have a cached LID for this phone, add it too
    const lidDigits = _pnToLidCache.get(phoneDigits);
    if (lidDigits) {
      ids.add(lidDigits);
    }
  }

  return ids;
}

/**
 * Is this JID a bot owner? (SYNC — cache-only, no network)
 *
 * Checks three ways:
 *   1. Phone digits match directly
 *   2. LID is in cache and maps to an owner phone
 *   3. Digit-strip fallback (same-format comparison)
 *
 * @param {string} jid — JID in any format (@lid, @s.whatsapp.net, etc.)
 * @returns {boolean}
 */
function isOwnerJid(jid) {
  if (!jid) return false;

  const jidDigits = normalizeJid(jid);
  if (!jidDigits) return false;

  // Get all known owner identifiers (phones + cached LIDs)
  const ownerIds = getOwnerIdentifiers();

  // Direct match (phone-to-phone or LID-to-LID)
  if (ownerIds.has(jidDigits)) return true;

  // If jid is a LID, try resolving via cache
  if (isLidUser(jid)) {
    const phoneDigits = _lidToPnCache.get(jidDigits);
    if (phoneDigits && ownerIds.has(phoneDigits)) return true;
  }

  // If jid is a PN, try resolving to LID via cache
  if (isPnUser(jid)) {
    const lidDigits = _pnToLidCache.get(jidDigits);
    if (lidDigits && ownerIds.has(lidDigits)) return true;
  }

  return false;
}

/**
 * Is this JID a bot owner? (ASYNC — can hit network on cache miss)
 *
 * Use this for high-stakes checks where a false-negative would be
 * unacceptable (e.g., before executing a kick/ban on the owner).
 *
 * @param {string} jid
 * @returns {Promise<boolean>}
 */
async function isOwnerJidAsync(jid) {
  // Try sync first (covers most cases with warm cache)
  if (isOwnerJid(jid)) return true;

  // Cache miss — try resolving via Baileys API
  if (_sock?.signalRepository?.lidMapping && isLidUser(jid)) {
    try {
      const lidJid = jid.includes("@") ? jid : `${jid}@lid`;
      const pn = await _sock.signalRepository.lidMapping.getPNForLID(lidJid);
      if (pn) {
        const pnDigits = normalizeJid(pn);
        cacheLidMapping({ pn, lid: lidJid });
        const ownerIds = getOwnerIdentifiers();
        if (ownerIds.has(pnDigits)) return true;
      }
    } catch (err) {
      console.error("[auth] isOwnerJidAsync LID→PN resolution failed:", err.message);
    }
  }

  if (_sock?.signalRepository?.lidMapping && isPnUser(jid)) {
    try {
      const pnJid = jid.includes("@") ? jid : `${jid}@s.whatsapp.net`;
      const lid = await _sock.signalRepository.lidMapping.getLIDForPN(pnJid);
      if (lid) {
        cacheLidMapping({ pn: pnJid, lid });
        const ownerIds = getOwnerIdentifiers();
        if (ownerIds.has(normalizeJid(lid))) return true;
      }
    } catch (err) {
      console.error("[auth] isOwnerJidAsync PN→LID resolution failed:", err.message);
    }
  }

  return false;
}

/**
 * Is this JID a group admin (or superadmin) in the given metadata?
 * Works with both LID and PN participant IDs.
 */
function isGroupAdminIn(jid, metadata) {
  if (!metadata || !metadata.participants) return false;
  const jidDigits = normalizeJid(jid);

  // Try direct match first
  let participant = metadata.participants.find(p => normalizeJid(p.id) === jidDigits);

  // If not found and jid is LID, try resolving via cache to PN
  if (!participant && isLidUser(jid)) {
    const pnDigits = _lidToPnCache.get(jidDigits);
    if (pnDigits) {
      participant = metadata.participants.find(p => {
        if (normalizeJid(p.id) === pnDigits) return true;
        // Also check p.phoneNumber if available
        if (p.phoneNumber && normalizeJid(p.phoneNumber) === pnDigits) return true;
        // Also try matching this participant's LID via cache
        const pLid = normalizeJid(p.id);
        if (isLidUser(p.id)) {
          const pPn = _lidToPnCache.get(pLid);
          if (pPn && pPn === pnDigits) return true;
        }
        return false;
      });
    }
  }

  // If not found and jid is PN, try resolving via cache to LID
  if (!participant && isPnUser(jid)) {
    const lidDigits = _pnToLidCache.get(jidDigits);
    if (lidDigits) {
      participant = metadata.participants.find(p => normalizeJid(p.id) === lidDigits);
    }
  }

  return participant?.admin === "admin" || participant?.admin === "superadmin";
}

/**
 * Is the bot itself an admin in the given metadata?
 * Uses config.botLid (auto-set at connect time by index.js).
 */
function isBotAdminIn(metadata) {
  if (!config.botLid) return false;
  return isGroupAdminIn(config.botLid, metadata);
}

/**
 * Combined check: group admin OR bot owner.
 */
function isGroupAdminOrOwner(jid, metadata) {
  return isOwnerJid(jid) || isGroupAdminIn(jid, metadata);
}

module.exports = {
  normalizeJid,
  isLidUser,
  isPnUser,
  isOwnerJid,
  isOwnerJidAsync,
  isGroupAdminIn,
  isBotAdminIn,
  isGroupAdminOrOwner,
  setSocket,
  cacheLidMapping,
  // Export cache stats for debugging
  _cacheStats: () => ({ lidToPn: _lidToPnCache.size, pnToLid: _pnToLidCache.size }),
};
