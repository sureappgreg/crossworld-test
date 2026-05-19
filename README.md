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

## Puzzle Import Workflow

CrossWorld loads puzzle source files from the `/puzzles` folder. Add a `.txt` file there, restart the server, and new lobbies will use the first valid puzzle unless a `puzzleId` is passed to `/api/lobby/create`.

Check loaded puzzles and import errors:

```txt
GET /api/puzzles
```

Fetch a converted puzzle JSON:

```txt
GET /api/puzzle?id=sunday-stumper
```

### Text Format

Use this structure:

```txt
TITLE: My Puzzle
AUTHOR: Your Name

GRID:
CAT
A#R
TEN

ACROSS:
1. CAT - Small pet
3. TEN - Number after nine

DOWN:
1. CAT - Feline pattern entry
2. TRN - Optional answer prefix, then clue text
```

Rules:

- `GRID` rows use `A-Z` for answer cells and `#` for black squares.
- Every grid row must have the same width.
- Clue numbers are auto-detected from the grid.
- Clue lines can be `1. Clue text` or `1. ANSWER - Clue text`.
- If you include an answer prefix, CrossWorld validates it against the grid answer.
- Missing clues, extra clues, duplicate clue numbers, invalid grid characters, uneven grid rows, and answer mismatches return clear errors from `/api/puzzles`.

An example puzzle is included at [puzzles/sunday-stumper.txt](/Users/gregoryramirez/Documents/Codex/CrossWorld/puzzles/sunday-stumper.txt).

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
