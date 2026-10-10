// 🛠 Phase 2 / 2.5: relocated from commands/admin.js to src/commands/admin/index.js
// Require paths updated to reflect new location (one extra ../).
const User = require("../../models/User");
const config = require("../../config");
const animeCards = require("../../data/animeCards");
const axios = require("axios");
const { formatMoney, cleanId, normalizeJid } = require("../../utils/helpers");

// Readable duration for cooldown messages (e.g. "9h 42m" instead of "34920s")
function formatCooldown(ms) {
    const totalSeconds = Math.ceil(ms / 1000);
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;
    if (hours > 0) return `${hours}h ${minutes}m`;
    if (minutes > 0) return `${minutes}m ${seconds}s`;
    return `${seconds}s`;
}

// Shared drop map — injected via economy module
let activeDrops;
try {
    activeDrops = require("../_economyLegacy").activeDrops;
} catch {
    activeDrops = new Map();
}

// ===============================
// 🗳 VOTE KICK SESSIONS (global so economy.js can access)
// ===============================
if (!global._voteKicks) global._voteKicks = new Map();
const voteKicks = global._voteKicks;

// Cleanup stale vote sessions every 2 minutes
setInterval(() => {
    const now = Date.now();
    for (const [chatId, session] of voteKicks) {
        if (now > session.expiresAt) {
            voteKicks.delete(chatId);
        }
    }
}, 120000);

// ===============================
// ⏱ TIME PARSER (m / d / h)
// ===============================
function parseBanDuration(input) {
    if (!input) return null;
    const match = input.match(/^(\d+)(m|h|d)$/i);
    if (!match) return null;
    const value = parseInt(match[1]);
    const unit = match[2].toLowerCase();
    if (unit === "m") return value * 60 * 1000;
    if (unit === "h") return value * 60 * 60 * 1000;
    if (unit === "d") return value * 24 * 60 * 60 * 1000;
    return null;
}

module.exports = async (context) => {
    const { command, args, sender, sock, chat, reply, msg, groupMetadata } = context;

    const senderId = sender.split("@")[0];
    const isGroup = chat.endsWith("@g.us");
    const isBotOwner = config.ownerNumbers.some(owner => owner.split("@")[0] === senderId);
    // 🛠 FIX (Phase 1 / 1.4): helper to check if ANY target JID is a bot
    // owner. Used by votekick/warn/kick to prevent group-admin actions
    // against the bot owner (who may not be a group admin in every chat).
    const isOwnerTarget = (jid) =>
        config.ownerNumbers.some(owner => owner.split("@")[0] === jid.split("@")[0]);

    let isGroupAdmin = false;
    let botIsAdmin = false;

    // ===============================
    // 🔐 GROUP & BOT ADMIN CHECK
    // ===============================
    if (isGroup) {
        try {
            const metadata = groupMetadata || await sock.groupMetadata(chat);

            // Sender admin check — normalize JIDs for @lid compatibility
            const senderNorm = normalizeJid(sender);
            const participant = metadata.participants.find(
                p => normalizeJid(p.id) === senderNorm
            );
            if (participant?.admin === "admin" || participant?.admin === "superadmin") {
                isGroupAdmin = true;
            }

            // Bot admin check — use hardcoded bot LID from config
            const botNorm = normalizeJid(config.botLid);
            const botParticipant = metadata.participants.find(
                p => normalizeJid(p.id) === botNorm
            );

            if (botParticipant?.admin === "admin" || botParticipant?.admin === "superadmin") {
                botIsAdmin = true;
            }

        } catch (err) {
            console.log("Admin detection error:", err.message);
        }
    }

    if (!isBotOwner && !isGroupAdmin)
        return reply("🚫 *ADMIN ACCESS DENIED*");

    // ===============================
    // 🎯 TARGET DETECTION
    // ===============================
    const mentioned = msg.message?.extendedTextMessage?.contextInfo?.mentionedJid?.[0];
    const replied = msg.message?.extendedTextMessage?.contextInfo?.participant;
    let target = mentioned || replied;
    if (!target && args[1]) {
        const number = args[1].replace(/[^0-9]/g, "");
        if (number.length > 5) {
            target = number + "@s.whatsapp.net";
        }
    }

    // ===============================
    // 🛠 COMMAND HANDLER
    // ===============================
    switch (command) {

        // ===============================
        // 📜 ADMIN MENU
        // ===============================
        case "admin":
            return reply(
`▬▬▬▬▬▬▬▬▬▬▬▬▬▬
*👑 ADMIN PANEL*
▬▬▬▬▬▬▬▬▬▬▬▬▬▬

🚫 .ban <2d/2h/2m> @user
✅ .unban @user
🎴 .seize col/bank/wallet/assets
💰 .addbal <amount> @user

🎁 .giveaway — random cash
🎴 .airdrop — card drop
🌧 .rain <amount> <count> — cash drop
🐕 .race — start a dog race
🔄 .reset — economy reset
📡 .broadcast <message>
📢 .tagall <message>
🔄 .cdr — reset gamble limits
⏳ .clearcooldowns @user

👢 .kick @user — remove
🗳 .votekick @user — vote kick
⚠️ .warn @user <reason>
⚠️ .warnings / .clearwarns @user
🧊 .freeze / .unfreeze @user
🐌 .slowmode <secs>/off
🔒 .mute / .unmute — lock the gc
🆔 .lid @user — get their @lid
🔗 .antilink on/off

🎯 .setxp / .setlevel @user
💍 .forcemarry @u1 @u2
💔 .forcedivorce @user
💻 .system — bot stats
🎬 .gifcheck — test GIF conversion
🔍 .info @user — why they're banned/frozen

▬▬▬▬▬▬▬▬▬▬▬▬▬▬`
            );

        // ===============================
        // 🚫 BAN WITH TIMER + REASON + AUTO-EXPIRY
        // ===============================
        case "ban": {
            if (!target) return reply("Usage: .ban <duration> <reason> @user (or reply)\ne.g. .ban 2d spamming links @user\ne.g. .ban scamming people @user  (permanent, no duration)");

            // 🛠 FIX (Phase 0 / E5): .ban writes to the User doc globally
            // (not scoped to this group), so a group admin in Group A could
            // ban a user from EVERY group the bot operates in — and even
            // ban the bot owner. Restricted to bot owner only.
            if (!isBotOwner) return reply("🚫 Owner only — .ban affects every group, not just this one.");

            const durationInput = args[0];
            const duration = parseBanDuration(durationInput);
            // 🆕 Everything after the duration (or everything, if no
            // duration was given) becomes the ban reason.
            // Note: if you use the raw-phone-number fallback for target
            // (no @mention/reply), that number may end up in the reason
            // text too — use @mention or reply when you want a clean
            // reason recorded.
            const reasonArgs = duration ? args.slice(1) : args.slice(0);
            const reason = reasonArgs.join(" ").trim() || "No reason given";

            const banData = {
                banned: true,
                banReason: reason,
                bannedBy: sender,
                bannedAt: Date.now()
            };
            banData.banUntil = duration ? Date.now() + duration : null;

            // 🛠 FIX: was User.updateOne() (goes through the Mongoose
            // schema layer, which silently drops fields the schema
            // doesn't define — that's why banReason/bannedBy/bannedAt
            // weren't sticking). .collection.updateOne() writes through
            // the raw MongoDB driver, bypassing schema validation, so
            // these fields save reliably no matter what's in the schema.
            await User.collection.updateOne({ userId: target }, { $set: banData }, { upsert: true });
            return reply(
`▬▬▬▬▬▬▬▬▬▬▬▬▬▬
*🚫 BANNED*
▬▬▬▬▬▬▬▬▬▬▬▬▬▬

@${cleanId(target)}
${duration ? `⏳ Duration: ${durationInput}` : "⚠️ PERMANENT"}
📝 Reason: ${reason}

▬▬▬▬▬▬▬▬▬▬▬▬▬▬`,
                [target]
            );
        }

        // ===============================
        // ✅ UNBAN
        // ===============================
        case "unban": {
            if (!target) return reply("Usage: .unban @user");
            // 🛠 FIX (Phase 0 / E5): .unban lifts a bot-wide ban (stored on
            // the User doc, not per-group). Group admins should not be able
            // to unban scammers the bot owner banned globally.
            if (!isBotOwner) return reply("🚫 Owner only — .unban affects every group, not just this one.");
            await User.collection.updateOne(
                { userId: target },
                { $set: { banned: false }, $unset: { banUntil: "", banReason: "", bannedBy: "", bannedAt: "" } }
            );
            return reply(`▬▬▬▬▬▬▬▬▬▬▬▬▬▬
*✅ UNBANNED*
▬▬▬▬▬▬▬▬▬▬▬▬▬▬\n\n@${cleanId(target)}\nFreedom restored.\n
▬▬▬▬▬▬▬▬▬▬▬▬▬▬`, [target]);
        }

        // ===============================
        // 🔍 INFO — moderation lookup for a user (ban reason, warnings,
        // freeze status). Answers "why was this person banned?"
        // ===============================
        case "info": {
            if (!target) return reply("Usage: .info @user (or reply)");
            // 🛠 FIX (Phase 0 / E5): .info exposes bot-wide moderation data
            // (ban reason, banner, freeze reason) for ANY phone number —
            // not just members of this group. Group admins shouldn't have
            // global visibility into who banned whom across all groups.
            if (!isBotOwner) return reply("🚫 Owner only — .info exposes bot-wide moderation records.");

            // 🛠 Raw collection read — guarantees we see banReason/afk/etc
            // even if they aren't declared in the Mongoose schema.
            const userDB = await User.collection.findOne({ userId: target });
            if (!userDB) return reply(`❌ @${cleanId(target)} isn't registered.`, [target]);

            let text = `▬▬▬▬▬▬▬▬▬▬▬▬▬▬\n*🔍 USER INFO*\n▬▬▬▬▬▬▬▬▬▬▬▬▬▬\n\n@${cleanId(target)}\n\n`;

            if (userDB.banned) {
                text += `🚫 *BANNED*\n`;
                text += `📝 Reason: ${userDB.banReason || "No reason recorded"}\n`;
                text += userDB.banUntil
                    ? `⏳ Until: ${new Date(userDB.banUntil).toLocaleString()}\n`
                    : `⚠️ Permanent\n`;
                if (userDB.bannedBy) text += `👮 Banned by: @${cleanId(userDB.bannedBy)}\n`;
                if (userDB.bannedAt) text += `📅 Banned on: ${new Date(userDB.bannedAt).toLocaleDateString()}\n`;
            } else {
                text += `✅ Not banned\n`;
            }

            const frozenReason = global._frozenUsers?.get(target);
            text += frozenReason ? `🧊 Frozen: ${frozenReason}\n` : `✅ Not frozen\n`;

            const warnings = global._warnings?.get(`${chat}:${target}`) || [];
            text += `⚠️ Warnings (this group): ${warnings.length}/3\n`;

            text += `\n▬▬▬▬▬▬▬▬▬▬▬▬▬▬`;

            // 🛠 FIX: WhatsApp only renders "@number" as a proper
            // clickable mention (showing the person's saved name) if
            // that JID is included in the message's mentions array —
            // bannedBy was shown in the text but never added here, so
            // it displayed as plain raw digits instead of a mention.
            const infoMentions = [target];
            if (userDB.bannedBy && userDB.bannedBy !== "system") infoMentions.push(userDB.bannedBy);

            return reply(text, infoMentions);
        }

        // ===============================
        // 💰 ADD BALANCE
        // ===============================
        case "addbal": {
            if (!isBotOwner) return reply("🚫 Owner only.");
            const amount = parseInt(args[0]);
            if (!target || isNaN(amount)) return reply("Usage: .addbal <amount> @user");

            const userDB = await User.findOne({ userId: target });
            if (!userDB) return reply("User not found.");

            userDB.wallet += amount;
            await userDB.save();
            return reply(`▬▬▬▬▬▬▬▬▬▬▬▬▬▬
*💰 FUNDS ADDED*
▬▬▬▬▬▬▬▬▬▬▬▬▬▬\n\n@${cleanId(target)}\n💵 +$${formatMoney(amount)}\n
▬▬▬▬▬▬▬▬▬▬▬▬▬▬`, [target]);
        }

        // ===============================
        // 🎴 SEIZE SYSTEM
        // ===============================
        case "seize": {
            if (!isBotOwner) return reply("🚫 Owner only.");
            const type = args[0]?.toLowerCase();
            if (!target) return reply("Usage: .seize col/bank/wallet/assets @user");

            const userDB = await User.findOne({ userId: target });
            if (!userDB) return reply("User not found.");

            switch (type) {
                case "col": {
                    const count = userDB.collection?.length || 0;
                    userDB.collection = [];
                    await userDB.save();
                    return reply(`▬▬▬▬▬▬▬▬▬▬▬▬▬▬
*⚠️ SEIZED*
▬▬▬▬▬▬▬▬▬▬▬▬▬▬\n\n🎴 @${cleanId(target)}'s cards\nRemoved ${count} cards\n
▬▬▬▬▬▬▬▬▬▬▬▬▬▬`, [target]);
                }
                case "bank": {
                    const bank = userDB.bank;
                    userDB.bank = 0;
                    await userDB.save();
                    return reply(`▬▬▬▬▬▬▬▬▬▬▬▬▬▬
*⚠️ SEIZED*
▬▬▬▬▬▬▬▬▬▬▬▬▬▬\n\n🏦 @${cleanId(target)}'s bank\nRemoved $${formatMoney(bank)}\n
▬▬▬▬▬▬▬▬▬▬▬▬▬▬`, [target]);
                }
                case "wallet": {
                    const wallet = userDB.wallet;
                    userDB.wallet = 0;
                    await userDB.save();
                    return reply(`▬▬▬▬▬▬▬▬▬▬▬▬▬▬
*⚠️ SEIZED*
▬▬▬▬▬▬▬▬▬▬▬▬▬▬\n\n💰 @${cleanId(target)}'s wallet\nRemoved $${formatMoney(wallet)}\n
▬▬▬▬▬▬▬▬▬▬▬▬▬▬`, [target]);
                }
                case "assets": {
                    const assets = userDB.assets?.length || 0;
                    userDB.assets = [];
                    await userDB.save();
                    return reply(`▬▬▬▬▬▬▬▬▬▬▬▬▬▬
*⚠️ SEIZED*
▬▬▬▬▬▬▬▬▬▬▬▬▬▬\n\n🏢 @${cleanId(target)}'s assets\nRemoved ${assets} businesses\n
▬▬▬▬▬▬▬▬▬▬▬▬▬▬`, [target]);
                }
                default:
                    return reply("Usage: .seize col/bank/wallet/assets @user");
            }
        }

        // ===============================
        // 🔄 RESET GAMBLE LIMIT
        // ===============================
        case "cdr": {
            if (!isBotOwner) return reply("🚫 Owner only.");
            await User.updateMany({}, { $unset: { gambleStats: "" } });
            return reply("♻️ All daily gamble limits reset globally.");
        }

        // ===============================
        // 📢 TAG ALL
        // ===============================
        case "tagall": {
            if (!isGroup) return reply("🚫 Group only.");
            const metadata = groupMetadata || await sock.groupMetadata(chat);
            const members = metadata.participants.map(p => p.id);
            const message = args.join(" ") || "Attention everyone!";
            await sock.sendMessage(chat, {
                text: `📢 *EMPIRE ANNOUNCEMENT*\n\n${message}`,
                mentions: members
            }, { quoted: msg });
            return;
        }

        // ===============================
        // 👢 KICK (SAFE — can't kick other admins)
        // ===============================
        case "kick": {
            if (!isGroup) return reply("🚫 Group only.");
            if (!botIsAdmin) return reply("🚫 Bot must be admin.");
            if (!target) return reply("Usage: .kick @user");

            // Safety: prevent kicking group admins unless done by bot owner
            const metadata = groupMetadata || await sock.groupMetadata(chat);
            const targetParticipant = metadata.participants.find(
                p => p.id.split("@")[0] === target.split("@")[0]
            );

            if (targetParticipant?.admin === "admin" || targetParticipant?.admin === "superadmin") {
                if (!isBotOwner) return reply("🚫 Cannot kick another admin.");
            }

            // Can't kick the bot itself
            const botNum = sock.user.id.split(":")[0].replace(/[^0-9]/g, "");
            if (target.split("@")[0].replace(/[^0-9]/g, "") === botNum) {
                return reply("🚫 Cannot kick myself.");
            }

            await sock.groupParticipantsUpdate(chat, [target], "remove");
            return reply(`👢 @${cleanId(target)} has been removed.`, [target]);
        }

        // ===============================
        // 🗳 DEMOCRATIC VOTE KICK
        // ===============================
        case "votekick": {
            if (!isGroup) return reply("🚫 Group only.");
            if (!botIsAdmin) return reply("🚫 Bot must be admin.");
            if (!target) return reply("Usage: .votekick @user");

            // Don't allow starting a new vote if one is active
            if (voteKicks.has(chat)) {
                return reply("⚠️ A vote kick is already active. Use *.yes* or *.no*.");
            }

            // Can't votekick admins
            const metadata = groupMetadata || await sock.groupMetadata(chat);
            const targetP = metadata.participants.find(
                p => normalizeJid(p.id) === normalizeJid(target)
            );
            if (targetP?.admin === "admin" || targetP?.admin === "superadmin") {
                return reply("🚫 Cannot vote-kick an admin.");
            }

            // Can't votekick the bot
            if (normalizeJid(target) === normalizeJid(config.botLid)) {
                return reply("🚫 Can't vote-kick me.");
            }

            // 🛠 FIX (Phase 1 / 1.4): Can't votekick the bot owner. The
            // owner may not be a WhatsApp group admin in every chat, so
            // the existing admin-check above doesn't catch them. Without
            // this check, a coalition of regular users could vote-kick
            // the owner out of their own authorized group, which then
            // triggers the unauthorized-group check (auto-leave + ban).
            if (isOwnerTarget(target)) {
                return reply("🚫 Can't vote-kick the bot owner.");
            }

            voteKicks.set(chat, {
                target,
                initiator: sender,
                yesVotes: new Set(),
                noVotes: new Set(),
                expiresAt: Date.now() + 60000
            });

            // Auto-expire after 60s
            setTimeout(async () => {
                const session = voteKicks.get(chat);
                if (!session) return;
                voteKicks.delete(chat);

                const yes = session.yesVotes.size;
                const no = session.noVotes.size;

                if (yes > no) {
                    try {
                        await sock.groupParticipantsUpdate(chat, [session.target], "remove");
                        await sock.sendMessage(chat, {
                            text: `▬▬▬▬▬▬▬▬▬▬▬▬▬▬
*🗳 VOTE RESULT*
▬▬▬▬▬▬▬▬▬▬▬▬▬▬\n\n✅ Kick wins (${yes} - ${no})\n👢 @${cleanId(session.target)} removed\n
▬▬▬▬▬▬▬▬▬▬▬▬▬▬`,
                            mentions: [session.target]
                        });
                    } catch {
                        await sock.sendMessage(chat, {
                            text: `🗳 Vote passed but failed to remove user.`
                        });
                    }
                } else {
                    await sock.sendMessage(chat, {
                        text: `▬▬▬▬▬▬▬▬▬▬▬▬▬▬
*🗳 VOTE RESULT*
▬▬▬▬▬▬▬▬▬▬▬▬▬▬\n\n❌ Stay wins (${no} - ${yes})\n@${cleanId(session.target)} stays\n
▬▬▬▬▬▬▬▬▬▬▬▬▬▬`,
                        mentions: [session.target]
                    });
                }
            }, 60000); // 🛠 FIX (Phase 3 / 3.5): was 30000 but announcement says 60s

            return reply(
`▬▬▬▬▬▬▬▬▬▬▬▬▬▬
*🗳 VOTE KICK*
▬▬▬▬▬▬▬▬▬▬▬▬▬▬

Target: @${cleanId(target)}
Started by: @${cleanId(sender)}

⏰ 60 seconds

✅ *.yes* — Kick them
❌ *.no* — Let them stay

▬▬▬▬▬▬▬▬▬▬▬▬▬▬`,
                [target, sender]
            );
        }

        // ===============================
        // 🔗 ANTILINK
        // ===============================
        case "antilink": {
            if (!isGroup) return reply("🚫 Group only.");
            const state = args[0]?.toLowerCase();
            if (!["on", "off"].includes(state)) return reply("Usage: .antilink on/off");
            await User.updateOne(
                { userId: chat },
                { $set: { isGroup: true, antilink: state === "on" } },
                { upsert: true }
            );
            return reply(`🔗 Antilink turned *${state.toUpperCase()}*.`);
        }

        // ===============================
        // 🎁 GIVEAWAY (BATCH WRITE)
        // ===============================
        case "giveaway": {
            if (!isBotOwner) return reply("🚫 Owner only.");
            if (!isGroup) return reply("🚫 Use inside a group.");

            const metadata = groupMetadata || await sock.groupMetadata(chat);
            const members = metadata.participants.map(p => p.id);
            let messageText = "🎁 *EMPIRE GIVEAWAY*\n\n";
            const mentions = [];

            // Batch all updates into one bulkWrite for performance
            const ops = [];
            for (const userId of members) {
                const amount = Math.floor(Math.random() * 200000) + 50000;
                ops.push({
                    updateOne: {
                        filter: { userId },
                        update: { $inc: { wallet: amount } },
                        upsert: true
                    }
                });
                messageText += `@${cleanId(userId)} received $${formatMoney(amount)}\n`;
                mentions.push(userId);
            }

            if (ops.length > 0) {
                await User.bulkWrite(ops);
            }

            await sock.sendMessage(chat, { text: messageText, mentions });
            return;
        }

        // ===============================
        // 🎴 MANUAL AIRDROP
        // ===============================
        case "airdrop": {
            if (!isBotOwner) return reply("🚫 Owner only.");
            if (!isGroup) return reply("🚫 Group only.");

            // 🛠 FIX (Phase 4 / 4.3): don't overwrite an active drop —
            // users racing to .claim the current card would lose it.
            if (activeDrops.has(chat))
                return reply("⚠️ A card drop is already active. Wait for it to be claimed or expire.");

            const metadata = groupMetadata || await sock.groupMetadata(chat);
            const mentions = metadata.participants.map(p => p.id);
            const card = animeCards[Math.floor(Math.random() * animeCards.length)];

            activeDrops.set(chat, { ...card });
            await sock.sendMessage(chat, {
                image: { url: card.image },
                caption: `🎴 *ADMIN AIRDROP SPIN!*\n\n🏷 Name: ${card.name}\n✨ Tier: ${card.tier}\n💰 Worth: $${formatMoney(card.worth)}\n\n⚡ First to type *.claim* wins!`,
                mentions
            }, { quoted: msg });

            return;
        }

        // ===============================
        // 🔄 RESET ECONOMY
        // 🛠 FIXED: MongoDB's updateMany() rejects a plain replacement
        // document — it requires atomic operators like $set, or it
        // throws "multi update only works with $ operators". This
        // command was crashing every time it was run.
        // ===============================
        case "reset": {
            if (!isBotOwner) return reply("🚫 Owner only.");

            // 🛠 FIX (Phase 3 / 3.5): was $200,000 but .register gives $2,000.
            // 100× gap distorted the leaderboard post-reset. Now matches.
            await User.updateMany({}, {
                $set: {
                    wallet: 2000,
                    bank: 0,
                    debt: 0,
                    assets: [],
                    collection: [],
                    tools: { shield: 0, gun: 0 },
                    level: 1,
                    xp: 0,
                    streak: 0
                }
            });

            return reply("💥 ECONOMY RESET COMPLETE.\nEveryone now has $2,000 (matches .register).");
        }

        // ===============================
        // 📡 BROADCAST (DELAYED TO AVOID RATE LIMITS)
        // ===============================
        case "broadcast": {
            if (!isBotOwner) return reply("🚫 Owner only.");
            const message = args.join(" ");
            if (!message) return reply("Usage: .broadcast <message>");

            const users = await User.find({}, "userId");
            reply(`📡 Broadcasting to ${users.length} users...`);

            let sent = 0;
            for (const u of users) {
                try {
                    await sock.sendMessage(u.userId, {
                        text: `📢 GLOBAL ANNOUNCEMENT\n\n${message}`
                    });
                    sent++;
                } catch {}
                // Small delay to avoid WhatsApp rate limiting
                await new Promise(res => setTimeout(res, 200));
            }

            return reply(`▬▬▬▬▬▬▬▬▬▬▬▬▬▬
*📡 BROADCAST*
▬▬▬▬▬▬▬▬▬▬▬▬▬▬\n\n✅ Sent to ${sent}/${users.length} users\n
▬▬▬▬▬▬▬▬▬▬▬▬▬▬`);
        }

        // ===============================
        // 🧠 TRIVIA QUIZ (Admin-triggered, pings group)
        // ===============================
        case "trivia": {
            if (!isGroup) return reply("🚫 Group only.");

            // 🆕 Only the bot owner can spam quiz freely. Other group
            // admins get a cooldown so they can't spam-ping everyone.
            if (!isBotOwner) {
                if (!global._quizAdminCooldown) global._quizAdminCooldown = new Map();
                const QUIZ_ADMIN_COOLDOWN = 10 * 60 * 60 * 1000; // 10 hours
                const last = global._quizAdminCooldown.get(sender) || 0;
                const remaining = QUIZ_ADMIN_COOLDOWN - (Date.now() - last);
                if (remaining > 0) {
                    return reply(`⏳ Only the main owner can spam quiz anytime. Try again in ${formatCooldown(remaining)}.`);
                }
                global._quizAdminCooldown.set(sender, Date.now());
            }

            // Ping all group members
            const metadata = groupMetadata || await sock.groupMetadata(chat);
            const mentions = metadata.participants.map(p => p.id);

            const { spawnTrivia } = require("../_economyLegacy");
            const success = await spawnTrivia(sock, chat, mentions);

            if (!success) {
                return reply("❌ Quiz failed to spawn (API error or already active).");
            }
            return;
        }

        // ===============================
        // 🧠 MULTI-QUESTION QUIZ (Admin .quiz)
        // ===============================
        case "quiz": {
            if (!isGroup) return reply("🚫 Group only.");

            // 🆕 Same owner-bypass rate limit as .qa
            if (!isBotOwner) {
                if (!global._quizAdminCooldown) global._quizAdminCooldown = new Map();
                const QUIZ_ADMIN_COOLDOWN = 10 * 60 * 60 * 1000; // 10 hours
                const last = global._quizAdminCooldown.get(sender) || 0;
                const remaining = QUIZ_ADMIN_COOLDOWN - (Date.now() - last);
                if (remaining > 0) {
                    return reply(`⏳ Only the main owner can spam quiz anytime. Try again in ${formatCooldown(remaining)}.`);
                }
                global._quizAdminCooldown.set(sender, Date.now());
            }

            // Ping all group members
            const metadata = groupMetadata || await sock.groupMetadata(chat);
            const mentions = metadata.participants.map(p => p.id);

            // Default 10 questions, allow 1-20
            const questionCount = Math.min(20, Math.max(1, parseInt(args[0]) || 10));

            const { spawnMultiTrivia } = require("../_economyLegacy");
            const success = await spawnMultiTrivia(sock, chat, mentions, questionCount);

            if (!success) {
                return reply("❌ Multi-quiz failed to spawn (API error or already active).");
            }
            return reply(`🎯 Spawning ${questionCount} questions! Winner takes $50,000,000 🏆`);
        }

        // ===============================
        // ⬆️ PROMOTE (Owner only)
        // ===============================
        case "promote": {
            if (!isBotOwner) return reply("🚫 Owner only.");
            if (!isGroup) return reply("🚫 Group only.");

            const target = msg.message?.extendedTextMessage?.contextInfo?.mentionedJid?.[0];
            if (!target) return reply("📝 Usage: *.promote @user*");

            // Get group metadata
            const metadata = groupMetadata || await sock.groupMetadata(chat);
            const botNorm = normalizeJid(config.botLid);
            const isBotAdmin = metadata.participants.some(p => 
                normalizeJid(p.id) === botNorm && (p.admin === "admin" || p.admin === "superadmin")
            );

            if (!isBotAdmin) return reply("❌ I need admin rights to promote.");

            // Promote target to admin
            await sock.groupParticipantsUpdate(chat, [target], "promote");

            return reply(
`▬▬▬▬▬▬▬▬▬▬▬▬▬▬
*⬆️ PROMOTED*
▬▬▬▬▬▬▬▬▬▬▬▬▬▬

👑 @${target.split("@")[0]} is now admin!

✅ Promotion granted

▬▬▬▬▬▬▬▬▬▬▬▬▬▬`,
                [target]
            );
        }

        // ===============================
        // 🔒 MUTE (lock the group — only admins can send)
        // ===============================
        case "mute": {
            if (!isGroup) return reply("🚫 Group only.");
            if (!botIsAdmin) return reply("🚫 Bot must be admin to lock the group.");

            try {
                await sock.groupSettingUpdate(chat, "announcement");
            } catch (err) {
                console.error("Mute error:", err.message);
                return reply("❌ Couldn't lock the group — check my admin permissions.");
            }

            return reply(
`▬▬▬▬▬▬▬▬▬▬▬▬▬▬
*🔒 GROUP MUTED*
▬▬▬▬▬▬▬▬▬▬▬▬▬▬

Only admins can send messages now.
Use *.unmute* to open it back up.

▬▬▬▬▬▬▬▬▬▬▬▬▬▬`
            );
        }

        // ===============================
        // 🔓 UNMUTE (unlock the group)
        // ===============================
        case "unmute": {
            if (!isGroup) return reply("🚫 Group only.");
            if (!botIsAdmin) return reply("🚫 Bot must be admin to unlock the group.");

            try {
                await sock.groupSettingUpdate(chat, "not_announcement");
            } catch (err) {
                console.error("Unmute error:", err.message);
                return reply("❌ Couldn't unlock the group — check my admin permissions.");
            }

            return reply(
`▬▬▬▬▬▬▬▬▬▬▬▬▬▬
*🔓 GROUP UNMUTED*
▬▬▬▬▬▬▬▬▬▬▬▬▬▬

Everyone can send messages again.

▬▬▬▬▬▬▬▬▬▬▬▬▬▬`
            );
        }

        // ===============================
        // 🆔 LID — get the raw @lid / jid string for a tagged or
        // replied-to user. Handy for filling in config.js fields
        // like ownerNumbers or botLid, or just debugging who's who.
        // Different Baileys versions expose this data slightly
        // differently, so this dumps every candidate field it can
        // find rather than guessing — same approach as .debug.
        // ===============================
        case "lid": {
            if (!isGroup) return reply("🚫 Group only.");
            if (!target) return reply("📝 Usage: *.lid @user* (or reply to their message)");

            let text = `▬▬▬▬▬▬▬▬▬▬▬▬▬▬
*🆔 LID LOOKUP*
▬▬▬▬▬▬▬▬▬▬▬▬▬▬\n\n
▬▬▬▬▬▬▬▬▬▬▬▬▬▬`;
            text += `Tagged/replied JID: ${target}\n`;

            try {
                const metadata = groupMetadata || await sock.groupMetadata(chat);
                const targetNorm = normalizeJid(target);

                // Try a direct id match first, then fall back to matching
                // just the phone-number portion in case of @lid vs
                // @s.whatsapp.net mismatches.
                let participant = metadata.participants.find(p => normalizeJid(p.id) === targetNorm);
                if (!participant) {
                    const targetDigits = target.split("@")[0].replace(/[^0-9]/g, "");
                    participant = metadata.participants.find(
                        p => p.id.split("@")[0].replace(/[^0-9]/g, "") === targetDigits
                    );
                }

                if (participant) {
                    text += `\nGroup participant.id: ${participant.id}`;
                    if (participant.lid) text += `\nGroup participant.lid: ${participant.lid}`;
                    if (participant.jid) text += `\nGroup participant.jid: ${participant.jid}`;
                    text += `\nAdmin status: ${participant.admin || "member"}`;
                } else {
                    text += `\n⚠️ Couldn't find this user in the group's participant list.`;
                }
            } catch (err) {
                text += `\n⚠️ Metadata lookup failed: ${err.message}`;
            }

            return reply(text, [target]);
        }

        // ===============================
        // ⬇️ DEMOTE (Owner only)
        // ===============================
        case "demote": {
            if (!isBotOwner) return reply("🚫 Owner only.");
            if (!isGroup) return reply("🚫 Group only.");


            const target = msg.message?.extendedTextMessage?.contextInfo?.mentionedJid?.[0];
            if (!target) return reply("📝 Usage: *.demote @user*");

            // Get group metadata
            const metadata = groupMetadata || await sock.groupMetadata(chat);
            const botNorm = normalizeJid(config.botLid);
            const isBotAdmin = metadata.participants.some(p => 
                normalizeJid(p.id) === botNorm && (p.admin === "admin" || p.admin === "superadmin")
            );

            if (!isBotAdmin) return reply("❌ I need admin rights to demote.");

            // Demote target from admin
            await sock.groupParticipantsUpdate(chat, [target], "demote");

            return reply(
`▬▬▬▬▬▬▬▬▬▬▬▬▬▬
*⬇️ DEMOTED*
▬▬▬▬▬▬▬▬▬▬▬▬▬▬

👤 @${target.split("@")[0]} is no longer admin.

✅ Demotion complete

▬▬▬▬▬▬▬▬▬▬▬▬▬▬`,
                [target]
            );
        }

        // ===============================
        // ⚠️ WARNING SYSTEM (in-memory — resets on bot restart
        // unless you later add persistent fields to your User model)
        // ===============================
        case "warn": {
            if (!target) return reply("Usage: .warn @user <reason>");
            // 🛠 FIX (Phase 1 / 1.4): block warnings against the bot owner
            // entirely. The 3-warning auto-kick could otherwise be used by
            // group admins to remove the owner from their own authorized
            // group. (Kicking via .warn admin-powers is also blocked at
            // the WhatsApp layer for promoted admins, but the owner may
            // not be a group admin in every chat.)
            if (isOwnerTarget(target)) {
                return reply("🚫 Can't warn the bot owner.");
            }
            if (!global._warnings) global._warnings = new Map();

            const reason = args.slice(1).join(" ") || "No reason given";
            const key = `${chat}:${target}`;
            const list = global._warnings.get(key) || [];
            list.push({ reason, at: Date.now() });
            global._warnings.set(key, list);

            if (list.length >= 3) {
                global._warnings.delete(key);

                // 🛠 FIX (Phase 1 / 1.4): belt-and-suspenders — re-check
                // target is the owner before kicking (in case the owner
                // list was edited between the early check and now).
                if (isOwnerTarget(target)) {
                    return reply("🚫 Can't auto-kick the bot owner.");
                }
                if (botIsAdmin) {
                    try {
                        await sock.groupParticipantsUpdate(chat, [target], "remove");
                        return reply(
`*⚠️ 3 WARNINGS REACHED*

@${cleanId(target)} has been removed from the group.
`,
                            [target]
                        );
                    } catch {
                        return reply(`⚠️ @${cleanId(target)} hit 3 warnings but I couldn't remove them — check my admin rights.`, [target]);
                    }
                }
                return reply(`⚠️ @${cleanId(target)} hit 3 warnings! (I'd need admin rights to auto-kick)`, [target]);
            }

            return reply(
`*⚠️ WARNING ISSUED*

@${cleanId(target)}
Reason: ${reason}
Warnings: ${list.length}/3
`,
                [target]
            );
        }

        case "warnings": {
            if (!target) return reply("Usage: .warnings @user");
            const list = global._warnings?.get(`${chat}:${target}`) || [];
            if (!list.length) return reply(`✅ @${cleanId(target)} has no warnings.`, [target]);

            let text = `*⚠️ WARNINGS: @${cleanId(target)}*\n\n`;
            list.forEach((w, i) => { text += `${i + 1}. ${w.reason}\n`; });
            text += `\n${list.length}/3`;
            return reply(text, [target]);
        }

        case "clearwarns": {
            if (!target) return reply("Usage: .clearwarns @user");
            global._warnings?.delete(`${chat}:${target}`);
            return reply(`✅ Warnings cleared for @${cleanId(target)}.`, [target]);
        }

        // ===============================
        // 🧊 FREEZE — block a user from all economy commands without
        // a full ban (checked in economy.js)
        // ===============================
        case "freeze": {
            if (!target) return reply("Usage: .freeze @user <reason>");
            // 🛠 FIX (Phase 0 / E5): freeze map is keyed by raw JID, not by
            // group, so a freeze blocks the user from the economy in EVERY
            // group the bot operates in. Restricted to bot owner.
            if (!isBotOwner) return reply("🚫 Owner only — freeze affects every group, not just this one.");
            if (!global._frozenUsers) global._frozenUsers = new Map();

            const reason = args.slice(1).join(" ") || "No reason given";
            global._frozenUsers.set(target, reason);
            return reply(`🧊 @${cleanId(target)} is frozen out of the economy.\nReason: ${reason}`, [target]);
        }

        case "unfreeze": {
            if (!target) return reply("Usage: .unfreeze @user");
            // 🛠 FIX (Phase 0 / E5): mirror .freeze — bot-wide effect, owner only.
            if (!isBotOwner) return reply("🚫 Owner only — freeze affects every group, not just this one.");
            global._frozenUsers?.delete(target);
            return reply(`✅ @${cleanId(target)} can use the economy again.`, [target]);
        }

        // ===============================
        // 🐌 SLOWMODE — extra per-chat cooldown for non-admins,
        // stacked on top of the normal 7s antispam
        // ===============================
        case "slowmode": {
            if (!isGroup) return reply("🚫 Group only.");
            if (!global._slowmode) global._slowmode = new Map();

            const arg = args[0]?.toLowerCase();
            if (arg === "off") {
                global._slowmode.delete(chat);
                return reply("✅ Slowmode disabled.");
            }

            const seconds = parseInt(arg);
            if (isNaN(seconds) || seconds <= 0)
                return reply("Usage: .slowmode <seconds>  or  .slowmode off");

            // 🛠 FIX (Phase 4 / 4.2): cap slowmode at 3600s (1h).
            // Without this, a group admin could set .slowmode 999999999
            // (31 years) and permanently lock out all non-admins.
            // Values above 3600 require bot owner.
            const MAX_SLOWMODE = 3600;
            if (seconds > MAX_SLOWMODE && !isBotOwner)
                return reply(`🚫 Max slowmode is ${MAX_SLOWMODE}s (1h). Ask the bot owner for higher.`);

            global._slowmode.set(chat, seconds);
            return reply(`🐌 Slowmode set: ${seconds}s between commands for non-admins.`);
        }

        // ===============================
        // 🎯 SET XP / LEVEL — fun prize-giving control for events
        // ===============================
        case "setxp": {
            if (!isBotOwner) return reply("🚫 Owner only.");
            const amount = parseInt(args[0]);
            if (!target || isNaN(amount)) return reply("Usage: .setxp <amount> @user");

            const userDB = await User.findOne({ userId: target });
            if (!userDB) return reply("User not found.");

            userDB.xp = amount;
            await userDB.save();
            return reply(`✅ @${cleanId(target)}'s XP set to ${amount}.`, [target]);
        }

        case "setlevel": {
            if (!isBotOwner) return reply("🚫 Owner only.");
            const level = parseInt(args[0]);
            if (!target || isNaN(level) || level < 1) return reply("Usage: .setlevel <level> @user");

            const userDB = await User.findOne({ userId: target });
            if (!userDB) return reply("User not found.");

            userDB.level = level;
            userDB.xp = 0;
            await userDB.save();
            return reply(`✅ @${cleanId(target)} is now level ${level}.`, [target]);
        }

        // ===============================
        // ⏳ CLEAR COOLDOWNS — reset one user's cooldowns (individual
        // version of .cdr, which resets everyone's gamble limits)
        // ===============================
        case "clearcooldowns": {
            if (!target) return reply("Usage: .clearcooldowns @user");
            // 🛠 FIX (Phase 0 / E5): wipes the target's cooldowns Map across
            // ALL groups (gamble cooldowns, rob cooldowns, daily claim, etc.).
            // Group admins shouldn't be able to grant themselves or friends
            // unlimited spins/daily claims. Restricted to bot owner.
            if (!isBotOwner) return reply("🚫 Owner only — cooldowns are bot-wide, not group-scoped.");
            const userDB = await User.findOne({ userId: target });
            if (!userDB) return reply("User not found.");

            userDB.cooldowns = new Map();
            await userDB.save();
            return reply(`✅ Cooldowns cleared for @${cleanId(target)}.`, [target]);
        }

        // ===============================
        // 🌧 RAIN — instantly split a pot of cash among N random
        // group members (different flavor from .giveaway, which
        // pays everyone a small random amount instead)
        // ===============================
        case "rain": {
            if (!isBotOwner) return reply("🚫 Owner only.");
            if (!isGroup) return reply("🚫 Group only.");

            const amount = parseInt(args[0]);
            const count = parseInt(args[1]) || 5;
            if (isNaN(amount) || amount <= 0)
                return reply("Usage: .rain <total amount> <winner count>");

            const metadata = groupMetadata || await sock.groupMetadata(chat);
            const botNorm = normalizeJid(config.botLid);
            const members = metadata.participants
                .map(p => p.id)
                .filter(id => normalizeJid(id) !== botNorm);

            const shuffled = [...members].sort(() => Math.random() - 0.5);
            const winners = shuffled.slice(0, Math.min(count, members.length));
            if (!winners.length) return reply("❌ No eligible members to rain on.");

            const share = Math.floor(amount / winners.length);
            const ops = winners.map(userId => ({
                updateOne: {
                    filter: { userId },
                    update: { $inc: { wallet: share } },
                    upsert: true
                }
            }));
            await User.bulkWrite(ops);

            let text = `*🌧 CASH RAIN!*\n\n`;
            winners.forEach(id => { text += `💰 @${cleanId(id)} caught $${formatMoney(share)}\n`; });
            return reply(text, winners);
        }

        // ===============================
        // 💍 FORCE MARRY / DIVORCE — fun admin override for events,
        // no fee charged either way
        // ===============================
        case "forcemarry": {
            if (!isBotOwner) return reply("🚫 Owner only.");
            const mentions = msg.message?.extendedTextMessage?.contextInfo?.mentionedJid || [];
            if (mentions.length < 2) return reply("Usage: .forcemarry @user1 @user2");

            const [a, b] = mentions;
            const userA = await User.findOne({ userId: a });
            const userB = await User.findOne({ userId: b });
            if (!userA || !userB) return reply("❌ Both users must be registered.");

            userA.marriage = { spouseId: b, marriedAt: Date.now() };
            userB.marriage = { spouseId: a, marriedAt: Date.now() };
            await userA.save();
            await userB.save();

            return reply(
`*💍 FORCED MARRIAGE*

@${cleanId(a)} 💍 @${cleanId(b)}

Admin magic — no fee charged!
`,
                [a, b]
            );
        }

        case "forcedivorce": {
            if (!isBotOwner) return reply("🚫 Owner only.");
            if (!target) return reply("Usage: .forcedivorce @user");

            const userDB = await User.findOne({ userId: target });
            if (!userDB || !userDB.marriage) return reply("❌ That user isn't married.");

            const spouseId = userDB.marriage.spouseId;
            const spouse = await User.findOne({ userId: spouseId });
            if (spouse) { spouse.marriage = null; await spouse.save(); }
            userDB.marriage = null;
            await userDB.save();

            return reply(
`*💔 FORCED DIVORCE*

@${cleanId(target)} & @${cleanId(spouseId)}
split up by admin order.
`,
                [target, spouseId]
            );
        }

        // ===============================
        // 🎬 GIF CHECK — diagnose ffmpeg/GIF-to-MP4 setup from inside
        // WhatsApp, no shell access needed
        // ===============================
        case "gifcheck": {
            if (!isBotOwner) return reply("🚫 Owner only.");

            await reply("🔍 Testing GIF conversion pipeline, one moment...");

            const { checkGifSetup } = require("../_economyLegacy");
            const report = await checkGifSetup();

            return reply(
`*🎬 GIF SETUP CHECK*

ffmpeg available: ${report.ffmpegAvailable ? "✅ yes" : "❌ no"}
ffmpeg path: ${report.ffmpegResolvedPath || "N/A"}
Cached conversions: ${report.cacheSize}

Live test: ${report.testResult}`
            );
        }

        // ===============================
        // 💻 SYSTEM
        // ===============================
        case "system": {
            if (!isBotOwner) return reply("🚫 Owner only.");
            const mem = process.memoryUsage();
            const heapMB = (mem.heapUsed / 1024 / 1024).toFixed(1);
            const rssMB = (mem.rss / 1024 / 1024).toFixed(1);
            const uptime = process.uptime();
            const h = Math.floor(uptime / 3600);
            const m = Math.floor((uptime % 3600) / 60);
            const userCount = await User.countDocuments();
            return reply(
`▬▬▬▬▬▬▬▬▬▬▬▬▬▬
*💻 SYSTEM STATUS*
▬▬▬▬▬▬▬▬▬▬▬▬▬▬

⚡ Engine: Online

*🧠 MEMORY*
Heap: ${heapMB} MB
RSS: ${rssMB} MB


⏱ Uptime: ${h}h ${m}m
👥 Users: ${userCount}
📦 Node: ${process.version}

▬▬▬▬▬▬▬▬▬▬▬▬▬▬`
            );
        }
    }
};