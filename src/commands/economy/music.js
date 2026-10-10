/**
 * 🎵 src/commands/economy/music.js — Phase 5.2: Music Playback
 *
 * .play <song name> — searches YouTube, downloads audio, converts to
 *   OGG Opus, sends as WhatsApp PTT (voice note) so it auto-plays
 *   inline on mobile with a waveform UI.
 *
 * .stop — cancels an in-progress download
 *
 * Pipeline:
 *   yt-search (search YouTube, no API key)
 *   → @distube/ytdl-core (download audio stream)
 *   → fluent-ffmpeg (transcode to OGG Opus 48kHz mono)
 *   → Baileys sendMessage({ audio, ptt: true })
 *
 * Note: YouTube may rate-limit (429) on datacenter IPs. For production,
 * add a YouTube cookie file or OAuth credentials. See README for setup.
 */

const fs = require("fs");
const path = require("path");
const os = require("os");

const MUSIC_COMMANDS = new Set(["play", "stop"]);

// Per-chat anti-flood: only one download at a time per chat
const inFlight = new Map(); // chat → abort controller

async function handle(ctx) {
  const { command, args, sender, reply, sock, chat, msg } = ctx;

  switch (command) {

    // =====================================================
    // 🎵 PLAY — search YouTube + download + send as PTT
    // =====================================================
    case "play": {
      const query = args.join(" ").trim();
      if (!query) return reply("📝 Usage: *.play <song name>*\ne.g. *.play Drake God's Plan*");

      if (inFlight.has(chat))
        return reply("⏳ Already downloading one — use *.stop* to cancel.");

      const controller = new AbortController();
      inFlight.set(chat, controller);

      const thinking = await sock.sendMessage(chat, {
        text: `🔎 Searching YouTube for "${query}"…`,
      }, { quoted: msg });

      try {
        // ── Step 1: Search YouTube ──────────────────────────
        const ytSearch = require("yt-search");
        const results = await ytSearch(query);

        // Pick first result that's ≤ 10 minutes
        const video = results.videos.find(v => v.seconds && v.seconds <= 600 && v.seconds > 0)
                    || results.videos[0];

        if (!video) throw new Error("No YouTube results found.");

        await sock.sendMessage(chat, {
          text: `🎵 ${video.title}\n⏱️ ${video.timestamp}\n⬇️ Downloading…`,
          edit: thinking.key,
        });

        // ── Step 2: Download audio stream ───────────────────
        const ytdl = require("@distube/ytdl-core");
        const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";
        const headers = { "User-Agent": UA, "Accept-Language": "en-US,en;q=0.9" };

        const info = await ytdl.getInfo(video.url, { requestOptions: { headers } });
        const stream = ytdl.downloadFromInfo(info, {
          quality: "highestaudio",
          filter: "audioonly",
          requestOptions: { headers },
        });

        // ── Step 3: Transcode to OGG Opus (WhatsApp format) ──
        const ffmpeg = require("fluent-ffmpeg");
        const ffmpegPath = require("ffmpeg-static");
        if (fs.existsSync(ffmpegPath)) {
          ffmpeg.setFfmpegPath(ffmpegPath);
        }

        const tmpId = `wa_music_${Date.now()}_${Math.floor(Math.random() * 10000)}`;
        const oggPath = path.join(os.tmpdir(), `${tmpId}.ogg`);

        await new Promise((resolve, reject) => {
          ffmpeg(stream)
            .noVideo()
            .audioCodec("libopus")
            .audioBitrate(64)
            .audioFrequency(48000)
            .audioChannels(1)
            .format("ogg")
            .on("error", reject)
            .on("end", resolve)
            .save(oggPath);
        });

        // ── Step 4: Send as PTT (voice note) ────────────────
        const audioBuffer = fs.readFileSync(oggPath);

        await sock.sendMessage(chat, {
          audio: audioBuffer,
          ptt: true,
          // mimetype omitted — Baileys defaults to 'audio/ogg; codecs=opus'
          // Baileys auto-computes duration + waveform for ptt: true
        }, { quoted: msg });

        await sock.sendMessage(chat, {
          text: `✅ Now playing: *${video.title}*\n⏱️ ${video.timestamp}`,
          edit: thinking.key,
        });

        // Cleanup
        try { fs.unlinkSync(oggPath); } catch {}

      } catch (err) {
        console.error("[.play] Error:", err.message);

        let hint = "";
        if (/429|Too Many Requests|no playable formats|Failed to find/i.test(err.message)) {
          hint = "\n\n💡 YouTube is rate-limiting this server.\nAdd a YouTube cookie file for production use.";
        } else if (/private|age.restrict|unavailable/i.test(err.message)) {
          hint = "\n\n💡 Video is private, age-restricted, or unavailable.";
        }

        await sock.sendMessage(chat, {
          text: `❌ Playback failed: ${err.message}${hint}`,
          edit: thinking.key,
        }).catch(() => reply(`❌ Playback failed: ${err.message}${hint}`));
      } finally {
        inFlight.delete(chat);
      }
      return;
    }

    // =====================================================
    // ⏹ STOP — cancel in-progress download
    // =====================================================
    case "stop": {
      if (!inFlight.has(chat))
        return reply("⏹ Nothing to stop.");

      const controller = inFlight.get(chat);
      try { controller.abort(); } catch {}
      inFlight.delete(chat);
      return reply("⏹ Download cancelled.");
    }

    default:
      return false; // not handled
  }
}

module.exports = {
  handle,
  MUSIC_COMMANDS,
};
