/**
 * 🛠 src/commands/economy/progression.js — Phase 2.5
 *
 * Migrated from _economyLegacy.js:
 *   .cd       — show cooldown status
 *   .daily    — daily claim with streak + income + bank interest
 *   .work     — random $1k-$4k with cooldown
 *   .beg      — random $200-$800 with cooldown
 *   .lb       — top 10 richest leaderboard
 *   .profile   — full profile card with XP bar, title, finances
 *
 * Dependencies (via _shared.js):
 *   - getRemaining, handleCooldown, formatTime, getNigeriaDate
 *   - calculateTax, addXP, createXPBar, xpForNextLevel, getTitle
 *   - createRewardXP (factory replacing the legacy inline rewardXP)
 *
 * Also uses:
 *   - User model (../../models/User)
 *   - helpers: formatMoney, formatShort, calculateNetWorth, cleanId
 *
 * Router integration: _router.js checks if the command is in
 * PROGRESSION_COMMANDS and calls this module's handler BEFORE
 * falling through to _economyLegacy.js.
 */

const User = require("../../models/User");
const { formatMoney, formatShort, calculateNetWorth, cleanId } = require("../../utils/helpers");
const {
  getRemaining,
  handleCooldown,
  formatTime,
  getNigeriaDate,
  calculateTax,
  xpForNextLevel,
  createXPBar,
  getTitle,
  createRewardXP,
} = require("./_shared");

// Commands handled by this module
const PROGRESSION_COMMANDS = new Set([
  "cd", "daily", "work", "beg", "lb", "profile", "richest"
]);

/**
 * Main handler. Called by _router.js when command is in PROGRESSION_COMMANDS.
 * @param {Object} ctx — { sock, chat, sender, command, args, user, reply, msg, isGroup }
 * @returns {Promise<boolean>} true if handled
 */
async function handle(ctx) {
  const { command, args, user, sender, reply, sock, chat, msg } = ctx;

  switch (command) {

    // =====================================================
    // ⏳ COOLDOWNS
    // =====================================================
    case "cd": {
      let text = `▬▬▬▬▬▬▬▬▬▬▬▬▬▬\n*⏳ COOLDOWNS*\n▬▬▬▬▬▬▬▬▬▬▬▬▬▬\n\n▬▬▬▬▬▬▬▬▬▬▬▬▬▬`;
      let active = false;

      const config = require("../../config");
      for (let cmd in config.cooldowns) {
        const remaining = getRemaining(user, cmd, config.cooldowns[cmd]);
        if (remaining > 0) {
          active = true;
          text += `\n🔒 .${cmd}\n   ⏱ ${formatTime(remaining)}\n`;
        }
      }

      if (active) {
        text += `\n`;
      } else {
        text = `▬▬▬▬▬▬▬▬▬▬▬▬▬▬\n*⏳ COOLDOWNS*\n▬▬▬▬▬▬▬▬▬▬▬▬▬▬\n\n✅ All commands ready!\n\n▬▬▬▬▬▬▬▬▬▬▬▬▬▬`;
      }

      return reply(text);
    }

    // =====================================================
    // 💰 DAILY
    // =====================================================
    case "daily": {
      const today = getNigeriaDate();

      if (user.lastDailyClaim === today)
        return reply("🎁 Already claimed today.");

      user.streak = user.streak || 0;

      if (user.lastDailyClaim) {
        const yesterday = new Date(
          new Date().toLocaleString("en-US", { timeZone: "Africa/Lagos" })
        );
        yesterday.setDate(yesterday.getDate() - 1);
        const yString = yesterday.toISOString().split("T")[0];

        if (user.lastDailyClaim !== yString) {
          user.streak = 0;
        }
      }

      const baseReward = 5000 + (user.streak * 500);

      let income = 0;
      user.assets.forEach(a => income += a.income || 0);

      const bankInterest = Math.floor(user.bank * 0.01);
      const grossTotal = baseReward + income + bankInterest;

      const taxAmount = calculateTax(grossTotal);
      const total = grossTotal - taxAmount;

      user.wallet += total;
      user.lastDailyClaim = today;
      user.streak += 1;

      const rewardXP = createRewardXP({ user, command });
      await rewardXP();

      // 💍 MARRIAGE: share 50% of daily earnings with spouse
      let spouseShare = 0;
      if (user.marriage?.spouseId) {
        spouseShare = Math.floor(total * 0.5);
        const spouse = await User.findOne({ userId: user.marriage.spouseId });
        if (spouse) {
          user.wallet -= spouseShare;
          spouse.wallet += spouseShare;
          await spouse.save();
        }
      }

      await user.save();

      let replyText =
`▬▬▬▬▬▬▬▬▬▬▬▬▬▬
*🎁 DAILY CLAIMED*
▬▬▬▬▬▬▬▬▬▬▬▬▬▬

💵 Base: $${formatMoney(baseReward)}
🏢 Business Income: $${formatMoney(income)}
🏦 Bank Interest: $${formatMoney(bankInterest)}
${taxAmount > 0 ? `💸 Tax: -$${formatMoney(taxAmount)}\n` : ""}▬▬▬▬▬▬▬▬▬▬▬▬
💰 Received: $${formatMoney(total)}`;

      if (spouseShare > 0) {
        replyText += `\n💍 Spouse share (50%): $${formatMoney(spouseShare)}`;
      }

      replyText += `\n\n🔥 Streak: ${user.streak} day${user.streak !== 1 ? "s" : ""}`;
      replyText += `\n▬▬▬▬▬▬▬▬▬▬▬▬▬▬`;

      return reply(replyText);
    }

    // =====================================================
    // 💼 WORK
    // =====================================================
    case "work": {
      if (await handleCooldown(user, "work", reply)) return true;

      const jobs = [
        "Delivered packages across town",
        "Fixed someone's laptop",
        "Tutored a kid in math",
        "Washed dishes at a restaurant",
        "Built a website for a client",
        "Cut hair at the barbershop",
        "DJed a house party",
        "Walked some dogs",
        "Flipped sneakers online"
      ];
      const { randomInt } = require("../../utils/helpers");
      const job = jobs[randomInt(0, jobs.length - 1)];
      const amount = randomInt(1000, 4000);

      user.wallet += amount;
      const rewardXP = createRewardXP({ user, command });
      await rewardXP();
      await user.save();

      return reply(
`▬▬▬▬▬▬▬▬▬▬▬▬▬▬
*💼 WORK*
▬▬▬▬▬▬▬▬▬▬▬▬▬▬

${job} and earned:
💰 +$${formatMoney(amount)}

▬▬▬▬▬▬▬▬▬▬▬▬▬▬`
      );
    }

    // =====================================================
    // 🤲 BEG
    // =====================================================
    case "beg": {
      if (await handleCooldown(user, "beg", reply)) return true;

      const { randomInt } = require("../../utils/helpers");
      const amount = randomInt(200, 800);
      user.wallet += amount;
      const rewardXP = createRewardXP({ user, command });
      await rewardXP();
      await user.save();

      const phrases = [
        `🙏 A kind stranger slipped you`,
        `💸 You found some cash on the ground:`,
        `🎭 A sympathetic passerby gave you`,
        `🛒 Someone dropped money near you:`,
        `😤 A hustler felt sorry and gave you`
      ];
      const phrase = phrases[randomInt(0, phrases.length - 1)];

      return reply(`▬▬▬▬▬▬▬▬▬▬▬▬▬▬\n*🤲 BEGGING*\n▬▬▬▬▬▬▬▬▬▬▬▬▬▬\n\n${phrase}\n💰 +$${formatMoney(amount)}\n\n▬▬▬▬▬▬▬▬▬▬▬▬▬▬`);
    }

    // =====================================================
    // 🏆 LEADERBOARD / RICHEST (alias)
    // =====================================================
    case "lb":
    case "richest": {
      const users = await User.find({}, "userId wallet bank assets debt");

      const sorted = users
        .map(u => ({
          userId: u.userId,
          net: calculateNetWorth(u)
        }))
        .sort((a, b) => b.net - a.net)
        .slice(0, 10);

      const medals = ["👑", "🥈", "🥉", "4️⃣", "5️⃣", "6️⃣", "7️⃣", "8️⃣", "9️⃣", "🔟"];

      // 🛠 FIX (Phase 3.5): no @mentions — just plain names. Tagging
      // leaderboard members was annoying them every time someone
      // checked .lb. Now shows names as plain text.
      let text = `▬▬▬▬▬▬▬▬▬▬▬▬▬▬\n*🏆 TOP 10 RICHEST*\n▬▬▬▬▬▬▬▬▬▬▬▬▬▬\n`;

      sorted.forEach((u, i) => {
        const medal = medals[i] || `${i + 1}.`;
        const name = u.userId.split("@")[0];
        text += `\n${medal} ${name}\n   💎 $${formatShort(u.net)}\n`;
      });

      text += `\n▬▬▬▬▬▬▬▬▬▬▬▬▬▬`;

      return reply(text);
    }

    // =====================================================
    // 👤 PROFILE
    // =====================================================
    case "profile": {
      const target =
        msg.message?.extendedTextMessage?.contextInfo?.participant ||
        msg.message?.extendedTextMessage?.contextInfo?.mentionedJid?.[0] ||
        sender;

      const targetUser = await User.findOne({ userId: target });
      if (!targetUser) return reply("❌ User not registered.");

      targetUser.wallet = targetUser.wallet || 0;
      targetUser.bank = targetUser.bank || 0;
      targetUser.debt = targetUser.debt || 0;
      targetUser.assets = targetUser.assets || [];
      targetUser.collection = targetUser.collection || [];

      const net = calculateNetWorth(targetUser);
      const neededXP = xpForNextLevel(targetUser.level);
      const bar = createXPBar(targetUser.xp, neededXP);
      const title = getTitle(net);
      const totalIncome = targetUser.assets.reduce((s, a) => s + (a.income || 0), 0);
      const marital = targetUser.marriage?.spouseId
        ? `💍 @${cleanId(targetUser.marriage.spouseId)}`
        : "💔 Single";

      let pfp = null;
      try {
        pfp = await sock.profilePictureUrl(target, "image");
      } catch {
        try {
          const fs = require("fs");
          if (fs.existsSync("./data/profile.jpg")) {
            pfp = fs.readFileSync("./data/profile.jpg");
          }
        } catch {}
      }

      const caption =
`▬▬▬▬▬▬▬▬▬▬▬▬▬▬
*👤 @${cleanId(target)}'s PROFILE*
▬▬▬▬▬▬▬▬▬▬▬▬▬▬

${title}
${marital}

⭐ Level ${targetUser.level}
${bar}
📊 XP: ${targetUser.xp || 0} / ${neededXP}

*💰 FINANCES*
💵 Wallet: $${formatMoney(targetUser.wallet)}
🏦 Bank: $${formatMoney(targetUser.bank)}
💳 Debt: $${formatMoney(targetUser.debt)}
💎 Net Worth: $${formatMoney(net)}


*📊 EMPIRE*
🏢 Businesses: ${targetUser.assets.length}
📈 Daily Income: $${formatShort(totalIncome)}
🎴 Cards: ${targetUser.collection.length}
🛡 Shields: ${targetUser.tools?.shield || 0}
🔫 Guns: ${targetUser.tools?.gun || 0}



▬▬▬▬▬▬▬▬▬▬▬▬▬▬`;

      const mentions = targetUser.marriage?.spouseId
        ? [target, targetUser.marriage.spouseId]
        : [target];

      if (pfp) {
        const imageField = Buffer.isBuffer(pfp) ? pfp : { url: pfp };
        return sock.sendMessage(
          chat,
          { image: imageField, caption, mentions },
          { quoted: msg }
        );
      }

      return sock.sendMessage(
        chat,
        { text: caption, mentions },
        { quoted: msg }
      );
    }

    default:
      return false; // not handled — router falls through to legacy
  }
}

module.exports = {
  handle,
  PROGRESSION_COMMANDS,
};
