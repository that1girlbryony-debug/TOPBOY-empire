/**
 * 🛠 src/commands/economy/cards.js — Phase 2.5 batch 2
 *
 * Migrated from _economyLegacy.js:
 *   .col   — view your anime card collection
 *   .view   — view a single card with rendered image
 *   .burn   — burn cards for cash (5% tax)
 *
 * NOT migrated here (kept in legacy — shared state):
 *   .claim  — references activeDrops Map
 *   .auction — references activeAuctions Map + setTimeout resolver
 *   .bid    — references activeAuctions Map
 *
 * Dependencies (via _shared.js):
 *   - createRewardXP (factory)
 *
 * Also uses:
 *   - User model
 *   - helpers: formatMoney, formatShort
 *   - utils/cardRenderer: generateCardImage (lazy require)
 */

const User = require("../../models/User");
const { formatMoney, formatShort } = require("../../../utils/helpers");
const { createRewardXP } = require("./_shared");

const CARDS_COMMANDS = new Set(["col", "view", "burn"]);

const TIER_EMOJI = {
  Common: "⚪", Rare: "🔵", Epic: "🟣", Legendary: "🟡", Mythic: "🔴"
};

// Min prices for each tier (migrates old cards with stale prices)
const MIN_PRICES = {
  Common: 150000,
  Rare: 700000,
  Epic: 2000000,
  Legendary: 6000000,
  Mythic: 15000000
};

async function handle(ctx) {
  const { command, args, user, sender, reply, sock, chat, msg } = ctx;

  switch (command) {

    // =====================================================
    // 🎴 COLLECTION
    // =====================================================
    case "col": {
      if (!user.collection.length)
        return reply(
`▬▬▬▬▬▬▬▬▬▬▬▬▬▬
*🎴 YOUR COLLECTION*
▬▬▬▬▬▬▬▬▬▬▬▬▬▬

📭 Collection is empty.

💡 Cards drop randomly in groups.
   First to *.claim* wins!

▬▬▬▬▬▬▬▬▬▬▬▬▬▬`
        );

      // Migrate old card prices to new minimums
      let needsSave = false;
      for (const card of user.collection) {
        const minPrice = MIN_PRICES[card.tier] || 0;
        if (card.worth < minPrice) {
          card.worth = minPrice;
          needsSave = true;
        }
      }
      if (needsSave) await user.save();

      const tierCount = {};
      let totalWorth = 0;
      user.collection.forEach(item => {
        tierCount[item.tier] = (tierCount[item.tier] || 0) + 1;
        totalWorth += item.worth || 0;
      });

      let text = `▬▬▬▬▬▬▬▬▬▬▬▬▬▬\n*🎴 YOUR COLLECTION*\n▬▬▬▬▬▬▬▬▬▬▬▬▬▬\n\n▬▬▬▬▬▬▬▬▬▬▬▬▬▬`;

      user.collection.forEach((item, i) => {
        const tierEmoji = TIER_EMOJI[item.tier] || "⚪";
        text += `\n${i + 1}. ${tierEmoji} ${item.name}\n   ✨ ${item.tier} | 💰 $${formatShort(item.worth)}\n`;
      });

      text += `\n▬▬▬▬▬▬▬▬▬▬▬▬\n`;
      text += `🎴 Total Cards: ${user.collection.length}\n`;
      text += `💎 Total Worth: $${formatShort(totalWorth)}\n`;
      text += ``;

      return reply(text);
    }

    // =====================================================
    // 👁 VIEW CARD (WITH ANIMATED CARD REVEAL)
    // =====================================================
    case "view": {
      const index = parseInt(args[0]) - 1;

      if (!user.collection[index])
        return reply("❌ Invalid card index. Use *.col* to see your cards.");

      const card = user.collection[index];

      if (!card.image || typeof card.image !== "string") {
        return reply("⚠️ Card image missing.");
      }

      const tierEmoji = TIER_EMOJI[card.tier] || "⚪";

      const caption =
`▬▬▬▬▬▬▬▬▬▬▬▬▬▬
*🎴 CARD DETAILS*
▬▬▬▬▬▬▬▬▬▬▬▬▬▬

🃏 ${card.name}
${tierEmoji} ${card.tier}
💰 $${formatMoney(card.worth)}


▬▬▬▬▬▬▬▬▬▬▬▬▬▬`;

      // 🎨 Phase 5.1: Try animated card reveal (canvas → MP4)
      try {
        const { generateCardImage } = require("../../../utils/cardRenderer");
        const renderedBuffer = await generateCardImage(card);

        if (renderedBuffer && renderedBuffer.length > 0) {
          // Check if it's a video (MP4) or image (PNG)
          const isVideo = renderedBuffer[0] === 0x00 && renderedBuffer[1] === 0x00 &&
                         renderedBuffer[2] === 0x00 && renderedBuffer[3] === 0x20; // MP4 magic

          if (isVideo || renderedBuffer.length > 10000) {
            // Animated card — send as video with gifPlayback
            await sock.sendMessage(chat, {
              video: renderedBuffer,
              gifPlayback: true,
              mimetype: "video/mp4",
              caption,
            }, { quoted: msg });
          } else {
            // Static image (Jimp fallback)
            await sock.sendMessage(chat, {
              image: renderedBuffer,
              caption,
            }, { quoted: msg });
          }
          return;
        }
      } catch (err) {
        console.log("Card render failed, using fallback:", err.message);
      }

      // Fallback: original image URL
      await sock.sendMessage(chat, {
        image: { url: card.image },
        caption,
      }, { quoted: msg });
      return;
    }

    // =====================================================
    // 🔥 BURN CARDS (sell for worth minus 5% tax)
    // =====================================================
    case "burn": {
      if (!user.collection.length)
        return reply("📭 No cards to burn.");

      if (!args[0])
        return reply("Usage:\n.burn <index>\n.burn all");

      const rewardXP = createRewardXP({ user, command });

      // 🔥 BURN ALL
      if (args[0].toLowerCase() === "all") {
        let grossTotal = 0;
        for (const card of user.collection) {
          grossTotal += card.worth || 0;
        }

        const taxAmount = Math.floor(grossTotal * 0.05);
        const netTotal = grossTotal - taxAmount;
        const cardCount = user.collection.length;

        user.wallet += netTotal;
        user.collection = [];
        await rewardXP();
        await user.save();

        return reply(
`▬▬▬▬▬▬▬▬▬▬▬▬▬▬
*🔥 BURNED ALL*
▬▬▬▬▬▬▬▬▬▬▬▬▬▬

🎴 Burned: ${cardCount} cards
💰 Gross: $${formatMoney(grossTotal)}
💸 Tax (5%): -$${formatMoney(taxAmount)}
💵 Received: $${formatMoney(netTotal)}

💰 Wallet: $${formatMoney(user.wallet)}

▬▬▬▬▬▬▬▬▬▬▬▬▬▬`
        );
      }

      // 🔥 BURN BY INDEX
      const index = parseInt(args[0]);
      if (isNaN(index) || index < 1 || index > user.collection.length)
        return reply("❌ Invalid card index. Use *.col* to see your cards.");

      const card = user.collection[index - 1];
      const grossWorth = card.worth || 0;
      const taxAmount = Math.floor(grossWorth * 0.05);
      const netWorth = grossWorth - taxAmount;

      const tierEmoji = TIER_EMOJI[card.tier] || "⚪";

      user.wallet += netWorth;
      user.collection.splice(index - 1, 1);
      await rewardXP();
      await user.save();

      return reply(
`▬▬▬▬▬▬▬▬▬▬▬▬▬▬
*🔥 BURNED*
▬▬▬▬▬▬▬▬▬▬▬▬▬▬

🃏 ${card.name}
${tierEmoji} ${card.tier}

💰 Gross: $${formatMoney(grossWorth)}
💸 Tax (5%): -$${formatMoney(taxAmount)}
💵 Received: $${formatMoney(netWorth)}


▬▬▬▬▬▬▬▬▬▬▬▬▬▬`
      );
    }

    default:
      return false; // not handled
  }
}

module.exports = {
  handle,
  CARDS_COMMANDS,
};
