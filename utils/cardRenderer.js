/**
 * 🎨 Card Renderer
 * Generates card display with jimp overlay
 * Uses composite approach instead of pixel loops
 */

const Jimp = require("jimp");
const axios = require("axios");
const { formatMoney } = require("./helpers");

const TIER_COLORS = {
    Common:    { border: 0x888888FF, bg: 0x2D2D2DFF, hex: 0x888888 },
    Rare:      { border: 0x3498DBFF, bg: 0x1A3A5CFF, hex: 0x3498DB },
    Epic:      { border: 0x8E44ADFF, bg: 0x3D1A5CFF, hex: 0x8E44AD },
    Legendary: { border: 0xF39C12FF, bg: 0x5C4A1AFF, hex: 0xF39C12 },
    Mythic:    { border: 0xE74C3CFF, bg: 0x5C1A1AFF, hex: 0xE74C3C }
};

const TIER_EMOJI = {
    Common: "⚪", Rare: "🔵", Epic: "🟣", Legendary: "🟡", Mythic: "🔴"
};

async function downloadImage(url) {
    const response = await axios.get(url, {
        responseType: "arraybuffer",
        timeout: 10000,
        maxContentLength: 5 * 1024 * 1024
    });
    return Buffer.from(response.data);
}

/**
 * Fill a rectangular region on a jimp image
 */
function fillRect(img, x, y, w, h, color) {
    const x2 = Math.min(x + w, img.bitmap.width);
    const y2 = Math.min(y + h, img.bitmap.height);
    for (let py = y; py < y2; py++) {
        for (let px = x; px < x2; px++) {
            if (px >= 0 && py >= 0 && px < img.bitmap.width && py < img.bitmap.height) {
                img.setPixelColor(color, px, py);
            }
        }
    }
}

async function generateCardImage(card) {
    try {
        const width = 400;
        const height = 560;
        const border = 8;
        const pad = 20;
        const imgW = width - pad * 2;
        const imgH = 340;

        const colors = TIER_COLORS[card.tier] || TIER_COLORS.Common;

        // Step 1: Create full card with border color
        const cardImg = new Jimp(width, height, colors.border);

        // Step 2: Fill inner area with background color (creates border effect)
        fillRect(cardImg, border, border, width - border * 2, height - border * 2, colors.bg);

        // Step 3: Download and composite character image
        try {
            const imgBuffer = await downloadImage(card.image);
            const charImg = await Jimp.read(imgBuffer);
            charImg.cover(imgW, imgH);
            cardImg.composite(charImg, pad, pad);
        } catch {
            // Placeholder if image fails
            const ph = new Jimp(imgW, imgH, 0x444444FF);
            cardImg.composite(ph, pad, pad);
        }

        // Step 4: Tier accent line under image
        const barY = pad + imgH + 10;
        fillRect(cardImg, pad, barY, imgW, 4, colors.border);

        // Step 5: Bottom section background (semi-transparent feel)
        fillRect(cardImg, border, barY + 8, width - border * 2, height - barY - border - 8, colors.bg);

        // Step 6: Add text
        try {
            const font32 = await Jimp.loadFont(Jimp.FONT_SANS_32_WHITE);
            const font16 = await Jimp.loadFont(Jimp.FONT_SANS_16_WHITE);

            const nameY = barY + 30;
            cardImg.print(font32, pad, nameY, {
                text: card.name,
                alignmentX: Jimp.HORIZONTAL_ALIGN_CENTER
            }, imgW);

            const tierY = nameY + 50;
            cardImg.print(font16, pad, tierY, {
                text: `${TIER_EMOJI[card.tier] || "⚪"} ${card.tier}`,
                alignmentX: Jimp.HORIZONTAL_ALIGN_CENTER
            }, imgW);

            const worthY = tierY + 30;
            cardImg.print(font16, pad, worthY, {
                text: `$${formatMoney(card.worth)}`,
                alignmentX: Jimp.HORIZONTAL_ALIGN_CENTER
            }, imgW);

        } catch (e) {
            console.error("Font error:", e.message);
        }

        return await cardImg.getBufferAsync(Jimp.MIME_PNG);

    } catch (err) {
        console.error("Card render error:", err.message);
        return null;
    }
}

function renderCardText(card) {
    const emoji = TIER_EMOJI[card.tier] || "⚪";
    return `🎴 ${card.name}\n${emoji} ${card.tier}\n💰 $${formatMoney(card.worth)}`;
}

module.exports = {
    generateCardImage,
    renderCardText,
    TIER_EMOJI
};