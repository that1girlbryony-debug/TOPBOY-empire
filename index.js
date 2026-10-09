console.log("🚀 Starting TopBoy Empire...");

require("dotenv").config();

const {
    default: makeWASocket,
    useMultiFileAuthState,
    DisconnectReason,
    fetchLatestBaileysVersion,
    makeCacheableSignalKeyStore
} = require("@whiskeysockets/baileys");

const P = require("pino");
const mongoose = require("mongoose");
const express = require("express");
const readline = require("readline");
const fs = require("fs");

// ================= CORE FILES =================
const config = require("./config");
const User = require("./models/User");
const handleEconomy = require("./commands/economy");
const handleAdmin = require("./commands/admin");
const { normalizeJid } = require("./utils/helpers");

// 🆕 v2.0 — Quick Draw is now merged into economy.js (along with the
// hacker event and X-and-O logic), so we grab its answer-checker off
// the same handleEconomy export instead of a separate file.
const checkQuickDraw = handleEconomy.checkQuickDraw;

// ================= GLOBAL ERROR HANDLING =================
process.on("uncaughtException", (err) => {
    console.error("🔥 Uncaught Exception:", err.message);
});

process.on("unhandledRejection", (reason) => {
    console.error("🔥 Unhandled Rejection:", reason);
});

// ================= BOT ENABLED STATE =================
// disabledGroups = Set of group JIDs where bot is disabled individually
// globalDisable  = true means bot is OFF in ALL groups at once
const disabledGroups = new Set();
let globalDisable = false;

// Helper: is the bot currently disabled in a given group?
function isBotDisabledIn(groupJid) {
    return globalDisable || disabledGroups.has(groupJid);
}

// ================= COMMAND QUEUE (CAPPED) =================
const MAX_QUEUE = 10;
const commandQueue = [];
let isProcessingQueue = false;

// 🛠 FIX: previously, a full queue silently dropped the command —
// the user just got no response at all and assumed the bot was
// broken. Now it can optionally notify them via onFull().
function enqueueCommand(task, onFull) {
    if (commandQueue.length >= MAX_QUEUE) {
        console.warn("⚠️ Queue full, dropping command");
        if (typeof onFull === "function") {
            onFull().catch(() => {});
        }
        return;
    }
    commandQueue.push(task);
    processQueue();
}

async function processQueue() {
    if (isProcessingQueue) return;
    if (commandQueue.length === 0) return;

    isProcessingQueue = true;

    while (commandQueue.length > 0) {
        const task = commandQueue.shift();

        try {
            await Promise.race([
                task(),
                new Promise((_, reject) =>
                    setTimeout(() => reject(new Error("Command timeout")), 15000)
                )
            ]);
        } catch (err) {
            console.error("❌ [Global Queue Error]", err.message);
        }

        await new Promise(res => setTimeout(res, 50));
    }

    isProcessingQueue = false;
}

// ================= EXPRESS SERVER =================
const app = express();

app.get("/", (req, res) => {
    res.send("TopBoy Empire 2.0: ONLINE");
});

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
    console.log(`🌐 Express Server Running on port ${PORT}`);
});

// ================= DATABASE =================
mongoose.connect(process.env.MONGO_URI, {
    maxPoolSize: 5
})
.then(() => console.log("✅ [DB] Connected"))
.catch(err => console.error("❌ [DB] Error:", err));

// ================= PHONE NUMBER PROMPT =================
function askPhoneNumber() {
    if (process.env.PHONE_NUMBER) {
        const num = process.env.PHONE_NUMBER.replace(/\D/g, "");
        console.log(`📱 Using phone number from .env: ${num}`);
        return Promise.resolve(num);
    }

    return new Promise((resolve) => {
        const rl = readline.createInterface({
            input: process.stdin,
            output: process.stdout
        });

        rl.question(
            "📱 Enter your WhatsApp number (country code + digits only)\n   Example Nigeria: 2348012345678\n➤ ",
            (answer) => {
                rl.close();
                const cleaned = answer.trim().replace(/\D/g, "");
                console.log(`✅ Using number: ${cleaned}`);
                resolve(cleaned);
            }
        );
    });
}

// ================= CLEAR STALE AUTH =================
function clearStaleAuth() {
    const authDir = "./auth";
    if (fs.existsSync(authDir)) {
        const files = fs.readdirSync(authDir);
        if (files.length > 0) {
            console.log("🧹 Clearing stale auth for clean pairing...");
            fs.rmSync(authDir, { recursive: true, force: true });
            fs.mkdirSync(authDir);
        }
    } else {
        fs.mkdirSync(authDir);
    }
}

// ================= OWNER CHECK HELPER =================
function isOwnerJid(jid) {
    const norm = normalizeJid(jid);
    return config.ownerNumbers.some(owner => normalizeJid(owner) === norm);
}

// ================= AFK DURATION FORMATTER =================
function formatAfkDuration(ms) {
    const totalSeconds = Math.floor(ms / 1000);
    const days = Math.floor(totalSeconds / 86400);
    const hours = Math.floor((totalSeconds % 86400) / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;

    if (days > 0) return `${days}d ${hours}h`;
    if (hours > 0) return `${hours}h ${minutes}m`;
    if (minutes > 0) return `${minutes}m ${seconds}s`;
    return `${seconds}s`;
}

// ================= BOT START =================
let currentSock = null;

async function startBot() {

    try {
        if (currentSock) {
            try {
                currentSock.ev.removeAllListeners();
                currentSock.end();
            } catch {}
        }

        const { state, saveCreds } = await useMultiFileAuthState("./auth");
        const { version } = await fetchLatestBaileysVersion();

        const isRegistered = !!state.creds.registered;

        const sock = makeWASocket({
            version,
            logger: P({ level: "silent" }),
            browser: ["Ubuntu", "Chrome", "20.0.04"],
            syncFullHistory: false,
            shouldSyncHistoryMessage: () => false,
            printQRInTerminal: false,
            auth: {
                creds: state.creds,
                keys: makeCacheableSignalKeyStore(
                    state.keys,
                    P({ level: "silent" })
                )
            }
        });

        currentSock = sock;

        sock.ev.on("creds.update", saveCreds);

        let sessionReady = false;

        if (!isRegistered) {
            const phone = await askPhoneNumber();

            await new Promise(res => setTimeout(res, 2500));

            try {
                const code = await sock.requestPairingCode(phone);
                const formatted = code?.match(/.{1,4}/g)?.join("-") || code;

                console.log("\n╔═══════════════════════════╗");
                console.log(` 🔑 PAIRING CODE: ${formatted}     `);
                console.log("╚═══════════════════════════╝");
                console.log("📲 Steps: WhatsApp → ⋮ Menu → Linked Devices → Link a Device → Link with Phone Number");
                console.log("⏳ Enter the code within 60 seconds.\n");
            } catch (err) {
                console.error("❌ Pairing code request failed:", err.message);
                console.log("\n💡 Fix steps:");
                console.log("   1. Delete the ./auth folder manually");
                console.log("   2. Make sure PHONE_NUMBER in .env includes country code (e.g. 2348012345678)");
                console.log("   3. Restart the bot\n");
            }
        } else {
            console.log("✅ Session already active — skipping pairing.");
        }

        // ================= CONNECTION HANDLER =================
        sock.ev.on("connection.update", async (update) => {

            const { connection, lastDisconnect } = update;

            if (connection === "open") {
                console.log("✅ TopBoy Empire 2.0 Connected & Live");
                sessionReady = true;

                // 🆕 AUTO-DETECT BOT LID — no more digging through MongoDB
                // or hand-editing config.js every time the number changes.
                // `config` is a single cached module object, required
                // identically by index.js/admin.js/economy.js — mutating
                // it here updates config.botLid everywhere at once, for
                // the rest of this process's lifetime.
                let detectedLid = sock.user?.lid || sock.user?.id;
                if (detectedLid) {
                    // Baileys may return a device-specific LID like:
                    // 222140758532267:5@lid
                    // Convert it to:
                    // 222140758532267@lid
                    if (detectedLid.endsWith("@lid") && detectedLid.includes(":")) {
                        const [lid] = detectedLid.split(":");
                        detectedLid = `${lid}@lid`;
                    }

                    if (config.botLid !== detectedLid) {
                        console.log(`🆔 Bot LID auto-detected: ${detectedLid} (was: ${config.botLid})`);
                    } else {
                        console.log(`🆔 Bot LID confirmed: ${detectedLid}`);
                    }
                    config.botLid = detectedLid;
                } else {
                    console.warn(
                        "⚠️ Could not auto-detect bot LID from this connection — " +
                        `falling back to the value in config.js: ${config.botLid}`
                    );
                }
            }

            if (connection === "close") {
                sessionReady = false;

                const statusCode = lastDisconnect?.error?.output?.statusCode;
                const shouldReconnect = statusCode !== DisconnectReason.loggedOut;

                console.log(`⚠️ Connection closed (code: ${statusCode}). Reconnecting: ${shouldReconnect}`);

                if (shouldReconnect) {
                    await new Promise(res => setTimeout(res, 2000));
                    setTimeout(() => startBot(), 3000);
                } else {
                    console.log("❌ Logged out. Delete ./auth folder and restart.");
                }
            }
        });

        // ================= GROUP PARTICIPANT UPDATE =================
        sock.ev.on("group-participants.update", async (update) => {
            if (!sessionReady) return;

            const chat = update.id;
            const action = update.action;
            const participants = update.participants;
            const author = update.author;

            // 🆕 ================= TRACK WHO ADDED THE BOT =================
            // Used by the unauthorized-group check in the message handler
            // below — if this group turns out to be unauthorized and gets
            // escalated, whoever added the bot here gets globally banned.
            if (action === "add" && author) {
                const botNorm = normalizeJid(config.botLid);
                const botWasAdded = participants.some(p => normalizeJid(p) === botNorm);
                if (botWasAdded) {
                    if (!global._groupAdders) global._groupAdders = new Map();
                    global._groupAdders.set(chat, author);
                    console.log(`📥 Bot added to group ${chat} by ${author}`);
                }
            }

            // ================= ANTIDEMOTE (ALWAYS ACTIVE — ignores disable state) =================
            if (action === "demote") {
                const ownerNumbers = config.ownerNumbers.map(o => normalizeJid(o));
                const botNorm = normalizeJid(config.botLid);

                for (const participant of participants) {
                    const participantNorm = normalizeJid(participant);

                    // 🛠 FIX (Phase 1 / 1.4): protect the BOT itself, not just owners.
                    // Without this, a group admin (or anyone WhatsApp allows to demote)
                    // could strip the bot's admin rights, silently breaking ALL
                    // admin-requiring commands in that group (kick, mute, promote,
                    // demote, antilink-removal, votekick-execution) — with no auto-recovery.
                    const isOwner = ownerNumbers.includes(participantNorm);
                    const isBotSelf = participantNorm === botNorm;

                    if (!isOwner && !isBotSelf) continue;

                    let botIsAdmin = false;
                    try {
                        const metadata = await sock.groupMetadata(chat);
                        const botParticipant = metadata.participants.find(
                            p => normalizeJid(p.id) === botNorm
                        );
                        botIsAdmin =
                            botParticipant?.admin === "admin" ||
                            botParticipant?.admin === "superadmin";
                    } catch {}

                    if (!botIsAdmin) continue;

                    const protectionLabel = isBotSelf ? "the bot" : "owner";

                    await sock.sendMessage(chat, {
                        text:
`🚨 *INTRUDER ALERT!* 🚨

⚠️ @${author.split("@")[0]} tried to demote @${participant.split("@")[0]} (${protectionLabel})!
Intruder has been removed.

👑 Restoring ${protectionLabel} privileges...
`,
                        mentions: [author, participant]
                    });

                    try {
                        await sock.groupParticipantsUpdate(chat, [author], "remove");
                    } catch {}

                    try {
                        await sock.groupParticipantsUpdate(chat, [participant], "promote");
                    } catch {}
                }
            }

            // ================= WELCOME SYSTEM =================
            if (action !== "add") return;

            const isDisabled = isBotDisabledIn(chat);

            for (const participant of participants) {

                // ── GAMING GROUP WELCOME (bot enabled) ──
                // Full empire welcome with game instructions — refreshed
                // for 2.0 branding + a nod to the new features
                const gamingWelcome =
                    `▬▬▬▬▬▬▬▬▬▬▬▬▬▬
*🌆 WELCOME TO EMPIRE 2.0*
▬▬▬▬▬▬▬▬▬▬▬▬▬▬\n
▬▬▬▬▬▬▬▬▬▬▬▬▬▬` +
                    `\n` +
                    `@${participant.split("@")[0]}\n` +
                    `You've entered the Empire.\n` +
                    `\n` +
                    `💰 Build wealth\n` +
                    `🏢 Buy businesses\n` +
                    `🎴 Collect rare cards\n` +
                    `❌⭕ Challenge friends\n` +
                    `💻 Watch out for hackers 👀\n` +
                    `\n` +
                    `📝 *.register* to begin\n` +
                    `📘 *.about* for what's new\n` +
                    ``;

                // ── NORMAL GROUP WELCOME (bot disabled) ──
                // Warm, human, no game instructions
                const normalWelcome =
                    `▬▬▬▬▬▬▬▬▬▬▬▬▬▬
*🌟 WELCOME*
▬▬▬▬▬▬▬▬▬▬▬▬▬▬\n
▬▬▬▬▬▬▬▬▬▬▬▬▬▬` +
                    `\n` +
                    `Hey @${participant.split("@")[0]}! 👋\n` +
                    `\n` +
                    `We're glad you're here. ❤️\n` +
                    `Make yourself at home,\n` +
                    `be kind, and enjoy the\n` +
                    `good vibes in this group.\n` +
                    `\n` +
                    `🕊️ Respect everyone.\n` +
                    `😄 Have fun.\n` +
                    `🤝 You belong here.\n` +
                    `\n` +
                    ``;

                const welcomeText = isDisabled ? normalWelcome : gamingWelcome;

                try {
                    const ppUrl = await sock
                        .profilePictureUrl(participant, "image")
                        .catch(() => null);

                    await sock.sendMessage(update.id, {
                        image: ppUrl ? { url: ppUrl } : undefined,
                        caption: welcomeText,
                        mentions: [participant]
                    });

                } catch (err) {
                    await sock.sendMessage(update.id, {
                        text: welcomeText,
                        mentions: [participant]
                    });
                }
            }
        });

        // ================= MESSAGE HANDLER =================
        sock.ev.on("messages.upsert", async ({ messages, type }) => {

            if (!sessionReady) return;
            if (type !== "notify") return;

            const msg = messages[0];
            if (!msg.message || msg.key.fromMe) return;

            const chat = msg.key.remoteJid;
            const sender = msg.key.participant || msg.key.remoteJid;
            const isGroup = chat.endsWith("@g.us");

            // ================= RATE LIMITING (ANTISPAM) =================
            // 🛠 FIX: DMs used to share the exact same 7s rate-limit key
            // as group commands (both keyed by sender). If someone ran a
            // group command (e.g. .pntjoin) and then DMed "ready" within
            // 7 seconds — completely normal when playing RPS/PNT — the
            // DM was silently swallowed here before it ever reached the
            // game-action handler below. DMs now use their own, much
            // shorter key so fast-paced game DMs never get eaten by the
            // group antispam limit.
            if (!global._rateLimit) global._rateLimit = new Map();
            const now = Date.now();

            if (isGroup) {
                const userLastCmd = global._rateLimit.get(sender) || 0;
                if (now - userLastCmd < 7000) {
                    return;
                }
                global._rateLimit.set(sender, now);
            } else {
                const dmKey = `dm:${sender}`;
                const userLastDM = global._rateLimit.get(dmKey) || 0;
                if (now - userLastDM < 1500) {
                    return;
                }
                global._rateLimit.set(dmKey, now);
            }

            // ================= SLOWMODE (admin .slowmode command) =================
            // Extra per-chat cooldown for non-admins, on top of the base 7s
            // antispam above. Only does the (slightly costlier) admin lookup
            // when a group actually has slowmode active.
            if (isGroup && global._slowmode?.has(chat) && !isOwnerJid(sender)) {
                const seconds = global._slowmode.get(chat);
                let isAdmin = false;
                try {
                    const md = await sock.groupMetadata(chat);
                    const p = md.participants.find(p => normalizeJid(p.id) === normalizeJid(sender));
                    isAdmin = p?.admin === "admin" || p?.admin === "superadmin";
                } catch {}

                if (!isAdmin) {
                    const slowKey = `slowmode:${chat}:${sender}`;
                    const lastSlow = global._rateLimit.get(slowKey) || 0;
                    if (now - lastSlow < seconds * 1000) {
                        return;
                    }
                    global._rateLimit.set(slowKey, now);
                }
            }

            // 🛠 FIX (Phase 1 / 1.4): expand text extraction to cover all
            // caption-bearing message types and quoted messages. The old
            // extraction only read conversation + extendedTextMessage.text,
            // which meant antilink (and AFK auto-clear, mini-game answers,
            // etc.) was trivially bypassed by attaching a link as an image
            // caption or quoting a message containing the link.
            const m = msg.message || {};
            const ctx = m.extendedTextMessage?.contextInfo || {};
            const quotedTexts = [];
            if (ctx.quotedMessage) {
                if (ctx.quotedMessage.conversation) quotedTexts.push(ctx.quotedMessage.conversation);
                if (ctx.quotedMessage.extendedTextMessage?.text) quotedTexts.push(ctx.quotedMessage.extendedTextMessage.text);
                if (ctx.quotedMessage.imageMessage?.caption) quotedTexts.push(ctx.quotedMessage.imageMessage.caption);
                if (ctx.quotedMessage.videoMessage?.caption) quotedTexts.push(ctx.quotedMessage.videoMessage.caption);
            }
            const text = (
                m.conversation ||
                m.extendedTextMessage?.text ||
                m.imageMessage?.caption ||
                m.videoMessage?.caption ||
                ""
            ) + (quotedTexts.length ? "\n" + quotedTexts.join("\n") : "");

            // ================= ENHANCED BAN SYSTEM =================
            // 🛠 FIX: this used to block/delete on `banned === true` alone,
            // with zero regard for banUntil. Since it returns immediately,
            // a banned user's messages got deleted forever — the deeper
            // auto-expiry logic buried in command processing never got a
            // chance to run, because it never even got that far. Now the
            // expiry is checked right here, first.
            const senderUser = await User.findOne({ userId: sender });
            if (senderUser?.banned) {
                const isExpired = senderUser.banUntil && Date.now() > senderUser.banUntil;
                if (isExpired) {
                    await User.collection.updateOne(
                        { userId: sender },
                        {
                            $set: { banned: false },
                            $unset: { banUntil: "", banReason: "", bannedBy: "", bannedAt: "" }
                        }
                    );
                    senderUser.banned = false; // so the rest of this message's processing sees them as unbanned
                } else {
                    try {
                        await sock.sendMessage(chat, { delete: msg.key });
                    } catch {}
                    return;
                }
            }

            // 🆕 ================= AFK SYSTEM =================
            // Two jobs: (1) if the sender was AFK, welcome them back and
            // clear it — any message counts, not just commands. (2) if
            // this message mentions someone who's currently AFK, let the
            // sender know. Both only make sense in groups.
            // 🛠 Reads/writes here go through the raw MongoDB driver
            // (.collection.*) instead of the Mongoose document layer —
            // same reasoning as the .afk command itself.
            if (isGroup) {
                const senderRaw = await User.collection.findOne({ userId: sender });
                if (senderRaw?.afk) {
                    const away = formatAfkDuration(Date.now() - (senderRaw.afkSince || Date.now()));
                    const afkReason = senderRaw.afkReason || "No reason given";
                    await User.collection.updateOne(
                        { userId: sender },
                        { $set: { afk: false, afkReason: null, afkSince: null } }
                    );
                    await sock.sendMessage(chat, {
                        text: `👋 Welcome back @${sender.split("@")[0]}! You were AFK for ${away}.\nReason was: ${afkReason}`,
                        mentions: [sender]
                    }).catch(() => {});
                }

                const mentionedJids = msg.message?.extendedTextMessage?.contextInfo?.mentionedJid || [];
                if (mentionedJids.length > 0) {
                    for (const mid of mentionedJids) {
                        if (mid === sender) continue;
                        const mentionedRaw = await User.collection.findOne({ userId: mid });
                        if (mentionedRaw?.afk) {
                            const away = formatAfkDuration(Date.now() - (mentionedRaw.afkSince || Date.now()));
                            await sock.sendMessage(chat, {
                                text: `💤 @${mid.split("@")[0]} has been AFK for ${away}.\nReason: ${mentionedRaw.afkReason || "No reason given"}`,
                                mentions: [mid]
                            }).catch(() => {});
                        }
                    }
                }
            }

            // 🆕 ================= PRIVATE DM GAME ACTIONS =================
            // RPS throws ("rock"/"paper"/"scissors") and Police & Thief
            // actions ("hide <place>", "robplace <place>", "defend <place>")
            // arrive as plain DMs with no prefix required. This has to run
            // BEFORE the prefix check and the "block private chats" gate
            // further down, or these would never be reachable at all.
            if (!isGroup) {
                try {
                    const handled = await handleEconomy.handleDMAction(sock, sender, text);
                    if (handled) return;
                } catch (err) {
                    console.error("DM action handling error:", err.message);
                }
                // Falls through to the normal "block private chats" gate
                // below for anything that wasn't a recognized game action.
            }

            // ================= ANTILINK ENFORCEMENT (ALWAYS ACTIVE — ignores disable state) =================
            // 🛠 FIX (Phase 1 / 1.4): was a single `text.includes("chat.whatsapp.com")`
            // substring check — trivially bypassed by:
            //   - image/video captions with the link (now caught by expanded text extraction)
            //   - quoted messages containing the link (now caught too)
            //   - wa.me/ deep links (now caught by regex)
            //   - whatsapp.com/channel/ community links (now caught by regex)
            // Regex is case-insensitive and matches both http:// and https:// variants
            // (and the bare-domain form without a scheme).
            const WHATSAPP_LINK_RE = /(https?:\/\/)?(www\.)?(chat\.whatsapp\.com|wa\.me\/|whatsapp\.com\/(?:channel|invite|\/))[a-z0-9]/i;
            if (isGroup && WHATSAPP_LINK_RE.test(text)) {
                const groupData = await User.findOne({ userId: chat });

                if (groupData?.antilink) {
                    const senderNorm = normalizeJid(sender);
                    const metadata = await sock.groupMetadata(chat);

                    const participant = metadata.participants.find(
                        p => normalizeJid(p.id) === senderNorm
                    );

                    const isAdmin =
                        participant?.admin === "admin" ||
                        participant?.admin === "superadmin";

                    const isOwner = isOwnerJid(sender);

                    if (!isAdmin && !isOwner) {
                        try {
                            await sock.sendMessage(chat, { delete: msg.key });
                        } catch {}

                        try {
                            await sock.groupParticipantsUpdate(chat, [sender], "remove");
                            await sock.sendMessage(chat, {
                                text: `🚫 @${sender.split("@")[0]} removed for sending links.`,
                                mentions: [sender]
                            });
                        } catch {}

                        return;
                    }
                }
            }

            // ================= NON-PREFIX MINI-GAME ANSWER CHECKS =================
            if (!isBotDisabledIn(chat) && isGroup && !text.startsWith(config.prefix)) {
                const triviaActive = global._triviaActive;
                if (triviaActive && triviaActive.has(chat)) {
                    const active = triviaActive.get(chat);
                    if (Date.now() < active.expiresAt) {

                        if (active.answeredUsers.has(sender)) return;

                        const userAnswer = text.trim().toLowerCase();
                        const isCorrect =
                            userAnswer === active.correctAnswer ||
                            userAnswer === active.correctLetter.toLowerCase();

                        active.answeredUsers.add(sender);

                        if (isCorrect) {
                            active.correctUsers.push(sender);
                        }
                    }
                }

                // ================= MULTI-TRIVIA ANSWER CHECK =================
                const multiTrivia = global._multiTrivia;
                if (multiTrivia && multiTrivia.has(chat)) {
                    const active = multiTrivia.get(chat);
                    if (Date.now() < active.expiresAt) {
                        const userAnswer = text.trim().toLowerCase();
                        const currentQ = active.questions[active.currentIndex];

                        // 🛠 FIX (Phase 1 / 1.3): gate per-question — without
                        // this, a user could spam "A B C D" and one of them
                        // was guaranteed correct, scoring on every question
                        // and winning $50M every time. Now they get one
                        // answer per question, just like single trivia.
                        const answeredSet = active.answeredByQ?.[active.currentIndex];
                        if (answeredSet && answeredSet.has(sender)) return;
                        if (answeredSet) answeredSet.add(sender);

                        const isCorrect =
                            userAnswer === currentQ.correctAnswer ||
                            userAnswer === currentQ.correctLetter.toLowerCase();

                        if (!active.scores[sender]) {
                            active.scores[sender] = 0;
                        }

                        if (isCorrect) {
                            active.scores[sender] += 1;
                        }
                    }
                }

                // 🆕 ================= QUICK DRAW ANSWER CHECK =================
                // Free-for-all word race — no prefix needed, first correct
                // guess wins. Safe to call unconditionally; it's a no-op
                // if there's no active Quick Draw in this chat.
                try {
                    await checkQuickDraw(sender, chat, text, sock);
                } catch (err) {
                    console.error("Quick Draw check error:", err.message);
                }
            }

            // Prefix check
            if (!text.startsWith(config.prefix)) return;

            // ================= BLOCK PRIVATE CHATS =================
            if (!isGroup) {
                return;
            }

            // ================= PARSE COMMAND EARLY =================
            const rawArgs = text.slice(config.prefix.length).trim().split(/ +/);
            const rawCommand = rawArgs[0]?.toLowerCase();
            const rawArg = rawArgs[1]?.toLowerCase(); // e.g. "all"

            // ================= ENABLE / DISABLE (owner-only, always processed) =================
            if (rawCommand === "enable" || rawCommand === "disable") {
                if (!isOwnerJid(sender)) return;

                const isAll = rawArg === "all";

                if (rawCommand === "disable") {
                    if (isAll) {
                        // ── DISABLE ALL ──
                        if (globalDisable) {
                            await sock.sendMessage(chat, {
                                text:
`▬▬▬▬▬▬▬▬▬▬▬▬▬▬
*⚡ BOT STATUS*
▬▬▬▬▬▬▬▬▬▬▬▬▬▬

⛔ Bot is already disabled globally.

▬▬▬▬▬▬▬▬▬▬▬▬▬▬`
                            }, { quoted: msg });
                        } else {
                            globalDisable = true;
                            disabledGroups.clear();
                            console.log("⛔ Bot globally disabled by owner.");
                            await sock.sendMessage(chat, {
                                text:
`▬▬▬▬▬▬▬▬▬▬▬▬▬▬
*⚡ BOT STATUS*
▬▬▬▬▬▬▬▬▬▬▬▬▬▬

⛔ Bot DISABLED in ALL groups.
Commands are OFF everywhere.

🔗 Antilink: still active
🛡️ Antidemote: still active
👋 Welcome messages: still active

Type *.enable all* to restore all.
Type *.enable* to restore this group.

▬▬▬▬▬▬▬▬▬▬▬▬▬▬`
                            }, { quoted: msg });
                        }
                    } else {
                        // ── DISABLE THIS GROUP ONLY ──
                        if (disabledGroups.has(chat) || globalDisable) {
                            await sock.sendMessage(chat, {
                                text:
`▬▬▬▬▬▬▬▬▬▬▬▬▬▬
*⚡ BOT STATUS*
▬▬▬▬▬▬▬▬▬▬▬▬▬▬

⛔ Bot is already disabled in this group.

▬▬▬▬▬▬▬▬▬▬▬▬▬▬`
                            }, { quoted: msg });
                        } else {
                            disabledGroups.add(chat);
                            console.log(`⛔ Bot disabled in group: ${chat}`);
                            await sock.sendMessage(chat, {
                                text:
`▬▬▬▬▬▬▬▬▬▬▬▬▬▬
*⚡ BOT STATUS*
▬▬▬▬▬▬▬▬▬▬▬▬▬▬

⛔ Bot DISABLED in this group.
Commands are OFF here only.

🔗 Antilink: still active
🛡️ Antidemote: still active
👋 Welcome messages: still active

Type *.enable* to turn back on.

▬▬▬▬▬▬▬▬▬▬▬▬▬▬`
                            }, { quoted: msg });
                        }
                    }
                }

                if (rawCommand === "enable") {
                    if (isAll) {
                        // ── ENABLE ALL ──
                        if (!globalDisable && disabledGroups.size === 0) {
                            await sock.sendMessage(chat, {
                                text:
`▬▬▬▬▬▬▬▬▬▬▬▬▬▬
*⚡ BOT STATUS*
▬▬▬▬▬▬▬▬▬▬▬▬▬▬

✅ Bot is already enabled everywhere.

▬▬▬▬▬▬▬▬▬▬▬▬▬▬`
                            }, { quoted: msg });
                        } else {
                            globalDisable = false;
                            disabledGroups.clear();
                            console.log("✅ Bot globally enabled by owner.");
                            await sock.sendMessage(chat, {
                                text:
`▬▬▬▬▬▬▬▬▬▬▬▬▬▬
*⚡ BOT STATUS*
▬▬▬▬▬▬▬▬▬▬▬▬▬▬

✅ Bot ENABLED in ALL groups.
All commands are now active everywhere.

▬▬▬▬▬▬▬▬▬▬▬▬▬▬`
                            }, { quoted: msg });
                        }
                    } else {
                        // ── ENABLE THIS GROUP ONLY ──
                        if (!isBotDisabledIn(chat)) {
                            await sock.sendMessage(chat, {
                                text:
`▬▬▬▬▬▬▬▬▬▬▬▬▬▬
*⚡ BOT STATUS*
▬▬▬▬▬▬▬▬▬▬▬▬▬▬

✅ Bot is already enabled in this group.

▬▬▬▬▬▬▬▬▬▬▬▬▬▬`
                            }, { quoted: msg });
                        } else {
                            if (globalDisable) {
                                await sock.sendMessage(chat, {
                                    text:
`▬▬▬▬▬▬▬▬▬▬▬▬▬▬
*⚡ BOT STATUS*
▬▬▬▬▬▬▬▬▬▬▬▬▬▬

⚠️ Bot is globally disabled.
Use *.enable all* to restore all groups,
or *.enable all* then *.disable* in
specific groups you want off.

▬▬▬▬▬▬▬▬▬▬▬▬▬▬`
                                }, { quoted: msg });
                            } else {
                                disabledGroups.delete(chat);
                                console.log(`✅ Bot enabled in group: ${chat}`);
                                await sock.sendMessage(chat, {
                                    text:
`▬▬▬▬▬▬▬▬▬▬▬▬▬▬
*⚡ BOT STATUS*
▬▬▬▬▬▬▬▬▬▬▬▬▬▬

✅ Bot ENABLED in this group.
All commands are now active here.

▬▬▬▬▬▬▬▬▬▬▬▬▬▬`
                                }, { quoted: msg });
                            }
                        }
                    }
                }

                return;
            }

            // ================= BOT DISABLED GATE =================
            // If bot is disabled in this group, only owner passes through
            if (isBotDisabledIn(chat) && !isOwnerJid(sender)) {
                return;
            }

            // 🆕 ================= FULL GROUP AUTHORIZATION CHECK =================
            // Previously this only checked "is the bot an admin here?" —
            // now it also requires the bot OWNER to actually be a member
            // AND an admin of this group. Groups that fail get a warning;
            // after 3 total attempts, the bot leaves and globally bans
            // whoever added it here (checked via group-participants.update
            // above), so they can't just re-add it or use the bot
            // elsewhere either.
            const botGroupLink = process.env.BOT_GROUP_LINK || "https://chat.whatsapp.com/your-group-link";
            const botNorm = normalizeJid(config.botLid);
            const metadata = await sock.groupMetadata(chat).catch(() => null);
            const botInGroup = metadata?.participants?.find(p => normalizeJid(p.id) === botNorm);
            const isBotAdmin = botInGroup?.admin === "admin" || botInGroup?.admin === "superadmin";

            const ownerNormSet = config.ownerNumbers.map(o => normalizeJid(o));
            const ownerInGroup = metadata?.participants?.find(p => ownerNormSet.includes(normalizeJid(p.id)));
            const isOwnerAdminHere = ownerInGroup?.admin === "admin" || ownerInGroup?.admin === "superadmin";

            const isAuthorizedGroup = !!metadata && isBotAdmin && !!ownerInGroup && isOwnerAdminHere;

            if (!isAuthorizedGroup) {
                if (!global._groupViolations) global._groupViolations = new Map();
                const violations = (global._groupViolations.get(chat) || 0) + 1;
                global._groupViolations.set(chat, violations);

                const MAX_VIOLATIONS = 3;

                if (violations >= MAX_VIOLATIONS) {
                    const adder = global._groupAdders?.get(chat);
                    if (adder) {
                        try {
                            // 🛠 FIX (Phase 1 / 1.4): use User.collection.updateOne
                            // (raw MongoDB driver) instead of User.updateOne (Mongoose).
                            // Mongoose's strict mode silently strips fields not in the
                            // schema — banReason, bannedBy, bannedAt aren't declared
                            // (they're set via raw driver in admin.js .ban for the same
                            // reason). So this auto-ban path was writing `banned: true`
                            // + `banUntil: null` but DROPPING the reason/by/at fields,
                            // corrupting the moderation audit trail. The .info command
                            // would later show "No reason recorded" instead of
                            // "Added the bot to an unauthorized group".
                            await User.collection.updateOne(
                                { userId: adder },
                                {
                                    $set: {
                                        banned: true,
                                        banReason: "Added the bot to an unauthorized group",
                                        bannedBy: "system",
                                        bannedAt: Date.now(),
                                        banUntil: null
                                    }
                                },
                                { upsert: true }
                            );
                            console.log(`🚫 Auto-banned ${adder} for adding the bot to unauthorized group ${chat}`);
                        } catch (err) {
                            console.error("Failed to auto-ban group adder:", err.message);
                        }
                    }

                    try {
                        await sock.sendMessage(chat, {
                            text:
`▬▬▬▬▬▬▬▬▬▬▬▬▬▬
*🚫 LEAVING — UNAUTHORIZED GROUP*
▬▬▬▬▬▬▬▬▬▬▬▬▬▬

This group was never authorized to use me.
${adder ? "The person who added me has been banned from using me anywhere." : ""}

▬▬▬▬▬▬▬▬▬▬▬▬▬▬`
                        });
                    } catch {}

                    global._groupViolations.delete(chat);
                    global._groupAdders?.delete(chat);
                    try {
                        await sock.groupLeave(chat);
                    } catch (err) {
                        console.error("Failed to leave unauthorized group:", err.message);
                    }
                    return;
                }

                await sock.sendMessage(
                    chat,
                    {
                        text:
`▬▬▬▬▬▬▬▬▬▬▬▬▬▬
*❌ PERMISSION DENIED*
▬▬▬▬▬▬▬▬▬▬▬▬▬▬

This is not the group for using me.
Join my official group to use the bot:

🔗 ${botGroupLink}

📘 Ask the owner for the link
⚠️ (${violations}/${MAX_VIOLATIONS} attempts before I leave)

▬▬▬▬▬▬▬▬▬▬▬▬▬▬`
                    },
                    { quoted: msg }
                );
                return;
            }

            const args = text
                .slice(config.prefix.length)
                .trim()
                .split(/ +/);

            const command = args.shift()?.toLowerCase();
            if (!command) return;

            const reply = async (txt, mentions = []) => {
                await sock.sendMessage(
                    chat,
                    {
                        text: txt,
                        mentions: mentions.length ? mentions : [sender]
                    },
                    { quoted: msg }
                );
            };

            enqueueCommand(async () => {

                let user = await User.findOne({ userId: sender });

                // ================= AUTO LOAN SEIZURE =================
                // 🛠 FIX (Phase 0 / E3): Previously this did `user.assets = []`,
                // which wiped EVERY business the user owned — even though the
                // loaned asset was already removed from `assets` at .loan time
                // (see economy.js loan case). The reply text said "your
                // collateral was confiscated" (singular) but the code seized
                // everything. Now we only null the loan fields, which matches
                // both the UI promise and the .loan logic at the other end.
                if (user?.loanDue && Date.now() > user.loanDue && user.debt > 0) {
                    const seizedAssetName = user.loanAsset?.name || "your collateral";
                    user.debt = 0;
                    user.loanDue = null;
                    user.loanAsset = null;
                    await user.save();
                    await reply(`🚨 LOAN SEIZURE: ${seizedAssetName} was confiscated as collateral.`);
                }

                // ================= BAN AUTO-CHECK =================
                if (user?.banned && user?.banUntil && Date.now() > user.banUntil) {
                    user.banned = false;
                    user.banUntil = null;
                    await user.save();
                    await reply("✅ Your ban has expired. You can use the bot again.");
                }

                // ================= REGISTER =================
                if (command === "register") {
                    if (user) {
                        return reply("⚠️ You are already registered.");
                    }
                    await User.create({ userId: sender });
                    return reply(
                        "🔥 REGISTRATION COMPLETE\nYou received $2,000 starter cash.\n\n📝 Here's how to start:\n1. *.daily* — claim $5k+\n2. *.shop* — buy your first business\n3. *.work* — quick cash\n\nType *.menu* for everything else."
                    );
                }

                if (!user && !["about", "menu", "help"].includes(command)) {
                    return reply("❌ Not registered. Type *.register*");
                }

                // ================= ADMIN COMMANDS =================
                const adminCommands = [
                    "ban", "unban", "addbal", "tagall", "broadcast",
                    "seize", "reset", "giveaway", "admin", "airdrop", "system",
                    "kick", "antilink", "cdr", "votekick", "qa", "quiz",
                    "promote", "demote",
                    "mute", "unmute", "lid",
                    "warn", "warnings", "clearwarns",
                    "freeze", "unfreeze", "slowmode",
                    "setxp", "setlevel", "clearcooldowns", "rain",
                    "forcemarry", "forcedivorce",
                    "gifcheck", "info"
                ];

                if (adminCommands.includes(command)) {
                    if (!isGroup) {
                        return reply("🚫 Admin commands are group-only.");
                    }

                    const adminMetadata = await sock.groupMetadata(chat);
                    const senderNorm = normalizeJid(sender);

                    const participant = adminMetadata.participants.find(
                        p => normalizeJid(p.id) === senderNorm
                    );

                    const isAdmin =
                        participant?.admin === "admin" ||
                        participant?.admin === "superadmin";

                    const isOwner = isOwnerJid(sender);

                    if (!isAdmin && !isOwner) {
                        return reply("🚫 Admin access required.");
                    }

                    return handleAdmin({
                        sock,
                        chat,
                        sender,
                        command,
                        args,
                        reply,
                        msg,
                        groupMetadata: adminMetadata,
                        user
                    });
                }

                // ================= ECONOMY COMMANDS =================
                const economyCommands = [
                    "menu", "help", "about",
                    "profile", "bal", "assets", "lb", "richest", "cd",
                    "daily", "beg", "auction", "bid", "wd", "dep", "give", "loan", "payloan",
                    "rob", "send", "casino", "slots", "cf", "roulette",
                    "shop", "dice", "items", "heist", "join", "protect", "claim", "col", "view", "burn", "test", "tools", "accept", "reject", "kiss", "slap", "fuck", "wild", "yeet", "kill", "yes", "no",
                    "roll", "buy", "sell", "bail",
                    "marry", "divorce", "spouse", "marriageaccept", "marriagereject", "work", "trade", "fuse", "tradeaccept", "tradereject",
                    "debug",
                    // 🆕 v2.0 mini games
                    "ttt", "move",
                    "rps", "throw", "race", "dogbet",
                    "pnt", "pntjoin",
                    "afk"
                ];

                if (economyCommands.includes(command)) {
                    return handleEconomy({
                        sock,
                        chat,
                        sender,
                        command,
                        args,
                        user,
                        reply,
                        msg,
                        isGroup
                    });
                }

            }, async () => {
                // 🆕 Queue-full fallback — lets the user know the bot is
                // just busy instead of leaving them hanging with silence.
                await reply("⏳ I'm a bit busy right now — try that again in a few seconds!");
            });
        });

        console.log("🤖 Bot initialization complete.");

    } catch (err) {
        console.log("🔥 Bot init error:", err.message);
    }
}

startBot();