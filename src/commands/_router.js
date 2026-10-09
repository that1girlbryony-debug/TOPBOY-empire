/**
 * 🛠 src/commands/_router.js — Phase 2 / 2.5
 *
 * Central command dispatcher. Routes incoming commands to the right
 * module based on the command name.
 *
 * Migration strategy:
 *   - "Migrated" commands are handled by a specific new module under
 *     src/commands/{economy,games,admin}/
 *   - "Legacy" commands fall through to economyLegacy.js (the old
 *     economy.js, kept as a single transitional file)
 *
 * Each phase of migration moves commands from the legacy file into
 * their proper module. When all commands are migrated, the legacy
 * file is deleted.
 *
 * Current migration status:
 *   ✅ Migrated: (none yet — Phase 2.5 will start this)
 *   ⬜ Legacy: ALL economy commands (currently ~70 of them in
 *      commands/economy.js, which is being moved to
 *      src/commands/_economyLegacy.js as a transitional measure)
 *
 * This file's ONLY job is to dispatch — it doesn't implement any
 * command logic itself.
 */

const User = require("../models/User");
const { isOwnerJid, isGroupAdminIn } = require("../lib/auth");

// ── Admin commands list (mirrors index.js adminCommands array) ──
const ADMIN_COMMANDS = new Set([
  "ban", "unban", "addbal", "tagall", "broadcast",
  "seize", "reset", "giveaway", "admin", "airdrop", "system",
  "kick", "antilink", "cdr", "votekick", "qa", "quiz",
  "promote", "demote",
  "mute", "unmute", "lid",
  "warn", "warnings", "clearwarns",
  "freeze", "unfreeze", "slowmode",
  "setxp", "setlevel", "clearcooldowns", "rain",
  "forcemarry", "forcedivorce",
  "gifcheck", "info"
]);

// ── Economy commands list ──
const ECONOMY_COMMANDS = new Set([
  "menu", "help", "about",
  "profile", "bal", "assets", "lb", "richest", "cd",
  "daily", "beg", "auction", "bid", "wd", "dep", "give", "loan", "payloan",
  "rob", "send", "casino", "slots", "cf", "roulette",
  "shop", "dice", "items", "heist", "join", "protect", "claim", "col", "view",
  "burn", "test", "tools", "accept", "reject", "kiss", "slap", "fuck", "yeet",
  "kill", "yes", "no", "roll", "buy", "sell", "bail",
  "marry", "divorce", "spouse", "marriageaccept", "marriagereject", "work",
  "trade", "fuse", "tradeaccept", "tradereject",
  "debug",
  // Mini-games
  "ttt", "move",
  "rps", "throw", "race", "dogbet",
  "pnt", "pntjoin",
  "afk"
]);

/**
 * Main router entry point.
 *
 * @param {Object} ctx — command context
 *   { sock, chat, sender, command, args, user, reply, msg, isGroup }
 * @param {Object} opts
 *   { adminMetadata, groupMetadata, isBotOwner, isGroupAdmin }
 *
 * @returns {Promise<boolean>} true if a command was handled
 */
async function route(ctx, opts = {}) {
  const { command } = ctx;
  const { isBotOwner, isGroupAdmin } = opts;

  // ── Admin commands ─────────────────────────────────────────
  if (ADMIN_COMMANDS.has(command)) {
    // The old admin.js requires the outer gate check + target detection.
    // The router handles gate; admin module handles target detection.
    if (!isBotOwner && !isGroupAdmin) {
      await ctx.reply("🚫 *ADMIN ACCESS DENIED*\n\n💡 Group-admin commands need WhatsApp admin rights. Bot-wide commands (ban, freeze, etc.) need owner rights.");
      return true;
    }
    const handleAdmin = require("./admin");
    await handleAdmin({
      ...ctx,
      // admin.js expects these on the context:
      groupMetadata: opts.adminMetadata || opts.groupMetadata,
    });
    return true;
  }

  // ── Economy commands (currently all legacy) ───────────────
  if (ECONOMY_COMMANDS.has(command)) {
    // 🛠 Phase 2.5 transitional: load the legacy economy handler.
    // This is the original economy.js, just relocated. When commands
    // are migrated out, they'll be intercepted here BEFORE falling
    // through to legacy.
    const handleEconomy = require("./_economyLegacy");
    await handleEconomy(ctx);
    return true;
  }

  return false;
}

module.exports = {
  route,
  ADMIN_COMMANDS,
  ECONOMY_COMMANDS,
};
