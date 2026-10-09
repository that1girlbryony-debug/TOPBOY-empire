// =====================================================
// 💻 HACKER EVENT — targets the richest player at random
// Steals 50% of their wallet+bank. Half is burned (economy
// sink so the rich don't just snowball forever), half goes
// to anyone brave enough to type .defend in time.
// =====================================================
const User = require("../models/User");
const { formatMoney, calculateNetWorth, randomInt } = require("../utils/helpers");

if (!global._hackerEvents) global._hackerEvents = new Map();       // chat -> session
if (!global._hackerCooldowns) global._hackerCooldowns = new Map(); // chat -> lastTriggerTs

const HACKER_COOLDOWN = 3 * 60 * 60 * 1000; // 1 hack event per group per 3 hours max
const HACKER_CHANCE = 0.04;                 // 4% roll each time an economy command runs
const HACK_WINDOW = 20000;                  // 20s to defend
const MIN_TARGET_NETWORTH = 5000000;        // don't bother hacking broke players
const DEFENDERS_NEEDED = 2;                 // 2+ defenders fully blocks the hack
const DEFEND_REWARD = 250000;               // reward if hack is fully blocked

async function maybeTriggerHacker(sock, chat, isGroup) {
  if (!isGroup) return false;
  if (global._hackerEvents.has(chat)) return false;

  const last = global._hackerCooldowns.get(chat);
  if (last && Date.now() - last < HACKER_COOLDOWN) return false;

  if (Math.random() > HACKER_CHANCE) return false;

  const users = await User.find({}, "userId wallet bank assets debt banned");
  const eligible = users
    .filter(u => !u.banned)
    .map(u => ({ userId: u.userId, net: calculateNetWorth(u) }))
    .filter(u => u.net >= MIN_TARGET_NETWORTH)
    .sort((a, b) => b.net - a.net);

  if (!eligible.length) return false;

  // Pick randomly from the top 5 richest, so it's not 100% predictable
  const pool = eligible.slice(0, 5);
  const target = pool[randomInt(0, pool.length - 1)];

  global._hackerCooldowns.set(chat, Date.now());
  global._hackerEvents.set(chat, {
    victim: target.userId,
    defenders: new Set(),
    endsAt: Date.now() + HACK_WINDOW
  });

  await sock.sendMessage(chat, {
    text:
`╔═══⟪ 🚨 HACKER ALERT 🚨 ⟫═══╗
║
║ 💻 Someone is hacking
║ @${target.userId.split("@")[0]}'s account!!
║
║ 🛡 Type *.defend* to help stop it
║ 👥 Need ${DEFENDERS_NEEDED}+ defenders in 20 seconds
║
║ (nothing happens if you do nothing)
╚═══════════════════╝`,
    mentions: [target.userId]
  });

  setTimeout(() => resolveHack(sock, chat), HACK_WINDOW);
  return true;
}

async function resolveHack(sock, chat) {
  const session = global._hackerEvents.get(chat);
  if (!session) return;
  global._hackerEvents.delete(chat);

  const victim = await User.findOne({ userId: session.victim });
  if (!victim) return;

  const defenders = [...session.defenders];

  // 🛡 Successfully defended — nobody loses anything, defenders get paid
  if (defenders.length >= DEFENDERS_NEEDED) {
    for (const id of defenders) {
      const d = await User.findOne({ userId: id });
      if (d) {
        d.wallet += DEFEND_REWARD;
        await d.save();
      }
    }

    return sock.sendMessage(chat, {
      text:
`╔══⟪ 🛡 HACK BLOCKED! ⟫══╗
║
║ ${defenders.map(id => "@" + id.split("@")[0]).join("\n║ ")}
║ saved @${session.victim.split("@")[0]}!
║
║ 💰 Each earned $${formatMoney(DEFEND_REWARD)}
╚══════════╝`,
      mentions: [...defenders, session.victim]
    });
  }

  // 💀 Hack succeeds — steal 50% of wallet + bank
  const totalLiquid = (victim.wallet || 0) + (victim.bank || 0);
  const stolen = Math.floor(totalLiquid * 0.5);

  let fromWallet = Math.min(victim.wallet, stolen);
  victim.wallet -= fromWallet;
  let remaining = stolen - fromWallet;
  if (remaining > 0) victim.bank -= Math.min(victim.bank, remaining);

  await victim.save();

  // Half of what's stolen is gone for good (real economy sink).
  // The other half goes to anyone who at least tried to defend.
  let consolationText = "";
  if (defenders.length > 0) {
    const consolationPool = Math.floor(stolen * 0.5);
    const share = Math.floor(consolationPool / defenders.length);
    for (const id of defenders) {
      const d = await User.findOne({ userId: id });
      if (d) {
        d.wallet += share;
        await d.save();
      }
    }
    consolationText = `\n║ 🎖 Defenders got $${formatMoney(share)} each for trying`;
  }

  return sock.sendMessage(chat, {
    text:
`╔═══⟪ 💀 HACKED! ⟫═══╗
║
║ @${session.victim.split("@")[0]} got hacked!
║ 💸 Lost: $${formatMoney(stolen)}
║${consolationText}
║
║ 🔒 Tip: the richer you are, the
║ bigger a target you become.
╚═══════════════════╝`,
    mentions: [session.victim, ...defenders]
  });
}

async function defend(sender, chat, reply) {
  const session = global._hackerEvents.get(chat);
  if (!session) return reply("❌ No active hack right now.");
  if (Date.now() > session.endsAt) return reply("⏰ Too late, the window already closed.");
  if (sender === session.victim) return reply("🚫 You can't defend your own account (sus 👀).");
  if (session.defenders.has(sender)) return reply("⚠️ You're already defending!");

  session.defenders.add(sender);
  return reply(
    `🛡 @${sender.split("@")[0]} jumped in to help! (${session.defenders.size}/${DEFENDERS_NEEDED} defenders)`,
    [sender]
  );
}

module.exports = { maybeTriggerHacker, defend };