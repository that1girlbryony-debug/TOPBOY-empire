/**
 * 🎨 lib/animator.js v2 — Casino Visual Effects Engine (Task 18)
 *
 * OWNER DIRECTIVE: the gambling GIFs looked lame/childish and barely
 * moved; some gambling commands had no visuals at all. v2 rebuilds the
 * whole engine:
 *
 *   MOTION
 *   - real physics-flavored motion: quintic ease-out spins that keep
 *     moving for most of the animation, staggered reel stops, ball
 *     spiral, coin toss arc with gravity, 24fps output (was 15fps
 *     with an early-stall decel bug that made wheels freeze)
 *
 *   LOOK (professional, life-like — zero emoji)
 *   - casino felt + gold spotlight stages, ornate gold rims with pegs,
 *     marquee bulb chases, glass panels, glow text
 *   - ALL symbols are vector-drawn (cherry/gem/seven/bell/clover/crown,
 *     card suits, dice pips) — server canvases have no color-emoji
 *     font, which is exactly what made v1 look broken
 *   - bundled Cinzel + Oswald fonts (assets/fonts, OFL)
 *
 *   SPEED
 *   - every animation is disk+memory cached by OUTCOME CLASS
 *     (money amounts live in the caption, never baked into the video),
 *     so repeat plays send instantly instead of re-rendering
 *
 * Animations:
 *   animateSlots(reels, multiplier)          — 3-reel machine, staggered stops
 *   animateCasino(win)                       — fortune wheel, peg ticks
 *   animateRoulette(number, color, mult)     — real 37-pocket European wheel
 *   animateCoinFlip(result, win)             — toss arc + flip + bounce
 *   animateBlackjack({player, dealer, pT, dT, outcome}) — dealing on felt
 *   animateDice(roll)                        — single die tumble (.roll)
 *   animateDiceDuel(r1, r2, outcome)         — dice challenge final
 *   sendAnimated(...)                        — video send w/ text fallback
 *
 * Fallback: if canvas/gif-encoder/ffmpeg unavailable, animations return
 * null and sendAnimated falls back to plain text.
 */

const fs = require("fs");
const path = require("path");
const os = require("os");
const crypto = require("crypto");

// ── Dependency detection ─────────────────────────────────────
let canvasAvailable = false;
let createCanvas = null;
let GIFEncoder = null;
let _ffmpegBin = null;

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

try {
  _ffmpegBin = require("ffmpeg-static");
  if (!fs.existsSync(_ffmpegBin)) _ffmpegBin = null;
} catch {}
if (!_ffmpegBin) {
  try {
    const { execSync } = require("child_process");
    _ffmpegBin = execSync("which ffmpeg", { encoding: "utf-8" }).trim();
  } catch {}
}

// Bundled display fonts (OFL — assets/fonts), shared with cardRenderer
try {
  const canvas = require("canvas");
  const FONT_DIR = path.join(__dirname, "..", "assets", "fonts");
  canvas.registerFont(path.join(FONT_DIR, "Cinzel-Bold-static.ttf"), { family: "Cinzel", weight: "bold" });
  canvas.registerFont(path.join(FONT_DIR, "Oswald-SemiBold.ttf"), { family: "Oswald", weight: "600" });
} catch {}

const isReady = () => canvasAvailable && GIFEncoder && !!_ffmpegBin;

// ── Palette (premium casino) ─────────────────────────────────
const COLORS = {
  bg: "#071108",        // deep felt shadow
  felt: "#0d3b1e",      // roulette / blackjack felt
  feltLight: "#14522a",
  floor: "#0a0a10",     // coin stage floor
  gold: "#f5c542",
  goldDeep: "#b8860b",
  goldHi: "#ffe9a8",
  red: "#e0455a",
  redDeep: "#8e1f2f",
  green: "#39d98a",
  blue: "#4f9ff0",
  white: "#f7f5ef",
  cream: "#e8e4d8",
  gray: "#8b949e",
  dark: "#101319",
  darker: "#07080d",
  chrome: "#2a2f3a",
};

// ── Cache layer (outcome-class keyed) ────────────────────────
const CACHE_DIR = path.join(os.tmpdir(), "topboy-anims");
try { fs.mkdirSync(CACHE_DIR, { recursive: true }); } catch {}
const memCache = new Map();
const MEM_MAX = 40;
const sha1 = (s) => crypto.createHash("sha1").update(s).digest("hex");
const ANIM_VERSION = "v5-casino";

function readCache(key) {
  key = sha1(`${ANIM_VERSION}|${key}`);
  const mem = memCache.get(key);
  if (mem) return mem;
  try {
    const buf = fs.readFileSync(path.join(CACHE_DIR, key));
    if (buf.length > 1000) {
      if (memCache.size >= MEM_MAX) memCache.delete(memCache.keys().next().value);
      memCache.set(key, buf);
      return buf;
    }
  } catch {}
  return null;
}

function writeCache(key, buffer) {
  key = sha1(`${ANIM_VERSION}|${key}`);
  if (memCache.size >= MEM_MAX) memCache.delete(memCache.keys().next().value);
  memCache.set(key, buffer);
  try { fs.writeFileSync(path.join(CACHE_DIR, key), buffer); } catch {}
}

// ── Encode: canvas frames → GIF → MP4 (24fps, silent audio) ──
async function framesToMp4(frames, width, height, delayMs = 42) {
  if (!isReady()) return null;
  if (!frames || frames.length === 0) return null;

  const tmpId = `anim_${Date.now()}_${Math.floor(Math.random() * 10000)}`;
  const gifPath = path.join(os.tmpdir(), `${tmpId}.gif`);
  const mp4Path = path.join(os.tmpdir(), `${tmpId}.mp4`);

  try {
    const encoder = new GIFEncoder(width, height);
    encoder.setRepeat(0);
    encoder.setDelay(delayMs);
    encoder.setQuality(10);
    encoder.start();
    for (const frame of frames) encoder.addFrame(frame);
    encoder.finish();
    fs.writeFileSync(gifPath, encoder.out.getData());

    const { execFile } = require("child_process");
    const args = [
      "-y",
      "-i", gifPath,
      "-f", "lavfi", "-i", "anullsrc=channel_layout=stereo:sample_rate=44100",
      "-shortest",
      "-c:v", "libx264", "-preset", "veryfast", "-crf", "23",
      "-pix_fmt", "yuv420p",
      "-vf", "scale=trunc(iw/2)*2:trunc(ih/2)*2,fps=24",
      "-c:a", "aac", "-b:a", "32k",
      "-movflags", "faststart",
      "-tag:v", "avc1",
      mp4Path,
    ];
    await new Promise((resolve, reject) => {
      execFile(_ffmpegBin, args, { timeout: 45000 }, (err, stdout, stderr) => {
        if (err) reject(new Error(stderr ? stderr.substring(0, 200) : err.message));
        else resolve();
      });
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

// ── Primitives ───────────────────────────────────────────────
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

const clamp01 = (t) => Math.max(0, Math.min(1, t));
// quintic ease-out — fast start, looong smooth tail (real spin feel)
const easeOutQuint = (t) => 1 - Math.pow(1 - clamp01(t), 5);
// back-ease for settle bounces
const easeOutBack = (t) => {
  const c1 = 1.70158, c3 = c1 + 1;
  const x = clamp01(t);
  return 1 + c3 * Math.pow(x - 1, 3) + c1 * Math.pow(x - 1, 2);
};

// letter-spaced text (cairo has no letterSpacing)
function drawTracked(ctx, text, x, y, track, align = "center") {
  const chars = [...String(text)];
  const widths = chars.map((c) => ctx.measureText(c).width);
  const total = widths.reduce((a, b) => a + b, 0) + track * Math.max(0, chars.length - 1);
  let cx = align === "center" ? x - total / 2 : align === "right" ? x - total : x;
  const prevAlign = ctx.textAlign;
  ctx.textAlign = "left";
  for (let i = 0; i < chars.length; i++) {
    ctx.fillText(chars[i], cx, y);
    cx += widths[i] + track;
  }
  ctx.textAlign = prevAlign;
  return total;
}

// text with a soft outer glow
function glowText(ctx, text, x, y, font, fill, glow, blur, align = "center") {
  ctx.save();
  ctx.font = font;
  ctx.textAlign = align;
  ctx.textBaseline = "alphabetic";
  ctx.shadowColor = glow;
  ctx.shadowBlur = blur;
  ctx.fillStyle = fill;
  ctx.fillText(text, x, y);
  ctx.shadowBlur = 0;
  ctx.fillText(text, x, y); // double draw sharpens core
  ctx.restore();
}

// ── Stages ───────────────────────────────────────────────────
// casino felt table: radial spotlight, felt texture ring, vignette
function drawFelt(ctx, W, H) {
  ctx.fillStyle = COLORS.bg;
  ctx.fillRect(0, 0, W, H);
  const spot = ctx.createRadialGradient(W / 2, H * 0.42, 10, W / 2, H * 0.42, W * 0.68);
  spot.addColorStop(0, COLORS.feltLight);
  spot.addColorStop(0.55, COLORS.felt);
  spot.addColorStop(1, COLORS.bg);
  ctx.fillStyle = spot;
  ctx.fillRect(0, 0, W, H);
  // faint felt noise
  ctx.save();
  ctx.globalAlpha = 0.05;
  for (let i = 0; i < 90; i++) {
    const nx = (i * 137.5) % W;
    const ny = (i * 89.7) % H;
    ctx.fillStyle = i % 2 ? "#ffffff" : "#000000";
    ctx.fillRect(nx, ny, 1.5, 1.5);
  }
  ctx.restore();
  // vignette
  const vig = ctx.createRadialGradient(W / 2, H / 2, W * 0.3, W / 2, H / 2, W * 0.8);
  vig.addColorStop(0, "rgba(0,0,0,0)");
  vig.addColorStop(1, "rgba(0,0,0,0.6)");
  ctx.fillStyle = vig;
  ctx.fillRect(0, 0, W, H);
}

// dark casino floor stage (coin flip): floor line + gold back glow
function drawStage(ctx, W, H, glow = "rgba(245,197,66,0.16)") {
  ctx.fillStyle = COLORS.darker;
  ctx.fillRect(0, 0, W, H);
  const back = ctx.createRadialGradient(W / 2, H * 0.34, 8, W / 2, H * 0.34, W * 0.62);
  back.addColorStop(0, glow);
  back.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = back;
  ctx.fillRect(0, 0, W, H);
  // floor
  const fl = ctx.createLinearGradient(0, H * 0.72, 0, H);
  fl.addColorStop(0, "rgba(245,197,66,0.10)");
  fl.addColorStop(0.25, "rgba(28,30,40,0.9)");
  fl.addColorStop(1, "#050508");
  ctx.fillStyle = fl;
  ctx.fillRect(0, H * 0.72, W, H * 0.28);
  // horizon glow line
  ctx.save();
  ctx.globalAlpha = 0.5;
  const hl = ctx.createLinearGradient(0, 0, W, 0);
  hl.addColorStop(0, "rgba(245,197,66,0)");
  hl.addColorStop(0.5, "rgba(245,197,66,0.5)");
  hl.addColorStop(1, "rgba(245,197,66,0)");
  ctx.fillStyle = hl;
  ctx.fillRect(0, H * 0.72 - 1, W, 1.4);
  ctx.restore();
  const vig = ctx.createRadialGradient(W / 2, H / 2, W * 0.32, W / 2, H / 2, W * 0.8);
  vig.addColorStop(0, "rgba(0,0,0,0)");
  vig.addColorStop(1, "rgba(0,0,0,0.55)");
  ctx.fillStyle = vig;
  ctx.fillRect(0, 0, W, H);
}

// glass panel with gold hairline
function goldPanel(ctx, x, y, w, h, r, alpha = 0.55) {
  ctx.save();
  ctx.fillStyle = `rgba(10,12,18,${alpha})`;
  roundRect(ctx, x, y, w, h, r);
  ctx.fill();
  ctx.strokeStyle = "rgba(245,197,66,0.55)";
  ctx.lineWidth = 1.4;
  roundRect(ctx, x + 1, y + 1, w - 2, h - 2, r - 1);
  ctx.stroke();
  const sheen = ctx.createLinearGradient(0, y, 0, y + h * 0.4);
  sheen.addColorStop(0, "rgba(255,255,255,0.07)");
  sheen.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = sheen;
  roundRect(ctx, x, y, w, h, r);
  ctx.fill();
  ctx.restore();
}

// marquee bulbs in a row; phase drives the chase
function drawBulbs(ctx, x, y, w, n, phase, onColor = COLORS.goldHi) {
  for (let i = 0; i < n; i++) {
    const bx = x + (i + 0.5) * (w / n);
    const on = (i + phase) % 3 === 0;
    ctx.beginPath();
    ctx.arc(bx, y, 2.6, 0, Math.PI * 2);
    ctx.fillStyle = on ? onColor : "rgba(120,90,30,0.55)";
    if (on) {
      ctx.shadowColor = onColor;
      ctx.shadowBlur = 7;
    }
    ctx.fill();
    ctx.shadowBlur = 0;
  }
}

// gold metal gradient (shared by rims/frames/hubs)
function goldGrad(ctx, x0, y0, x1, y1, hi = COLORS.goldHi, mid = COLORS.gold, deep = COLORS.goldDeep) {
  const g = ctx.createLinearGradient(x0, y0, x1, y1);
  g.addColorStop(0, deep);
  g.addColorStop(0.3, mid);
  g.addColorStop(0.5, hi);
  g.addColorStop(0.72, mid);
  g.addColorStop(1, deep);
  return g;
}

// ── Vector symbol library (replaces emoji — servers have no emoji font)
function drawCherry(ctx, x, y, s) {
  ctx.save();
  ctx.translate(x, y);
  ctx.lineCap = "round";
  // stems
  ctx.strokeStyle = "#3e7d3a";
  ctx.lineWidth = s * 0.09;
  ctx.beginPath();
  ctx.moveTo(-s * 0.22, s * 0.18);
  ctx.quadraticCurveTo(-s * 0.05, -s * 0.5, s * 0.2, -s * 0.62);
  ctx.moveTo(s * 0.28, s * 0.1);
  ctx.quadraticCurveTo(s * 0.22, -s * 0.3, s * 0.2, -s * 0.62);
  ctx.stroke();
  // leaf
  ctx.fillStyle = "#4f9e47";
  ctx.beginPath();
  ctx.ellipse(s * 0.38, -s * 0.6, s * 0.22, s * 0.1, -0.5, 0, Math.PI * 2);
  ctx.fill();
  // berries
  for (const [bx, by] of [[-s * 0.22, s * 0.32], [s * 0.28, s * 0.26]]) {
    const g = ctx.createRadialGradient(bx - s * 0.08, by - s * 0.1, s * 0.03, bx, by, s * 0.26);
    g.addColorStop(0, "#ff7d6e");
    g.addColorStop(0.5, "#d92b3f");
    g.addColorStop(1, "#7e1120");
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(bx, by, s * 0.25, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "rgba(255,255,255,0.55)";
    ctx.beginPath();
    ctx.arc(bx - s * 0.09, by - s * 0.1, s * 0.055, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

function drawGem(ctx, x, y, s, color = "#5bc8f5") {
  ctx.save();
  ctx.translate(x, y);
  const w = s * 0.52, h = s * 0.44, d = s * 0.52;
  const g = ctx.createLinearGradient(-w, -h, w, d);
  g.addColorStop(0, "#ffffff");
  g.addColorStop(0.35, color);
  g.addColorStop(1, "rgba(10,30,50,0.9)");
  ctx.beginPath();
  ctx.moveTo(-w, -h);
  ctx.lineTo(w, -h);
  ctx.lineTo(w * 0.6, -h * 0.2);
  ctx.lineTo(0, d);
  ctx.lineTo(-w * 0.6, -h * 0.2);
  ctx.closePath();
  ctx.fillStyle = g;
  ctx.fill();
  // facets
  ctx.strokeStyle = "rgba(255,255,255,0.5)";
  ctx.lineWidth = Math.max(1, s * 0.03);
  ctx.beginPath();
  ctx.moveTo(-w, -h); ctx.lineTo(0, -h * 0.2); ctx.lineTo(w, -h);
  ctx.moveTo(0, -h * 0.2); ctx.lineTo(0, d);
  ctx.stroke();
  ctx.restore();
}

function drawSeven(ctx, x, y, s) {
  ctx.save();
  ctx.translate(x, y);
  ctx.font = `bold ${s * 1.15}px Oswald`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.lineWidth = s * 0.16;
  ctx.strokeStyle = COLORS.goldDeep;
  ctx.strokeText("7", 0, s * 0.08);
  const g = ctx.createLinearGradient(0, -s * 0.6, 0, s * 0.6);
  g.addColorStop(0, "#ff5f52");
  g.addColorStop(1, "#b21e35");
  ctx.fillStyle = g;
  ctx.fillText("7", 0, s * 0.08);
  ctx.restore();
}

function drawBell(ctx, x, y, s) {
  ctx.save();
  ctx.translate(x, y);
  const g = ctx.createLinearGradient(0, -s * 0.55, 0, s * 0.4);
  g.addColorStop(0, "#ffe9a8");
  g.addColorStop(0.5, COLORS.gold);
  g.addColorStop(1, COLORS.goldDeep);
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.moveTo(0, -s * 0.55);
  ctx.bezierCurveTo(s * 0.42, -s * 0.5, s * 0.36, s * 0.12, s * 0.4, s * 0.3);
  ctx.lineTo(-s * 0.4, s * 0.3);
  ctx.bezierCurveTo(-s * 0.36, s * 0.12, -s * 0.42, -s * 0.5, 0, -s * 0.55);
  ctx.closePath();
  ctx.fill();
  // clapper + hanger
  ctx.fillStyle = COLORS.goldDeep;
  ctx.beginPath();
  ctx.arc(0, s * 0.4, s * 0.11, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.arc(0, -s * 0.55, s * 0.09, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "rgba(255,255,255,0.4)";
  ctx.beginPath();
  ctx.ellipse(-s * 0.12, -s * 0.18, s * 0.06, s * 0.18, 0.3, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function drawClover(ctx, x, y, s) {
  ctx.save();
  ctx.translate(x, y);
  ctx.strokeStyle = "#2f6e2c";
  ctx.lineWidth = s * 0.08;
  ctx.beginPath();
  ctx.moveTo(0, s * 0.1);
  ctx.quadraticCurveTo(s * 0.12, s * 0.4, s * 0.06, s * 0.62);
  ctx.stroke();
  const g = ctx.createLinearGradient(-s * 0.4, -s * 0.5, s * 0.4, s * 0.4);
  g.addColorStop(0, "#6fd96a");
  g.addColorStop(1, "#1f7a24");
  ctx.fillStyle = g;
  for (const [lx, ly] of [[-s * 0.2, -s * 0.18], [s * 0.2, -s * 0.18], [0, -s * 0.42]]) {
    ctx.beginPath();
    ctx.arc(lx, ly, s * 0.2, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.beginPath();
  ctx.arc(0, 0, s * 0.17, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function drawCrown(ctx, x, y, s) {
  ctx.save();
  ctx.translate(x, y);
  const g = goldGrad(ctx, -s * 0.5, -s * 0.4, s * 0.5, s * 0.4);
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.moveTo(-s * 0.48, s * 0.28);
  ctx.lineTo(-s * 0.48, -s * 0.18);
  ctx.lineTo(-s * 0.22, s * 0.02);
  ctx.lineTo(0, -s * 0.4);
  ctx.lineTo(s * 0.22, s * 0.02);
  ctx.lineTo(s * 0.48, -s * 0.18);
  ctx.lineTo(s * 0.48, s * 0.28);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = "rgba(90,60,5,0.8)";
  ctx.lineWidth = Math.max(1, s * 0.035);
  ctx.stroke();
  // jewels
  ctx.fillStyle = COLORS.red;
  ctx.beginPath();
  ctx.arc(0, s * 0.08, s * 0.075, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "#5bc8f5";
  for (const jx of [-s * 0.26, s * 0.26]) {
    ctx.beginPath();
    ctx.arc(jx, s * 0.1, s * 0.055, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

function drawStar(ctx, x, y, s, color = COLORS.gold) {
  ctx.save();
  ctx.translate(x, y);
  ctx.beginPath();
  for (let i = 0; i < 10; i++) {
    const a = -Math.PI / 2 + (i * Math.PI) / 5;
    const rr = i % 2 === 0 ? s * 0.5 : s * 0.22;
    const px = rr * Math.cos(a), py = rr * Math.sin(a);
    if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
  }
  ctx.closePath();
  ctx.fillStyle = color;
  ctx.shadowColor = color;
  ctx.shadowBlur = s * 0.3;
  ctx.fill();
  ctx.restore();
}

function drawCoin(ctx, x, y, s) {
  ctx.save();
  ctx.translate(x, y);
  const g = ctx.createRadialGradient(-s * 0.2, -s * 0.2, s * 0.05, 0, 0, s * 0.5);
  g.addColorStop(0, COLORS.goldHi);
  g.addColorStop(0.55, COLORS.gold);
  g.addColorStop(1, COLORS.goldDeep);
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(0, 0, s * 0.5, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = "rgba(120,80,10,0.9)";
  ctx.lineWidth = Math.max(1, s * 0.04);
  ctx.stroke();
  ctx.fillStyle = COLORS.goldDeep;
  ctx.font = `bold ${s * 0.5}px Oswald`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText("$", 0, s * 0.03);
  ctx.restore();
}

// playing-card suits (spade heart diamond club)
function drawSuit(ctx, suit, x, y, s, color) {
  ctx.save();
  ctx.translate(x, y);
  ctx.fillStyle = color;
  if (suit === "spade") {
    ctx.beginPath();
    ctx.moveTo(0, -s * 0.5);
    ctx.bezierCurveTo(s * 0.55, -s * 0.05, s * 0.32, s * 0.32, s * 0.06, s * 0.18);
    ctx.bezierCurveTo(s * 0.1, s * 0.38, s * 0.16, s * 0.44, s * 0.2, s * 0.5);
    ctx.lineTo(-s * 0.2, s * 0.5);
    ctx.bezierCurveTo(-s * 0.16, s * 0.44, -s * 0.1, s * 0.38, -s * 0.06, s * 0.18);
    ctx.bezierCurveTo(-s * 0.32, s * 0.32, -s * 0.55, -s * 0.05, 0, -s * 0.5);
    ctx.closePath();
    ctx.fill();
  } else if (suit === "heart") {
    ctx.beginPath();
    ctx.moveTo(0, s * 0.45);
    ctx.bezierCurveTo(-s * 0.6, -s * 0.02, -s * 0.32, -s * 0.5, 0, -s * 0.22);
    ctx.bezierCurveTo(s * 0.32, -s * 0.5, s * 0.6, -s * 0.02, 0, s * 0.45);
    ctx.closePath();
    ctx.fill();
  } else if (suit === "diamond") {
    ctx.beginPath();
    ctx.moveTo(0, -s * 0.5);
    ctx.lineTo(s * 0.36, 0);
    ctx.lineTo(0, s * 0.5);
    ctx.lineTo(-s * 0.36, 0);
    ctx.closePath();
    ctx.fill();
  } else {
    // club: three lobes + stem
    for (const [cx2, cy2] of [[0, -s * 0.26], [-s * 0.24, s * 0.06], [s * 0.24, s * 0.06]]) {
      ctx.beginPath();
      ctx.arc(cx2, cy2, s * 0.21, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.beginPath();
    ctx.moveTo(0, s * 0.02);
    ctx.bezierCurveTo(s * 0.06, s * 0.3, s * 0.12, s * 0.4, s * 0.16, s * 0.48);
    ctx.lineTo(-s * 0.16, s * 0.48);
    ctx.bezierCurveTo(-s * 0.12, s * 0.4, -s * 0.06, s * 0.3, 0, s * 0.02);
    ctx.closePath();
    ctx.fill();
  }
  ctx.restore();
}

// playing card with rank + suit (vector), optional face-down back
function drawPlayingCard(ctx, x, y, w, h, rank, suit, faceDown = false, rot = 0) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(rot);
  ctx.shadowColor = "rgba(0,0,0,0.55)";
  ctx.shadowBlur = 8;
  ctx.shadowOffsetY = 3;
  // body
  ctx.fillStyle = faceDown ? "#101522" : "#f7f5ef";
  roundRect(ctx, -w / 2, -h / 2, w, h, w * 0.09);
  ctx.fill();
  ctx.shadowBlur = 0;
  ctx.shadowOffsetY = 0;
  // rim
  ctx.strokeStyle = "rgba(0,0,0,0.35)";
  ctx.lineWidth = 1.2;
  roundRect(ctx, -w / 2, -h / 2, w, h, w * 0.09);
  ctx.stroke();

  if (faceDown) {
    // ornate card back: gold lattice on dark navy
    ctx.save();
    roundRect(ctx, -w / 2 + 3, -h / 2 + 3, w - 6, h - 6, w * 0.07);
    ctx.clip();
    ctx.strokeStyle = "rgba(245,197,66,0.4)";
    ctx.lineWidth = 1;
    const step = w * 0.16;
    for (let i = -h; i < w + h; i += step) {
      ctx.beginPath();
      ctx.moveTo(-w / 2 + i, -h / 2);
      ctx.lineTo(-w / 2 + i + h, h / 2);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(-w / 2 + i + h, -h / 2);
      ctx.lineTo(-w / 2 + i, h / 2);
      ctx.stroke();
    }
    ctx.restore();
    drawSuit(ctx, "diamond", 0, 0, w * 0.34, "rgba(245,197,66,0.85)");
  } else {
    const isRed = suit === "heart" || suit === "diamond";
    const col = isRed ? "#c0233b" : "#1a1d26";
    const suitKey = { "♠️": "spade", "♥️": "heart", "♦️": "diamond", "♣️": "club" }[suit] || "spade";
    // corner rank + suit
    ctx.fillStyle = col;
    ctx.textAlign = "center";
    ctx.textBaseline = "alphabetic";
    ctx.font = `bold ${w * 0.26}px Oswald`;
    ctx.fillText(rank, -w * 0.3, -h * 0.24);
    drawSuit(ctx, suitKey, -w * 0.3, h * 0.02, w * 0.16, col);
    // center suit
    drawSuit(ctx, suitKey, 0, h * 0.06, w * 0.44, col);
  }
  ctx.restore();
}

// die with pips, rotation support
function drawDie(ctx, x, y, size, value, rot = 0, glow = null) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(rot);
  const r = size * 0.2;
  ctx.shadowColor = glow || "rgba(0,0,0,0.5)";
  ctx.shadowBlur = glow ? 16 : 8;
  ctx.shadowOffsetY = 3;
  const g = ctx.createLinearGradient(-size / 2, -size / 2, size / 2, size / 2);
  g.addColorStop(0, "#ffffff");
  g.addColorStop(1, "#d9d4c8");
  ctx.fillStyle = g;
  roundRect(ctx, -size / 2, -size / 2, size, size, r);
  ctx.fill();
  ctx.shadowBlur = 0;
  ctx.shadowOffsetY = 0;
  ctx.strokeStyle = "rgba(0,0,0,0.4)";
  ctx.lineWidth = 1.4;
  roundRect(ctx, -size / 2, -size / 2, size, size, r);
  ctx.stroke();
  // inner gold ring (premium dice)
  ctx.strokeStyle = "rgba(245,197,66,0.5)";
  ctx.lineWidth = 1.2;
  roundRect(ctx, -size / 2 + 4, -size / 2 + 4, size - 8, size - 8, r - 3);
  ctx.stroke();
  // pips
  const p = size * 0.24;
  const dot = size * 0.075;
  const P = {
    1: [[0, 0]],
    2: [[-p, -p], [p, p]],
    3: [[-p, -p], [0, 0], [p, p]],
    4: [[-p, -p], [p, -p], [-p, p], [p, p]],
    5: [[-p, -p], [p, -p], [0, 0], [-p, p], [p, p]],
    6: [[-p, -p], [p, -p], [-p, 0], [p, 0], [-p, p], [p, p]],
  }[value] || [];
  for (const [dx, dy] of P) {
    ctx.beginPath();
    ctx.arc(dx, dy, dot, 0, Math.PI * 2);
    ctx.fillStyle = value === 1 ? COLORS.red : "#1a1d26";
    if (value === 1) {
      ctx.shadowColor = COLORS.red;
      ctx.shadowBlur = 6;
    }
    ctx.fill();
    ctx.shadowBlur = 0;
  }
  ctx.restore();
}

// confetti burst particles (win moments)
function makeConfetti(n, W, H) {
  const p = [];
  for (let i = 0; i < n; i++) {
    p.push({
      x: W / 2 + (Math.random() - 0.5) * W * 0.5,
      y: H * 0.55 + (Math.random() - 0.5) * 30,
      vx: (Math.random() - 0.5) * 7,
      vy: -4 - Math.random() * 6,
      size: 2 + Math.random() * 3,
      rot: Math.random() * Math.PI * 2,
      vr: (Math.random() - 0.5) * 0.4,
      color: [COLORS.gold, COLORS.goldHi, COLORS.red, "#5bc8f5", COLORS.green][i % 5],
    });
  }
  return p;
}

function drawConfetti(ctx, particles, gravity = 0.28) {
  ctx.save();
  for (const p of particles) {
    p.x += p.vx;
    p.y += p.vy;
    p.vy += gravity;
    p.rot += p.vr;
    if (p.y > 620) continue;
    ctx.save();
    ctx.translate(p.x, p.y);
    ctx.rotate(p.rot);
    ctx.globalAlpha = 0.9;
    ctx.fillStyle = p.color;
    ctx.fillRect(-p.size / 2, -p.size / 4, p.size, p.size / 2);
    ctx.restore();
  }
  ctx.restore();
}

// ═══════════════════════════════════════════════════════════════
// SCENE: SLOTS — real reel strips, staggered stops, bulb marquee
// ═══════════════════════════════════════════════════════════════
const SLOT_SYMBOLS = ["cherry", "gem", "seven", "bell", "clover", "crown"];

function drawSlotSymbol(ctx, name, x, y, s) {
  switch (name) {
    case "cherry": return drawCherry(ctx, x, y, s);
    case "gem": return drawGem(ctx, x, y, s);
    case "seven": return drawSeven(ctx, x, y, s);
    case "bell": return drawBell(ctx, x, y, s);
    case "clover": return drawClover(ctx, x, y, s);
    case "crown": return drawCrown(ctx, x, y, s);
    case "coin": return drawCoin(ctx, x, y, s);
    case "star": return drawStar(ctx, x, y, s);
  }
}

async function animateSlots(reels, multiplier) {
  if (!isReady()) return null;

  const W = 480, H = 300;
  const cacheKey = `slots|${reels.join(",")}|${multiplier}`;
  const cached = readCache(cacheKey);
  if (cached) return cached;

  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext("2d");
  const frames = [];
  const TF = 48;

  // machine geometry
  const mx = 78, mw = W - 156, my = 34, mh = H - 62;
  const reelW = 92, reelH = 104, reelY = 118;
  const reelXs = [mx + 22, mx + 22 + reelW + 16, mx + 22 + (reelW + 16) * 2];
  const stopAt = [20, 27, 34];          // staggered reel stops
  const spins = [7, 9, 11];             // cells travelled per reel

  // per-reel strips: filler cells, then the FINAL symbol at exactly the
  // index the reel stops on — so the window lands on the real result
  const strips = reels.map((finalSym, r) => {
    const strip = [];
    for (let i = 0; i < spins[r]; i++) strip.push(SLOT_SYMBOLS[(i * 5 + 3) % SLOT_SYMBOLS.length]);
    strip.push(finalSym);
    return strip;
  });

  const raysAng0 = Math.random() * Math.PI;
  const confetti = multiplier > 0 ? makeConfetti(30, W, H) : null;

  for (let f = 0; f < TF; f++) {
    // jackpot rays behind machine
    if (multiplier >= 10 && f >= 32) {
      ctx.save();
      ctx.translate(W / 2, H / 2);
      ctx.rotate(raysAng0 + f * 0.05);
      ctx.globalAlpha = 0.14;
      ctx.fillStyle = COLORS.gold;
      for (let i = 0; i < 12; i++) {
        ctx.rotate((Math.PI * 2) / 12);
        ctx.beginPath();
        ctx.moveTo(0, 0);
        ctx.lineTo(W, -36);
        ctx.lineTo(W, 36);
        ctx.fill();
      }
      ctx.restore();
    }

    drawFelt(ctx, W, H);

    // cabinet
    ctx.save();
    ctx.shadowColor = "rgba(0,0,0,0.6)";
    ctx.shadowBlur = 18;
    ctx.shadowOffsetY = 6;
    const cab = ctx.createLinearGradient(mx, my, mx + mw, my + mh);
    cab.addColorStop(0, "#1c2029");
    cab.addColorStop(0.5, "#12151d");
    cab.addColorStop(1, "#0c0e14");
    ctx.fillStyle = cab;
    roundRect(ctx, mx, my, mw, mh, 16);
    ctx.fill();
    ctx.restore();
    ctx.strokeStyle = goldGrad(ctx, mx, my, mx + mw, my + mh);
    ctx.lineWidth = 3;
    roundRect(ctx, mx, my, mw, mh, 16);
    ctx.stroke();

    // marquee
    glowText(ctx, "TOPBOY SLOTS", W / 2, my + 34, `bold 21px Cinzel`, COLORS.goldHi, COLORS.gold, 12);
    drawBulbs(ctx, mx + 14, my + 50, mw - 28, 12, f * 0.5);

    // reels
    for (let r = 0; r < 3; r++) {
      const rx = reelXs[r];
      const stopped = f >= stopAt[r];
      let offset;

      if (!stopped) {
        const p = easeOutQuint(f / stopAt[r]);
        offset = spins[r] * p;
      } else {
        // settle bounce after stopping
        const q = easeOutBack(Math.min(1, (f - stopAt[r]) / 5));
        offset = spins[r] + (q - 1) * 0.18;
      }

      // reel well
      ctx.save();
      ctx.fillStyle = "#05060a";
      roundRect(ctx, rx - 4, reelY - 4, reelW + 8, reelH + 8, 10);
      ctx.fill();
      ctx.restore();

      ctx.save();
      roundRect(ctx, rx, reelY, reelW, reelH, 8);
      ctx.clip();

      const strip = strips[r];
      const cellH = reelH;
      const baseIdx = Math.floor(offset) % strip.length;
      for (let k = -1; k <= 1; k++) {
        const idx = ((baseIdx + k) % strip.length + strip.length) % strip.length;
        const sy = reelY + reelH / 2 + (k - (offset % 1)) * cellH;
        const speed = stopped ? 0 : 1 - easeOutQuint(f / stopAt[r]);
        // motion blur ghosts while fast
        if (speed > 0.4) {
          ctx.globalAlpha = 0.22;
          drawSlotSymbol(ctx, strip[idx], rx + reelW / 2, sy - 9, 44);
          ctx.globalAlpha = 1;
        }
        drawSlotSymbol(ctx, strip[idx], rx + reelW / 2, sy, 46);
      }

      // glass sheen
      const sheen = ctx.createLinearGradient(0, reelY, 0, reelY + reelH);
      sheen.addColorStop(0, "rgba(255,255,255,0.10)");
      sheen.addColorStop(0.5, "rgba(255,255,255,0)");
      sheen.addColorStop(1, "rgba(255,255,255,0.05)");
      ctx.fillStyle = sheen;
      ctx.fillRect(rx, reelY, reelW, reelH);
      ctx.restore();

      // reel bezel
      ctx.strokeStyle = stopped && f >= stopAt[r] && f < stopAt[r] + 6 ? COLORS.goldHi : "rgba(245,197,66,0.4)";
      ctx.lineWidth = stopped && f < stopAt[r] + 6 ? 2.6 : 1.6;
      roundRect(ctx, rx - 4, reelY - 4, reelW + 8, reelH + 8, 10);
      ctx.stroke();
    }

    // payline
    const payFlash = multiplier > 0 && f >= stopAt[2] ? (Math.sin(f * 0.6) + 1) / 2 : 0;
    ctx.save();
    ctx.strokeStyle = payFlash > 0
      ? `rgba(245,197,66,${0.4 + payFlash * 0.6})`
      : "rgba(245,197,66,0.35)";
    ctx.lineWidth = payFlash > 0 ? 2.4 : 1.4;
    ctx.shadowColor = COLORS.gold;
    ctx.shadowBlur = payFlash * 10;
    ctx.beginPath();
    ctx.moveTo(reelXs[0] - 12, reelY + reelH / 2);
    ctx.lineTo(reelXs[2] + reelW + 12, reelY + reelH / 2);
    ctx.stroke();
    ctx.restore();

    // side lever light
    ctx.fillStyle = f % 8 < 4 ? COLORS.red : COLORS.redDeep;
    ctx.beginPath();
    ctx.arc(mx - 14, my + mh / 2, 6, 0, Math.PI * 2);
    ctx.fill();

    // result banner
    const bannerY = my + mh + 20;
    if (f >= 38) {
      if (multiplier >= 10) {
        glowText(ctx, "JACKPOT ×10", W / 2, bannerY, "bold 24px Cinzel", COLORS.goldHi, COLORS.gold, 16);
      } else if (multiplier > 0) {
        glowText(ctx, "WIN ×2", W / 2, bannerY, "bold 23px Cinzel", COLORS.green, "rgba(57,217,138,0.8)", 12);
      } else {
        glowText(ctx, "NO MATCH", W / 2, bannerY, "bold 20px Cinzel", "#c86a74", "rgba(224,69,90,0.5)", 8);
      }
    } else if (f >= 6) {
      ctx.fillStyle = "rgba(232,228,216,0.5)";
      ctx.font = "11px Oswald";
      ctx.textAlign = "center";
      drawTracked(ctx, "SPINNING", W / 2, bannerY - 4, 4);
    }

    if (multiplier > 0 && f >= 38) drawConfetti(ctx, confetti, 0.32);
    frames.push(ctx);
  }

  const mp4 = await framesToMp4(frames, W, H);
  if (mp4) writeCache(cacheKey, mp4);
  return mp4;
}

// ═══════════════════════════════════════════════════════════════
// SCENE: FORTUNE WHEEL (.casino) — pegs, ticks, decel spin
// ═══════════════════════════════════════════════════════════════
async function animateCasino(win) {
  if (!isReady()) return null;

  const W = 480, H = 300;
  const cacheKey = `casino|${win}`;
  const cached = readCache(cacheKey);
  if (cached) return cached;

  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext("2d");
  const frames = [];
  const TF = 48;

  const cx = W / 2, cy = 152, R = 96;
  const SEGS = 12;
  const segIcons = ["coin", "gem", "seven", "star", "crown", "cherry"];
  // gold segments (x2) at 0,3,6,9; dark segments elsewhere
  const goldSeg = (s) => s % 3 === 0;
  const spinEnd = 38;               // wheel stops here
  const totalTurns = 2.6;

  // final segment: a gold one on win, a dark one on loss
  const finalSeg = win ? 0 : 1;     // seg 0 = gold, seg 1 = dark
  // segment s spans [s*30°, (s+1)*30°) with 0 at pointer when angle=0
  // final wheel rotation that puts seg center under the top pointer:
  const segSize = (Math.PI * 2) / SEGS;
  const finalAngle = -(finalSeg + 0.5) * segSize;

  const confetti = win ? makeConfetti(26, W, H) : null;

  for (let f = 0; f < TF; f++) {
    drawFelt(ctx, W, H);

    const p = easeOutQuint(f / spinEnd);
    const angle = totalTurns * Math.PI * 2 * p + finalAngle;

    // glow halo when stopped
    if (f >= spinEnd) {
      const pulse = (Math.sin((f - spinEnd) * 0.4) + 1) / 2;
      const halo = ctx.createRadialGradient(cx, cy, R * 0.7, cx, cy, R * 1.25);
      halo.addColorStop(0, win ? `rgba(245,197,66,${0.25 + pulse * 0.2})` : "rgba(224,69,90,0.18)");
      halo.addColorStop(1, "rgba(0,0,0,0)");
      ctx.fillStyle = halo;
      ctx.fillRect(0, 0, W, H);
    }

    // wheel body
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(angle);

    for (let s = 0; s < SEGS; s++) {
      const a0 = s * segSize, a1 = (s + 1) * segSize;
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.arc(0, 0, R - 12, a0, a1);
      ctx.closePath();
      if (goldSeg(s)) {
        ctx.fillStyle = goldGrad(ctx, 0, 0, R, R);
      } else {
        ctx.fillStyle = s % 2 ? "#171b24" : "#10131a";
      }
      ctx.fill();
      ctx.strokeStyle = "rgba(0,0,0,0.65)";
      ctx.lineWidth = 1.6;
      ctx.stroke();

      // segment icon / label
      const mid = (a0 + a1) / 2;
      const ir = R - 32;
      if (goldSeg(s)) {
        ctx.save();
        ctx.rotate(mid);
        ctx.fillStyle = "#231a05";
        ctx.font = "bold 13px Oswald";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText("×2", ir + 12, 0);
        ctx.restore();
      } else {
        drawSlotSymbol(ctx, segIcons[s % segIcons.length], Math.cos(mid) * ir, Math.sin(mid) * ir, 22);
      }
    }

    // rim + pegs
    ctx.lineWidth = 12;
    ctx.strokeStyle = goldGrad(ctx, -R, -R, R, R);
    ctx.beginPath();
    ctx.arc(0, 0, R - 6, 0, Math.PI * 2);
    ctx.stroke();
    for (let s = 0; s < SEGS; s++) {
      const a = s * segSize;
      ctx.beginPath();
      ctx.arc(Math.cos(a) * (R - 6), Math.sin(a) * (R - 6), 3, 0, Math.PI * 2);
      ctx.fillStyle = COLORS.goldHi;
      ctx.fill();
    }
    ctx.restore();

    // hub
    const hub = ctx.createRadialGradient(cx - 6, cy - 6, 2, cx, cy, 22);
    hub.addColorStop(0, COLORS.goldHi);
    hub.addColorStop(0.6, COLORS.gold);
    hub.addColorStop(1, COLORS.goldDeep);
    ctx.beginPath();
    ctx.arc(cx, cy, 20, 0, Math.PI * 2);
    ctx.fillStyle = hub;
    ctx.shadowColor = "rgba(245,197,66,0.7)";
    ctx.shadowBlur = 14;
    ctx.fill();
    ctx.shadowBlur = 0;
    ctx.fillStyle = "#1a1206";
    ctx.font = "bold 18px Cinzel";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText("T", cx, cy + 1);

    // pointer with tick reaction (rocks when a peg passes)
    const pegPhase = Math.abs(((angle / segSize) % 1 + 1) % 1 - 0.5);
    const tick = f < spinEnd ? Math.max(0, 0.5 - pegPhase) : 0;
    ctx.save();
    ctx.translate(cx, cy - R - 2);
    ctx.rotate(tick * 0.5);
    ctx.beginPath();
    ctx.moveTo(0, -14);
    ctx.lineTo(-9, 8);
    ctx.lineTo(9, 8);
    ctx.closePath();
    ctx.fillStyle = tick > 0.3 ? COLORS.goldHi : COLORS.cream;
    ctx.shadowColor = "rgba(0,0,0,0.6)";
    ctx.shadowBlur = 5;
    ctx.fill();
    ctx.restore();

    // base plinth
    ctx.fillStyle = "rgba(0,0,0,0.5)";
    roundRect(ctx, cx - 34, cy + R + 8, 68, 10, 5);
    ctx.fill();

    // banner
    if (f >= spinEnd + 4) {
      if (win) {
        glowText(ctx, "WIN ×2", W / 2, H - 14, "bold 24px Cinzel", COLORS.goldHi, COLORS.gold, 14);
      } else {
        glowText(ctx, "HOUSE WINS", W / 2, H - 14, "bold 20px Cinzel", "#c86a74", "rgba(224,69,90,0.5)", 8);
      }
    } else {
      ctx.fillStyle = "rgba(232,228,216,0.5)";
      ctx.font = "11px Oswald";
      ctx.textAlign = "center";
      drawTracked(ctx, "SPINNING", W / 2, H - 16, 4);
    }

    if (win && f >= spinEnd + 4) drawConfetti(ctx, confetti, 0.3);
    frames.push(ctx);
  }

  const mp4 = await framesToMp4(frames, W, H);
  if (mp4) writeCache(cacheKey, mp4);
  return mp4;
}

// ═══════════════════════════════════════════════════════════════
// SCENE: ROULETTE — real European wheel, ball spiral + pocket settle
// ═══════════════════════════════════════════════════════════════
const EURO_ORDER = [0,32,15,19,4,21,2,25,17,34,6,27,13,36,11,30,8,23,10,5,24,16,33,1,20,14,31,9,22,18,29,7,28,12,35,3,26];
const RED_SET = new Set([1,3,5,7,9,12,14,16,18,19,21,23,25,27,30,32,34,36]);

async function animateRoulette(number, color, multiplier) {
  if (!isReady()) return null;

  const W = 480, H = 300;
  const cacheKey = `roulette|${number}|${multiplier}`;
  const cached = readCache(cacheKey);
  if (cached) return cached;

  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext("2d");
  const frames = [];
  const TF = 48;

  const cx = W / 2, cy = 150;
  const rimR = 104, trackR = 90, pocketR = 70, hubR = 52;
  const SEGS = EURO_ORDER.length;
  const segSize = (Math.PI * 2) / SEGS;

  // pocket index of the final number
  const pocketIdx = EURO_ORDER.indexOf(number);
  // pocket center angle in WHEEL space (0 at -π/2 top): seg k spans [k*seg - π/2 - seg/2 ...]
  const pocketWheelAngle = -Math.PI / 2 + (pocketIdx + 0.5) * segSize;

  const landF = 38;                  // ball lands here
  const wheelTurns = 1.15;
  const ballTurns = 3.1;             // opposite direction

  for (let f = 0; f < TF; f++) {
    drawFelt(ctx, W, H);

    // wheel rotation (decelerates gently, keeps creeping)
    const wp = easeOutQuint(Math.min(1, f / 44));
    const wheelAngle = wheelTurns * Math.PI * 2 * wp;

    // ball angle: world-space, must END at pocket world angle
    const pocketWorldAngle = pocketWheelAngle + wheelAngle;
    const startAngle = Math.PI / 2;
    let delta = ((pocketWorldAngle - startAngle) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2);
    if (delta > Math.PI) delta -= Math.PI * 2;
    const bp = easeOutQuint(Math.min(1, f / landF));
    const ballAngle = f < landF
      ? startAngle - (ballTurns * Math.PI * 2 + delta) * bp
      : pocketWorldAngle;

    // ball radius: outer track → spiral into pocket
    let ballR = trackR;
    if (f >= landF * 0.6) {
      const rp = easeOutQuint((f - landF * 0.6) / (landF * 0.4));
      ballR = trackR + (pocketR - 6 - trackR) * rp;
    }

    // wheel body
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(wheelAngle);

    // ball track
    ctx.beginPath();
    ctx.arc(0, 0, trackR + 4, 0, Math.PI * 2);
    ctx.arc(0, 0, pocketR + 10, 0, Math.PI * 2, true);
    ctx.fillStyle = "#0b0d12";
    ctx.fill();

    // pockets
    for (let s = 0; s < SEGS; s++) {
      const num = EURO_ORDER[s];
      const a0 = -Math.PI / 2 + s * segSize;
      const a1 = a0 + segSize;
      const segColor = num === 0 ? "#1f7a3a" : RED_SET.has(num) ? COLORS.redDeep : "#14161d";

      ctx.beginPath();
      ctx.arc(0, 0, pocketR + 10, a0, a1);
      ctx.arc(0, 0, hubR, a1, a0, true);
      ctx.closePath();
      ctx.fillStyle = segColor;
      ctx.fill();
      ctx.strokeStyle = "rgba(245,197,66,0.25)";
      ctx.lineWidth = 1;
      ctx.stroke();

      // numbers
      const mid = (a0 + a1) / 2;
      ctx.save();
      ctx.rotate(mid);
      ctx.fillStyle = "#f2efe6";
      ctx.font = "bold 7.5px Oswald";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(String(num), pocketR - 3, 0);
      ctx.restore();
    }

    // final pocket flash
    if (f >= landF) {
      const pulse = (Math.sin((f - landF) * 0.5) + 1) / 2;
      const a0 = -Math.PI / 2 + pocketIdx * segSize;
      const a1 = a0 + segSize;
      ctx.beginPath();
      ctx.arc(0, 0, pocketR + 10, a0, a1);
      ctx.arc(0, 0, hubR, a1, a0, true);
      ctx.closePath();
      ctx.fillStyle = `rgba(245,197,66,${0.2 + pulse * 0.3})`;
      ctx.fill();
    }

    // inner cone + hub
    const cone = ctx.createRadialGradient(0, 0, 4, 0, 0, hubR);
    cone.addColorStop(0, "#232833");
    cone.addColorStop(1, "#0d0f15");
    ctx.beginPath();
    ctx.arc(0, 0, hubR, 0, Math.PI * 2);
    ctx.fillStyle = cone;
    ctx.fill();
    // cone spokes
    ctx.strokeStyle = "rgba(245,197,66,0.35)";
    ctx.lineWidth = 2;
    for (let s = 0; s < 8; s++) {
      const a = (s / 8) * Math.PI * 2;
      ctx.beginPath();
      ctx.moveTo(Math.cos(a) * 12, Math.sin(a) * 12);
      ctx.lineTo(Math.cos(a) * (hubR - 4), Math.sin(a) * (hubR - 4));
      ctx.stroke();
    }
    ctx.beginPath();
    ctx.arc(0, 0, 11, 0, Math.PI * 2);
    ctx.fillStyle = goldGrad(ctx, -11, -11, 11, 11);
    ctx.fill();

    // gold rim + deflectors
    ctx.lineWidth = 13;
    ctx.strokeStyle = goldGrad(ctx, -rimR, -rimR, rimR, rimR);
    ctx.beginPath();
    ctx.arc(0, 0, rimR - 6, 0, Math.PI * 2);
    ctx.stroke();
    for (let s = 0; s < 8; s++) {
      const a = (s / 8) * Math.PI * 2 + Math.PI / 8;
      const dx = Math.cos(a) * (trackR + 2), dy = Math.sin(a) * (trackR + 2);
      ctx.save();
      ctx.translate(dx, dy);
      ctx.rotate(a);
      ctx.fillStyle = "rgba(230,225,210,0.9)";
      ctx.beginPath();
      ctx.moveTo(0, -4); ctx.lineTo(3, 0); ctx.lineTo(0, 4); ctx.lineTo(-3, 0);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    }
    ctx.restore();

    // ball
    const bx = cx + Math.cos(ballAngle) * ballR;
    const by = cy + Math.sin(ballAngle) * ballR;
    ctx.save();
    ctx.shadowColor = "rgba(255,255,255,0.8)";
    ctx.shadowBlur = f < landF ? 8 : 12;
    ctx.beginPath();
    ctx.arc(bx, by, f < landF ? 4.6 : 4, 0, Math.PI * 2);
    ctx.fillStyle = "#f4f2ec";
    ctx.fill();
    ctx.restore();

    // banner
    const label = `${number} ${color.toUpperCase()}`;
    if (f >= landF + 4) {
      if (multiplier > 0) {
        glowText(ctx, `${label} — WIN ×${multiplier}`, W / 2, H - 12, "bold 19px Cinzel", COLORS.goldHi, COLORS.gold, 12);
      } else {
        glowText(ctx, `${label} — LOST`, W / 2, H - 12, "bold 17px Cinzel", "#c86a74", "rgba(224,69,90,0.5)", 8);
      }
    } else {
      ctx.fillStyle = "rgba(232,228,216,0.5)";
      ctx.font = "11px Oswald";
      ctx.textAlign = "center";
      drawTracked(ctx, "NO MORE BETS", W / 2, H - 14, 4);
    }

    frames.push(ctx);
  }

  const mp4 = await framesToMp4(frames, W, H);
  if (mp4) writeCache(cacheKey, mp4);
  return mp4;
}

// ═══════════════════════════════════════════════════════════════
// SCENE: COIN FLIP — toss arc, spin, trail, bounce, land
// ═══════════════════════════════════════════════════════════════
function drawCoinFace(ctx, x, y, radius, face, scaleX) {
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(Math.max(0.06, Math.abs(scaleX)), 1);

  // edge ridges
  ctx.beginPath();
  ctx.arc(0, 0, radius, 0, Math.PI * 2);
  const rim = ctx.createLinearGradient(-radius, 0, radius, 0);
  rim.addColorStop(0, COLORS.goldDeep);
  rim.addColorStop(0.5, COLORS.goldHi);
  rim.addColorStop(1, COLORS.goldDeep);
  ctx.fillStyle = rim;
  ctx.fill();

  // face
  const faceR = radius * 0.88;
  const g = ctx.createRadialGradient(-faceR * 0.3, -faceR * 0.3, faceR * 0.1, 0, 0, faceR);
  g.addColorStop(0, COLORS.goldHi);
  g.addColorStop(0.55, COLORS.gold);
  g.addColorStop(1, COLORS.goldDeep);
  ctx.beginPath();
  ctx.arc(0, 0, faceR, 0, Math.PI * 2);
  ctx.fillStyle = g;
  ctx.fill();

  // ridge ticks
  ctx.strokeStyle = "rgba(120,80,10,0.55)";
  ctx.lineWidth = 1.4;
  for (let i = 0; i < 36; i++) {
    const a = (i / 36) * Math.PI * 2;
    ctx.beginPath();
    ctx.moveTo(Math.cos(a) * (faceR + 2), Math.sin(a) * (faceR + 2));
    ctx.lineTo(Math.cos(a) * (radius - 1), Math.sin(a) * (radius - 1));
    ctx.stroke();
  }

  if (face === "h") {
    // heads: T monogram + star ring
    ctx.fillStyle = "#231a05";
    ctx.font = `bold ${radius * 0.95}px Cinzel`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText("T", 0, radius * 0.06);
    for (let i = 0; i < 5; i++) {
      const a = -Math.PI / 2 + (i / 5) * Math.PI * 2;
      drawStar(ctx, Math.cos(a) * faceR * 0.66, Math.sin(a) * faceR * 0.66, radius * 0.14, "rgba(35,26,5,0.85)");
    }
  } else {
    // tails: gem emblem + value ring
    drawGem(ctx, 0, 0, radius * 0.9, "#e8b84b");
    ctx.strokeStyle = "rgba(35,26,5,0.7)";
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    ctx.arc(0, 0, faceR * 0.8, 0, Math.PI * 2);
    ctx.stroke();
  }
  ctx.restore();
}

async function animateCoinFlip(result, win) {
  if (!isReady()) return null;

  const W = 480, H = 300;
  const cacheKey = `cf|${result}|${win}`;
  const cached = readCache(cacheKey);
  if (cached) return cached;

  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext("2d");
  const frames = [];
  const TF = 44;

  const cx = W / 2, groundY = 205, R = 46;
  const spinEnd = 30;                 // spin settles here
  const apex = 128;                   // toss height
  const flipTurns = 5.5;

  for (let f = 0; f < TF; f++) {
    drawStage(ctx, W, H);

    // toss arc (parabola in time) + landing bounce
    let y = groundY, airP = 0;
    if (f <= spinEnd) {
      airP = f / spinEnd;
      y = groundY - apex * 4 * airP * (1 - airP);
    } else if (f <= spinEnd + 7) {
      const q = (f - spinEnd) / 7;
      y = groundY - 22 * 4 * q * (1 - q);
    }

    // shadow on the floor scales with height
    const hgt = Math.max(0, groundY - y);
    ctx.save();
    ctx.globalAlpha = Math.max(0.12, 0.5 - (hgt / apex) * 0.4);
    ctx.fillStyle = "#000";
    ctx.beginPath();
    ctx.ellipse(cx, groundY + 14, R * (1 - (hgt / apex) * 0.45), 8 * (1 - (hgt / apex) * 0.4), 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    // spin: fast flips decelerating to rest
    const sp = easeOutQuint(Math.min(1, f / spinEnd));
    let spinAngle = flipTurns * Math.PI * 2 * sp;
    if (f > spinEnd) {
      // micro wobble on landing
      const wob = easeOutBack(Math.min(1, (f - spinEnd) / 6));
      spinAngle += (wob - 1) * 0.22;
    }

    // motion trail ghosts while spinning fast
    const speed = f < spinEnd ? 1 - sp : 0;
    if (speed > 0.35) {
      ctx.save();
      ctx.globalAlpha = 0.16;
      drawCoinFace(ctx, cx, y, R, Math.cos(spinAngle - 0.9) > 0 ? "h" : "t", Math.cos(spinAngle - 0.9));
      ctx.globalAlpha = 0.08;
      drawCoinFace(ctx, cx, y, R, Math.cos(spinAngle - 1.8) > 0 ? "h" : "t", Math.cos(spinAngle - 1.8));
      ctx.restore();
    }

    // landed face is forced to the result
    const face = f >= spinEnd - 1 ? result : (Math.cos(spinAngle) > 0 ? "h" : "t");
    drawCoinFace(ctx, cx, y, R, face, Math.cos(spinAngle));

    // land flash ring
    if (f === spinEnd || f === spinEnd + 7) {
      ctx.save();
      ctx.strokeStyle = "rgba(245,197,66,0.7)";
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.ellipse(cx, groundY + 12, R * 1.3, 12, 0, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }

    // banner
    const label = result === "h" ? "HEADS" : "TAILS";
    if (f >= spinEnd + 9) {
      if (win) {
        glowText(ctx, `${label} — YOU WIN`, W / 2, H - 16, "bold 23px Cinzel", COLORS.green, "rgba(57,217,138,0.8)", 12);
      } else {
        glowText(ctx, `${label} — LOST`, W / 2, H - 16, "bold 20px Cinzel", "#c86a74", "rgba(224,69,90,0.5)", 8);
      }
    } else {
      ctx.fillStyle = "rgba(232,228,216,0.5)";
      ctx.font = "11px Oswald";
      ctx.textAlign = "center";
      drawTracked(ctx, "FLIPPING", W / 2, H - 18, 4);
    }

    frames.push(ctx);
  }

  const mp4 = await framesToMp4(frames, W, H);
  if (mp4) writeCache(cacheKey, mp4);
  return mp4;
}

// ═══════════════════════════════════════════════════════════════
// SCENE: BLACKJACK — cards dealt onto felt, dealer flip, verdict
// ═══════════════════════════════════════════════════════════════
async function animateBlackjack({ player, dealer, playerTotal, dealerTotal, outcome }) {
  if (!isReady()) return null;

  const W = 480, H = 300;
  const handKey = (h) => h.map((c) => `${c.rank}${c.suit}`).join(",");
  const cacheKey = `bj|${handKey(player)}|${handKey(dealer)}|${outcome}`;
  const cached = readCache(cacheKey);
  if (cached) return cached;

  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext("2d");

  const CW = 50, CH = 72;
  const deckX = W - 52, deckY = H / 2 - 10;

  // deal schedule: P1 P2 D1 D2(down) then player hits then dealer hits
  const events = [];
  let t = 5;
  player.forEach((card, i) => {
    if (i < 2) { events.push({ card, hand: "p", idx: i, at: t, down: false }); t += 5; }
  });
  dealer.forEach((card, i) => {
    if (i < 2) { events.push({ card, hand: "d", idx: i, at: t, down: i === 1 }); t += 5; }
  });
  player.slice(2).forEach((card, i) => {
    events.push({ card, hand: "p", idx: 2 + i, at: t, down: false }); t += 4;
  });
  dealer.slice(2).forEach((card, i) => {
    events.push({ card, hand: "d", idx: 2 + i, at: t, down: false }); t += 4;
  });
  const lastDeal = events.length ? events[events.length - 1].at + 4 : t;
  const flipF = Math.max(lastDeal + 2, 24);          // dealer hole card flips
  const bannerF = flipF + 8;
  const TF = bannerF + 10;

  const frames = [];
  for (let f = 0; f < TF; f++) {
    drawFelt(ctx, W, H);

    // table arc text
    ctx.save();
    ctx.fillStyle = "rgba(245,197,66,0.5)";
    ctx.font = "10px Oswald";
    ctx.textAlign = "center";
    drawTracked(ctx, "BLACKJACK PAYS 3 TO 2 · DEALER STANDS ON 17", W / 2, H / 2 - 2, 2);
    ctx.restore();

    // deck stack
    for (let i = 0; i < 3; i++) {
      drawPlayingCard(ctx, deckX + i * 2, deckY + i * 2 - 36, CW, CH, "", "", true);
    }

    // hand layout: fan positions
    const handPos = (n, i, cy) => {
      const spread = Math.min(34, (W - 180) / Math.max(1, n - 1) || 34);
      const cxp = W / 2 - 30 + (i - (n - 1) / 2) * spread;
      const rot = (i - (n - 1) / 2) * 0.045;
      return { x: cxp, y: cy, rot };
    };

    // draw dealt cards (the flipping hole card is drawn by the flip
    // overlay below once the flip window starts — avoid double draw)
    let dealerShown = 0, playerShown = 0;
    for (const ev of events) {
      if (f < ev.at) continue;
      if (ev.down && f >= flipF - 2) continue;
      const flight = Math.min(1, (f - ev.at) / 4);
      const ep = easeOutQuint(flight);
      const isDealer = ev.hand === "d";
      const n = isDealer ? dealer.length : player.length;
      const idx = isDealer ? dealerShown++ : playerShown++;
      const pos = handPos(n, ev.idx, isDealer ? 66 : H - 64);
      const faceDown = ev.down && f < flipF;
      const x = deckX + (pos.x - deckX) * ep;
      const y = deckY + (pos.y - deckY) * ep;
      const rot = (1 - ep) * -0.5 + pos.rot * ep;
      drawPlayingCard(ctx, x, y, CW, CH, ev.card.rank, ev.card.suit, faceDown, rot);
    }

    // dealer hole-card flip (scaleX animation)
    if (f >= flipF - 2 && f < flipF + 2 && dealer.length >= 2) {
      const k = 1 - Math.abs((f - flipF) / 2);
      const pos = handPos(dealer.length, 1, 66);
      ctx.save();
      ctx.translate(pos.x, pos.y);
      ctx.scale(Math.max(0.08, k), 1);
      ctx.translate(-pos.x, -pos.y);
      drawPlayingCard(ctx, pos.x, pos.y, CW, CH, dealer[1].rank, dealer[1].suit, f < flipF, pos.rot);
      ctx.restore();
    }

    // totals (fade in after flip)
    if (f >= flipF + 2) {
      ctx.save();
      ctx.globalAlpha = Math.min(1, (f - flipF - 2) / 4);
      glowText(ctx, `DEALER · ${dealerTotal}`, W / 2, 28, "bold 13px Oswald", COLORS.cream, "rgba(0,0,0,0.8)", 4);
      glowText(ctx, `PLAYER · ${playerTotal}`, W / 2, H - 12, "bold 13px Oswald", COLORS.goldHi, "rgba(245,197,66,0.5)", 5);
      ctx.restore();
    } else {
      ctx.fillStyle = "rgba(232,228,216,0.5)";
      ctx.font = "11px Oswald";
      ctx.textAlign = "center";
      drawTracked(ctx, "DEALING", W / 2, 24, 4);
    }

    // verdict banner
    if (f >= bannerF) {
      const B = {
        blackjack: ["BLACKJACK · 3:2", COLORS.goldHi, COLORS.gold, "bold 24px Cinzel", 16],
        win: ["YOU WIN", COLORS.green, "rgba(57,217,138,0.8)", "bold 24px Cinzel", 12],
        bust: ["BUST", "#ff6b5e", "rgba(224,69,90,0.7)", "bold 26px Cinzel", 14],
        lose: ["DEALER WINS", "#c86a74", "rgba(224,69,90,0.5)", "bold 21px Cinzel", 8],
        push: ["PUSH · REFUND", COLORS.cream, "rgba(232,228,216,0.4)", "bold 20px Cinzel", 6],
      }[outcome] || ["DEALER WINS", "#c86a74", "rgba(224,69,90,0.5)", "bold 21px Cinzel", 8];
      glowText(ctx, B[0], W / 2, H / 2 + 44, B[3], B[1], B[2], B[4]);
    }

    frames.push(ctx);
  }

  const mp4 = await framesToMp4(frames, W, H);
  if (mp4) writeCache(cacheKey, mp4);
  return mp4;
}

// ═══════════════════════════════════════════════════════════════
// SCENE: DICE — tumble with pips flicker, settle bounce
// ═══════════════════════════════════════════════════════════════
function drawDiceScene(ctx, W, H, f, dice) {
  // dice: [{value, cx, label, glow}]
  drawFelt(ctx, W, H);

  // tray
  goldPanel(ctx, W / 2 - 150, 52, 300, 150, 18, 0.4);

  const settleF = 26;
  for (const d of dice) {
    const sp = easeOutQuint(Math.min(1, f / settleF));
    let rot = 2.4 * Math.PI * 2 * sp;
    if (f > settleF) {
      const wob = easeOutBack(Math.min(1, (f - settleF) / 6));
      rot += (wob - 1) * 0.3;
    }
    // tumble lift
    let lift = 0;
    if (f <= settleF) {
      const p = f / settleF;
      lift = 34 * 4 * p * (1 - p);
    } else if (f <= settleF + 6) {
      const q = (f - settleF) / 6;
      lift = 10 * 4 * q * (1 - q);
    }
    const shown = f >= settleF - 1 ? d.value : (Math.floor(f * 1.7 + d.cx) % 6) + 1;
    const size = 62;
    // shadow
    ctx.save();
    ctx.globalAlpha = Math.max(0.15, 0.45 - (lift / 40) * 0.3);
    ctx.fillStyle = "#000";
    ctx.beginPath();
    ctx.ellipse(d.cx, 168, size * 0.42, 7, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    drawDie(ctx, d.cx, 150 - lift, size, shown, rot, d.glow && f >= settleF ? COLORS.gold : null);

    if (d.label) {
      ctx.fillStyle = "rgba(232,228,216,0.65)";
      ctx.font = "11px Oswald";
      ctx.textAlign = "center";
      drawTracked(ctx, d.label, d.cx, 190, 2.5);
    }
  }
}

async function animateDice(roll) {
  if (!isReady()) return null;

  const W = 480, H = 300;
  const cacheKey = `dice1|${roll}`;
  const cached = readCache(cacheKey);
  if (cached) return cached;

  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext("2d");
  const frames = [];
  const TF = 40;

  for (let f = 0; f < TF; f++) {
    drawDiceScene(ctx, W, H, f, [{ value: roll, cx: W / 2, label: null }]);

    if (f >= 30) {
      glowText(ctx, `ROLLED ${roll}`, W / 2, H - 26, "bold 24px Cinzel", COLORS.goldHi, COLORS.gold, 12);
    } else {
      ctx.fillStyle = "rgba(232,228,216,0.5)";
      ctx.font = "11px Oswald";
      ctx.textAlign = "center";
      drawTracked(ctx, "ROLLING", W / 2, H - 28, 4);
    }
    frames.push(ctx);
  }

  const mp4 = await framesToMp4(frames, W, H);
  if (mp4) writeCache(cacheKey, mp4);
  return mp4;
}

async function animateDiceDuel(r1, r2, outcome) {
  if (!isReady()) return null;

  const W = 480, H = 300;
  const cacheKey = `dice2|${r1}|${r2}|${outcome}`;
  const cached = readCache(cacheKey);
  if (cached) return cached;

  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext("2d");
  const frames = [];
  const TF = 44;

  for (let f = 0; f < TF; f++) {
    drawDiceScene(ctx, W, H, f, [
      { value: r1, cx: W / 2 - 80, label: "PLAYER 1", glow: outcome === "p1" },
      { value: r2, cx: W / 2 + 80, label: "PLAYER 2", glow: outcome === "p2" },
    ]);

    if (f >= 32) {
      if (outcome === "tie") {
        glowText(ctx, "TIE · STAKES REFUND", W / 2, H - 22, "bold 19px Cinzel", COLORS.cream, "rgba(232,228,216,0.4)", 6);
      } else if (outcome === "p1") {
        glowText(ctx, "PLAYER 1 WINS", W / 2, H - 22, "bold 21px Cinzel", COLORS.green, "rgba(57,217,138,0.8)", 10);
      } else {
        glowText(ctx, "PLAYER 2 WINS", W / 2, H - 22, "bold 21px Cinzel", COLORS.green, "rgba(57,217,138,0.8)", 10);
      }
    } else {
      ctx.fillStyle = "rgba(232,228,216,0.5)";
      ctx.font = "11px Oswald";
      ctx.textAlign = "center";
      drawTracked(ctx, "ROLLING", W / 2, H - 24, 4);
    }
    frames.push(ctx);
  }

  const mp4 = await framesToMp4(frames, W, H);
  if (mp4) writeCache(cacheKey, mp4);
  return mp4;
}

// ═══════════════════════════════════════════════════════════════
// SEND HELPER — video w/ gifPlayback, caption fallback to text
// ═══════════════════════════════════════════════════════════════
async function sendAnimated(sock, chat, mp4Buffer, caption, msg, mentions) {
  if (mp4Buffer) {
    try {
      const payload = {
        video: mp4Buffer,
        gifPlayback: true,
        mimetype: "video/mp4",
        caption,
      };
      if (mentions && mentions.length) payload.mentions = mentions;
      await sock.sendMessage(chat, payload, { quoted: msg });
      return true;
    } catch (err) {
      console.error("[animator] send failed, falling back to text:", err.message);
    }
  }
  await sock.sendMessage(chat, { text: caption, ...(mentions && mentions.length ? { mentions } : {}) }, { quoted: msg });
  await new Promise((r) => setTimeout(r, 1200));
  return false;
}

module.exports = {
  isReady,
  animateSlots,
  animateCasino,
  animateRoulette,
  animateCoinFlip,
  animateBlackjack,
  animateDice,
  animateDiceDuel,
  sendAnimated,
  COLORS,
};
