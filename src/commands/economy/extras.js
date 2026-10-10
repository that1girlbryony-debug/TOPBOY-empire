/**
 * 🎮 src/commands/economy/extras.js — Phase 6: New Features
 *
 * New commands:
 *   .lottery          — view current lottery pot + buy tickets
 *   .lottery buy <n>  — buy N lottery tickets ($10k each)
 *   .achievements     — view your milestone badges
 *   .quest            — view daily quest + claim rewards
 *   .quote            — random motivational/criminal quote
 *   .topcards         — top 10 card collectors
 *   .inventory        — combined view of assets + cards + tools
 *   .blackjack <amt>  — classic blackjack vs dealer
 *
 * Dependencies:
 *   - User model
 *   - helpers: formatMoney, formatShort, randomInt, cleanId, calculateNetWorth
 *   - _shared: handleCooldown, createRewardXP, getNigeriaDate
 */

const User = require("../../models/User");
const { formatMoney, formatShort, randomInt, cleanId, calculateNetWorth } = require("../../../utils/helpers");
const { handleCooldown, createRewardXP, getNigeriaDate } = require("./_shared");
const animator = require("../../lib/animator");

const EXTRAS_COMMANDS = new Set([
  "lottery", "achievements", "quest", "quote", "topcards", "inventory", "blackjack"
]);

// ── Lottery state (in-memory, resets on restart) ─────────────
if (!global._lottery) {
  global._lottery = {
    pot: 0,
    tickets: [], // {userId, count}
    drawAt: Date.now() + 24 * 60 * 60 * 1000, // 24h
  };
}
const TICKET_PRICE = 10000;

// ── Achievement definitions ──────────────────────────────────
const ACHIEVEMENTS = [
  { id: "first_blood", name: "🩸 First Blood", desc: "Register your account", check: (u) => true },
  { id: "first_card", name: "🎴 Card Collector", desc: "Claim your first card", check: (u) => u.collection?.length > 0 },
  { id: "first_million", name: "💰 First Million", desc: "Reach $1M net worth", check: (u) => calculateNetWorth(u) >= 1000000 },
  { id: "first_billion", name: "🤑 Billionaire", desc: "Reach $1B net worth", check: (u) => calculateNetWorth(u) >= 1000000000 },
  { id: "card_hoarder", name: "📦 Card Hoarder", desc: "Own 25+ cards", check: (u) => u.collection?.length >= 25 },
  { id: "business_empire", name: "🏢 Business Empire", desc: "Own 10+ businesses", check: (u) => u.assets?.length >= 10 },
  { id: "high_roller", name: "🎲 High Roller", desc: "Gamble 100+ times", check: (u) => (u.totalGambles || 0) >= 100 },
  { id: "married", name: "💍 Taken", desc: "Get married", check: (u) => !!u.marriage },
  { id: "streak_7", name: "🔥 Week Warrior", desc: "7-day daily streak", check: (u) => (u.streak || 0) >= 7 },
  { id: "streak_30", name: "👑 Monthly Master", desc: "30-day daily streak", check: (u) => (u.streak || 0) >= 30 },
  { id: "level_10", name: "⭐ Double Digits", desc: "Reach level 10", check: (u) => (u.level || 0) >= 10 },
  { id: "level_50", name: "🌟 Veteran", desc: "Reach level 50", check: (u) => (u.level || 0) >= 50 },
];

// ── Quest definitions ────────────────────────────────────────
const QUESTS = [
  { id: "gamble", desc: "Play 3 gambling games", target: 3, reward: 50000, xp: 20 },
  { id: "earn", desc: "Earn $50,000 total", target: 50000, reward: 100000, xp: 30 },
  { id: "buy", desc: "Buy a business", target: 1, reward: 75000, xp: 25 },
  { id: "cards", desc: "Claim or burn a card", target: 1, reward: 50000, xp: 20 },
];

function getDailyQuest(user) {
  const today = getNigeriaDate();
  // Deterministic quest based on user ID + date (same quest all day)
  const seed = (user.userId.charCodeAt(0) + today.charCodeAt(0) + today.charCodeAt(1)) % QUESTS.length;
  return QUESTS[seed];
}

// ── Quotes ───────────────────────────────────────────────────
const QUOTES = [
  "💰 \"Money doesn't grow on trees, but it grows in the Empire.\" — Top Boy",
  "🏢 \"Buy land, they're not making it anymore.\" — Mark Twain",
  "🥷 \"The biggest risk is not taking any risk.\" — Mark Zuckerberg",
  "💎 \"Diamonds are forever. So is debt if you don't pay it.\" — Top Boy",
  "🎲 \"The house always wins. Unless you're the house.\" — Top Boy",
  "👑 \"Every empire was built one brick at a time.\" — Unknown",
  "🔥 \"Success is not final, failure is not fatal: it is the courage to continue that counts.\" — Churchill",
  "💼 \"Don't watch the clock; do what it does. Keep going.\" — Sam Levenson",
  "🚀 \"The way to get started is to quit talking and begin doing.\" — Walt Disney",
  "🎭 \"In the middle of difficulty lies opportunity.\" — Albert Einstein",
  "💪 \"The only limit to our realization of tomorrow is our doubts of today.\" — FDR",
  "🃏 \"Life is like a card game. You play the hand you're dealt.\" — Top Boy",
  "💀 \"Broke is a temporary situation. Poor is a state of mind.\" — Top Boy",
  "🏦 \"A bank is a place that will lend you money if you can prove you don't need it.\" — Bob Hope",
  "📈 \"Opportunities don't happen. You create them.\" — Chris Grosser",
];

// ── Blackjack card deck ──────────────────────────────────────
const SUITS = ["♠️", "♥️", "♦️", "♣️"];
const RANKS = ["A", "2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K"];

function drawCard() {
  const suit = SUITS[randomInt(0, 3)];
  const rank = RANKS[randomInt(0, 12)];
  let value = rank === "A" ? 11 : ["J", "Q", "K"].includes(rank) ? 10 : parseInt(rank);
  return { suit, rank, value };
}

function handValue(hand) {
  let total = hand.reduce((s, c) => s + c.value, 0);
  let aces = hand.filter(c => c.rank === "A").length;
  while (total > 21 && aces > 0) { total -= 10; aces--; }
  return total;
}

function renderHand(hand) {
  return hand.map(c => `${c.suit}${c.rank}`).join(" ");
}

async function handle(ctx) {
  const { command, args, user, sender, reply, sock, chat, msg, isGroup } = ctx;

  switch (command) {

    // =====================================================
    // 🎫 LOTTERY
    // =====================================================
    case "lottery": {
      const lottery = global._lottery;

      // .lottery buy <count>
      if (args[0]?.toLowerCase() === "buy") {
        const count = parseInt(args[1]) || 1;
        if (count < 1 || count > 50) return reply("Buy 1-50 tickets at a time.");
        const cost = count * TICKET_PRICE;
        if (user.wallet < cost) return reply(`❌ Need $${formatMoney(cost)} for ${count} tickets.`);
        user.wallet -= cost;

        // Add tickets
        const existing = lottery.tickets.find(t => t.userId === sender);
        if (existing) existing.count += count;
        else lottery.tickets.push({ userId: sender, count });

        lottery.pot += cost;
        await user.save();

        const totalTickets = lottery.tickets.reduce((s, t) => s + t.count, 0);
        const myTickets = lottery.tickets.find(t => t.userId === sender)?.count || 0;
        const odds = totalTickets > 0 ? ((myTickets / totalTickets) * 100).toFixed(1) : 0;

        return reply(
`▬▬▬▬▬▬▬▬▬▬▬▬▬▬
*🎫 LOTTERY TICKETS*
▬▬▬▬▬▬▬▬▬▬▬▬▬▬

✅ Bought: ${count} ticket${count > 1 ? "s" : ""}
💵 Cost: $${formatMoney(cost)}
🎫 Your tickets: ${myTickets}
🎯 Win chance: ${odds}%
💰 Current pot: $${formatMoney(lottery.pot)}

⏰ Draw: in ${Math.ceil((lottery.drawAt - Date.now()) / 3600000)}h

▬▬▬▬▬▬▬▬▬▬▬▬▬▬`
        );
      }

      // View lottery status
      const totalTickets = lottery.tickets.reduce((s, t) => s + t.count, 0);
      const myTickets = lottery.tickets.find(t => t.userId === sender)?.count || 0;
      const odds = totalTickets > 0 ? ((myTickets / totalTickets) * 100).toFixed(1) : "0.0";
      const hoursLeft = Math.max(0, Math.ceil((lottery.drawAt - Date.now()) / 3600000));

      return reply(
`▬▬▬▬▬▬▬▬▬▬▬▬▬▬
*🎫 TOPBOY LOTTERY*
▬▬▬▬▬▬▬▬▬▬▬▬▬▬

💰 Current pot: $${formatMoney(lottery.pot)}
🎫 Total tickets sold: ${totalTickets}
🎫 Your tickets: ${myTickets}
🎯 Your win chance: ${odds}%

💵 Ticket price: $${formatMoney(TICKET_PRICE)}
⏰ Next draw: ${hoursLeft}h

📝 *.lottery buy <count>* to enter

▬▬▬▬▬▬▬▬▬▬▬▬▬▬`
      );
    }

    // =====================================================
    // 🏆 ACHIEVEMENTS
    // =====================================================
    case "achievements": {
      const unlocked = ACHIEVEMENTS.filter(a => a.check(user));
      const locked = ACHIEVEMENTS.filter(a => !a.check(user));

      let text = `▬▬▬▬▬▬▬▬▬▬▬▬▬▬\n*🏆 ACHIEVEMENTS*\n▬▬▬▬▬▬▬▬▬▬▬▬▬▬\n\n`;
      text += `Unlocked: ${unlocked.length}/${ACHIEVEMENTS.length}\n\n`;

      text += `*✅ UNLOCKED*\n`;
      unlocked.forEach(a => { text += `${a.name}\n  ${a.desc}\n`; });

      if (locked.length > 0) {
        text += `\n*🔒 LOCKED*\n`;
        locked.forEach(a => { text += `🔒 ${a.name}\n  ${a.desc}\n`; });
      }

      text += `\n▬▬▬▬▬▬▬▬▬▬▬▬▬▬`;
      return reply(text);
    }

    // =====================================================
    // 📝 QUEST — daily quest
    // =====================================================
    case "quest": {
      const today = getNigeriaDate();
      const quest = getDailyQuest(user);

      // Check if already claimed today
      if (user.lastQuestClaim === today) {
        return reply(
`▬▬▬▬▬▬▬▬▬▬▬▬▬▬
*📝 DAILY QUEST*
▬▬▬▬▬▬▬▬▬▬▬▬▬▬

✅ Already claimed today!
Come back tomorrow for a new quest.

▬▬▬▬▬▬▬▬▬▬▬▬▬▬`
        );
      }

      // Check progress
      let progress = 0;
      if (quest.id === "gamble") progress = user.totalGambles || 0;
      else if (quest.id === "earn") progress = user.totalEarned || 0;
      else if (quest.id === "buy") progress = user.assets?.length || 0;
      else if (quest.id === "cards") progress = user.collection?.length || 0;

      const completed = progress >= quest.target;

      let text = `▬▬▬▬▬▬▬▬▬▬▬▬▬▬\n*📝 DAILY QUEST*\n▬▬▬▬▬▬▬▬▬▬▬▬▬▬\n\n`;
      text += `🎯 ${quest.desc}\n`;
      text += `📊 Progress: ${Math.min(progress, quest.target)}/${quest.target}\n\n`;

      if (completed) {
        text += `✅ Quest complete!\n`;
        text += `💰 Reward: $${formatMoney(quest.reward)}\n`;
        text += `⭐ XP: +${quest.xp}\n\n`;
        text += `Type *.quest* to claim!\n`;

        // Auto-claim since they're viewing
        user.wallet += quest.reward;
        user.lastQuestClaim = today;
        const rewardXP = createRewardXP({ user, command: "quest" });
        await rewardXP();
        await user.save();

        text = text.replace("Type *.quest* to claim!", "🎁 *Reward claimed!*");
      } else {
        text += `⏳ Keep going to earn $${formatMoney(quest.reward)} + ${quest.xp} XP`;
      }

      text += `\n▬▬▬▬▬▬▬▬▬▬▬▬▬▬`;
      return reply(text);
    }

    // =====================================================
    // 💬 QUOTE — random motivational quote
    // =====================================================
    case "quote": {
      const quote = QUOTES[randomInt(0, QUOTES.length - 1)];
      return reply(
`▬▬▬▬▬▬▬▬▬▬▬▬▬▬
*💬 EMPIRE WISDOM*
▬▬▬▬▬▬▬▬▬▬▬▬▬▬

${quote}

▬▬▬▬▬▬▬▬▬▬▬▬▬▬`
      );
    }

    // =====================================================
    // 🃏 TOP CARDS — top 10 card collectors
    // =====================================================
    case "topcards": {
      const users = await User.find({}, "userId collection");
      const sorted = users
        .map(u => ({ userId: u.userId, count: (u.collection || []).length }))
        .sort((a, b) => b.count - a.count)
        .slice(0, 10);

      const medals = ["👑", "🥈", "🥉", "4️⃣", "5️⃣", "6️⃣", "7️⃣", "8️⃣", "9️⃣", "🔟"];

      let text = `▬▬▬▬▬▬▬▬▬▬▬▬▬▬\n*🃏 TOP 10 CARD COLLECTORS*\n▬▬▬▬▬▬▬▬▬▬▬▬▬▬\n`;

      sorted.forEach((u, i) => {
        const medal = medals[i] || `${i + 1}.`;
        const name = u.userId.split("@")[0];
        text += `\n${medal} ${name}\n   🎴 ${u.count} cards\n`;
      });

      text += `\n▬▬▬▬▬▬▬▬▬▬▬▬▬▬`;
      return reply(text);
    }

    // =====================================================
    // 📦 INVENTORY — combined view
    // =====================================================
    case "inventory": {
      const totalAssetValue = (user.assets || []).reduce((s, a) => s + (a.price || 0), 0);
      const totalCardValue = (user.collection || []).reduce((s, c) => s + (c.worth || 0), 0);
      const totalIncome = (user.assets || []).reduce((s, a) => s + (a.income || 0), 0);

      let text = `▬▬▬▬▬▬▬▬▬▬▬▬▬▬\n*📦 INVENTORY*\n▬▬▬▬▬▬▬▬▬▬▬▬▬▬\n\n`;

      text += `*💰 MONEY*\n`;
      text += `💵 Wallet: $${formatMoney(user.wallet || 0)}\n`;
      text += `🏦 Bank: $${formatMoney(user.bank || 0)}\n`;
      text += `💳 Debt: $${formatMoney(user.debt || 0)}\n\n`;

      text += `*🏢 BUSINESSES (${user.assets?.length || 0})*\n`;
      if (user.assets?.length) {
        user.assets.slice(0, 5).forEach((a, i) => {
          text += `  ${i + 1}. ${a.name} ($${formatShort(a.income)}/d)\n`;
        });
        if (user.assets.length > 5) text += `  ...and ${user.assets.length - 5} more\n`;
        text += `  📊 Total value: $${formatShort(totalAssetValue)}\n`;
        text += `  📈 Daily income: $${formatShort(totalIncome)}\n`;
      } else { text += `  📭 None\n`; }
      text += `\n`;

      text += `*🎴 CARDS (${user.collection?.length || 0})*\n`;
      if (user.collection?.length) {
        const tierCount = {};
        user.collection.forEach(c => { tierCount[c.tier] = (tierCount[c.tier] || 0) + 1; });
        Object.entries(tierCount).forEach(([tier, count]) => {
          const emoji = { Common: "⚪", Rare: "🔵", Epic: "🟣", Legendary: "🟡", Mythic: "🔴" }[tier] || "⚪";
          text += `  ${emoji} ${tier}: ${count}\n`;
        });
        text += `  💎 Total value: $${formatShort(totalCardValue)}\n`;
      } else { text += `  📭 None\n`; }
      text += `\n`;

      text += `*🛠 TOOLS*\n`;
      text += `  🛡 Shields: ${user.tools?.shield || 0}\n`;
      text += `  🔫 Guns: ${user.tools?.gun || 0}\n\n`;

      text += `*📊 SUMMARY*\n`;
      text += `  💎 Net Worth: $${formatMoney(calculateNetWorth(user))}\n`;
      text += `  ⭐ Level: ${user.level || 1}\n`;
      text += `  🔥 Streak: ${user.streak || 0} days\n`;

      text += `\n▬▬▬▬▬▬▬▬▬▬▬▬▬▬`;
      return reply(text);
    }

    // =====================================================
    // 🃏 BLACKJACK
    // =====================================================
    case "blackjack": {
      const bet = parseInt(args[0]);
      if (isNaN(bet) || bet <= 0) return reply("Usage: .blackjack <amount>");
      if (user.wallet < bet) return reply("❌ Not enough wallet funds.");
      if (await handleCooldown(user, "blackjack", reply)) return true;

      // Deal initial hands
      const playerHand = [drawCard(), drawCard()];
      const dealerHand = [drawCard(), drawCard()];
      const playerTotal = handValue(playerHand);
      const dealerTotal = handValue(dealerHand);

      // Check for natural blackjack
      if (playerTotal === 21) {
        const payout = Math.floor(bet * 2.5); // 3:2 payout + original bet
        user.wallet += payout - bet;
        const rewardXP = createRewardXP({ user, command: "blackjack" });
        await rewardXP();
        await user.save();

        // 🎨 Task 18: dealing animation on felt (cached per hand+outcome)
        let resultPng = null;
        try {
          resultPng = await animator.renderBlackjack({
            player: playerHand, dealer: dealerHand,
            playerTotal, dealerTotal, outcome: "blackjack",
          });
        } catch (e) { console.log("blackjack anim failed:", e.message); }

        return animator.sendResult(sock, chat, resultPng,
`▬▬▬▬▬▬▬▬▬▬▬▬▬▬
*🃏 BLACKJACK!*
▬▬▬▬▬▬▬▬▬▬▬▬▬▬

🎉 Natural Blackjack!

Your hand: ${renderHand(playerHand)} (${playerTotal})
Dealer: ${renderHand(dealerHand)} (${dealerTotal})

💰 Won: $${formatMoney(payout - bet)}
💵 (3:2 payout)

▬▬▬▬▬▬▬▬▬▬▬▬▬▬`, msg);
      }

      // Hit until 17 (simplified — no hit/stand interaction)
      // Auto-play: hit if ≤ 16, stand if ≥ 17
      let currentHand = [...playerHand];
      let currentTotal = playerTotal;

      while (currentTotal < 17) {
        const card = drawCard();
        currentHand.push(card);
        currentTotal = handValue(currentHand);
      }

      // Check if player busted
      if (currentTotal > 21) {
        user.wallet -= bet;
        await user.save();

        let resultPng = null;
        try {
          resultPng = await animator.renderBlackjack({
            player: currentHand, dealer: dealerHand,
            playerTotal: currentTotal, dealerTotal,
            outcome: "bust",
          });
        } catch (e) { console.log("blackjack anim failed:", e.message); }

        return animator.sendResult(sock, chat, resultPng,
`▬▬▬▬▬▬▬▬▬▬▬▬▬▬
*🃏 BLACKJACK — BUST!*
▬▬▬▬▬▬▬▬▬▬▬▬▬▬

Your hand: ${renderHand(currentHand)} (${currentTotal})
💀 BUSTED!

📉 Lost: $${formatMoney(bet)}

▬▬▬▬▬▬▬▬▬▬▬▬▬▬`, msg);
      }

      // Dealer plays (hit until ≥ 17)
      let dealerCurrent = [...dealerHand];
      let dealerCurrentTotal = dealerTotal;

      while (dealerCurrentTotal < 17) {
        const card = drawCard();
        dealerCurrent.push(card);
        dealerCurrentTotal = handValue(dealerCurrent);
      }

      // Determine winner
      const dealerBust = dealerCurrentTotal > 21;
      const playerWins = dealerBust || currentTotal > dealerCurrentTotal;
      const push = currentTotal === dealerCurrentTotal;

      const rewardXP = createRewardXP({ user, command: "blackjack" });
      await rewardXP();

      let resultText, payout;
      if (push) {
        payout = 0; // refund
        resultText = "🤝 PUSH! Stakes returned.";
      } else if (playerWins) {
        payout = bet; // 1:1 profit
        user.wallet += payout;
        resultText = `🎉 YOU WIN! +$${formatMoney(payout)}`;
      } else {
        payout = -bet;
        user.wallet -= bet;
        resultText = `💀 Dealer wins. -$${formatMoney(bet)}`;
      }

      await user.save();

      const bjOutcome = push ? "push" : playerWins ? "win" : "lose";
      let resultPng = null;
      try {
        resultPng = await animator.renderBlackjack({
          player: currentHand, dealer: dealerCurrent,
          playerTotal: currentTotal, dealerTotal: dealerCurrentTotal,
          outcome: bjOutcome,
        });
      } catch (e) { console.log("blackjack anim failed:", e.message); }

      return animator.sendResult(sock, chat, resultPng,
`▬▬▬▬▬▬▬▬▬▬▬▬▬▬
*🃏 BLACKJACK*
▬▬▬▬▬▬▬▬▬▬▬▬▬▬

Your hand: ${renderHand(currentHand)} (${currentTotal})
Dealer: ${renderHand(dealerCurrent)} (${dealerCurrentTotal})

${dealerBust ? "💀 Dealer busted!\n" : ""}${resultText}

💰 Bet: $${formatMoney(bet)}

▬▬▬▬▬▬▬▬▬▬▬▬▬▬`, msg);
    }

    default:
      return false;
  }
}

module.exports = {
  handle,
  EXTRAS_COMMANDS,
  ACHIEVEMENTS,
  QUOTES,
};
