# PIXEL 100 RALLY

**English** | [日本語](README.ja.md)

An open-source, Firebase-powered real-time arithmetic race for 1–8 players. Race across a 5×5 or 10×10 board in addition, subtraction, multiplication, division, or greatest-common-divisor mode. Answer validation, movement, and timing run locally in each browser.

This repository does not contain the live deployment URL, Firebase project ID, Firebase app configuration, or deployment credentials. Run it with your own Firebase project or the local Emulator Suite.

## Features

- Anonymous authentication and player names
- Public room browser, optional passphrases, and rooms for 1–8 players
- Solo time attack and multiplayer READY races
- Five arithmetic modes, three difficulty levels, and 5×5 or 10×10 boards
- Deterministic problem generation from the same seed and complete game settings
- Top-five leaderboards for 30 mode, board-size, and difficulty categories, with the played seed shown
- Countdown, correct-answer, wrong-answer, and finish sound effects
- Mobile-focused active-cell centering with pinned row and column guides
- In-race exit support, recorded as DNF while racing
- Anyone can delete a finished room immediately; otherwise it is removed after about five minutes
- Active or results-pending rooms are removed two hours after the race starts; on Spark, a connected client or the next room-browser visit performs cleanup
- Physical keyboard and on-screen keypad input, including Clear, Backspace, PASS, and a not-divisible division answer
- Dot-based race progress driven only by completed-problem count; numeric scores and provisional rankings stay hidden
- 3–2–1–GO countdown, mobile board zoom, final-stretch display, and live results
- 30-second reconnection grace period, DNF handling, and automatic host transfer

## Tech stack

- React 19 / TypeScript / Vite
- Firebase Anonymous Authentication
- Firebase Realtime Database
- Firebase Hosting
- Vitest / Testing Library

Answer input, validation, cell movement, and timing are fully client-side. Realtime Database stores multiplayer state plus one category-best leaderboard entry per anonymous UID. Leaderboards are client-timed reference records and are not fully cheat-resistant.

## Local development

Install Node.js 22 and Java 21. The current Firebase Emulator Suite does not support Java 8. Firebase CLI is installed inside the project, so no global installation is required.

```powershell
Copy-Item .env.example .env.local
npm install
npm run emulators
```

`npm run emulators` automatically detects Java 21 and starts the Authentication, Realtime Database, and Hosting emulators.

In another terminal, start the frontend:

```powershell
npm run dev
```

- Web app: http://127.0.0.1:5173
- Emulator UI: http://127.0.0.1:4000

To test multiplayer locally, use browser contexts with separate anonymous-auth sessions, such as a regular window and a private window.

## Verification

```powershell
npm test
npm run build
```

To run the Firebase-backed Spark smoke test, start `npm run emulators`, then run the following command in another PowerShell window:

```powershell
node scripts/emulator-spark-smoke.mjs
```

## Production deployment

The free Spark edition runs on Anonymous Authentication, Realtime Database, and Hosting without Cloud Functions. To keep operator-specific Firebase information out of the source, configure your own project in `.env.local` and `.firebaserc` first.

```powershell
npm run deploy:spark
```

- See [DEPLOY.md](DEPLOY.md) for detailed instructions.

Room passphrases are stored as SHA-256 comparison values under the unreadable `roomSecrets` path. Leaderboards persist player names, times, and public seeds; do not enter personal information as a player name or seed.

## Contributing

Bug reports, improvements, translations, accessibility work, and new game modes are welcome. Read [CONTRIBUTING.md](CONTRIBUTING.md) and [SECURITY.md](SECURITY.md) before contributing.

## License

Released under the [MIT License](LICENSE). You may use, modify, redistribute, and commercially use this software as long as you retain the copyright notice and license text.
