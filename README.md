# Desi Quiz Clash 🇮🇳

A mobile-friendly, bilingual (Hindi + English) real-time party quiz for 2–8 players. It uses Node.js, Express, and Socket.IO. The web server hosts the frontend and the realtime game server together, so one public URL is enough for phones and laptops to join the same room.

## What's built

- Create a room with a random 6-character code, or join an existing lobby.
- No account or registration; each browser gets a random local session key.
- Nickname rules: 2–16 letters/numbers/spaces, whitespace trimmed, duplicate names get a numeric suffix.
- Lobby, host start, lobby-only player removal, room close control and room-code copy.
- 12 questions per match: 3 each from Indian GK, Cricket, Bollywood and Science.
- Exact match difficulty balance: 4 easy, 5 medium, 3 hard.
- 80-question bank (20 per category). Each question has bilingual wording, four bilingual options, one verified key and a short bilingual fact.
- Shuffled question order and option order, with correct-answer mapping preserved.
- 15-second server-controlled question timer; players may change their selection until time runs out. Answers stay private during the timer.
- Correct answer + fact + live leaderboard appears for 8 seconds after each question.
- Scoring: +100 correct, 0 wrong/unanswered; shared ranks and joint winners on ties.
- 60-second reconnect window; same browser key and nickname restore the player's score.
- Automatic host transfer to the earliest-joined connected player if the current host leaves or disconnects.
- Results screen with leaderboard, winner, stats, full question/fact review, and same-room rematch.
- Room closes after 60 seconds with nobody connected; host can close from lobby/results, not during a live match.
- `/healthz` health-check endpoint for deployment.

## Requirements

- Node.js 20 or newer
- npm

## Run on your computer

1. Extract the project ZIP, then open a terminal in the `desi-quiz-clash` folder.
2. Install packages:

   ```bash
   npm install
   ```

3. Start the game server:

   ```bash
   npm start
   ```

4. Open `http://localhost:3000` in your browser.

### Test with friends on the same Wi-Fi

Find your computer's local IPv4 address (Windows: run `ipconfig` and look for IPv4 Address). On another phone or laptop on the same Wi-Fi, open `http://YOUR-LOCAL-IP:3000`. For example, `http://192.168.1.25:3000`. Allow Node.js through your computer's firewall if prompted. `localhost` only works on the same computer; use the local IP from other devices.

## Publish at a public URL (Render)

The project is set up as a single Node web service, which supports both the web page and realtime Socket.IO connection.

1. Create a GitHub repository and upload all files in this folder. Do not upload `node_modules`.
2. In Render, choose **New → Web Service**, connect the repository, and select the latest branch.
3. Use these settings:
   - **Runtime:** Node
   - **Build command:** `npm install`
   - **Start command:** `npm start`
   - **Health check path:** `/healthz`
4. Deploy. Render assigns a public `https://...onrender.com` URL. Share that URL with friends; the host creates a room and shares the 6-character room code.

Render supports public WebSocket connections and gives web services public `onrender.com` URLs. The app binds to `0.0.0.0` and uses the platform-provided `PORT` automatically.

## Important MVP limitations

- **Room state is held in server memory.** The first version is designed for one server instance and casual private games. A server restart, redeploy, or instance sleep may close rooms and reset active matches; scores and rooms are not stored in a permanent database.
- On Render's free web-service plan, idle services may sleep. Use a plan appropriate to your intended play experience; a sleeping service may delay first connection. Keep a single instance for this memory-based version.
- Room codes are for casual private play, not strong access control. Anyone who learns a room code may try to join its lobby. Do not put private information in nicknames.
- The 80-question bank is a hand-authored starter bank. Review wording and facts before a public launch, and expand it as players request more topics.
- This code handles application-level reconnects and host handoff, but cannot preserve in-memory rooms through a server process restart. A later production version could add a shared persistent store (such as Redis or a database) before horizontal scaling.

## Helpful commands

```bash
npm test   # Validate the question bank and match distribution
npm start  # Run the app
```
