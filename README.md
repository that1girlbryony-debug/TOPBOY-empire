# TOPBOY EMPIRE — WhatsApp Economy Bot

> v3.0.0 — Architecture refactor (Phase 2 of refactor plan)

A WhatsApp group-chat economy/gaming bot built on the Baileys library
(unofficial WhatsApp Web API) with MongoDB persistence.

## 🚀 Quick Start

```bash
# 1. Install dependencies
npm install

# 2. Configure environment
cp .env.example .env
# Edit .env with your MongoDB URI and phone number

# 3. Run the bot
npm start
```

On first run, the bot prints a pairing code. Open WhatsApp → ⋮ Menu →
Linked Devices → Link a Device → Link with Phone Number → enter the code.

## 📁 Project Structure (v3.0.0)

```
.
├── index.js                     # Entry point — bot connect, ev handlers, dispatch
├── config.js                    # Legacy config (re-exports src/config)
├── package.json
│
├── commands/                    # Legacy shims (re-export from src/commands/)
│   ├── economy.js               # → src/commands/_economyLegacy.js
│   └── admin.js                 # → src/commands/admin/index.js
│
├── models/                      # Legacy shims (re-export from src/models/)
│   └── User.js
│
├── utils/                       # Legacy helpers (kept for backward compat)
│   ├── helpers.js
│   ├── cooldown.js
│   ├── animeFetcher.js
│   └── cardRenderer.js
│
└── src/                         # NEW v3.0.0 structure
    ├── config/
    │   ├── index.js             # Bot identity, prefix, owners
    │   ├── cooldowns.js         # All command cooldowns (single source of truth)
    │   └── constants.js         # MARRIAGE_FEE, HEIST_COOLDOWN, etc.
    │
    ├── lib/
    │   ├── auth.js              # isOwnerJid, isGroupAdminIn, isBotAdminIn
    │   ├── cooldowns.js         # handleCooldown, setCooldown (single system)
    │   ├── economy.js           # formatMoney, calculateNetWorth, calculateTax
    │   ├── queue.js             # Per-chat command queue (was global)
    │   └── ui.js                # panel(), divider(), section() helpers
    │
    ├── models/
    │   ├── User.js              # Updated: banReason/bannedBy/bannedAt/afk* in schema
    │   └── GroupSettings.js     # NEW: persistent moderation state per group
    │
    ├── data/
    │   ├── shopItems.js         # 25 buyable businesses
    │   ├── animeCards.js        # ~88 anime cards across 5 tiers
    │   ├── gifs.js              # Giphy URLs for reaction commands
    │   └── triviaFallback.js    # NEW: 30 local trivia Qs for API failure
    │
    └── commands/
        ├── _router.js           # Central dispatcher
        ├── _state.js            # Shared in-memory state (all global._* Maps)
        ├── _economyLegacy.js    # Transitional: old economy.js (6,065 lines)
        ├── economy/             # 🛠 TO BE MIGRATED in Phase 2.5:
        │   ├── money.js         #   .bal, .dep, .wd, .give, .send
        │   ├── gamble.js        #   .casino, .slots, .cf, .roulette, .dice
        │   ├── businesses.js    #   .shop, .buy, .sell, .assets, .items, .tools
        │   ├── cards.js         #   .col, .view, .burn, .claim, .auction, .bid
        │   ├── social.js        #   .marry, .divorce, .spouse, .slap, .kiss, .kill, .yeet
        │   ├── events.js        #   hacker, heist, dog race, trivia triggers
        │   └── progression.js   #   .daily, .work, .beg, .lb, .profile, .cd
        ├── games/               # 🛠 TO BE MIGRATED in Phase 2.5:
        │   ├── ttt.js
        │   ├── rps.js
        │   ├── pnt.js
        │   ├── trivia.js
        │   └── quickdraw.js
        └── admin/
            └── index.js         # Legacy admin.js (1,165 lines, transitional)
```

## 🏗️ Architecture (v3.0.0)

### Foundation (NEW in v3.0.0)

- **`src/lib/auth.js`** — Single source of truth for owner/admin checks.
  Replaces the three inconsistent helpers (`isOwnerJid`, `isBotOwner`,
  `isOwnerTarget`) that all used different JID normalization.

- **`src/lib/cooldowns.js`** — Single cooldown system. The old code had
  two parallel paths: `handleCooldown` for most commands, and
  `user.lastDailyClaim` for `.daily`. Now `.daily` uses
  `handleCooldown` too, and `.cd` accurately shows all cooldowns.

- **`src/lib/economy.js`** — Unified net-worth calculation. The old
  `calculateNetWorth()` helper in `utils/helpers.js` excluded card
  collection value; the schema virtual included it. Now there's one
  source of truth, and cards count toward net worth (matches the
  schema's intent).

- **`src/lib/queue.js`** — Per-chat command queue. The old queue was
  global — one slow group blocked every other group. Now each chat
  has its own FIFO, and the 15s timeout uses `clearTimeout` on early
  resolution (was leaking timers).

- **`src/lib/ui.js`** — Unified UI helpers. The old code defined
  `header()`, `footer()`, `successBox()`, `errorBox()`, `infoBox()`
  but never called them — every command reinvented its panel. These
  helpers now actually work.

### Persistence (NEW in v3.0.0)

- **`src/models/GroupSettings.js`** — New model that persists per-group
  moderation state: `disabled`, `antilink`, `slowmodeSeconds`,
  `addedBy`, `violationCount`. Old code kept all of this in-memory —
  bot restart = all moderation evaporated.

- **`src/models/User.js`** — Updated schema:
  - ✅ Added: `banReason`, `bannedBy`, `bannedAt`, `afk`, `afkReason`,
    `afkSince` (were set via raw-driver bypass because Mongoose strict
    mode stripped them; now declared so we can use Mongoose's normal API)
  - ❌ Removed: `isAdmin` (was declared but never set to true — dead
    field, landmine for future devs)
  - ❌ Removed: `isGroup` + `antilink` (moved to GroupSettings)

### Commands (PARTIAL — Phase 2.5 will finish)

- **`src/commands/_router.js`** — Central dispatcher. Routes admin
  commands to `src/commands/admin/`, economy commands to
  `src/commands/_economyLegacy.js` (transitional).

- **`src/commands/_state.js`** — All shared in-memory state (`global._*`
  Maps) in one place. Easy to grep, easy to migrate to MongoDB later.

- **`src/commands/_economyLegacy.js`** — The old `commands/economy.js`
  (6,065 lines), relocated with require paths updated. Will be
  progressively split into `src/commands/economy/{money,gamble,...}.js`
  in Phase 2.5.

- **`src/commands/admin/index.js`** — The old `commands/admin.js`,
  relocated. Will be split into `src/commands/admin/{moderation,economy,
  group,system}.js` in Phase 2.5.

## 🔧 Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `MONGO_URI` | Yes | MongoDB connection string |
| `PHONE_NUMBER` | Yes | WhatsApp phone number (country code + digits, e.g. `2348012345678`) |
| `BOT_GROUP_LINK` | No | Official group link shown when bot refuses unauthorized groups |
| `PORT` | No | Express server port (default 3000, for keepalive) |

## 📚 Refactor History

- **v2.0.0** — Initial commit (Phase 0 baseline)
- **v2.0.1-hotfix** — Emergency fixes (racist shop item, `.work` cooldown, loan seizure, `.about` prices, owner-only admin checks)
- **v2.1.0** — Phase 1: race conditions (atomic `$inc`), per-move timeouts, game exploits, authorization gaps
- **v3.0.0** — Phase 2: architecture refactor (foundation built; command migration deferred to Phase 2.5)

See `/home/z/my-project/REFACTOR.md` (local only, not in repo) for the
full audit findings and refactor plan.

## 📋 License

MIT
