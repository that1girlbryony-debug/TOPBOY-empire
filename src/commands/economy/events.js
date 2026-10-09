/**
 * 🛠 src/commands/economy/events.js — Phase 2.5 final batch
 *
 * Migrated from _economyLegacy.js:
 *   .heist    — start a team heist against a target (80s window)
 *   .join     — join heist as a robber
 *   .protect  — join heist as a protector
 *   .claim    — claim a dropped anime card
 *   .auction  — start a card auction (60s window)
 *   .bid      — place a bid on an active auction
 *
 * Shared state (via legacy exports):
 *   - activeHeists Map (chat → {victim, robbers, protectors})
 *   - heistCooldowns Map (chat → timestamp)
 *   - activeDrops Map (chat → card drop)
 *   - activeAuctions Map (chat → {seller, card, minBid, highestBid, ...})
 *
 * The heist setTimeout resolver is very long (~200 lines) — it's
 * copied as-is from legacy, preserving all Phase 1 atomic $inc fixes.
 */

const User = require("../../models/User");
const { formatMoney, formatShort, randomInt } = require("../../utils/helpers");
const animeCards = require("../../data/animeCards");
const { fetchRandomCharacter } = require("../../utils/animeFetcher");
const legacy = require("../_economyLegacy");
const { handleCooldown, formatTime, createRewardXP } = require("./_shared");

const EVENT_COMMANDS = new Set(["heist", "join", "protect", "claim", "auction", "bid"]);

async function handle(ctx) {
  const { command, args, user, sender, reply, sock, chat, msg, isGroup } = ctx;

  switch (command) {

    // =====================================================
    // 🚨 HEIST
    // =====================================================
    case "heist": {
      if (!isGroup) return reply("🚫 Group only.");

      if (legacy.activeHeists.has(chat))
        return reply("⚠️ A heist is already active.");

      const now = Date.now();

      if (legacy.heistCooldowns.has(chat)) {
        const remaining = legacy.HEIST_COOLDOWN - (now - legacy.heistCooldowns.get(chat));
        if (remaining > 0)
          return reply(`⏳ Next heist in ${formatTime(remaining)}`);
      }

      const target =
        msg.message?.extendedTextMessage?.contextInfo?.mentionedJid?.[0];

      if (!target || target === sender)
        return reply("Tag a valid target.");

      const victim = await User.findOne({ userId: target });
      if (!victim)
        return reply("User not registered.");

      // 🔒 Freeze victim
      victim.heistFreeze = true;
      await victim.save();

      legacy.activeHeists.set(chat, {
        victim: target,
        robbers: new Set([sender]),
        protectors: new Set()
      });

      // 🔒 Freeze initiator
      user.heistFreeze = true;
      await user.save();

      await sock.sendMessage(chat, {
        text:
`🚨 *HEIST IN PROGRESS* 🚨

🎯 Target: @${target.split("@")[0]}
⏳ Duration: 80 seconds

🥷 *.join* → Rob the target
🛡 *.protect* → Defend them

⚠️ Economy actions locked
   for all participants!`,
        mentions: [target]
      });

      // ========================================
      // END HEIST — setTimeout resolver
      // (Preserves all Phase 1 atomic $inc fixes)
      // ========================================
      setTimeout(async () => {
        const session = legacy.activeHeists.get(chat);
        if (!session) return;

        legacy.activeHeists.delete(chat);
        legacy.heistCooldowns.set(chat, Date.now());

        const robbers = [...session.robbers];
        const protectors = [...session.protectors];
        const victimId = session.victim;

        const robbersWin = Math.random() < 0.5;

        let resultText = "";
        let gainText = "";

        // 🛡 PROTECTORS WIN
        if (!robbersWin) {
          let totalCollected = 0;

          for (let id of robbers) {
            const rUser = await User.findOne({ userId: id });
            if (!rUser) continue;

            const loss = await legacy.takeTotalPercent(rUser, 20, 50);
            await User.updateOne(
              { userId: id },
              {
                $set: {
                  jailUntil: Date.now() + (20 * 60 * 1000),
                  heistFreeze: false
                }
              }
            ).catch(err => console.error(`heist robber update failed for ${id}:`, err.message));

            totalCollected += loss;
            resultText += `💀 @${id.split("@")[0]} lost $${formatMoney(loss)}\n`;
          }

          const receivers = protectors.length > 0 ? protectors : [victimId];
          const share = Math.floor(totalCollected / receivers.length);

          for (let id of receivers) {
            await User.updateOne(
              { userId: id },
              {
                $inc: { wallet: share },
                $set: { heistFreeze: false }
              }
            ).catch(err => console.error(`heist receiver update failed for ${id}:`, err.message));

            gainText += `💰 @${id.split("@")[0]} gained $${formatMoney(share)}\n`;
          }

          await User.updateOne(
            { userId: victimId },
            { $set: { heistFreeze: false } }
          ).catch(() => {});

          return sock.sendMessage(chat, {
            text:
`🛡 *PROTECTORS WON* 🛡

${resultText}
🚔 Robbers jailed for 20 minutes.

${gainText}`,
            mentions: [...robbers, ...receivers]
          });
        }

        // 💣 ROBBERS WIN
        let totalLoot = 0;
        const losers = [victimId, ...protectors];

        for (let id of losers) {
          const lUser = await User.findOne({ userId: id });
          if (!lUser) continue;

          const loss = await legacy.takeTotalPercent(lUser, 20, 30);
          await User.updateOne(
            { userId: id },
            { $set: { heistFreeze: false } }
          ).catch(err => console.error(`heist loser update failed for ${id}:`, err.message));

          totalLoot += loss;
          resultText += `💀 @${id.split("@")[0]} lost $${formatMoney(loss)}\n`;
        }

        const share = Math.floor(totalLoot / robbers.length);

        for (let id of robbers) {
          await User.updateOne(
            { userId: id },
            {
              $inc: { wallet: share },
              $set: { heistFreeze: false }
            }
          ).catch(err => console.error(`heist robber gain failed for ${id}:`, err.message));

          gainText += `💰 @${id.split("@")[0]} gained $${formatMoney(share)}\n`;
        }

        return sock.sendMessage(chat, {
          text:
`💣 *ROBBERS WON* 💣

${resultText}

${gainText}`,
          mentions: [...robbers, ...losers]
        });

      }, legacy.HEIST_DURATION);
      return;
    }

    // =====================================================
    // 🥷 JOIN ROBBERS
    // =====================================================
    case "join": {
      const session = legacy.activeHeists.get(chat);
      if (!session) return;

      session.protectors.delete(sender);
      session.robbers.add(sender);

      const u = await User.findOne({ userId: sender });
      if (u) {
        u.heistFreeze = true;
        await u.save();
      }

      return reply(`🥷 @${sender.split("@")[0]} joined robbers.`, [sender]);
    }

    // =====================================================
    // 🛡 JOIN PROTECTORS
    // =====================================================
    case "protect": {
      const session = legacy.activeHeists.get(chat);
      if (!session) return;

      session.robbers.delete(sender);
      session.protectors.add(sender);

      const u = await User.findOne({ userId: sender });
      if (u) {
        u.heistFreeze = true;
        await u.save();
      }

      return reply(`🛡 @${sender.split("@")[0]} joined protectors.`, [sender]);
    }

    // =====================================================
    // 🎁 CLAIM DROP
    // =====================================================
    case "claim": {
      const drop = legacy.activeDrops.get(chat);
      if (!drop) return reply("No active card drop in this group.");

      if (!drop.image) return reply("⚠️ This card has no image! Cannot claim.");

      const collectionItem = {
        name: drop.name,
        tier: drop.tier,
        worth: drop.worth,
        image: drop.image
      };

      user.collection = user.collection || [];
      user.collection.push(collectionItem);

      const rewardXP = createRewardXP({ user, command: "claim" });
      await rewardXP();

      // 🛠 FIX (Phase 1 / 1.3): SAVE FIRST, then delete from activeDrops.
      await user.save();
      legacy.activeDrops.delete(chat);

      return reply(
`▬▬▬▬▬▬▬▬▬▬▬▬▬▬
*🎴 CARD CLAIMED*
▬▬▬▬▬▬▬▬▬▬▬▬▬▬

🏆 @${sender.split("@")[0]} claimed:
🃏 ${drop.name}
✨ ${drop.tier}
💰 $${formatMoney(drop.worth)}


▬▬▬▬▬▬▬▬▬▬▬▬▬▬`, [sender]);
    }

    // =====================================================
    // 🏆 AUCTION
    // =====================================================
    case "auction": {
      if (!isGroup)
        return reply("🚫 Group only.");

      if (legacy.activeAuctions.has(chat))
        return reply("⚠️ Auction already active in this group.");

      const index = parseInt(args[0]) - 1;
      const minPrice = parseInt(args[1]);

      if (isNaN(index) || isNaN(minPrice) || minPrice <= 0)
        return reply("Usage: .auction <index> <min price>");

      if (!user.collection[index])
        return reply("❌ Invalid card index.");

      const card = user.collection[index];

      // Remove card from seller
      user.collection.splice(index, 1);
      await user.save();

      legacy.activeAuctions.set(chat, {
        seller: sender,
        card,
        minBid: minPrice,
        highestBid: 0,
        highestBidder: null,
        _expiresAt: Date.now() + 60000
      });

      // Auction end setTimeout
      setTimeout(async () => {
        const auction = legacy.activeAuctions.get(chat);
        if (!auction) return;

        legacy.activeAuctions.delete(chat);

        // ❌ No bids → return card
        if (!auction.highestBidder) {
          await User.updateOne(
            { userId: auction.seller },
            { $push: { collection: auction.card } }
          ).catch(err => console.error("auction return-card failed:", err.message));

          return sock.sendMessage(chat, {
            text: "⏳ Auction ended.\nNo bids were placed. Card returned to seller."
          });
        }

        // 💰 TAX: 5% on auction sales
        const taxAmount = Math.floor(auction.highestBid * 0.05);
        const netAmount = auction.highestBid - taxAmount;

        await User.updateOne(
          { userId: auction.seller },
          { $inc: { wallet: netAmount } }
        ).catch(err => console.error("auction seller payout failed:", err.message));

        await User.updateOne(
          { userId: auction.highestBidder },
          { $push: { collection: auction.card } }
        ).catch(err => console.error("auction winner card push failed:", err.message));

        sock.sendMessage(chat, {
          text:
`🏆 AUCTION ENDED

🎴 Card: ${auction.card.name}
👑 Winner: @${auction.highestBidder.split("@")[0]}
💰 Sale: $${formatMoney(auction.highestBid)}
📊 Tax (5%): -$${formatMoney(taxAmount)}
💵 Seller receives: $${formatMoney(netAmount)}`,
          mentions: [auction.highestBidder]
        });

      }, 60000);

      return sock.sendMessage(chat, {
        image: { url: card.image },
        caption:
`▬▬▬▬▬▬▬▬▬▬▬▬▬▬
*🏆 AUCTION LIVE*
▬▬▬▬▬▬▬▬▬▬▬▬▬▬

🃏 ${card.name}
✨ ${card.tier}
💰 Value: $${formatMoney(card.worth)}

💵 Starting at: $${formatMoney(minPrice)}
⏳ 60 seconds

Type *.bid <amount>*

▬▬▬▬▬▬▬▬▬▬▬▬▬▬`,
      }, { quoted: msg });
    }

    // =====================================================
    // 💸 BID
    // =====================================================
    case "bid": {
      if (!isGroup)
        return reply("🚫 Group-only command.");

      const auction = legacy.activeAuctions.get(chat);
      if (!auction)
        return reply("❌ No active auction.");

      if (sender === auction.seller)
        return reply("🚫 You cannot bid on your own auction.");

      const amount = parseInt(args[0]);

      if (isNaN(amount) || amount <= 0)
        return reply("Usage: .bid <amount>");

      if (auction.highestBid === 0 && amount < auction.minBid)
        return reply(`❌ Minimum bid is $${formatMoney(auction.minBid)}`);

      if (amount <= auction.highestBid)
        return reply(`❌ Must be higher than $${formatMoney(auction.highestBid)}`);

      if (user.wallet < amount)
        return reply("❌ Not enough wallet funds.");

      // 🛠 FIX (Phase 1 / 1.1): atomic $inc for refund + deduction
      if (auction.highestBidder) {
        await User.updateOne(
          { userId: auction.highestBidder },
          { $inc: { wallet: auction.highestBid } }
        ).catch(err => console.error("bid refund failed:", err.message));
      }

      await User.updateOne(
        { userId: sender },
        { $inc: { wallet: -amount } }
      ).catch(err => console.error("bid deduction failed:", err.message));
      user.wallet -= amount;

      auction.highestBid = amount;
      auction.highestBidder = sender;

      legacy.activeAuctions.set(chat, auction);

      return sock.sendMessage(chat, {
        text:
`▬▬▬▬▬▬▬▬▬▬▬▬▬▬
*💸 NEW BID*
▬▬▬▬▬▬▬▬▬▬▬▬▬▬

👤 @${sender.split("@")[0]}
💰 Bid: $${formatMoney(amount)}


▬▬▬▬▬▬▬▬▬▬▬▬▬▬`,
        mentions: [sender]
      });
    }

    default:
      return false; // not handled
  }
}

module.exports = {
  handle,
  EVENT_COMMANDS,
};
