/**
 * 🛠 src/commands/economy/games.js — Phase 2.5 final batch
 *
 * Migrated from _economyLegacy.js:
 *   .ttt       — start Tic-Tac-Toe challenge
 *   .move      — play TTT move
 *   .rps       — start Rock-Paper-Scissors challenge
 *   .throw     — redirect (RPS moves are via DM)
 *   .race      — admin: start dog race
 *   .dogbet    — bet on a dog race
 *   .pnt       — start Police & Thief lobby
 *   .pntjoin   — join PNT lobby
 *   .dice      — start head-to-head dice challenge
 *   .accept    — shared: accept TTT/RPS/Dice challenge
 *   .reject    — shared: reject TTT/RPS/Dice challenge
 *   .roll      — dice game roll
 *   .yes       — votekick: vote yes
 *   .no        — votekick: vote no
 *
 * Game-engine functions are imported from _economyLegacy.js (which
 * now acts as a game-engine library). Future work can progressively
 * move those functions into src/commands/games/ proper.
 *
 * Shared state (via _state.js global._* Maps):
 *   - global._activeDiceGames (activeDiceGames)
 *   - global._voteKicks (votekick sessions)
 */

const User = require("../../models/User");
const { formatMoney, randomInt } = require("../../../utils/helpers");
const legacy = require("../_economyLegacy");
const { handleCooldown, createRewardXP } = require("./_shared");
const animator = require("../../lib/animator");

const GAME_COMMANDS = new Set([
  "ttt", "move", "rps", "throw", "race", "dogbet",
  "pnt", "pntjoin", "dice",
  "accept", "reject", "roll",
  "yes", "no"
]);

async function handle(ctx) {
  const { command, args, user, sender, reply, sock, chat, msg, isGroup } = ctx;

  switch (command) {

    // =====================================================
    // ❌⭕ TTT
    // =====================================================
    case "ttt": {
      const target =
        msg.message?.extendedTextMessage?.contextInfo?.participant ||
        msg.message?.extendedTextMessage?.contextInfo?.mentionedJid?.[0];
      const stake = parseInt(args[1] || args[0]);
      return legacy.tttStartChallenge(sender, target, stake, chat, reply);
    }

    case "move": {
      return legacy.tttMove(sender, chat, args[0], reply);
    }

    // =====================================================
    // 🪨📄✂️ RPS
    // =====================================================
    case "rps": {
      const target =
        msg.message?.extendedTextMessage?.contextInfo?.participant ||
        msg.message?.extendedTextMessage?.contextInfo?.mentionedJid?.[0];
      const stake = parseInt(args[1] || args[0]);
      return legacy.rpsStartChallenge(sender, target, stake, chat, reply);
    }

    case "throw": {
      return reply("📩 Check your DMs — your RPS move is submitted there privately, not in the group.");
    }

    // =====================================================
    // 🐕 DOG RACE
    // =====================================================
    case "race": {
      if (!isGroup) return reply("🚫 Group only.");
      return legacy.startDogRace(sock, chat, sender, reply);
    }

    case "dogbet": {
      return legacy.placeDogBet(sender, chat, args[0], args[1], reply);
    }

    // =====================================================
    // 🚔 POLICE & THIEF
    // =====================================================
    case "pnt": {
      if (!isGroup) return reply("🚫 Group only.");
      const started = await legacy.startPNTLobby(chat, sender, reply);
      if (started) setTimeout(() => legacy.finalizePNTLobby(sock, chat), legacy.PNT_LOBBY_WINDOW);
      return;
    }

    case "pntjoin": {
      return legacy.joinPNTLobby(chat, sender, reply);
    }

    // =====================================================
    // 🎲 DICE CHALLENGE
    // =====================================================
    case "dice": {
      const target =
        msg.message?.extendedTextMessage?.contextInfo?.participant ||
        msg.message?.extendedTextMessage?.contextInfo?.mentionedJid?.[0];
      const stake = parseInt(args[1] || args[0]);

      if (!target || target === sender)
        return reply("Usage: .dice @user <stake>");

      if (isNaN(stake) || stake <= 0)
        return reply("Enter a valid stake.");

      if (legacy.activeDiceGames.has(chat))
        return reply("A dice game is already active in this chat.");

      if (user.wallet < stake)
        return reply("You don't have enough money.");

      const opponent = await User.findOne({ userId: target });
      if (!opponent)
        return reply("User not registered.");

      legacy.activeDiceGames.set(chat, {
        player1: sender,
        player2: target,
        stake,
        accepted: false,
        turn: null,
        rolls: {},
        _expiresAt: Date.now() + 60000
      });

      setTimeout(() => {
        const game = legacy.activeDiceGames.get(chat);
        if (game && !game.accepted) {
          legacy.activeDiceGames.delete(chat);
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
    // ✅ ACCEPT — shared between TTT, RPS, and Dice
    // =====================================================
    case "accept": {
      // Check TTT first
      const tttHandled = await legacy.tttAccept(sender, chat, reply);
      if (tttHandled) return;

      // Check RPS next
      const rpsHandled = await legacy.rpsAccept(sock, sender, chat, reply);
      if (rpsHandled) return;

      // Dice accept
      const game = legacy.activeDiceGames.get(chat);
      if (!game) return reply("No pending challenge to accept.");
      if (sender !== game.player2) return reply("Only the challenged player can accept.");

      const p1 = await User.findOne({ userId: game.player1 });
      const p2 = await User.findOne({ userId: game.player2 });
      if (!p1 || !p2) { legacy.activeDiceGames.delete(chat); return reply("Game cancelled."); }
      if (p1.wallet < game.stake || p2.wallet < game.stake) { legacy.activeDiceGames.delete(chat); return reply("Game cancelled. Not enough funds."); }

      p1.wallet -= game.stake;
      p2.wallet -= game.stake;
      await p1.save(); await p2.save();
      game.accepted = true;
      game.turn = game.player1;

      legacy.scheduleDiceMoveTimeout(chat, sock);

      return reply(
`▬▬▬▬▬▬▬▬▬▬▬▬▬▬
*🎲 GAME ON*
▬▬▬▬▬▬▬▬▬▬▬▬▬▬

Both players locked $${formatMoney(game.stake)}

🎲 @${game.player1.split("@")[0]}'s turn
Type *.roll*
⏱️ ${legacy.DICE_MOVE_TIMEOUT / 1000}s or stakes refund

▬▬▬▬▬▬▬▬▬▬▬▬▬▬`,
        [game.player1]
      );
    }

    // =====================================================
    // ❌ REJECT — shared between TTT, RPS, and Dice
    // =====================================================
    case "reject": {
      const tttHandled = await legacy.tttReject(sender, chat, reply);
      if (tttHandled) return;

      const rpsHandled = await legacy.rpsReject(sender, chat, reply);
      if (rpsHandled) return;

      const game = legacy.activeDiceGames.get(chat);
      if (!game) return reply("No pending challenge to reject.");
      if (sender !== game.player2) return reply("Only the challenged player can reject.");
      legacy.activeDiceGames.delete(chat);
      return reply("❌ Challenge rejected.");
    }

    // =====================================================
    // 🎲 ROLL — dice game
    // =====================================================
    case "roll": {
      const game = legacy.activeDiceGames.get(chat);
      if (!game || !game.accepted)
        return reply("No active dice game.");

      if (sender !== game.player1 && sender !== game.player2)
        return reply("You are not part of this game.");

      if (sender !== game.turn)
        return reply("It's not your turn.");

      const roll = randomInt(1, 6);
      game.rolls[sender] = roll;

      // 🎨 Task 18: 3D dice tumble (cached per value)
      let rollAnim = null;
      try {
        rollAnim = await animator.animateDice(roll);
      } catch (e) { console.log("dice anim failed:", e.message); }
      await animator.sendAnimated(
        sock, chat, rollAnim,
        `🎲 @${sender.split("@")[0]} rolled ${roll}`,
        msg, [sender]
      );

      // Switch turn
      if (sender === game.player1) {
        game.turn = game.player2;
        legacy.scheduleDiceMoveTimeout(chat, sock);
        return reply(
`🎲 @${game.player2.split("@")[0]}'s turn.
Type .roll
⏱️ ${legacy.DICE_MOVE_TIMEOUT / 1000}s or stakes refund`,
          [game.player2]
        );
      }

      // Both rolled → decide winner
      const roll1 = game.rolls[game.player1];
      const roll2 = game.rolls[game.player2];

      const p1 = await User.findOne({ userId: game.player1 });
      const p2 = await User.findOne({ userId: game.player2 });

      if (!p1 || !p2) {
        if (game.moveTimer) clearTimeout(game.moveTimer);
        legacy.activeDiceGames.delete(chat);
        return reply("Game error. Cancelled.");
      }

      const totalPot = game.stake * 2;

      if (game.moveTimer) clearTimeout(game.moveTimer);

      // TIE → REFUND
      if (roll1 === roll2) {
        await User.updateOne(
          { userId: game.player1 },
          { $inc: { wallet: game.stake } }
        ).catch(() => {});
        await User.updateOne(
          { userId: game.player2 },
          { $inc: { wallet: game.stake } }
        ).catch(() => {});

        legacy.activeDiceGames.delete(chat);

        // 🎨 Task 18: dice duel final (cached per pair+outcome)
        let tieAnim = null;
        try {
          tieAnim = await animator.animateDiceDuel(roll1, roll2, "tie");
        } catch (e) { console.log("dice anim failed:", e.message); }

        return animator.sendAnimated(sock, chat, tieAnim,
`▬▬▬▬▬▬▬▬▬▬▬▬▬▬
*🎲 FINAL RESULT*
▬▬▬▬▬▬▬▬▬▬▬▬▬▬

@${game.player1.split("@")[0]} rolled ${roll1}
@${game.player2.split("@")[0]} rolled ${roll2}

🤝 *TIE!* Stakes refunded.

▬▬▬▬▬▬▬▬▬▬▬▬▬▬`,
          msg, [game.player1, game.player2]
        );
      }

      const winner = roll1 > roll2 ? p1 : p2;
      await User.updateOne(
        { userId: winner.userId },
        { $inc: { wallet: totalPot } }
      ).catch(err => console.error("dice winner payout failed:", err.message));

      legacy.activeDiceGames.delete(chat);

      // 🎨 Task 18: dice duel final with winner glow
      const duelOutcome = roll1 === roll2 ? "tie" : roll1 > roll2 ? "p1" : "p2";
      let duelAnim = null;
      try {
        duelAnim = await animator.animateDiceDuel(roll1, roll2, duelOutcome);
      } catch (e) { console.log("dice anim failed:", e.message); }

      return animator.sendAnimated(sock, chat, duelAnim,
`▬▬▬▬▬▬▬▬▬▬▬▬▬▬
*🎲 FINAL RESULT*
▬▬▬▬▬▬▬▬▬▬▬▬▬▬

@${game.player1.split("@")[0]} rolled ${roll1}
@${game.player2.split("@")[0]} rolled ${roll2}

🏆 @${winner.userId.split("@")[0]} won $${formatMoney(totalPot)}!

▬▬▬▬▬▬▬▬▬▬▬▬▬▬`,
        msg, [game.player1, game.player2]
      );
    }

    // =====================================================
    // ✅ YES — Vote kick
    // =====================================================
    case "yes": {
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

      session.yesVotes.add(sender);
      return reply(`✅ Vote recorded! Kick: ${session.yesVotes.size} | Stay: ${session.noVotes.size}`);
    }

    // =====================================================
    // ❌ NO — Vote stay
    // =====================================================
    case "no": {
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

    default:
      return false; // not handled
  }
}

module.exports = {
  handle,
  GAME_COMMANDS,
};
