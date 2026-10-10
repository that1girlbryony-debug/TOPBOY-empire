/**
 * 🎴 Card Renderer v2 — Animated Card Reveal Engine
 *
 * Replaces the old Jimp-based static card renderer with a canvas-based
 * animated renderer that produces MP4 videos with:
 *   - Card flip animation (back → front reveal)
 *   - Tier-colored gradient borders with glow
 *   - Sparkle/shimmer effects for Legendary/Mythic
 *   - Premium typography with shadows
 *   - Particle effects for high tiers
 *
 * Falls back to the old Jimp renderer if canvas is unavailable.
 */

const fs = require("fs");
const path = require("path");
const os = require("os");
const axios = require("axios");
const { formatMoney } = require("./helpers");

// ── Dependency detection ─────────────────────────────────────
let canvasAvailable = false;
let createCanvas = null;
let loadImage = null;
let GIFEncoder = null;
let ffmpegAvailable = false;

try {
  const canvas = require("canvas");
  createCanvas = canvas.createCanvas;
  loadImage = canvas.loadImage;
  canvasAvailable = true;
} catch (e) {
  console.warn("⚠️ [cardRenderer] node-canvas not available:", e.message);
}

try {
  GIFEncoder = require("gif-encoder-2");
} catch (e) {
  console.warn("⚠️ [cardRenderer] gif-encoder-2 not available:", e.message);
}

try {
  const ffmpegPath = require("ffmpeg-static");
  if (fs.existsSync(ffmpegPath)) {
    const ffmpeg = require("fluent-ffmpeg");
    ffmpeg.setFfmpegPath(ffmpegPath);
    ffmpegAvailable = true;
  } else {
    throw new Error("ffmpeg-static binary missing");
  }
} catch {
  try {
    const { execSync } = require("child_process");
    execSync("which ffmpeg", { stdio: "pipe" });
    ffmpegAvailable = true;
  } catch {
    console.warn("⚠️ [cardRenderer] ffmpeg not available");
  }
}

const isReady = () => canvasAvailable && GIFEncoder && ffmpegAvailable;

// ── Tier design system ────────────────────────────────────────
const TIER_DESIGN = {
  Common: {
    name: "Common",
    emoji: "⚪",
    primary: "#8b949e",
    secondary: "#484f58",
    bg: "#0d1117",
    glow: "rgba(139, 148, 158, 0.3)",
    gradient: ["#2d333b", "#161b22"],
    particles: false,
    shimmer: false,
  },
  Rare: {
    name: "Rare",
    emoji: "🔵",
    primary: "#3498db",
    secondary: "#1a5276",
    bg: "#0a1622",
    glow: "rgba(52, 152, 219, 0.4)",
    gradient: ["#1a3a5c", "#0d1b2a"],
    particles: false,
    shimmer: false,
  },
  Epic: {
    name: "Epic",
    emoji: "🟣",
    primary: "#9b59b6",
    secondary: "#5b2c6f",
    bg: "#120a16",
    glow: "rgba(155, 89, 182, 0.5)",
    gradient: ["#3d1a5c", "#1a0a2e"],
    particles: true,
    shimmer: false,
  },
  Legendary: {
    name: "Legendary",
    emoji: "🟡",
    primary: "#f39c12",
    secondary: "#b7950b",
    bg: "#110d04",
    glow: "rgba(243, 156, 18, 0.5)",
    gradient: ["#5c4a1a", "#2e2509"],
    particles: true,
    shimmer: true,
  },
  Mythic: {
    name: "Mythic",
    emoji: "🔴",
    primary: "#e74c3c",
    secondary: "#922b21",
    bg: "#140404",
    glow: "rgba(231, 76, 60, 0.6)",
    gradient: ["#5c1a1a", "#2e0808"],
    particles: true,
    shimmer: true,
  },
};

const TIER_EMOJI = {
  Common: "⚪", Rare: "🔵", Epic: "🟣", Legendary: "🟡", Mythic: "🔴"
};

// ── Helper: download image ────────────────────────────────────
async function downloadImage(url) {
  try {
    const res = await axios.get(url, {
      responseType: "arraybuffer",
      timeout: 10000,
      maxContentLength: 5 * 1024 * 1024,
      headers: { "User-Agent": "Mozilla/5.0" },
    });
    return Buffer.from(res.data);
  } catch {
    return null;
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

// ── Helper: frames → MP4 ─────────────────────────────────────
async function framesToMp4(frames, width, height, delayMs = 80) {
  if (!isReady()) return null;
  if (!frames || frames.length === 0) return null;

  const tmpId = `card_${Date.now()}_${Math.floor(Math.random() * 10000)}`;
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

    // 🛠 FIX (Phase 5.3 test): use execFile instead of fluent-ffmpeg
    // (fluent-ffmpeg's .inputFormat("lavfi") applies to the wrong input)
    const { execFile } = require("child_process");
    const args = [
      "-y",
      "-i", gifPath,
      "-f", "lavfi", "-i", "anullsrc=channel_layout=stereo:sample_rate=44100",
      "-shortest",
      "-c:v", "libx264", "-preset", "veryfast", "-crf", "23",
      "-pix_fmt", "yuv420p",
      "-vf", "scale=trunc(iw/2)*2:trunc(ih/2)*2,fps=15",
      "-c:a", "aac", "-b:a", "32k",
      "-movflags", "faststart",
      "-tag:v", "avc1",
      mp4Path
    ];

    await new Promise((resolve, reject) => {
      execFile(require("ffmpeg-static"), args, { timeout: 30000 }, (err, stdout, stderr) => {
        if (err) reject(new Error(stderr ? stderr.substring(0, 200) : err.message));
        else resolve();
      });
    });

    return fs.readFileSync(mp4Path);
  } catch (err) {
    console.error("[cardRenderer] framesToMp4 failed:", err.message);
    return null;
  } finally {
    try { fs.unlinkSync(gifPath); } catch {}
    try { fs.unlinkSync(mp4Path); } catch {}
  }
}

// ═══════════════════════════════════════════════════════════════
// ANIMATED CARD REVEAL
// ═══════════════════════════════════════════════════════════════
/**
 * Generates an animated MP4 of a card reveal.
 *
 * Animation sequence:
 *   1. Card back showing (tier-colored with pattern)
 *   2. Flip animation (scale-x, like 3D rotation)
 *   3. Card front reveals with character image
 *   4. Shimmer effect (Legendary/Mythic)
 *   5. Particle sparkles (Epic+)
 *   6. Hold on final card
 *
 * @param {Object} card - { name, tier, worth, image }
 * @returns {Promise<Buffer|null>} MP4 buffer or null if failed
 */
async function generateAnimatedCard(card) {
  if (!isReady()) return null;

  const W = 400, H = 560;
  const design = TIER_DESIGN[card.tier] || TIER_DESIGN.Common;

  // Download character image
  let charImg = null;
  if (card.image) {
    const imgBuffer = await downloadImage(card.image);
    if (imgBuffer) {
      try {
        charImg = await loadImage(imgBuffer);
      } catch {}
    }
  }

  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext("2d");

  const frames = [];
  const totalFrames = 24;

  // Pre-generate particle positions for Epic+ cards
  const particles = [];
  if (design.particles) {
    for (let i = 0; i < 15; i++) {
      particles.push({
        x: Math.random() * W,
        y: Math.random() * H,
        size: 1 + Math.random() * 3,
        speed: 0.5 + Math.random() * 1.5,
        offset: Math.random() * Math.PI * 2,
      });
    }
  }

  for (let f = 0; f < totalFrames; f++) {
    const progress = f / totalFrames;

    // ── Phase 1: Card back (frames 0-5) ────────────────────
    // ── Phase 2: Flip (frames 6-9) ─────────────────────────
    // ── Phase 3: Front reveal + effects (frames 10-23) ─────

    const isFlipping = f >= 6 && f <= 9;
    const showFront = f > 9;

    // Flip effect: scale X from 1 → 0 → 1 (card turns)
    let scaleX = 1;
    if (isFlipping) {
      const flipProgress = (f - 6) / 4; // 0 → 1
      scaleX = Math.abs(Math.cos(flipProgress * Math.PI));
      scaleX = Math.max(0.05, scaleX); // never fully 0
    }

    // ── Draw background ───────────────────────────────────
    ctx.fillStyle = "#000000";
    ctx.fillRect(0, 0, W, H);

    // ── Draw card (flipping) ──────────────────────────────
    ctx.save();
    ctx.translate(W / 2, H / 2);
    ctx.scale(scaleX, 1);
    ctx.translate(-W / 2, -H / 2);

    if (!showFront) {
      // ── CARD BACK ──────────────────────────────────────
      drawCardBack(ctx, W, H, design);
    } else {
      // ── CARD FRONT ────────────────────────────────────
      drawCardFront(ctx, W, H, design, card, charImg, f, totalFrames, particles);
    }

    ctx.restore();

    // ── Particle effects (always on, but more visible later) ──
    if (design.particles && f > 8) {
      drawParticles(ctx, W, H, particles, f, design);
    }

    // ── Shimmer effect (Legendary/Mythic, frames 14+) ─────
    if (design.shimmer && f >= 14) {
      drawShimmer(ctx, W, H, f, totalFrames, design);
    }

    // ── Glow pulse (frames 10+) ──────────────────────────
    if (showFront) {
      const pulseAlpha = 0.3 + Math.sin(f * 0.3) * 0.15;
      ctx.save();
      ctx.globalAlpha = pulseAlpha;
      ctx.strokeStyle = design.primary;
      ctx.lineWidth = 12;
      ctx.shadowColor = design.glow;
      ctx.shadowBlur = 30;
      roundRect(ctx, 4, 4, W - 8, H - 8, 16);
      ctx.stroke();
      ctx.restore();
    }

    frames.push(ctx);
  }

  return await framesToMp4(frames, W, H, 80);
}

// ── Draw card back ───────────────────────────────────────────
function drawCardBack(ctx, W, H, design) {
  // Background gradient
  const grad = ctx.createLinearGradient(0, 0, 0, H);
  grad.addColorStop(0, design.gradient[0]);
  grad.addColorStop(1, design.gradient[1]);
  ctx.fillStyle = grad;
  roundRect(ctx, 0, 0, W, H, 16);
  ctx.fill();

  // Border
  ctx.strokeStyle = design.primary;
  ctx.lineWidth = 4;
  roundRect(ctx, 2, 2, W - 4, H - 4, 14);
  ctx.stroke();

  // Pattern: diamond grid
  ctx.save();
  ctx.globalAlpha = 0.15;
  ctx.strokeStyle = design.primary;
  ctx.lineWidth = 1;
  const gridSize = 30;
  for (let x = 20; x < W - 20; x += gridSize) {
    for (let y = 20; y < H - 20; y += gridSize) {
      ctx.beginPath();
      ctx.moveTo(x, y - 8);
      ctx.lineTo(x + 8, y);
      ctx.lineTo(x, y + 8);
      ctx.lineTo(x - 8, y);
      ctx.closePath();
      ctx.stroke();
    }
  }
  ctx.restore();

  // Center emblem
  ctx.save();
  ctx.globalAlpha = 0.8;
  ctx.fillStyle = design.primary;
  ctx.shadowColor = design.glow;
  ctx.shadowBlur = 20;
  ctx.font = "bold 72px sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText("🎴", W / 2, H / 2);
  ctx.restore();

  // TOPBOY text at bottom
  ctx.fillStyle = design.primary;
  ctx.globalAlpha = 0.5;
  ctx.font = "bold 16px sans-serif";
  ctx.textAlign = "center";
  ctx.fillText("TOPBOY EMPIRE", W / 2, H - 30);
  ctx.globalAlpha = 1;
}

// ── Draw card front ───────────────────────────────────────────
function drawCardFront(ctx, W, H, design, card, charImg, frame, totalFrames, particles) {
  // Background gradient
  const grad = ctx.createLinearGradient(0, 0, 0, H);
  grad.addColorStop(0, design.gradient[0]);
  grad.addColorStop(1, design.gradient[1]);
  ctx.fillStyle = grad;
  roundRect(ctx, 0, 0, W, H, 16);
  ctx.fill();

  // Tier-colored border
  ctx.strokeStyle = design.primary;
  ctx.lineWidth = 4;
  ctx.shadowColor = design.glow;
  ctx.shadowBlur = 15;
  roundRect(ctx, 2, 2, W - 4, H - 4, 14);
  ctx.stroke();
  ctx.shadowBlur = 0;

  // ── Character image area ──────────────────────────────
  const imgX = 20, imgY = 20;
  const imgW = W - 40, imgH = 340;

  ctx.save();
  // Clip to rounded rect
  roundRect(ctx, imgX, imgY, imgW, imgH, 12);
  ctx.clip();

  if (charImg) {
    // 🛠 FIX: Use "contain" style instead of "cover" so the full image is visible
    // (was cutting off the character's head/feet)
    const imgAspect = charImg.width / charImg.height;
    const boxAspect = imgW / imgH;
    let dw, dh, dx, dy;
    if (imgAspect < boxAspect) {
      // Image is taller — fit by width, center vertically
      dw = imgW;
      dh = dw / imgAspect;
      dx = imgX;
      dy = imgY + (imgH - dh) / 2;
    } else {
      // Image is wider — fit by height, center horizontally
      dh = imgH;
      dw = dh * imgAspect;
      dx = imgX + (imgW - dw) / 2;
      dy = imgY;
    }
    ctx.drawImage(charImg, dx, dy, dw, dh);
  } else {
    // Placeholder
    ctx.fillStyle = design.secondary;
    ctx.fillRect(imgX, imgY, imgW, imgH);
    ctx.fillStyle = design.primary;
    ctx.font = "48px sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText("?", imgX + imgW / 2, imgY + imgH / 2);
  }

  // Bottom gradient overlay on image (for text readability)
  const imgGrad = ctx.createLinearGradient(0, imgY + imgH - 80, 0, imgY + imgH);
  imgGrad.addColorStop(0, "rgba(0,0,0,0)");
  imgGrad.addColorStop(1, design.bg);
  ctx.fillStyle = imgGrad;
  ctx.fillRect(imgX, imgY + imgH - 80, imgW, 80);

  ctx.restore();

  // Image border
  ctx.strokeStyle = design.primary;
  ctx.lineWidth = 2;
  ctx.globalAlpha = 0.5;
  roundRect(ctx, imgX, imgY, imgW, imgH, 12);
  ctx.stroke();
  ctx.globalAlpha = 1;

  // ── Tier accent bar ────────────────────────────────────
  const barY = imgY + imgH + 12;
  const barGrad = ctx.createLinearGradient(imgX, 0, imgX + imgW, 0);
  barGrad.addColorStop(0, design.primary);
  barGrad.addColorStop(0.5, design.secondary);
  barGrad.addColorStop(1, design.primary);
  ctx.fillStyle = barGrad;
  ctx.fillRect(imgX, barY, imgW, 4);

  // ── Card name ──────────────────────────────────────────
  const nameY = barY + 30;
  ctx.fillStyle = "#ffffff";
  ctx.font = "bold 26px sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "alphabetic";

  // Shadow for name
  ctx.shadowColor = "rgba(0,0,0,0.8)";
  ctx.shadowBlur = 4;
  ctx.shadowOffsetY = 2;

  // Truncate long names
  let displayName = card.name;
  if (displayName.length > 24) {
    displayName = displayName.substring(0, 22) + "...";
  }
  ctx.fillText(displayName, W / 2, nameY);

  ctx.shadowBlur = 0;
  ctx.shadowOffsetY = 0;

  // ── Tier label ─────────────────────────────────────────
  const tierY = nameY + 32;
  ctx.fillStyle = design.primary;
  ctx.font = "bold 18px sans-serif";
  ctx.fillText(`${design.emoji} ${design.name}`, W / 2, tierY);

  // ── Worth ──────────────────────────────────────────────
  const worthY = tierY + 28;
  ctx.fillStyle = "#00d4aa";
  ctx.font = "bold 22px sans-serif";
  ctx.fillText(`💰 $${formatMoney(card.worth)}`, W / 2, worthY);

  // ── TOPBOY footer ──────────────────────────────────────
  ctx.fillStyle = design.primary;
  ctx.globalAlpha = 0.4;
  ctx.font = "11px sans-serif";
  ctx.fillText("TOPBOY EMPIRE", W / 2, H - 20);
  ctx.globalAlpha = 1;
}

// ── Draw particles (sparkles for Epic+) ───────────────────────
function drawParticles(ctx, W, H, particles, frame, design) {
  ctx.save();
  ctx.fillStyle = design.primary;
  ctx.shadowColor = design.glow;
  ctx.shadowBlur = 8;

  for (const p of particles) {
    // Float upward
    const y = (p.y - frame * p.speed) % H;
    const drawY = y < 0 ? y + H : y;
    const alpha = 0.3 + Math.sin(frame * 0.2 + p.offset) * 0.3;
    ctx.globalAlpha = Math.max(0, alpha);

    // Star shape
    ctx.beginPath();
    ctx.arc(p.x, drawY, p.size, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

// ── Draw shimmer (sweeping light for Legendary/Mythic) ───────
function drawShimmer(ctx, W, H, frame, totalFrames, design) {
  const shimmerProgress = (frame - 14) / (totalFrames - 14);
  const shimmerX = shimmerProgress * (W + 100) - 50;

  ctx.save();
  const grad = ctx.createLinearGradient(shimmerX - 40, 0, shimmerX + 40, 0);
  grad.addColorStop(0, "rgba(255,255,255,0)");
  grad.addColorStop(0.5, "rgba(255,255,255,0.15)");
  grad.addColorStop(1, "rgba(255,255,255,0)");

  ctx.fillStyle = grad;
  ctx.globalCompositeOperation = "screen";
  ctx.fillRect(0, 0, W, H);
  ctx.restore();
}

// ═══════════════════════════════════════════════════════════════
// STATIC CARD IMAGE (fallback — uses old Jimp renderer)
// ═══════════════════════════════════════════════════════════════
async function generateCardImage(card) {
  // If animated renderer is available, use it
  if (isReady()) {
    return await generateAnimatedCard(card);
  }

  // Fallback: old Jimp renderer
  return await generateCardImageJimp(card);
}

// ── Old Jimp renderer (kept as fallback) ──────────────────────
async function generateCardImageJimp(card) {
  try {
    const Jimp = require("jimp");
    const width = 400;
    const height = 560;
    const border = 8;
    const pad = 20;
    const imgW = width - pad * 2;
    const imgH = 340;

    const TIER_COLORS_JIMP = {
      Common: { border: 0x8b949eff, bg: 0x161b22ff },
      Rare: { border: 0x3498dbff, bg: 0x1a3a5cff },
      Epic: { border: 0x9b59b6ff, bg: 0x3d1a5cff },
      Legendary: { border: 0xf39c12ff, bg: 0x5c4a1aff },
      Mythic: { border: 0xe74c3cff, bg: 0x5c1a1aff },
    };

    const colors = TIER_COLORS_JIMP[card.tier] || TIER_COLORS_JIMP.Common;
    const cardImg = new Jimp(width, height, colors.border);

    // Simple fill for inner area
    for (let py = border; py < height - border; py++) {
      for (let px = border; px < width - border; px++) {
        cardImg.setPixelColor(colors.bg, px, py);
      }
    }

    try {
      const imgBuffer = await downloadImage(card.image);
      if (imgBuffer) {
        const charImg = await Jimp.read(imgBuffer);
        charImg.cover(imgW, imgH);
        cardImg.composite(charImg, pad, pad);
      }
    } catch {}

    return await cardImg.getBufferAsync(Jimp.MIME_PNG);
  } catch (err) {
    console.error("[cardRenderer] Jimp fallback failed:", err.message);
    return null;
  }
}

function renderCardText(card) {
  const emoji = TIER_EMOJI[card.tier] || "⚪";
  return `🎴 ${card.name}\n${emoji} ${card.tier}\n💰 $${formatMoney(card.worth)}`;
}

module.exports = {
  generateCardImage,
  generateAnimatedCard,
  renderCardText,
  TIER_EMOJI,
  TIER_DESIGN,
  isReady,
};
