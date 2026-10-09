/**
 * 🛠 src/commands/economy/transactions.js — Phase 2.5 batch 5
 *
 * Migrated from _economyLegacy.js:
 *   .loan         — take a loan against an asset (80% of price, 10% interest, 24h due)
 *   .payloan      — repay loan (full or partial); returns collateral when cleared
 *   .bail         — spouse-only: bail your partner out of jail
 *   .trade        — propose a 1-for-1 card swap
 *   .tradeaccept  — accept a pending trade
 *   .tradereject  — reject a pending trade
 *   .fuse         — combine 3 same-tier cards into 1 of the next tier up
 *   .rob          — rob another player (gun/shield/normal mechanics)
 *
 * Shared state:
 *   - global._tradeProposals Map (chat → {from, to, fromIndex, toIndex, expiresAt})
 *
 * Dependencies (via _shared.js):
 *   - handleCooldown, createRewardXP
 *
 * Also uses:
 *   - User model
 *   - helpers: formatMoney, randomInt
 *   - animeFetcher: fetchRandomCharacter (for .fuse new card generation)
 *   - data/animeCards (fallback for .fuse)
 */

const User = require("../../models/User");
const { formatMoney, randomInt } = require("../../utils/helpers");
const { fetchRandomCharacter } = require("../../utils/animeFetcher");
const animeCards = require("../../data/animeCards");
const {
  handleCooldown,
  createRewardXP,
} = require("./_shared");

const TRANSACTION_COMMANDS = new Set([
  "loan", "payloan", "bail",
  "trade", "tradeaccept", "tradereject",
  "fuse", "rob"
]);

// ── Card tier constants (for .fuse) ──────────────────────────
const CARD_TIER_ORDER = ["Common", "Rare", "Epic", "Legendary", "Mythic"];
const CARD_TIER_RANGES = {
  Common: [150000, 750000],
  Rare: [700000, 1500000],
  Epic: [2000000, 5000000],
  Legendary: [6000000, 12000000],
  Mythic: [15000000, 25000000]
};

async function handle(ctx) {
  const { command, args, user, sender, reply, msg, isGroup } = ctx;

  switch (command) {

    // =====================================================
    // 💳 LOAN
    // =====================================================
    case "loan": {
      if (!user.assets.length)
        return reply(
`▬▬▬▬▬▬▬▬▬▬▬▬▬▬
*💳 LOAN*
▬▬▬▬▬▬▬▬▬▬▬▬▬▬

❌ You need an asset
   to take a loan.

💡 Buy one from *.shop*

▬▬▬▬▬▬▬▬▬▬▬▬▬▬`
        );

      if (!args[0]) {
        let text = `▬▬▬▬▬▬▬▬▬▬▬▬▬▬\n*💳 AVAILABLE LOANS*\n▬▬▬▬▬▬▬▬▬▬▬▬▬▬\n\n▬▬▬▬▬▬▬▬▬▬▬▬▬▬`;

        user.assets.forEach((a, i) => {
          const loanValue = Math.floor(a.price * 0.8);
          text += `\n${i + 1}. ${a.name}\n   💳 Loan: $${formatMoney(loanValue)}\n`;
        });

        text += `\n📝 *.loan <index>* to borrow\n`;
        return reply(text);
      }

      const index = parseInt(args[0]) - 1;
      const asset = user.assets[index];

      if (!asset)
        return reply("Invalid asset index.");

      if (user.debt > 0)
        return reply("Pay existing loan first.");

      const loanAmount = Math.floor(asset.price * 0.8);

      user.wallet += loanAmount;
      user.debt = Math.floor(loanAmount * 1.1);
      user.loanAsset = asset;
      user.loanDue = Date.now() + 24 * 60 * 60 * 1000;

      user.assets.splice(index, 1);

      await user.save();

      return reply(
`▬▬▬▬▬▬▬▬▬▬▬▬▬▬
*💳 LOAN APPROVED*
▬▬▬▬▬▬▬▬▬▬▬▬▬▬

💵 Received: $${formatMoney(loanAmount)}
💳 Repay: $${formatMoney(user.debt)}
⏳ Due: 24 hours

⚠️ Fail to repay and
   you lose the asset!

▬▬▬▬▬▬▬▬▬▬▬▬▬▬`
      );
    }

    // =====================================================
    // 💰 PAY LOAN
    // =====================================================
    case "payloan": {
      if (user.debt <= 0)
        return reply("You have no active loan.");

      let amount;

      if (!args[0]) {
        amount = user.debt;
      } else {
        amount = parseInt(args[0]);
        if (isNaN(amount) || amount <= 0)
          return reply("Usage: .payloan [amount]");
      }

      if (amount > user.debt)
        amount = user.debt;

      if (user.wallet < amount)
        return reply("Not enough wallet funds.");

      user.wallet -= amount;
      user.debt -= amount;

      if (user.debt <= 0) {
        user.debt = 0;

        if (user.loanAsset) {
          user.assets.push(user.loanAsset);
        }

        user.loanAsset = null;
        user.loanDue = null;

        await user.save();
        return reply(
`▬▬▬▬▬▬▬▬▬▬▬▬▬▬
*💰 LOAN REPAID*
▬▬▬▬▬▬▬▬▬▬▬▬▬▬

✅ Fully cleared!
🏢 Asset returned.
💵 Wallet: $${formatMoney(user.wallet)}

▬▬▬▬▬▬▬▬▬▬▬▬▬▬`
        );
      }

      await user.save();
      return reply(
`▬▬▬▬▬▬▬▬▬▬▬▬▬▬
*💰 LOAN PAYMENT*
▬▬▬▬▬▬▬▬▬▬▬▬▬▬

💵 Paid: $${formatMoney(amount)}
💳 Remaining: $${formatMoney(user.debt)}


▬▬▬▬▬▬▬▬▬▬▬▬▬▬`
      );
    }

    // =====================================================
    // 🚔 BAIL (SPOUSE ONLY)
    // =====================================================
    case "bail": {
      const target = msg.message?.extendedTextMessage?.contextInfo?.mentionedJid?.[0];

      if (!target)
        return reply("Usage: .bail @user");

      if (target === sender)
        return reply("❌ You cannot bail yourself out.");

      const jailedUser = await User.findOne({ userId: target });

      if (!jailedUser || !jailedUser.jailUntil || jailedUser.jailUntil <= Date.now())
        return reply("❌ That user is not in jail.");

      if (!user.marriage || user.marriage.spouseId !== target)
        return reply("❌ Only your spouse can bail you out! 💍");

      const totalMoney = (jailedUser.wallet || 0) + (jailedUser.bank || 0);

      let bailCost = Math.floor(totalMoney * 0.10); // 10% of total wealth

      if (bailCost < 10000000)
        bailCost = 10000000;

      if (user.wallet < bailCost)
        return reply(`❌ You need $${formatMoney(bailCost)} to bail them out.`);

      user.wallet -= bailCost;
      jailedUser.jailUntil = null;

      await user.save();
      await jailedUser.save();

      return reply(
`▬▬▬▬▬▬▬▬▬▬▬▬▬▬
*🚔 BAIL PAID*
▬▬▬▬▬▬▬▬▬▬▬▬▬▬

👤 @${target.split("@")[0]} is free!
💰 Cost: $${formatMoney(bailCost)}

💍 True love indeed 💎

▬▬▬▬▬▬▬▬▬▬▬▬▬▬`,
        [target]
      );
    }

    // =====================================================
    // 🔁 TRADE — propose a 1-for-1 card swap
    // =====================================================
    case "trade": {
      const target =
        msg.message?.extendedTextMessage?.contextInfo?.participant ||
        msg.message?.extendedTextMessage?.contextInfo?.mentionedJid?.[0];
      const yourIndex = parseInt(args[1]) - 1;
      const theirIndex = parseInt(args[2]) - 1;

      if (!target || isNaN(yourIndex) || isNaN(theirIndex))
        return reply("Usage: .trade @user <your card #> <their card #>\ne.g. .trade @friend 2 5");

      if (target === sender) return reply("🚫 You can't trade with yourself.");

      if (global._tradeProposals.has(chat))
        return reply("⚠️ A trade is already pending in this chat.");

      const yourCard = user.collection[yourIndex];
      if (!yourCard) return reply("❌ Invalid card # in YOUR collection. Check with .col");

      const targetUser = await User.findOne({ userId: target });
      if (!targetUser) return reply("❌ That user isn't registered.");

      const theirCard = targetUser.collection?.[theirIndex];
      if (!theirCard) return reply("❌ Invalid card # in THEIR collection.");

      global._tradeProposals.set(chat, {
        from: sender,
        to: target,
        fromIndex: yourIndex,
        toIndex: theirIndex,
        expiresAt: Date.now() + 60000
      });

      setTimeout(() => {
        const t = global._tradeProposals.get(chat);
        if (t && t.from === sender && t.to === target) {
          global._tradeProposals.delete(chat);
        }
      }, 60000);

      return reply(
`▬▬▬▬▬▬▬▬▬▬▬▬▬▬
*🔁 TRADE OFFER*
▬▬▬▬▬▬▬▬▬▬▬▬▬▬

@${sender.split("@")[0]} offers:
🃏 ${yourCard.name} (${yourCard.tier})

for @${target.split("@")[0]}'s:
🃏 ${theirCard.name} (${theirCard.tier})

✅ *.tradeaccept*  ❌ *.tradereject*
⏳ 60 seconds

▬▬▬▬▬▬▬▬▬▬▬▬▬▬`,
        [sender, target]
      );
    }

    // =====================================================
    // ✅ TRADE ACCEPT
    // =====================================================
    case "tradeaccept": {
      const t = global._tradeProposals.get(chat);
      if (!t) return reply("❌ No pending trade in this chat.");
      if (sender !== t.to) return reply("🚫 Only the trade recipient can accept.");

      global._tradeProposals.delete(chat);

      const fromUser = await User.findOne({ userId: t.from });
      const toUser = await User.findOne({ userId: t.to });
      if (!fromUser || !toUser) return reply("❌ Trade failed — a user wasn't found.");

      const fromCard = fromUser.collection?.[t.fromIndex];
      const toCard = toUser.collection?.[t.toIndex];
      if (!fromCard || !toCard)
        return reply("❌ Trade failed — one of the cards no longer exists (sold/traded already?).");

      fromUser.collection.splice(t.fromIndex, 1);
      toUser.collection.splice(t.toIndex, 1);
      fromUser.collection.push(toCard);
      toUser.collection.push(fromCard);

      // 🛠 Phase 2.5: use createRewardXP for the fromUser (the proposer)
      const rewardXP = createRewardXP({ user: fromUser, command: "trade" });
      await rewardXP();
      await fromUser.save();
      await toUser.save();

      return reply(
`▬▬▬▬▬▬▬▬▬▬▬▬▬▬
*✅ TRADE COMPLETE*
▬▬▬▬▬▬▬▬▬▬▬▬▬▬

@${t.from.split("@")[0]} got ${toCard.name}
@${t.to.split("@")[0]} got ${fromCard.name}

▬▬▬▬▬▬▬▬▬▬▬▬▬▬`,
        [t.from, t.to]
      );
    }

    // =====================================================
    // ❌ TRADE REJECT
    // =====================================================
    case "tradereject": {
      const t = global._tradeProposals.get(chat);
      if (!t) return reply("❌ No pending trade in this chat.");
      if (sender !== t.to) return reply("🚫 Only the trade recipient can reject.");

      global._tradeProposals.delete(chat);
      return reply("❌ Trade rejected.");
    }

    // =====================================================
    // 🔮 FUSE — combine 3 same-tier cards into 1 of the next tier up
    // =====================================================
    case "fuse": {
      if (args.length < 3)
        return reply("Usage: .fuse <index1> <index2> <index3>\nFuses 3 same-tier cards into 1 of the next tier up.");

      const idxs = [...new Set(args.slice(0, 3).map(a => parseInt(a) - 1))];
      if (idxs.length < 3 || idxs.some(isNaN))
        return reply("❌ Pick 3 DIFFERENT valid card numbers from .col");

      const cards = idxs.map(i => user.collection[i]);
      if (cards.some(c => !c))
        return reply("❌ Invalid card index. Check with .col");

      const tier = cards[0].tier;
      if (!cards.every(c => c.tier === tier))
        return reply("❌ All 3 cards must be the SAME tier to fuse.");

      const tierIndex = CARD_TIER_ORDER.indexOf(tier);
      if (tierIndex === -1 || tierIndex === CARD_TIER_ORDER.length - 1)
        return reply("❌ Mythic cards are already max tier — nothing to fuse into.");

      const nextTier = CARD_TIER_ORDER[tierIndex + 1];
      const [min, max] = CARD_TIER_RANGES[nextTier];
      const worth = randomInt(min, max);

      // Remove highest index first so splicing doesn't shift the others
      const sortedDesc = [...idxs].sort((a, b) => b - a);
      for (const i of sortedDesc) user.collection.splice(i, 1);

      let newCard = null;
      try {
        const apiChar = await fetchRandomCharacter();
        if (apiChar?.name && apiChar?.image) {
          newCard = { name: apiChar.name, image: apiChar.image, tier: nextTier, worth };
        }
      } catch {}
      if (!newCard) {
        const staticCard = animeCards[randomInt(0, animeCards.length - 1)];
        newCard = { ...staticCard, tier: nextTier, worth };
      }

      user.collection.push(newCard);
      const rewardXP = createRewardXP({ user, command: "fuse" });
      await rewardXP();
      await user.save();

      return reply(
`▬▬▬▬▬▬▬▬▬▬▬▬▬▬
*🔮 FUSION COMPLETE*
▬▬▬▬▬▬▬▬▬▬▬▬▬▬

3x ${tier} cards fused into:
🃏 ${newCard.name}
✨ ${nextTier}
💰 $${formatMoney(worth)}

▬▬▬▬▬▬▬▬▬▬▬▬▬▬`
      );
    }

    // =====================================================
    // 🥷 ROB
    // =====================================================
    case "rob": {
      if (await handleCooldown(user, "rob", reply)) return true;

      const target =
        msg.message?.extendedTextMessage?.contextInfo?.participant ||
        msg.message?.extendedTextMessage?.contextInfo?.mentionedJid?.[0];

      if (!target || target === sender)
        return reply("Tag someone to rob.");

      const victim = await User.findOne({ userId: target });
      if (!victim || victim.wallet <= 0)
        return reply("Victim has no wallet money.");

      if (!user.tools) user.tools = {};
      if (!victim.tools) victim.tools = {};

      user.tools.shield = user.tools.shield ?? 0;
      user.tools.gun = user.tools.gun ?? 0;
      victim.tools.shield = victim.tools.shield ?? 0;
      victim.tools.gun = victim.tools.gun ?? 0;

      const rewardXP = createRewardXP({ user, command: "rob" });

      // =========================================
      // 🔫 GUN vs 🛡 SHIELD — both lose item, no money
      // =========================================
      if (user.tools.gun > 0 && victim.tools.shield > 0) {
        user.tools.gun -= 1;
        victim.tools.shield -= 1;
        await rewardXP();
        await user.save();
        await victim.save();

        return reply(
`⚔️ GUN vs SHIELD!

@${sender.split("@")[0]} used 1 gun (${user.tools.gun} left)
@${target.split("@")[0]} used 1 shield (${victim.tools.shield} left)

💰 No money lost.`,
          [sender, target]
        );
      }

      // =========================================
      // 🔫 GUN vs NO SHIELD — 100% WIN, steal 50-100%
      // =========================================
      if (user.tools.gun > 0 && victim.tools.shield === 0) {
        user.tools.gun -= 1;

        const min = Math.floor(victim.wallet * 0.5);
        const max = victim.wallet;
        const stolen = randomInt(min, max);

        victim.wallet -= stolen;
        user.wallet += stolen;

        await user.save();
        await victim.save();

        return reply(
`🔫 @${sender.split("@")[0]} robbed @${target.split("@")[0]} WITH A GUN!

💰 Stole $${formatMoney(stolen)}

🔫 Used 1 gun (${user.tools.gun} left)`,
          [sender, target]
        );
      }

      // =========================================
      // 🛡 SHIELD vs NORMAL ROB — robber pays 15%
      // =========================================
      if (victim.tools.shield > 0) {
        victim.tools.shield -= 1;

        const totalMoney = user.wallet + user.bank;
        const penalty = Math.floor(totalMoney * 0.15);

        let fromWallet = Math.min(user.wallet, penalty);
        user.wallet -= fromWallet;

        let remaining = penalty - fromWallet;
        if (remaining > 0) {
          user.bank -= Math.min(user.bank, remaining);
        }

        victim.wallet += penalty;
        await user.save();
        await victim.save();

        return reply(
`🛡 ROBBERY BLOCKED!

@${target.split("@")[0]} used 1 shield (${victim.tools.shield} left)

🚔 @${sender.split("@")[0]} paid $${formatMoney(penalty)} penalty.`,
          [sender, target]
        );
      }

      // =========================================
      // 🎲 NORMAL ROB (50/50)
      // =========================================
      const success = Math.random() > 0.5;

      if (success) {
        const stolen = randomInt(
          1,
          Math.floor(victim.wallet * 0.15)
        );

        victim.wallet -= stolen;
        user.wallet += stolen;
        await rewardXP();
        await user.save();
        await victim.save();

        return reply(
`🥷 SUCCESS!

@${sender.split("@")[0]} stole $${formatMoney(stolen)} from @${target.split("@")[0]}`,
          [sender, target]
        );
      }

      // 💀 BUSTED — pay 15% penalty
      const penalty = Math.floor(user.wallet * 0.15);

      user.wallet -= penalty;
      victim.wallet += penalty;

      await user.save();
      await victim.save();

      return reply(
`🚔 BUSTED!

@${sender.split("@")[0]} paid $${formatMoney(penalty)} to @${target.split("@")[0]}`,
        [sender, target]
      );
    }

    default:
      return false; // not handled
  }
}

module.exports = {
  handle,
  TRANSACTION_COMMANDS,
};
