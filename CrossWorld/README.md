# CrossWorld

A playable real-time collaborative crossword prototype for 2-4 players.

This build is dependency-free because `npm` is not available in the local environment. It keeps the MVP behavior from the requested stack:

- Node HTTP server
- Server-Sent Events for live multiplayer synchronization
- POST endpoints for lobby, cursor, cell, ready, start, leave, and chat events
- In-memory realtime state with clean seams for Redis/PostgreSQL persistence later
- Browser-native frontend with polished responsive UI

## Run

```sh
npm start
```

Open:

```txt
http://127.0.0.1:3000
```

## Render Deployment

Use a Web Service with these settings:

- Build Command: `npm install`
- Start Command: `npm start`
- Environment Variables: none required

Render will provide `PORT`; `server.js` uses `process.env.PORT || 3000`.

## Implemented

- Login/profile simulation with persistent username and generated avatar styling
- Private lobby creation and invite-code join
- Max four players, ready/unready, host start, connected player list
- 15x15 crossword with black squares, clue numbering, clue highlighting, typing, backspace, arrows, and enter direction toggle
- Live multiplayer sync for typed letters, active cells, highlighted clues, player cursors, presence, chat, and completion
- Clue ownership assigned to the player who enters the final correct letter
- Sidebar contribution tracking, completion meter, owner avatars beside solved clues
- Lobby-only realtime chat with timestamps and collapsible panel
- Results screen with completion time, rankings, clue totals, and accuracy
- Desktop-first layout plus mobile-friendly sidebars/chat handling

## Upgrade Path

The current API events map directly to the requested Socket.IO event names:

- `PLAYER_JOINED`
- `PLAYER_LEFT`
- `PLAYER_READY`
- `GAME_STARTED`
- `CELL_UPDATED`
- `CURSOR_MOVED`
- `CLUE_SOLVED`
- `CHAT_MESSAGE`
- `GAME_COMPLETED`

For production, replace the in-memory `rooms` map with Redis for transient state, persist users/lobbies/final stats to PostgreSQL, and swap the simulated login for NextAuth.
