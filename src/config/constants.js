/**
 * 🛠 src/config/constants.js — Phase 2
 * Game/economy constants — pulled out of inline declarations
 * in the old economy.js so they're discoverable and tunable.
 *
 * 🛠 FIX (Phase 2): Many of these were declared inline at the top of
 * economy.js, scattered across 5000+ lines. Now they're all here so
 * you can tune the economy from one file.
 */

module.exports = {
  // ── Money ─────────────────────────────────────────────────
  /** Starter cash on .register (also used by .reset — fixes Phase 0 audit
   *  note about $2k register vs $200k reset inconsistency). */
  STARTER_WALLET: 2000,

  // ── Marriage ──────────────────────────────────────────────
  MARRIAGE_FEE: 100_000_000,        // $100M — proposer pays on accept
  DIVORCE_FEE: 50_000_000,          // $50M — both spouses pay on divorce
  SPOUSE_GAMBLE_SHARE: 0.20,        // spouse gets 20% of gambling wins
  SPOUSE_DAILY_SHARE: 0.50,         // spouse gets 50% of after-tax daily

  // ── Loan system ──────────────────────────────────────────
  LOAN_VALUE_RATIO: 0.80,           // loan amount = asset.price * 0.80
  LOAN_INTEREST: 0.10,              // repay amount = loan * 1.10
  LOAN_DURATION: 24 * 60 * 60 * 1000, // 24 hours

  // ── Heist ─────────────────────────────────────────────────
  HEIST_DURATION: 80 * 1000,        // 80s window to .join/.protect
  HEIST_COOLDOWN: 60 * 60 * 1000,   // 60 min between heists per group
  HEIST_JAIL_TIME: 20 * 60 * 1000,  // 20 min jail for caught robbers

  // ── Hacker event ──────────────────────────────────────────
  HACKER_INTERVAL: 3 * 60 * 60 * 1000, // 3h between hacker events per group
  HACKER_SUCCESS_RATE: 0.95,        // 95% chance hacker succeeds (5% lucky escape)

  // ── Quick Draw ────────────────────────────────────────────
  QD_CHANCE: 0.08,                  // 8% roll per economy command
  QD_COOLDOWN: 15 * 60 * 1000,      // 15 min between quick draws per group
  QD_WINDOW: 15 * 1000,             // 15s to type the word
  QD_REWARD: 300_000,

  // ── Dog race ──────────────────────────────────────────────
  RACE_TRACK_LENGTH: 32,
  RACE_BET_WINDOW: 60 * 1000,       // 60s to .dogbet
  RACE_TICK_MS: 2000,               // 2s per tick
  RACE_MAX_TICKS: 30,
  AUTO_RACE_INTERVAL: 2 * 60 * 60 * 1000, // 2h between auto-races per group

  // ── TTT / RPS / Dice timeouts ─────────────────────────────
  TTT_MOVE_TIMEOUT: 120 * 1000,    // 2min per move (auto-forfeit)
  RPS_GAME_TIMEOUT: 5 * 60 * 1000, // 5min to throw (refund both)
  DICE_MOVE_TIMEOUT: 90 * 1000,    // 90s per roll (refund both)

  // ── Trivia ────────────────────────────────────────────────
  TRIVIA_PRIZE: 5_000_000,         // single-trivia prize
  MULTI_TRIVIA_PRIZE: 50_000_000,  // multi-trivia winner-takes-all
  TRIVIA_WINDOW: 30 * 1000,        // 30s per question
  TRIVIA_GAP: 32 * 1000,           // 32s between questions (window + 2s gap)

  // ── PNT (Police & Thief) ──────────────────────────────────
  PNT_MIN_PLAYERS: 3,
  PNT_LOBBY_WINDOW: 45 * 1000,
  PNT_ACTION_WINDOW: 90 * 1000,
  PNT_REVEAL_PAUSE: 25 * 1000,
  PNT_ROUNDS: 3,
  PNT_PRIZE: 5_000_000,            // per winner
  PNT_XP: 50,                      // per winner

  // ── Dog race — Dog pool ───────────────────────────────────
  DOG_POOL: [
    { emoji: "🐶", name: "Rex" },
    { emoji: "🐕", name: "Max" },
    { emoji: "🐩", name: "Bella" },
    { emoji: "🦮", name: "Duke" },
    { emoji: "🐺", name: "Luna" },
    { emoji: "🐕‍🦺", name: "Zoe" },
  ],

  // ── PNT locations (same every game) ──────────────────────
  PNT_LOCATIONS: ["Mart", "Carwash", "Bank", "Warehouse", "Casino", "Cinema"],

  // ── Quick Draw word list ─────────────────────────────────
  QD_WORDS: [
    "banana", "rocket", "dragon", "laptop", "pizza",
    "tiger", "galaxy", "wizard", "ninja", "phone",
    "cookie", "shadow", "thunder", "diamond", "coffee"
  ],
};
