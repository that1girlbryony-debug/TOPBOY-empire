/**
 * 🎨 lib/animator.js — Phase 3.5: Visual Animation Engine
 *
 * Generates animated GIFs / MP4s server-side using node-canvas +
 * gif-encoder-2 + ffmpeg. Sends as WhatsApp video with gifPlayback:true
 * so they animate in-chat.
 *
 * WhatsApp constraints (why we can't use Three.js / browser stuff):
 *   - Messages are text + images + videos + stickers only
 *   - No HTML/CSS/JS/Canvas/WebGL rendering in messages
 *   - BUT: videos with gifPlayback:true animate like GIFs
 *
 * So we render frames server-side → encode as GIF → convert to MP4
 * → send as video. This is the same approach the dog race uses for
 * text-based animation (message editing), but with actual graphics.
 *
 * Available animations:
 *   - animateSlots(reelResult) → spinning slot reels
 *   - animateCasino(win) → spinning roulette wheel
 *   - animateRoulette(number, color) → spinning roulette ball
 *   - animateCardReveal(card) → card reveal effect
 *
 * Fallback: if canvas/gif-encoder/ffmpeg unavailable, returns null
 * and the caller falls back to the old text-based approach.
 */

const fs = require("fs");
const path = require("path");
const os = require("os");

// ── Dependency detection ─────────────────────────────────────
let canvasAvailable = false;
let createCanvas = null;
let GIFEncoder = null;
let ffmpegAvailable = false;

try {
  const canvas = require("canvas");
  createCanvas = canvas.createCanvas;
  canvasAvailable = true;
} catch (e) {
  console.warn("⚠️ [animator] node-canvas not available — visual animations disabled:", e.message);
}

try {
  GIFEncoder = require("gif-encoder-2");
} catch (e) {
  console.warn("⚠️ [animator] gif-encoder-2 not available — visual animations disabled:", e.message);
}

// Use system ffmpeg OR ffmpeg-static
try {
  const ffmpegPath = require("ffmpeg-static");
  if (fs.existsSync(ffmpegPath)) {
    const ffmpeg = require("fluent-ffmpeg");
    ffmpeg.setFfmpegPath(ffmpegPath);
    ffmpegAvailable = true;
  } else {
    throw new Error("ffmpeg-static binary missing");
  }
} catch (e) {
  // Try system ffmpeg
  try {
    const { execSync } = require("child_process");
    execSync("which ffmpeg", { stdio: "pipe" });
    const ffmpeg = require("fluent-ffmpeg");
    ffmpegAvailable = true;
    console.log("✅ [animator] Using system ffmpeg for GIF→MP4 conversion");
  } catch {
    console.warn("⚠️ [animator] ffmpeg not available — visual animations disabled");
  }
}

const isReady = () => canvasAvailable && GIFEncoder && ffmpegAvailable;

// ── Color palette (TOPBOY Empire brand) ───────────────────────
const COLORS = {
  bg: "#0d1117",
  bgLight: "#161b22",
  accent: "#e94560",
  gold: "#f39c12",
  green: "#00d4aa",
  red: "#e74c3c",
  blue: "#3498db",
  purple: "#9b59b6",
  white: "#ffffff",
  gray: "#8b949e",
  darkGray: "#30363d",
};

// ── Helper: encode canvas frames → GIF → MP4 ─────────────────
async function framesToMp4(frames, width, height, delayMs = 100) {
  if (!isReady()) return null;
  if (!frames || frames.length === 0) return null;

  const tmpId = `${Date.now()}_${Math.floor(Math.random() * 10000)}`;
  const gifPath = path.join(os.tmpdir(), `${tmpId}.gif`);
  const mp4Path = path.join(os.tmpdir(), `${tmpId}.mp4`);

  try {
    const encoder = new GIFEncoder(width, height);
    encoder.setRepeat(0);
    encoder.setDelay(delayMs);
    encoder.setQuality(10);
    encoder.start();

    for (const frame of frames) {
      encoder.addFrame(frame);
    }

    encoder.finish();
    const gifBuffer = encoder.out.getData();
    fs.writeFileSync(gifPath, gifBuffer);

    const ffmpeg = require("fluent-ffmpeg");
    // 🛠 FIX (Phase 5.2): same fix as getGifAsMp4 — add silent audio track
    // so WhatsApp's gifPlayback player loops the video instead of playing
    // it once. Without audio, many clients render it as a one-shot video.
    await new Promise((resolve, reject) => {
      ffmpeg(gifPath)
        .input("anullsrc=channel_layout=stereo:sample_rate=44100")
        .inputFormat("lavfi")
        .outputOptions([
          "-shortest",
          "-c:v libx264",
          "-preset veryfast",
          "-crf 23",
          "-pix_fmt yuv420p",
          "-vf scale=trunc(iw/2)*2:trunc(ih/2)*2,fps=15",
          "-c:a aac",
          "-b:a 32k",
          "-movflags faststart",
          "-tag:v avc1",
        ])
        .toFormat("mp4")
        .on("error", reject)
        .on("end", resolve)
        .save(mp4Path);
    });

    return fs.readFileSync(mp4Path);
  } catch (err) {
    console.error("[animator] framesToMp4 failed:", err.message);
    return null;
  } finally {
    try { fs.unlinkSync(gifPath); } catch {}
    try { fs.unlinkSync(mp4Path); } catch {}
  }
}

// ── Helper: rounded rect ─────────────────────────────────────
function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r);
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}

// ── Helper: draw background ──────────────────────────────────
function drawBg(ctx, w, h) {
  ctx.fillStyle = COLORS.bg;
  ctx.fillRect(0, 0, w, h);

  // Subtle gradient overlay
  const grad = ctx.createLinearGradient(0, 0, 0, h);
  grad.addColorStop(0, "rgba(233, 69, 96, 0.05)");
  grad.addColorStop(1, "rgba(13, 17, 23, 0)");
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, w, h);
}

// ── Helper: draw title bar ───────────────────────────────────
function drawTitleBar(ctx, w, title, subtitle) {
  ctx.fillStyle = COLORS.accent;
  ctx.fillRect(0, 0, w, 50);

  ctx.fillStyle = COLORS.white;
  ctx.font = "bold 22px sans-serif";
  ctx.textAlign = "center";
  ctx.fillText(title, w / 2, 32);

  if (subtitle) {
    ctx.fillStyle = COLORS.gray;
    ctx.font = "12px sans-serif";
    ctx.fillText(subtitle, w / 2, 46);
  }
}

// ═══════════════════════════════════════════════════════════════
// ANIMATION: SLOTS — spinning reels that slow down and stop
// ═══════════════════════════════════════════════════════════════
async function animateSlots(finalReels, multiplier, bet, winAmount) {
  if (!isReady()) return null;

  const W = 400, H = 250;
  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext("2d");

  const emojis = ["🍒", "💎", "7️⃣", "🔔", "🍀", "👑"];
  const frames = [];
  const totalFrames = 18; // ~1.8 seconds at 100ms/frame

  for (let f = 0; f < totalFrames; f++) {
    drawBg(ctx, W, H);
    drawTitleBar(ctx, W, "🎰 SLOT MACHINE", null);

    // Reel positions — spin fast early, slow down later
    const slowing = f > totalFrames - 6;
    const reelY = slowing
      ? Math.sin(f * 0.5) * 2 // settle wobble
      : (f * 30) % 80;        // spinning

    // Draw 3 reels
    for (let r = 0; r < 3; r++) {
      const rx = 60 + r * 100;
      const ry = 80;

      // Reel frame
      ctx.fillStyle = COLORS.darkGray;
      roundRect(ctx, rx - 5, ry - 5, 90, 90, 8);
      ctx.fill();

      // Reel content
      ctx.save();
      ctx.beginPath();
      roundRect(ctx, rx, ry, 80, 80, 6);
      ctx.clip();

      if (slowing && f >= totalFrames - 3) {
        // Show final result
        ctx.font = "48px sans-serif";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(finalReels[r], rx + 40, ry + 40 + reelY);
      } else {
        // Show random spinning emoji
        const spinEmoji = emojis[Math.floor((f * 7 + r * 13) % emojis.length)];
        ctx.font = "48px sans-serif";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(spinEmoji, rx + 40, ry + 40 + (reelY % 20 - 10));
      }
      ctx.restore();

      // Reel border glow on final
      if (f === totalFrames - 1) {
        ctx.strokeStyle = multiplier > 0 ? COLORS.gold : COLORS.gray;
        ctx.lineWidth = 3;
        roundRect(ctx, rx - 5, ry - 5, 90, 90, 8);
        ctx.stroke();
      }
    }

    // Result text on last 3 frames
    if (f >= totalFrames - 3) {
      ctx.textAlign = "center";
      ctx.textBaseline = "alphabetic";
      if (multiplier === 10) {
        ctx.fillStyle = COLORS.gold;
        ctx.font = "bold 20px sans-serif";
        ctx.fillText(`🔥 JACKPOT x${multiplier}!`, W / 2, 210);
      } else if (multiplier === 2) {
        ctx.fillStyle = COLORS.green;
        ctx.font = "bold 18px sans-serif";
        ctx.fillText(`✨ Double Match x${multiplier}!`, W / 2, 210);
      } else {
        ctx.fillStyle = COLORS.red;
        ctx.font = "bold 18px sans-serif";
        ctx.fillText("💀 No match...", W / 2, 210);
      }
    } else {
      ctx.fillStyle = COLORS.gray;
      ctx.font = "14px sans-serif";
      ctx.textAlign = "center";
      ctx.fillText("Spinning...", W / 2, 210);
    }

    frames.push(ctx);
  }

  return await framesToMp4(frames, W, H, 100);
}

// ═══════════════════════════════════════════════════════════════
// ANIMATION: CASINO — spinning wheel that stops on win/lose
// ═══════════════════════════════════════════════════════════════
async function animateCasino(win, stake, multiplier, profit) {
  if (!isReady()) return null;

  const W = 400, H = 300;
  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext("2d");

  const segments = 12; // wheel segments
  const frames = [];
  const totalFrames = 20;

  for (let f = 0; f < totalFrames; f++) {
    drawBg(ctx, W, H);
    drawTitleBar(ctx, W, "🎰 CASINO", null);

    const cx = W / 2, cy = 160;
    const radius = 80;

    // Rotation — fast early, decelerates
    const progress = f / totalFrames;
    const decel = 1 - Math.pow(progress, 0.3);
    const angle = (f * 0.8 * decel) % (Math.PI * 2);

    // Draw wheel
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(angle);

    for (let s = 0; s < segments; s++) {
      const startAngle = (s / segments) * Math.PI * 2;
      const endAngle = ((s + 1) / segments) * Math.PI * 2;

      ctx.fillStyle = s % 2 === 0 ? COLORS.accent : COLORS.darkGray;
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.arc(0, 0, radius, startAngle, endAngle);
      ctx.closePath();
      ctx.fill();

      ctx.strokeStyle = COLORS.bg;
      ctx.lineWidth = 2;
      ctx.stroke();
    }

    // Center hub
    ctx.fillStyle = COLORS.gold;
    ctx.beginPath();
    ctx.arc(0, 0, 15, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    // Pointer (fixed, points up)
    ctx.fillStyle = COLORS.white;
    ctx.beginPath();
    ctx.moveTo(cx, cy - radius - 10);
    ctx.lineTo(cx - 8, cy - radius + 5);
    ctx.lineTo(cx + 8, cy - radius + 5);
    ctx.closePath();
    ctx.fill();

    // Result text
    ctx.textAlign = "center";
    ctx.textBaseline = "alphabetic";
    if (f >= totalFrames - 4) {
      if (win) {
        ctx.fillStyle = COLORS.green;
        ctx.font = "bold 20px sans-serif";
        ctx.fillText(`🎉 JACKPOT! +$${profit.toLocaleString()}`, W / 2, 280);
      } else {
        ctx.fillStyle = COLORS.red;
        ctx.font = "bold 20px sans-serif";
        ctx.fillText(`💀 Lost $${stake.toLocaleString()}`, W / 2, 280);
      }
    } else {
      ctx.fillStyle = COLORS.gray;
      ctx.font = "14px sans-serif";
      ctx.fillText("Spinning...", W / 2, 280);
    }

    frames.push(ctx);
  }

  return await framesToMp4(frames, W, H, 100);
}

// ═══════════════════════════════════════════════════════════════
// ANIMATION: ROULETTE — ball spinning around wheel
// ═══════════════════════════════════════════════════════════════
async function animateRoulette(finalNumber, finalColor, multiplier, choiceRaw) {
  if (!isReady()) return null;

  const W = 400, H = 300;
  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext("2d");

  const segments = 37; // 0-36
  const frames = [];
  const totalFrames = 22;

  for (let f = 0; f < totalFrames; f++) {
    drawBg(ctx, W, H);
    drawTitleBar(ctx, W, "🎡 ROULETTE", null);

    const cx = W / 2, cy = 160;
    const outerR = 85, innerR = 55;

    const progress = f / totalFrames;
    const decel = 1 - Math.pow(progress, 0.25);
    const wheelAngle = (f * 0.5 * decel) % (Math.PI * 2);
    const ballAngle = wheelAngle * 1.5 + Math.PI; // ball moves opposite-ish

    // Draw wheel segments
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(wheelAngle);

    for (let s = 0; s < segments; s++) {
      const startAngle = (s / segments) * Math.PI * 2;
      const endAngle = ((s + 1) / segments) * Math.PI * 2;
      const num = s;

      let segColor;
      if (num === 0) segColor = COLORS.green;
      else if (num % 2 === 0) segColor = COLORS.darkGray;
      else segColor = COLORS.red;

      ctx.fillStyle = segColor;
      ctx.beginPath();
      ctx.arc(0, 0, outerR, startAngle, endAngle);
      ctx.arc(0, 0, innerR, endAngle, startAngle, true);
      ctx.closePath();
      ctx.fill();
    }

    // Inner circle
    ctx.fillStyle = COLORS.bgLight;
    ctx.beginPath();
    ctx.arc(0, 0, innerR, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    // Ball (fixed position, "lands" on final segment)
    const ballR = outerR - 12;
    const finalBallAngle = (finalNumber / segments) * Math.PI * 2 - Math.PI / 2;
    const currentBallAngle = f < totalFrames - 4
      ? ballAngle
      : finalBallAngle;

    const ballX = cx + Math.cos(currentBallAngle) * ballR;
    const ballY = cy + Math.sin(currentBallAngle) * ballR;
    ctx.fillStyle = COLORS.white;
    ctx.beginPath();
    ctx.arc(ballX, ballY, 6, 0, Math.PI * 2);
    ctx.fill();

    // Result text
    ctx.textAlign = "center";
    ctx.textBaseline = "alphabetic";
    if (f >= totalFrames - 5) {
      ctx.fillStyle = finalColor === "green" ? COLORS.green :
                      finalColor === "red" ? COLORS.red : COLORS.gray;
      ctx.font = "bold 18px sans-serif";
      ctx.fillText(`${finalColor.toUpperCase()} (${finalNumber})`, W / 2, 280);

      if (multiplier > 0) {
        ctx.fillStyle = COLORS.gold;
        ctx.font = "bold 14px sans-serif";
        ctx.fillText(`🎉 x${multiplier} WIN!`, W / 2, 295);
      } else {
        ctx.fillStyle = COLORS.red;
        ctx.font = "12px sans-serif";
        ctx.fillText("💀 Lost", W / 2, 295);
      }
    } else {
      ctx.fillStyle = COLORS.gray;
      ctx.font = "14px sans-serif";
      ctx.fillText("Spinning...", W / 2, 280);
    }

    frames.push(ctx);
  }

  return await framesToMp4(frames, W, H, 100);
}

// ═══════════════════════════════════════════════════════════════
// ANIMATION: COIN FLIP — coin spinning, lands on heads/tails
// ═══════════════════════════════════════════════════════════════
async function animateCoinFlip(result, side, win, amount) {
  if (!isReady()) return null;

  const W = 300, H = 250;
  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext("2d");

  const frames = [];
  const totalFrames = 16;

  for (let f = 0; f < totalFrames; f++) {
    drawBg(ctx, W, H);
    drawTitleBar(ctx, W, "🪙 COIN FLIP", null);

    const cx = W / 2, cy = 130;
    const radius = 50;
    const progress = f / totalFrames;
    const decel = 1 - Math.pow(progress, 0.3);

    // Coin "flip" — scale x to simulate 3D rotation
    const flipAngle = (f * 0.8 * decel) % (Math.PI * 2);
    const scaleX = Math.abs(Math.cos(flipAngle));

    ctx.save();
    ctx.translate(cx, cy);
    ctx.scale(scaleX < 0.1 ? 0.1 : scaleX, 1);

    // Determine which face is showing
    const showHeads = Math.cos(flipAngle) > 0;
    const face = (f >= totalFrames - 3) ? (result === "h" ? "H" : "T") : (showHeads ? "H" : "T");

    // Coin body
    const grad = ctx.createRadialGradient(0, 0, 5, 0, 0, radius);
    grad.addColorStop(0, COLORS.gold);
    grad.addColorStop(1, "#b8860b");
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(0, 0, radius, 0, Math.PI * 2);
    ctx.fill();

    // Coin face
    ctx.fillStyle = COLORS.bg;
    ctx.font = "bold 36px sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(face, 0, 5);

    ctx.restore();

    // Result text
    ctx.textAlign = "center";
    ctx.textBaseline = "alphabetic";
    if (f >= totalFrames - 4) {
      const resultText = result === "h" ? "HEADS" : "TAILS";
      if (win) {
        ctx.fillStyle = COLORS.green;
        ctx.font = "bold 18px sans-serif";
        ctx.fillText(`🎉 ${resultText} — YOU WIN!`, W / 2, 220);
      } else {
        ctx.fillStyle = COLORS.red;
        ctx.font = "bold 18px sans-serif";
        ctx.fillText(`💀 ${resultText} — LOST`, W / 2, 220);
      }
    } else {
      ctx.fillStyle = COLORS.gray;
      ctx.font = "14px sans-serif";
      ctx.fillText("Flipping...", W / 2, 220);
    }

    frames.push(ctx);
  }

  return await framesToMp4(frames, W, H, 100);
}

module.exports = {
  isReady,
  animateSlots,
  animateCasino,
  animateRoulette,
  animateCoinFlip,
  COLORS,
};
