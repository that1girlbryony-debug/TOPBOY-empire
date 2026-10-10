/**
 * 🎨 lib/animator.js v6 — Casino Noir Static Result Engine (Task 19)
 *
 * Owner directive: the animated gambling clips show as STATIC frames in
 * WhatsApp anyway ("no motion but it's fine") — so encode motion is pure
 * overhead. v6 renders ONE high-quality result frame per play as a PNG.
 *
 * What v6 fixes vs v2 (Task 18):
 *   - .slots reel windows rendered BLANK in production: gamble.js passes
 *     emoji symbols (🍒💎7️⃣) but the vector library only knew name strings.
 *     normalizeSlotSymbol() now maps emoji → vector symbol, with a stable
 *     hash fallback — a window can never be empty again.
 *   - Fortune-wheel "×2" labels inherited segment rotation (sideways text).
 *     All wheel labels are now drawn upright.
 *   - Dull look: flat green felt + washed-out pink verdicts replaced with
 *     the TOPBOY noir brand (black space, gold metalwork, gem accents,
 *     Cinzel/Oswald) — visually consistent with the v4 TCG card engine.
 *   - Blackjack layout rebuilt: proper dealer/player zones, larger cards,
 *     no floating deck, hole card shown face-up (final state).
 *
 * Performance: outcome-class disk+memory cache (same as v2) — repeat plays
 * send instantly. Money amounts stay in captions, never baked into images.
 * Runtime needs only node-canvas now (no gif encoder / ffmpeg for gambling).
 */

const fs = require("fs");
const path = require("path");
const os = require("os");
const crypto = require("crypto");

// ── Dependency detection ─────────────────────────────────────
let canvasAvailable = false;
let createCanvas = null;

try {
  const canvas = require("canvas");
  createCanvas = canvas.createCanvas;
  canvasAvailable = true;
} catch (e) {
  console.warn("⚠️ [animator] node-canvas not available — gambling visuals disabled:", e.message);
}

// Bundled display fonts (OFL — assets/fonts), shared with cardRenderer
try {
  const canvas = require("canvas");
  const FONT_DIR = path.join(__dirname, "..", "assets", "fonts");
  canvas.registerFont(path.join(FONT_DIR, "Cinzel-Bold-static.ttf"), { family: "Cinzel", weight: "bold" });
  canvas.registerFont(path.join(FONT_DIR, "Oswald-SemiBold.ttf"), { family: "Oswald", weight: "600" });
} catch {}

const isReady = () => canvasAvailable;

// ── Palette (casino noir — matches v4 card showcase) ─────────
const COLORS = {
  bg: "#07080d",
  felt: "#0c2f1c",       // blackjack felt (deepened)
  feltLight: "#155231",
  floor: "#0a0a10",
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
const ANIM_VERSION = "v6.1-noir-static";

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

// gold metal gradient (shared by rims/frames/plaques)
function goldGrad(ctx, x0, y0, x1, y1, hi = COLORS.goldHi, mid = COLORS.gold, deep = COLORS.goldDeep) {
  const g = ctx.createLinearGradient(x0, y0, x1, y1);
  g.addColorStop(0, deep);
  g.addColorStop(0.3, mid);
  g.addColorStop(0.5, hi);
  g.addColorStop(0.72, mid);
  g.addColorStop(1, deep);
  return g;
}

// ── Stages ───────────────────────────────────────────────────
// noir stage: black space, tinted spotlight halo, star dust, vignette
function drawNoir(ctx, W, H, tint = "rgba(245,197,66,0.13)") {
  ctx.fillStyle = COLORS.bg;
  ctx.fillRect(0, 0, W, H);

  const spot = ctx.createRadialGradient(W / 2, H * 0.42, 12, W / 2, H * 0.42, W * 0.62);
  spot.addColorStop(0, tint);
  spot.addColorStop(0.55, "rgba(245,197,66,0.04)");
  spot.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = spot;
  ctx.fillRect(0, 0, W, H);

  // star dust
  ctx.save();
  for (let i = 0; i < 70; i++) {
    const nx = (i * 173.3) % W;
    const ny = (i * 97.7) % H;
    const a = 0.04 + ((i * 31) % 17) / 100;
    ctx.fillStyle = i % 3 === 0 ? `rgba(245,197,66,${a})` : `rgba(255,255,255,${a})`;
    ctx.fillRect(nx, ny, i % 4 === 0 ? 2 : 1.3, i % 4 === 0 ? 2 : 1.3);
  }
  ctx.restore();

  // vignette
  const vig = ctx.createRadialGradient(W / 2, H / 2, W * 0.34, W / 2, H / 2, W * 0.82);
  vig.addColorStop(0, "rgba(0,0,0,0)");
  vig.addColorStop(1, "rgba(0,0,0,0.62)");
  ctx.fillStyle = vig;
  ctx.fillRect(0, 0, W, H);
}

// blackjack felt: noir frame + deep felt table with double gold inlay
function drawFeltNoir(ctx, W, H) {
  drawNoir(ctx, W, H, "rgba(57,217,138,0.05)");

  // felt table
  const fx = 26, fy = 22, fw = W - 52, fh = H - 44;
  const spot = ctx.createRadialGradient(W / 2, H * 0.45, 20, W / 2, H * 0.45, W * 0.55);
  spot.addColorStop(0, COLORS.feltLight);
  spot.addColorStop(0.55, COLORS.felt);
  spot.addColorStop(1, "#061a10");
  ctx.fillStyle = spot;
  roundRect(ctx, fx, fy, fw, fh, 20);
  ctx.fill();

  // double gold inlay
  ctx.strokeStyle = goldGrad(ctx, fx, fy, fx + fw, fy + fh);
  ctx.lineWidth = 2.4;
  roundRect(ctx, fx + 5, fy + 5, fw - 10, fh - 10, 16);
  ctx.stroke();
  ctx.strokeStyle = "rgba(245,197,66,0.28)";
  ctx.lineWidth = 1;
  roundRect(ctx, fx + 12, fy + 12, fw - 24, fh - 24, 12);
  ctx.stroke();

  // vignette inside felt
  const vig = ctx.createRadialGradient(W / 2, H / 2, W * 0.3, W / 2, H / 2, W * 0.72);
  vig.addColorStop(0, "rgba(0,0,0,0)");
  vig.addColorStop(1, "rgba(0,0,0,0.45)");
  ctx.fillStyle = vig;
  roundRect(ctx, fx, fy, fw, fh, 20);
  ctx.fill();
}

// coin-flip floor stage: noir + horizon line + reflective floor
function drawFloorStage(ctx, W, H) {
  drawNoir(ctx, W, H);
  const fl = ctx.createLinearGradient(0, H * 0.74, 0, H);
  fl.addColorStop(0, "rgba(245,197,66,0.10)");
  fl.addColorStop(0.22, "rgba(24,26,34,0.92)");
  fl.addColorStop(1, "#050508");
  ctx.fillStyle = fl;
  ctx.fillRect(0, H * 0.74, W, H * 0.26);
  const hl = ctx.createLinearGradient(0, 0, W, 0);
  hl.addColorStop(0, "rgba(245,197,66,0)");
  hl.addColorStop(0.5, "rgba(245,197,66,0.45)");
  hl.addColorStop(1, "rgba(245,197,66,0)");
  ctx.fillStyle = hl;
  ctx.fillRect(0, H * 0.74 - 1, W, 1.4);
}

// ── Shared plates ────────────────────────────────────────────
// marquee title: Cinzel gold + tracked + bulb row
function drawTitle(ctx, W, y, text, bulbY = null) {
  glowText(ctx, text, W / 2, y, "bold 23px Cinzel", COLORS.goldHi, "rgba(245,197,66,0.75)", 14);
  ctx.save();
  ctx.fillStyle = "rgba(245,197,66,0.55)";
  ctx.font = "10px Oswald";
  drawTracked(ctx, "T O P B O Y   E M P I R E", W / 2, y + 15, 2);
  ctx.restore();
  // bulbs always clear the subtitle line
  if (bulbY != null) drawBulbs(ctx, W / 2 - 170, Math.max(bulbY, y + 27), 340, 16);
}

// marquee bulbs (static: alternating lit)
function drawBulbs(ctx, x, y, w, n) {
  for (let i = 0; i < n; i++) {
    const bx = x + (i + 0.5) * (w / n);
    const on = i % 2 === 0;
    ctx.beginPath();
    ctx.arc(bx, y, 2.8, 0, Math.PI * 2);
    ctx.fillStyle = on ? COLORS.goldHi : "rgba(140,105,35,0.6)";
    if (on) {
      ctx.shadowColor = COLORS.goldHi;
      ctx.shadowBlur = 8;
    }
    ctx.fill();
    ctx.shadowBlur = 0;
  }
}

// verdict plaque: gold metal medallion (win) / lacquer plate (lose)
// kind: jackpot | win | lose | push | neutral
function drawVerdict(ctx, W, cy, text, kind) {
  ctx.save();
  ctx.font = "bold 24px Cinzel";
  let size = 24;
  let tw = ctx.measureText(text).width;
  while (tw > W - 170 && size > 15) {
    size -= 1;
    ctx.font = `bold ${size}px Cinzel`;
    tw = ctx.measureText(text).width;
  }

  const pw = Math.max(tw + 76, 210), ph = 50;
  const px = W / 2 - pw / 2, py = cy - ph / 2;
  const isWin = kind === "jackpot" || kind === "win";

  // drop shadow
  ctx.save();
  ctx.shadowColor = "rgba(0,0,0,0.7)";
  ctx.shadowBlur = 16;
  ctx.shadowOffsetY = 5;
  ctx.fillStyle = isWin ? COLORS.goldDeep : kind === "lose" ? "#1c090c" : "#101218";
  roundRect(ctx, px, py, pw, ph, ph / 2);
  ctx.fill();
  ctx.restore();

  // plate face
  if (isWin) {
    ctx.fillStyle = goldGrad(ctx, px, py, px, py + ph);
    roundRect(ctx, px, py, pw, ph, ph / 2);
    ctx.fill();
    // brushed sheen
    ctx.save();
    roundRect(ctx, px, py, pw, ph, ph / 2);
    ctx.clip();
    const sheen = ctx.createLinearGradient(0, py, 0, py + ph);
    sheen.addColorStop(0, "rgba(255,255,255,0.42)");
    sheen.addColorStop(0.45, "rgba(255,255,255,0.05)");
    sheen.addColorStop(0.55, "rgba(0,0,0,0.08)");
    sheen.addColorStop(1, "rgba(90,60,5,0.25)");
    ctx.fillStyle = sheen;
    ctx.fillRect(px, py, pw, ph);
    ctx.restore();
    ctx.strokeStyle = "#7a5a10";
    ctx.lineWidth = 1.6;
    roundRect(ctx, px + 1, py + 1, pw - 2, ph - 2, ph / 2 - 1);
    ctx.stroke();
  } else {
    ctx.fillStyle = kind === "lose" ? "rgba(26,9,12,0.92)" : "rgba(12,14,20,0.92)";
    roundRect(ctx, px, py, pw, ph, ph / 2);
    ctx.fill();
    const bG = ctx.createLinearGradient(px, py, px + pw, py + ph);
    if (kind === "lose") {
      bG.addColorStop(0, "#7e1120"); bG.addColorStop(0.5, COLORS.red); bG.addColorStop(1, "#7e1120");
    } else {
      bG.addColorStop(0, "#3a404d"); bG.addColorStop(0.5, "#9aa3b2"); bG.addColorStop(1, "#3a404d");
    }
    ctx.strokeStyle = bG;
    ctx.lineWidth = 2;
    roundRect(ctx, px + 1, py + 1, pw - 2, ph - 2, ph / 2 - 1);
    ctx.stroke();
  }

  // end gems
  for (const gx of [px + 20, px + pw - 20]) {
    ctx.save();
    ctx.translate(gx, cy);
    ctx.rotate(Math.PI / 4);
    const gemC = isWin ? "#8e1f2f" : kind === "lose" ? COLORS.red : "#9aa3b2";
    ctx.fillStyle = gemC;
    ctx.shadowColor = gemC;
    ctx.shadowBlur = 7;
    roundRect(ctx, -4, -4, 8, 8, 2);
    ctx.fill();
    ctx.restore();
  }

  // engraved text
  const textFill = isWin ? "#231a05" : kind === "lose" ? "#ffc9c2" : "#dfe3ea";
  const glow = isWin ? "rgba(255,233,168,0.5)" : kind === "lose" ? "rgba(224,69,90,0.5)" : "rgba(200,210,225,0.35)";
  ctx.font = `bold ${size}px Cinzel`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.shadowColor = glow;
  ctx.shadowBlur = isWin ? 4 : 8;
  ctx.fillStyle = textFill;
  ctx.fillText(text, W / 2, cy + 1);
  ctx.shadowBlur = 0;
  ctx.fillText(text, W / 2, cy + 1);
  ctx.restore();
}

// ── Vector symbol library ────────────────────────────────────
function drawCherry(ctx, x, y, s) {
  ctx.save();
  ctx.translate(x, y);
  ctx.lineCap = "round";
  ctx.strokeStyle = "#3e7d3a";
  ctx.lineWidth = s * 0.09;
  ctx.beginPath();
  ctx.moveTo(-s * 0.22, s * 0.18);
  ctx.quadraticCurveTo(-s * 0.05, -s * 0.5, s * 0.2, -s * 0.62);
  ctx.moveTo(s * 0.28, s * 0.1);
  ctx.quadraticCurveTo(s * 0.22, -s * 0.3, s * 0.2, -s * 0.62);
  ctx.stroke();
  ctx.fillStyle = "#4f9e47";
  ctx.beginPath();
  ctx.ellipse(s * 0.38, -s * 0.6, s * 0.22, s * 0.1, -0.5, 0, Math.PI * 2);
  ctx.fill();
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

function drawCoinIcon(ctx, x, y, s) {
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
  ctx.shadowBlur = 10;
  ctx.shadowOffsetY = 4;
  ctx.fillStyle = faceDown ? "#101522" : "#f7f5ef";
  roundRect(ctx, -w / 2, -h / 2, w, h, w * 0.09);
  ctx.fill();
  ctx.shadowBlur = 0;
  ctx.shadowOffsetY = 0;
  ctx.strokeStyle = "rgba(0,0,0,0.35)";
  ctx.lineWidth = 1.2;
  roundRect(ctx, -w / 2, -h / 2, w, h, w * 0.09);
  ctx.stroke();

  if (faceDown) {
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
    const suitKey = { "♠️": "spade", "♥️": "heart", "♦️": "diamond", "♣️": "club" }[suit] || suit || "spade";
    ctx.fillStyle = col;
    ctx.textAlign = "center";
    ctx.textBaseline = "alphabetic";
    ctx.font = `bold ${w * 0.28}px Oswald`;
    ctx.fillText(rank, -w * 0.3, -h * 0.24);
    drawSuit(ctx, suitKey, -w * 0.3, h * 0.02, w * 0.17, col);
    drawSuit(ctx, suitKey, 0, h * 0.07, w * 0.46, col);
  }
  ctx.restore();
}

// die with pips
function drawDie(ctx, x, y, size, value, rot = 0, glow = null) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(rot);
  const r = size * 0.2;
  ctx.shadowColor = glow || "rgba(0,0,0,0.5)";
  ctx.shadowBlur = glow ? 18 : 9;
  ctx.shadowOffsetY = 4;
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
  ctx.strokeStyle = "rgba(245,197,66,0.5)";
  ctx.lineWidth = 1.2;
  roundRect(ctx, -size / 2 + 5, -size / 2 + 5, size - 10, size - 10, r - 3);
  ctx.stroke();
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

// ── Slot symbol normalization (THE empty-window fix) ─────────
// gamble.js rolls emoji (["🍒","💎","7️⃣",...]); the vector library needs
// names. Map emoji → name; unknown tokens fall back to a STABLE hash pick
// so a reel window can never render blank again.
const SLOT_SYMBOLS = ["cherry", "gem", "seven", "bell", "clover", "crown"];
const EMOJI_SYMBOL_MAP = [
  { re: /🍒/, name: "cherry" },
  { re: /💎/, name: "gem" },
  { re: /7/, name: "seven" },          // covers 7️⃣ (7 + VS16 + keycap)
  { re: /🔔/, name: "bell" },
  { re: /🍀|☘/, name: "clover" },
  { re: /👑/, name: "crown" },
];

function normalizeSlotSymbol(sym) {
  const str = String(sym || "");
  for (const { re, name } of EMOJI_SYMBOL_MAP) {
    if (re.test(str)) return name;
  }
  if (SLOT_SYMBOLS.includes(str)) return str;   // already a name
  // stable fallback: never blank, deterministic per token
  let h = 0;
  for (const ch of str) h = (h * 31 + ch.codePointAt(0)) >>> 0;
  return SLOT_SYMBOLS[h % SLOT_SYMBOLS.length];
}

function drawSlotSymbol(ctx, name, x, y, s) {
  switch (name) {
    case "cherry": return drawCherry(ctx, x, y, s);
    case "gem": return drawGem(ctx, x, y, s);
    case "seven": return drawSeven(ctx, x, y, s);
    case "bell": return drawBell(ctx, x, y, s);
    case "clover": return drawClover(ctx, x, y, s);
    case "crown": return drawCrown(ctx, x, y, s);
    case "coin": return drawCoinIcon(ctx, x, y, s);
    case "star": return drawStar(ctx, x, y, s);
    default: return drawGem(ctx, x, y, s);
  }
}

// static confetti burst (frozen mid-air — celebratory without motion)
function drawConfettiStatic(ctx, W, H, n = 34) {
  ctx.save();
  const colors = [COLORS.gold, COLORS.goldHi, COLORS.red, "#5bc8f5", COLORS.green];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2 + (i % 3);
    const dist = 60 + ((i * 53) % 190);
    const x = W / 2 + Math.cos(a) * dist * 1.35;
    const y = H * 0.42 + Math.sin(a) * dist * 0.62;
    if (y > H - 62) continue;
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(a + (i % 5));
    ctx.globalAlpha = 0.85;
    ctx.fillStyle = colors[i % colors.length];
    const sz = 3 + (i % 3);
    ctx.fillRect(-sz / 2, -sz / 4, sz, sz / 2);
    ctx.restore();
  }
  ctx.restore();
}

// sparkle stars (win flourish)
function drawSparkles(ctx, cx, cy, spread, n = 8, color = COLORS.goldHi) {
  ctx.save();
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2 + 0.4;
    const d = spread * (0.55 + ((i * 37) % 45) / 100);
    drawStar(ctx, cx + Math.cos(a) * d, cy + Math.sin(a) * d * 0.8, 8 + (i % 3) * 3, color);
  }
  ctx.restore();
}
// ═══════════════════════════════════════════════════════════════
// CANVAS SIZE — single result frame, 640×400
// ═══════════════════════════════════════════════════════════════
const W = 640, H = 400;
const PLAQUE_Y = 362;

function newFrame() {
  return createCanvas(W, H).getContext("2d");
}

function toPng(ctx) {
  return ctx.canvas.toBuffer("image/png");
}

// ═══════════════════════════════════════════════════════════════
// SCENE: SLOTS — landed symbols in the windows (never blank)
// ═══════════════════════════════════════════════════════════════
async function renderSlots(reels, multiplier) {
  if (!isReady()) return null;

  const syms = (reels || []).map(normalizeSlotSymbol);
  const cacheKey = `slots|${syms.join(",")}|${multiplier}`;
  const cached = readCache(cacheKey);
  if (cached) return cached;

  const ctx = newFrame();
  const jackpot = multiplier >= 10;
  const win = multiplier > 0;

  // jackpot rays behind cabinet
  if (jackpot) {
    ctx.save();
    ctx.translate(W / 2, H * 0.44);
    ctx.globalAlpha = 0.13;
    ctx.fillStyle = COLORS.gold;
    for (let i = 0; i < 12; i++) {
      ctx.rotate((Math.PI * 2) / 12);
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.lineTo(W, -40);
      ctx.lineTo(W, 40);
      ctx.fill();
    }
    ctx.restore();
  }

  drawNoir(ctx, W, H);

  // which windows are part of the winning match
  const winIdx = [false, false, false];
  if (jackpot) {
    winIdx[0] = winIdx[1] = winIdx[2] = true;
  } else if (multiplier === 2) {
    if (syms[0] === syms[1]) winIdx[0] = winIdx[1] = true;
    if (syms[1] === syms[2]) winIdx[1] = winIdx[2] = true;
    if (syms[0] === syms[2]) winIdx[0] = winIdx[2] = true;
  }

  // cabinet
  const mx = 88, my = 34, mw = W - 176, mh = 298;
  ctx.save();
  ctx.shadowColor = "rgba(0,0,0,0.65)";
  ctx.shadowBlur = 22;
  ctx.shadowOffsetY = 8;
  const cab = ctx.createLinearGradient(mx, my, mx + mw, my + mh);
  cab.addColorStop(0, "#1c2029");
  cab.addColorStop(0.5, "#12151d");
  cab.addColorStop(1, "#0b0d13");
  ctx.fillStyle = cab;
  roundRect(ctx, mx, my, mw, mh, 18);
  ctx.fill();
  ctx.restore();
  ctx.strokeStyle = goldGrad(ctx, mx, my, mx + mw, my + mh);
  ctx.lineWidth = 3;
  roundRect(ctx, mx, my, mw, mh, 18);
  ctx.stroke();

  // corner screws
  for (const [sx, sy] of [[mx + 16, my + 16], [mx + mw - 16, my + 16], [mx + 16, my + mh - 16], [mx + mw - 16, my + mh - 16]]) {
    ctx.beginPath();
    ctx.arc(sx, sy, 3, 0, Math.PI * 2);
    ctx.fillStyle = "rgba(245,197,66,0.4)";
    ctx.fill();
  }

  drawTitle(ctx, W, my + 42, "TOPBOY SLOTS", my + 58);

  // reel windows with the LANDED symbols
  const winW = 118, winH = 138, winY = 116, gap = 16;
  const startX = mx + (mw - (winW * 3 + gap * 2)) / 2;
  const payY = winY + winH / 2;

  for (let r = 0; r < 3; r++) {
    const wx = startX + r * (winW + gap);

    // well
    ctx.fillStyle = "#04050a";
    roundRect(ctx, wx - 5, winY - 5, winW + 10, winH + 10, 12);
    ctx.fill();

    // symbol (the actual result — always visible)
    ctx.save();
    roundRect(ctx, wx, winY, winW, winH, 9);
    ctx.clip();
    const cellG = ctx.createLinearGradient(0, winY, 0, winY + winH);
    cellG.addColorStop(0, "#0b0e16");
    cellG.addColorStop(1, "#05070c");
    ctx.fillStyle = cellG;
    ctx.fillRect(wx, winY, winW, winH);
    drawSlotSymbol(ctx, syms[r], wx + winW / 2, winY + winH / 2, 84);
    // glass sheen
    const sheen = ctx.createLinearGradient(0, winY, 0, winY + winH);
    sheen.addColorStop(0, "rgba(255,255,255,0.11)");
    sheen.addColorStop(0.5, "rgba(255,255,255,0)");
    sheen.addColorStop(1, "rgba(255,255,255,0.05)");
    ctx.fillStyle = sheen;
    ctx.fillRect(wx, winY, winW, winH);
    ctx.restore();

    // bezel — glowing gold on winners, quiet on the rest
    if (win && winIdx[r]) {
      ctx.save();
      ctx.shadowColor = COLORS.gold;
      ctx.shadowBlur = 14;
      ctx.strokeStyle = COLORS.goldHi;
      ctx.lineWidth = 3.2;
      roundRect(ctx, wx - 5, winY - 5, winW + 10, winH + 10, 12);
      ctx.stroke();
      ctx.restore();
    } else {
      ctx.strokeStyle = "rgba(245,197,66,0.4)";
      ctx.lineWidth = 1.6;
      roundRect(ctx, wx - 5, winY - 5, winW + 10, winH + 10, 12);
      ctx.stroke();
    }
  }

  // payline
  ctx.save();
  if (win) {
    ctx.strokeStyle = goldGrad(ctx, startX - 18, payY, startX + winW * 3 + gap * 2 + 18, payY);
    ctx.lineWidth = 2.6;
    ctx.shadowColor = COLORS.gold;
    ctx.shadowBlur = 12;
  } else {
    ctx.strokeStyle = "rgba(245,197,66,0.3)";
    ctx.lineWidth = 1.4;
  }
  ctx.beginPath();
  ctx.moveTo(startX - 18, payY);
  ctx.lineTo(startX + winW * 3 + gap * 2 + 18, payY);
  ctx.stroke();
  ctx.restore();

  // side lever gem
  ctx.save();
  ctx.translate(mx - 17, my + mh / 2);
  ctx.rotate(Math.PI / 4);
  ctx.fillStyle = win ? COLORS.gold : COLORS.redDeep;
  ctx.shadowColor = win ? COLORS.gold : COLORS.red;
  ctx.shadowBlur = 10;
  roundRect(ctx, -6, -6, 12, 12, 3);
  ctx.fill();
  ctx.restore();

  // celebration
  if (jackpot) {
    drawConfettiStatic(ctx, W, H - 40, 40);
    drawSparkles(ctx, W / 2, my + 4, 130, 9);
  }

  // verdict
  if (jackpot) drawVerdict(ctx, W, PLAQUE_Y, "JACKPOT ×10", "jackpot");
  else if (multiplier === 2) drawVerdict(ctx, W, PLAQUE_Y, "WIN ×2", "win");
  else drawVerdict(ctx, W, PLAQUE_Y, "NO MATCH", "lose");

  const png = toPng(ctx);
  writeCache(cacheKey, png);
  return png;
}

// ═══════════════════════════════════════════════════════════════
// SCENE: FORTUNE WHEEL — winning wedge under the pointer, labels upright
// ═══════════════════════════════════════════════════════════════
async function renderCasino(win) {
  if (!isReady()) return null;

  const cacheKey = `casino|${win}`;
  const cached = readCache(cacheKey);
  if (cached) return cached;

  const ctx = newFrame();

  // halo behind the wheel
  const cx = W / 2, cy = 216, R = 114;
  const halo = ctx.createRadialGradient(cx, cy, R * 0.6, cx, cy, R * 1.3);
  halo.addColorStop(0, win ? "rgba(245,197,66,0.30)" : "rgba(224,69,90,0.20)");
  halo.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = halo;
  ctx.fillRect(0, 0, W, H);

  drawNoir(ctx, W, H);

  drawTitle(ctx, W, 30, "TOPBOY WHEEL");

  const SEGS = 12;
  const segSize = (Math.PI * 2) / SEGS;
  const icons = ["coin", "gem", "seven", "star", "crown", "cherry", "bell", "clover"];
  const isGold = (s) => s % 3 === 0;
  // final resting rotation: winning wedge centered under the top pointer
  const finalSeg = win ? 0 : 1;
  const wheelAngle = -(finalSeg + 0.5) * segSize;

  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(wheelAngle);

  let iconIdx = 0;
  for (let s = 0; s < SEGS; s++) {
    const a0 = s * segSize, a1 = (s + 1) * segSize;

    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.arc(0, 0, R - 14, a0, a1);
    ctx.closePath();
    if (isGold(s)) {
      ctx.fillStyle = goldGrad(ctx, 0, 0, R, R);
    } else {
      ctx.fillStyle = s % 2 ? "#181c26" : "#10131a";
    }
    ctx.fill();
    ctx.strokeStyle = "rgba(0,0,0,0.7)";
    ctx.lineWidth = 1.8;
    ctx.stroke();

    if (isGold(s)) {
      // ×2 badge — drawn upright at the wedge's midpoint (no rotation)
      const mid = (a0 + a1) / 2;
      const ir = R - 36;
      const tx = Math.cos(mid) * ir, ty = Math.sin(mid) * ir;
      ctx.save();
      ctx.fillStyle = "#231a05";
      ctx.font = "bold 17px Oswald";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText("×2", tx, ty);
      ctx.restore();
    } else {
      const mid = (a0 + a1) / 2;
      const ir = R - 38;
      drawSlotSymbol(ctx, icons[iconIdx++ % icons.length], Math.cos(mid) * ir, Math.sin(mid) * ir, 30);
    }
  }

  // winning wedge highlight
  const wa0 = finalSeg * segSize, wa1 = wa0 + segSize;
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.arc(0, 0, R - 14, wa0, wa1);
  ctx.closePath();
  ctx.fillStyle = win ? "rgba(255,233,168,0.30)" : "rgba(224,69,90,0.30)";
  ctx.fill();

  // gold rim + pegs
  ctx.lineWidth = 13;
  ctx.strokeStyle = goldGrad(ctx, -R, -R, R, R);
  ctx.beginPath();
  ctx.arc(0, 0, R - 7, 0, Math.PI * 2);
  ctx.stroke();
  for (let s = 0; s < SEGS; s++) {
    const a = s * segSize;
    ctx.beginPath();
    ctx.arc(Math.cos(a) * (R - 7), Math.sin(a) * (R - 7), 3.2, 0, Math.PI * 2);
    ctx.fillStyle = COLORS.goldHi;
    ctx.fill();
  }
  ctx.restore();

  // hub medallion
  const hub = ctx.createRadialGradient(cx - 6, cy - 6, 2, cx, cy, 24);
  hub.addColorStop(0, COLORS.goldHi);
  hub.addColorStop(0.6, COLORS.gold);
  hub.addColorStop(1, COLORS.goldDeep);
  ctx.beginPath();
  ctx.arc(cx, cy, 22, 0, Math.PI * 2);
  ctx.fillStyle = hub;
  ctx.shadowColor = "rgba(245,197,66,0.75)";
  ctx.shadowBlur = 16;
  ctx.fill();
  ctx.shadowBlur = 0;
  ctx.fillStyle = "#1a1206";
  ctx.font = "bold 20px Cinzel";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText("T", cx, cy + 1);

  // pointer (gem-tipped)
  ctx.save();
  ctx.translate(cx, cy - R - 4);
  ctx.beginPath();
  ctx.moveTo(0, 20);
  ctx.lineTo(-11, -8);
  ctx.lineTo(11, -8);
  ctx.closePath();
  ctx.fillStyle = goldGrad(ctx, -11, -8, 11, 20);
  ctx.fill();
  ctx.strokeStyle = "#7a5a10";
  ctx.lineWidth = 1.2;
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(0, -8, 5, 0, Math.PI * 2);
  ctx.fillStyle = win ? COLORS.red : "#5bc8f5";
  ctx.shadowColor = win ? COLORS.red : "#5bc8f5";
  ctx.shadowBlur = 8;
  ctx.fill();
  ctx.restore();

  // plinth
  ctx.fillStyle = "rgba(0,0,0,0.55)";
  roundRect(ctx, cx - 40, cy + R + 6, 80, 11, 5);
  ctx.fill();

  if (win) {
    drawConfettiStatic(ctx, W, H - 40, 30);
    drawSparkles(ctx, cx, cy, R + 26, 8);
  }

  drawVerdict(ctx, W, PLAQUE_Y, win ? "WIN ×2" : "HOUSE WINS", win ? "win" : "lose");

  const png = toPng(ctx);
  writeCache(cacheKey, png);
  return png;
}

// ═══════════════════════════════════════════════════════════════
// SCENE: ROULETTE — ball resting in the winning pocket, result chip
// ═══════════════════════════════════════════════════════════════
const EURO_ORDER = [0,32,15,19,4,21,2,25,17,34,6,27,13,36,11,30,8,23,10,5,24,16,33,1,20,14,31,9,22,18,29,7,28,12,35,3,26];
const RED_SET = new Set([1,3,5,7,9,12,14,16,18,19,21,23,25,27,30,32,34,36]);

async function renderRoulette(number, color, multiplier) {
  if (!isReady()) return null;

  const cacheKey = `roulette|${number}|${color}|${multiplier}`;
  const cached = readCache(cacheKey);
  if (cached) return cached;

  const ctx = newFrame();
  const cx = 300, cy = 206, rimR = 128, trackR = 112, pocketR = 88, hubR = 60;
  const SEGS = EURO_ORDER.length;
  const segSize = (Math.PI * 2) / SEGS;
  const pocketIdx = EURO_ORDER.indexOf(number);
  const pocketAngle = -Math.PI / 2 + (pocketIdx + 0.5) * segSize;
  const win = multiplier > 0;

  // halo
  const halo = ctx.createRadialGradient(cx, cy, rimR * 0.7, cx, cy, rimR * 1.3);
  halo.addColorStop(0, win ? "rgba(245,197,66,0.22)" : "rgba(224,69,90,0.15)");
  halo.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = halo;
  ctx.fillRect(0, 0, W, H);

  drawNoir(ctx, W, H);

  drawTitle(ctx, W, 30, "TOPBOY ROULETTE");

  // wheel body
  ctx.save();
  ctx.translate(cx, cy);

  // ball track
  ctx.beginPath();
  ctx.arc(0, 0, trackR + 4, 0, Math.PI * 2);
  ctx.arc(0, 0, pocketR + 10, 0, Math.PI * 2, true);
  ctx.fillStyle = "#0b0d12";
  ctx.fill();

  // pockets + outward-readable numbers
  for (let s = 0; s < SEGS; s++) {
    const num = EURO_ORDER[s];
    const a0 = -Math.PI / 2 + s * segSize, a1 = a0 + segSize;
    const segColor = num === 0 ? "#1f7a3a" : RED_SET.has(num) ? COLORS.redDeep : "#14161d";

    ctx.beginPath();
    ctx.arc(0, 0, pocketR + 10, a0, a1);
    ctx.arc(0, 0, hubR, a1, a0, true);
    ctx.closePath();
    ctx.fillStyle = segColor;
    ctx.fill();
    ctx.strokeStyle = "rgba(245,197,66,0.28)";
    ctx.lineWidth = 1;
    ctx.stroke();

    const mid = (a0 + a1) / 2;
    const nx = Math.cos(mid) * (pocketR - 12), ny = Math.sin(mid) * (pocketR - 12);
    ctx.save();
    ctx.translate(nx, ny);
    ctx.rotate(mid + Math.PI / 2);   // upright at top, outward around the wheel
    ctx.fillStyle = "#f2efe6";
    ctx.font = "bold 9.5px Oswald";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(String(num), 0, 0);
    ctx.restore();
  }

  // winning pocket glow
  const wa0 = -Math.PI / 2 + pocketIdx * segSize, wa1 = wa0 + segSize;
  ctx.beginPath();
  ctx.arc(0, 0, pocketR + 10, wa0, wa1);
  ctx.arc(0, 0, hubR, wa1, wa0, true);
  ctx.closePath();
  ctx.fillStyle = win ? "rgba(245,197,66,0.42)" : "rgba(224,69,90,0.32)";
  ctx.fill();

  // inner cone + spokes + hub
  const cone = ctx.createRadialGradient(0, 0, 4, 0, 0, hubR);
  cone.addColorStop(0, "#232833");
  cone.addColorStop(1, "#0d0f15");
  ctx.beginPath();
  ctx.arc(0, 0, hubR, 0, Math.PI * 2);
  ctx.fillStyle = cone;
  ctx.fill();
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
  ctx.arc(0, 0, 12, 0, Math.PI * 2);
  ctx.fillStyle = goldGrad(ctx, -12, -12, 12, 12);
  ctx.fill();

  // gold rim + deflectors
  ctx.lineWidth = 14;
  ctx.strokeStyle = goldGrad(ctx, -rimR, -rimR, rimR, rimR);
  ctx.beginPath();
  ctx.arc(0, 0, rimR - 7, 0, Math.PI * 2);
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

  // winner arc highlight on the rim
  ctx.beginPath();
  ctx.arc(0, 0, rimR - 7, wa0, wa1);
  ctx.strokeStyle = win ? COLORS.goldHi : COLORS.red;
  ctx.lineWidth = 4;
  ctx.shadowColor = win ? COLORS.gold : COLORS.red;
  ctx.shadowBlur = 12;
  ctx.stroke();
  ctx.shadowBlur = 0;
  ctx.restore();

  // ball resting in the winning pocket
  const bx = cx + Math.cos(pocketAngle) * 74;
  const by = cy + Math.sin(pocketAngle) * 74;
  ctx.save();
  ctx.beginPath();
  ctx.arc(bx, by, 9, 0, Math.PI * 2);
  ctx.fillStyle = "rgba(0,0,0,0.5)";   // contrast ring so the ball pops
  ctx.fill();
  ctx.shadowColor = "rgba(255,255,255,0.95)";
  ctx.shadowBlur = 14;
  ctx.beginPath();
  ctx.arc(bx, by, 6.5, 0, Math.PI * 2);
  ctx.fillStyle = "#f4f2ec";
  ctx.fill();
  ctx.restore();

  // result chip (top-right)
  const chipX = 556, chipY = 84, chipR = 40;
  const chipCol = number === 0 ? "#1f7a3a" : RED_SET.has(number) ? COLORS.redDeep : "#14161d";
  ctx.save();
  ctx.shadowColor = "rgba(0,0,0,0.6)";
  ctx.shadowBlur = 14;
  ctx.shadowOffsetY = 5;
  ctx.beginPath();
  ctx.arc(chipX, chipY, chipR, 0, Math.PI * 2);
  ctx.fillStyle = "#f4f1e8";
  ctx.fill();
  ctx.restore();
  // chip edge dashes
  ctx.save();
  ctx.beginPath();
  ctx.arc(chipX, chipY, chipR - 3, 0, Math.PI * 2);
  ctx.clip();
  ctx.fillStyle = chipCol;
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2;
    ctx.save();
    ctx.translate(chipX + Math.cos(a) * (chipR - 3), chipY + Math.sin(a) * (chipR - 3));
    ctx.rotate(a + Math.PI / 2);
    ctx.fillRect(-5, -6, 10, 12);
    ctx.restore();
  }
  ctx.restore();
  ctx.beginPath();
  ctx.arc(chipX, chipY, chipR - 12, 0, Math.PI * 2);
  ctx.strokeStyle = chipCol;
  ctx.lineWidth = 1.6;
  ctx.stroke();
  ctx.fillStyle = chipCol;
  ctx.font = "bold 30px Cinzel";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(String(number), chipX, chipY + 2);
  ctx.fillStyle = "rgba(232,228,216,0.55)";
  ctx.font = "9px Oswald";
  drawTracked(ctx, "WINNING NUMBER", chipX, chipY + chipR + 16, 1.5);

  if (win) drawSparkles(ctx, cx, cy, rimR + 20, 8);

  const label = `${number} ${String(color).toUpperCase()}`;
  drawVerdict(ctx, W, PLAQUE_Y, win ? `${label} · WIN ×${multiplier}` : `${label} · HOUSE WINS`, win ? "win" : "lose");

  const png = toPng(ctx);
  writeCache(cacheKey, png);
  return png;
}

// ═══════════════════════════════════════════════════════════════
// SCENE: COIN FLIP — result face up on the floor
// ═══════════════════════════════════════════════════════════════
function drawBigCoin(ctx, x, y, radius, face) {
  ctx.save();
  ctx.translate(x, y);

  // edge
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
  for (let i = 0; i < 40; i++) {
    const a = (i / 40) * Math.PI * 2;
    ctx.beginPath();
    ctx.moveTo(Math.cos(a) * (faceR + 2), Math.sin(a) * (faceR + 2));
    ctx.lineTo(Math.cos(a) * (radius - 1), Math.sin(a) * (radius - 1));
    ctx.stroke();
  }

  if (face === "h") {
    ctx.fillStyle = "#231a05";
    ctx.font = `bold ${radius * 0.95}px Cinzel`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.shadowColor = "rgba(255,233,168,0.6)";
    ctx.shadowBlur = 6;
    ctx.fillText("T", 0, radius * 0.06);
    ctx.shadowBlur = 0;
    for (let i = 0; i < 5; i++) {
      const a = -Math.PI / 2 + (i / 5) * Math.PI * 2;
      drawStar(ctx, Math.cos(a) * faceR * 0.66, Math.sin(a) * faceR * 0.66, radius * 0.13, "rgba(35,26,5,0.85)");
    }
  } else {
    drawGem(ctx, 0, 0, radius * 0.92, "#e8b84b");
    ctx.strokeStyle = "rgba(35,26,5,0.7)";
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    ctx.arc(0, 0, faceR * 0.8, 0, Math.PI * 2);
    ctx.stroke();
  }
  ctx.restore();
}

async function renderCoinFlip(result, win) {
  if (!isReady()) return null;

  const cacheKey = `cf|${result}|${win}`;
  const cached = readCache(cacheKey);
  if (cached) return cached;

  const ctx = newFrame();
  drawFloorStage(ctx, W, H);

  drawTitle(ctx, W, 30, "TOPBOY COIN TOSS");

  const cx = W / 2, cy = 214, R = 84;
  const floorY = H * 0.74 + 12;

  // floor shadow
  ctx.save();
  ctx.globalAlpha = 0.45;
  ctx.fillStyle = "#000";
  ctx.beginPath();
  ctx.ellipse(cx, floorY, R * 0.92, 13, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  // landing glow ring
  ctx.save();
  ctx.strokeStyle = "rgba(245,197,66,0.55)";
  ctx.lineWidth = 2.4;
  ctx.beginPath();
  ctx.ellipse(cx, floorY, R * 1.25, 17, 0, 0, Math.PI * 2);
  ctx.stroke();
  ctx.restore();

  drawBigCoin(ctx, cx, cy, R, result === "h" ? "h" : "t");

  if (win) {
    drawSparkles(ctx, cx, cy, R + 30, 9);
    drawConfettiStatic(ctx, W, H - 40, 28);
  }

  const label = result === "h" ? "HEADS" : "TAILS";
  drawVerdict(ctx, W, PLAQUE_Y, win ? `${label} — YOU WIN` : `${label} — LOST`, win ? "win" : "lose");

  const png = toPng(ctx);
  writeCache(cacheKey, png);
  return png;
}

// ═══════════════════════════════════════════════════════════════
// SCENE: BLACKJACK — dealer zone / player zone / verdict plaque
// ═══════════════════════════════════════════════════════════════
async function renderBlackjack({ player, dealer, playerTotal, dealerTotal, outcome }) {
  if (!isReady()) return null;

  const handKey = (h) => (h || []).map((c) => `${c.rank}${c.suit}`).join(",");
  const cacheKey = `bj|${handKey(player)}|${handKey(dealer)}|${outcome}`;
  const cached = readCache(cacheKey);
  if (cached) return cached;

  const ctx = newFrame();
  drawFeltNoir(ctx, W, H);

  const CW = 58, CH = 82;
  const playerWon = outcome === "win" || outcome === "blackjack";

  const fan = (n, cy, spread) => {
    const positions = [];
    for (let i = 0; i < n; i++) {
      const off = i - (n - 1) / 2;
      positions.push({
        x: W / 2 + off * spread,
        y: cy + Math.abs(off) * 3,
        rot: off * 0.05,
      });
    }
    return positions;
  };
  const spreadFor = (n) => (n <= 1 ? 0 : Math.min(46, 250 / (n - 1)));

  // dealer zone
  glowText(ctx, `DEALER · ${dealerTotal}`, W / 2, 52, "600 15px Oswald", COLORS.cream, "rgba(0,0,0,0.85)", 4);
  const dSpread = spreadFor(dealer.length);
  fan(dealer.length, 122, dSpread).forEach((pos, i) => {
    drawPlayingCard(ctx, pos.x, pos.y, CW, CH, dealer[i].rank, dealer[i].suit, false, pos.rot);
  });

  // player zone
  const pSpread = spreadFor(player.length);
  fan(player.length, 306, pSpread).forEach((pos, i) => {
    if (playerWon) {
      ctx.save();
      ctx.shadowColor = "rgba(245,197,66,0.5)";
      ctx.shadowBlur = 14;
    }
    drawPlayingCard(ctx, pos.x, pos.y, CW, CH, player[i].rank, player[i].suit, false, pos.rot);
    if (playerWon) ctx.restore();
  });
  glowText(ctx, `PLAYER · ${playerTotal}`, W / 2, 386, "600 15px Oswald", COLORS.goldHi, "rgba(245,197,66,0.5)", 5);

  // zone rules (subtle felt marking)
  ctx.save();
  ctx.strokeStyle = "rgba(245,197,66,0.22)";
  ctx.lineWidth = 1;
  ctx.setLineDash([6, 8]);
  ctx.beginPath();
  ctx.moveTo(80, 214);
  ctx.lineTo(W - 80, 214);
  ctx.stroke();
  ctx.restore();

  // verdict plaque between zones
  const B = {
    blackjack: ["BLACKJACK · 3:2", "jackpot"],
    win: ["YOU WIN", "win"],
    bust: ["BUST", "lose"],
    lose: ["DEALER WINS", "lose"],
    push: ["PUSH · REFUND", "push"],
  }[outcome] || ["DEALER WINS", "lose"];
  drawVerdict(ctx, W, 216, B[0], B[1]);

  const png = toPng(ctx);
  writeCache(cacheKey, png);
  return png;
}

// ═══════════════════════════════════════════════════════════════
// SCENE: DICE — settled dice, result face up
// ═══════════════════════════════════════════════════════════════
async function renderDice(roll) {
  if (!isReady()) return null;

  const cacheKey = `dice1|${roll}`;
  const cached = readCache(cacheKey);
  if (cached) return cached;

  const ctx = newFrame();
  drawNoir(ctx, W, H);

  drawTitle(ctx, W, 40, "TOPBOY DICE", 56);

  // dice tray
  const tx = 190, ty = 88, tw = W - 380, th = 200;
  ctx.fillStyle = "rgba(8,10,16,0.55)";
  roundRect(ctx, tx, ty, tw, th, 20);
  ctx.fill();
  ctx.strokeStyle = goldGrad(ctx, tx, ty, tx + tw, ty + th);
  ctx.lineWidth = 2;
  roundRect(ctx, tx + 1, ty + 1, tw - 2, th - 2, 20);
  ctx.stroke();

  const dieSize = 106, dieY = ty + th / 2 - 6;
  // felt shadow
  ctx.save();
  ctx.globalAlpha = 0.4;
  ctx.fillStyle = "#000";
  ctx.beginPath();
  ctx.ellipse(W / 2, dieY + dieSize / 2 + 10, dieSize * 0.44, 9, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  drawDie(ctx, W / 2, dieY, dieSize, roll, 0, COLORS.gold);
  drawSparkles(ctx, W / 2, dieY, dieSize * 0.95, 7);

  drawVerdict(ctx, W, PLAQUE_Y, `ROLLED ${roll}`, "win");

  const png = toPng(ctx);
  writeCache(cacheKey, png);
  return png;
}

async function renderDiceDuel(r1, r2, outcome) {
  if (!isReady()) return null;

  const cacheKey = `dice2|${r1}|${r2}|${outcome}`;
  const cached = readCache(cacheKey);
  if (cached) return cached;

  const ctx = newFrame();
  drawNoir(ctx, W, H);

  drawTitle(ctx, W, 40, "TOPBOY DICE DUEL", 56);

  // tray
  const tx = 100, ty = 88, tw = W - 200, th = 200;
  ctx.fillStyle = "rgba(8,10,16,0.55)";
  roundRect(ctx, tx, ty, tw, th, 20);
  ctx.fill();
  ctx.strokeStyle = goldGrad(ctx, tx, ty, tx + tw, ty + th);
  ctx.lineWidth = 2;
  roundRect(ctx, tx + 1, ty + 1, tw - 2, th - 2, 20);
  ctx.stroke();

  const dieSize = 88, dieY = ty + th / 2 - 6;
  const lx = W / 2 - 105, rx = W / 2 + 105;

  // divider
  ctx.save();
  ctx.strokeStyle = "rgba(245,197,66,0.3)";
  ctx.lineWidth = 1.2;
  ctx.setLineDash([5, 7]);
  ctx.beginPath();
  ctx.moveTo(W / 2, ty + 18);
  ctx.lineTo(W / 2, ty + th - 18);
  ctx.stroke();
  ctx.restore();
  drawGem(ctx, W / 2, dieY, 26);

  for (const [vx, val, glow] of [
    [lx, r1, outcome === "p1"],
    [rx, r2, outcome === "p2"],
  ]) {
    ctx.save();
    ctx.globalAlpha = 0.4;
    ctx.fillStyle = "#000";
    ctx.beginPath();
    ctx.ellipse(vx, dieY + dieSize / 2 + 10, dieSize * 0.44, 9, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    drawDie(ctx, vx, dieY, dieSize, val, 0, glow ? COLORS.gold : null);
    if (glow) drawSparkles(ctx, vx, dieY, dieSize * 0.9, 6);
  }

  const label = (t, x) => {
    ctx.fillStyle = "rgba(232,228,216,0.7)";
    ctx.font = "12px Oswald";
    ctx.textAlign = "center";
    drawTracked(ctx, t, x, ty + th - 18, 2.5);
  };
  label("PLAYER 1", lx);
  label("PLAYER 2", rx);

  const verdict = outcome === "tie"
    ? ["TIE · REFUND", "push"]
    : outcome === "p1"
      ? ["PLAYER 1 WINS", "win"]
      : ["PLAYER 2 WINS", "win"];
  drawVerdict(ctx, W, PLAQUE_Y, verdict[0], verdict[1]);

  const png = toPng(ctx);
  writeCache(cacheKey, png);
  return png;
}

// ═══════════════════════════════════════════════════════════════
// SEND HELPER — static PNG image, caption fallback to text
// ═══════════════════════════════════════════════════════════════
async function sendResult(sock, chat, pngBuffer, caption, msg, mentions) {
  if (pngBuffer) {
    try {
      const payload = {
        image: pngBuffer,
        mimetype: "image/png",
        caption,
      };
      if (mentions && mentions.length) payload.mentions = mentions;
      await sock.sendMessage(chat, payload, { quoted: msg });
      return true;
    } catch (err) {
      console.error("[animator] image send failed, falling back to text:", err.message);
    }
  }
  await sock.sendMessage(chat, { text: caption, ...(mentions && mentions.length ? { mentions } : {}) }, { quoted: msg });
  await new Promise((r) => setTimeout(r, 1200));
  return false;
}

module.exports = {
  isReady,
  renderSlots,
  renderCasino,
  renderRoulette,
  renderCoinFlip,
  renderBlackjack,
  renderDice,
  renderDiceDuel,
  sendResult,
  COLORS,
};
