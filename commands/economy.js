const User = require("../models/User");
const config = require("../config");
const animeCards = require("../data/animeCards");
const gifs = require("../data/gif");
const axios = require("axios");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { fetchRandomCharacter } = require("../utils/animeFetcher");
const { renderCardText } = require("../utils/cardRenderer");
const {
  formatMoney,
  formatShort,
  randomInt,
  getTodayString,
  calculateNetWorth,
  cleanId,
  normalizeJid
} = require("../utils/helpers");

// =====================================================
// 🎬 GIF → MP4 CONVERSION
// WhatsApp's gifPlayback feature renders media as a silently-looping
// VIDEO, not a true animated GIF — sending real .gif bytes with
// gifPlayback:true is exactly what produces that broken/blurred
// placeholder instead of an animation. This actually transcodes your
// real .gif files to .mp4 on first use, then caches the result so it
// only has to happen once per GIF, not once per .slap/.kiss/etc.
//
// Requires: npm install ffmpeg-static fluent-ffmpeg
// If those aren't installed, reactions automatically fall back to
// sending a static image instead of crashing.
// =====================================================
let ffmpegAvailable = false;
let ffmpegConvert = null;
let ffmpegResolvedPath = null;
try {
  const ffmpegPath = require("ffmpeg-static");
  // 🛠 IMPORTANT: require() succeeding only proves the JS wrapper is
  // installed — ffmpeg-static's ACTUAL binary is downloaded by a
  // postinstall script during `npm install`, which some locked-down
  // hosting containers block for security. If that happened, this
  // path points at a file that doesn't exist, and every conversion
  // would silently fail later (falling back to static images) with
  // no clear signal why. Checking existsSync catches that case here,
  // immediately, with a clear log line instead of a mystery.
  if (!ffmpegPath || !fs.existsSync(ffmpegPath)) {
    throw new Error(`ffmpeg binary not found on disk at: ${ffmpegPath}. Your host may be blocking npm postinstall scripts.`);
  }
  ffmpegResolvedPath = ffmpegPath;
  ffmpegConvert = require("fluent-ffmpeg");
  ffmpegConvert.setFfmpegPath(ffmpegPath);
  ffmpegAvailable = true;
  console.log(`✅ ffmpeg ready at ${ffmpegPath} — GIF reactions will animate.`);
} catch (err) {
  console.warn(
    "⚠️ ffmpeg unavailable — GIF reactions will fall back to static " +
    `images instead of animating. Reason: ${err.message}`
  );
}

if (!global._gifMp4Cache) global._gifMp4Cache = new Map(); // gif URL -> mp4 Buffer
const GIF_CACHE_LIMIT = 200; // don't let this grow forever

async function getGifAsMp4(url) {
  if (global._gifMp4Cache.has(url)) return global._gifMp4Cache.get(url);
  if (!ffmpegAvailable) return null;

  const tmpId = `${Date.now()}_${randomInt(1000, 9999)}`;
  const gifPath = path.join(os.tmpdir(), `${tmpId}.gif`);
  const mp4Path = path.join(os.tmpdir(), `${tmpId}.mp4`);

  try {
    const res = await axios.get(url, {
      responseType: "arraybuffer",
      timeout: 10000,
      headers: { "User-Agent": "Mozilla/5.0" }
    });
    fs.writeFileSync(gifPath, Buffer.from(res.data));

    await new Promise((resolve, reject) => {
      ffmpegConvert(gifPath)
        .outputOptions([
          "-movflags faststart",
          "-pix_fmt yuv420p",
          "-vf scale=trunc(iw/2)*2:trunc(ih/2)*2"
        ])
        .toFormat("mp4")
        .on("error", reject)
        .on("end", resolve)
        .save(mp4Path);
    });

    const mp4Buffer = fs.readFileSync(mp4Path);

    if (global._gifMp4Cache.size < GIF_CACHE_LIMIT) {
      global._gifMp4Cache.set(url, mp4Buffer);
    }

    return mp4Buffer;
  } catch (err) {
    console.error("GIF→MP4 conversion failed:", err.message);
    return null;
  } finally {
    try { fs.unlinkSync(gifPath); } catch {}
    try { fs.unlinkSync(mp4Path); } catch {}
  }
}

// 🆕 v2.0 modules — merged directly into this file (no more separate
// hacker.js / minigames.js / quickdraw.js to keep in sync or break
// on a bad require path). See the "v2.0 FEATURE MODULES" block below.

// =====================================================
// 🆕 v2.0 FEATURE MODULES (merged into economy.js on purpose —
// keeping these as separate files caused require-path issues, so
// everything now lives in one place).
// =====================================================

// ---------- 💻 HACKER EVENT ----------
// Targets whoever owns the most business VALUE (not cash) in the
// group and seizes half their businesses outright. No defending —
// it either happens or it doesn't (95% success / 5% "got lucky").
// Runs on its own schedule (~twice a day per group) instead of a
// random per-command roll, same pattern as the dog race scheduler.
if (!global._lastHackerRun) global._lastHackerRun = new Map(); // chat -> timestamp

const HACKER_INTERVAL = 12 * 60 * 60 * 1000; // ~twice a day per group
const HACKER_SUCCESS_RATE = 0.95;

// =====================================================
// 📩 RESILIENT DM SENDER
// A group message's sender JID and a DM's own JID for the same
// person don't always match byte-for-byte (device suffix, @lid vs
// @s.whatsapp.net, etc — the same class of issue as the bot's own
// LID needing a fix). sock.sendMessage() to a mismatched/unresolved
// JID can silently fail. This resolves the JID via sock.onWhatsApp()
// first (Baileys' canonical lookup) and always logs failures instead
// of swallowing them, so RPS/PNT DMs are actually reliable — and if
// something's still wrong, the console will say why.
// =====================================================
async function resolveSendableJid(sock, jid) {
  try {
    const results = await sock.onWhatsApp(jid);
    if (results && results[0]?.jid) return results[0].jid;
  } catch (err) {
    console.error("onWhatsApp resolve failed for", jid, ":", err.message);
  }
  return jid;
}

async function safeDM(sock, jid, content) {
  try {
    await sock.sendMessage(jid, content);
    return true;
  } catch (err1) {
    console.error(`DM send failed to ${jid}, retrying with resolved JID:`, err1.message);
    try {
      const resolved = await resolveSendableJid(sock, jid);
      if (resolved !== jid) {
        await sock.sendMessage(resolved, content);
        console.log(`DM succeeded on retry using resolved JID ${resolved} (original: ${jid})`);
        return true;
      }
    } catch (err2) {
      console.error(`DM retry also failed for ${jid}:`, err2.message);
    }
    return false;
  }
}

async function maybeTriggerHacker(sock, chat) {
  const last = global._lastHackerRun.get(chat);
  if (last && Date.now() - last < HACKER_INTERVAL) return false;

  // 🛠 FIX: was ranking by asset VALUE only (not the same ranking as
  // .lb, which uses full net worth), and picking randomly from the
  // top 3 instead of always hitting #1. Now it uses the exact same
  // calculateNetWorth() ranking as the leaderboard, and always
  // targets whoever is actually #1 — no randomness in who gets hit.
  // Also requires at least 2 assets to even be eligible, since you
  // can't meaningfully take "half" from someone with just 1.
  const users = await User.find({}, "userId wallet bank assets debt banned");
  const eligible = users
    .filter(u => !u.banned && Array.isArray(u.assets) && u.assets.length >= 2)
    .map(u => ({ userId: u.userId, net: calculateNetWorth(u) }))
    .sort((a, b) => b.net - a.net);

  if (!eligible.length) return false;

  global._lastHackerRun.set(chat, Date.now());

  // 🎯 Always #1 on the leaderboard — no pool, no randomness in target.
  const targetInfo = eligible[0];

  const gotLucky = Math.random() > HACKER_SUCCESS_RATE; // 5% escape

  if (gotLucky) {
    await sock.sendMessage(chat, {
      text:
`▬▬▬▬▬▬▬▬▬▬▬▬▬▬
*💻 HACKER ATTEMPT!*
▬▬▬▬▬▬▬▬▬▬▬▬▬▬

Someone tried to hack @${targetInfo.userId.split("@")[0]}'s
businesses... and got traced and blocked!

🍀 Extremely lucky escape.
▬▬▬▬▬▬▬▬▬▬▬▬▬▬`,
      mentions: [targetInfo.userId]
    });
    return true;
  }

  const victim = await User.findOne({ userId: targetInfo.userId });
  if (!victim || !victim.assets || victim.assets.length < 2) return true; // nothing meaningful to seize

  // 🛠 FIX: was Math.ceil() — for an odd count (or worst case, exactly
  // 1 asset) that rounds UP to taking the majority or even everything.
  // Math.floor() guarantees it NEVER takes more than half, and the
  // >= 2 eligibility check above guarantees it's never zero either.
  const seizeCount = Math.floor(victim.assets.length / 2);
  // Seize the most valuable half — hurts the most, feels like a real hit
  const sortedIdx = victim.assets
    .map((a, i) => ({ i, price: a.price || 0 }))
    .sort((a, b) => b.price - a.price)
    .slice(0, seizeCount)
    .map(x => x.i)
    .sort((a, b) => b - a); // remove highest index first when splicing

  const seizedAssets = [];
  for (const i of sortedIdx) {
    seizedAssets.push(victim.assets[i]);
    victim.assets.splice(i, 1);
  }
  await victim.save();

  const lostValue = seizedAssets.reduce((s, a) => s + (a.price || 0), 0);
  const lostIncome = seizedAssets.reduce((s, a) => s + (a.income || 0), 0);

  await sock.sendMessage(chat, {
    text:
`▬▬▬▬▬▬▬▬▬▬▬▬▬▬
*💀 HACKED!*
▬▬▬▬▬▬▬▬▬▬▬▬▬▬

@${targetInfo.userId.split("@")[0]} — #1 on the leaderboard —
just got hacked!
🏢 Lost ${seizedAssets.length}/${seizedAssets.length + victim.assets.length} businesses (exactly half)
💰 Value seized: $${formatMoney(lostValue)}
📉 Daily income lost: $${formatMoney(lostIncome)}

🔒 Tip: being #1 makes you the target.
▬▬▬▬▬▬▬▬▬▬▬▬▬▬`,
    mentions: [targetInfo.userId]
  });
  return true;
}

// 🆕 HACKER SCHEDULER — same pattern as the dog race auto-scheduler:
// checks recently-active groups on a timer instead of rolling odds
// on every command, so it reliably lands ~twice a day per group.
if (!global._hackerSchedulerTimer) {
  global._hackerSchedulerTimer = setInterval(async () => {
    if (!global._lastKnownSock || !global._knownGroups) return;
    const now = Date.now();

    for (const [chat, lastSeen] of global._knownGroups) {
      if (now - lastSeen > 30 * 60 * 1000) continue; // group's gone quiet, skip
      if (activeHeists.has(chat)) continue;
      if (global._activeRaces?.has(chat)) continue;
      if (global._pntGames?.has(chat)) continue;

      try {
        await maybeTriggerHacker(global._lastKnownSock, chat);
      } catch (err) {
        console.error("Hacker scheduler error:", err.message);
      }
    }
  }, 60 * 60 * 1000); // check hourly; maybeTriggerHacker's own 12h
                        // interval per group is what actually paces it
}

// ---------- ❌⭕ X AND O ----------
if (!global._tttGames) global._tttGames = new Map();

function renderTTTBoard(board) {
  const symbols = { X: "❌", O: "⭕", "": "⬜" };
  let text = "";
  for (let i = 0; i < 9; i += 3) {
    text += `${symbols[board[i]]} ${symbols[board[i + 1]]} ${symbols[board[i + 2]]}\n`;
  }
  return text;
}

function checkTTTWinner(board) {
  const lines = [
    [0, 1, 2], [3, 4, 5], [6, 7, 8],
    [0, 3, 6], [1, 4, 7], [2, 5, 8],
    [0, 4, 8], [2, 4, 6]
  ];
  for (const [a, b, c] of lines) {
    if (board[a] && board[a] === board[b] && board[b] === board[c]) return board[a];
  }
  if (board.every(c => c)) return "draw";
  return null;
}

async function tttStartChallenge(sender, target, stake, chat, reply) {
  if (global._tttGames.has(chat))
    return reply("⚠️ A game of X-and-O is already active in this chat.");
  if (!target || target === sender) return reply("Usage: .ttt @user <stake>");
  if (isNaN(stake) || stake <= 0) return reply("Usage: .ttt @user <stake>");

  const challenger = await User.findOne({ userId: sender });
  const opponent = await User.findOne({ userId: target });
  if (!opponent) return reply("❌ That user isn't registered.");
  if (!challenger || challenger.wallet < stake)
    return reply("❌ You don't have enough wallet funds for that stake.");

  global._tttGames.set(chat, {
    player1: sender, player2: target, stake, accepted: false,
    board: Array(9).fill(""), turn: null, symbols: {}, _expiresAt: Date.now() + 60000
  });

  setTimeout(() => {
    const g = global._tttGames.get(chat);
    if (g && !g.accepted) {
      global._tttGames.delete(chat);
      reply("⌛ X-and-O challenge expired.");
    }
  }, 60000);

  return reply(
`▬▬▬▬▬▬▬▬▬▬▬▬▬▬
*❌⭕ X AND O*
▬▬▬▬▬▬▬▬▬▬▬▬▬▬

⚔️ @${sender.split("@")[0]} vs @${target.split("@")[0]}
💰 Stake: $${formatMoney(stake)}

✅ *.accept* to play
❌ *.reject* to decline
▬▬▬▬▬▬▬▬▬▬▬▬▬▬`,
    [sender, target]
  );
}

async function tttAccept(sender, chat, reply) {
  const game = global._tttGames.get(chat);
  if (!game) return false;
  if (sender !== game.player2) { reply("🚫 Only the challenged player can accept."); return true; }

  const p1 = await User.findOne({ userId: game.player1 });
  const p2 = await User.findOne({ userId: game.player2 });
  if (!p1 || !p2 || p1.wallet < game.stake || p2.wallet < game.stake) {
    global._tttGames.delete(chat);
    reply("❌ Game cancelled — one of you doesn't have enough funds anymore.");
    return true;
  }

  p1.wallet -= game.stake;
  p2.wallet -= game.stake;
  await p1.save();
  await p2.save();

  game.accepted = true;
  game.symbols[game.player1] = "X";
  game.symbols[game.player2] = "O";
  game.turn = game.player1;

  reply(
`▬▬▬▬▬▬▬▬▬▬▬▬▬▬
*❌⭕ GAME ON*
▬▬▬▬▬▬▬▬▬▬▬▬▬▬

Both locked in $${formatMoney(game.stake)}

${renderTTTBoard(game.board)}
🎯 @${game.player1.split("@")[0]} is ❌ — goes first
Type *.move <1-9>*
▬▬▬▬▬▬▬▬▬▬▬▬▬▬`,
    [game.player1, game.player2]
  );
  return true;
}

async function tttReject(sender, chat, reply) {
  const game = global._tttGames.get(chat);
  if (!game) return false;
  if (sender !== game.player2) { reply("🚫 Only the challenged player can reject."); return true; }
  global._tttGames.delete(chat);
  reply("❌ Challenge rejected.");
  return true;
}

async function tttMove(sender, chat, posArg, reply) {
  const game = global._tttGames.get(chat);
  if (!game || !game.accepted) return reply("❌ No active X-and-O game. Start one with .ttt @user <stake>");
  if (sender !== game.player1 && sender !== game.player2) return reply("🚫 You're not in this game.");
  if (sender !== game.turn) return reply("⏳ Not your turn — hang tight.");

  const pos = parseInt(posArg) - 1;
  if (isNaN(pos) || pos < 0 || pos > 8)
    return reply("Usage: .move <1-9>\n1 2 3\n4 5 6\n7 8 9");
  if (game.board[pos]) return reply("❌ That square is already taken.");

  game.board[pos] = game.symbols[sender];
  const result = checkTTTWinner(game.board);
  const other = sender === game.player1 ? game.player2 : game.player1;

  if (result === "draw") {
    const p1 = await User.findOne({ userId: game.player1 });
    const p2 = await User.findOne({ userId: game.player2 });
    if (p1) { p1.wallet += game.stake; await p1.save(); }
    if (p2) { p2.wallet += game.stake; await p2.save(); }
    global._tttGames.delete(chat);
    return reply(
`▬▬▬▬▬▬▬▬▬▬▬▬▬▬
*❌⭕ DRAW*
▬▬▬▬▬▬▬▬▬▬▬▬▬▬

${renderTTTBoard(game.board)}
🤝 It's a tie! Stakes refunded.
▬▬▬▬▬▬▬▬▬▬▬▬▬▬`,
      [game.player1, game.player2]
    );
  }

  if (result) {
    const winner = await User.findOne({ userId: sender });
    const pot = game.stake * 2;
    if (winner) { winner.wallet += pot; await winner.save(); }
    global._tttGames.delete(chat);
    return reply(
`▬▬▬▬▬▬▬▬▬▬▬▬▬▬
*❌⭕ WINNER!*
▬▬▬▬▬▬▬▬▬▬▬▬▬▬

${renderTTTBoard(game.board)}
🏆 @${sender.split("@")[0]} wins $${formatMoney(pot)}!
▬▬▬▬▬▬▬▬▬▬▬▬▬▬`,
      [game.player1, game.player2]
    );
  }

  game.turn = other;
  return reply(
`${renderTTTBoard(game.board)}
🎯 @${other.split("@")[0]}'s turn (${game.symbols[other]})
Type *.move <1-9>*`,
    [other]
  );
}

// ---------- ⚡ QUICK DRAW ----------
if (!global._quickDraw) global._quickDraw = new Map();
if (!global._quickDrawCooldowns) global._quickDrawCooldowns = new Map();

const QD_WORDS = [
  "banana", "rocket", "dragon", "laptop", "pizza",
  "tiger", "galaxy", "wizard", "ninja", "phone",
  "cookie", "shadow", "thunder", "diamond", "coffee"
];
const QD_CHANCE = 0.08;
const QD_COOLDOWN = 15 * 60 * 1000;
const QD_WINDOW = 15000;
const QD_REWARD = 300000;

async function maybeTriggerQuickDraw(sock, chat, isGroup) {
  if (!isGroup) return false;
  if (global._quickDraw.has(chat)) return false;

  const last = global._quickDrawCooldowns.get(chat);
  if (last && Date.now() - last < QD_COOLDOWN) return false;

  const word = QD_WORDS[randomInt(0, QD_WORDS.length - 1)];
  global._quickDrawCooldowns.set(chat, Date.now());
  global._quickDraw.set(chat, { word, endsAt: Date.now() + QD_WINDOW, claimed: false });

  await sock.sendMessage(chat, {
    text:
`▬▬▬▬▬▬▬▬▬▬▬▬▬▬
*⚡ QUICK DRAW*
▬▬▬▬▬▬▬▬▬▬▬▬▬▬

First to type:
👉 *${word}*

💰 Wins $${formatMoney(QD_REWARD)}
⏰ 15 seconds — GO!
▬▬▬▬▬▬▬▬▬▬▬▬▬▬`
  });

  setTimeout(() => {
    const g = global._quickDraw.get(chat);
    if (g && !g.claimed) {
      global._quickDraw.delete(chat);
      sock.sendMessage(chat, { text: `⌛ Too slow! Nobody typed "${word}" in time.` });
    }
  }, QD_WINDOW);

  return true;
}

async function checkQuickDraw(sender, chat, text, sock) {
  const g = global._quickDraw.get(chat);
  if (!g || g.claimed) return false;
  if (Date.now() > g.endsAt) return false;
  if (text.trim().toLowerCase() !== g.word) return false;

  g.claimed = true;
  global._quickDraw.delete(chat);

  const user = await User.findOne({ userId: sender });
  if (user) {
    user.wallet += QD_REWARD;
    await user.save();
  }

  await sock.sendMessage(chat, {
    text: `⚡ @${sender.split("@")[0]} was fastest and won $${formatMoney(QD_REWARD)}! 🎉`,
    mentions: [sender]
  });
  return true;
}

// ---------- 🐕 DOG RACE (admin-started OR automatic every ~10 min) ----------
// Uses WhatsApp's message-edit support to animate the race in place
// instead of spamming a new message every tick. Falls back to sending
// fresh messages if editing isn't supported on your Baileys version.
if (!global._activeRaces) global._activeRaces = new Map();
if (!global._lastAutoRace) global._lastAutoRace = new Map();

const RACE_TRACK_LENGTH = 32;       // longer track = a real race, not a sprint
const RACE_BET_WINDOW = 60000;      // 1 minute to bet, as requested
const RACE_TICK_MS = 2000;
const RACE_MAX_TICKS = 30;
const AUTO_RACE_INTERVAL = 2 * 60 * 60 * 1000; // 🛠 changed from 10 min to every 2 hours
const DOG_POOL = [
  { emoji: "🐶", name: "Rex" },
  { emoji: "🐕", name: "Max" },
  { emoji: "🐩", name: "Bella" },
  { emoji: "🦮", name: "Duke" },
  { emoji: "🐺", name: "Luna" },
  { emoji: "🐕‍🦺", name: "Zoe" }
];

async function isGroupAdminOrOwner(sock, chat, sender) {
  if (config.ownerNumbers.some(o => normalizeJid(o) === normalizeJid(sender))) return true;
  try {
    const metadata = await sock.groupMetadata(chat);
    const senderNorm = normalizeJid(sender);
    const participant = metadata.participants.find(p => normalizeJid(p.id) === senderNorm);
    return participant?.admin === "admin" || participant?.admin === "superadmin";
  } catch {
    return false;
  }
}

// 🛠 Simplified per feedback — the dotted/filler track looked messy.
// Now it's just paw prints trailing behind each dog up to the finish
// line, nothing else. Visual width is capped independently of the
// internal track length so the message stays compact no matter how
// long the actual race track is.
const RACE_VISUAL_WIDTH = 14;

function renderRaceBoard(dogs) {
  const sorted = [...dogs].sort((a, b) => b.pos - a.pos);
  const leaderPos = sorted[0]?.pos || 0;

  return dogs.map(d => {
    const visualProgress = Math.min(
      RACE_VISUAL_WIDTH,
      Math.round((d.pos / RACE_TRACK_LENGTH) * RACE_VISUAL_WIDTH)
    );
    const prints = "🐾".repeat(visualProgress);
    const gap = d === sorted[0] ? "🔥 LEADING" : `-${leaderPos - d.pos}`;
    return `${d.number}. ${prints}${d.emoji} 🏁 ${d.name} ${gap}`;
  }).join("\n");
}

function buildRaceSetup(numDogs) {
  return DOG_POOL.slice(0, numDogs).map((d, i) => ({
    ...d,
    number: i + 1,
    pos: 0,
    // Hidden per-dog "personality" so some dogs run consistently
    // faster/slower than others instead of everything being pure
    // noise — makes the race feel less like a coin flip.
    speedFactor: 0.75 + Math.random() * 0.5
  }));
}

async function beginRaceSession(sock, chat, extraNote) {
  const numDogs = randomInt(4, 6);
  const dogs = buildRaceSetup(numDogs);

  global._activeRaces.set(chat, { dogs, bets: new Map(), phase: "betting" });
  global._lastAutoRace.set(chat, Date.now());

  let announce = "▬▬▬▬▬▬▬▬▬▬▬▬▬▬\n*🐕 DOG RACE — PLACE YOUR BETS!*\n▬▬▬▬▬▬▬▬▬▬▬▬▬▬\n\n";
  dogs.forEach(d => { announce += `${d.number}. ${d.emoji} ${d.name}\n`; });
  announce += "\nUse *.dogbet <number> <amount>*\n⏰ 1 minute to bet!";
  if (extraNote) announce += `\n\n${extraNote}`;
  announce += "\n▬▬▬▬▬▬▬▬▬▬▬▬▬▬";

  await sock.sendMessage(chat, { text: announce });
  setTimeout(() => runDogRace(sock, chat), RACE_BET_WINDOW);
  return true;
}

async function startDogRace(sock, chat, sender, reply) {
  if (global._activeRaces.has(chat)) return reply("⚠️ A race is already running in this chat.");

  const isAdmin = await isGroupAdminOrOwner(sock, chat, sender);
  if (!isAdmin) return reply("🚫 Only group admins can start a race.");

  return beginRaceSession(sock, chat, null);
}

// Called by the automatic scheduler below — no admin check needed
// since it's a system event, not something a user triggered.
async function autoStartDogRace(sock, chat) {
  if (global._activeRaces.has(chat)) return false;
  return beginRaceSession(sock, chat, "🤖 Automatic race — one runs roughly every 10 minutes!");
}

async function placeDogBet(sender, chat, dogArg, amountArg, reply) {
  const race = global._activeRaces.get(chat);
  if (!race || race.phase !== "betting")
    return reply("❌ No race is accepting bets right now.");
  if (race.bets.has(sender))
    return reply("⚠️ You already placed a bet on this race.");

  const dogNumber = parseInt(dogArg);
  const amount = parseInt(amountArg);
  const dog = race.dogs.find(d => d.number === dogNumber);

  if (!dog) return reply(`❌ Pick a dog between 1 and ${race.dogs.length}.\nUsage: .dogbet <number> <amount>`);
  if (isNaN(amount) || amount <= 0) return reply("Usage: .dogbet <dog number> <amount>");

  const bettor = await User.findOne({ userId: sender });
  if (!bettor || bettor.wallet < amount) return reply("❌ Not enough wallet funds.");

  bettor.wallet -= amount;
  await bettor.save();
  race.bets.set(sender, { dog: dogNumber, amount });

  return reply(`✅ @${sender.split("@")[0]} bet $${formatMoney(amount)} on ${dog.emoji} ${dog.name}!`, [sender]);
}

async function runDogRace(sock, chat) {
  const race = global._activeRaces.get(chat);
  if (!race) return;
  race.phase = "racing";

  let raceMsg;
  try {
    raceMsg = await sock.sendMessage(chat, {
      text: `▬▬▬▬▬▬▬▬▬▬▬▬▬▬\n*🐕 AND THEY'RE OFF!*\n▬▬▬▬▬▬▬▬▬▬▬▬▬▬\n\n${renderRaceBoard(race.dogs)}\n▬▬▬▬▬▬▬▬▬▬▬▬▬▬`
    });
  } catch (err) {
    console.error("Race start message failed:", err.message);
    global._activeRaces.delete(chat);
    return;
  }

  let winner = null;
  let ticks = 0;

  while (!winner && ticks < RACE_MAX_TICKS) {
    await new Promise(r => setTimeout(r, RACE_TICK_MS));
    ticks++;

    for (const dog of race.dogs) {
      const base = randomInt(1, 4);
      dog.pos += Math.max(1, Math.round(base * dog.speedFactor));
    }

    winner = race.dogs.find(d => d.pos >= RACE_TRACK_LENGTH) || null;
    const label = winner ? "*🏁 PHOTO FINISH!*" : "*🐕 RACE IN PROGRESS*";
    const boardText = `▬▬▬▬▬▬▬▬▬▬▬▬▬▬\n${label}\n▬▬▬▬▬▬▬▬▬▬▬▬▬▬\n\n${renderRaceBoard(race.dogs)}\n▬▬▬▬▬▬▬▬▬▬▬▬▬▬`;

    try {
      await sock.sendMessage(chat, { text: boardText, edit: raceMsg.key });
    } catch (err) {
      try { raceMsg = await sock.sendMessage(chat, { text: boardText }); } catch {}
    }
  }

  if (!winner) winner = race.dogs.reduce((a, b) => (a.pos > b.pos ? a : b));
  global._activeRaces.delete(chat);

  const payoutMultiplier = +(race.dogs.length * 0.8).toFixed(1);
  let resultText = `▬▬▬▬▬▬▬▬▬▬▬▬▬▬\n*🏆 WINNER: ${winner.emoji} ${winner.name}!*\n▬▬▬▬▬▬▬▬▬▬▬▬▬▬\n\n`;
  let mentions = [];

  if (race.bets.size === 0) {
    resultText += "Nobody bet on this race 😢";
  } else {
    for (const [userId, bet] of race.bets) {
      mentions.push(userId);
      if (bet.dog === winner.number) {
        const payout = Math.floor(bet.amount * payoutMultiplier);
        const winnerUser = await User.findOne({ userId });
        if (winnerUser) {
          winnerUser.wallet += payout;
          await winnerUser.save();
        }
        resultText += `✅ @${userId.split("@")[0]} won $${formatMoney(payout)}\n`;
      } else {
        resultText += `💀 @${userId.split("@")[0]} lost $${formatMoney(bet.amount)}\n`;
      }
    }
  }
  resultText += "▬▬▬▬▬▬▬▬▬▬▬▬▬▬";

  try {
    await sock.sendMessage(chat, { text: resultText, edit: raceMsg.key, mentions });
  } catch {
    await sock.sendMessage(chat, { text: resultText, mentions });
  }
}

// 🆕 AUTOMATIC RACE SCHEDULER — runs independently of any command,
// checking every 30s whether any recently-active group is due for a
// race (~every 10 min) and doesn't already have one running.
if (!global._autoRaceTimer) {
  global._autoRaceTimer = setInterval(async () => {
    if (!global._lastKnownSock || !global._knownGroups) return;
    const now = Date.now();

    for (const [chat, lastSeen] of global._knownGroups) {
      if (now - lastSeen > 30 * 60 * 1000) continue;
      if (global._activeRaces.has(chat)) continue;

      const lastRace = global._lastAutoRace.get(chat) || 0;
      if (now - lastRace < AUTO_RACE_INTERVAL) continue;

      try {
        await autoStartDogRace(global._lastKnownSock, chat);
      } catch (err) {
        console.error("Auto race error:", err.message);
      }
    }
  }, 30000);
}

// ---------- 🪨📄✂️ ROCK PAPER SCISSORS (NEW) ----------
// Challenge + accept/reject happen in the group like normal. Once
// accepted, the bot DMs both players privately to ask for their move
// — nobody can see or copy their opponent's pick in the group chat.
// The result is revealed publicly in the group once both have thrown.
if (!global._rpsGames) global._rpsGames = new Map();          // chat -> game
if (!global._rpsPlayerToChat) global._rpsPlayerToChat = new Map(); // playerId -> chat

const RPS_EMOJI = { rock: "🪨", paper: "📄", scissors: "✂️" };
const RPS_ALIASES = { rock: "rock", r: "rock", paper: "paper", p: "paper", scissors: "scissors", s: "scissors" };

function rpsBeats(a, b) {
  return (a === "rock" && b === "scissors") ||
         (a === "paper" && b === "rock") ||
         (a === "scissors" && b === "paper");
}

async function rpsStartChallenge(sender, target, stake, chat, reply) {
  if (global._rpsGames.has(chat))
    return reply("⚠️ A Rock-Paper-Scissors game is already active in this chat.");
  if (!target || target === sender) return reply("Usage: .rps @user <stake>");
  if (isNaN(stake) || stake <= 0) return reply("Usage: .rps @user <stake>");

  const challenger = await User.findOne({ userId: sender });
  const opponent = await User.findOne({ userId: target });
  if (!opponent) return reply("❌ That user isn't registered.");
  if (!challenger || challenger.wallet < stake)
    return reply("❌ Not enough wallet funds for that stake.");

  global._rpsGames.set(chat, {
    player1: sender, player2: target, stake, accepted: false, throws: {}, _expiresAt: Date.now() + 60000
  });

  setTimeout(() => {
    const g = global._rpsGames.get(chat);
    if (g && !g.accepted) {
      global._rpsGames.delete(chat);
      reply("⌛ RPS challenge expired.");
    }
  }, 60000);

  return reply(
`▬▬▬▬▬▬▬▬▬▬▬▬▬▬
*🪨📄✂️ ROCK PAPER SCISSORS*
▬▬▬▬▬▬▬▬▬▬▬▬▬▬

⚔️ @${sender.split("@")[0]} vs @${target.split("@")[0]}
💰 Stake: $${formatMoney(stake)}

✅ *.accept* to play
❌ *.reject* to decline
▬▬▬▬▬▬▬▬▬▬▬▬▬▬`,
    [sender, target]
  );
}

async function rpsAccept(sock, sender, chat, reply) {
  const game = global._rpsGames.get(chat);
  if (!game) return false;
  if (sender !== game.player2) { reply("🚫 Only the challenged player can accept."); return true; }

  const p1 = await User.findOne({ userId: game.player1 });
  const p2 = await User.findOne({ userId: game.player2 });
  if (!p1 || !p2 || p1.wallet < game.stake || p2.wallet < game.stake) {
    global._rpsGames.delete(chat);
    reply("❌ Game cancelled — one of you doesn't have enough funds anymore.");
    return true;
  }

  p1.wallet -= game.stake;
  p2.wallet -= game.stake;
  await p1.save();
  await p2.save();
  game.accepted = true;

  global._rpsPlayerToChat.set(game.player1, chat);
  global._rpsPlayerToChat.set(game.player2, chat);

  // 🛠 IMPORTANT: the bot no longer DMs anyone here. WhatsApp flags
  // bots that push unprompted DMs to multiple numbers at once as
  // spam — that's what got the account banned before. Now both
  // players have to message the bot FIRST (with "ready"), and the
  // bot only ever REPLIES to an inbound message, never initiates.
  reply(
`▬▬▬▬▬▬▬▬▬▬▬▬▬▬
*🪨📄✂️ GAME ON*
▬▬▬▬▬▬▬▬▬▬▬▬▬▬

Both locked in $${formatMoney(game.stake)}

📩 Both of you: DM me *ready* to get your
private move prompt. Nobody's pick is shown
until BOTH have thrown.
▬▬▬▬▬▬▬▬▬▬▬▬▬▬`,
    [game.player1, game.player2]
  );

  return true;
}

async function rpsReject(sender, chat, reply) {
  const game = global._rpsGames.get(chat);
  if (!game) return false;
  if (sender !== game.player2) { reply("🚫 Only the challenged player can reject."); return true; }
  global._rpsGames.delete(chat);
  reply("❌ Challenge rejected.");
  return true;
}

// Called from a DM — resolves via the sender's reverse-mapped chat
// rather than needing the group chat passed in explicitly.
// Sent only in reply to the player DMing "ready" — never pushed
// unprompted, which is what avoids tripping WhatsApp's spam detection.
async function rpsSendMovePrompt(sock, sender) {
  const chat = global._rpsPlayerToChat.get(sender);
  if (!chat) return false;

  const game = global._rpsGames.get(chat);
  if (!game || !game.accepted) {
    global._rpsPlayerToChat.delete(sender);
    return false;
  }

  if (game.throws[sender]) {
    await safeDM(sock, sender, { text: "✅ You've already locked in your move — just waiting on your opponent now." });
    return true;
  }

  await safeDM(sock, sender, {
    text:
`*🪨📄✂️ YOUR MOVE*

Reply here with:
*rock* / *paper* / *scissors*
(r / p / s also work)

Stake: $${formatMoney(game.stake)}`
  });
  return true;
}

async function rpsThrowDM(sock, sender, choiceArg) {
  const chat = global._rpsPlayerToChat.get(sender);
  if (!chat) return false; // no pending RPS game for this player

  const game = global._rpsGames.get(chat);
  if (!game || !game.accepted) {
    global._rpsPlayerToChat.delete(sender);
    return false;
  }

  const choice = RPS_ALIASES[choiceArg?.toLowerCase()];
  if (!choice) {
    await safeDM(sock, sender, { text: "Reply with: rock / paper / scissors (or r/p/s)" });
    return true;
  }
  if (game.throws[sender]) {
    await safeDM(sock, sender, { text: "⚠️ You already locked in your move for this round." });
    return true;
  }

  game.throws[sender] = choice;
  const other = sender === game.player1 ? game.player2 : game.player1;

  await safeDM(sock, sender, { text: `🔒 Locked in: ${RPS_EMOJI[choice]} ${choice}. Waiting on your opponent...` });

  if (!game.throws[other]) {
    return true; // still waiting on the other player
  }

  // Both have thrown — resolve and reveal PUBLICLY in the group.
  const c1 = game.throws[game.player1];
  const c2 = game.throws[game.player2];
  global._rpsGames.delete(chat);
  global._rpsPlayerToChat.delete(game.player1);
  global._rpsPlayerToChat.delete(game.player2);

  const pot = game.stake * 2;

  if (c1 === c2) {
    const p1 = await User.findOne({ userId: game.player1 });
    const p2 = await User.findOne({ userId: game.player2 });
    if (p1) { p1.wallet += game.stake; await p1.save(); }
    if (p2) { p2.wallet += game.stake; await p2.save(); }
    await sock.sendMessage(chat, {
      text:
`▬▬▬▬▬▬▬▬▬▬▬▬▬▬
*🪨📄✂️ RESULT*
▬▬▬▬▬▬▬▬▬▬▬▬▬▬

@${game.player1.split("@")[0]}: ${RPS_EMOJI[c1]} ${c1}
@${game.player2.split("@")[0]}: ${RPS_EMOJI[c2]} ${c2}

🤝 Tie! Stakes refunded.
▬▬▬▬▬▬▬▬▬▬▬▬▬▬`,
      mentions: [game.player1, game.player2]
    });
    return true;
  }

  const p1Wins = rpsBeats(c1, c2);
  const winnerId = p1Wins ? game.player1 : game.player2;
  const winner = await User.findOne({ userId: winnerId });
  if (winner) { winner.wallet += pot; await winner.save(); }

  await sock.sendMessage(chat, {
    text:
`▬▬▬▬▬▬▬▬▬▬▬▬▬▬
*🪨📄✂️ RESULT*
▬▬▬▬▬▬▬▬▬▬▬▬▬▬

@${game.player1.split("@")[0]}: ${RPS_EMOJI[c1]} ${c1}
@${game.player2.split("@")[0]}: ${RPS_EMOJI[c2]} ${c2}

🏆 @${winnerId.split("@")[0]} wins $${formatMoney(pot)}!
▬▬▬▬▬▬▬▬▬▬▬▬▬▬`,
    mentions: [game.player1, game.player2]
  });
  return true;
}

// ---------- 🚔 POLICE & THIEF (NEW) ----------
// Anyone can spawn a lobby, others join in the group. Once it starts,
// EVERY action (hide/rob/defend) happens privately via DM — nothing
// about who's doing what is visible in the group until each round's
// results are revealed. 3 rounds, scores tallied, winner(s) announced
// (there can be ties, so more than one winner is possible).
if (!global._pntLobbies) global._pntLobbies = new Map();       // chat -> lobby
if (!global._pntGames) global._pntGames = new Map();           // chat -> game state
if (!global._pntPlayerToChat) global._pntPlayerToChat = new Map(); // playerId -> chat

const PNT_LOCATIONS = ["Mart", "Carwash", "Bank", "Warehouse", "Casino", "Cinema"]; // 🛠 reduced from 10 to 6
const PNT_MIN_PLAYERS = 3;
const PNT_LOBBY_WINDOW = 45000;   // 45s to join
const PNT_ACTION_WINDOW = 90000; // 1.5 min per round, as requested
const PNT_REVEAL_PAUSE = 25000;  // 25s between reveal and next round
const PNT_ROUNDS = 3;

function assignPNTRoles(playerCount) {
  let police, thieves;
  if (playerCount <= 4) { police = 1; thieves = 1; }
  else if (playerCount <= 7) { police = 1; thieves = 2; }
  else if (playerCount <= 10) { police = 2; thieves = 3; }
  else { police = 3; thieves = 4; }
  const civilians = playerCount - police - thieves;
  return { police, thieves, civilians };
}

async function startPNTLobby(chat, sender, reply) {
  if (global._pntLobbies.has(chat) || global._pntGames.has(chat)) {
    await reply("⚠️ A Police & Thief game is already starting or running in this chat.");
    return false;
  }

  const user = await User.findOne({ userId: sender });
  if (!user) {
    await reply("❌ You need to be registered. Type .register first.");
    return false;
  }

  global._pntLobbies.set(chat, { players: new Set([sender]), startedAt: Date.now() });

  await reply(
`*🚔 POLICE & THIEF — LOBBY OPEN*

@${sender.split("@")[0]} started a game!
Type *.pntjoin* to join.

👥 Minimum ${PNT_MIN_PLAYERS} players
⏰ Starting in ${PNT_LOBBY_WINDOW / 1000}s...`,
    [sender]
  );
  return true;
}

async function joinPNTLobby(chat, sender, reply) {
  const lobby = global._pntLobbies.get(chat);
  if (!lobby) return reply("❌ No open lobby right now. Start one with .pnt");
  if (lobby.players.has(sender)) return reply("⚠️ You already joined this lobby.");

  const user = await User.findOne({ userId: sender });
  if (!user) return reply("❌ You need to be registered. Type .register first.");

  lobby.players.add(sender);
  return reply(`✅ @${sender.split("@")[0]} joined! (${lobby.players.size} players so far)`, [sender]);
}

async function finalizePNTLobby(sock, chat) {
  const lobby = global._pntLobbies.get(chat);
  if (!lobby) return;
  global._pntLobbies.delete(chat);

  const players = [...lobby.players];
  if (players.length < PNT_MIN_PLAYERS) {
    await sock.sendMessage(chat, {
      text: `❌ Not enough players joined (${players.length}/${PNT_MIN_PLAYERS} min). Game cancelled.`
    });
    return;
  }

  await startPNTGame(sock, chat, players);
}

async function startPNTGame(sock, chat, players) {
  const { police, thieves, civilians } = assignPNTRoles(players.length);
  const shuffled = [...players].sort(() => Math.random() - 0.5);

  const roles = {};
  let idx = 0;
  for (let i = 0; i < police; i++) roles[shuffled[idx++]] = "police";
  for (let i = 0; i < thieves; i++) roles[shuffled[idx++]] = "thief";
  for (let i = 0; i < civilians; i++) roles[shuffled[idx++]] = "civilian";

  // 🛠 rolesSent tracks who has actually DMed "ready" and received
  // their role — only THOSE players get proactive round reminders
  // later, since they've already established a real conversation.
  // Nobody who hasn't messaged the bot first ever gets DMed cold.
  const game = { players, roles, scores: {}, round: 0, actions: {}, phase: "lobby", rolesSent: new Set() };
  global._pntGames.set(chat, game);
  for (const id of players) global._pntPlayerToChat.set(id, chat);

  await sock.sendMessage(chat, {
    text:
`*🚔 GAME STARTING!*

${players.length} players:
👮 Police: ${police}
🥷 Thieves: ${thieves}
🧍 Civilians: ${civilians}

📍 *THE ${PNT_LOCATIONS.length} LOCATIONS* (same every game):
${PNT_LOCATIONS.map((loc, i) => `${i + 1}. ${loc}`).join("\n")}

Police defend one, Thieves rob one, Civilians
hide in one — every round, picked privately in DM.

📩 IMPORTANT: DM me *ready* now to receive
your secret role! I can't message you first —
WhatsApp doesn't like bots doing that.
Round 1 begins shortly...`,
    mentions: players
  });

  setTimeout(() => startPNTRound(sock, chat, 1), 3000);
}

function pntRoundPromptText(role, roundNum) {
  const roundsLeft = PNT_ROUNDS - roundNum + 1;
  if (role === "police") {
    return `*👮 ROUND ${roundNum}/${PNT_ROUNDS}*\n\nReply: *defend <place>*\n(one of the ${PNT_LOCATIONS.length} from the start of the game — DM "locations" if you forgot)\n🔫 Rounds left: ${roundsLeft}`;
  }
  if (role === "thief") {
    return `*🥷 ROUND ${roundNum}/${PNT_ROUNDS}*\n\nReply: *robplace <place>*\n(one of the ${PNT_LOCATIONS.length} from the start of the game — DM "locations" if you forgot)\n🔫 Rounds left: ${roundsLeft}`;
  }
  return `*🧍 ROUND ${roundNum}/${PNT_ROUNDS}*\n\nReply: *hide <place>*\n(one of the ${PNT_LOCATIONS.length} from the start of the game — DM "locations" if you forgot)`;
}

async function startPNTRound(sock, chat, roundNum) {
  const game = global._pntGames.get(chat);
  if (!game) return;

  game.round = roundNum;
  game.phase = "action";
  game.actions = {};

  await sock.sendMessage(chat, {
    text:
`*🚔 ROUND ${roundNum}/${PNT_ROUNDS}*

📩 Check your DMs to make your move.
⏰ 90 seconds!`
  });

  // 🛠 Only players who've already DMed "ready" at least once (and
  // so have an established conversation with the bot) get proactive
  // round reminders. Anyone who never said ready simply won't get
  // pinged — they can catch up anytime by DMing "ready".
  for (const playerId of game.players) {
    if (!game.rolesSent.has(playerId)) continue;
    const text = pntRoundPromptText(game.roles[playerId], roundNum);
    await safeDM(sock, playerId, { text });
  }

  setTimeout(() => resolvePNTRound(sock, chat), PNT_ACTION_WINDOW);
}

// Sent only in reply to a player's own "ready" DM — this is what
// replaces the old unprompted bulk role-reveal push.
async function pntSendReady(sock, sender) {
  const chat = global._pntPlayerToChat.get(sender);
  if (!chat) return false;

  const game = global._pntGames.get(chat);
  if (!game) {
    global._pntPlayerToChat.delete(sender);
    return false;
  }

  const role = game.roles[sender];
  const roleMsgs = {
    police: "👮 You are POLICE.\n\nEach round, DM me *defend <place>* to guard one location. Catch a thief there and you score big!",
    thief: "🥷 You are a THIEF.\n\nEach round, DM me *robplace <place>* to rob one location. Avoid police, cash in on civilians!",
    civilian: "🧍 You are a CIVILIAN.\n\nEach round, DM me *hide <place>* to hide. Pick somewhere nobody else thinks of!"
  };

  if (!game.rolesSent.has(sender)) {
    game.rolesSent.add(sender);
    await safeDM(sock, sender, { text: `*🎭 YOUR ROLE*\n\n${roleMsgs[role]}` });
  }

  // If a round is already underway, catch them up immediately too.
  if (game.phase === "action") {
    await safeDM(sock, sender, { text: pntRoundPromptText(role, game.round) });
  }

  return true;
}

// Called from a DM — routes based on the sender's active PNT game
async function submitPNTAction(sock, sender, actionType, locationArg) {
  const chat = global._pntPlayerToChat.get(sender);
  if (!chat) return false;

  const game = global._pntGames.get(chat);
  if (!game || game.phase !== "action") {
    await safeDM(sock, sender, { text: "❌ No active round to act in right now." });
    return true;
  }

  const role = game.roles[sender];
  const expectedAction = { police: "defend", thief: "robplace", civilian: "hide" }[role];
  if (actionType !== expectedAction) {
    await safeDM(sock, sender, { text: `🚫 You're ${role === "police" ? "police" : `a ${role}`} — that's not your action. Yours is *${expectedAction} <place>*` });
    return true;
  }

  const location = PNT_LOCATIONS.find(l => l.toLowerCase() === (locationArg || "").trim().toLowerCase());
  if (!location) {
    await safeDM(sock, sender, { text: `❌ Not a valid location. Choose one:\n${PNT_LOCATIONS.join(", ")}` });
    return true;
  }

  game.actions[sender] = location;
  const verb = { defend: "defending", robplace: "robbing", hide: "hiding in" }[actionType];
  await safeDM(sock, sender, { text: `✅ Locked in: ${verb} ${location} this round.` });
  return true;
}

async function resolvePNTRound(sock, chat) {
  const game = global._pntGames.get(chat);
  if (!game) return;
  game.phase = "reveal";

  const byLocation = {};
  for (const loc of PNT_LOCATIONS) byLocation[loc] = { police: [], thieves: [], civilians: [] };

  for (const [playerId, loc] of Object.entries(game.actions)) {
    const role = game.roles[playerId];
    if (!byLocation[loc]) continue;
    if (role === "police") byLocation[loc].police.push(playerId);
    else if (role === "thief") byLocation[loc].thieves.push(playerId);
    else byLocation[loc].civilians.push(playerId);
  }

  let reveal = `*📋 ROUND ${game.round} RESULTS*\n\n`;
  let anyActivity = false;
  const allMentioned = [];

  for (const loc of PNT_LOCATIONS) {
    const { police, thieves, civilians } = byLocation[loc];
    if (!police.length && !thieves.length && !civilians.length) continue;
    anyActivity = true;

    const hasP = police.length > 0;
    const hasT = thieves.length > 0;
    const hasC = civilians.length > 0;

    let line = `📍 *${loc}*\n`;
    if (hasC) line += `🧍 Hid: ${civilians.map(id => "@" + id.split("@")[0]).join(", ")}\n`;
    if (hasT) line += `🥷 Robbed by: ${thieves.map(id => "@" + id.split("@")[0]).join(", ")}\n`;
    if (hasP) line += `👮 Defended by: ${police.map(id => "@" + id.split("@")[0]).join(", ")}\n`;

    allMentioned.push(...police, ...thieves, ...civilians);

    // 🎯 Scoring — see the .pnt help text for the full breakdown
    if (hasP && hasT && hasC) {
      police.forEach(id => game.scores[id] = (game.scores[id] || 0) + 1);
      thieves.forEach(id => game.scores[id] = (game.scores[id] || 0) + 1);
      civilians.forEach(id => game.scores[id] = (game.scores[id] || 0) + 1);
      line += `⚡ Everyone clashed here — 1 point each!\n`;
    } else if (hasP && hasT && !hasC) {
      police.forEach(id => game.scores[id] = (game.scores[id] || 0) + (2 * thieves.length));
      line += `🚔 Police caught the thief${thieves.length > 1 ? "ves" : ""}! +${2 * thieves.length} pts each police\n`;
    } else if (hasP && !hasT && hasC) {
      police.forEach(id => game.scores[id] = (game.scores[id] || 0) + civilians.length);
      civilians.forEach(id => game.scores[id] = (game.scores[id] || 0) + 1);
      line += `👮 Police found the civilian(s)! +${civilians.length} pt(s) each police, +1 pt each civilian\n`;
    } else if (!hasP && hasT && hasC) {
      thieves.forEach(id => game.scores[id] = (game.scores[id] || 0) + (2 * civilians.length));
      line += `💰 Thief robbed unguarded civilians! +${2 * civilians.length} pts each thief\n`;
    } else if (hasC && !hasP && !hasT) {
      civilians.forEach(id => game.scores[id] = (game.scores[id] || 0) + 2);
      line += `🕶 Civilian(s) hid undetected! +2 pts each\n`;
    } else if (hasP && !hasT && !hasC) {
      line += `👮 Police patrolled but found nothing.\n`;
    } else if (hasT && !hasP && !hasC) {
      line += `🥷 Thief robbed an empty place. Nothing gained.\n`;
    }

    reveal += line + "\n";
  }

  if (!anyActivity) reveal += "Nobody made a move this round...\n";
  reveal += `\n🔫 Rounds remaining: ${PNT_ROUNDS - game.round}`;

  await sock.sendMessage(chat, { text: reveal, mentions: [...new Set(allMentioned)] });

  if (game.round >= PNT_ROUNDS) {
    setTimeout(() => finalizePNTGame(sock, chat), PNT_REVEAL_PAUSE);
  } else {
    setTimeout(() => startPNTRound(sock, chat, game.round + 1), PNT_REVEAL_PAUSE);
  }
}

async function finalizePNTGame(sock, chat) {
  const game = global._pntGames.get(chat);
  if (!game) return;

  const scores = game.scores;
  let maxScore = -Infinity;
  for (const id of game.players) {
    const s = scores[id] || 0;
    if (s > maxScore) maxScore = s;
  }

  const winners = game.players.filter(id => (scores[id] || 0) === maxScore);
  const roleEmoji = { police: "👮", thief: "🥷", civilian: "🧍" };

  let text = `*🏆 GAME OVER — FINAL SCORES*\n\n`;
  const sortedPlayers = [...game.players].sort((a, b) => (scores[b] || 0) - (scores[a] || 0));
  sortedPlayers.forEach(id => {
    text += `${roleEmoji[game.roles[id]]} @${id.split("@")[0]} — ${scores[id] || 0} pts\n`;
  });

  text += `\n👑 Winner${winners.length > 1 ? "s" : ""}: ${winners.map(id => "@" + id.split("@")[0]).join(", ")}`;

  await sock.sendMessage(chat, { text, mentions: game.players });

  for (const id of game.players) global._pntPlayerToChat.delete(id);
  global._pntGames.delete(chat);
}

// Unified DM router — called from index.js for every private message.
// Returns true if it was consumed as a game action, false otherwise
// (so index.js knows whether to keep ignoring the DM as before).
async function handleDMAction(sock, sender, text) {
  const lower = text.trim().toLowerCase();
  const stripped = lower.startsWith(config.prefix) ? lower.slice(config.prefix.length) : lower;
  const parts = stripped.split(/\s+/);
  const word0 = parts[0];

  // 🆕 🤫 SECRET CHEATCODE SYSTEM — owner DMs the bot to set a code
  // for the day. Anyone who knows it and DMs it back gets a
  // guaranteed win on their NEXT .cf/.casino/.slots/.roulette bet
  // (one-time, consumed on use). Deliberately undocumented — nothing
  // about this appears in .menu/.about, it never speaks in the
  // group, and it stays completely silent on any non-match so its
  // existence can't be fished out by guessing random words.
  const isOwnerDM = config.ownerNumbers.some(o => normalizeJid(o) === normalizeJid(sender));

  if (isOwnerDM && (word0 === "setcheatcode" || word0 === "setcheat")) {
    const code = parts.slice(1).join(" ").trim();
    if (!code) {
      await safeDM(sock, sender, { text: "Usage: setcheatcode <code>" });
      return true;
    }
    global._dailyCheatcode = { code: code.toLowerCase(), day: getNigeriaDate() };
    await safeDM(sock, sender, { text: `✅ Set for today: "${code}"` });
    return true;
  }

  if (
    global._dailyCheatcode &&
    global._dailyCheatcode.day === getNigeriaDate() &&
    stripped === global._dailyCheatcode.code
  ) {
    if (!global._guaranteedWin) global._guaranteedWin = new Set();
    global._guaranteedWin.add(sender);
    await safeDM(sock, sender, { text: "✅" });
    return true;
  }

  // 🆕 "ready" is the trigger that lets the bot send its first message
  // to a player — since it's a REPLY to something they DMed first,
  // it's never an unprompted/cold DM (the thing that got the account
  // flagged as spam before).
  if (word0 === "ready") {
    if (global._rpsPlayerToChat?.has(sender)) {
      return await rpsSendMovePrompt(sock, sender);
    }
    if (global._pntPlayerToChat?.has(sender)) {
      return await pntSendReady(sock, sender);
    }
    return false;
  }

  if (global._rpsPlayerToChat?.has(sender) && RPS_ALIASES[word0]) {
    return await rpsThrowDM(sock, sender, word0);
  }

  if (global._pntPlayerToChat?.has(sender)) {
    // 🆕 Quick reminder of the locations — shown once at game start,
    // but easy to forget mid-game, so this is a shortcut.
    if (["locations", "places", "list"].includes(word0)) {
      await safeDM(sock, sender, {
        text: `📍 *THE ${PNT_LOCATIONS.length} LOCATIONS*\n\n${PNT_LOCATIONS.map((loc, i) => `${i + 1}. ${loc}`).join("\n")}`
      });
      return true;
    }

    if (["hide", "robplace", "defend"].includes(word0)) {
      const location = parts.slice(1).join(" ");
      return await submitPNTAction(sock, sender, word0, location);
    }
  }

  return false;
}

const MARRIAGE_FEE = 100000000; // $100M
// Global shared maps (top-level so all handlers can access)
if (!global._marriageProposals) global._marriageProposals = new Map();
const marriageProposals = global._marriageProposals;

if (!global._triviaActive) global._triviaActive = new Map();

// Cleanup expired marriage proposals every 60s
if (!global._proposalCleanup) {
  global._proposalCleanup = setInterval(() => {
    const now = Date.now();
    for (const [key, p] of marriageProposals) {
      if (now > p.expiresAt) marriageProposals.delete(key);
    }
  }, 60000);
}

// =====================================================
// 🧠 SHARED TRIVIA SPAWN FUNCTION
// Used by: admin .qa + spontaneous drops
// =====================================================
async function spawnTrivia(sock, chat, mentions) {
  if (!global._triviaActive) global._triviaActive = new Map();
  const triviaActive = global._triviaActive;

  if (triviaActive.has(chat)) return false;

  try {
    const res = await axios.get("https://opentdb.com/api.php?amount=1&type=multiple", {
      timeout: 8000
    });

    if (!res.data?.results?.length) return false;

    const q = res.data.results[0];
    const clean = (s) => s
      .replace(/&quot;/g, '"')
      .replace(/&#039;/g, "'")
      .replace(/&amp;/g, "&")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&eacute;/g, "é");

    const question = clean(q.question);
    const correctAnswer = clean(q.correct_answer).toLowerCase();

    const allAnswers = [...q.incorrect_answers, q.correct_answer]
      .map(clean)
      .sort(() => Math.random() - 0.5);

    const letters = ["A", "B", "C", "D"];
    const correctIndex = allAnswers.indexOf(clean(q.correct_answer));
    const correctLetter = letters[correctIndex];

    triviaActive.set(chat, {
      correctAnswer,
      correctLetter,
      prize: 5000000,
      answeredUsers: new Set(),
      correctUsers: [],
      expiresAt: Date.now() + 30000
    });

    const diffEmoji = { easy: "🟢", medium: "🟡", hard: "🔴" }[q.difficulty] || "⚪";

    let quizText =
`▬▬▬▬▬▬▬▬▬▬▬▬▬▬
*🧠 TRIVIA QUIZ*
▬▬▬▬▬▬▬▬▬▬▬▬▬▬

📚 ${q.category}
${diffEmoji} ${q.difficulty.toUpperCase()}

${question}

▬▬▬▬▬▬▬▬▬▬▬▬▬▬`;

    allAnswers.forEach((a, i) => {
      quizText += `\n${letters[i]}. ${a}`;
    });

    quizText += `\n\n💰 Prize: $5,000,000`;
    quizText += `\n⏰ 30 seconds`;
    quizText += `\n\nType the letter (A/B/C/D) or the answer`;
    quizText += `\n⚠️ ONE answer per person`;
    quizText += `\n`;

    await sock.sendMessage(chat, { text: quizText, mentions: mentions || [] });

    // Auto-expire after 30s — show results
    setTimeout(async () => {
      const active = triviaActive.get(chat);
      if (!active) return;
      triviaActive.delete(chat);

      if (active.correctUsers.length > 0) {
        // Find fastest correct answer
        const winner = active.correctUsers[0];

        // Award prize
        const winUser = await User.findOne({ userId: winner });
        if (winUser) {
          winUser.wallet += active.prize;
          // Spouse share 20%
          if (winUser.marriage?.spouseId) {
            const spouseShare = Math.floor(active.prize * 0.2);
            const spouse = await User.findOne({ userId: winUser.marriage.spouseId });
            if (spouse) {
              spouse.wallet += spouseShare;
              await spouse.save();
            }
          }
          await winUser.save();
        }

        await sock.sendMessage(chat, {
          text:
`▬▬▬▬▬▬▬▬▬▬▬▬▬▬
*🏆 QUIZ RESULTS*
▬▬▬▬▬▬▬▬▬▬▬▬▬▬

✅ Correct answer: ${active.correctAnswer}
(${active.correctLetter})

👑 Winner: @${winner.split("@")[0]}
⚡ First to answer correctly

💰 Won: $5,000,000
📊 ${active.answeredUsers.size} players tried

▬▬▬▬▬▬▬▬▬▬▬▬▬▬`,
          mentions: [winner]
        });
      } else {
        await sock.sendMessage(chat, {
          text:
`▬▬▬▬▬▬▬▬▬▬▬▬▬▬
*⏰ QUIZ EXPIRED*
▬▬▬▬▬▬▬▬▬▬▬▬▬▬

No correct answers.
✅ Was: ${active.correctAnswer}
(${active.correctLetter})

📊 ${active.answeredUsers.size} players tried

▬▬▬▬▬▬▬▬▬▬▬▬▬▬`
        });
      }
    }, 30000);

    return true;
  } catch (err) {
    console.error("Trivia spawn error:", err.message);
    return false;
  }
}

// =====================================================
// 🧠 MULTI-QUESTION TRIVIA (Admin .quiz command)
// =====================================================
async function spawnMultiTrivia(sock, chat, mentions, questionCount = 10) {
  if (!global._multiTrivia) global._multiTrivia = new Map();
  const multiTrivia = global._multiTrivia;

  if (multiTrivia.has(chat)) return false;

  try {
    const res = await axios.get(`https://opentdb.com/api.php?amount=${questionCount}&type=multiple`, {
      timeout: 15000
    });

    if (!res.data?.results?.length) return false;

    const questions = res.data.results.map(q => {
      const clean = (s) => s
        .replace(/&quot;/g, '"')
        .replace(/&#039;/g, "'")
        .replace(/&amp;/g, "&")
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
        .replace(/&eacute;/g, "é");

      const allAnswers = [...q.incorrect_answers, q.correct_answer]
        .map(clean)
        .sort(() => Math.random() - 0.5);

      const letters = ["A", "B", "C", "D"];
      const correctIndex = allAnswers.indexOf(clean(q.correct_answer));

      return {
        question: clean(q.question),
        correctAnswer: clean(q.correct_answer).toLowerCase(),
        correctLetter: letters[correctIndex],
        allAnswers,
        difficulty: q.difficulty,
        category: q.category
      };
    });

    // Store trivia data with scores tracking
    const triviaData = {
      questions,
      currentIndex: 0,
      scores: {}, // userId -> correct count
      questionCount,
      prize: 50000000,
      expiresAt: Date.now() + (30000 * questionCount)
    };

    multiTrivia.set(chat, triviaData);

    // Send announcement first
    await sock.sendMessage(chat, {
      text:
`▬▬▬▬▬▬▬▬▬▬▬▬▬▬
*🧠 MULTI-TRIVIA*
▬▬▬▬▬▬▬▬▬▬▬▬▬▬

🎯 ${questionCount} Questions
⏱️ 30 seconds each
💰 Winner: $50,000,000

First question coming up...

▬▬▬▬▬▬▬▬▬▬▬▬▬▬`,
      mentions: mentions || []
    });

    // Start first question after 3 seconds
    await new Promise(r => setTimeout(r, 3000));
    await sendTriviaQuestion(sock, chat, triviaData, 0, mentions);

    // Schedule subsequent questions
    for (let i = 1; i < questionCount; i++) {
      // Wait 30 seconds + 2 second gap between questions
      await new Promise(r => setTimeout(r, 32000));

      const active = multiTrivia.get(chat);
      if (!active) break;

      active.currentIndex = i;
      await sendTriviaQuestion(sock, chat, triviaData, i, mentions);
    }

    // Show final results after last question
    setTimeout(async () => {
      const active = multiTrivia.get(chat);
      if (!active) return;

      // Find winner
      let winnerId = null;
      let maxScore = 0;

      for (const [userId, score] of Object.entries(active.scores)) {
        if (score > maxScore) {
          maxScore = score;
          winnerId = userId;
        }
      }

      if (winnerId && maxScore > 0) {
        const winUser = await User.findOne({ userId: winnerId });
        if (winUser) {
          winUser.wallet += active.prize;
          await winUser.save();
        }

        await sock.sendMessage(chat, {
          text:
`▬▬▬▬▬▬▬▬▬▬▬▬▬▬
*🏆 MULTI-TRIVIA RESULTS*
▬▬▬▬▬▬▬▬▬▬▬▬▬▬

👑 Winner: @${winnerId.split("@")[0]}
✅ Correct: ${maxScore}/${questionCount}

💰 Won: $50,000,000

▬▬▬▬▬▬▬▬▬▬▬▬▬▬`,
          mentions: [winnerId]
        });
      } else {
        await sock.sendMessage(chat, {
          text:
`▬▬▬▬▬▬▬▬▬▬▬▬▬▬
*❌ MULTI-TRIVIA ENDED*
▬▬▬▬▬▬▬▬▬▬▬▬▬▬

No winners!
📊 Questions: ${questionCount}

▬▬▬▬▬▬▬▬▬▬▬▬▬▬`
        });
      }

      multiTrivia.delete(chat);
    }, 30000 * questionCount + 5000);

    return true;
  } catch (err) {
    console.error("Multi-trivia spawn error:", err.message);
    return false;
  }
}

async function sendTriviaQuestion(sock, chat, triviaData, index, mentions) {
  const q = triviaData.questions[index];
  const diffEmoji = { easy: "🟢", medium: "🟡", hard: "🔴" }[q.difficulty] || "⚪";

  let quizText =
`▬▬▬▬▬▬▬▬▬▬▬▬▬▬
*🧠 TRIVIA Q${index + 1}/${triviaData.questions.length}*
▬▬▬▬▬▬▬▬▬▬▬▬▬▬

📚 ${q.category}
${diffEmoji} ${q.difficulty.toUpperCase()}

${q.question}

▬▬▬▬▬▬▬▬▬▬▬▬▬▬`;

  q.allAnswers.forEach((a, i) => {
    const letters = ["A", "B", "C", "D"];
    quizText += `\n${letters[i]}. ${a}`;
  });

  quizText += `\n\n⏰ 30 seconds per question`;
  quizText += `\n`;

  await sock.sendMessage(chat, { text: quizText, mentions: mentions || [] });
}

// 💍 Share 20% of gambling winnings with spouse
async function shareGamblingWin(user, profit) {
  if (!user.marriage?.spouseId || profit <= 0) return 0;
  const share = Math.floor(profit * 0.2);
  if (share <= 0) return 0;
  const spouse = await User.findOne({ userId: user.marriage.spouseId });
  if (spouse) {
    spouse.wallet += share;
    await spouse.save();
  }
  return share;
}

// =======================================
// 🎴 GROUP DROP TRACKING (ADD HERE)
// =======================================
const groupDropTracker = new Map();
const triviaDropTracker = new Map();   // 🆕 daily cap for spontaneous trivia (was uncapped — a big inflation source)
const spontaneousEventCooldown = new Map(); // 🆕 chat -> last event timestamp (stops events stacking)
const SPONTANEOUS_EVENT_GAP = 12 * 60 * 1000; // 🛠 widened from 4 min — events were still coming too often
const activeDrops = new Map();
const activeDiceGames = new Map();
const activeAuctions = new Map();
const activeHeists = new Map();
const heistCooldowns = new Map(); // group cooldown

// 🛠 FIX: this was declared INSIDE module.exports (function scope) but
// used by the cleanup timer below, which runs at module load time in
// an entirely different scope. That's a ReferenceError waiting to
// happen the moment heistCooldowns ever had an entry to iterate —
// which is exactly the "HEIST_COOLDOWN is not defined" crash. Now
// it's declared once, here, where both places can actually see it.
const HEIST_COOLDOWN = 60 * 60 * 1000; // 60 minutes

// ================= MAP CLEANUP TIMERS =================
// Prevent unbounded growth — clean every 3 minutes
setInterval(() => {
  const now = Date.now();

  // Clean expired heist cooldowns
  for (const [key, ts] of heistCooldowns) {
    if (now - ts > HEIST_COOLDOWN) heistCooldowns.delete(key);
  }

  // Clean expired auctions (belt + suspenders with setTimeout)
  for (const [key, auction] of activeAuctions) {
    if (auction._expiresAt && now > auction._expiresAt) activeAuctions.delete(key);
  }

  // Clean expired dice games
  for (const [key, game] of activeDiceGames) {
    if (game._expiresAt && now > game._expiresAt) activeDiceGames.delete(key);
  }

  // Clean expired drops (10 min max)
  for (const [key, drop] of activeDrops) {
    if (drop._setAt && now - drop._setAt > 600000) activeDrops.delete(key);
  }

  // 🆕 Clean expired X-and-O challenges (belt + suspenders with setTimeout)
  if (global._tttGames) {
    for (const [key, game] of global._tttGames) {
      if (game._expiresAt && now > game._expiresAt && !game.accepted) global._tttGames.delete(key);
    }
  }
}, 180000);

// Generic "N per day per group" limiter used by card drops AND trivia drops
function canFireInGroup(tracker, chat, maxPerDay) {
  const today = getNigeriaDate();

  if (!tracker.has(chat)) {
    tracker.set(chat, { date: today, count: 0 });
  }

  const data = tracker.get(chat);

  if (data.date !== today) {
    data.date = today;
    data.count = 0;
  }

  if (data.count >= maxPerDay) return false;

  data.count += 1;
  return true;
}

function canDropInGroup(chat) {
  return canFireInGroup(groupDropTracker, chat, 3); // 🛠 reduced from 5/day — was firing too often
}

// =====================================================
// 🛠 THE BIG FIX: card drops, trivia, hacker events, and Quick Draw
// used to be checked at the very BOTTOM of the command handler, after
// every "if (command === ...)" block. Almost every command does
// `return reply(...)` before reaching that point — so this code was
// only reachable for the rare command path that didn't explicitly
// return. In practice that meant these events almost never fired,
// no matter how high their % chance was set. Calling this once near
// the TOP of the handler (before any command-specific logic) means
// it actually gets evaluated on every single command, every time.
// =====================================================
async function triggerSpontaneousEvents(sock, chat, isGroup) {
  if (!isGroup) return;
  if (activeHeists.has(chat)) return;
  if (global._activeRaces?.has(chat)) return; // don't clutter chat mid-race
  if (global._pntGames?.has(chat)) return;    // or mid Police & Thief round

  // 🛠 Shared cooldown — stops two different events (e.g. a card drop
  // AND trivia) from firing back-to-back and cluttering chat.
  const lastEvent = spontaneousEventCooldown.get(chat);
  if (lastEvent && Date.now() - lastEvent < SPONTANEOUS_EVENT_GAP) return;

  // 🛠 Only ONE event type is even attempted per call now (picked by
  // a single roll below), instead of checking independently.
  // 🛠 Odds lowered again per feedback — these were still firing too
  // often even after the last round of fixes. Hacker events no longer
  // roll here at all — they run on their own twice-a-day schedule,
  // see maybeTriggerHacker's scheduler further down.
  const roll = Math.random() * 100;

  // 🎴 Card airdrop (~2% of calls)
  if (roll < 2 && !activeDrops.has(chat) && canDropInGroup(chat)) {
    const tiers = [
      { name: "Common", min: 150000, max: 750000 },
      { name: "Rare", min: 700000, max: 1500000 },
      { name: "Epic", min: 2000000, max: 5000000 },
      { name: "Legendary", min: 6000000, max: 12000000 },
      { name: "Mythic", min: 15000000, max: 25000000 }
    ];

    const tierRoll = Math.random() * 100;
    let tierIdx;
    if (tierRoll < 40) tierIdx = 0;
    else if (tierRoll < 70) tierIdx = 1;
    else if (tierRoll < 88) tierIdx = 2;
    else if (tierRoll < 98) tierIdx = 3;
    else tierIdx = 4;

    const tier = tiers[tierIdx];
    const worth = randomInt(tier.min, tier.max);

    let card = null;
    try {
      const apiChar = await fetchRandomCharacter();
      if (apiChar && apiChar.name && apiChar.image) {
        card = { name: apiChar.name, image: apiChar.image, tier: tier.name, worth };
      }
    } catch {}

    if (!card) {
      const staticCard = animeCards[randomInt(0, animeCards.length - 1)];
      card = { ...staticCard, tier: tier.name, worth };
    }

    activeDrops.set(chat, { ...card, _setAt: Date.now() });

    let mentions = [];
    try {
      const metadata = await sock.groupMetadata(chat);
      mentions = metadata.participants.map(p => p.id);
    } catch (e) {
      console.log("Failed to fetch group members for ping.");
    }

    const tierEmoji = { Common: "⚪", Rare: "🔵", Epic: "🟣", Legendary: "🟡", Mythic: "🔴" }[tier.name] || "⚪";

    await sock.sendMessage(chat, {
      image: { url: card.image },
      caption:
`▬▬▬▬▬▬▬▬▬▬▬▬▬▬
*🎴 CARD AIRDROP!*
▬▬▬▬▬▬▬▬▬▬▬▬▬▬

🃏 ${card.name}
${tierEmoji} ${tier.name}
💰 $${formatMoney(card.worth)}

⚡ First to *.claim* wins!

▬▬▬▬▬▬▬▬▬▬▬▬▬▬`,
      mentions
    });

    spontaneousEventCooldown.set(chat, Date.now());
    return;
  }

  // 🧠 Spontaneous trivia (~2% of calls, max 3/day per group)
  if (roll < 4 && !global._triviaActive?.has(chat) && canFireInGroup(triviaDropTracker, chat, 3)) {
    let mentions = [];
    try {
      const metadata = await sock.groupMetadata(chat);
      mentions = metadata.participants.map(p => p.id);
    } catch {}
    const fired = await spawnTrivia(sock, chat, mentions);
    if (fired) {
      spontaneousEventCooldown.set(chat, Date.now());
      return;
    }
  }

  // ⚡ Quick Draw (~2% of calls)
  if (roll < 6) {
    const fired = await maybeTriggerQuickDraw(sock, chat, isGroup);
    if (fired) {
      spontaneousEventCooldown.set(chat, Date.now());
      return;
    }
  }
}


const dropItems = [
  { name: "💎 Rare Gem", worth: 50000, tier: "rare" },
  { name: "🃏 Wild Card", worth: 100000, tier: "rare" },
  { name: "🎟 Lucky Ticket", worth: 20000, tier: "mid" },
  { name: "📦 Mystery Box", worth: 15000, tier: "mid" },
  { name: "🪙 Gold Coin", worth: 5000, tier: "common" },
  { name: "💵 Cash Drop", worth: 10000, tier: "common" }
];

// =====================================================
// 🏢 SHOP ITEMS
// =====================================================
const shopItems = [
  { id: 1, name: "🛒 Kiosk", price: 20000, income: 1500 },
  { id: 2, name: "🚚 Food Truck", price: 50000, income: 3800 },
  { id: 3, name: "🚘 Luxury Sedan", price: 100000, income: 5000 },
  { id: 4, name: "🏠 House", price: 250000, income: 12000 },
  { id: 5, name: "🌃 Nightclub", price: 750000, income: 45000 },
  { id: 6, name: "🏙️ Skyscraper", price: 2000000, income: 150000 },
  { id: 7, name: "🏪 Mini Market", price: 120000, income: 6500 },
  { id: 8, name: "🏦 Bank Branch", price: 500000, income: 30000 },
  { id: 9, name: "🏥 Private Clinic", price: 850000, income: 48000 },
  { id: 10, name: "🏬 Mall", price: 1500000, income: 90000 },
  { id: 11, name: "🎮 Game Studio", price: 2200000, income: 130000 },
  { id: 12, name: "✈️ Airline", price: 5000000, income: 300000 },
  { id: 13, name: "🚢 Shipping Company", price: 7500000, income: 420000 },
  { id: 14, name: "🛰 Tech Startup", price: 10000000, income: 600000 },
  { id: 15, name: "🏝 Resort", price: 15000000, income: 900000 },
  { id: 16, name: "🏎 Race Team", price: 25000000, income: 1500000 },
  { id: 17, name: "🛢 Oil Company", price: 40000000, income: 2500000 },
  { id: 18, name: "🏗 Construction Empire", price: 65000000, income: 4200000 },
  { id: 19, name: "🏰 Castle Estate", price: 100000000, income: 7000000 },
  { id: 20, name: "🌍 Global Conglomerate", price: 250000000, income: 20000000 },
  { id: 21, name: "🧑🏿‍🦲 SLAVES(nigga)", price: 500000000, income: 50000000 },
  { id: 22, name: "📈 S&P 500", price: 1000000000, income: 100000000 },
  { id: 23, name: "#️⃣ BITCOIN MINER", price: 2500000000, income: 250000000 },
  { id: 24, name: "📉 Tesla stock", price: 5000000000, income: 500000000 },
  { id: 25, name: "⛏️ GOLD MINE", price: 50000000000, income: 5000000000 },
];

// 🆕 Ownership caps to stop instant income stacking.
// Without these, buying 20x of a top-tier business in one command
// was the single biggest reason people got rich in minutes.
const MAX_COPIES_PER_ASSET = 3;
const MAX_TOTAL_ASSETS = 20;

// =====================================================
// 🛠 POWER ITEMS SHOP
// =====================================================
const powerItems = [
  { id: 1, name: "🛡 Robbery Shield", price: 200000, key: "shield" },
  { id: 2, name: "🔫 Gun", price: 500000, key: "gun" }
];


// =====================================================
// ⏳ COOLDOWN SYSTEM (FIXED HARD BLOCK)
// =====================================================
function ensureCooldownMap(user) {
  if (!user.cooldowns || !(user.cooldowns instanceof Map)) {
    user.cooldowns = new Map(Object.entries(user.cooldowns || {}));
  }
}

function getRemaining(user, cmd, duration) {
  ensureCooldownMap(user);

  const last = user.cooldowns.get(cmd);
  if (!last) return 0;

  const diff = Date.now() - new Date(last).getTime();
  const remaining = duration - diff;

  if (remaining <= 0) {
    user.cooldowns.delete(cmd);
    return 0;
  }

  return remaining;
}

async function handleCooldown(user, cmd, reply) {
  const duration = config.cooldowns?.[cmd];
  if (!duration) return false;

  const remaining = getRemaining(user, cmd, duration);

  if (remaining > 0) {
    await reply(`⏳ *COOLDOWN ACTIVE*\n\n⏱ Try again in ${formatTime(remaining)}\n💡 Patience builds empires.`);
    return true; // HARD BLOCK
  }

  ensureCooldownMap(user);
  user.cooldowns.set(cmd, new Date());
  await user.save();
  return false;
}

function formatTime(ms) {
  const s = Math.floor(ms / 1000);
  const m = Math.floor(s / 60);
  return m > 0 ? `${m}m ${s % 60}s` : `${s}s`;
}
function getNigeriaDate() {
  const now = new Date();
  const nigeria = new Date(
    now.toLocaleString("en-US", { timeZone: "Africa/Lagos" })
  );

  return nigeria.toISOString().split("T")[0];
}
// =====================================================
// 🎰 DAILY GAMBLE LIMIT (20 PER COMMAND)
// =====================================================
function checkGambleLimit(user, cmd) {
  const today = getNigeriaDate();

  if (!user.gambleStats || !(user.gambleStats instanceof Map)) {
    user.gambleStats = new Map(Object.entries(user.gambleStats || {}));
  }

  let stat = user.gambleStats.get(cmd);

  if (!stat || stat.date !== today) {
    stat = { date: today, count: 0 };
  }

  if (stat.count >= 20) {
    return { blocked: true, remaining: 0 };
  }

  stat.count += 1;
  user.gambleStats.set(cmd, stat);

  // Convert Map to plain object for MongoDB
  user.gambleStats = Object.fromEntries(user.gambleStats);

  return { blocked: false, remaining: 20 - stat.count };
}

// =====================================================
// 🎨 UI COMPONENTS
// =====================================================
function header(title) {
  return `**${title}**`;
}

function footer() {
  return ``;
}

function divider() {
  return ``;
}

function successBox(title, lines) {
  return `▬▬▬▬▬▬▬▬▬▬▬▬▬▬
*✅ ${title}*
▬▬▬▬▬▬▬▬▬▬▬▬▬▬\n${lines}\n
▬▬▬▬▬▬▬▬▬▬▬▬▬▬`;
}

function errorBox(title, lines) {
  return `▬▬▬▬▬▬▬▬▬▬▬▬▬▬
*❌ ${title}*
▬▬▬▬▬▬▬▬▬▬▬▬▬▬\n${lines}\n
▬▬▬▬▬▬▬▬▬▬▬▬▬▬`;
}

function infoBox(title, lines) {
  return `▬▬▬▬▬▬▬▬▬▬▬▬▬▬
*ℹ️ ${title}*
▬▬▬▬▬▬▬▬▬▬▬▬▬▬\n${lines}\n
▬▬▬▬▬▬▬▬▬▬▬▬▬▬`;
}

// =====================================================
// ⭐ XP + LEVEL SYSTEM
// =====================================================

function xpForNextLevel(level) {
  return 100 + (level * 50);
}

function addXP(user, amount) {

  user.xp = (user.xp || 0) + amount;

  let needed = xpForNextLevel(user.level);

  while (user.xp >= needed) {
    user.xp -= needed;
    user.level += 1;
    needed = xpForNextLevel(user.level);
  }
}

function createXPBar(xp, needed) {

  const size = 12;

  if (!needed || needed <= 0) return "[░░░░░░░░░░░░]";

  // Clamp percentage between 0 and 1
  let percentage = xp / needed;
  percentage = Math.max(0, Math.min(1, percentage));

  const progress = Math.floor(percentage * size);
  const empty = size - progress;

  const bar =
    "█".repeat(progress) +
    "░".repeat(empty);

  return `[${bar}]`;
}

// =====================================================
// 👑 NET WORTH TITLES
// =====================================================

function getTitle(net) {

  if (net >= 1000000000000) return "👑 TOP BOY";
  if (net >= 500000000000) return "🦍 Crime Lord";
  if (net >= 200000000000) return "🏦 Tycoon";
  if (net >= 50000000000) return "💼 Mogul";
  if (net >= 10000000000) return "🏢 Business King";
  if (net >= 2000000000) return "🚀 Entrepreneur";
  if (net >= 500000000) return "💰 Millionaire";
  if (net >= 100000000) return "📈 Investor";
  if (net >= 10000000) return "💵 Hustler";

  return "🧍 Rookie";
}

// =====================================================
// 💸 PROGRESSIVE TAX (v2.0)
// Old system: flat 5% tax on anything over $10k. That meant
// someone earning $50M/day paid the exact same tax RATE as
// someone earning $11k/day. Now it scales up with the amount,
// so big earners are actually reined in instead of coasting.
// =====================================================
function calculateTax(grossAmount) {
  if (grossAmount <= 10000) return 0;
  if (grossAmount <= 1000000) return Math.floor(grossAmount * 0.05);   // 5%
  if (grossAmount <= 100000000) return Math.floor(grossAmount * 0.12); // 12%
  return Math.floor(grossAmount * 0.20);                                // 20%
}

// =====================================================
// ⭐ AUTO XP SYSTEM
// =====================================================

const xpRewards = {
  daily: 40,
  beg: 10,
  send: 15,
  buy: 40,
  sell: 20,
  dep: 10,
  wd: 10,
  rob: 30,
  heist: 60,
  join: 40,
  casino: 20,
  slots: 20,
  cf: 20,
  roulette: 20,
  dice: 20,
  auction: 25,
  bid: 15,
  ttt: 25,
  work: 15,
  trade: 20,
  fuse: 30
};
// =====================================================
// 🚀 MAIN MODULE
// =====================================================
module.exports = async (context) => {
  const { command, args, user, sender, reply, sock, chat, msg } = context;
  const isGroup = chat.endsWith("@g.us");
let xpGiven = false;

async function rewardXP() {
  if (xpGiven) return;

  const reward = xpRewards[command];
  if (!reward) return;

  addXP(user, reward);
  xpGiven = true;
}
// =====================================================
// 🧪 TEST COMMAND
// =====================================================
if (command === "test") {
  const start = Date.now();

  await sock.sendMessage(chat, {
    text: "🏓 *Pinging...*"
  }, { quoted: msg });

  const latency = Date.now() - start;
  const ram = (process.memoryUsage().heapUsed / 1024 / 1024).toFixed(1);
  const uptime = process.uptime();
  const hours = Math.floor(uptime / 3600);
  const mins = Math.floor((uptime % 3600) / 60);

  return reply(
`▬▬▬▬▬▬▬▬▬▬▬▬▬▬
*⚡ BOT STATUS*
▬▬▬▬▬▬▬▬▬▬▬▬▬▬
✅ Online & Running

⏱ Latency: ${latency}ms
🧠 RAM: ${ram} MB
⏳ Uptime: ${hours}h ${mins}m
👑 TopBoy Empire v2.0

▬▬▬▬▬▬▬▬▬▬▬▬▬▬`
  );
}

// 🔍 DEBUG — dump JID info for admin detection troubleshooting
if (command === "debug") {
  if (!isGroup) return reply("Group only.");

  const metadata = await sock.groupMetadata(chat);
  const botRawId = sock.user.id;
  const botNorm = normalizeJid(botRawId);

  // Dump all sock.user properties
  const userKeys = Object.keys(sock.user).join(", ");

  // Find bot in participants by phone number
  const botInGroup = metadata.participants.find(p => normalizeJid(p.id) === botNorm);

  // Check if sock.user has lid property
  const botLid = sock.user.lid || "not set";

  let text = `🔍 BOT DEBUG\n\n`;
  text += `sock.user keys: ${userKeys}\n`;
  text += `sock.user.id: ${botRawId}\n`;
  text += `sock.user.lid: ${botLid}\n`;
  text += `sock.user.name: ${sock.user.name || "N/A"}\n`;
  text += `Bot normalized: ${botNorm}\n`;
  text += `Bot in group (phone match): ${botInGroup ? "YES → " + botInGroup.admin : "NO"}\n`;

  // Try lid match
  if (botLid !== "not set") {
    const lidNorm = normalizeJid(botLid);
    const lidMatch = metadata.participants.find(p => normalizeJid(p.id) === lidNorm);
    text += `Bot in group (lid match): ${lidMatch ? "YES → " + lidMatch.admin : "NO"}\n`;
  }

  // Check auth state for lid
  try {
    const { state } = await require("@whiskeysockets/baileys").useMultiFileAuthState("./auth");
    const creds = state.creds;
    text += `\nAuth registered: ${creds.registered}\n`;
    text += `Auth me.id: ${creds.me?.id || "N/A"}\n`;
    text += `Auth me.lid: ${creds.me?.lid || "N/A"}\n`;

    // Try matching auth lid
    if (creds.me?.lid) {
      const authLidNorm = normalizeJid(creds.me.lid);
      const authMatch = metadata.participants.find(p => normalizeJid(p.id) === authLidNorm);
      text += `Bot in group (auth lid): ${authMatch ? "YES → " + authMatch.admin : "NO"}\n`;
    }
  } catch (e) {
    text += `\nAuth state error: ${e.message}\n`;
  }

  text += `\n--- Admins in group ---\n`;
  for (const p of metadata.participants) {
    if (p.admin === "admin" || p.admin === "superadmin") {
      text += `${p.id} → ${p.admin}\n`;
    }
  }

  return reply(text);
}

  try {
// SAFETY DEFAULTS
user.wallet = user.wallet ?? 0;
user.bank = user.bank ?? 0;
user.debt = user.debt ?? 0;
user.assets = user.assets ?? [];
user.collection = user.collection ?? [];

// 🧊 FROZEN CHECK — set via admin .freeze / .unfreeze
if (global._frozenUsers?.has(sender)) {
  return reply(
`*🧊 FROZEN OUT*

An admin has frozen you out of the economy.
Reason: ${global._frozenUsers.get(sender)}

💡 An admin can lift this with *.unfreeze @you*`
  );
}

// 🚔 JAIL CHECK
if (user.jailUntil && user.jailUntil > Date.now()) {
  const remaining = user.jailUntil - Date.now();
  const mins = Math.floor(remaining / 60000);
  const secs = Math.floor((remaining % 60000) / 1000);

  return reply(
`🚔 *BUSTED!*

⏳ Time remaining: ${mins}m ${secs}s
🔒 You're locked up for attempted robbery.

💡 Tip: Someone can bail you out with *.bail @you*`
  );
}
// 💣 HEIST FREEZE (V4)
// =====================================================
// 🚫 GLOBAL HEIST TRANSACTION LOCK (MOVE TO TOP)
// =====================================================

const blockedDuringHeist = [
  "buy","sell","casino","slots","cf","roulette","dice",
  "dep","wd","send","loan","payloan","rob","items","ttt"
];

const session = activeHeists.get(chat);

if (session) {
  const isParticipant =
    session.victim === sender ||
    session.robbers.has(sender) ||
    session.protectors.has(sender);

  if (isParticipant && blockedDuringHeist.includes(command)) {
    return reply("⛔ You cannot perform economy actions during an active heist!");
  }
}

// FIX TOOLS PROPERLY
if (!user.tools) user.tools = {};
user.tools.shield = user.tools.shield ?? 0;
user.tools.gun = user.tools.gun ?? 0;
if (user.loanDue && Date.now() > user.loanDue && user.debt > 0) {
  user.debt = 0;
  user.loanDue = null;
  user.loanAsset = null;
  await user.save();
}

// 🆕 Track which groups the bot has recently seen activity in — used
// by the automatic dog race scheduler below, independent of whether
// this specific command is eligible for spontaneous events.
if (isGroup) {
  if (!global._knownGroups) global._knownGroups = new Map();
  global._lastKnownSock = sock;
  global._knownGroups.set(chat, Date.now());
}

// 🛠 FIXED PLACEMENT + FIXED SCOPE — spontaneous events used to be
// evaluated on EVERY single command (including things like .kill,
// .kiss, .race, .move) which is why starting a race or slapping a
// friend could ALSO spawn a quiz or Quick Draw at the same time.
// Now they only roll on "passive" commands where a random event
// popping up actually makes sense, and a shared cooldown stops two
// different events from stacking back to back.
const PASSIVE_TRIGGER_COMMANDS = new Set([
  "bal", "daily", "beg", "work", "profile", "menu", "help", "shop",
  "buy", "sell", "dep", "wd", "send", "casino", "slots", "cf",
  "roulette", "auction", "bid", "col", "view", "burn", "claim",
  "marry", "divorce", "spouse", "lb", "cd", "about", "give",
  "trade", "fuse", "assets", "items", "tools"
]);

if (PASSIVE_TRIGGER_COMMANDS.has(command)) {
  await triggerSpontaneousEvents(sock, chat, isGroup);
}

    // =====================================================
// 🌆 EMPIRE MENU 2.0 — now split into categories instead of one
// giant wall of text. .menu shows the category list, .menu <name>
// (or the number) opens that category. Way easier to scan on phone.
// =====================================================
const menuCategories = {
  money: {
    label: "💰 MONEY",
    body: ".bal — check balance\n.daily — claim daily reward\n.beg — small free cash\n.work — another way to earn\n.dep / .wd <amt> — bank\n.send <amt> @user — transfer"
  },
  empire: {
    label: "🏢 EMPIRE",
    body: ".shop — browse businesses\n.buy <id> — invest\n.sell <index/all> — cash out\n.assets — your businesses\n.loan / .payloan"
  },
  gambling: {
    label: "🎰 GAMBLING",
    body: ".casino <amt>\n.slots <amt>\n.cf <h/t> <amt> — coin flip\n.roulette <pick> <amt>\n.dice @user <amt>\n\n⚠️ These have a house edge —\nplay for fun, not to get rich."
  },
  games: {
    label: "🎮 MINI GAMES",
    body: ".ttt @user <bet> — X and O\n.move <1-9> — play your X&O turn\n.rps @user <bet> — Rock Paper Scissors\n  (after accept, DM me *ready* to get\n  your private move — I can't DM first!)\n.dogbet <dog#> <bet> — bet on a race\n.pnt — start Police & Thief lobby\n.pntjoin — join an open lobby\n  (DM me *ready* to get your role)\n\n🐕 Dog races auto-run ~every 2 hours\n⚡ Watch chat for Quick Draw —\nrandom word race, free cash."
  },
  cards: {
    label: "🎴 CARDS",
    body: ".claim — grab a dropped card\n.col — your collection\n.view <index> — see a card\n.give <index> @user — gift\n.trade @user <yours> <theirs>\n.fuse <i1> <i2> <i3> — combine 3\nsame-tier cards into 1 stronger one\n.burn <index/all> — cash in"
  },
  market: {
    label: "🏆 MARKET",
    body: ".auction <index> <min> — sell\n.bid <amount> — bid on one"
  },
  warzone: {
    label: "💣 WAR ZONE",
    body: ".rob @user\n.heist @user — team robbery\n.join / .protect — pick a side\n.bail @user — spouse only"
  },
  social: {
    label: "💍 SOCIAL",
    body: ".marry @user / .divorce\n.spouse — relationship status\n.slap .kill .yeet .kiss .fuck"
  },
  other: {
    label: "❓ OTHER",
    body: ".profile — your card\n.qa — trivia\n.cd — cooldowns\n.lb — leaderboard\n.afk <reason> — go AFK\n.about — full manual"
  }
};

if (command === "menu" || command === "help") {

  const catArg = args[0]?.toLowerCase();
  const categoryList = Object.keys(menuCategories);
  const catNumber = parseInt(catArg);
  const resolvedCat = !isNaN(catNumber) ? categoryList[catNumber - 1] : catArg;

  if (resolvedCat && menuCategories[resolvedCat]) {
    const cat = menuCategories[resolvedCat];
    return reply(
`▬▬▬▬▬▬▬▬▬▬▬▬▬▬
*${cat.label}*
▬▬▬▬▬▬▬▬▬▬▬▬▬▬

${cat.body}



Type *.menu* to go back.
▬▬▬▬▬▬▬▬▬▬▬▬▬▬`
    );
  }

  const menuText =
`▬▬▬▬▬▬▬▬▬▬▬▬▬▬
*🌆 TOPBOY EMPIRE 2.0*
▬▬▬▬▬▬▬▬▬▬▬▬▬▬

Pick a category:

${categoryList.map((key, i) => `${i + 1}. ${menuCategories[key].label}`).join("\n")}

Type *.menu <number or name>*
e.g. *.menu 3* or *.menu gambling*

✨ NEW: mini games, hacker
events, Quick Draw — type
*.about* to see what's new.
`;

  // Try sending with image, fallback to text
  try {
    const fs = require("fs");
    if (fs.existsSync("./data/menu.jpg")) {
      return sock.sendMessage(chat, {
        image: fs.readFileSync("./data/menu.jpg"),
        caption: menuText
      }, { quoted: msg });
    }
  } catch {}

  return reply(menuText);
}
// =====================================================
// 📘 ABOUT TOPBOY EMPIRE
// =====================================================
if (command === "about") {
  return reply(
`${header("TOPBOY EMPIRE 2.0")}

✨ WHAT'S NEW IN 2.0 ✨
• 💻 Hacker events — the richest
  player can get targeted, type
  .defend to help stop it
• ❌⭕ X and O — wager a friend
  with .ttt @user <bet>
• ⚡ Quick Draw — free reaction
  game, random in group chat
• 🎯 Fairer gambling odds + a
  smarter tax system
• 🏢 Business ownership caps so
  one person can't buy the
  whole market

▬▬▬▬▬▬▬▬▬▬▬▬

Welcome to TopBoy Empire 👑

This is a WhatsApp economy + anime card game.
You earn money, build businesses, collect rare cards,
rob people (carefully), gamble, and dominate the leaderboard.

▬▬▬▬▬▬▬▬▬▬▬▬
💰 HOW TO MAKE MONEY

1️⃣ .daily
Claim free money every day.
You also earn money from:
• Your businesses
• Bank interest
• (tax kicks in the more you earn — the more
  you make in one go, the higher the % taken)

2️⃣ .beg
Small random money (cooldown applies).

3️⃣ Gambling
.casino  .slots  .cf  .roulette

These all have a house edge now — you CAN win big,
but the house wins more often on average. Play for fun,
not as a get-rich strategy.

▬▬▬▬▬▬▬▬▬▬▬▬
🏢 BUSINESSES (Passive Income)

.shop → see businesses
.buy id → buy one
.sell index → sell one

Each business gives DAILY income.
⚠️ Max 3 of the same business, 20 total —
this stops one person owning the whole market.

▬▬▬▬▬▬▬▬▬▬▬▬
🎴 ANIME CARD SYSTEM

Sometimes a card drops in the group.
First to type .claim gets it.

.col → see your cards
.view index → see card image

Tiers: Common → Rare → Epic → Legendary → Mythic

▬▬▬▬▬▬▬▬▬▬▬▬
🏦 BANK SYSTEM

.dep amount → move money to bank
.wd amount → withdraw

▬▬▬▬▬▬▬▬▬▬▬▬
🥷 ROBBING & HEISTS

.rob @user — 50% chance, risk/reward
.heist @user — team robbery (80s)

▬▬▬▬▬▬▬▬▬▬▬▬
💻 HACKER EVENTS (NEW)

About twice a day, whoever is #1 on the leaderboard
(same net worth ranking as .lb) gets hacked — no
warning, no defending. 95% of the time they lose
exactly half their businesses. The other 5%? Pure
luck, nothing happens. Being #1 makes you the target.

▬▬▬▬▬▬▬▬▬▬▬▬
🎮 MINI GAMES (NEW)

.ttt @user <bet> — Challenge someone to X and O
  (.accept / .reject, then .move <1-9>)

.rps @user <bet> — Rock Paper Scissors
  (.accept / .reject in the group, then DM me
  *ready* — I can't message you first, WhatsApp
  doesn't allow bots to DM unprompted. Once you
  say ready I'll send your private move prompt.
  Nobody can see or copy your pick. Result
  reveals in the group.)

🐕 Dog Race — runs automatically ~every 2 hours,
or an admin can force one with .race. Everyone bets
with .dogbet <dog#> <amount>, then watch it play out!

🚔 Police & Thief — anyone starts one with .pnt,
others join with .pntjoin (3+ players). Once it
starts, DM me *ready* to get your secret role
(Police, Thief, or Civilian) — same rule, I can't
DM you first. Each of the 3 rounds, check your DMs
and pick a location to hide/rob/defend. Results
reveal in the group after each round. Highest score
after 3 rounds wins (ties possible — more than one
winner!).

⚡ Quick Draw — random word drops in chat,
first to type it wins free cash, no bet needed.

▬▬▬▬▬▬▬▬▬▬▬▬
💍 MARRY SYSTEM

.marry @user — costs $50k
.divorce — costs $100k
.spouse — check status

▬▬▬▬▬▬▬▬▬▬▬▬
❓ Q&A

.qa question — ask the group
.qa — see and answer questions

▬▬▬▬▬▬▬▬▬▬▬▬
⚔ FUN COMMANDS

.slap  .kill  .yeet  .kiss  .fuck

▬▬▬▬▬▬▬▬▬▬▬▬
🎯 OBJECTIVE

• Get rich
• Collect rare anime cards
• Build business empire
• Dominate leaderboard
• Flex on everyone

Type .menu to start.`
  );
}

// =====================================================
// 🏆 AUCTION SYSTEM (FIXED)
// =====================================================

if (command === "auction") {

  if (!isGroup)
    return reply("🚫 Group only.");

  if (activeAuctions.has(chat))
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

  activeAuctions.set(chat, {
    seller: sender,
    card,
    minBid: minPrice,
    highestBid: 0,
    highestBidder: null,
    _expiresAt: Date.now() + 60000
  });

  setTimeout(async () => {

    const auction = activeAuctions.get(chat);
    if (!auction) return;

    activeAuctions.delete(chat);

    // ❌ No bids → return card
    if (!auction.highestBidder) {

      const seller = await User.findOne({ userId: auction.seller });
      if (seller) {
        seller.collection.push(auction.card);
        await seller.save();
      }

      return sock.sendMessage(chat, {
        text: "⏳ Auction ended.\nNo bids were placed. Card returned to seller."
      });
    }

    const seller = await User.findOne({ userId: auction.seller });
    const winner = await User.findOne({ userId: auction.highestBidder });

    if (!seller || !winner) return;

    // 💰 TAX: 5% on auction sales
    const taxAmount = Math.floor(auction.highestBid * 0.05);
    const netAmount = auction.highestBid - taxAmount;

    seller.wallet += netAmount;
    winner.collection.push(auction.card);

    await seller.save();
    await winner.save();

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

if (command === "bid") {

  if (!isGroup)
    return reply("🚫 Group-only command.");

  const auction = activeAuctions.get(chat);
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

  // Refund previous bidder
  if (auction.highestBidder) {
    const prevUser = await User.findOne({ userId: auction.highestBidder });
    if (prevUser) {
      prevUser.wallet += auction.highestBid;
      await prevUser.save();
    }
  }

  // Deduct new bidder
  user.wallet -= amount;
  await user.save();

  auction.highestBid = amount;
  auction.highestBidder = sender;

  activeAuctions.set(chat, auction);

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
    // =====================================================
// 👤 PROFILE
// =====================================================
if (command === "profile") {

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

  // 🛠 FIX: guard against undefined pfp — sending {url: undefined} could
  // crash the message send. Only attach an image if we actually have one.
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
    // 🛠 FIX: pfp is a URL STRING when it came from profilePictureUrl(),
    // but a raw BUFFER when it came from the local-file fallback above.
    // { image: { url: pfp } } is only correct for the string case —
    // wrapping a Buffer that way makes Baileys try to treat the raw
    // image bytes as a path/URL, which is exactly what threw
    // "path must be a string... Received <Buffer 89 50 4e 47...>"
    // (that hex is a PNG file signature).
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

// =====================================================
// 💰 BALANCE
// =====================================================
if (command === "bal") {
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
  `▬▬▬▬▬▬▬▬▬▬▬▬▬▬
*💰 @${cleanId(target)}'s BALANCE*
▬▬▬▬▬▬▬▬▬▬▬▬▬▬

💵 Wallet: $${formatMoney(targetUser.wallet)}
🏦 Bank: $${formatMoney(targetUser.bank)}
💳 Debt: $${formatMoney(targetUser.debt)}

💎 Total: $${formatMoney(total)}

▬▬▬▬▬▬▬▬▬▬▬▬▬▬`,
  [target]
);
}
    // =====================================================
    // 🏢 ASSETS
    // =====================================================
    if (command === "assets") {
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

      let text = `▬▬▬▬▬▬▬▬▬▬▬▬▬▬
*🏢 YOUR BUSINESSES*
▬▬▬▬▬▬▬▬▬▬▬▬▬▬\n
▬▬▬▬▬▬▬▬▬▬▬▬▬▬`;

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
// 🎁 COLLECTION
// =====================================================
if (command === "col") {
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
  const newMinPrices = {
    Common: 150000,
    Rare: 700000,
    Epic: 2000000,
    Legendary: 6000000,
    Mythic: 15000000
  };

  let needsSave = false;
  for (const card of user.collection) {
    const minPrice = newMinPrices[card.tier] || 0;
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

  let text = `▬▬▬▬▬▬▬▬▬▬▬▬▬▬
*🎴 YOUR COLLECTION*
▬▬▬▬▬▬▬▬▬▬▬▬▬▬\n
▬▬▬▬▬▬▬▬▬▬▬▬▬▬`;

  user.collection.forEach((item, i) => {
    const tierEmoji = { Common: "⚪", Rare: "🔵", Epic: "🟣", Legendary: "🟡", Mythic: "🔴" }[item.tier] || "⚪";
    text += `\n${i + 1}. ${tierEmoji} ${item.name}\n   ✨ ${item.tier} | 💰 $${formatShort(item.worth)}\n`;
  });

  text += `\n▬▬▬▬▬▬▬▬▬▬▬▬\n`;
  text += `🎴 Total Cards: ${user.collection.length}\n`;
  text += `💎 Total Worth: $${formatShort(totalWorth)}\n`;
  text += ``;

  return reply(text);
}
// =====================================================
// 👁 VIEW CARD (WITH RENDERED CARD IMAGE)
// =====================================================
if (command === "view") {
  const index = parseInt(args[0]) - 1;

  if (!user.collection[index])
    return reply("❌ Invalid card index. Use *.col* to see your cards.");

  const card = user.collection[index];

  if (!card.image || typeof card.image !== "string") {
    return reply("⚠️ Card image missing.");
  }

  const tierEmoji = { Common: "⚪", Rare: "🔵", Epic: "🟣", Legendary: "🟡", Mythic: "🔴" }[card.tier] || "⚪";

  // Try rendering a styled card image
  try {
    const { generateCardImage } = require("../utils/cardRenderer");
    const renderedBuffer = await generateCardImage(card);

    if (renderedBuffer) {
      await sock.sendMessage(chat, {
        image: renderedBuffer,
        caption:
`▬▬▬▬▬▬▬▬▬▬▬▬▬▬
*🎴 CARD DETAILS*
▬▬▬▬▬▬▬▬▬▬▬▬▬▬

🃏 ${card.name}
${tierEmoji} ${card.tier}
💰 $${formatMoney(card.worth)}


▬▬▬▬▬▬▬▬▬▬▬▬▬▬`
      }, { quoted: msg });
      return;
    }
  } catch (err) {
    console.log("Card render failed, using fallback:", err.message);
  }

  // Fallback: original image URL
  await sock.sendMessage(chat, {
    image: { url: card.image },
    caption:
`▬▬▬▬▬▬▬▬▬▬▬▬▬▬
*🎴 CARD DETAILS*
▬▬▬▬▬▬▬▬▬▬▬▬▬▬

🃏 ${card.name}
${tierEmoji} ${card.tier}
💰 $${formatMoney(card.worth)}


▬▬▬▬▬▬▬▬▬▬▬▬▬▬`
  }, { quoted: msg });
}

// =====================================================
// 🔥 BURN CARDS (sell for worth minus 5% tax)
// =====================================================
if (command === "burn") {
  if (!user.collection.length)
    return reply("📭 No cards to burn.");

  if (!args[0])
    return reply("Usage:\n.burn <index>\n.burn all");

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

  const tierEmoji = { Common: "⚪", Rare: "🔵", Epic: "🟣", Legendary: "🟡", Mythic: "🔴" }[card.tier] || "⚪";

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
    // =====================================================
    // 🏆 LEADERBOARD
    // =====================================================
   if (command === "lb") {
 const users = await User.find({}, "userId wallet bank assets debt");

  const sorted = users
    .map(u => ({
      userId: u.userId,
      net: calculateNetWorth(u)
    }))
    .sort((a, b) => b.net - a.net)
    .slice(0, 10);

  const medals = ["👑", "🥈", "🥉", "4️⃣", "5️⃣", "6️⃣", "7️⃣", "8️⃣", "9️⃣", "🔟"];

  let text = `▬▬▬▬▬▬▬▬▬▬▬▬▬▬
*🏆 TOP 10 RICHEST*
▬▬▬▬▬▬▬▬▬▬▬▬▬▬\n
▬▬▬▬▬▬▬▬▬▬▬▬▬▬`;

  sorted.forEach((u, i) => {
    const medal = medals[i] || `${i + 1}.`;
    const name = u.userId.split("@")[0];
    text += `\n${medal} @${name}\n   💎 $${formatShort(u.net)}\n`;
  });

  text += `\n`;

  return reply(text, sorted.map(u => u.userId));
}

    // =====================================================
    // ⏳ COOLDOWNS
    // =====================================================
    if (command === "cd") {
      let text = `▬▬▬▬▬▬▬▬▬▬▬▬▬▬
*⏳ COOLDOWNS*
▬▬▬▬▬▬▬▬▬▬▬▬▬▬\n
▬▬▬▬▬▬▬▬▬▬▬▬▬▬`;
      let active = false;

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
        text = `▬▬▬▬▬▬▬▬▬▬▬▬▬▬
*⏳ COOLDOWNS*
▬▬▬▬▬▬▬▬▬▬▬▬▬▬\n\n✅ All commands ready!\n\n
▬▬▬▬▬▬▬▬▬▬▬▬▬▬`;
      }

      return reply(text);
    }

    // =====================================================
    // 💰 DAILY
    // =====================================================
  if (command === "daily") {
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

  // 💰 TAX: now progressive — see calculateTax(). Big earners pay a
  // bigger % instead of everyone paying the same flat 5%.
  const taxAmount = calculateTax(grossTotal);
  const total = grossTotal - taxAmount;

  user.wallet += total;
  user.lastDailyClaim = today;
  user.streak += 1;
  await rewardXP();

  // 💍 MARRIAGE: share 50% of daily earnings with spouse
  let spouseShare = 0;
  if (user.marriage?.spouseId) {
    spouseShare = Math.floor(total * 0.5);
    const spouse = await User.findOne({ userId: user.marriage.spouseId });
    if (spouse) {
      // Deduct spouse share from user's wallet first
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

  
//GIVE?//

if (command === "give") {
  const target = msg.message?.extendedTextMessage?.contextInfo?.mentionedJid?.[0];
  const index = parseInt(args[0]) - 1;

  if (!target || isNaN(index))
    return reply("Usage: .give index @user");

  if (!user.collection[index])
    return reply("Invalid item index.");

  const receiver = await User.findOne({ userId: target });
  if (!receiver)
    return reply("User not registered.");

  const item = user.collection[index];

  user.collection.splice(index, 1);
  receiver.collection = receiver.collection || [];
  receiver.collection.push(item);

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
// 💼 WORK — a second flavor of passive income alongside .daily/.beg
// =====================================================
if (command === "work") {
  if (await handleCooldown(user, "work", reply)) return;

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
  const job = jobs[randomInt(0, jobs.length - 1)];
  const amount = randomInt(1000, 4000);

  user.wallet += amount;
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
// 💤 AFK — mark yourself away with a reason. If someone mentions you
// while you're AFK, the bot lets them know. Clears automatically the
// next time you send a message (handled in index.js).
// =====================================================
if (command === "afk") {
  const reason = args.join(" ").trim() || "No reason given";
  const afkSince = Date.now();

  // 🛠 FIX: was `user.afk = true; await user.save();` — Mongoose's
  // schema layer was silently dropping afk/afkReason/afkSince since
  // they weren't declared fields, so it never actually persisted.
  // Writing through the raw MongoDB driver bypasses that entirely.
  await User.collection.updateOne(
    { userId: sender },
    { $set: { afk: true, afkReason: reason, afkSince } }
  );

  return reply(
`▬▬▬▬▬▬▬▬▬▬▬▬▬▬
*💤 AFK MODE ON*
▬▬▬▬▬▬▬▬▬▬▬▬▬▬

Reason: ${reason}

I'll let people know if they tag you.
Just send any message to come back.

▬▬▬▬▬▬▬▬▬▬▬▬▬▬`
  );
}

// =====================================================
// 🔁 TRADE — swap a card with another player (1-for-1)
// =====================================================
if (!global._tradeProposals) global._tradeProposals = new Map(); // chat -> proposal

if (command === "trade") {
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

if (command === "tradeaccept") {
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

if (command === "tradereject") {
  const t = global._tradeProposals.get(chat);
  if (!t) return reply("❌ No pending trade in this chat.");
  if (sender !== t.to) return reply("🚫 Only the trade recipient can reject.");

  global._tradeProposals.delete(chat);
  return reply("❌ Trade rejected.");
}

// =====================================================
// 🔮 FUSE — combine 3 same-tier cards into 1 of the next tier up
// =====================================================
const CARD_TIER_ORDER = ["Common", "Rare", "Epic", "Legendary", "Mythic"];
const CARD_TIER_RANGES = {
  Common: [150000, 750000],
  Rare: [700000, 1500000],
  Epic: [2000000, 5000000],
  Legendary: [6000000, 12000000],
  Mythic: [15000000, 25000000]
};

if (command === "fuse") {
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
    // 🤲 BEG
    // =====================================================
    if (command === "beg") {
      if (await handleCooldown(user, "beg", reply)) return;

      const amount = randomInt(200, 800);
      user.wallet += amount;
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

      return reply(`▬▬▬▬▬▬▬▬▬▬▬▬▬▬
*🤲 BEGGING*
▬▬▬▬▬▬▬▬▬▬▬▬▬▬\n\n${phrase}\n💰 +$${formatMoney(amount)}\n\n
▬▬▬▬▬▬▬▬▬▬▬▬▬▬`);
    }

    // =====================================================
    // 💸 SEND
    // =====================================================
    if (command === "send") {
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
// =====================================================
// 🏦 BANK DEPOSIT
// =====================================================
if (command === "dep") {
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
if (command === "wd") {
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
// 💳 LOAN
// =====================================================
if (command === "loan") {
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
    let text = `▬▬▬▬▬▬▬▬▬▬▬▬▬▬
*💳 AVAILABLE LOANS*
▬▬▬▬▬▬▬▬▬▬▬▬▬▬\n
▬▬▬▬▬▬▬▬▬▬▬▬▬▬`;

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
if (command === "payloan") {
  if (user.debt <= 0)
    return reply("You have no active loan.");

  let amount;

  // If no amount specified → auto pay all
  if (!args[0]) {
    amount = user.debt;
  } else {
    amount = parseInt(args[0]);
    if (isNaN(amount) || amount <= 0)
      return reply("Usage: .payloan [amount]");
  }

  // Can't pay more than debt
  if (amount > user.debt)
    amount = user.debt;

  // Check funds
  if (user.wallet < amount)
    return reply("Not enough wallet funds.");

  user.wallet -= amount;
  user.debt -= amount;

  // If fully cleared → return asset
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
// 🚔 BAIL SYSTEM (SPOUSE ONLY)
// =====================================================
if (command === "bail") {

  const target =
    msg.message?.extendedTextMessage?.contextInfo?.mentionedJid?.[0];

  if (!target)
    return reply("Usage: .bail @user");

  if (target === sender)
    return reply("❌ You cannot bail yourself out.");

  const jailedUser = await User.findOne({ userId: target });

  if (!jailedUser || !jailedUser.jailUntil || jailedUser.jailUntil <= Date.now())
    return reply("❌ That user is not in jail.");

  // 💍 Only spouse can bail
  if (!user.marriage || user.marriage.spouseId !== target)
    return reply("❌ Only your spouse can bail you out! 💍");

  // 💰 Calculate bail
  const totalMoney = (jailedUser.wallet || 0) + (jailedUser.bank || 0);

  let bailCost = Math.floor(totalMoney * 0.10); // 10% of total wealth

  // 💎 Minimum bail 10M
  if (bailCost < 10000000)
    bailCost = 10000000;

  if (user.wallet < bailCost)
    return reply(`❌ You need $${formatMoney(bailCost)} to bail them out.`);

  // Deduct from payer
  user.wallet -= bailCost;

  // Release jailed user
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
// 💣 HEIST SYSTEM V4 (FULL ECONOMY LOCK)
// 80s duration • 30m cooldown • wallet+bank loss
// =====================================================

const HEIST_DURATION = 80000; // 80 seconds
// (HEIST_COOLDOWN is now declared at the top of the file — see the note there)

// Helper → take % from wallet + bank safely
async function takeTotalPercent(u, min, max) {
  const total = (u.wallet || 0) + (u.bank || 0);
  if (total <= 0) return 0;

  const percent = randomInt(min, max) / 100;
  const loss = Math.floor(total * percent);

  let fromWallet = Math.min(u.wallet, loss);
  u.wallet -= fromWallet;

  let remaining = loss - fromWallet;
  if (remaining > 0) {
    u.bank -= Math.min(u.bank, remaining);
  }

  return loss;
}

// =====================================================
// 🚫 GLOBAL TRANSACTION LOCK
// =
// =====================================================
// 🚨 START HEIST
// =====================================================
if (command === "heist") {

  if (!isGroup) return reply("🚫 Group only.");

  if (activeHeists.has(chat))
    return reply("⚠️ A heist is already active.");

  const now = Date.now();

  if (heistCooldowns.has(chat)) {
    const remaining = HEIST_COOLDOWN - (now - heistCooldowns.get(chat));
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

  activeHeists.set(chat, {
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
  // END HEIST
  // ========================================
  setTimeout(async () => {

    const session = activeHeists.get(chat);
    if (!session) return;

    activeHeists.delete(chat);
    heistCooldowns.set(chat, Date.now());

    const robbers = [...session.robbers];
    const protectors = [...session.protectors];
    const victimId = session.victim;

    const robbersWin = Math.random() < 0.5;

    let resultText = "";
    let gainText = "";

    // =====================================
    // 🛡 PROTECTORS WIN
    // =====================================
    if (!robbersWin) {

      let totalCollected = 0;

      for (let id of robbers) {
        const rUser = await User.findOne({ userId: id });
        if (!rUser) continue;

        const loss = await takeTotalPercent(rUser, 20, 50);
        rUser.jailUntil = Date.now() + (20 * 60 * 1000);
        rUser.heistFreeze = false;

        await rUser.save();

        totalCollected += loss;
        resultText += `💀 @${id.split("@")[0]} lost $${formatMoney(loss)}\n`;
      }

      const receivers = protectors.length > 0
        ? protectors
        : [victimId];

      const share = Math.floor(totalCollected / receivers.length);

      for (let id of receivers) {
        const u = await User.findOne({ userId: id });
        if (!u) continue;

        u.wallet += share;
        u.heistFreeze = false;
        await u.save();

        gainText += `💰 @${id.split("@")[0]} gained $${formatMoney(share)}\n`;
      }

      const v = await User.findOne({ userId: victimId });
      if (v) {
        v.heistFreeze = false;
        await v.save();
      }

      return sock.sendMessage(chat, {
        text:
`🛡 *PROTECTORS WON* 🛡

${resultText}
🚔 Robbers jailed for 20 minutes.

${gainText}`,
        mentions: [...robbers, ...receivers]
      });
    }

    // =====================================
    // 💣 ROBBERS WIN
    // =====================================
    let totalLoot = 0;
    const losers = [victimId, ...protectors];

    for (let id of losers) {
      const lUser = await User.findOne({ userId: id });
      if (!lUser) continue;

      const loss = await takeTotalPercent(lUser, 20, 30);
      lUser.heistFreeze = false;

      await lUser.save();

      totalLoot += loss;
      resultText += `💀 @${id.split("@")[0]} lost $${formatMoney(loss)}\n`;
    }

    const share = Math.floor(totalLoot / robbers.length);

    for (let id of robbers) {
      const rUser = await User.findOne({ userId: id });
      if (!rUser) continue;

      rUser.wallet += share;
      rUser.heistFreeze = false;
      await rUser.save();

      gainText += `💰 @${id.split("@")[0]} gained $${formatMoney(share)}\n`;
    }

    return sock.sendMessage(chat, {
      text:
`💣 *ROBBERS WON* 💣

${resultText}

${gainText}`,
      mentions: [...robbers, ...losers]
    });

  }, HEIST_DURATION);
}

// =====================================================
// 🥷 JOIN ROBBERS
// =====================================================
if (command === "join") {
  const session = activeHeists.get(chat);
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
if (command === "protect") {
  const session = activeHeists.get(chat);
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
// 🎬 REACTION COMMAND SYSTEM (OPTIMIZED)
// No axios • No buffering • High quality playback
// =====================================================

const reactionCommands = ["slap", "kill", "yeet", "fuck", "kiss"];

if (reactionCommands.includes(command)) {

  if (!isGroup)
    return reply("🚫 This command works in groups only.");

  // Detect mentioned user
  const target =
    msg.message?.extendedTextMessage?.contextInfo?.mentionedJid?.[0];

  if (!target)
    return reply(`Usage: .${command} @user`);

  if (target === sender)
    return reply("🚫 You can't use this on yourself.");

  // Validate GIF database
  if (!gifs[command] || gifs[command].length === 0)
    return reply("⚠️ No GIFs available for this action.");

  // Pick random GIF
  const randomGif =
    gifs[command][Math.floor(Math.random() * gifs[command].length)];

  // Clean username display
  const senderName = sender.split("@")[0];
  const targetName = target.split("@")[0];

  const captions = {
    slap: `👋 @${senderName} slapped @${targetName}!`,
    kill: `💀 @${senderName} eliminated @${targetName}!`,
    yeet: `🚀 @${senderName} yeeted @${targetName}!`,
    fuck: `🔥 @${senderName} is wildin' with @${targetName}!`,
    kiss: `💋 @${senderName} kissed @${targetName}!`
  };

  try {
    // 🛠 REAL FIX: your GIFs are genuine .gif files, and WhatsApp's
    // gifPlayback expects an actual mp4-encoded video — no mimetype
    // trick fixes that mismatch, the bytes themselves have to be
    // real video. This converts (and caches) an mp4 version.
    const mp4Buffer = await getGifAsMp4(randomGif);

    if (mp4Buffer) {
      await sock.sendMessage(
        chat,
        {
          video: mp4Buffer,
          gifPlayback: true,
          mimetype: "video/mp4",
          caption: captions[command],
          mentions: [sender, target]
        },
        { quoted: msg }
      );
    } else {
      // ffmpeg isn't installed, or conversion failed — send as a
      // plain image instead of a broken "video" so it's at least
      // visible (won't animate, but won't be a blurred placeholder).
      await sock.sendMessage(
        chat,
        {
          image: { url: randomGif },
          caption: captions[command],
          mentions: [sender, target]
        },
        { quoted: msg }
      );
    }
  } catch (err) {
    console.error("GIF send failed:", err.message);
    reply(captions[command], [sender, target]);
  }
}
    // =====================================================
    // 🥷 ROB
    // =====================================================
  // =====================================================
// 🥷 ROB (WITH ITEMS SYSTEM)
// =====================================================
// =====================================================
// 🥷 ROB SYSTEM (POWER ITEMS LOGIC)
// =====================================================
if (command === "rob") {
  if (await handleCooldown(user, "rob", reply)) return;

  const target =
    msg.message?.extendedTextMessage?.contextInfo?.participant ||
    msg.message?.extendedTextMessage?.contextInfo?.mentionedJid?.[0];

  if (!target || target === sender)
    return reply("Tag someone to rob.");

  const victim = await User.findOne({ userId: target });
  if (!victim || victim.wallet <= 0)
    return reply("Victim has no wallet money.");

  // SAFETY FIX
  if (!user.tools) user.tools = {};
  if (!victim.tools) victim.tools = {};

  user.tools.shield = user.tools.shield ?? 0;
  user.tools.gun = user.tools.gun ?? 0;
  victim.tools.shield = victim.tools.shield ?? 0;
  victim.tools.gun = victim.tools.gun ?? 0;

  // =========================================
  // 🔫 GUN vs 🛡 SHIELD
  // Both lose item, no money
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
  // 🔫 GUN vs NO SHIELD
  // 100% WIN
  // Steal 50% - 100%
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
  // 🛡 SHIELD vs NORMAL ROB
  // Robber pays up to 15%
  // Shield consumed
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
  // 🎲 NORMAL ROB (OLD SYSTEM)
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
    // =====================================================
// 🎰 CASINO
// =====================================================
if (command === "casino") {
  const amtCasino = parseInt(args[0]);

  if (isNaN(amtCasino) || amtCasino <= 0)
    return reply("Usage: .casino amount");

  if (user.wallet < amtCasino)
    return reply("Insufficient funds.");

  if (await handleCooldown(user, "casino", reply)) return;

 const limit = checkGambleLimit(user, "casino");
if (limit.blocked)
  return reply("🎰 Daily limit reached (20). Come back tomorrow.");

  // 🛠 REBALANCED: was 55% win chance at x2 payout = +10% EV for the
  // PLAYER every single spin (a guaranteed money-printer). Now it's a
  // real house edge like an actual casino game (~10% edge to the house).
  let win = Math.random() < 0.45;

  // 🤫 secret cheatcode consumption — see handleDMAction
  let usedCheatCasino = false;
  if (global._guaranteedWin?.has(sender)) {
    win = true;
    usedCheatCasino = true;
    global._guaranteedWin.delete(sender);
  }

  if (win) {
    const multiplier = 2;
    const totalReturn = amtCasino * multiplier;
    const profit = totalReturn - amtCasino;

    user.wallet += profit;
    await rewardXP();

    // 💍 Spouse gets 20% of profit
    const spouseCut = await shareGamblingWin(user, profit);
    
    // Deduct spouse commission from winner's profit
    user.wallet -= spouseCut;
    
    await user.save();
await reply("🎰 *Spinning the wheel...*");
await new Promise(r => setTimeout(r, 2000));

    let winText =
`▬▬▬▬▬▬▬▬▬▬▬▬▬▬
*🎰 CASINO*
▬▬▬▬▬▬▬▬▬▬▬▬▬▬

💰 Stake: $${formatMoney(amtCasino)}
🎯 ${limit.remaining} plays left

🎉 *JACKPOT! x${multiplier}*
💵 Won: $${formatMoney(totalReturn)}
📈 Profit: +$${formatMoney(profit)}
▬▬▬▬▬▬▬▬▬▬▬▬▬▬`;

    if (spouseCut > 0) {
      winText += `\n💍 Spouse got: $${formatMoney(spouseCut)}`;
    }

    winText += `\n`;
    return reply(winText);
  } else {
    user.wallet -= amtCasino;
    await user.save();
await reply("🎰 *Spinning the wheel...*");
  await new Promise(r => setTimeout(r, 2000));
    return reply(
`▬▬▬▬▬▬▬▬▬▬▬▬▬▬
*🎰 CASINO*
▬▬▬▬▬▬▬▬▬▬▬▬▬▬

💰 Stake: $${formatMoney(amtCasino)}
🎯 ${limit.remaining} plays left

💀 *You lost it all...*
📉 -$${formatMoney(amtCasino)}

▬▬▬▬▬▬▬▬▬▬▬▬▬▬`
    );
  }
}

// =====================================================
// 🎰 SLOTS V2 (EMOJI CONTROLLED)
// =====================================================
if (command === "slots") {

  const bet = parseInt(args[0]);

  if (isNaN(bet) || bet <= 0)
    return reply("Usage: .slots amount");

  if (user.wallet < bet)
    return reply("Insufficient funds.");

  if (await handleCooldown(user, "slots", reply)) return;

  const limit = checkGambleLimit(user, "slots");
  if (limit.blocked)
    return reply("🎰 Daily limit reached (20). Come back tomorrow.");

  await user.save();

  user.wallet -= bet;

  const emojis = ["🍒","💎","7️⃣","🔔","🍀","👑"];

  let roll = [];
  let multiplier = 0;

  let chance = Math.random();

  // 🤫 secret cheatcode consumption — see handleDMAction. Remaps the
  // roll into the existing 0-31% winning range (jackpot or double)
  // instead of forcing a specific outcome, so it still plays out
  // through the exact same branch logic below and looks organic.
  if (global._guaranteedWin?.has(sender)) {
    chance = Math.random() * 0.31;
    global._guaranteedWin.delete(sender);
  }


  // 🛠 REBALANCED AGAIN per feedback: players felt the win rate was
  // too stingy and missed the x10 jackpot. This version brings x10
  // back with a slightly higher overall win chance (~31% of spins
  // win something) while keeping a modest ~6% house edge instead of
  // the old +46%-per-spin exploit.

  // 🎯 4% TRIPLE → x10
  if (chance < 0.04) {

    const symbol = emojis[randomInt(0, emojis.length - 1)];
    roll = [symbol, symbol, symbol];
    multiplier = 10;

  }

  // 🎯 27% DOUBLE → x2
  else if (chance < 0.31) {

    const symbol = emojis[randomInt(0, emojis.length - 1)];

    let other;
    do {
      other = emojis[randomInt(0, emojis.length - 1)];
    } while (other === symbol);

    // randomize position of mismatch
    const patterns = [
      [symbol, symbol, other],
      [symbol, other, symbol],
      [other, symbol, symbol]
    ];

    roll = patterns[randomInt(0, 2)];
    multiplier = 2;

  }

  // 💀 LOSS (69%)
  else {

    do {
      roll = [
        emojis[randomInt(0, emojis.length - 1)],
        emojis[randomInt(0, emojis.length - 1)],
        emojis[randomInt(0, emojis.length - 1)]
      ];
    } while (
      roll[0] === roll[1] ||
      roll[1] === roll[2] ||
      roll[0] === roll[2]
    );

  }

  let winAmount = 0;
  let spouseCut = 0;

  if (multiplier > 0) {
    winAmount = bet * multiplier;
    user.wallet += winAmount;
    const profit = winAmount - bet;
    spouseCut = await shareGamblingWin(user, profit);
    
    // Deduct spouse commission from winner's winnings
    user.wallet -= spouseCut;
  }
  await rewardXP();
  await user.save();

  await reply("🎰 *Reels spinning...*");
  await new Promise(r => setTimeout(r, 2000));

  let winText = `▬▬▬▬▬▬▬▬▬▬▬▬▬▬
*🎰 SLOT MACHINE*
▬▬▬▬▬▬▬▬▬▬▬▬▬▬\n
▬▬▬▬▬▬▬▬▬▬▬▬▬▬`;
  winText += `\n  [ ${roll.join(" | ")} ]\n\n`;
  winText += `🎯 ${limit.remaining} plays left\n\n`;

  if (multiplier === 10) {
    winText += `🔥 *JACKPOT! x10*\n💵 Won: $${formatMoney(winAmount)}`;
    if (spouseCut > 0) winText += `\n💍 Spouse got: $${formatMoney(spouseCut)}`;
  } else if (multiplier === 2) {
    winText += `✨ *Double Match! x2*\n💵 Won: $${formatMoney(winAmount)}`;
    if (spouseCut > 0) winText += `\n💍 Spouse got: $${formatMoney(spouseCut)}`;
  } else {
    winText += `💀 *No match...*\n📉 Lost: $${formatMoney(bet)}`;
  }

  winText += `\n`;
  return reply(winText);
}
// =====================================================
// 🪙 COIN FLIP
// =====================================================
if (command === "cf") {
  const amtCF = parseInt(args[1]);
  const sideInput = args[0]?.toLowerCase();

  let side;
  if (["h", "heads"].includes(sideInput)) side = "h";
  else if (["t", "tails"].includes(sideInput)) side = "t";

  if (!side || isNaN(amtCF) || amtCF <= 0)
    return reply("Usage: .cf h/t/heads/tails amount");

  if (user.wallet < amtCF)
    return reply("Not enough funds.");

  if (await handleCooldown(user, "cf", reply)) return;

  const limit = checkGambleLimit(user, "cf");
if (limit.blocked)
  return reply("🎰 Daily limit reached (20). Come back tomorrow.");
await user.save();

  // 🛠 NOTE: true 50/50 coin flip is fair (0% house edge) by design —
  // it's the one "safe" gamble in the game. Left as-is on purpose.
  let result = Math.random() > 0.5 ? "h" : "t";

  // 🤫 secret cheatcode consumption — see handleDMAction
  if (global._guaranteedWin?.has(sender)) {
    result = side;
    global._guaranteedWin.delete(sender);
  }

  const win = side === result;

  if (win) {
    const totalShown = amtCF * 2;
    const profit = amtCF;

    user.wallet += profit;
    await rewardXP();
    const spouseCut = await shareGamblingWin(user, profit);
    
    // Deduct spouse commission from winner's winnings
    user.wallet -= spouseCut;
    await user.save();

    let winText =
`▬▬▬▬▬▬▬▬▬▬▬▬▬▬
*🪙 COIN FLIP*
▬▬▬▬▬▬▬▬▬▬▬▬▬▬

🪙 Result: ${result === "h" ? "HEADS" : "TAILS"}
🎯 You picked: ${side === "h" ? "HEADS" : "TAILS"}

🎯 ${limit.remaining} plays left

🎉 *WINNER!*
💰 Won: $${formatMoney(totalShown)}
📈 Profit: +$${formatMoney(profit)}
▬▬▬▬▬▬▬▬▬▬▬▬▬▬`;

    if (spouseCut > 0) winText += `\n💍 Spouse got: $${formatMoney(spouseCut)}`;

    winText += `\n`;
    return reply(winText);
  } else {
    user.wallet -= amtCF;
    await user.save();

    return reply(
`▬▬▬▬▬▬▬▬▬▬▬▬▬▬
*🪙 COIN FLIP*
▬▬▬▬▬▬▬▬▬▬▬▬▬▬

🪙 Result: ${result === "h" ? "HEADS" : "TAILS"}
🎯 You picked: ${side === "h" ? "HEADS" : "TAILS"}

🎯 ${limit.remaining} plays left

💀 *LOST*
📉 -$${formatMoney(amtCF)}

▬▬▬▬▬▬▬▬▬▬▬▬▬▬`
    );
  }
}
// =====================================================
// 🎲 DICE SYSTEM (ECONOMY SAFE)
// =====================================================

// 🎲 START CHALLENGE
if (command === "dice") {
  const target =
    msg.message?.extendedTextMessage?.contextInfo?.participant ||
    msg.message?.extendedTextMessage?.contextInfo?.mentionedJid?.[0];

  const stake = parseInt(args[1] || args[0]);

  if (!target || target === sender)
    return reply("Usage: .dice @user <stake>");

  if (isNaN(stake) || stake <= 0)
    return reply("Enter a valid stake.");

  if (activeDiceGames.has(chat))
    return reply("A dice game is already active in this chat.");

  if (user.wallet < stake)
    return reply("You don't have enough money.");

  const opponent = await User.findOne({ userId: target });
  if (!opponent)
    return reply("User not registered.");

  activeDiceGames.set(chat, {
    player1: sender,
    player2: target,
    stake,
    accepted: false,
    turn: null,
    rolls: {},
    _expiresAt: Date.now() + 60000
  });
setTimeout(() => {
  const game = activeDiceGames.get(chat);

  // Only cancel if still not accepted
  if (game && !game.accepted) {
    activeDiceGames.delete(chat);
    reply("⌛ Dice challenge expired.");
  }
}, 60000);
  return reply(
`▬▬▬▬▬▬▬▬▬▬▬▬▬▬
*🎲 DICE CHALLENGE*
▬▬▬▬▬▬▬▬▬▬▬▬▬▬

⚔️ @${sender.split("@")[0]}
   vs @${target.split("@")[0]}

💰 Stake: $${formatMoney(stake)}
⏳ Expires in 60 seconds

✅ *.accept* to play
❌ *.reject* to decline

▬▬▬▬▬▬▬▬▬▬▬▬▬▬`,
  [sender, target]
  );
}

// =====================================================
// ❌⭕ X AND O — mini game
// =====================================================
if (command === "ttt") {
  const target =
    msg.message?.extendedTextMessage?.contextInfo?.participant ||
    msg.message?.extendedTextMessage?.contextInfo?.mentionedJid?.[0];
  const stake = parseInt(args[1] || args[0]);

  return tttStartChallenge(sender, target, stake, chat, reply);
}

if (command === "move") {
  return tttMove(sender, chat, args[0], reply);
}

// =====================================================
// 🪨📄✂️ ROCK PAPER SCISSORS — mini game (NEW)
// =====================================================
if (command === "rps") {
  const target =
    msg.message?.extendedTextMessage?.contextInfo?.participant ||
    msg.message?.extendedTextMessage?.contextInfo?.mentionedJid?.[0];
  const stake = parseInt(args[1] || args[0]);

  return rpsStartChallenge(sender, target, stake, chat, reply);
}

if (command === "throw") {
  return reply("📩 Check your DMs — your RPS move is submitted there privately, not in the group.");
}

// =====================================================
// 🐕 DOG RACE — admin-started, everyone can bet (NEW)
// =====================================================
if (command === "race") {
  if (!isGroup) return reply("🚫 Group only.");
  return startDogRace(sock, chat, sender, reply);
}

if (command === "dogbet") {
  return placeDogBet(sender, chat, args[0], args[1], reply);
}

// =====================================================
// 🚔 POLICE & THIEF — new lobby game, actions happen via DM
// =====================================================
if (command === "pnt") {
  if (!isGroup) return reply("🚫 Group only.");
  const started = await startPNTLobby(chat, sender, reply);
  if (started) setTimeout(() => finalizePNTLobby(sock, chat), PNT_LOBBY_WINDOW);
  return;
}

if (command === "pntjoin") {
  return joinPNTLobby(chat, sender, reply);
}

// (📝 .defend, .hide, .robplace are used via DM — see handleDMAction below)

// ✅ MARRIAGEACCEPT
if (command === "marriageaccept") {
  let foundProposal = null;
  let proposalKey = null;
  for (const [key, p] of marriageProposals) {
    if (normalizeJid(p.target) === normalizeJid(sender)) {
      foundProposal = p;
      proposalKey = key;

      break;
    }
  }

  if (!foundProposal) return reply("No pending marriage proposal for you.");

  marriageProposals.delete(proposalKey);

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

// ❌ MARRIAGEREJECT
if (command === "marriagereject") {
  let foundProposal = null;
  let proposalKey = null;
  for (const [key, p] of marriageProposals) {
    if (normalizeJid(p.target) === normalizeJid(sender)) {
      foundProposal = p;
      proposalKey = key;
      break;
    }
  }

  if (!foundProposal) return reply("No pending marriage proposal for you.");

  marriageProposals.delete(proposalKey);
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

// ✅ ACCEPT — shared between X-and-O, RPS, and Dice
if (command === "accept") {
  // 🆕 Check X-and-O first
  const tttHandled = await tttAccept(sender, chat, reply);
  if (tttHandled) return;

  // 🆕 Check RPS next
  const rpsHandled = await rpsAccept(sock, sender, chat, reply);
  if (rpsHandled) return;

  const game = activeDiceGames.get(chat);
  if (!game) return reply("No pending challenge to accept.");
  if (sender !== game.player2) return reply("Only the challenged player can accept.");

  const p1 = await User.findOne({ userId: game.player1 });
  const p2 = await User.findOne({ userId: game.player2 });
  if (!p1 || !p2) { activeDiceGames.delete(chat); return reply("Game cancelled."); }
  if (p1.wallet < game.stake || p2.wallet < game.stake) { activeDiceGames.delete(chat); return reply("Game cancelled. Not enough funds."); }

  p1.wallet -= game.stake;
  p2.wallet -= game.stake;
  await p1.save(); await p2.save();
  game.accepted = true;
  game.turn = game.player1;

  return reply(
`▬▬▬▬▬▬▬▬▬▬▬▬▬▬
*🎲 GAME ON*
▬▬▬▬▬▬▬▬▬▬▬▬▬▬

Both players locked $${formatMoney(game.stake)}

🎲 @${game.player1.split("@")[0]}'s turn
Type *.roll*

▬▬▬▬▬▬▬▬▬▬▬▬▬▬`,
    [game.player1]
  );
}

// ❌ REJECT — shared between X-and-O, RPS, and Dice
if (command === "reject") {
  // 🆕 Check X-and-O first
  const tttHandled = await tttReject(sender, chat, reply);
  if (tttHandled) return;

  // 🆕 Check RPS next
  const rpsHandled = await rpsReject(sender, chat, reply);
  if (rpsHandled) return;

  const game = activeDiceGames.get(chat);
  if (!game) return reply("No pending challenge to reject.");
  if (sender !== game.player2) return reply("Only the challenged player can reject.");
  activeDiceGames.delete(chat);
  return reply("❌ Challenge rejected.");
}

// ✅ YES — Vote kick
if (command === "yes") {
  const voteKicks = global._voteKicks;
  if (!voteKicks || !voteKicks.has(chat)) {
    return reply("No active vote to respond to.");
  }

  const session = voteKicks.get(chat);

  // Can't vote on yourself or if you're the initiator
  if (sender === session.target) return reply("🚫 You can't vote on yourself.");
  if (sender === session.initiator) return reply("🚫 The initiator's vote doesn't count.");

  // Already voted?
  if (session.yesVotes.has(sender) || session.noVotes.has(sender)) {
    return reply("⚠️ You already voted.");
  }

  session.yesVotes.add(sender);
  return reply(`✅ Vote recorded! Kick: ${session.yesVotes.size} | Stay: ${session.noVotes.size}`);
}

// ❌ NO — Vote stay
if (command === "no") {
  const voteKicks = global._voteKicks;
  if (!voteKicks || !voteKicks.has(chat)) {
    return reply("No active vote to respond to.");
  }

  const session = voteKicks.get(chat);

  if (sender === session.target) return reply("🚫 You can't vote on yourself.");
  if (sender === session.initiator) return reply("🚫 The initiator's vote doesn't count.");

  if (session.yesVotes.has(sender) || session.noVotes.has(sender)) {
    return reply("⚠️ You already voted.");
  }

  session.noVotes.add(sender);
  return reply(`❌ Vote recorded! Kick: ${session.yesVotes.size} | Stay: ${session.noVotes.size}`);
}

// 🎲 ROLL
if (command === "roll") {
  const game = activeDiceGames.get(chat);
  if (!game || !game.accepted)
    return reply("No active dice game.");

  if (sender !== game.player1 && sender !== game.player2)
    return reply("You are not part of this game.");

  if (sender !== game.turn)
    return reply("It's not your turn.");

  const roll = randomInt(1, 6);
  game.rolls[sender] = roll;

  await reply(`🎲 @${sender.split("@")[0]} rolled ${roll}`, [sender]);

  // Switch turn
  if (sender === game.player1) {
    game.turn = game.player2;
    return reply(
`🎲 @${game.player2.split("@")[0]}'s turn.
Type .roll`,
      [game.player2]
    );
  }

  // Both rolled → decide winner
  const roll1 = game.rolls[game.player1];
  const roll2 = game.rolls[game.player2];

  const p1 = await User.findOne({ userId: game.player1 });
  const p2 = await User.findOne({ userId: game.player2 });

  if (!p1 || !p2) {
    activeDiceGames.delete(chat);
    return reply("Game error. Cancelled.");
  }

  const totalPot = game.stake * 2;

  // 🤝 TIE → REFUND
  if (roll1 === roll2) {
    p1.wallet += game.stake;
    p2.wallet += game.stake;

    await p1.save();
    await p2.save();

    activeDiceGames.delete(chat);

    return reply(
`▬▬▬▬▬▬▬▬▬▬▬▬▬▬
*🎲 FINAL RESULT*
▬▬▬▬▬▬▬▬▬▬▬▬▬▬

@${game.player1.split("@")[0]} rolled ${roll1}
@${game.player2.split("@")[0]} rolled ${roll2}

🤝 *TIE!* Stakes refunded.

▬▬▬▬▬▬▬▬▬▬▬▬▬▬`,
      [game.player1, game.player2]
    );
  }

  const winner = roll1 > roll2 ? p1 : p2;

  winner.wallet += totalPot;
  await winner.save();

  await reply(
`▬▬▬▬▬▬▬▬▬▬▬▬▬▬
*🎲 FINAL RESULT*
▬▬▬▬▬▬▬▬▬▬▬▬▬▬

@${game.player1.split("@")[0]} rolled ${roll1}
@${game.player2.split("@")[0]} rolled ${roll2}

🏆 @${winner.userId.split("@")[0]} won $${formatMoney(totalPot)}!

▬▬▬▬▬▬▬▬▬▬▬▬▬▬`,
    [game.player1, game.player2]
  );

  activeDiceGames.delete(chat);
}
// =====================================================
// 🎡 ROULETTE
// =====================================================
if (command === "roulette") {

  const choiceRaw = args[0]?.toLowerCase();
  const amount = parseInt(args[1]);

  if (!choiceRaw || isNaN(amount) || amount <= 0)
    return reply("Usage: .roulette <red/black/green/even/odd/number> amount");

  if (user.wallet < amount)
    return reply("Not enough funds.");

  if (await handleCooldown(user, "roulette", reply)) return;

  const limit = checkGambleLimit(user, "roulette");
  if (limit.blocked)
    return reply("🎰 Daily limit reached (20). Come back tomorrow.");

  await user.save();

  let number = randomInt(0, 36);

  // 🤫 secret cheatcode consumption — see handleDMAction. Forces the
  // spin to land on a number that matches whatever they bet on,
  // respecting this game's existing number→color mapping (odd=red,
  // even nonzero=black, 0=green) so it flows through the normal
  // win logic below untouched.
  if (global._guaranteedWin?.has(sender)) {
    let forced = null;
    if (!isNaN(parseInt(choiceRaw))) {
      const n = parseInt(choiceRaw);
      if (n >= 0 && n <= 36) forced = n;
    } else if (choiceRaw === "red") forced = 1;
    else if (choiceRaw === "black") forced = 2;
    else if (choiceRaw === "green") forced = 0;
    else if (choiceRaw === "even") forced = 2;
    else if (choiceRaw === "odd") forced = 1;

    if (forced !== null) {
      number = forced;
      global._guaranteedWin.delete(sender);
    }
  }

  const color = number === 0 ? "green" : number % 2 === 0 ? "black" : "red";

  let multiplier = 0;
  let validChoice = true;

  // 🛠 REBALANCED: number/green bets used to pay x50 / x100 on a 1/37
  // chance — that's +35% / +170% EV, an easy exploit once players
  // noticed. Real single-number roulette payout is 35:1, so that's
  // what we use now for both, matching the ~5% house edge on color/
  // even-odd bets below.
  if (!isNaN(parseInt(choiceRaw))) {
    const chosenNumber = parseInt(choiceRaw);
    if (chosenNumber === number) {
      multiplier = 35;
    }
  }

  // 🎨 COLOR
  else if (["red", "black", "green"].includes(choiceRaw)) {
    if (choiceRaw === color) {
      multiplier = color === "green" ? 35 : 2;
    }
  }

  // 🔢 EVEN / ODD
  else if (choiceRaw === "even" || choiceRaw === "odd") {
    if (number !== 0) {
      if (choiceRaw === "even" && number % 2 === 0) multiplier = 2;
      else if (choiceRaw === "odd" && number % 2 === 1) multiplier = 2;
    }
  }

  // ❌ INVALID CHOICE
  else {
    validChoice = false;
  }

  if (!validChoice) {
    return reply("Invalid roulette option.");
  }

  if (multiplier > 0) {
    const totalReturn = amount * multiplier;
    const profit = totalReturn - amount;

    user.wallet += profit;
    const spouseCut = await shareGamblingWin(user, profit);
    
    // Deduct spouse commission from winner's winnings
    user.wallet -= spouseCut;
    await user.save();

    let winText =
`▬▬▬▬▬▬▬▬▬▬▬▬▬▬
*🎡 ROULETTE*
▬▬▬▬▬▬▬▬▬▬▬▬▬▬

🔴⚫ Ball: ${color.toUpperCase()} (${number})
🎯 You picked: ${choiceRaw.toUpperCase()}

🎯 ${limit.remaining} plays left

🎉 *WINNER! x${multiplier}*
💵 Won: $${formatMoney(totalReturn)}
📈 Profit: +$${formatMoney(profit)}
▬▬▬▬▬▬▬▬▬▬▬▬▬▬`;

    if (spouseCut > 0) winText += `\n💍 Spouse got: $${formatMoney(spouseCut)}`;

    winText += `\n`;
    return reply(winText);
  } else {
    user.wallet -= amount;
    await user.save();

    return reply(
`▬▬▬▬▬▬▬▬▬▬▬▬▬▬
*🎡 ROULETTE*
▬▬▬▬▬▬▬▬▬▬▬▬▬▬

🔴⚫ Ball: ${color.toUpperCase()} (${number})
🎯 You picked: ${choiceRaw.toUpperCase()}

🎯 ${limit.remaining} plays left

💀 *LOST*
📉 -$${formatMoney(amount)}

▬▬▬▬▬▬▬▬▬▬▬▬▬▬`
    );
  }
}
// =====================================================
// 🛠 POWER ITEMS SHOP
// =====================================================
// =====================================================
// 🛠 POWER ITEMS SHOP
// =====================================================
if (command === "items") {

  // VIEW SHOP
  if (!args[0]) {
    let text = `▬▬▬▬▬▬▬▬▬▬▬▬▬▬
*🛠 POWER ITEMS*
▬▬▬▬▬▬▬▬▬▬▬▬▬▬\n
▬▬▬▬▬▬▬▬▬▬▬▬▬▬`;

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

  // SAFETY ENSURE
  if (!user.tools) user.tools = {};
  user.tools[item.key] = (user.tools[item.key] || 0) + 1;

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
// 🧰 VIEW TOOLS
// =====================================================
if (command === "tools") {
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

    // =====================================================
    // 🏢 SHOP
    // =====================================================
    if (command === "shop") {
      let text = `▬▬▬▬▬▬▬▬▬▬▬▬▬▬
*🏢 BUSINESS MARKET*
▬▬▬▬▬▬▬▬▬▬▬▬▬▬\n
▬▬▬▬▬▬▬▬▬▬▬▬▬▬`;

      shopItems.forEach(i => {
        const roi = ((i.income * 365 / i.price) * 100).toFixed(0);
        text += `\n🏷 ID ${i.id} → ${i.name}\n   💵 $${formatShort(i.price)} | 📈 $${formatShort(i.income)}/day | 📊 ${roi}% ROI\n`;
      });

      text += `\n⚠️ Max ${MAX_COPIES_PER_ASSET} of each, ${MAX_TOTAL_ASSETS} businesses total\n`;
      text += `📝 *.buy <id>* to purchase\n`;
      return reply(text);
    }

    if (command === "buy") {

  const id = parseInt(args[0]);
  const amount = parseInt(args[1]) || 1;

  const item = shopItems.find(x => x.id === id);
  if (!item) return reply("Invalid ID.");

  if (amount <= 0) return reply("Invalid amount.");

  // 🛠 FIX: enforce ownership caps. Previously you could buy an
  // unlimited number of the same top-tier business in one go, which
  // exploded daily passive income instantly. Now capped.
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
// 💰 SELL ASSETS (FULLY FIXED)
// =====================================================
if (command === "sell") {

  if (!user.assets || user.assets.length === 0)
    return reply("📭 You have no assets to sell.");

  if (!args[0])
    return reply("Usage:\n.sell <asset number>\n.sell all");

  // =====================================================
  // 🔥 SELL ALL
  // =====================================================
  if (args[0].toLowerCase() === "all") {

    let totalSell = 0;
    const soldCount = user.assets.length; // 🛠 FIX: capture count BEFORE clearing

    for (let asset of user.assets) {

      // Directly use stored price (SAFER than shopItems lookup)
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

  // =====================================================
  // 🔥 SELL BY INDEX
  // =====================================================
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

  // Credit wallet
  user.wallet += sellPrice;

  // Remove asset
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
// 🎁 CLAIM DROP
// =====================================================
if (command === "claim") {
  const drop = activeDrops.get(chat);
  if (!drop) return reply("No active card drop in this group.");

  // Remove drop immediately
  activeDrops.delete(chat);

  if (!drop.image) return reply("⚠️ This card has no image! Cannot claim.");

  const collectionItem = {
    name: drop.name,
    tier: drop.tier,
    worth: drop.worth,
    image: drop.image
  };

  user.collection = user.collection || [];
  user.collection.push(collectionItem);

  await rewardXP();

  await user.save();

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
// 🎁 Card airdrops now fire from triggerSpontaneousEvents() near the
// top of this handler — see the note there for why this used to
// almost never actually run.
// =====================================================

    // =====================================================
// 💰 TAX ON EARNINGS (progressive — see calculateTax())
// Applied on .daily. Auction/burn keep their own flat 5%.
// =====================================================

// =====================================================
// 💍 MARRIAGE SYSTEM (WITH PROPOSAL ACCEPTANCE)
// =====================================================


if (command === "marry") {
  if (!isGroup) return reply("🚫 Group only.");

  const target =
    msg.message?.extendedTextMessage?.contextInfo?.mentionedJid?.[0];

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

  // Check if proposal already exists
  const proposalKey = `${sender}_${target}`;
  if (marriageProposals.has(proposalKey)) {
    return reply("⏳ Proposal already pending. Waiting for them to *.accept*");
  }

  // Store proposal (no money deducted yet)
  marriageProposals.set(proposalKey, {
    proposer: sender,
    target,
    expiresAt: Date.now() + 60000 // 60 seconds to accept
  });

  // 💍 Random spicy marriage proposals
  const proposalMessages = [
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
  const romanticText = proposalMessages[Math.floor(Math.random() * proposalMessages.length)];

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

if (command === "divorce") {
  if (!user.marriage) return reply("💔 You're not married.");

  const spouseId = user.marriage.spouseId;
  const cost = 50000000; // $50M

  if (user.wallet < cost) {
    return reply(`💔 Divorce costs $${formatMoney(cost)}. Not enough funds.`);
  }

  user.wallet -= cost;

  const spouse = await User.findOne({ userId: spouseId });
  if (spouse) {
    spouse.marriage = null;
    await spouse.save();
  }

  user.marriage = null;
  await user.save();

  return reply(
`▬▬▬▬▬▬▬▬▬▬▬▬▬▬
*💔 DIVORCED*
▬▬▬▬▬▬▬▬▬▬▬▬▬▬

@${sender.split("@")[0]} & @${spouseId.split("@")[0]}
are no longer married.

💰 Divorce cost: $${formatMoney(cost)}

▬▬▬▬▬▬▬▬▬▬▬▬▬▬`,
    [spouseId]
  );
}

if (command === "spouse") {
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
// 🧠⚡ Trivia and Quick Draw fire from triggerSpontaneousEvents()
// near the top of this handler. Hacker events run on their own
// twice-a-day scheduler (see maybeTriggerHacker's setInterval).
// =====================================================

} catch (err) {
    console.error(err);
    reply("⚠️ Empire system error.");
  }
};

// Properly export activeDrops and trivia functions for admin.js
module.exports.activeDrops = activeDrops;
module.exports.spawnTrivia = spawnTrivia;
module.exports.spawnMultiTrivia = spawnMultiTrivia;
// 🆕 Quick Draw answers arrive as plain (non-prefixed) text, so
// 🆕 Diagnostic — lets admins check GIF/ffmpeg status from inside
// WhatsApp itself (.gifcheck in admin.js), no shell access needed.
async function checkGifSetup() {
  const report = {
    ffmpegAvailable,
    ffmpegResolvedPath,
    cacheSize: global._gifMp4Cache?.size || 0
  };

  if (!ffmpegAvailable) {
    report.testResult = "SKIPPED — ffmpeg not available, see above.";
    return report;
  }

  // Grab any one real GIF URL from the configured gif sets to test with.
  const allGifs = Object.values(gifs).flat().filter(Boolean);
  if (!allGifs.length) {
    report.testResult = "SKIPPED — no GIF URLs found in data/gif.js to test with.";
    return report;
  }

  const testUrl = allGifs[0];
  const start = Date.now();
  try {
    // Bypass the cache for this test so it's a real end-to-end check.
    global._gifMp4Cache.delete(testUrl);
    const buffer = await getGifAsMp4(testUrl);
    const ms = Date.now() - start;
    if (buffer && buffer.length > 0) {
      report.testResult = `✅ SUCCESS — converted ${testUrl} to a ${(buffer.length / 1024).toFixed(1)}KB mp4 in ${ms}ms.`;
    } else {
      report.testResult = `❌ FAILED — conversion returned nothing for ${testUrl}. Check console logs for the real error.`;
    }
  } catch (err) {
    report.testResult = `❌ FAILED — ${err.message}`;
  }

  return report;
}

// index.js needs to call this directly from its message handler.
module.exports.checkQuickDraw = checkQuickDraw;
// 🆕 RPS throws and Police & Thief actions (hide/rob/defend) both
// arrive as private DMs — index.js routes them here.
module.exports.handleDMAction = handleDMAction;
// 🆕 GIF/ffmpeg diagnostics for admin.js's .gifcheck command
module.exports.checkGifSetup = checkGifSetup;