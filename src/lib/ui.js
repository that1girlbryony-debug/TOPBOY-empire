/**
 * 🛠 lib/ui.js — Phase 2 / 2.1
 * Unified UI helpers for WhatsApp message panels.
 *
 * Replaces:
 *   - The dead header()/footer()/successBox()/errorBox()/infoBox()
 *     functions defined in old economy.js (lines 2069-2102) but
 *     never actually called — every command reinvented its panel.
 *   - The inconsistent divider widths: ▬▬▬▬▬▬▬▬▬▬▬▬▬ (12) vs
 *     ▬▬▬▬▬▬▬▬▬▬▬▬▬▬ (14) mixed within the same message.
 *
 * All panels now go through panel() — single source of truth for
 * divider width (14), structure, and spacing.
 *
 * Note: WhatsApp doesn't render monospace, so ASCII-art alignment
 * looks slightly off on phone screens regardless. We pick 14 chars
 * because that's what most existing panels used (the minority 12-char
 * ones are being phased out in Phase 3 visual consistency work).
 */

const DIVIDER = "▬▬▬▬▬▬▬▬▬▬▬▬▬▬"; // 14 chars — single source of truth

/**
 * Build a standard panel: divider + bold title + divider + body + divider.
 * @param {string} title — bold title (no asterisks needed)
 * @param {string} body — body content (already-formatted text)
 * @returns {string} formatted panel
 *
 * Example output:
 *   ▬▬▬▬▬▬▬▬▬▬▬▬▬▬
 *   *BALANCE*
 *   ▬▬▬▬▬▬▬▬▬▬▬▬▬▬
 *
 *   💰 Wallet: $1,000
 *   🏦 Bank: $5,000
 *
 *   ▬▬▬▬▬▬▬▬▬▬▬▬▬▬
 */
function panel(title, body = "") {
  const out = [DIVIDER, `*${title}*`, DIVIDER];
  if (body) {
    out.push(""); // blank line between header and body
    out.push(body);
    out.push(""); // blank line before footer divider
  }
  out.push(DIVIDER);
  return out.join("\n");
}

/**
 * Build a section header (smaller than panel — no top/bottom divider,
 * just the title bar). Used inside longer messages.
 */
function section(title) {
  return `${DIVIDER}\n*${title}*`;
}

/** Just the divider — for inline use */
function divider() {
  return DIVIDER;
}

/**
 * Success box — green checkmark prefix on title.
 * For positive outcomes (claim, win, transfer).
 */
function successBox(title, lines = []) {
  return panel(`✅ ${title}`, lines.join("\n"));
}

/**
 * Error box — red X prefix on title.
 * For failures (insufficient funds, not registered, etc.)
 */
function errorBox(title, lines = []) {
  return panel(`❌ ${title}`, lines.join("\n"));
}

/**
 * Info box — info emoji prefix on title.
 * For neutral informational panels.
 */
function infoBox(title, lines = []) {
  return panel(`ℹ️ ${title}`, lines.join("\n"));
}

module.exports = {
  DIVIDER,
  panel,
  section,
  divider,
  successBox,
  errorBox,
  infoBox,
};
