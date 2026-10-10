/**
 * 🛠 src/commands/economy/money.js — Phase 2.5
 *
 * Migrated from _economyLegacy.js:
 *   .bal   — check wallet/bank/debt balance
 *   .dep   — deposit wallet → bank
 *   .wd    — withdraw bank → wallet
 *   .give  — gift a card to another player
 *   .send  — transfer cash to another player
 *
 * Dependencies (via _shared.js):
 *   - createRewardXP (factory replacing the legacy inline rewardXP)
 *
 * Also uses:
 *   - User model
 *   - helpers: formatMoney, formatShort, cleanId
 */

const User = require("../../models/User");
const { formatMoney, formatShort, cleanId } = require("../../../utils/helpers");
const { createRewardXP } = require("./_shared");

const MONEY_COMMANDS = new Set(["bal", "dep", "wd", "give", "send"]);

async function handle(ctx) {
  const { command, args, user, sender, reply, msg } = ctx;

  switch (command) {

    // =====================================================
    // 💰 BALANCE
    // =====================================================
    case "bal": {
      const target =
        msg.message?.extendedTextMessage?.contextInfo?.participant ||
        msg.message?.extendedTextMessage?.contextInfo?.mentionedJid?.[0] ||
        sender;

      const targetUser = await User.findOne({ userId: target });
      if (!targetUser) return reply("❌ User not registered.");

      targetUser.wallet = targetUser.wallet || 0;
      targetUser.bank = targetUser.bank || 0;
      targetUser.debt = targetUser.debt || 0;

      const total = targetUser.wallet + targetUser.bank - targetUser.debt;

      return reply(
        `▬▬▬▬▬▬▬▬▬▬▬▬▬▬\n*💰 @${cleanId(target)}'s BALANCE*\n▬▬▬▬▬▬▬▬▬▬▬▬▬▬\n\n💵 Wallet: $${formatMoney(targetUser.wallet)}\n🏦 Bank: $${formatMoney(targetUser.bank)}\n💳 Debt: $${formatMoney(targetUser.debt)}\n\n💎 Total: $${formatMoney(total)}\n\n▬▬▬▬▬▬▬▬▬▬▬▬▬▬`,
        [target]
      );
    }

    // =====================================================
    // 🏦 DEPOSIT
    // =====================================================
    case "dep": {
      let amount;

      if (args[0] === "all") {
        amount = user.wallet;
      } else {
        amount = parseInt(args[0]);
      }

      if (!amount || amount <= 0)
        return reply("📝 Usage: *.dep <amount>* or *.dep all*");

      if (user.wallet < amount)
        return reply("❌ Not enough wallet funds.");

      user.wallet -= amount;
      user.bank += amount;

      await user.save();
      return reply(
`▬▬▬▬▬▬▬▬▬▬▬▬▬▬
*🏦 DEPOSIT*
▬▬▬▬▬▬▬▬▬▬▬▬▬▬

💵 Deposited: $${formatMoney(amount)}

💰 Wallet: $${formatMoney(user.wallet)}
🏦 Bank: $${formatMoney(user.bank)}

▬▬▬▬▬▬▬▬▬▬▬▬▬▬`
      );
    }

    // =====================================================
    // 💵 WITHDRAW
    // =====================================================
    case "wd": {
      let amount;

      if (args[0] === "all") {
        amount = user.bank;
      } else {
        amount = parseInt(args[0]);
      }

      if (!amount || amount <= 0)
        return reply("📝 Usage: *.wd <amount>* or *.wd all*");

      if (user.bank < amount)
        return reply("❌ Not enough bank funds.");

      user.bank -= amount;
      user.wallet += amount;

      await user.save();
      return reply(
`▬▬▬▬▬▬▬▬▬▬▬▬▬▬
*💵 WITHDRAW*
▬▬▬▬▬▬▬▬▬▬▬▬▬▬

🏦 Withdrew: $${formatMoney(amount)}

💰 Wallet: $${formatMoney(user.wallet)}
🏦 Bank: $${formatMoney(user.bank)}

▬▬▬▬▬▬▬▬▬▬▬▬▬▬`
      );
    }

    // =====================================================
    // 🎁 GIVE (gift a card)
    // =====================================================
    case "give": {
      const target = msg.message?.extendedTextMessage?.contextInfo?.mentionedJid?.[0];
      const index = parseInt(args[0]) - 1;

      if (!target || isNaN(index))
        return reply("Usage: .give index @user");

      // 🛠 FIX (Phase 1 / 1.3): missing self-check
      if (target === sender)
        return reply("🚫 You can't give a card to yourself.");

      if (!user.collection[index])
        return reply("Invalid item index.");

      // 🛠 FIX (Phase 1 / 1.3): frozen/banned targets shouldn't receive cards
      if (global._frozenUsers?.has(target))
        return reply("🚫 That user is frozen by an admin — they can't receive cards.");

      const receiver = await User.findOne({ userId: target });
      if (!receiver)
        return reply("User not registered.");
      if (receiver.banned)
        return reply("🚫 That user is banned — they can't receive cards.");

      const item = user.collection[index];

      user.collection.splice(index, 1);
      receiver.collection = receiver.collection || [];
      receiver.collection.push(item);

      // 🛠 FIX (Phase 3 / 3.3): .give now rewards XP (matches .burn/.trade/.fuse)
      const rewardXP = createRewardXP({ user, command: "give" });
      await rewardXP();

      await user.save();
      await receiver.save();

      return reply(
`▬▬▬▬▬▬▬▬▬▬▬▬▬▬
*🎁 CARD GIFTED*
▬▬▬▬▬▬▬▬▬▬▬▬▬▬

📤 @${sender.split("@")[0]}
   → @${target.split("@")[0]}

🎴 ${item.name}
✨ ${item.tier} | 💰 $${formatShort(item.worth)}

▬▬▬▬▬▬▬▬▬▬▬▬▬▬`, [sender, target]);
    }

    // =====================================================
    // 💸 SEND (transfer cash)
    // =====================================================
    case "send": {
      const target =
        msg.message?.extendedTextMessage?.contextInfo?.participant ||
        msg.message?.extendedTextMessage?.contextInfo?.mentionedJid?.[0];
      const amount = parseInt(args[0]);

      if (!target || isNaN(amount) || amount <= 0)
        return reply("📝 Usage: *.send <amount> @user*");

      if (user.wallet < amount)
        return reply("❌ Insufficient wallet funds.");

      if (target === sender)
        return reply("🚫 You can't send money to yourself.");

      const receiver = await User.findOne({ userId: target });
      if (!receiver)
        return reply("❌ User not registered.");

      user.wallet -= amount;
      receiver.wallet += amount;
      const rewardXP = createRewardXP({ user, command });
      await rewardXP();
      await user.save();
      await receiver.save();

      return reply(
`▬▬▬▬▬▬▬▬▬▬▬▬▬▬
*💸 TRANSFER*
▬▬▬▬▬▬▬▬▬▬▬▬▬▬

📤 @${sender.split("@")[0]}
   → @${target.split("@")[0]}

💰 Sent: $${formatMoney(amount)}


▬▬▬▬▬▬▬▬▬▬▬▬▬▬`,
        [sender, target]
      );
    }

    default:
      return false; // not handled
  }
}

module.exports = {
  handle,
  MONEY_COMMANDS,
};
