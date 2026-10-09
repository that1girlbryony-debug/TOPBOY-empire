/**
 * 🛠 src/commands/economy/social.js — Phase 2.5 batch 3
 *
 * Migrated from _economyLegacy.js:
 *   .marry             — propose to a user ($100M fee on accept)
 *   .divorce           — divorce ($50M each spouse — Phase 1 fix)
 *   .spouse            — view marriage status
 *   .marriageaccept    — accept a pending proposal
 *   .marriagereject    — reject a pending proposal
 *   .slap              — reaction GIF
 *   .kill              — reaction GIF
 *   .yeet              — reaction GIF
 *   .fuck              — reaction GIF (crude — Phase 3 will rename to .wild)
 *   .kiss              — reaction GIF
 *
 * Dependencies (via _shared.js):
 *   - MARRIAGE_FEE, DIVORCE_FEE
 *   - getGifAsMp4 (GIF → MP4 conversion for WhatsApp)
 *   - createRewardXP (factory)
 *
 * Shared state:
 *   - global._marriageProposals Map (proposal key → {proposer, target, chat, expiresAt})
 *
 * Also uses:
 *   - User model (../../models/User)
 *   - helpers: formatMoney, cleanId, normalizeJid
 *   - data/gifs.js (../../data/gif)
 */

const User = require("../../models/User");
const { formatMoney, cleanId, normalizeJid } = require("../../utils/helpers");
const gifs = require("../../data/gif");
const {
  MARRIAGE_FEE,
  DIVORCE_FEE,
  getGifAsMp4,
  createRewardXP,
} = require("./_shared");

const SOCIAL_COMMANDS = new Set([
  "marry", "divorce", "spouse",
  "marriageaccept", "marriagereject",
  "slap", "kill", "yeet", "fuck", "kiss"
]);

const REACTION_COMMANDS = ["slap", "kill", "yeet", "fuck", "kiss"];

const REACTION_CAPTIONS = {
  slap: (s, t) => `👋 @${s} slapped @${t}!`,
  kill: (s, t) => `💀 @${s} eliminated @${t}!`,
  yeet: (s, t) => `🚀 @${s} yeeted @${t}!`,
  fuck: (s, t) => `🔥 @${s} is wildin' with @${t}!`,
  kiss: (s, t) => `💋 @${s} kissed @${t}!`,
};

const PROPOSAL_MESSAGES = [
  "is on one knee promising to give you the whole world...",
  "says you've been on their mind 24/7 😏",
  "is ready to build an empire with you 👑",
  "promises to be yours forever 💕",
  "just can't imagine life without you ❤️",
  "is proposing with their heart in their hands 💍",
  "says you're the one they've been waiting for 🥺",
  "is kneeling before true love 🙏💕",
  "promises to love you through riches and poverty 💰",
  "says yes baby, let's do this forever 😘"
];

async function handle(ctx) {
  const { command, args, user, sender, reply, sock, chat, msg, isGroup } = ctx;

  // ── Reaction commands (.slap/.kill/.yeet/.fuck/.kiss) ───────
  if (REACTION_COMMANDS.includes(command)) {
    if (!isGroup)
      return reply("🚫 This command works in groups only.");

    const target = msg.message?.extendedTextMessage?.contextInfo?.mentionedJid?.[0];

    if (!target)
      return reply(`Usage: .${command} @user`);

    if (target === sender)
      return reply("🚫 You can't use this on yourself.");

    if (!gifs[command] || gifs[command].length === 0)
      return reply("⚠️ No GIFs available for this action.");

    const randomGif = gifs[command][Math.floor(Math.random() * gifs[command].length)];

    const senderName = sender.split("@")[0];
    const targetName = target.split("@")[0];
    const caption = REACTION_CAPTIONS[command](senderName, targetName);

    try {
      const mp4Buffer = await getGifAsMp4(randomGif);

      if (mp4Buffer) {
        await sock.sendMessage(
          chat,
          {
            video: mp4Buffer,
            gifPlayback: true,
            mimetype: "video/mp4",
            caption,
            mentions: [sender, target]
          },
          { quoted: msg }
        );
      } else {
        await sock.sendMessage(
          chat,
          {
            image: { url: randomGif },
            caption,
            mentions: [sender, target]
          },
          { quoted: msg }
        );
      }
    } catch (err) {
      console.error("GIF send failed:", err.message);
      reply(caption, [sender, target]);
    }
    return;
  }

  switch (command) {

    // =====================================================
    // 💍 MARRY
    // =====================================================
    case "marry": {
      if (!isGroup) return reply("🚫 Group only.");

      const target = msg.message?.extendedTextMessage?.contextInfo?.mentionedJid?.[0];

      if (!target) return reply("📝 Usage: *.marry @user*");
      if (target === sender) return reply("🚫 You can't marry yourself.");

      const partner = await User.findOne({ userId: target });
      if (!partner) return reply("❌ User not registered.");

      if (user.marriage) {
        return reply("💍 You're already married! Use *.divorce* first.");
      }
      if (partner.marriage) {
        return reply("💔 That person is already married.");
      }

      if (user.wallet < MARRIAGE_FEE) {
        return reply(`💒 Marriage costs $${formatMoney(MARRIAGE_FEE)}.\nYou only have $${formatMoney(user.wallet)}.`);
      }

      const proposalKey = `${sender}_${target}`;
      if (global._marriageProposals.has(proposalKey)) {
        return reply("⏳ Proposal already pending. Waiting for them to *.accept*");
      }

      global._marriageProposals.set(proposalKey, {
        proposer: sender,
        target,
        chat,
        expiresAt: Date.now() + 60000
      });

      const romanticText = PROPOSAL_MESSAGES[Math.floor(Math.random() * PROPOSAL_MESSAGES.length)];

      return reply(
`▬▬▬▬▬▬▬▬▬▬▬▬▬▬
*💍 MARRIAGE PROPOSAL*
▬▬▬▬▬▬▬▬▬▬▬▬▬▬

@${sender.split("@")[0]}
   ${romanticText}
@${target.split("@")[0]}

💰 Cost: $${formatMoney(MARRIAGE_FEE)}
⏳ 60 seconds to respond

✅ Type *.marriageaccept* to say YES
❌ Type *.marriagereject* to say NO

▬▬▬▬▬▬▬▬▬▬▬▬▬▬`,
        [sender, target]
      );
    }

    // =====================================================
    // 💔 DIVORCE
    // =====================================================
    case "divorce": {
      if (!user.marriage) return reply("💔 You're not married.");

      const spouseId = user.marriage.spouseId;
      const cost = DIVORCE_FEE; // $50M

      if (user.wallet < cost) {
        return reply(`💔 Divorce costs $${formatMoney(cost)}. Not enough funds.`);
      }

      // 🛠 FIX (Phase 1 / 1.3): charge BOTH spouses the fee
      const spouse = await User.findOne({ userId: spouseId });
      if (spouse && spouse.wallet < cost) {
        return reply(`💔 Both spouses must pay $${formatMoney(cost)} for divorce. Your spouse @${spouseId.split("@")[0]} doesn't have enough.`, [spouseId]);
      }

      // 🛠 FIX (Phase 1 / 1.1): atomic $inc on both
      await User.updateOne(
        { userId: sender },
        {
          $inc: { wallet: -cost },
          $set: { marriage: null }
        }
      ).catch(err => console.error("divorce initiator update failed:", err.message));

      if (spouse) {
        await User.updateOne(
          { userId: spouseId },
          {
            $inc: { wallet: -cost },
            $set: { marriage: null }
          }
        ).catch(err => console.error("divorce spouse update failed:", err.message));
      }

      return reply(
`▬▬▬▬▬▬▬▬▬▬▬▬▬▬
*💔 DIVORCED*
▬▬▬▬▬▬▬▬▬▬▬▬▬▬

@${sender.split("@")[0]} & @${spouseId.split("@")[0]}
are no longer married.

💰 Divorce cost: $${formatMoney(cost)} each
${spouse ? `💵 Total settlement: $${formatMoney(cost * 2)}` : ""}

▬▬▬▬▬▬▬▬▬▬▬▬▬▬`,
        [spouseId]
      );
    }

    // =====================================================
    // 💍 SPOUSE STATUS
    // =====================================================
    case "spouse": {
      if (!user.marriage) return reply("💔 You're not married. Use *.marry @user*");

      const spouseId = user.marriage.spouseId;
      const marriedAt = new Date(user.marriage.marriedAt);
      const days = Math.floor((Date.now() - marriedAt.getTime()) / 86400000);

      return reply(
`▬▬▬▬▬▬▬▬▬▬▬▬▬▬
*💍 MARRIAGE STATUS*
▬▬▬▬▬▬▬▬▬▬▬▬▬▬

💕 Partner: @${spouseId.split("@")[0]}
📅 Married: ${days} day${days !== 1 ? "s" : ""} ago
💖 Still going strong!

▬▬▬▬▬▬▬▬▬▬▬▬▬▬`,
        [spouseId]
      );
    }

    // =====================================================
    // ✅ MARRIAGE ACCEPT
    // =====================================================
    case "marriageaccept": {
      let foundProposal = null;
      let proposalKey = null;
      for (const [key, p] of global._marriageProposals) {
        if (normalizeJid(p.target) === normalizeJid(sender)) {
          foundProposal = p;
          proposalKey = key;
          break;
        }
      }

      if (!foundProposal) return reply("No pending marriage proposal for you.");

      global._marriageProposals.delete(proposalKey);

      const proposer = await User.findOne({ userId: foundProposal.proposer });
      const accepter = await User.findOne({ userId: sender });

      if (!proposer || !accepter) return reply("❌ Proposal expired — user not found.");
      if (proposer.marriage?.spouseId || accepter.marriage?.spouseId) return reply("💔 One of you is already married.");
      if (proposer.wallet < MARRIAGE_FEE) return reply(`💔 @${cleanId(foundProposal.proposer)} can't afford $${formatMoney(MARRIAGE_FEE)}.`, [foundProposal.proposer]);

      proposer.wallet -= MARRIAGE_FEE;
      proposer.marriage = { spouseId: sender, marriedAt: Date.now() };
      accepter.marriage = { spouseId: foundProposal.proposer, marriedAt: Date.now() };
      await proposer.save();
      await accepter.save();

      return reply(
`▬▬▬▬▬▬▬▬▬▬▬▬▬▬
*💒 MARRIED!*
▬▬▬▬▬▬▬▬▬▬▬▬▬▬

💍 @${cleanId(foundProposal.proposer)}
   ❤️
💍 @${cleanId(sender)}

💕 Forever and always.
💰 Wedding cost: $${formatMoney(MARRIAGE_FEE)}

▬▬▬▬▬▬▬▬▬▬▬▬▬▬`,
        [foundProposal.proposer, sender]
      );
    }

    // =====================================================
    // ❌ MARRIAGE REJECT
    // =====================================================
    case "marriagereject": {
      let foundProposal = null;
      let proposalKey = null;
      for (const [key, p] of global._marriageProposals) {
        if (normalizeJid(p.target) === normalizeJid(sender)) {
          foundProposal = p;
          proposalKey = key;
          break;
        }
      }

      if (!foundProposal) return reply("No pending marriage proposal for you.");

      global._marriageProposals.delete(proposalKey);
      return reply(
`▬▬▬▬▬▬▬▬▬▬▬▬▬▬
*💔 REJECTED*
▬▬▬▬▬▬▬▬▬▬▬▬▬▬

@${cleanId(sender)} said no to
@${cleanId(foundProposal.proposer)}'s proposal

▬▬▬▬▬▬▬▬▬▬▬▬▬▬`,
        [foundProposal.proposer]
      );
    }

    default:
      return false; // not handled
  }
}

module.exports = {
  handle,
  SOCIAL_COMMANDS,
};
