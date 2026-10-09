/**
 * 🛠 src/commands/_state.js — Phase 2 / 2.5
 * Shared in-memory state for all command modules.
 *
 * Why this exists: the old economy.js used `if (!global._X) global._X = new Map()`
 * at module-load time, scattered across 6000+ lines. Each module that
 * referenced those Maps needed them to exist. Centralizing here means:
 *   1. One file to look at to see ALL shared state
 *   2. Easy to grep for which Maps exist
 *   3. Clear migration target if we want to persist any of them later
 *
 * 🛠 NOTE: Many of these Maps are still in-memory only. Phase 4.1
 * will migrate the long-running ones (TTT/RPS/PNT/auction/heist
 * sessions) to MongoDB so they survive bot restarts. Warnings and
 * freezes are also in-memory only.
 *
 * Maps NOT persisted (intentional — OK to lose on restart):
 *   - _gifMp4Cache: rebuilds itself on demand
 *   - _rateLimit: per-user antispam, resets are fine
 *   - _knownGroups: rebuilt as messages arrive
 *   - _lastKnownSock: current WhatsApp socket
 *
 * Maps that SHOULD be persisted (Phase 4.1):
 *   - _tttGames, _rpsGames, _pntGames, _pntLobbies: active games
 *   - _activeRaces, _activeAuctions, _activeHeists, _activeDrops: active events
 *   - _marriageProposals, _tradeProposals: pending proposals
 *   - _triviaActive, _multiTrivia, _quickDraw: active trivia/quickdraw
 *   - _warnings, _frozenUsers: moderation state
 *   - _voteKicks: active votekick sessions
 *
 * Maps persisted via GroupSettings (Phase 2.2):
 *   - _disabledGroups (replaced by GroupSettings.disabled)
 *   - _slowmode (replaced by GroupSettings.slowmodeSeconds)
 *   - _groupAdders (replaced by GroupSettings.addedBy)
 *   - _groupViolations (replaced by GroupSettings.violationCount)
 */

// ── Cache + infra ─────────────────────────────────────────────
if (!global._gifMp4Cache) global._gifMp4Cache = new Map();
if (!global._rateLimit) global._rateLimit = new Map();
if (!global._knownGroups) global._knownGroups = new Map();
if (!global._lastKnownSock) global._lastKnownSock = null;

// ── Active game sessions ──────────────────────────────────────
if (!global._tttGames) global._tttGames = new Map();
if (!global._rpsGames) global._rpsGames = new Map();
if (!global._rpsPlayerToChat) global._rpsPlayerToChat = new Map();
if (!global._pntLobbies) global._pntLobbies = new Map();
if (!global._pntGames) global._pntGames = new Map();
if (!global._pntPlayerToChat) global._pntPlayerToChat = new Map();
if (!global._activeDiceGames) global._activeDiceGames = new Map();

// ── Active events ─────────────────────────────────────────────
if (!global._activeRaces) global._activeRaces = new Map();
if (!global._lastAutoRace) global._lastAutoRace = new Map();
if (!global._activeAuctions) global._activeAuctions = new Map();
if (!global._activeHeists) global._activeHeists = new Map();
if (!global._activeDrops) global._activeDrops = new Map();
if (!global._quickDraw) global._quickDraw = new Map();
if (!global._quickDrawCooldowns) global._quickDrawCooldowns = new Map();
if (!global._triviaActive) global._triviaActive = new Map();
if (!global._multiTrivia) global._multiTrivia = new Map();

// ── Schedulers ────────────────────────────────────────────────
if (!global._hackerSchedulerTimer) global._hackerSchedulerTimer = null;
if (!global._autoRaceTimer) global._autoRaceTimer = null;
if (!global._proposalCleanup) global._proposalCleanup = null;
if (!global._lastHackerRun) global._lastHackerRun = new Map();
if (!global._quickDrawCooldowns) global._quickDrawCooldowns = new Map();

// ── Pending proposals ────────────────────────────────────────
if (!global._marriageProposals) global._marriageProposals = new Map();
if (!global._tradeProposals) global._tradeProposals = new Map();

// ── Moderation state (in-memory — Phase 4.1 will persist) ────
if (!global._warnings) global._warnings = new Map();        // `${chat}:${userId}` -> [{reason, at}]
if (!global._frozenUsers) global._frozenUsers = new Map();  // userId -> reason
if (!global._voteKicks) global._voteKicks = new Map();      // chat -> {target, yesVotes, noVotes, expiresAt}
if (!global._quizAdminCooldown) global._quizAdminCooldown = new Map();

// ── Cheat codes (owner-only, undocumented) ───────────────────
if (!global._guaranteedWin) global._guaranteedWin = new Set();

// ── Convenience accessors ────────────────────────────────────
module.exports = {
  // Cache + infra
  gifMp4Cache: global._gifMp4Cache,
  rateLimit: global._rateLimit,
  knownGroups: global._knownGroups,
  lastKnownSock: () => global._lastKnownSock,
  setLastKnownSock: (sock) => { global._lastKnownSock = sock; },

  // Active game sessions
  tttGames: global._tttGames,
  rpsGames: global._rpsGames,
  rpsPlayerToChat: global._rpsPlayerToChat,
  pntLobbies: global._pntLobbies,
  pntGames: global._pntGames,
  pntPlayerToChat: global._pntPlayerToChat,
  activeDiceGames: global._activeDiceGames,

  // Active events
  activeRaces: global._activeRaces,
  lastAutoRace: global._lastAutoRace,
  activeAuctions: global._activeAuctions,
  activeHeists: global._activeHeists,
  activeDrops: global._activeDrops,
  quickDraw: global._quickDraw,
  quickDrawCooldowns: global._quickDrawCooldowns,
  triviaActive: global._triviaActive,
  multiTrivia: global._multiTrivia,

  // Schedulers
  lastHackerRun: global._lastHackerRun,

  // Pending proposals
  marriageProposals: global._marriageProposals,
  tradeProposals: global._tradeProposals,

  // Moderation state
  warnings: global._warnings,
  frozenUsers: global._frozenUsers,
  voteKicks: global._voteKicks,
  quizAdminCooldown: global._quizAdminCooldown,
  guaranteedWin: global._guaranteedWin,
};
