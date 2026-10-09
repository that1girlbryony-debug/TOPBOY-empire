/**
 * 🛠 src/commands/_router.js — Phase 2 / 2.5
 *
 * Central command dispatcher. Routes incoming commands to the right
 * module based on the command name.
 *
 * Migration strategy:
 *   - "Migrated" commands are handled by a specific new module under
 *     src/commands/{economy,games,admin}/
 *   - "Legacy" commands fall through to _economyLegacy.js (the old
 *     economy.js, kept as a single transitional file)
 *
 * Each phase of migration moves commands from the legacy file into
 * their proper module. When all commands are migrated, the legacy
 * file is deleted.
 *
 * Current migration status (Phase 2.5 FINAL — ALL commands migrated):
 *   ✅ progression.js: .cd, .daily, .work, .beg, .lb, .richest, .profile
 *   ✅ money.js: .bal, .dep, .wd, .give, .send
 *   ✅ gamble.js: .casino, .slots, .cf, .roulette
 *   ✅ cards.js: .col, .view, .burn
 *   ✅ social.js: .marry, .divorce, .spouse, .marriageaccept, .marriagereject, .slap, .kill, .yeet, .fuck, .kiss
 *   ✅ businesses.js: .shop, .buy, .sell, .assets, .items, .tools
 *   ✅ info.js: .menu, .help, .about, .test, .debug, .afk
 *   ✅ transactions.js: .loan, .payloan, .bail, .trade, .tradeaccept, .tradereject, .fuse, .rob
 *   ✅ games.js: .ttt, .move, .rps, .throw, .race, .dogbet, .pnt, .pntjoin, .dice, .accept, .reject, .roll, .yes, .no
 *   ✅ events.js: .heist, .join, .protect, .claim, .auction, .bid
 *   ⬜ Legacy file (_economyLegacy.js) now acts as a GAME-ENGINE LIBRARY only:
 *      module-level functions (tttStartChallenge, runDogRace, maybeTriggerHacker,
 *      spawnTrivia, etc.) + shared Maps + setInterval schedulers. No commands
 *      are dispatched through it anymore — all command dispatch goes through
 *      the 10 modules above via MIGRATED_COMMANDS.
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

// ── Migrated command sets (Phase 2.5) ──────────────────────────
// These are checked BEFORE the legacy fallback. If a command is in
// one of these sets, it's handled by the new module — the legacy
// file never sees it.
const progression = require("./economy/progression");
const money = require("./economy/money");
const gamble = require("./economy/gamble");
const cards = require("./economy/cards");
const social = require("./economy/social");
const businesses = require("./economy/businesses");
const info = require("./economy/info");
const transactions = require("./economy/transactions");
const games = require("./economy/games");
const events = require("./economy/events");

const MIGRATED_COMMANDS = new Map(); // command → handler module
for (const cmd of progression.PROGRESSION_COMMANDS) MIGRATED_COMMANDS.set(cmd, progression);
for (const cmd of money.MONEY_COMMANDS) MIGRATED_COMMANDS.set(cmd, money);
for (const cmd of gamble.GAMBLE_COMMANDS) MIGRATED_COMMANDS.set(cmd, gamble);
for (const cmd of cards.CARDS_COMMANDS) MIGRATED_COMMANDS.set(cmd, cards);
for (const cmd of social.SOCIAL_COMMANDS) MIGRATED_COMMANDS.set(cmd, social);
for (const cmd of businesses.BUSINESS_COMMANDS) MIGRATED_COMMANDS.set(cmd, businesses);
for (const cmd of info.INFO_COMMANDS) MIGRATED_COMMANDS.set(cmd, info);
for (const cmd of transactions.TRANSACTION_COMMANDS) MIGRATED_COMMANDS.set(cmd, transactions);
for (const cmd of games.GAME_COMMANDS) MIGRATED_COMMANDS.set(cmd, games);
for (const cmd of events.EVENT_COMMANDS) MIGRATED_COMMANDS.set(cmd, events);

// ── Economy commands list (all commands — for the outer gate) ──
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
    if (!isBotOwner && !isGroupAdmin) {
      await ctx.reply("🚫 *ADMIN ACCESS DENIED*\n\n💡 Group-admin commands need WhatsApp admin rights. Bot-wide commands (ban, freeze, etc.) need owner rights.");
      return true;
    }
    const handleAdmin = require("./admin");
    await handleAdmin({
      ...ctx,
      groupMetadata: opts.adminMetadata || opts.groupMetadata,
    });
    return true;
  }

  // ── Migrated economy commands (Phase 2.5) ─────────────────
  // Check these FIRST — if the command has been migrated to a new
  // module, handle it there and skip the legacy file entirely.
  const migratedModule = MIGRATED_COMMANDS.get(command);
  if (migratedModule) {
    const handled = await migratedModule.handle(ctx);
    if (handled !== false) return true;
    // If the module returned false (e.g. default case in switch),
    // fall through to legacy as a safety net.
  }

  // ── Legacy economy commands (not yet migrated) ─────────────
  if (ECONOMY_COMMANDS.has(command)) {
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
  MIGRATED_COMMANDS,
};
