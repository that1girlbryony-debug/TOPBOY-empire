/**
 * 🛠 src/commands/economy/gamble.js — Phase 2.5 batch 2
 *
 * Migrated from _economyLegacy.js:
 *   .casino   — 45% win chance at x2 payout (house edge ~10%)
 *   .slots    — emoji slots: 4% x10 jackpot, 27% x2 double, 69% loss
 *   .cf       — coin flip: true 50/50, x2 payout (fair game, 0% edge)
 *   .roulette — single-number x35, color x2/x35, even/odd x2
 *
 * All 4 commands use:
 *   - handleCooldown (per-command cooldown from config.cooldowns)
 *   - checkGambleLimit (20 plays/day per command)
 *   - shareGamblingWin (spouse gets 20% of profit)
 *   - createRewardXP (XP rewards)
 *   - global._guaranteedWin (secret cheatcode — owner-only, undocumented)
 *
 * NOT migrated here (kept in legacy — shared-state games):
 *   .dice — head-to-head challenge (.accept/.reject/.roll), uses activeDiceGames
 */

const User = require("../../models/User");
const { formatMoney, formatShort, randomInt } = require("../../utils/helpers");
const {
  handleCooldown,
  checkGambleLimit,
  createRewardXP,
  shareGamblingWin,
} = require("./_shared");

const GAMBLE_COMMANDS = new Set(["casino", "slots", "cf", "roulette"]);

async function handle(ctx) {
  const { command, args, user, sender, reply, msg } = ctx;

  switch (command) {

    // =====================================================
    // 🎰 CASINO
    // =====================================================
    case "casino": {
      const amtCasino = parseInt(args[0]);

      if (isNaN(amtCasino) || amtCasino <= 0)
        return reply("Usage: .casino amount");

      if (user.wallet < amtCasino)
        return reply("Insufficient funds.");

      if (await handleCooldown(user, "casino", reply)) return true;

      const limit = checkGambleLimit(user, "casino");
      if (limit.blocked)
        return reply("🎰 Daily limit reached (20). Come back tomorrow.");

      let win = Math.random() < 0.45;

      // 🤫 secret cheatcode consumption
      let usedCheatCasino = false;
      if (global._guaranteedWin?.has(sender)) {
        win = true;
        usedCheatCasino = true;
        global._guaranteedWin.delete(sender);
      }

      const rewardXP = createRewardXP({ user, command });

      if (win) {
        const multiplier = 2;
        const totalReturn = amtCasino * multiplier;
        const profit = totalReturn - amtCasino;

        user.wallet += profit;
        await rewardXP();

        const spouseCut = await shareGamblingWin(user, profit);
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
    case "slots": {
      const bet = parseInt(args[0]);

      if (isNaN(bet) || bet <= 0)
        return reply("Usage: .slots amount");

      if (user.wallet < bet)
        return reply("Insufficient funds.");

      if (await handleCooldown(user, "slots", reply)) return true;

      const limit = checkGambleLimit(user, "slots");
      if (limit.blocked)
        return reply("🎰 Daily limit reached (20). Come back tomorrow.");

      await user.save();

      user.wallet -= bet;

      const emojis = ["🍒","💎","7️⃣","🔔","🍀","👑"];

      let roll = [];
      let multiplier = 0;

      let chance = Math.random();

      // 🤫 secret cheatcode consumption
      if (global._guaranteedWin?.has(sender)) {
        chance = Math.random() * 0.31;
        global._guaranteedWin.delete(sender);
      }

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

      const rewardXP = createRewardXP({ user, command });

      if (multiplier > 0) {
        winAmount = bet * multiplier;
        user.wallet += winAmount;
        const profit = winAmount - bet;
        spouseCut = await shareGamblingWin(user, profit);
        user.wallet -= spouseCut;
      }
      await rewardXP();
      await user.save();

      await reply("🎰 *Reels spinning...*");
      await new Promise(r => setTimeout(r, 2000));

      let winText = `▬▬▬▬▬▬▬▬▬▬▬▬▬▬\n*🎰 SLOT MACHINE*\n▬▬▬▬▬▬▬▬▬▬▬▬▬▬\n\n▬▬▬▬▬▬▬▬▬▬▬▬▬▬`;
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
    case "cf": {
      const amtCF = parseInt(args[1]);
      const sideInput = args[0]?.toLowerCase();

      let side;
      if (["h", "heads"].includes(sideInput)) side = "h";
      else if (["t", "tails"].includes(sideInput)) side = "t";

      if (!side || isNaN(amtCF) || amtCF <= 0)
        return reply("Usage: .cf h/t/heads/tails amount");

      if (user.wallet < amtCF)
        return reply("Not enough funds.");

      if (await handleCooldown(user, "cf", reply)) return true;

      const limit = checkGambleLimit(user, "cf");
      if (limit.blocked)
        return reply("🎰 Daily limit reached (20). Come back tomorrow.");
      await user.save();

      let result = Math.random() > 0.5 ? "h" : "t";

      // 🤫 secret cheatcode consumption
      if (global._guaranteedWin?.has(sender)) {
        result = side;
        global._guaranteedWin.delete(sender);
      }

      const win = side === result;
      const rewardXP = createRewardXP({ user, command });

      if (win) {
        const totalShown = amtCF * 2;
        const profit = amtCF;

        user.wallet += profit;
        await rewardXP();
        const spouseCut = await shareGamblingWin(user, profit);
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
    // 🎡 ROULETTE
    // =====================================================
    case "roulette": {
      const choiceRaw = args[0]?.toLowerCase();
      const amount = parseInt(args[1]);

      if (!choiceRaw || isNaN(amount) || amount <= 0)
        return reply("Usage: .roulette <red/black/green/even/odd/number> amount");

      if (user.wallet < amount)
        return reply("Not enough funds.");

      if (await handleCooldown(user, "roulette", reply)) return true;

      const limit = checkGambleLimit(user, "roulette");
      if (limit.blocked)
        return reply("🎰 Daily limit reached (20). Come back tomorrow.");

      await user.save();

      let number = randomInt(0, 36);

      // 🤫 secret cheatcode consumption
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

      if (!isNaN(parseInt(choiceRaw))) {
        const chosenNumber = parseInt(choiceRaw);
        if (chosenNumber === number) {
          multiplier = 35;
        }
      } else if (["red", "black", "green"].includes(choiceRaw)) {
        if (choiceRaw === color) {
          multiplier = color === "green" ? 35 : 2;
        }
      } else if (choiceRaw === "even" || choiceRaw === "odd") {
        if (number !== 0) {
          if (choiceRaw === "even" && number % 2 === 0) multiplier = 2;
          else if (choiceRaw === "odd" && number % 2 === 1) multiplier = 2;
        }
      } else {
        validChoice = false;
      }

      if (!validChoice) {
        return reply("Invalid roulette option.");
      }

      const rewardXP = createRewardXP({ user, command });

      if (multiplier > 0) {
        const totalReturn = amount * multiplier;
        const profit = totalReturn - amount;

        user.wallet += profit;
        const spouseCut = await shareGamblingWin(user, profit);
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

    default:
      return false; // not handled
  }
}

module.exports = {
  handle,
  GAMBLE_COMMANDS,
};
