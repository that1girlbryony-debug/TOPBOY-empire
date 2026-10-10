/**
 * 🎴 Card Renderer v3 — Anime TCG Card Engine
 *
 * OWNER DIRECTIVE (Task 15):
 *   - Cards must look like REAL anime TCG cards: strictly image,
 *     NO text on the card. Name / tier / worth live in the WhatsApp
 *     caption only.
 *   - Full-bleed art on a blurred self-backdrop (no empty margins),
 *     tier-colored metallic frame with inner hairline, glowing
 *     legendary borders, corner rarity gems.
 *   - Kills on-demand lag: every render is cached to disk keyed by
 *     (image URL + tier + version). First render of a card is fast;
 *     every later view/spawn is instant. Source image downloads are
 *     disk-cached too, so repeat renders never touch the network.
 *
 * Public API:
 *   generateCardImage(card)   → premium static PNG buffer (fast, cached)
 *                               — for .view / .col detail viewing
 *   generateAnimatedCard(card)→ animated MP4 reveal (cached)
 *                               — for drops / .airdrop
 *   warmCardCache(card)       → fire-and-forget static pre-render
 *   renderCardText(card)      → caption text (unchanged)
 *   isReady()                 → canvas + encoder + ffmpeg present
 */

const fs = require("fs");
const path = require("path");
const os = require("os");
const crypto = require("crypto");
const axios = require("axios");
const { formatMoney } = require("./helpers");

// ── Dependency detection ─────────────────────────────────────
let canvasAvailable = false;
let createCanvas = null;
let loadImage = null;
let GIFEncoder = null;
let ffmpegPath = null;

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
  const p = require("ffmpeg-static");
  if (p && fs.existsSync(p)) ffmpegPath = p;
} catch {}

const isReady = () => canvasAvailable && GIFEncoder && !!ffmpegPath;

// ── Tier design system ────────────────────────────────────────
// primary  = frame / gem / glow color
// secondary= gradient partner for the frame ring
// gradient = card body (visible behind the blurred backdrop edges)
const TIER_DESIGN = {
  Common: {
    name: "Common", emoji: "⚪",
    primary: "#9aa4b0", secondary: "#5b6470",
    bg: "#0d1117", glow: "rgba(154, 164, 176, 0.45)",
    gradient: ["#23282f", "#10141a"],
    particles: false, shimmer: false, ring: false,
  },
  Rare: {
    name: "Rare", emoji: "🔵",
    primary: "#3fa7e8", secondary: "#1a5276",
    bg: "#0a1622", glow: "rgba(63, 167, 232, 0.55)",
    gradient: ["#12324e", "#0a1520"],
    particles: false, shimmer: false, ring: false,
  },
  Epic: {
    name: "Epic", emoji: "🟣",
    primary: "#a55eea", secondary: "#5b2c6f",
    bg: "#120a16", glow: "rgba(165, 94, 234, 0.6)",
    gradient: ["#2e1745", "#170a26"],
    particles: true, shimmer: false, ring: false,
  },
  Legendary: {
    name: "Legendary", emoji: "🟡",
    primary: "#f5b324", secondary: "#b7791f",
    bg: "#110d04", glow: "rgba(245, 179, 36, 0.7)",
    gradient: ["#4a3711", "#241a06"],
    particles: true, shimmer: true, ring: true,
  },
  Mythic: {
    name: "Mythic", emoji: "🔴",
    primary: "#ff5b4f", secondary: "#922b21",
    bg: "#140404", glow: "rgba(255, 91, 79, 0.75)",
    gradient: ["#4d1512", "#260808"],
    particles: true, shimmer: true, ring: true,
  },
};

const TIER_EMOJI = {
  Common: "⚪", Rare: "🔵", Epic: "🟣", Legendary: "🟡", Mythic: "🔴"
};

// ── Cache layer (disk + memory) ───────────────────────────────
const CACHE_DIR = path.join(os.tmpdir(), "topboy-cards");
try { fs.mkdirSync(CACHE_DIR, { recursive: true }); } catch {}

const memCache = new Map(); // cacheKey → Buffer (bounded)
const MEM_MAX = 60;

const sha1 = (s) => crypto.createHash("sha1").update(s).digest("hex");
const RENDER_VERSION = "v3"; // bump to invalidate all caches after design changes

function cacheKey(kind, card) {
  return sha1(`${kind}|${RENDER_VERSION}|${card.tier}|${card.image}`);
}

function cachePath(kind, card) {
  return path.join(CACHE_DIR, `${kind}-${cacheKey(kind, card)}`);
}

function readCache(kind, card) {
  const key = cacheKey(kind, card);
  const mem = memCache.get(key);
  if (mem) return mem;
  const file = cachePath(kind, card);
  try {
    const buf = fs.readFileSync(file);
    if (buf.length > 1000) {
      if (memCache.size >= MEM_MAX) {
        memCache.delete(memCache.keys().next().value);
      }
      memCache.set(key, buf);
      return buf;
    }
  } catch {}
  return null;
}

function writeCache(kind, card, buffer) {
  const key = cacheKey(kind, card);
  if (memCache.size >= MEM_MAX) {
    memCache.delete(memCache.keys().next().value);
  }
  memCache.set(key, buffer);
  try { fs.writeFileSync(cachePath(kind, card), buffer); } catch {}
}

// ── Source image download (disk-cached, never twice) ──────────
async function downloadImage(url) {
  // file:// support (offline testing + local assets)
  if (String(url).startsWith("file://")) {
    try {
      const buf = fs.readFileSync(String(url).replace(/^file:\/\//, ""));
      return buf.length > 100 ? buf : null;
    } catch {
      return null;
    }
  }
  const file = path.join(CACHE_DIR, `src-${sha1(url)}`);
  try {
    const buf = fs.readFileSync(file);
    if (buf.length > 1000) return buf;
  } catch {}
  try {
    const res = await axios.get(url, {
      responseType: "arraybuffer",
      timeout: 8000,
      maxContentLength: 8 * 1024 * 1024,
      headers: { "User-Agent": "Mozilla/5.0" },
    });
    const buf = Buffer.from(res.data);
    try { fs.writeFileSync(file, buf); } catch {}
    return buf;
  } catch {
    return null;
  }
}

// ── Geometry helpers ─────────────────────────────────────────
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

function diamond(ctx, x, y, r) {
  ctx.beginPath();
  ctx.moveTo(x, y - r);
  ctx.lineTo(x + r, y);
  ctx.lineTo(x, y + r);
  ctx.lineTo(x - r, y);
  ctx.closePath();
}

// cover-fit crop: returns source rect that fills the box without distortion
function coverCrop(img, boxW, boxH) {
  const iw = img.width, ih = img.height;
  const scale = Math.max(boxW / iw, boxH / ih);
  const sw = boxW / scale, sh = boxH / scale;
  return { sx: (iw - sw) / 2, sy: (ih - sh) / 2, sw, sh };
}

// ═══════════════════════════════════════════════════════════════
// TCG CARD FRONT — strictly image, no text
// ═══════════════════════════════════════════════════════════════
/**
 * Draws the full card: ambient glow → body → metallic tier frame →
 * full-bleed art on blurred self-backdrop → vignette → sheen → gems.
 *
 * All insets are RELATIVE to W so static (480) and animated (400)
 * renders share identical proportions.
 */
function drawTcgFront(ctx, W, H, design, charImg) {
  const u = W / 480; // proportional unit
  const inset = 10 * u;              // glow margin around the card
  const cw = W - inset * 2;
  const ch = H - inset * 2;
  const r = 26 * u;
  const cx = inset, cy = inset;

  // ── 1. Ambient glow behind the card ───────────────────────
  ctx.save();
  const amb = ctx.createRadialGradient(W / 2, H / 2, cw * 0.2, W / 2, H / 2, cw * 0.75);
  amb.addColorStop(0, design.glow);
  amb.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = amb;
  ctx.fillRect(0, 0, W, H);
  ctx.restore();

  // ── 2. Card body (dark base under everything) ─────────────
  ctx.save();
  ctx.shadowColor = design.glow;
  ctx.shadowBlur = 45 * u;
  const bodyGrad = ctx.createLinearGradient(0, cy, 0, cy + ch);
  bodyGrad.addColorStop(0, design.gradient[0]);
  bodyGrad.addColorStop(1, design.gradient[1]);
  ctx.fillStyle = bodyGrad;
  roundRect(ctx, cx, cy, cw, ch, r);
  ctx.fill();
  ctx.fill(); // double-fill deepens the glow shadow
  ctx.restore();

  // ── 3. Art window: full-bleed image on blurred backdrop ───
  const artPad = 16 * u;             // art inset inside the frame
  const ax = cx + artPad, ay = cy + artPad;
  const aw = cw - artPad * 2;
  const ah = ch - artPad * 2 - 8 * u; // extra bottom for frame weight
  const ar = 16 * u;

  ctx.save();
  roundRect(ctx, ax, ay, aw, ah, ar);
  ctx.clip();

  if (charImg) {
    // 3a. Blurred self-backdrop: draw tiny then upscale (classic
    //     smoothing blur — works on every node-canvas build)
    const { sx, sy, sw, sh } = coverCrop(charImg, aw, ah);
    ctx.imageSmoothingEnabled = true;
    const mini = createCanvas(24, Math.max(12, Math.round(24 * (sh / sw))));
    const mctx = mini.getContext("2d");
    mctx.drawImage(charImg, sx, sy, sw, sh, 0, 0, mini.width, mini.height);
    ctx.drawImage(mini, ax - 4 * u, ay - 4 * u, aw + 8 * u, ah + 8 * u);
    ctx.fillStyle = "rgba(0,0,0,0.30)"; // dim the backdrop
    ctx.fillRect(ax, ay, aw, ah);

    // 3b. Full character, CONTAIN fit — never crops head/feet
    const scale = Math.min(aw / charImg.width, ah / charImg.height);
    const dw = charImg.width * scale, dh = charImg.height * scale;
    ctx.drawImage(charImg, ax + (aw - dw) / 2, ay + (ah - dh) / 2, dw, dh);
  } else {
    // Placeholder (rare: image download failed) — pure texture, no text
    ctx.fillStyle = design.gradient[0];
    ctx.fillRect(ax, ay, aw, ah);
    ctx.save();
    ctx.globalAlpha = 0.25;
    ctx.strokeStyle = design.primary;
    ctx.lineWidth = 2 * u;
    for (let gx = -ah; gx < aw; gx += 34 * u) {
      ctx.beginPath();
      ctx.moveTo(gx, ay + ah);
      ctx.lineTo(gx + ah, ay);
      ctx.stroke();
    }
    ctx.restore();
  }

  // 3c. Bottom vignette for depth (no text sits on it)
  const vin = ctx.createLinearGradient(0, ay + ah - 120 * u, 0, ay + ah);
  vin.addColorStop(0, "rgba(0,0,0,0)");
  vin.addColorStop(1, "rgba(0,0,0,0.5)");
  ctx.fillStyle = vin;
  ctx.fillRect(ax, ay + ah - 120 * u, aw, 120 * u);

  // 3d. Glass sheen across the top half
  const sheen = ctx.createLinearGradient(0, ay, 0, ay + ah * 0.55);
  sheen.addColorStop(0, "rgba(255,255,255,0.10)");
  sheen.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = sheen;
  ctx.fillRect(ax, ay, aw, ah * 0.55);

  ctx.restore(); // un-clip art window

  // ── 4. Frame system (outside → in) ────────────────────────
  // 4a. Thick metallic tier ring — the "legendary border"
  ctx.save();
  const ringGrad = ctx.createLinearGradient(cx, cy, cx + cw, cy + ch);
  ringGrad.addColorStop(0, design.primary);
  ringGrad.addColorStop(0.45, design.secondary);
  ringGrad.addColorStop(0.55, design.primary);
  ringGrad.addColorStop(1, design.secondary);
  ctx.strokeStyle = ringGrad;
  ctx.globalAlpha = design.ring ? 1 : 0.8;
  ctx.lineWidth = (design.ring ? 7 : 5) * u;
  ctx.shadowColor = design.glow;
  ctx.shadowBlur = 18 * u;
  roundRect(ctx, cx, cy, cw, ch, r);
  ctx.stroke();
  ctx.restore();

  // 4b. Outer dark bezel hairline (crisp card edge)
  ctx.save();
  ctx.strokeStyle = "rgba(0,0,0,0.9)";
  ctx.lineWidth = 2.5 * u;
  roundRect(ctx, cx + 1 * u, cy + 1 * u, cw - 2 * u, ch - 2 * u, r - 1 * u);
  ctx.stroke();
  ctx.restore();

  // 4c. Inner hairline separating frame from art
  ctx.save();
  ctx.strokeStyle = design.primary;
  ctx.globalAlpha = 0.75;
  ctx.lineWidth = 1.5 * u;
  ctx.shadowColor = design.glow;
  ctx.shadowBlur = 8 * u;
  roundRect(ctx, ax - 3 * u, ay - 3 * u, aw + 6 * u, ah + 6 * u, ar + 3 * u);
  ctx.stroke();
  ctx.restore();

  // 4d. Corner rarity gems
  const gemR = 8 * u;
  const gOff = 20 * u;
  const gemPos = [
    [cx + gOff, cy + gOff],
    [cx + cw - gOff, cy + gOff],
    [cx + gOff, cy + ch - gOff],
    [cx + cw - gOff, cy + ch - gOff],
  ];
  ctx.save();
  ctx.fillStyle = design.primary;
  ctx.shadowColor = design.glow;
  ctx.shadowBlur = 14 * u;
  for (const [gx, gy] of gemPos) {
    diamond(ctx, gx, gy, gemR);
    ctx.fill();
    ctx.strokeStyle = "rgba(255,255,255,0.55)";
    ctx.lineWidth = 1.2 * u;
    ctx.stroke();
  }
  ctx.restore();
}

// ── Card back (animated reveal only) — pattern + emblem, no text ──
function drawTcgBack(ctx, W, H, design) {
  const u = W / 480;
  const inset = 10 * u, cw = W - inset * 2, ch = H - inset * 2, r = 26 * u;

  const bodyGrad = ctx.createLinearGradient(0, inset, 0, inset + ch);
  bodyGrad.addColorStop(0, design.gradient[0]);
  bodyGrad.addColorStop(1, design.gradient[1]);
  ctx.save();
  ctx.shadowColor = design.glow;
  ctx.shadowBlur = 30 * u;
  ctx.fillStyle = bodyGrad;
  roundRect(ctx, inset, inset, cw, ch, r);
  ctx.fill();
  ctx.restore();

  // diamond lattice
  ctx.save();
  roundRect(ctx, inset, inset, cw, ch, r);
  ctx.clip();
  ctx.globalAlpha = 0.16;
  ctx.strokeStyle = design.primary;
  ctx.lineWidth = 1.5 * u;
  const step = 44 * u;
  for (let x = inset - ch; x < inset + cw + ch; x += step) {
    ctx.beginPath();
    ctx.moveTo(x, inset);
    ctx.lineTo(x + ch, inset + ch);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(x + ch, inset);
    ctx.lineTo(x, inset + ch);
    ctx.stroke();
  }
  ctx.restore();

  // central emblem
  ctx.save();
  ctx.globalAlpha = 0.9;
  ctx.fillStyle = design.primary;
  ctx.shadowColor = design.glow;
  ctx.shadowBlur = 26 * u;
  ctx.font = `bold ${86 * u}px sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText("🎴", W / 2, H / 2);
  ctx.restore();

  // frame ring + gems
  const ringGrad = ctx.createLinearGradient(inset, inset, inset + cw, inset + ch);
  ringGrad.addColorStop(0, design.primary);
  ringGrad.addColorStop(0.5, design.secondary);
  ringGrad.addColorStop(1, design.primary);
  ctx.save();
  ctx.strokeStyle = ringGrad;
  ctx.lineWidth = (design.ring ? 7 : 5) * u;
  ctx.shadowColor = design.glow;
  ctx.shadowBlur = 18 * u;
  roundRect(ctx, inset, inset, cw, ch, r);
  ctx.stroke();
  ctx.restore();
}

// ── Particles (Epic+) ─────────────────────────────────────────
function drawParticles(ctx, W, H, particles, frame, design) {
  ctx.save();
  ctx.fillStyle = design.primary;
  ctx.shadowColor = design.glow;
  ctx.shadowBlur = 8;
  for (const p of particles) {
    const y = (p.y - frame * p.speed) % H;
    const drawY = y < 0 ? y + H : y;
    const alpha = 0.25 + Math.sin(frame * 0.2 + p.offset) * 0.25;
    ctx.globalAlpha = Math.max(0, alpha);
    ctx.beginPath();
    ctx.arc(p.x, drawY, p.size, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

// ── Holo shimmer sweep (Legendary/Mythic) ─────────────────────
function drawShimmer(ctx, W, H, frame, totalFrames, design) {
  const progress = (frame - 14) / Math.max(1, totalFrames - 14);
  const shimmerX = progress * (W + 140) - 70;
  ctx.save();
  const grad = ctx.createLinearGradient(shimmerX - 60, 0, shimmerX + 60, 0);
  grad.addColorStop(0, "rgba(255,255,255,0)");
  grad.addColorStop(0.5, "rgba(255,255,255,0.18)");
  grad.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = grad;
  ctx.globalCompositeOperation = "screen";
  ctx.fillRect(0, 0, W, H);
  ctx.restore();
}

// ── Load character image ─────────────────────────────────────
async function loadCharacter(card) {
  if (!card.image) return null;
  const buf = await downloadImage(card.image);
  if (!buf) return null;
  try {
    return await loadImage(buf);
  } catch {
    return null;
  }
}

// ═══════════════════════════════════════════════════════════════
// STATIC PREMIUM CARD  (fast path — .view / collection)
// ═══════════════════════════════════════════════════════════════
async function renderStaticCard(card) {
  if (!isReady()) return null;
  const W = 480, H = 672;
  const design = TIER_DESIGN[card.tier] || TIER_DESIGN.Common;

  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext("2d");
  ctx.clearRect(0, 0, W, H); // transparent margins, glow shows through

  const charImg = await loadCharacter(card);
  drawTcgFront(ctx, W, H, design, charImg);

  return canvas.toBuffer("image/png");
}

async function generateCardImage(card) {
  if (!isReady()) return null;
  const cached = readCache("static", card);
  if (cached) return cached;
  const buf = await renderStaticCard(card);
  if (buf && buf.length > 1000) {
    writeCache("static", card, buf);
    return buf;
  }
  return null;
}

// fire-and-forget pre-render (called right after a drop is sent)
async function warmCardCache(card) {
  try {
    await generateCardImage(card);
  } catch {}
}

// ═══════════════════════════════════════════════════════════════
// ANIMATED REVEAL  (drops / .airdrop)
// ═══════════════════════════════════════════════════════════════
async function framesToMp4(frames, width, height, delayMs = 70) {
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
      "-vf", "scale=trunc(iw/2)*2:trunc(ih/2)*2,fps=15",
      "-c:a", "aac", "-b:a", "32k",
      "-movflags", "faststart",
      "-tag:v", "avc1",
      mp4Path,
    ];
    await new Promise((resolve, reject) => {
      execFile(ffmpegPath, args, { timeout: 30000 }, (err, stdout, stderr) => {
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

async function generateAnimatedCard(card) {
  if (!isReady()) return null;

  // ✅ cached: the same card dropping twice never re-renders
  const cached = readCache("anim", card);
  if (cached) return cached;

  const W = 400, H = 560;
  const design = TIER_DESIGN[card.tier] || TIER_DESIGN.Common;
  const charImg = await loadCharacter(card);

  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext("2d");
  const frames = [];
  const totalFrames = 24;

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
    const isFlipping = f >= 6 && f <= 9;
    const showFront = f > 9;

    let scaleX = 1;
    if (isFlipping) {
      const flipProgress = (f - 6) / 4;
      scaleX = Math.max(0.05, Math.abs(Math.cos(flipProgress * Math.PI)));
    }

    ctx.fillStyle = "#000000";
    ctx.fillRect(0, 0, W, H);

    ctx.save();
    ctx.translate(W / 2, H / 2);
    ctx.scale(scaleX, 1);
    ctx.translate(-W / 2, -H / 2);

    if (showFront) {
      drawTcgFront(ctx, W, H, design, charImg);
    } else {
      drawTcgBack(ctx, W, H, design);
    }
    ctx.restore();

    if (design.particles && f > 8) {
      drawParticles(ctx, W, H, particles, f, design);
    }
    if (design.shimmer && f >= 14) {
      drawShimmer(ctx, W, H, f, totalFrames, design);
    }
    if (showFront) {
      const pulseAlpha = 0.25 + Math.sin(f * 0.3) * 0.12;
      ctx.save();
      ctx.globalAlpha = Math.max(0.05, pulseAlpha);
      ctx.strokeStyle = design.primary;
      ctx.lineWidth = 10;
      ctx.shadowColor = design.glow;
      ctx.shadowBlur = 30;
      roundRect(ctx, 5, 5, W - 10, H - 10, 24);
      ctx.stroke();
      ctx.restore();
    }

    frames.push(ctx);
  }

  const mp4 = await framesToMp4(frames, W, H, 70);
  if (mp4 && mp4.length > 1000) writeCache("anim", card, mp4);
  return mp4;
}

// ── Caption text helper (unchanged contract) ──────────────────
function renderCardText(card) {
  const emoji = TIER_EMOJI[card.tier] || "⚪";
  return `🎴 ${card.name}\n${emoji} ${card.tier}\n💰 $${formatMoney(card.worth)}`;
}

module.exports = {
  generateCardImage,   // static premium PNG (cached) — viewing
  generateAnimatedCard, // animated MP4 (cached) — drops / airdrop
  warmCardCache,       // fire-and-forget static pre-render
  renderCardText,
  TIER_EMOJI,
  TIER_DESIGN,
  isReady,
};
