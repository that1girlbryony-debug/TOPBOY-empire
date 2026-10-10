/**
 * 🎴 Card Renderer v4 — Real Anime TCG Showcase Engine
 *
 * OWNER DIRECTIVE (Task 17 — supersedes Task 15 art direction):
 *   The rendered image is a full TCG SHOWCASE:
 *     - the card + its borders suspended in a small black space,
 *       floating on a tier-colored ambient glow with faint star dust
 *     - the card looks like a REAL anime trading card: ornate
 *       metallic frame with corner gem medallions, brushed foil
 *       texture, holo foil edge (Legendary/Mythic)
 *     - ALL card info lives ON the card: name plate (Cinzel),
 *       rarity star row, tier chip, WORTH stat, micro-text credit
 *     - NO text outside the card (captions trimmed at call sites)
 *
 * Inspiration: physical TCG frames (Yu-Gi-Oh!/Pokémon anatomy),
 * gacha SSR showcases (dark ambient space, gold rarity, star row),
 * ornate fantasy card frames with gem medallions.
 *
 * Public API (unchanged contract):
 *   generateCardImage(card)   → premium static PNG buffer (fast, cached)
 *                               — for .view / .col detail viewing
 *   generateAnimatedCard(card)→ animated MP4 reveal (cached)
 *                               — for drops / .airdrop
 *   warmCardCache(card)       → fire-and-forget static pre-render
 *   renderCardText(card)      → legacy caption helper (kept, unused)
 *   isReady()                 → canvas + encoder + ffmpeg present
 */

const fs = require("fs");
const path = require("path");
const os = require("os");
const crypto = require("crypto");
const axios = require("axios");
const { formatShort } = require("./helpers");

// ── Dependency detection + bundled font registration ─────────
let canvasAvailable = false;
let createCanvas = null;
let loadImage = null;
let registerFont = null;
let GIFEncoder = null;
let ffmpegPath = null;

try {
  const canvas = require("canvas");
  createCanvas = canvas.createCanvas;
  loadImage = canvas.loadImage;
  registerFont = canvas.registerFont;
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

// Bundled display fonts (OFL — see assets/fonts/OFL-*.txt).
// Registered once; if missing, cairo silently falls back to sans.
const FONT_DIR = path.join(__dirname, "..", "assets", "fonts");
if (registerFont) {
  try {
    registerFont(path.join(FONT_DIR, "Cinzel-Bold-static.ttf"), { family: "Cinzel", weight: "bold" });
  } catch (e) { console.warn("⚠️ [cardRenderer] Cinzel not registered:", e.message); }
  try {
    registerFont(path.join(FONT_DIR, "Oswald-SemiBold.ttf"), { family: "Oswald", weight: "600" });
  } catch (e) { console.warn("⚠️ [cardRenderer] Oswald not registered:", e.message); }
}

const isReady = () => canvasAvailable && GIFEncoder && !!ffmpegPath;

// ── Tier design system ────────────────────────────────────────
// primary   = frame metal / gem / glow color
// secondary = gradient partner (shadow side of the metal)
// level     = rarity stars filled on the name plate (1..5)
const TIER_DESIGN = {
  Common: {
    name: "Common", emoji: "⚪", level: 1,
    primary: "#aab4c0", secondary: "#4b5560",
    bg: "#0a0d12", glow: "rgba(170,180,192,0.38)",
    gradient: ["#20242c", "#0d1016"],
    particles: false, shimmer: false, foil: false,
  },
  Rare: {
    name: "Rare", emoji: "🔵", level: 2,
    primary: "#4fb3f0", secondary: "#173f5e",
    bg: "#081220", glow: "rgba(79,179,240,0.5)",
    gradient: ["#122c44", "#0a141f"],
    particles: false, shimmer: false, foil: false,
  },
  Epic: {
    name: "Epic", emoji: "🟣", level: 3,
    primary: "#b06ef5", secondary: "#4a2270",
    bg: "#100a18", glow: "rgba(176,110,245,0.58)",
    gradient: ["#291347", "#140826"],
    particles: true, shimmer: false, foil: false,
  },
  Legendary: {
    name: "Legendary", emoji: "🟡", level: 4,
    primary: "#f6b731", secondary: "#8a5a12",
    bg: "#100c04", glow: "rgba(246,183,49,0.7)",
    gradient: ["#3f2f0d", "#1e1505"],
    particles: true, shimmer: true, foil: true,
  },
  Mythic: {
    name: "Mythic", emoji: "🔴", level: 5,
    primary: "#ff5f52", secondary: "#7e1d15",
    bg: "#130303", glow: "rgba(255,95,82,0.75)",
    gradient: ["#420f0b", "#200505"],
    particles: true, shimmer: true, foil: true,
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
const RENDER_VERSION = "v4-tcg"; // bump invalidates all caches after design changes

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

function starPath(ctx, x, y, r) {
  ctx.beginPath();
  for (let i = 0; i < 10; i++) {
    const a = -Math.PI / 2 + (i * Math.PI) / 5;
    const rr = i % 2 === 0 ? r : r * 0.45;
    const px = x + rr * Math.cos(a);
    const py = y + rr * Math.sin(a);
    if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
  }
  ctx.closePath();
}

// cover-fit crop with a vertical bias (0 = top, 0.5 = center):
// keeps faces in frame for portrait anime art (faces live up top)
function coverCrop(img, boxW, boxH, bias = 0.5) {
  const iw = img.width, ih = img.height;
  const scale = Math.max(boxW / iw, boxH / ih);
  const sw = boxW / scale, sh = boxH / scale;
  return { sx: (iw - sw) / 2, sy: (ih - sh) * bias, sw, sh };
}

// deterministic RNG so the star field is stable per render (cache-friendly)
function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// letter-spaced text (node-canvas has no reliable ctx.letterSpacing)
// ctx.textAlign is temporarily forced to "left"; x is the anchor.
function drawTracked(ctx, text, x, y, track, align = "center") {
  const chars = [...String(text)];
  const widths = chars.map((c) => ctx.measureText(c).width);
  const total = widths.reduce((a, b) => a + b, 0) + track * (chars.length - 1);
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

// does the art have transparency? (anilist cutouts vs opaque fanart)
function detectCutout(img) {
  try {
    const t = createCanvas(40, 40);
    const tc = t.getContext("2d");
    tc.drawImage(img, 0, 0, 40, 40);
    const d = tc.getImageData(0, 0, 40, 40).data;
    let clear = 0;
    for (let i = 3; i < d.length; i += 4) if (d[i] < 200) clear++;
    return clear / 400 > 0.08;
  } catch {
    return false;
  }
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
// SHOWCASE SPACE — small black space the card floats in
// ═══════════════════════════════════════════════════════════════
function drawShowcaseSpace(ctx, W, H, design, twinkle = 0) {
  // deep space
  ctx.fillStyle = "#04050a";
  ctx.fillRect(0, 0, W, H);

  // faint star dust (deterministic)
  const rnd = mulberry32(0x130e + W * 7 + H);
  const n = Math.round(46 * (W / 480));
  ctx.save();
  for (let i = 0; i < n; i++) {
    const sx = rnd() * W;
    const sy = rnd() * H;
    const r = (0.5 + rnd() * 1.1) * (W / 480);
    let a = 0.08 + rnd() * 0.22;
    if (twinkle) a *= 0.55 + 0.45 * Math.sin(twinkle + i * 1.7);
    ctx.globalAlpha = Math.max(0.03, a);
    ctx.fillStyle = i % 7 === 0 ? design.primary : "#cfd8e6";
    ctx.beginPath();
    ctx.arc(sx, sy, r, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();

  // ambient tier glow behind the card (two layers: wide + core)
  const cxG = W / 2, cyG = H / 2;
  const wide = ctx.createRadialGradient(cxG, cyG, W * 0.12, cxG, cyG, W * 0.72);
  wide.addColorStop(0, design.glow);
  wide.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = wide;
  ctx.fillRect(0, 0, W, H);
  const core = ctx.createRadialGradient(cxG, cyG, 0, cxG, cyG, W * 0.4);
  core.addColorStop(0, design.glow);
  core.addColorStop(1, "rgba(0,0,0,0)");
  ctx.save();
  ctx.globalAlpha = 0.55;
  ctx.fillStyle = core;
  ctx.fillRect(0, 0, W, H);
  ctx.restore();

  // edge vignette → makes the space feel tight around the card
  const vig = ctx.createRadialGradient(cxG, cyG, W * 0.35, cxG, cyG, W * 0.85);
  vig.addColorStop(0, "rgba(0,0,0,0)");
  vig.addColorStop(1, "rgba(0,0,0,0.55)");
  ctx.fillStyle = vig;
  ctx.fillRect(0, 0, W, H);
}

// ═══════════════════════════════════════════════════════════════
// CARD FRAME — ornate metalwork: foil band, brushed texture,
// corner gem medallions, mid-edge diamonds, holo foil edge
// ═══════════════════════════════════════════════════════════════
function drawCardFrame(ctx, cx, cy, cw, ch, cr, u, design) {
  // 1. card base + floating glow shadow
  ctx.save();
  ctx.shadowColor = design.glow;
  ctx.shadowBlur = 42 * u;
  ctx.fillStyle = "#0a0c12";
  roundRect(ctx, cx, cy, cw, ch, cr);
  ctx.fill();
  ctx.fill(); // double fill deepens the halo
  ctx.restore();

  // 2. metallic tier band — fills the whole card, panels sit on top
  const metal = ctx.createLinearGradient(cx, cy, cx + cw, cy + ch);
  metal.addColorStop(0, design.secondary);
  metal.addColorStop(0.22, design.primary);
  metal.addColorStop(0.4, design.secondary);
  metal.addColorStop(0.55, design.primary);
  metal.addColorStop(0.78, design.secondary);
  metal.addColorStop(1, design.primary);
  ctx.fillStyle = metal;
  roundRect(ctx, cx, cy, cw, ch, cr);
  ctx.fill();

  // 3. holo foil edge (Legendary/Mythic) — iridescent outer ring
  if (design.foil) {
    ctx.save();
    const rainbow = ctx.createLinearGradient(cx, cy, cx + cw, cy + ch);
    ["#ff5f6d", "#ffc371", "#7ee8a2", "#5bc8f5", "#b48cf2", "#ff5f6d"].forEach(
      (c, i, a) => rainbow.addColorStop(i / (a.length - 1), c)
    );
    ctx.strokeStyle = rainbow;
    ctx.globalAlpha = 0.9;
    ctx.lineWidth = 3 * u;
    ctx.shadowColor = "rgba(255,255,255,0.5)";
    ctx.shadowBlur = 6 * u;
    roundRect(ctx, cx + 1.6 * u, cy + 1.6 * u, cw - 3.2 * u, ch - 3.2 * u, cr - 1.6 * u);
    ctx.stroke();
    ctx.restore();
  }

  // 4. brushed foil texture on the band (ring clip, diagonal lines)
  const fw = 13 * u;
  ctx.save();
  roundRect(ctx, cx, cy, cw, ch, cr);
  roundRect(ctx, cx + fw, cy + fw, cw - fw * 2, ch - fw * 2, Math.max(2, cr - fw));
  ctx.clip("evenodd");
  ctx.globalAlpha = 0.09;
  ctx.strokeStyle = "#ffffff";
  ctx.lineWidth = 1.1 * u;
  for (let x = -ch; x < cw + ch; x += 7 * u) {
    ctx.beginPath();
    ctx.moveTo(cx + x, cy + ch);
    ctx.lineTo(cx + x + ch, cy);
    ctx.stroke();
  }
  ctx.restore();

  // 5. inner dark bezel (frame → content boundary)
  ctx.save();
  ctx.strokeStyle = "rgba(4,5,9,0.95)";
  ctx.lineWidth = 3 * u;
  roundRect(ctx, cx + fw - 1.5 * u, cy + fw - 1.5 * u, cw - (fw - 1.5 * u) * 2, ch - (fw - 1.5 * u) * 2, Math.max(2, cr - fw));
  ctx.stroke();
  ctx.restore();

  // 6. corner gem medallions embedded in the band
  const off = fw * 1.15;
  const corners = [
    [cx + off, cy + off],
    [cx + cw - off, cy + off],
    [cx + off, cy + ch - off],
    [cx + cw - off, cy + ch - off],
  ];
  ctx.save();
  for (const [gx, gy] of corners) {
    // socket
    ctx.beginPath();
    ctx.arc(gx, gy, 10.5 * u, 0, Math.PI * 2);
    ctx.fillStyle = "rgba(5,6,10,0.92)";
    ctx.fill();
    ctx.strokeStyle = design.primary;
    ctx.globalAlpha = 0.8;
    ctx.lineWidth = 1.4 * u;
    ctx.stroke();
    ctx.globalAlpha = 1;
    // gem
    const gem = ctx.createRadialGradient(gx - 2.5 * u, gy - 2.5 * u, 1, gx, gy, 7.5 * u);
    gem.addColorStop(0, "#ffffff");
    gem.addColorStop(0.35, design.primary);
    gem.addColorStop(1, design.secondary);
    ctx.beginPath();
    ctx.arc(gx, gy, 7 * u, 0, Math.PI * 2);
    ctx.fillStyle = gem;
    ctx.shadowColor = design.glow;
    ctx.shadowBlur = 9 * u;
    ctx.fill();
    ctx.shadowBlur = 0;
    // sparkle
    ctx.fillStyle = "rgba(255,255,255,0.85)";
    ctx.beginPath();
    ctx.arc(gx - 2.4 * u, gy - 2.6 * u, 1.5 * u, 0, Math.PI * 2);
    ctx.fill();
  }
  // mid-edge diamonds (top / bottom center)
  for (const [dx, dy] of [[cx + cw / 2, cy + fw * 0.62], [cx + cw / 2, cy + ch - fw * 0.62]]) {
    ctx.globalAlpha = 1;
    diamond(ctx, dx, dy, 6 * u);
    ctx.fillStyle = design.primary;
    ctx.shadowColor = design.glow;
    ctx.shadowBlur = 8 * u;
    ctx.fill();
    ctx.shadowBlur = 0;
    ctx.strokeStyle = "rgba(255,255,255,0.5)";
    ctx.lineWidth = 1 * u;
    ctx.stroke();
  }
  ctx.restore();

  // 7. outer cut-edge hairline
  ctx.save();
  ctx.strokeStyle = "rgba(0,0,0,0.85)";
  ctx.lineWidth = 2 * u;
  roundRect(ctx, cx + 0.8 * u, cy + 0.8 * u, cw - 1.6 * u, ch - 1.6 * u, cr - 0.8 * u);
  ctx.stroke();
  ctx.restore();
}

// ═══════════════════════════════════════════════════════════════
// NAME PLATE — card name (Cinzel) + rarity star row, ON the card
// ═══════════════════════════════════════════════════════════════
function drawNamePlate(ctx, px, py, pw, u, design, card) {
  const nh = 58 * u;

  // subtle plate tint so the name area reads as its own zone
  const tint = ctx.createLinearGradient(0, py, 0, py + nh);
  tint.addColorStop(0, "rgba(255,255,255,0.06)");
  tint.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = tint;
  ctx.fillRect(px, py, pw, nh);

  // ── card name: auto-shrink to fit ──
  const name = String(card.name || "???").toUpperCase();
  let size = 25 * u;
  ctx.textAlign = "center";
  ctx.textBaseline = "alphabetic";
  ctx.font = `bold ${size}px Cinzel`;
  while (size > 13 * u && ctx.measureText(name).width > pw - 22 * u) {
    size -= 1;
    ctx.font = `bold ${size}px Cinzel`;
  }
  ctx.save();
  ctx.shadowColor = design.glow;
  ctx.shadowBlur = 10 * u;
  const nameGrad = ctx.createLinearGradient(0, py + 12 * u, 0, py + 34 * u);
  nameGrad.addColorStop(0, "#ffffff");
  nameGrad.addColorStop(1, "#d9d4c4");
  ctx.fillStyle = nameGrad;
  ctx.fillText(name, px + pw / 2, py + 32 * u);
  ctx.restore();

  // ── rarity star row (filled = tier level) ──
  const starY = py + 45.5 * u;
  const starR = 5.2 * u;
  const gap = 14.5 * u;
  const level = design.level || 1;
  const startX = px + pw / 2 - (2 * gap);
  for (let i = 0; i < 5; i++) {
    const sx = startX + i * gap;
    if (i < level) {
      starPath(ctx, sx, starY, starR);
      ctx.fillStyle = design.primary;
      ctx.shadowColor = design.glow;
      ctx.shadowBlur = 7 * u;
      ctx.fill();
      ctx.shadowBlur = 0;
      ctx.strokeStyle = "rgba(255,255,255,0.55)";
      ctx.lineWidth = 0.9 * u;
      ctx.stroke();
    } else {
      starPath(ctx, sx, starY, starR);
      ctx.fillStyle = "rgba(0,0,0,0.4)";
      ctx.fill();
      ctx.strokeStyle = "rgba(255,255,255,0.22)";
      ctx.lineWidth = 0.9 * u;
      ctx.stroke();
    }
  }

  // separator under the plate
  const sep = ctx.createLinearGradient(px + 6 * u, 0, px + pw - 6 * u, 0);
  sep.addColorStop(0, "rgba(0,0,0,0)");
  sep.addColorStop(0.5, design.primary);
  sep.addColorStop(1, "rgba(0,0,0,0)");
  ctx.save();
  ctx.globalAlpha = 0.65;
  ctx.strokeStyle = sep;
  ctx.lineWidth = 1.2 * u;
  ctx.beginPath();
  ctx.moveTo(px + 6 * u, py + nh);
  ctx.lineTo(px + pw - 6 * u, py + nh);
  ctx.stroke();
  ctx.restore();

  return nh;
}

// ═══════════════════════════════════════════════════════════════
// ART WINDOW — real TCG art well with two modes:
//   cutout (transparent PNG): character stands on a tier-lit stage
//   opaque: full-bleed cover crop (top-biased) on blurred self
// ═══════════════════════════════════════════════════════════════
function drawArtWindow(ctx, ax, ay, aw, ah, u, design, charImg) {
  const ar = 10 * u;
  ctx.save();
  roundRect(ctx, ax, ay, aw, ah, ar);
  ctx.clip();
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";

  if (charImg) {
    const cutout = detectCutout(charImg);
    if (cutout) {
      // stage backdrop: dark tier gradient
      const bg = ctx.createLinearGradient(0, ay, 0, ay + ah);
      bg.addColorStop(0, design.gradient[0]);
      bg.addColorStop(1, design.gradient[1]);
      ctx.fillStyle = bg;
      ctx.fillRect(ax, ay, aw, ah);

      // giant blurred silhouette = ambient energy behind the character
      const { sx, sy, sw, sh } = coverCrop(charImg, aw, ah, 0.4);
      const mini = createCanvas(20, Math.max(10, Math.round(20 * (sh / sw))));
      const mctx = mini.getContext("2d");
      mctx.drawImage(charImg, sx, sy, sw, sh, 0, 0, mini.width, mini.height);
      ctx.globalAlpha = 0.4;
      ctx.drawImage(mini, ax - 6 * u, ay - 6 * u, aw + 12 * u, ah + 12 * u);
      ctx.globalAlpha = 1;

      // radial glow behind character
      const glow = ctx.createRadialGradient(
        ax + aw / 2, ay + ah * 0.45, 6 * u,
        ax + aw / 2, ay + ah * 0.45, aw * 0.62
      );
      glow.addColorStop(0, design.glow);
      glow.addColorStop(1, "rgba(0,0,0,0)");
      ctx.fillStyle = glow;
      ctx.fillRect(ax, ay, aw, ah);

      // character: contain-fit, anchored to the floor
      const scale = Math.min(aw / charImg.width, ah / charImg.height) * 0.97;
      const dw = charImg.width * scale, dh = charImg.height * scale;
      const dx = ax + (aw - dw) / 2;
      const dy = ay + ah - dh - 2 * u;

      // floor shadow
      ctx.save();
      ctx.globalAlpha = 0.5;
      const sh2 = ctx.createRadialGradient(
        ax + aw / 2, ay + ah - 10 * u, 2,
        ax + aw / 2, ay + ah - 10 * u, dw * 0.42
      );
      sh2.addColorStop(0, "rgba(0,0,0,0.75)");
      sh2.addColorStop(1, "rgba(0,0,0,0)");
      ctx.fillStyle = sh2;
      ctx.beginPath();
      ctx.ellipse(ax + aw / 2, ay + ah - 10 * u, dw * 0.4, 12 * u, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();

      ctx.drawImage(charImg, dx, dy, dw, dh);
    } else {
      // opaque art: blurred self-backdrop + top-biased cover crop
      const { sx, sy, sw, sh } = coverCrop(charImg, aw, ah, 0.22);
      const mini = createCanvas(24, Math.max(12, Math.round(24 * (sh / sw))));
      const mctx = mini.getContext("2d");
      mctx.drawImage(charImg, sx, sy, sw, sh, 0, 0, mini.width, mini.height);
      ctx.drawImage(mini, ax - 4 * u, ay - 4 * u, aw + 8 * u, ah + 8 * u);
      ctx.fillStyle = "rgba(0,0,0,0.30)";
      ctx.fillRect(ax, ay, aw, ah);
      ctx.drawImage(charImg, sx, sy, sw, sh, ax, ay, aw, ah);
    }
  } else {
    // placeholder (image download failed) — ornate dark texture
    const bg = ctx.createLinearGradient(0, ay, 0, ay + ah);
    bg.addColorStop(0, design.gradient[0]);
    bg.addColorStop(1, design.gradient[1]);
    ctx.fillStyle = bg;
    ctx.fillRect(ax, ay, aw, ah);
    ctx.save();
    ctx.globalAlpha = 0.22;
    ctx.strokeStyle = design.primary;
    ctx.lineWidth = 1.6 * u;
    for (let gx = -ah; gx < aw; gx += 30 * u) {
      ctx.beginPath();
      ctx.moveTo(gx, ay + ah);
      ctx.lineTo(gx + ah, ay);
      ctx.stroke();
    }
    // centered placeholder gem
    diamond(ctx, ax + aw / 2, ay + ah / 2, 16 * u);
    ctx.fillStyle = design.primary;
    ctx.globalAlpha = 0.55;
    ctx.shadowColor = design.glow;
    ctx.shadowBlur = 18 * u;
    ctx.fill();
    ctx.restore();
  }

  // glass sheen (top half) + bottom vignette
  const sheen = ctx.createLinearGradient(0, ay, 0, ay + ah * 0.5);
  sheen.addColorStop(0, "rgba(255,255,255,0.10)");
  sheen.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = sheen;
  ctx.fillRect(ax, ay, aw, ah * 0.5);
  const vin = ctx.createLinearGradient(0, ay + ah - 90 * u, 0, ay + ah);
  vin.addColorStop(0, "rgba(0,0,0,0)");
  vin.addColorStop(1, "rgba(0,0,0,0.55)");
  ctx.fillStyle = vin;
  ctx.fillRect(ax, ay + ah - 90 * u, aw, 90 * u);

  // micro-text credit line — like the illustrator line on real cards
  ctx.save();
  ctx.globalAlpha = 0.6;
  ctx.fillStyle = "#e8e4d8";
  ctx.font = `${6.4 * u}px Oswald`;
  ctx.textBaseline = "alphabetic";
  drawTracked(ctx, "TOPBOY EMPIRE", ax + 12 * u, ay + ah - 9 * u, 1.6 * u, "left");
  ctx.restore();

  ctx.restore(); // un-clip

  // art window frame hairline
  ctx.save();
  ctx.strokeStyle = design.primary;
  ctx.globalAlpha = 0.8;
  ctx.lineWidth = 1.3 * u;
  ctx.shadowColor = design.glow;
  ctx.shadowBlur = 7 * u;
  roundRect(ctx, ax, ay, aw, ah, ar);
  ctx.stroke();
  ctx.restore();
}

// ═══════════════════════════════════════════════════════════════
// STAT PLATE — tier chip (left) + WORTH (right), Yu-Gi-Oh style
// ═══════════════════════════════════════════════════════════════
function drawStatPlate(ctx, px, py, pw, ph, u, design, card) {
  const sh = 46 * u;
  const y0 = py + ph - sh;
  const midY = y0 + sh / 2;

  // separator above plate
  const sep = ctx.createLinearGradient(px + 6 * u, 0, px + pw - 6 * u, 0);
  sep.addColorStop(0, "rgba(0,0,0,0)");
  sep.addColorStop(0.5, design.primary);
  sep.addColorStop(1, "rgba(0,0,0,0)");
  ctx.save();
  ctx.globalAlpha = 0.65;
  ctx.strokeStyle = sep;
  ctx.lineWidth = 1.2 * u;
  ctx.beginPath();
  ctx.moveTo(px + 6 * u, y0);
  ctx.lineTo(px + pw - 6 * u, y0);
  ctx.stroke();
  ctx.restore();

  // ── left: tier chip (gem + tier name) ──
  ctx.save();
  const gx = px + 15 * u;
  diamond(ctx, gx, midY, 5.5 * u);
  ctx.fillStyle = design.primary;
  ctx.shadowColor = design.glow;
  ctx.shadowBlur = 7 * u;
  ctx.fill();
  ctx.shadowBlur = 0;
  ctx.strokeStyle = "rgba(255,255,255,0.5)";
  ctx.lineWidth = 0.8 * u;
  ctx.stroke();

  ctx.fillStyle = design.primary;
  ctx.font = `${10.5 * u}px Oswald`;
  ctx.textBaseline = "middle";
  drawTracked(ctx, String(design.name).toUpperCase(), gx + 11 * u, midY + 1 * u, 2.2 * u, "left");
  ctx.restore();

  // ── right: WORTH label + value ──
  ctx.save();
  ctx.textBaseline = "alphabetic";
  const xr = px + pw - 14 * u;
  ctx.fillStyle = "rgba(232,228,216,0.55)";
  ctx.font = `${6.2 * u}px Oswald`;
  drawTracked(ctx, "WORTH", xr, midY - 8 * u, 2.4 * u, "right");

  ctx.font = `bold ${15.5 * u}px Oswald`;
  ctx.fillStyle = "#f5efdd";
  ctx.shadowColor = "rgba(245,239,221,0.35)";
  ctx.shadowBlur = 6 * u;
  ctx.textAlign = "right";
  ctx.fillText(`$${formatShort(card.worth || 0)}`, xr, midY + 10 * u);
  ctx.restore();

  return sh;
}

// ═══════════════════════════════════════════════════════════════
// FULL CARD FRONT — frame → name plate → art → stat plate
// ═══════════════════════════════════════════════════════════════
function drawCardFront(ctx, W, H, design, charImg, card) {
  const u = W / 480;
  const mx = 40 * u;
  const cw = W - mx * 2;
  const ch = Math.min(H - 24 * u, cw / 0.716); // real TCG ratio 63:88
  const my = Math.max(12 * u, (H - ch) / 2);
  const cr = 20 * u;
  const cx = mx, cy = my;

  // card + metalwork
  drawCardFrame(ctx, cx, cy, cw, ch, cr, u, design);

  // content panel (inside the band)
  const fw = 13 * u;
  const px = cx + fw, py = cy + fw;
  const pw = cw - fw * 2, ph = ch - fw * 2;
  ctx.save();
  const panel = ctx.createLinearGradient(0, py, 0, py + ph);
  panel.addColorStop(0, "#0d1017");
  panel.addColorStop(1, "#070910");
  ctx.fillStyle = panel;
  roundRect(ctx, px, py, pw, ph, Math.max(2, cr - fw));
  ctx.fill();
  ctx.restore();

  // zones
  const nh = drawNamePlate(ctx, px, py, pw, u, design, card);
  const sh = drawStatPlate(ctx, px, py, pw, ph, u, design, card);
  const ax = px + 9 * u;
  const ay = py + nh + 4 * u;
  const aw = pw - 18 * u;
  const ah = ph - nh - sh - 8 * u;
  drawArtWindow(ctx, ax, ay, aw, ah, u, design, charImg);
}

// ── Card back (animated reveal) — vector emblem, no emoji ────
function drawCardBack(ctx, W, H, design) {
  const u = W / 480;
  const mx = 40 * u;
  const cw = W - mx * 2;
  const ch = Math.min(H - 24 * u, cw / 0.716);
  const my = Math.max(12 * u, (H - ch) / 2);
  const cr = 20 * u;

  drawCardFrame(ctx, mx, my, cw, ch, cr, u, design);

  const fw = 13 * u;
  const px = mx + fw, py = my + fw;
  const pw = cw - fw * 2, ph = ch - fw * 2;
  ctx.save();
  const panel = ctx.createLinearGradient(0, py, 0, py + ph);
  panel.addColorStop(0, "#0d1017");
  panel.addColorStop(1, "#070910");
  ctx.fillStyle = panel;
  roundRect(ctx, px, py, pw, ph, Math.max(2, cr - fw));
  ctx.fill();
  ctx.restore();

  // diamond lattice
  ctx.save();
  roundRect(ctx, px, py, pw, ph, Math.max(2, cr - fw));
  ctx.clip();
  ctx.globalAlpha = 0.14;
  ctx.strokeStyle = design.primary;
  ctx.lineWidth = 1.2 * u;
  const step = 42 * u;
  for (let x = px - ph; x < px + pw + ph; x += step) {
    ctx.beginPath();
    ctx.moveTo(x, py);
    ctx.lineTo(x + ph, py + ph);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(x + ph, py);
    ctx.lineTo(x, py + ph);
    ctx.stroke();
  }
  ctx.restore();

  // central emblem: layered diamond gem
  const ex = mx + cw / 2, ey = my + ch / 2 - 8 * u;
  ctx.save();
  diamond(ctx, ex, ey, 30 * u);
  ctx.strokeStyle = design.primary;
  ctx.globalAlpha = 0.5;
  ctx.lineWidth = 1.6 * u;
  ctx.stroke();
  ctx.globalAlpha = 1;
  diamond(ctx, ex, ey, 21 * u);
  const gem = ctx.createRadialGradient(ex - 6 * u, ey - 6 * u, 2, ex, ey, 22 * u);
  gem.addColorStop(0, "#ffffff");
  gem.addColorStop(0.4, design.primary);
  gem.addColorStop(1, design.secondary);
  ctx.fillStyle = gem;
  ctx.shadowColor = design.glow;
  ctx.shadowBlur = 24 * u;
  ctx.fill();
  ctx.shadowBlur = 0;
  ctx.strokeStyle = "rgba(255,255,255,0.6)";
  ctx.lineWidth = 1.2 * u;
  ctx.stroke();
  ctx.restore();

  // brand line
  ctx.save();
  ctx.fillStyle = "rgba(232,228,216,0.8)";
  ctx.font = `${10 * u}px Cinzel`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  drawTracked(ctx, "TOPBOY EMPIRE", ex, ey + 52 * u, 3 * u, "center");
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
  grad.addColorStop(0.5, "rgba(255,255,255,0.16)");
  grad.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = grad;
  ctx.globalCompositeOperation = "screen";
  ctx.fillRect(0, 0, W, H);
  ctx.restore();
}

// ═══════════════════════════════════════════════════════════════
// STATIC PREMIUM CARD  (fast path — .view / collection)
// ═══════════════════════════════════════════════════════════════
async function renderStaticCard(card) {
  if (!isReady()) return null;
  const W = 540, H = 736;
  const design = TIER_DESIGN[card.tier] || TIER_DESIGN.Common;

  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext("2d");

  const charImg = await loadCharacter(card);
  drawShowcaseSpace(ctx, W, H, design, 0);
  drawCardFront(ctx, W, H, design, charImg, card);

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

    drawShowcaseSpace(ctx, W, H, design, f * 0.25);

    ctx.save();
    ctx.translate(W / 2, H / 2);
    ctx.scale(scaleX, 1);
    ctx.translate(-W / 2, -H / 2);

    if (showFront) {
      drawCardFront(ctx, W, H, design, charImg, card);
    } else {
      drawCardBack(ctx, W, H, design);
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
      ctx.lineWidth = 8;
      ctx.shadowColor = design.glow;
      ctx.shadowBlur = 28;
      const u = W / 480;
      roundRect(ctx, 28 * u, 34 * u, W - 56 * u, H - 62 * u, 18);
      ctx.stroke();
      ctx.restore();
    }

    frames.push(ctx);
  }

  const mp4 = await framesToMp4(frames, W, H, 70);
  if (mp4 && mp4.length > 1000) writeCache("anim", card, mp4);
  return mp4;
}

// ── Caption text helper (legacy; call sites no longer use it) ──
function renderCardText(card) {
  const emoji = TIER_EMOJI[card.tier] || "⚪";
  return `🎴 ${card.name}\n${emoji} ${card.tier}\n💰 $${formatShort(card.worth)}`;
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
