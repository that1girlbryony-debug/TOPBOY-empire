// =====================================================
// ❌⭕ X AND O (Tic-Tac-Toe) — wagered 1v1 game
// Usage:
//   .ttt @user <stake>   → challenge
//   .accept / .reject    → respond (shared with dice game accept/reject)
//   .move <1-9>          → play a square
//
// Board numbering (like a phone keypad, top to bottom):
//   1 2 3
//   4 5 6
//   7 8 9
// =====================================================
const User = require("../models/User");
const { formatMoney } = require("../utils/helpers");

if (!global._tttGames) global._tttGames = new Map(); // chat -> game

function renderBoard(board) {
  const symbols = { X: "❌", O: "⭕", "": "⬜" };
  let text = "";
  for (let i = 0; i < 9; i += 3) {
    text += `║ ${symbols[board[i]]} ${symbols[board[i + 1]]} ${symbols[board[i + 2]]}\n`;
  }
  return text;
}

function checkWinner(board) {
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

async function startChallenge(sender, target, stake, chat, reply) {
  if (global._tttGames.has(chat))
    return reply("⚠️ A game of X-and-O is already active in this chat.");
  if (!target || target === sender)
    return reply("Usage: .ttt @user <stake>");
  if (isNaN(stake) || stake <= 0)
    return reply("Usage: .ttt @user <stake>");

  const challenger = await User.findOne({ userId: sender });
  const opponent = await User.findOne({ userId: target });
  if (!opponent) return reply("❌ That user isn't registered.");
  if (!challenger || challenger.wallet < stake)
    return reply("❌ You don't have enough wallet funds for that stake.");

  global._tttGames.set(chat, {
    player1: sender,
    player2: target,
    stake,
    accepted: false,
    board: Array(9).fill(""),
    turn: null,
    symbols: {},
    _expiresAt: Date.now() + 60000
  });

  setTimeout(() => {
    const g = global._tttGames.get(chat);
    if (g && !g.accepted) {
      global._tttGames.delete(chat);
      reply("⌛ X-and-O challenge expired.");
    }
  }, 60000);

  return reply(
`╔═══⟪ ❌⭕ X AND O ⟫═══╗
║
║ ⚔️ @${sender.split("@")[0]} vs @${target.split("@")[0]}
║ 💰 Stake: $${formatMoney(stake)}
║
║ ✅ *.accept* to play
║ ❌ *.reject* to decline
╚═══════════════════╝`,
    [sender, target]
  );
}

// Returns true if it handled the accept (so economy.js knows not to
// fall through to the dice-game accept logic)
async function acceptChallenge(sender, chat, reply) {
  const game = global._tttGames.get(chat);
  if (!game) return false;

  if (sender !== game.player2) {
    reply("🚫 Only the challenged player can accept.");
    return true;
  }

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
`╔══⟪ ❌⭕ GAME ON ⟫══╗
║
║ Both locked in $${formatMoney(game.stake)}
║
${renderBoard(game.board)}║
║ 🎯 @${game.player1.split("@")[0]} is ❌ — goes first
║ Type *.move <1-9>*
╚══════════╝`,
    [game.player1, game.player2]
  );
  return true;
}

async function rejectChallenge(sender, chat, reply) {
  const game = global._tttGames.get(chat);
  if (!game) return false;

  if (sender !== game.player2) {
    reply("🚫 Only the challenged player can reject.");
    return true;
  }

  global._tttGames.delete(chat);
  reply("❌ Challenge rejected.");
  return true;
}

async function move(sender, chat, posArg, reply) {
  const game = global._tttGames.get(chat);
  if (!game || !game.accepted) return reply("❌ No active X-and-O game. Start one with .ttt @user <stake>");
  if (sender !== game.player1 && sender !== game.player2) return reply("🚫 You're not in this game.");
  if (sender !== game.turn) return reply("⏳ Not your turn — hang tight.");

  const pos = parseInt(posArg) - 1;
  if (isNaN(pos) || pos < 0 || pos > 8)
    return reply("Usage: .move <1-9>\n1 2 3\n4 5 6\n7 8 9");
  if (game.board[pos])
    return reply("❌ That square is already taken.");

  game.board[pos] = game.symbols[sender];
  const result = checkWinner(game.board);
  const other = sender === game.player1 ? game.player2 : game.player1;

  if (result === "draw") {
    const p1 = await User.findOne({ userId: game.player1 });
    const p2 = await User.findOne({ userId: game.player2 });
    if (p1) { p1.wallet += game.stake; await p1.save(); }
    if (p2) { p2.wallet += game.stake; await p2.save(); }
    global._tttGames.delete(chat);

    return reply(
`╔══⟪ ❌⭕ DRAW ⟫══╗
║
${renderBoard(game.board)}║
║ 🤝 It's a tie! Stakes refunded.
╚══════════╝`,
      [game.player1, game.player2]
    );
  }

  if (result) {
    const winner = await User.findOne({ userId: sender });
    const pot = game.stake * 2;
    if (winner) { winner.wallet += pot; await winner.save(); }
    global._tttGames.delete(chat);

    return reply(
`╔══⟪ ❌⭕ WINNER! ⟫══╗
║
${renderBoard(game.board)}║
║ 🏆 @${sender.split("@")[0]} wins $${formatMoney(pot)}!
╚══════════╝`,
      [game.player1, game.player2]
    );
  }

  game.turn = other;
  return reply(
`${renderBoard(game.board)}║
║ 🎯 @${other.split("@")[0]}'s turn (${game.symbols[other]})
║ Type *.move <1-9>*`,
    [other]
  );
}

module.exports = { startChallenge, acceptChallenge, rejectChallenge, move };