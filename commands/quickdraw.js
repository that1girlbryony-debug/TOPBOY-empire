// =====================================================
// ⚡ QUICK DRAW — dead simple reaction game
// A word drops in chat, first person to type it (exact
// match, case-insensitive, no prefix needed) wins cash.
// No wagering, no risk — just quick fun for everyone.
// =====================================================
const User = require("../models/User");
const { formatMoney, randomInt } = require("../utils/helpers");

if (!global._quickDraw) global._quickDraw = new Map();           // chat -> session
if (!global._quickDrawCooldowns) global._quickDrawCooldowns = new Map(); // chat -> lastTriggerTs

const WORDS = [
  "banana", "rocket", "dragon", "laptop", "pizza",
  "tiger", "galaxy", "wizard", "ninja", "phone",
  "cookie", "shadow", "thunder", "diamond", "coffee"
];

const QD_CHANCE = 0.05;               // 5% roll each time an economy command runs
const QD_COOLDOWN = 20 * 60 * 1000;   // max once per 20 min per group
const QD_WINDOW = 15000;              // 15 seconds to answer
const QD_REWARD = 300000;

async function maybeTriggerQuickDraw(sock, chat, isGroup) {
  if (!isGroup) return false;
  if (global._quickDraw.has(chat)) return false;

  const last = global._quickDrawCooldowns.get(chat);
  if (last && Date.now() - last < QD_COOLDOWN) return false;
  if (Math.random() > QD_CHANCE) return false;

  const word = WORDS[randomInt(0, WORDS.length - 1)];
  global._quickDrawCooldowns.set(chat, Date.now());
  global._quickDraw.set(chat, { word, endsAt: Date.now() + QD_WINDOW, claimed: false });

  await sock.sendMessage(chat, {
    text:
`╔═══⟪ ⚡ QUICK DRAW ⟫═══╗
║
║ First to type:
║ 👉 *${word}*
║
║ 💰 Wins $${formatMoney(QD_REWARD)}
║ ⏰ 15 seconds — GO!
╚═══════════════════╝`
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

// Call this on every plain (non-prefixed) group message.
// Returns true if it was consumed as a Quick Draw answer.
async function checkAnswer(sender, chat, text, sock) {
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

module.exports = { maybeTriggerQuickDraw, checkAnswer };