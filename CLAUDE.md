# CLAUDE.md

This file gives Claude/Codex-style agents the project context needed to work safely in this repository.

## Project Overview

`whos_undercover` is a web-based multiplayer "Who is Undercover" game.

- Frontend: React 18 + Vite + Tailwind CSS in `client/`.
- Backend: Node.js + Express + Socket.IO in `server/`.
- Runtime state: in-memory rooms and players, no database.
- Realtime channel: Socket.IO namespace `/game`.
- Voice: browser `MediaRecorder` uploads audio files to `server/uploads/`.
- Access control: password gate via `GAME_PASSWORD`, verified by session id stored in browser `localStorage`.
- Optional notifications: `webhook.config.json` supports generic HTTP webhooks and NapCat QQ group messages.

The app is primarily Chinese-language user-facing UI.

## Repository Layout

```text
client/
  src/
    App.jsx                 Global app state, auth flow, socket listeners, page switching
    socket.js               Socket.IO client configured for /game
    pages/
      GatePassword.jsx      Password gate and local lockout
      Home.jsx              Create/join/browse rooms, spectate request, mic test
      Room.jsx              Waiting room, ready state, undercover count
      Game.jsx              Main game UI and phase-specific interactions
    components/
      PlayerCard.jsx
      VotePanel.jsx
      VoiceRecorder.jsx
      Timer.jsx
      GameResult.jsx
    styles/index.css        Tailwind base and shared component classes
server/
  index.js                  Express app, auth API, voice upload, room API, socket events
  game.js                   Room model, game phases, role/word/vote/win logic
  words.js                  Built-in word pairs
  webhook.js                Optional game_start notification delivery
package.json                Root scripts and backend dependencies
pnpm-workspace.yaml         Workspace includes client
webhook.config.example.json Example webhook config
```

## Common Commands

Prefer `pnpm`.

```bash
pnpm install
pnpm run dev
pnpm run build
pnpm test
pnpm start
```

Development:

- `pnpm run dev` starts backend and frontend concurrently.
- Backend listens on `PORT` or `3001`.
- Frontend Vite dev server listens on `5173` and proxies `/api` and `/socket.io` to `127.0.0.1:3001`.

Production:

- `pnpm start` builds `client/dist` and runs `server/index.js` with `NODE_ENV=production`.
- In production, Express serves the built frontend from `client/dist`.

Testing:

- `pnpm test` runs Node's built-in `node:test` suite in `test/*.test.js`.
- Tests instantiate `Room` from `server/game.js` directly. They do not start Express/Socket.IO and do not trigger `sendWebhook`.
- The core suite covers one 4-player/1-undercover game and one 10-player/3-undercover game through word changes, speeches, votes, undercover guesses, and game-over paths.
- It also covers repeated tie battle rounds and verifies battle speech history labels.

## Environment And Config

Create `.env` from `.env.example` when running locally:

```bash
GAME_PASSWORD=your_password_here
```

If unset, the backend falls back to `default123`.

Optional webhook config:

```bash
cp webhook.config.example.json webhook.config.json
```

`webhook.config.json` is read on each webhook send. The only current event emitted is `game_start`.

## Core Backend Model

`server/game.js` owns the pure game state through the `Room` class.

Important phases:

- `waiting`: players join and prepare.
- `playing`: words have been assigned, players have 30 seconds to view words and can vote to change words.
- `speaking`: alive players speak in a randomized order.
- `voting`: alive players vote to eliminate one alive non-self target.
- `result`: one round's vote result is visible; host can start the next round, and the server auto-starts the next round after 15 seconds if no host action occurs.
- `undercover_guess`: an eliminated undercover has 30 seconds to guess the civilian word, depending on room setting.
- `game_over`: winner and words are revealed.

Room constraints and rules:

- 4 minimum players to start.
- 12 maximum players per room.
- Undercover count is clamped to `1..floor((players - 1) / 2)`.
- Host is the first player and is auto-ready.
- If host leaves in waiting, host transfers to the first remaining player.
- Tied votes do not enter `result`. They start an extra battle speaking round for the tied candidates only, labelled `平票battle-1`, `平票battle-2`, etc. All alive players then vote again, but targets are limited to the tied candidates. Repeat until one player has the highest vote count and is eliminated.
- Game over if all undercovers are gone, or alive undercover count is greater than or equal to alive civilian count.
- `undercoverGuessMode` is room-level waiting-stage config. Default is `every_undercover`; `final_undercover` preserves the older "only final undercover guesses" behavior.
- In `every_undercover` mode, any eliminated undercover gets the `undercover_guess` chance. Correct guess makes undercovers win immediately. Failed guess continues the game if other undercovers remain, otherwise civilians win.
- Result auto-advance is server-side (`server/index.js`) so the game continues even if the host closes the window during a result phase.

Rooms are stored in the exported `rooms` Map. Restarting the Node process clears all rooms.

## Socket Events

All game sockets use the `/game` namespace and require `handshake.auth.sessionId` to match a verified session.

Client-to-server events handled in `server/index.js`:

- `create-room`
- `join-room`
- `player-ready`
- `set-undercover-count`
- `set-undercover-guess-mode`
- `start-game`
- `vote-change-word`
- `submit-speech`
- `submit-vote`
- `submit-undercover-guess`
- `next-round`
- `play-again`
- `force-close-room`
- `request-spectate`
- `approve-spectate`
- `reject-spectate`

Server-to-client events used by the React app:

- `room-update`
- `your-word`
- `words-changed`
- `phase-change`
- `vote-result`
- `undercover-guess-result`
- `game-reset`
- `player-disconnect-countdown`
- `game-aborted`
- `room-closed`
- `spectate-request`
- `spectate-approved`
- `spectate-rejected`

When changing game behavior, update both the `Room` state transitions and the socket/UI expectations.

## Frontend State Flow

`client/src/App.jsx` is the top-level coordinator:

- Generates and persists `wuc_player_id`.
- Stores player name, avatar, and last room in `localStorage`.
- Checks URL password params `?password=` or `?pwd=`, then removes them from the URL.
- Connects Socket.IO only after password auth succeeds.
- Rejoins a saved room on reconnect.
- Switches between `home`, `room`, and `game` pages based on room phase.
- Tracks spectator mode separately from player mode.

Page responsibilities:

- `Home.jsx`: player setup, create/join, room list polling, spectator request, microphone test.
- `Room.jsx`: ready state, start game, undercover count, undercover guess mode, room code copying.
- `Game.jsx`: phase UI, word reveal, change-word vote, speech submission, voice recorder, voting, result modal, final undercover guess, host force-close.

## HTTP APIs

Express routes:

- `POST /api/verify-password`: verifies password and records a session id in memory.
- `GET /api/rooms`: returns waiting and spectatable rooms.
- `POST /api/upload-voice`: accepts one `voice` file, max 5 MB.
- `GET /api/voice/:filename`: serves uploaded audio files.

The `/api` routes are protected by `requireAuth`, except `/api/verify-password`.

## Important Implementation Notes

- Source files contain Chinese UI text and comments. Preserve UTF-8 encoding.
- Do not introduce a database unless explicitly requested; the current architecture is intentionally in-memory.
- Uploaded voice files are stored under `server/uploads/`, which is runtime data and should not be committed.
- Socket.IO uses both `polling` and `websocket` transports. Keep this unless there is a concrete reason to change it.
- Vite proxy is important for mobile/LAN development because the client uses relative `/api` and `/socket.io` paths.
- Spectators are not players. They should not be allowed to ready, speak, vote, guess, change words, or force-close rooms.
- The server uses timers for word-preview, final guess, disconnect handling, and inactive room cleanup. Clear timers when closing rooms or resetting flows.
- The frontend has localStorage-based reconnect behavior for players, but spectators intentionally do not persist room membership.
- Public room state deliberately hides living players' roles and hides words until game over. Be careful not to leak `word` or `role` in `getPublicState()`.

## Verification Guidance

For small changes:

```bash
pnpm test
pnpm run build
```

For realtime/UI changes, manually exercise at least:

- Password gate.
- Create room and join with 4 players or browser profiles.
- Start game, receive private words, submit text speech, vote, next round.
- Final undercover guess path and multi-undercover guess mode.
- Disconnect/reconnect behavior.
- Spectator request approval/rejection if spectating code changed.
- Voice upload/playback if audio code changed.
