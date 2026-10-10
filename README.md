# TOPBOY EMPIRE — WhatsApp Economy Bot

> **v6.2.0** — Full refactor + visual upgrades + LID normalization

A WhatsApp group-chat economy/gaming bot built on Baileys with MongoDB
persistence. 78 commands, animated gambling, card reveals, music playback,
rendered profile cards, and more.

## 🚀 Quick Start (1-Click Deploy)

### Option A: Render.com (Recommended — Free Tier)

[![Deploy to Render](https://render.com/images/deploy-to-render-button.svg)](https://render.com/deploy)

1. Click the button above (or go to Dashboard → New → Blueprint)
2. Connect your GitHub fork of this repo
3. Render reads `render.yaml` automatically
4. Add environment variables (see below)
5. Deploy — Render installs deps and starts the bot
6. Check logs for the pairing code, enter it in WhatsApp

### Option B: Railway

1. Go to [railway.app](https://railway.app) → New Project → Deploy from GitHub
2. Select this repo
3. Add environment variables (see below)
4. Railway auto-detects Node.js and runs `npm start`
5. Check logs for pairing code

### Option C: VPS (Ubuntu/Debian)

```bash
# 1. Clone the repo
git clone https://github.com/that1girlbryony-debug/TOPBOY-empire.git
cd TOPBOY-empire

# 2. Install Node.js 20+
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs

# 3. Install ffmpeg (required for GIF→MP4 + music)
sudo apt-get install -y ffmpeg

# 4. Install deps
npm install

# 5. Configure environment
cp .env.example .env
nano .env  # fill in MONGO_URI and PHONE_NUMBER

# 6. Start the bot
npm start

# 7. Check console for pairing code:
#    ╔═══════════════════════════╗
#     🔑 PAIRING CODE: XXXX-XXXX
#    ╚═══════════════════════════╝
#    Open WhatsApp → ⋮ → Linked Devices → Link with Phone Number
```

### Option D: Docker

```bash
# 1. Clone and configure
git clone https://github.com/that1girlbryony-debug/TOPBOY-empire.git
cd TOPBOY-empire
cp .env.example .env
nano .env  # fill in MONGO_URI and PHONE_NUMBER

# 2. Build and run
docker-compose up -d

# 3. Check logs for pairing code
docker-compose logs -f topboy

# 4. Stop
docker-compose down
```

### Option E: Heroku

```bash
# 1. Install Heroku CLI, then:
heroku create topboy-empire
heroku config:set MONGO_URI=your_mongodb_uri
heroku config:set PHONE_NUMBER=2348077016582

# 2. Add ffmpeg buildpack (required for GIFs + music)
heroku buildpacks:add --index 1 https://github.com/jonathanong/heroku-buildpack-ffmpeg-latest.git

# 3. Deploy
git push heroku main

# 4. Check logs for pairing code
heroku logs --tail
```

### Option F: PM2 (VPS with auto-restart)

```bash
# After Option C setup:
npm install -g pm2
pm2 start index.js --name topboy-empire
pm2 save
pm2 startup  # follow the instructions to enable auto-start on boot

# Useful commands:
pm2 logs topboy-empire    # view logs
pm2 restart topboy-empire  # restart
pm2 stop topboy-empire     # stop
```

## 🔧 Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `MONGO_URI` | **Yes** | MongoDB connection string. [Get free Atlas cluster](https://www.mongodb.com/atlas/database) |
| `PHONE_NUMBER` | **Yes** (first run) | WhatsApp phone number (country code + digits, e.g. `2348077016582`) |
| `PORT` | No | Express server port (default 3000, for health check on hosting) |
| `BOT_GROUP_LINK` | No | Official group invite link (shown when bot refuses unauthorized groups) |
| `YT_COOKIE` | No | YouTube cookie for `.play` music (prevents 429 on datacenter IPs) |

Copy `.env.example` to `.env` and fill in your values.

## ⚙️ Configuration (config.js)

Edit `config.js` to set:

```js
module.exports = {
    prefix: ".",                        // command prefix
    botName: "TOPBOY EMPIRE",
    ownerName: "Top Boy",

    // Just plain phone numbers — bot auto-resolves to LIDs at runtime
    ownerNumbers: [
        "2348077016582"                // your phone (country code + digits)
    ],

    cooldowns: { ... },                // per-command cooldowns
    mongoURI: process.env.MONGO_URI     // from .env
};
```

**No need to set `botLid`** — it's auto-detected when the bot connects.
**No need for `@lid` or `@s.whatsapp.net` suffixes** — just phone numbers.

## 📋 WhatsApp Pairing (First Run)

1. Start the bot: `npm start`
2. Console prints a pairing code: `🔑 PAIRING CODE: XXXX-XXXX`
3. On your phone: WhatsApp → ⋮ Menu → Linked Devices → Link a Device
4. Choose "Link with Phone Number"
5. Enter the pairing code (within 60 seconds)
6. Bot is now connected! The auth session is saved in `./auth/` for future runs

> **Hosting note**: The `./auth/` directory must persist across restarts.
> On Render, use a persistent disk (configured in `render.yaml`).
> On Docker, it's mounted as a volume in `docker-compose.yml`.

## 🎮 Commands (78 total)

### 💰 Economy
`.bal` `.dep` `.wd` `.give` `.send` `.daily` `.work` `.beg`
`.loan` `.payloan` `.bail` `.shop` `.buy` `.sell` `.assets`
`.inventory` `.profile` `.cd` `.lb [week/month]`

### 🎰 Gambling (Animated!)
`.casino` `.slots` `.cf` `.roulette` `.blackjack` `.dice`

All gambling commands send **animated MP4 videos** that play as looping
GIFs in WhatsApp (spinning wheels, reels, coin flips — rendered server-side
with node-canvas → GIF → MP4).

### 🎴 Cards (Animated Reveals!)
`.col` `.view` `.burn` `.claim` `.auction` `.bid` `.trade`
`.tradeaccept` `.tradereject` `.fuse` `.topcards`

Card reveals show a **flip animation** with tier-colored glow, particles
(Epic+), and shimmer sweep (Legendary/Mythic).

### 🎮 Mini Games
`.ttt` `.move` `.rps` `.throw` `.race` `.dogbet` `.pnt` `.pntjoin`

### 💣 Events
`.heist` `.join` `.protect` `.rob` `.lottery` `.lottery buy`

### 💍 Social
`.marry` `.divorce` `.spouse` `.marriageaccept` `.marriagereject`
`.slap` `.kill` `.yeet` `.kiss` `.wild` (reactions with animated GIFs)

### 🆕 New Features
`.blackjack` `.lottery` `.achievements` `.quest` `.quote`
`.topcards` `.inventory` `.play <song>` `.stop`

### 📋 Info
`.menu` `.help` `.about` `.test` `.debug` `.afk`

### 👑 Admin (group admin or owner)
`.ban` `.unban` `.kick` `.votekick` `.warn` `.warnings` `.clearwarns`
`.freeze` `.unfreeze` `.slowmode` `.mute` `.unmute` `.antilink`
`.promote` `.demote` `.tagall` `.broadcast` `.giveaway` `.airdrop`
`.rain` `.reset` `.addbal` `.seize` `.cdr` `.clearcooldowns`
`.setxp` `.setlevel` `.forcemarry` `.forcedivorce`
`.trivia` `.quiz` `.system` `.info` `.lid` `.gifcheck`

## 🎨 Visual Features

| Feature | Technology |
|---|---|
| Animated gambling (slots/casino/roulette/coinflip) | node-canvas → gif-encoder-2 → ffmpeg → MP4 |
| Animated card reveals (flip + glow + particles) | node-canvas → gif-encoder-2 → ffmpeg → MP4 |
| GIF reactions (.slap/.kiss/.kill/.yeet/.wild) | Giphy → ffmpeg → MP4 (with silent audio track) |
| Rendered profile card | node-canvas → PNG image |
| .play music | yt-search → ytdl-core → ffmpeg → OGG Opus → PTT |

### GIF Looping Fix
WhatsApp's `gifPlayback: true` requires a **silent audio track** in the
MP4. Without it, videos render as one-shot instead of looping. All three
animation pipelines (animator, cardRenderer, getGifAsMp4) now use:

```bash
ffmpeg -y -i input.gif \
  -f lavfi -i anullsrc=channel_layout=stereo:sample_rate=44100 \
  -shortest -c:v libx264 -preset veryfast -crf 23 \
  -pix_fmt yuv420p -vf scale=trunc(iw/2)*2:trunc(ih/2)*2,fps=15 \
  -c:a aac -b:a 32k -movflags faststart -tag:v avc1 \
  output.mp4
```

## 🎵 .play Music Setup

The `.play` command searches YouTube and sends audio as a WhatsApp voice note.

**Without cookies** (works on home WiFi, may fail on datacenter IPs):
```bash
.play Drake God's Plan
```

**With YouTube cookies** (recommended for VPS/cloud hosting):
1. Install [Get cookies.txt](https://chrome.google.com/webstore/detail/get-cookiestxt/bgaddhkoddajcdgocglldofjekigamnk) browser extension
2. Log into YouTube in your browser
3. Export cookies → save as `yt-cookie.txt`
4. Set `YT_COOKIE` env var to the cookie string

## 🗄️ MongoDB Setup

### Free Atlas Cluster (recommended)
1. Go to [mongodb.com/atlas](https://www.mongodb.com/atlas/database)
2. Create free M0 cluster
3. Database Access → Add user → save username/password
4. Network Access → Add IP → allow everywhere (0.0.0.0/0) or your server IP
5. Connect → "Connect your application" → copy connection string
6. Paste as `MONGO_URI` in `.env`

### Local MongoDB
```bash
sudo apt-get install -y mongodb-org
sudo systemctl start mongod
# MONGO_URI=mongodb://localhost:27017/topboy
```

## 🔄 Updates

```bash
git pull origin main
npm install
pm2 restart topboy-empire  # or just restart your process
```

The `./auth/` directory persists your WhatsApp session, so you won't
need to re-pair after updates.

## 📦 Tech Stack

| Component | Technology |
|---|---|
| WhatsApp API | @whiskeysockets/baileys |
| Database | MongoDB + Mongoose |
| Animation | node-canvas + gif-encoder-2 + ffmpeg |
| Music | yt-search + @distube/ytdl-core + ffmpeg |
| Image processing | sharp (via Baileys) + Jimp (fallback) |
| Server | Express (health check / keepalive) |
| Runtime | Node.js 20+ |

## 🏗️ Architecture

```
78 commands across 12 domain modules:

src/commands/economy/
  ├── progression.js  — .cd .daily .work .beg .lb .profile
  ├── money.js         — .bal .dep .wd .give .send
  ├── gamble.js        — .casino .slots .cf .roulette (animated!)
  ├── cards.js         — .col .view .burn (animated reveals!)
  ├── social.js        — .marry .divorce .slap .kiss .kill .yeet .wild
  ├── businesses.js    — .shop .buy .sell .assets .items .tools
  ├── info.js          — .menu .help .about .test .debug .afk
  ├── transactions.js  — .loan .payloan .bail .trade .fuse .rob
  ├── games.js         — .ttt .rps .dice .pnt .race .accept .roll .yes .no
  ├── events.js        — .heist .join .protect .claim .auction .bid
  ├── music.js         — .play .stop
  └── extras.js        — .blackjack .lottery .achievements .quest .quote .topcards .inventory
```

## 📋 License

MIT
