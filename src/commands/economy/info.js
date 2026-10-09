/**
 * 🛠 src/commands/economy/info.js — Phase 2.5 batch 4
 *
 * Migrated from _economyLegacy.js:
 *   .menu / .help — category-based command menu (with image)
 *   .about         — full manual / what's new
 *   .test          — bot status (latency, RAM, uptime)
 *   .debug         — JID/admin detection troubleshooting dump
 *   .afk           — mark yourself away with a reason
 *
 * These are the simplest commands — no shared state, no cooldowns,
 * no gamble limits. .menu/.help/.about don't even need a registered
 * user (index.js allows unregistered users to call them).
 *
 * Dependencies:
 *   - User model (for .afk raw-driver write)
 *   - helpers: formatMoney, normalizeJid
 *   - _shared: MARRIAGE_FEE (for .about text)
 *
 * The menuCategories object is defined at module level here (was
 * inline in the legacy file at line 2728).
 */

const User = require("../../models/User");
const { formatMoney, normalizeJid } = require("../../utils/helpers");
const { MARRIAGE_FEE } = require("./_shared");

const INFO_COMMANDS = new Set(["menu", "help", "about", "test", "debug", "afk"]);

// ── Menu categories (centralized here, was inline in legacy) ──────
const menuCategories = {
  money: {
    label: "💰 MONEY",
    body: ".bal — check balance\n.daily — claim daily reward\n.beg — small free cash\n.work — another way to earn\n.dep / .wd <amt> — bank\n.send <amt> @user — transfer"
  },
  empire: {
    label: "🏢 EMPIRE",
    body: ".shop — browse businesses\n.buy <id> — invest\n.sell <index/all> — cash out\n.assets — your businesses\n.loan / .payloan"
  },
  gambling: {
    label: "🎰 GAMBLING",
    body: ".casino <amt>\n.slots <amt>\n.cf <h/t> <amt> — coin flip\n.roulette <pick> <amt>\n.dice @user <amt>\n\n⚠️ These have a house edge —\nplay for fun, not to get rich."
  },
  games: {
    label: "🎮 MINI GAMES",
    body: ".ttt @user <bet> — X and O\n.move <1-9> — play your X&O turn\n.rps @user <bet> — Rock Paper Scissors\n  (after accept, DM me *ready* to get\n  your private move — I can't DM first!)\n.dogbet <dog#> <bet> — bet on a race\n.pnt — start Police & Thief lobby\n.pntjoin — join an open lobby\n  (DM me *ready* to get your role)\n\n🐕 Dog races auto-run ~every 2 hours\n⚡ Watch chat for Quick Draw —\nrandom word race, free cash."
  },
  cards: {
    label: "🎴 CARDS",
    body: ".claim — grab a dropped card\n.col — your collection\n.view <index> — see a card\n.give <index> @user — gift\n.trade @user <yours> <theirs>\n.fuse <i1> <i2> <i3> — combine 3\nsame-tier cards into 1 stronger one\n.burn <index/all> — cash in"
  },
  market: {
    label: "🏆 MARKET",
    body: ".auction <index> <min> — sell\n.bid <amount> — bid on one"
  },
  warzone: {
    label: "💣 WAR ZONE",
    body: ".rob @user\n.heist @user — team robbery\n.join / .protect — pick a side\n.bail @user — spouse only"
  },
  social: {
    label: "💍 SOCIAL",
    body: ".marry @user / .divorce\n.spouse — relationship status\n.slap .kill .yeet .kiss .fuck"
  },
  other: {
    label: "❓ OTHER",
    body: ".profile — your card\n.qa — trivia\n.cd — cooldowns\n.lb — leaderboard\n.afk <reason> — go AFK\n.about — full manual"
  }
};

async function handle(ctx) {
  const { command, args, sender, reply, sock, chat, msg, isGroup } = ctx;

  switch (command) {

    // =====================================================
    // 🌆 MENU / HELP — category-based
    // =====================================================
    case "menu":
    case "help": {
      const catArg = args[0]?.toLowerCase();
      const categoryList = Object.keys(menuCategories);
      const catNumber = parseInt(catArg);
      const resolvedCat = !isNaN(catNumber) ? categoryList[catNumber - 1] : catArg;

      if (resolvedCat && menuCategories[resolvedCat]) {
        const cat = menuCategories[resolvedCat];
        return reply(
`▬▬▬▬▬▬▬▬▬▬▬▬▬▬
*${cat.label}*
▬▬▬▬▬▬▬▬▬▬▬▬▬▬

${cat.body}



Type *.menu* to go back.
▬▬▬▬▬▬▬▬▬▬▬▬▬▬`
        );
      }

      const menuText =
`▬▬▬▬▬▬▬▬▬▬▬▬▬▬
*🌆 TOPBOY EMPIRE 2.0*
▬▬▬▬▬▬▬▬▬▬▬▬▬▬

Pick a category:

${categoryList.map((key, i) => `${i + 1}. ${menuCategories[key].label}`).join("\n")}

Type *.menu <number or name>*
e.g. *.menu 3* or *.menu gambling*

✨ NEW: mini games, hacker
events, Quick Draw — type
*.about* to see what's new.
`;

      // Try sending with image, fallback to text
      try {
        const fs = require("fs");
        if (fs.existsSync("./data/menu.jpg")) {
          return sock.sendMessage(chat, {
            image: fs.readFileSync("./data/menu.jpg"),
            caption: menuText
          }, { quoted: msg });
        }
      } catch {}

      return reply(menuText);
    }

    // =====================================================
    // 📘 ABOUT — full manual
    // =====================================================
    case "about": {
      return reply(
`**TOPBOY EMPIRE 2.0**

✨ WHAT'S NEW IN 2.0 ✨
• 💻 Hacker events — the richest
  player can get targeted, type
  .defend to help stop it
• ❌⭕ X and O — wager a friend
  with .ttt @user <bet>
• ⚡ Quick Draw — free reaction
  game, random in group chat
• 🎯 Fairer gambling odds + a
  smarter tax system
• 🏢 Business ownership caps so
  one person can't buy the
  whole market

▬▬▬▬▬▬▬▬▬▬▬▬

Welcome to TopBoy Empire 👑

This is a WhatsApp economy + anime card game.
You earn money, build businesses, collect rare cards,
rob people (carefully), gamble, and dominate the leaderboard.

▬▬▬▬▬▬▬▬▬▬▬▬
💰 HOW TO MAKE MONEY

1️⃣ .daily
Claim free money every day.
You also earn money from:
• Your businesses
• Bank interest
• (tax kicks in the more you earn — the more
  you make in one go, the higher the % taken)

2️⃣ .beg
Small random money (cooldown applies).

3️⃣ Gambling
.casino  .slots  .cf  .roulette

These all have a house edge now — you CAN win big,
but the house wins more often on average. Play for fun,
not as a get-rich strategy.

▬▬▬▬▬▬▬▬▬▬▬▬
🏢 BUSINESSES (Passive Income)

.shop → see businesses
.buy id → buy one
.sell index → sell one

Each business gives DAILY income.
⚠️ Max 3 of the same business, 20 total —
this stops one person owning the whole market.

▬▬▬▬▬▬▬▬▬▬▬▬
🎴 ANIME CARD SYSTEM

Sometimes a card drops in the group.
First to type .claim gets it.

.col → see your cards
.view index → see card image

Tiers: Common → Rare → Epic → Legendary → Mythic

▬▬▬▬▬▬▬▬▬▬▬▬
🏦 BANK SYSTEM

.dep amount → move money to bank
.wd amount → withdraw

▬▬▬▬▬▬▬▬▬▬▬▬
🥷 ROBBING & HEISTS

.rob @user — 50% chance, risk/reward
.heist @user — team robbery (80s)

▬▬▬▬▬▬▬▬▬▬▬▬
💻 HACKER EVENTS (NEW)

About twice a day, whoever is #1 on the leaderboard
(same net worth ranking as .lb) gets hacked — no
warning, no defending. 95% of the time they lose
exactly half their businesses. The other 5%? Pure
luck, nothing happens. Being #1 makes you the target.

▬▬▬▬▬▬▬▬▬▬▬▬
🎮 MINI GAMES (NEW)

.ttt @user <bet> — Challenge someone to X and O
  (.accept / .reject, then .move <1-9>)

.rps @user <bet> — Rock Paper Scissors
  (.accept / .reject in the group, then DM me
  *ready* — I can't message you first, WhatsApp
  doesn't allow bots to DM unprompted. Once you
  say ready I'll send your private move prompt.
  Nobody can see or copy your pick. Result
  reveals in the group.)

🐕 Dog Race — runs automatically ~every 2 hours,
or an admin can force one with .race. Everyone bets
with .dogbet <dog#> <amount>, then watch it play out!

🚔 Police & Thief — anyone starts one with .pnt,
others join with .pntjoin (3+ players). Once it
starts, DM me *ready* to get your secret role
(Police, Thief, or Civilian) — same rule, I can't
DM you first. Each of the 3 rounds, check your DMs
and pick a location to hide/rob/defend. Results
reveal in the group after each round. Highest score
after 3 rounds wins (ties possible — more than one
winner!).

⚡ Quick Draw — random word drops in chat,
first to type it wins free cash, no bet needed.

▬▬▬▬▬▬▬▬▬▬▬▬
💍 MARRY SYSTEM

.marry @user — costs $${formatMoney(MARRIAGE_FEE)}
.divorce — costs $${formatMoney(50000000)}
.spouse — check status

▬▬▬▬▬▬▬▬▬▬▬▬
❓ Q&A

.qa question — ask the group
.qa — see and answer questions

▬▬▬▬▬▬▬▬▬▬▬▬
⚔ FUN COMMANDS

.slap  .kill  .yeet  .kiss  .fuck

▬▬▬▬▬▬▬▬▬▬▬▬
🎯 OBJECTIVE

• Get rich
• Collect rare anime cards
• Build business empire
• Dominate leaderboard
• Flex on everyone

Type .menu to start.`
      );
    }

    // =====================================================
    // 🧪 TEST — bot status ping
    // =====================================================
    case "test": {
      const start = Date.now();

      await sock.sendMessage(chat, {
        text: "🏓 *Pinging...*"
      }, { quoted: msg });

      const latency = Date.now() - start;
      const ram = (process.memoryUsage().heapUsed / 1024 / 1024).toFixed(1);
      const uptime = process.uptime();
      const hours = Math.floor(uptime / 3600);
      const mins = Math.floor((uptime % 3600) / 60);

      return reply(
`▬▬▬▬▬▬▬▬▬▬▬▬▬▬
*⚡ BOT STATUS*
▬▬▬▬▬▬▬▬▬▬▬▬▬▬
✅ Online & Running

⏱ Latency: ${latency}ms
🧠 RAM: ${ram} MB
⏳ Uptime: ${hours}h ${mins}m
👑 TopBoy Empire v2.0

▬▬▬▬▬▬▬▬▬▬▬▬▬▬`
      );
    }

    // =====================================================
    // 🔍 DEBUG — JID/admin detection dump
    // =====================================================
    case "debug": {
      if (!isGroup) return reply("Group only.");

      const metadata = await sock.groupMetadata(chat);
      const botRawId = sock.user.id;
      const botNorm = normalizeJid(botRawId);

      const userKeys = Object.keys(sock.user).join(", ");
      const botInGroup = metadata.participants.find(p => normalizeJid(p.id) === botNorm);
      const botLid = sock.user.lid || "not set";

      let text = `🔍 BOT DEBUG\n\n`;
      text += `sock.user keys: ${userKeys}\n`;
      text += `sock.user.id: ${botRawId}\n`;
      text += `sock.user.lid: ${botLid}\n`;
      text += `sock.user.name: ${sock.user.name || "N/A"}\n`;
      text += `Bot normalized: ${botNorm}\n`;
      text += `Bot in group (phone match): ${botInGroup ? "YES → " + botInGroup.admin : "NO"}\n`;

      if (botLid !== "not set") {
        const lidNorm = normalizeJid(botLid);
        const lidMatch = metadata.participants.find(p => normalizeJid(p.id) === lidNorm);
        text += `Bot in group (lid match): ${lidMatch ? "YES → " + lidMatch.admin : "NO"}\n`;
      }

      try {
        const { state } = await require("@whiskeysockets/baileys").useMultiFileAuthState("./auth");
        const creds = state.creds;
        text += `\nAuth registered: ${creds.registered}\n`;
        text += `Auth me.id: ${creds.me?.id || "N/A"}\n`;
        text += `Auth me.lid: ${creds.me?.lid || "N/A"}\n`;

        if (creds.me?.lid) {
          const authLidNorm = normalizeJid(creds.me.lid);
          const authMatch = metadata.participants.find(p => normalizeJid(p.id) === authLidNorm);
          text += `Bot in group (auth lid): ${authMatch ? "YES → " + authMatch.admin : "NO"}\n`;
        }
      } catch (e) {
        text += `\nAuth state error: ${e.message}\n`;
      }

      text += `\n--- Admins in group ---\n`;
      for (const p of metadata.participants) {
        if (p.admin === "admin" || p.admin === "superadmin") {
          text += `${p.id} → ${p.admin}\n`;
        }
      }

      return reply(text);
    }

    // =====================================================
    // 💤 AFK — mark yourself away
    // =====================================================
    case "afk": {
      const reason = args.join(" ").trim() || "No reason given";
      const afkSince = Date.now();

      // 🛠 FIX: write through raw MongoDB driver — Mongoose schema
      // layer was silently dropping afk/afkReason/afkSince since
      // they weren't declared fields. (Now they ARE in the schema
      // thanks to Phase 2.3, but we keep the raw-driver write for
      // backward compat — it's still the most reliable path.)
      await User.collection.updateOne(
        { userId: sender },
        { $set: { afk: true, afkReason: reason, afkSince } }
      );

      return reply(
`▬▬▬▬▬▬▬▬▬▬▬▬▬▬
*💤 AFK MODE ON*
▬▬▬▬▬▬▬▬▬▬▬▬▬▬

Reason: ${reason}

I'll let people know if they tag you.
Just send any message to come back.

▬▬▬▬▬▬▬▬▬▬▬▬▬▬`
      );
    }

    default:
      return false; // not handled
  }
}

module.exports = {
  handle,
  INFO_COMMANDS,
  // Export menuCategories for potential use by other modules
  menuCategories,
};
