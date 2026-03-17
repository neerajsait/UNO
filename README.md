# 🎴 UNO Online — Multiplayer Card Game

<div align="center">

![Node.js](https://img.shields.io/badge/Node.js-18+-339933?style=for-the-badge&logo=node.js&logoColor=white)
![Socket.IO](https://img.shields.io/badge/Socket.IO-4.7-010101?style=for-the-badge&logo=socket.io&logoColor=white)
![Express](https://img.shields.io/badge/Express-4.18-000000?style=for-the-badge&logo=express&logoColor=white)
![License](https://img.shields.io/badge/License-MIT-blue?style=for-the-badge)

**Play UNO with friends in real-time! No downloads, no sign-ups — just share a link and play.**

[Play Now](#-quick-start) • [Features](#-features) • [Deploy Free](#-deploy-for-free) • [Screenshots](#-screenshots)

</div>

---

## ✨ Features

### 🎮 Core Gameplay
- **Full UNO Rules** — skip, reverse, draw two, wild, wild draw four
- **Wild Draw Four Challenge** — challenge opponents who play illegal WD4s
- **UNO Call System** — call UNO with 1 card, get penalized if caught
- **Score Tracking** — persistent scores across rounds
- **Draw-Then-Play** — play a drawn card immediately if valid

### 🤖 AI Bot Players
- **3 Difficulty Levels** — Easy (random), Medium (strategic), Hard (pro)
- **Realistic Behavior** — bots play with natural delays, call UNO, choose colors intelligently
- **Host Controls** — add/remove bots from the lobby

### 🎨 UI/UX
- **Card Animations** — deal, play, draw, and discard animations
- **4 Themes** — Dark, Light, Ocean, Sunset
- **Mobile Responsive** — works on phones, tablets, and desktops
- **Sound Effects** — synthesized in-browser (Web Audio API, zero external files)
- **Background Music** — procedurally generated, toggle on/off
- **12 Avatar Emojis** — pick your avatar in the lobby
- **Quick Chat** — predefined messages for fast communication
- **Card Hand Sorting** — sort by color, value, or none
- **Keyboard Shortcuts** — D=draw, U=UNO, 1-9=play card, S=sort

### 🔧 Room Features
- **Share Invite Link** — one-click copy invite URL
- **Custom House Rules** — stacking, jump-in, play-after-draw, turn timer
- **Spectator Mode** — watch ongoing games
- **Host Controls** — kick players, pause/resume game
- **Emoji Reactions** — react with 😂😮😡🎉👏💀🔥❤️
- **Chat System** — in-game text chat with 200-message history

### 🔒 Security
- **Rate Limiting** — per-event throttling, auto-disconnect on abuse
- **Input Validation** — all inputs sanitized server-side
- **CORS Locked** — configurable allowed origins
- **Crypto Sessions** — `crypto.randomBytes` reconnection tokens
- **Security Headers** — X-Frame-Options, CSP, XSS Protection
- **Room Cleanup** — 30-min idle timeout

---

## 🚀 Quick Start

```bash
# Clone the repo
git clone https://github.com/YOUR_USERNAME/uno-game.git
cd uno-game

# Install dependencies
npm install

# Start the server
npm start
```

Open **http://localhost:3000** — create a room, share the code, and play!

---

## 📁 Project Structure

```
uno-game/
├── public/
│   ├── index.html      # Game UI (lobby + game screens)
│   ├── style.css        # Premium CSS with themes & animations
│   ├── client.js        # Client logic (Socket.IO, rendering, features)
│   └── sounds.js        # Web Audio API sound effects & music
├── server/
│   ├── server.js        # Express + Socket.IO server entry
│   ├── socketHandler.js # All socket event handlers
│   ├── gameLogic.js     # Server-authoritative game engine
│   ├── botPlayer.js     # AI bot logic (3 difficulties)
│   └── rateLimiter.js   # Rate limiting & input validation
├── package.json
└── README.md
```

---

## ⚙️ Environment Variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `PORT` | No | `3000` | Server port |
| `ALLOWED_ORIGINS` | Yes (prod) | `http://localhost:3000` | Comma-separated CORS origins |

---


## 🎮 How to Play

1. **Create a Room** — enter a nickname, pick an avatar, hit Create Room
2. **Share the Code** — click "Copy Invite Link" or share the 6-letter room code
3. **Add Bots** (optional) — host can add Easy/Medium/Hard AI players
4. **Configure Rules** — toggle stacking, jump-in, turn timer, etc.
5. **Start the Game** — host clicks Start Game when everyone's ready
6. **Play Cards** — click playable cards (highlighted), draw if you can't play
7. **Call UNO** — press U or click the UNO button when you have 1 card!

---

## 🛡️ Is It Safe to Deploy?

**Yes.** This app:

- ✅ Has **no database** — nothing is stored permanently
- ✅ Collects **no personal data** — only a nickname (not even stored)
- ✅ Makes **no external API calls** — zero outbound requests  
- ✅ Uses **no paid services** — runs on Node.js alone
- ✅ Has **no authentication** — no passwords, no emails, no accounts
- ✅ All game state is **in-memory only** — wiped on server restart
- ✅ **Rate limited** — prevents spam and abuse
- ✅ **Input validated** — all data sanitized server-side

There is **zero risk** of data leaks, charges, or security breaches. The worst that can happen is someone joins your game uninvited (room codes are 6 chars = 887 million combos).

---

## 📜 License

MIT — free to use, modify, and distribute.

---

<div align="center">

**Made with ❤️ — Have fun playing UNO!**

</div>
