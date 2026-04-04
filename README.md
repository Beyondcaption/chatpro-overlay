# ChatPro Overlay
### Floating German reply tool for OnlyFans chatters
Works with CreatorHero, Usly, or any app on Windows & Mac.

---

## How it works
1. Chatter is inside CreatorHero / Usly as normal
2. They see a German message from a subscriber
3. Press **Ctrl+Shift+T** (Windows) or **Cmd+Shift+T** (Mac)
4. Small floating window appears — always on top
5. Paste German message + type English reply
6. Get 3 native German variants with back-translations
7. Click **Copy & Use** — text goes to clipboard
8. Paste directly into CreatorHero/Usly — done

**OR** — turn on auto-detect:
The overlay opens automatically the moment you copy
a German message from the CRM. Zero hotkey needed.

---

## Build instructions (for developer)

### Prerequisites
- Node.js 18+ installed
- npm installed

### Install dependencies
```bash
cd chatpro-overlay
npm install
```

### Test locally (before building)
```bash
npm start
```

### Build for Windows (.exe installer)
```bash
npm run build:win
# Output: dist/ChatPro Overlay Setup 1.0.0.exe
```

### Build for Mac (.dmg)
```bash
npm run build:mac
# Output: dist/ChatPro Overlay-1.0.0.dmg
```

### Build both at once
```bash
npm run build:all
```

---

## Distribution to chatters

### Windows
Send them: `ChatPro Overlay Setup 1.0.0.exe`
They double-click → installs → appears in system tray

### Mac
Send them: `ChatPro Overlay-1.0.0.dmg`
They open → drag to Applications → launch

---

## First-time setup (chatter)
1. Launch ChatPro Overlay
2. Click the tray icon → Settings
3. Enter Anthropic API key (sk-ant-...)
4. Done — press Ctrl+Shift+T to start

---

## Self-learning
The app learns from real outcomes — not from rating German text.
After using a reply, the overlay asks: Replied / Tipped / Quiet / Left.
Every 15 outcomes → Claude auto-generates new style rules.
Rules get injected into every future translation.
Gets noticeably smarter after ~30-50 tracked outcomes.

---

## Files
```
src/
  main.js       — Electron main process (hotkey, tray, clipboard)
  preload.js    — Secure IPC bridge
  overlay.html  — The floating translation window
  settings.html — Settings & learning dashboard
```
