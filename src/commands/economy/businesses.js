/**
 * 🛠 src/commands/economy/businesses.js — Phase 2.5 batch 3
 *
 * Migrated from _economyLegacy.js:
 *   .shop    — browse buyable businesses
 *   .buy     — buy N of a business (with ownership caps)
 *   .sell    — sell by index or .sell all (70% of original price)
 *   .assets  — view your businesses + income/value summary
 *   .items   — buy power items (shield/gun)
 *   .tools   — view your arsenal
 *
 * Dependencies (via _shared.js):
 *   - shopItems, powerItems
 *   - MAX_COPIES_PER_ASSET, MAX_TOTAL_ASSETS
 *   - createRewardXP (factory)
 *
 * Also uses:
 *   - helpers: formatMoney, formatShort
 */

const User = require("../../models/User");
const { formatMoney, formatShort } = require("../../../utils/helpers");
const {
  shopItems,
  powerItems,
  MAX_COPIES_PER_ASSET,
  MAX_TOTAL_ASSETS,
  createRewardXP,
} = require("./_shared");

const BUSINESS_COMMANDS = new Set(["shop", "buy", "sell", "assets", "items", "tools"]);

async function handle(ctx) {
  const { command, args, user, reply } = ctx;

  switch (command) {

    // =====================================================
    // 🏢 SHOP — browse businesses
    // =====================================================
    case "shop": {
      let text = `▬▬▬▬▬▬▬▬▬▬▬▬▬▬\n*🏢 BUSINESS MARKET*\n▬▬▬▬▬▬▬▬▬▬▬▬▬▬\n\n▬▬▬▬▬▬▬▬▬▬▬▬▬▬`;

      shopItems.forEach(i => {
        const roi = ((i.income * 365 / i.price) * 100).toFixed(0);
        text += `\n🏷 ID ${i.id} → ${i.name}\n   💵 $${formatShort(i.price)} | 📈 $${formatShort(i.income)}/day | 📊 ${roi}% ROI\n`;
      });

      text += `\n⚠️ Max ${MAX_COPIES_PER_ASSET} of each, ${MAX_TOTAL_ASSETS} businesses total\n`;
      text += `📝 *.buy <id>* to purchase\n`;
      return reply(text);
    }

    // =====================================================
    // 🛒 BUY
    // =====================================================
    case "buy": {
      const id = parseInt(args[0]);
      const amount = parseInt(args[1]) || 1;

      const item = shopItems.find(x => x.id === id);
      if (!item) return reply("Invalid ID.");

      if (amount <= 0) return reply("Invalid amount.");

      const currentOfThisId = user.assets.filter(a => a.id === item.id).length;
      if (currentOfThisId + amount > MAX_COPIES_PER_ASSET) {
        return reply(`❌ Max ${MAX_COPIES_PER_ASSET}x ${item.name} allowed. You own ${currentOfThisId} already.`);
      }
      if (user.assets.length + amount > MAX_TOTAL_ASSETS) {
        return reply(`❌ Max ${MAX_TOTAL_ASSETS} total businesses allowed. You own ${user.assets.length}.`);
      }

      const totalCost = item.price * amount;

      if (user.wallet < totalCost)
        return reply("Not enough funds.");

      for (let i = 0; i < amount; i++) {
        user.assets.push({
          id: item.id,
          name: item.name,
          price: item.price,
          income: item.income
        });
      }

      user.wallet -= totalCost;
      const rewardXP = createRewardXP({ user, command });
      await rewardXP();
      await user.save();

      return reply(
`▬▬▬▬▬▬▬▬▬▬▬▬▬▬
*🛒 PURCHASE*
▬▬▬▬▬▬▬▬▬▬▬▬▬▬

✅ Bought ${amount}x ${item.name}
💵 Spent: $${formatMoney(totalCost)}
📈 Income: +$${formatShort(item.income * amount)}/day

💰 Wallet: $${formatMoney(user.wallet)}

▬▬▬▬▬▬▬▬▬▬▬▬▬▬`
      );
    }

    // =====================================================
    // 💰 SELL (70% of original price)
    // =====================================================
    case "sell": {
      if (!user.assets || user.assets.length === 0)
        return reply("📭 You have no assets to sell.");

      if (!args[0])
        return reply("Usage:\n.sell <asset number>\n.sell all");

      const rewardXP = createRewardXP({ user, command });

      // 🔥 SELL ALL
      if (args[0].toLowerCase() === "all") {
        let totalSell = 0;
        const soldCount = user.assets.length;

        for (let asset of user.assets) {
          const originalPrice = asset.price || 0;
          const sellPrice = Math.floor(originalPrice * 0.7);
          totalSell += sellPrice;
        }

        user.wallet += totalSell;
        user.assets = [];
        await rewardXP();
        await user.save();

        return reply(
`▬▬▬▬▬▬▬▬▬▬▬▬▬▬
*💰 SOLD ALL*
▬▬▬▬▬▬▬▬▬▬▬▬▬▬

🏢 Sold: ${soldCount} businesses
💵 Received: $${formatMoney(totalSell)}

💰 Wallet: $${formatMoney(user.wallet)}

▬▬▬▬▬▬▬▬▬▬▬▬▬▬`
        );
      }

      // 🔥 SELL BY INDEX
      const index = parseInt(args[0]);

      if (isNaN(index))
        return reply("❌ Please provide a valid asset number.");

      if (index < 1 || index > user.assets.length)
        return reply("❌ Asset number out of range.");

      const asset = user.assets[index - 1];

      if (!asset)
        return reply("❌ Asset not found.");

      const originalPrice = asset.price || 0;
      const sellPrice = Math.floor(originalPrice * 0.7);

      user.wallet += sellPrice;
      user.assets.splice(index - 1, 1);
      await rewardXP();

      await user.save();

      return reply(
`▬▬▬▬▬▬▬▬▬▬▬▬▬▬
*💰 SOLD*
▬▬▬▬▬▬▬▬▬▬▬▬▬▬

🏢 ${asset.name}
💵 Received: $${formatMoney(sellPrice)}

💰 Wallet: $${formatMoney(user.wallet)}

▬▬▬▬▬▬▬▬▬▬▬▬▬▬`
      );
    }

    // =====================================================
    // 🏢 ASSETS — view your businesses
    // =====================================================
    case "assets": {
      if (!user.assets.length)
        return reply(
`▬▬▬▬▬▬▬▬▬▬▬▬▬▬
*🏢 YOUR BUSINESSES*
▬▬▬▬▬▬▬▬▬▬▬▬▬▬

📭 No businesses yet.

💡 Use *.shop* to browse
   and *.buy <id>* to invest.

▬▬▬▬▬▬▬▬▬▬▬▬▬▬`
        );

      const totalIncome = user.assets.reduce((s, a) => s + (a.income || 0), 0);
      const totalValue = user.assets.reduce((s, a) => s + (a.price || 0), 0);

      let text = `▬▬▬▬▬▬▬▬▬▬▬▬▬▬\n*🏢 YOUR BUSINESSES*\n▬▬▬▬▬▬▬▬▬▬▬▬▬▬\n\n▬▬▬▬▬▬▬▬▬▬▬▬▬▬`;

      user.assets.forEach((a, i) => {
        text += `\n${i + 1}. ${a.name}\n   💵 $${formatShort(a.price)} | 📈 $${formatShort(a.income)}/day\n`;
      });

      text += `\n▬▬▬▬▬▬▬▬▬▬▬▬\n`;
      text += `📊 Total Value: $${formatShort(totalValue)}\n`;
      text += `💰 Daily Income: $${formatShort(totalIncome)}\n`;
      text += `📦 Slots used: ${user.assets.length}/${MAX_TOTAL_ASSETS}\n`;
      text += ``;

      return reply(text);
    }

    // =====================================================
    // 🛠 POWER ITEMS SHOP
    // =====================================================
    case "items": {
      // VIEW SHOP
      if (!args[0]) {
        let text = `▬▬▬▬▬▬▬▬▬▬▬▬▬▬\n*🛠 POWER ITEMS*\n▬▬▬▬▬▬▬▬▬▬▬▬▬▬\n\n▬▬▬▬▬▬▬▬▬▬▬▬▬▬`;

        powerItems.forEach(item => {
          text += `\n🏷 ID ${item.id} → ${item.name}\n   💵 $${formatShort(item.price)}\n`;
        });

        text += `\n📝 *.items <id>* to buy\n`;
        return reply(text);
      }

      const id = parseInt(args[0]);
      const item = powerItems.find(i => i.id === id);

      if (!item)
        return reply("Invalid item ID.");

      if (user.wallet < item.price)
        return reply("Not enough funds.");

      // 🛠 FIX (Phase 4 / 4.2): MAX_TOOLS cap — wealthy users could buy
      // unlimited shields/guns, making themselves permanently un-robable
      const MAX_TOOLS = { shield: 10, gun: 10 };
      if (!user.tools) user.tools = {};
      const currentCount = user.tools[item.key] || 0;
      if (currentCount >= MAX_TOOLS[item.key])
        return reply(`❌ Max ${MAX_TOOLS[item.key]}x ${item.name} allowed. You own ${currentCount}.`);

      user.tools[item.key] = currentCount + 1;

      user.wallet -= item.price;

      await user.save();

      return reply(
`▬▬▬▬▬▬▬▬▬▬▬▬▬▬
*🛒 PURCHASE*
▬▬▬▬▬▬▬▬▬▬▬▬▬▬

✅ ${item.name}
💵 Spent: $${formatMoney(item.price)}
📦 Now have: ${user.tools[item.key]}

▬▬▬▬▬▬▬▬▬▬▬▬▬▬`
      );
    }

    // =====================================================
    // 🧰 TOOLS — view your arsenal
    // =====================================================
    case "tools": {
      return reply(
`▬▬▬▬▬▬▬▬▬▬▬▬▬▬
*🧰 YOUR ARSENAL*
▬▬▬▬▬▬▬▬▬▬▬▬▬▬

🛡 Shields: ${user.tools.shield}
   Block robberies

🔫 Guns: ${user.tools.gun}
   Guaranteed robbery wins


▬▬▬▬▬▬▬▬▬▬▬▬▬▬`
      );
    }

    default:
      return false; // not handled
  }
}

module.exports = {
  handle,
  BUSINESS_COMMANDS,
};
