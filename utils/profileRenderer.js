/**
 * 👤 Profile Renderer — Canvas-based styled profile card
 *
 * Renders a user's profile as a premium styled image with:
 *   - Circular profile picture with glowing ring
 *   - Net worth title (badge-style)
 *   - Level + XP progress bar
 *   - Finance stats (wallet, bank, debt, net worth)
 *   - Empire stats (businesses, cards, shields, guns)
 *   - Marriage status
 *   - TOPBOY EMPIRE branding
 *
 * Falls back to text if canvas is unavailable.
 */

const fs = require("fs");
const axios = require("axios");

let canvasAvailable = false;
let createCanvas = null;
let loadImage = null;

try {
  const canvas = require("canvas");
  createCanvas = canvas.createCanvas;
  loadImage = canvas.loadImage;
  canvasAvailable = true;
} catch (e) {
  console.warn("⚠️ [profileRenderer] node-canvas not available:", e.message);
}

// ── Color palette ─────────────────────────────────────────────
const C = {
  bg: "#0d1117",
  bgGrad: "#161b22",
  accent: "#e94560",
  gold: "#f39c12",
  green: "#00d4aa",
  red: "#e74c3c",
  white: "#ffffff",
  gray: "#8b949e",
  darkGray: "#30363d",
  cardBg: "#1a1f2e",
};

// ── Net worth titles ─────────────────────────────────────────
const TITLES = [
  { min: 1e12, label: "👑 TOP BOY", color: "#ffd700" },
  { min: 5e11, label: "🦍 Crime Lord", color: "#e74c3c" },
  { min: 2e11, label: "🏦 Tycoon", color: "#3498db" },
  { min: 5e10, label: "💼 Mogul", color: "#9b59b6" },
  { min: 1e10, label: "🏢 Business King", color: "#f39c12" },
  { min: 2e9, label: "🚀 Entrepreneur", color: "#00d4aa" },
  { min: 5e8, label: "💰 Millionaire", color: "#f39c12" },
  { min: 1e8, label: "📈 Investor", color: "#3498db" },
  { min: 1e7, label: "💵 Hustler", color: "#00d4aa" },
  { min: 0, label: "🧍 Rookie", color: "#8b949e" },
];

function getTitle(net) {
  return TITLES.find(t => net >= t.min) || TITLES[TITLES.length - 1];
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

// ── Main renderer ────────────────────────────────────────────
/**
 * @param {Object} user — Mongoose User doc
 * @param {string|null} pfpUrl — profile picture URL or null
 * @param {Buffer|null} pfpBuffer — fallback pfp buffer (data/profile.jpg)
 * @param {Object} helpers — { calculateNetWorth, formatMoney, formatShort, cleanId, xpForNextLevel, createXPBar }
 * @returns {Promise<Buffer|null>} PNG buffer or null
 */
async function renderProfileCard(user, pfpUrl, pfpBuffer, helpers) {
  if (!canvasAvailable) return null;

  const { calculateNetWorth, formatMoney, formatShort, cleanId, xpForNextLevel } = helpers;

  const W = 600, H = 820;
  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext("2d");

  // ── Background ─────────────────────────────────────────
  const grad = ctx.createLinearGradient(0, 0, 0, H);
  grad.addColorStop(0, C.bg);
  grad.addColorStop(1, C.bgGrad);
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, W, H);

  // ── Top accent bar ──────────────────────────────────────
  const accentGrad = ctx.createLinearGradient(0, 0, W, 0);
  accentGrad.addColorStop(0, C.accent);
  accentGrad.addColorStop(0.5, C.gold);
  accentGrad.addColorStop(1, C.accent);
  ctx.fillStyle = accentGrad;
  ctx.fillRect(0, 0, W, 6);

  // ── Header: "TOPBOY EMPIRE" ─────────────────────────────
  ctx.fillStyle = C.white;
  ctx.font = "bold 26px sans-serif";
  ctx.textAlign = "center";
  ctx.shadowColor = "rgba(0,0,0,0.8)";
  ctx.shadowBlur = 4;
  ctx.shadowOffsetY = 2;
  ctx.fillText("TOPBOY EMPIRE", W / 2, 42);
  ctx.shadowBlur = 0;
  ctx.shadowOffsetY = 0;

  // ── Profile picture (circular with glow ring) ───────────
  const pfpCx = W / 2, pfpCy = 140, pfpR = 55;
  let pfpImg = null;

  // Try URL first, then buffer fallback
  if (pfpUrl) {
    try {
      const res = await axios.get(pfpUrl, { responseType: "arraybuffer", timeout: 8000 });
      pfpImg = await loadImage(Buffer.from(res.data));
    } catch {}
  }
  if (!pfpImg && pfpBuffer) {
    try { pfpImg = await loadImage(pfpBuffer); } catch {}
  }

  // Glowing ring
  ctx.save();
  ctx.strokeStyle = C.gold;
  ctx.lineWidth = 3;
  ctx.shadowColor = "rgba(243, 156, 18, 0.5)";
  ctx.shadowBlur = 15;
  ctx.beginPath();
  ctx.arc(pfpCx, pfpCy, pfpR + 4, 0, Math.PI * 2);
  ctx.stroke();
  ctx.restore();

  // Circular crop + draw image
  ctx.save();
  ctx.beginPath();
  ctx.arc(pfpCx, pfpCy, pfpR, 0, Math.PI * 2);
  ctx.closePath();
  ctx.clip();

  if (pfpImg) {
    // Cover-fit
    const aspect = pfpImg.width / pfpImg.height;
    let dw, dh;
    if (aspect > 1) { dh = pfpR * 2; dw = dh * aspect; } else { dw = pfpR * 2; dh = dw / aspect; }
    ctx.drawImage(pfpImg, pfpCx - dw / 2, pfpCy - dh / 2, dw, dh);
  } else {
    // No pfp → dark circle with emoji
    ctx.fillStyle = C.darkGray;
    ctx.fillRect(pfpCx - pfpR, pfpCy - pfpR, pfpR * 2, pfpR * 2);
    ctx.fillStyle = C.gray;
    ctx.font = "48px sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText("👤", pfpCx, pfpCy);
    ctx.textBaseline = "alphabetic";
  }
  ctx.restore();

  // ── User name ───────────────────────────────────────────
  ctx.fillStyle = C.white;
  ctx.font = "bold 22px sans-serif";
  ctx.textAlign = "center";
  ctx.shadowColor = "rgba(0,0,0,0.8)";
  ctx.shadowBlur = 4;
  const name = cleanId(user.userId);
  ctx.fillText(name, W / 2, 230);
  ctx.shadowBlur = 0;

  // ── Title (net worth badge) ──────────────────────────────
  const net = calculateNetWorth(user);
  const titleInfo = getTitle(net);
  ctx.fillStyle = titleInfo.color;
  ctx.font = "bold 18px sans-serif";
  ctx.fillText(titleInfo.label, W / 2, 258);

  // ── Marriage status ─────────────────────────────────────
  const maritalText = user.marriage?.spouseId
    ? `💍 Married to ${cleanId(user.marriage.spouseId)}`
    : "💔 Single";
  ctx.fillStyle = C.gray;
  ctx.font = "14px sans-serif";
  ctx.fillText(maritalText, W / 2, 280);

  // ── Level + XP bar ──────────────────────────────────────
  const neededXP = xpForNextLevel(user.level);
  const xpProgress = Math.min(1, (user.xp || 0) / neededXP);
  const barX = 80, barY = 310, barW = W - 160, barH = 22;

  // Bar background
  ctx.fillStyle = C.darkGray;
  roundRect(ctx, barX, barY, barW, barH, 6);
  ctx.fill();

  // XP fill
  const xpGrad = ctx.createLinearGradient(barX, 0, barX + barW, 0);
  xpGrad.addColorStop(0, C.green);
  xpGrad.addColorStop(1, "#00b894");
  ctx.fillStyle = xpGrad;
  if (xpProgress > 0) {
    roundRect(ctx, barX, barY, Math.max(barW * xpProgress, 4), barH, 6);
    ctx.fill();
  }

  // Level text
  ctx.fillStyle = C.white;
  ctx.font = "bold 14px sans-serif";
  ctx.textAlign = "center";
  ctx.fillText(`⭐ Level ${user.level}  |  XP: ${user.xp || 0} / ${neededXP}`, W / 2, barY - 8);

  // ── Stats section header ────────────────────────────────
  ctx.fillStyle = C.accent;
  ctx.font = "bold 16px sans-serif";
  ctx.textAlign = "left";
  ctx.fillText("💰 FINANCES", 50, 370);

  // Divider line
  ctx.strokeStyle = C.darkGray;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(50, 378);
  ctx.lineTo(W - 50, 378);
  ctx.stroke();

  // ── Finance stats ───────────────────────────────────────
  const totalIncome = (user.assets || []).reduce((s, a) => s + (a.income || 0), 0);
  const financeStats = [
    ["💵 Wallet", `$${formatMoney(user.wallet || 0)}`, C.green],
    ["🏦 Bank", `$${formatMoney(user.bank || 0)}`, C.white],
    ["💳 Debt", `$${formatMoney(user.debt || 0)}`, C.red],
    ["💎 Net Worth", `$${formatMoney(net)}`, C.gold],
    ["📈 Daily Income", `$${formatShort(totalIncome)}/day`, C.green],
  ];

  financeStats.forEach(([label, value, color], i) => {
    const y = 400 + i * 32;
    ctx.fillStyle = C.gray;
    ctx.font = "15px sans-serif";
    ctx.textAlign = "left";
    ctx.fillText(label, 50, y);
    ctx.fillStyle = color;
    ctx.font = "bold 15px sans-serif";
    ctx.textAlign = "right";
    ctx.fillText(value, W - 50, y);
  });

  // ── Empire section header ───────────────────────────────
  ctx.fillStyle = C.accent;
  ctx.font = "bold 16px sans-serif";
  ctx.textAlign = "left";
  ctx.fillText("📊 EMPIRE", 50, 580);

  ctx.strokeStyle = C.darkGray;
  ctx.beginPath();
  ctx.moveTo(50, 588);
  ctx.lineTo(W - 50, 588);
  ctx.stroke();

  // ── Empire stats (2-column grid) ────────────────────────
  const empireStats = [
    ["🏢 Businesses", String((user.assets || []).length), C.white],
    ["🎴 Cards", String((user.collection || []).length), C.white],
    ["🛡 Shields", String(user.tools?.shield || 0), C.white],
    ["🔫 Guns", String(user.tools?.gun || 0), C.white],
    ["🔥 Streak", `${user.streak || 0} days`, C.gold],
    ["📊 Total Gambles", String(user.totalGambles || 0), C.gray],
  ];

  const colW = (W - 100) / 2;
  empireStats.forEach(([label, value], i) => {
    const col = i % 2;
    const row = Math.floor(i / 2);
    const x = 50 + col * colW;
    const y = 610 + row * 35;

    ctx.fillStyle = C.gray;
    ctx.font = "13px sans-serif";
    ctx.textAlign = "left";
    ctx.fillText(label, x, y);
    ctx.fillStyle = C.green;
    ctx.font = "bold 15px sans-serif";
    ctx.textAlign = "right";
    ctx.fillText(value, x + colW - 20, y);
  });

  // ── Footer ──────────────────────────────────────────────
  ctx.fillStyle = C.accent;
  ctx.globalAlpha = 0.4;
  ctx.font = "11px sans-serif";
  ctx.textAlign = "center";
  ctx.fillText("TOPBOY EMPIRE v5.3.0", W / 2, H - 15);
  ctx.globalAlpha = 1;

  return canvas.toBuffer("image/png");
}

module.exports = {
  renderProfileCard,
  isReady: () => canvasAvailable,
  getTitle,
  TITLES,
};
