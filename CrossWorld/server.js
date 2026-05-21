const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");

const PORT = Number(process.env.PORT || 3000);
const PUBLIC_DIR = path.join(__dirname, "public");
const PUZZLES_DIR = path.join(__dirname, "puzzles");
const DATA_DIR = path.join(__dirname, "data");
const LEADERBOARD_FILE = path.join(DATA_DIR, "leaderboards.json");

const COLORS = ["#3B82F6", "#4ADE80", "#F59E0B", "#A855F7"];
const AVATARS = [
  "linear-gradient(135deg,#1d4ed8,#60a5fa)",
  "linear-gradient(135deg,#047857,#86efac)",
  "linear-gradient(135deg,#b45309,#fcd34d)",
  "linear-gradient(135deg,#7e22ce,#d8b4fe)",
];

function slugify(value) {
  return String(value || "puzzle")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || "puzzle";
}

function parsePuzzleText(source, filename = "puzzle.txt") {
  const errors = [];
  const lines = source.replace(/\r\n?/g, "\n").split("\n");
  const sections = { grid: [], across: [], down: [] };
  let title = "";
  let author = "";
  let section = "";

  lines.forEach((rawLine, index) => {
    const lineNumber = index + 1;
    const line = rawLine.trim();
    if (!line || line.startsWith("//")) return;

    const titleMatch = line.match(/^TITLE\s*:\s*(.+)$/i);
    const authorMatch = line.match(/^AUTHOR\s*:\s*(.+)$/i);
    if (titleMatch) {
      title = titleMatch[1].trim();
      section = "";
      return;
    }
    if (authorMatch) {
      author = authorMatch[1].trim();
      section = "";
      return;
    }
    if (/^GRID\s*:?\s*$/i.test(line)) {
      section = "grid";
      return;
    }
    if (/^ACROSS\s*:?\s*$/i.test(line)) {
      section = "across";
      return;
    }
    if (/^DOWN\s*:?\s*$/i.test(line)) {
      section = "down";
      return;
    }
    if (!section) {
      errors.push(`${filename}:${lineNumber} is outside a section: "${line}"`);
      return;
    }
    sections[section].push({ line, lineNumber });
  });

  if (!title) errors.push(`${filename}: missing TITLE: line`);
  if (!author) errors.push(`${filename}: missing AUTHOR: line`);
  if (!sections.grid.length) errors.push(`${filename}: missing GRID section rows`);
  if (!sections.across.length) errors.push(`${filename}: missing ACROSS clues`);
  if (!sections.down.length) errors.push(`${filename}: missing DOWN clues`);

  const gridRows = sections.grid.map((entry) => entry.line.toUpperCase());
  const height = gridRows.length;
  const width = gridRows[0]?.length || 0;
  if (height && width) {
    gridRows.forEach((row, index) => {
      if (row.length !== width) {
        errors.push(`${filename}:${sections.grid[index].lineNumber} grid row is ${row.length} cells wide; expected ${width}`);
      }
      if (!/^[A-Z#]+$/.test(row)) {
        errors.push(`${filename}:${sections.grid[index].lineNumber} grid row contains invalid characters; use only A-Z and #`);
      }
    });
  }

  const parseClues = (entries, direction) => {
    const clueMap = new Map();
    for (const entry of entries) {
      const match = entry.line.match(/^(\d+)\s*[\).\:-]\s*(.+)$/);
      if (!match) {
        errors.push(`${filename}:${entry.lineNumber} invalid ${direction} clue; expected "12. Clue text"`);
        continue;
      }
      const number = Number(match[1]);
      let body = match[2].trim();
      let expectedAnswer = "";
      const answerMatch = body.match(/^([A-Z]+)\s*(?:-|:)\s*(.+)$/i);
      if (answerMatch) {
        expectedAnswer = answerMatch[1].toUpperCase();
        body = answerMatch[2].trim();
      }
      if (!body) errors.push(`${filename}:${entry.lineNumber} clue ${number}-${direction} has no clue text`);
      if (clueMap.has(number)) errors.push(`${filename}:${entry.lineNumber} duplicate ${direction} clue number ${number}`);
      clueMap.set(number, { text: body, expectedAnswer, lineNumber: entry.lineNumber });
    }
    return clueMap;
  };

  const acrossClues = parseClues(sections.across, "across");
  const downClues = parseClues(sections.down, "down");
  if (errors.length) return { puzzle: null, errors };

  const cells = [];
  for (let row = 0; row < height; row += 1) {
    for (let col = 0; col < width; col += 1) {
      const ch = gridRows[row][col];
      cells.push({
        row,
        col,
        value: "",
        solution: ch === "#" ? "" : ch,
        isBlack: ch === "#",
        clueNumber: null,
      });
    }
  }

  const cellAt = (row, col) => cells.find((cell) => cell.row === row && cell.col === col);
  let clueNumber = 1;
  const cluesAcross = [];
  const cluesDown = [];

  for (let row = 0; row < height; row += 1) {
    for (let col = 0; col < width; col += 1) {
      const cell = cellAt(row, col);
      if (cell.isBlack) continue;

      const startsAcross = (col === 0 || cellAt(row, col - 1).isBlack) && col + 1 < width && !cellAt(row, col + 1).isBlack;
      const startsDown = (row === 0 || cellAt(row - 1, col).isBlack) && row + 1 < height && !cellAt(row + 1, col).isBlack;
      if (!startsAcross && !startsDown) continue;

      cell.clueNumber = clueNumber;
      if (startsAcross) {
        const entryCells = [];
        let c = col;
        while (c < width && !cellAt(row, c).isBlack) {
          entryCells.push({ row, col: c });
          c += 1;
        }
        const answer = entryCells.map((pos) => cellAt(pos.row, pos.col).solution).join("");
        const clue = acrossClues.get(clueNumber);
        if (!clue) {
          errors.push(`${filename}: missing ACROSS clue ${clueNumber} for answer ${answer}`);
        } else if (clue.expectedAnswer && clue.expectedAnswer !== answer) {
          errors.push(`${filename}:${clue.lineNumber} ACROSS ${clueNumber} answer mismatch; clue says ${clue.expectedAnswer}, grid answer is ${answer}`);
        }
        cluesAcross.push({
          id: `A-${clueNumber}`,
          number: clueNumber,
          direction: "across",
          text: clue?.text || "",
          answer,
          cells: entryCells,
          ownerId: null,
          solvedAt: null,
        });
      }
      if (startsDown) {
        const entryCells = [];
        let r = row;
        while (r < height && !cellAt(r, col).isBlack) {
          entryCells.push({ row: r, col });
          r += 1;
        }
        const answer = entryCells.map((pos) => cellAt(pos.row, pos.col).solution).join("");
        const clue = downClues.get(clueNumber);
        if (!clue) {
          errors.push(`${filename}: missing DOWN clue ${clueNumber} for answer ${answer}`);
        } else if (clue.expectedAnswer && clue.expectedAnswer !== answer) {
          errors.push(`${filename}:${clue.lineNumber} DOWN ${clueNumber} answer mismatch; clue says ${clue.expectedAnswer}, grid answer is ${answer}`);
        }
        cluesDown.push({
          id: `D-${clueNumber}`,
          number: clueNumber,
          direction: "down",
          text: clue?.text || "",
          answer,
          cells: entryCells,
          ownerId: null,
          solvedAt: null,
        });
      }
      clueNumber += 1;
    }
  }

  for (const number of acrossClues.keys()) {
    if (!cluesAcross.some((clue) => clue.number === number)) {
      errors.push(`${filename}: extra ACROSS clue ${number}; no across answer starts at that number`);
    }
  }
  for (const number of downClues.keys()) {
    if (!cluesDown.some((clue) => clue.number === number)) {
      errors.push(`${filename}: extra DOWN clue ${number}; no down answer starts at that number`);
    }
  }

  const size = width === height ? width : { width, height };
  const puzzle = {
    id: slugify(path.basename(filename, path.extname(filename))),
    title,
    author,
    subtitle: `${author} - ${width}x${height}`,
    width,
    height,
    size,
    cells,
    cluesAcross,
    cluesDown,
  };
  return { puzzle: errors.length ? null : puzzle, errors };
}

function loadPuzzleLibrary() {
  const puzzles = [];
  const errors = [];
  if (!fs.existsSync(PUZZLES_DIR)) {
    return { puzzles, errors: [`Missing puzzles folder: ${PUZZLES_DIR}`] };
  }
  const files = fs.readdirSync(PUZZLES_DIR).filter((file) => file.toLowerCase().endsWith(".txt")).sort();
  if (!files.length) errors.push("No .txt puzzle files found in /puzzles");

  for (const file of files) {
    const filePath = path.join(PUZZLES_DIR, file);
    const result = parsePuzzleText(fs.readFileSync(filePath, "utf8"), file);
    if (result.errors.length) {
      errors.push(...result.errors);
    } else {
      puzzles.push(result.puzzle);
    }
  }
  return { puzzles, errors };
}

function getPuzzleTemplate(puzzleId = "") {
  const library = loadPuzzleLibrary();
  if (!library.puzzles.length) {
    throw new Error(`No valid puzzles available. ${library.errors.join(" ")}`);
  }
  const selected = library.puzzles.find((puzzle) => puzzle.id === puzzleId) || library.puzzles[0];
  return selected;
}

const rooms = new Map();

function readLeaderboards() {
  try {
    if (!fs.existsSync(LEADERBOARD_FILE)) return {};
    return JSON.parse(fs.readFileSync(LEADERBOARD_FILE, "utf8"));
  } catch {
    return {};
  }
}

function writeLeaderboards(leaderboards) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(LEADERBOARD_FILE, JSON.stringify(leaderboards, null, 2));
}

function leaderboardForPuzzle(puzzleId) {
  const leaderboards = readLeaderboards();
  return [...(leaderboards[puzzleId] || [])].sort((a, b) => a.elapsedMs - b.elapsedMs);
}

function id(prefix = "") {
  return `${prefix}${crypto.randomBytes(4).toString("hex")}`;
}

function lobbyCode() {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code = "";
  for (let i = 0; i < 6; i += 1) code += alphabet[Math.floor(Math.random() * alphabet.length)];
  return code;
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function createRoom(host, puzzleId = "", teamName = "") {
  const puzzleTemplate = getPuzzleTemplate(puzzleId);
  const code = lobbyCode();
  const room = {
    id: id("room_"),
    code,
    hostId: host.id,
    teamName: String(teamName || "").trim().slice(0, 40),
    puzzleId: puzzleTemplate.id,
    status: "lobby",
    createdAt: new Date().toISOString(),
    maxPlayers: 4,
    players: [],
    messages: [],
    activity: [],
    puzzle: clone(puzzleTemplate),
    startedAt: null,
    completedAt: null,
    leaderboardRecorded: false,
    clients: new Set(),
  };
  addPlayer(room, host);
  rooms.set(code, room);
  return room;
}

function addPlayer(room, playerInput) {
  const existing = room.players.find((player) => player.id === playerInput.id);
  if (existing) {
    existing.online = true;
    existing.lastSeen = Date.now();
    return existing;
  }
  if (room.players.length >= room.maxPlayers) {
    throw new Error("Lobby is full");
  }
  const index = room.players.length;
  const player = {
    id: playerInput.id || id("player_"),
    username: playerInput.username || `Player ${index + 1}`,
    email: playerInput.email || "",
    avatarUrl: "",
    avatarStyle: AVATARS[index % AVATARS.length],
    color: COLORS[index % COLORS.length],
    createdAt: new Date().toISOString(),
    ready: false,
    online: true,
    cursor: { row: 0, col: 0, direction: "across", clueId: "A-1" },
    solvedCount: 0,
    accuracy: { typed: 0, correct: 0 },
    lastSeen: Date.now(),
  };
  room.players.push(player);
  room.activity.unshift({
    id: id("act_"),
    type: "PLAYER_JOINED",
    playerId: player.id,
    text: `${player.username} joined the lobby`,
    at: new Date().toISOString(),
  });
  return player;
}

function clientRoom(room) {
  const { clients, ...serializable } = room;
  return serializable;
}

function send(client, event, payload) {
  client.write(`event: ${event}\n`);
  client.write(`data: ${JSON.stringify(payload)}\n\n`);
}

function broadcast(room, event, payload = clientRoom(room)) {
  for (const client of room.clients) {
    send(client, event, payload);
  }
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
      if (body.length > 1_000_000) {
        reject(new Error("Request body too large"));
        req.destroy();
      }
    });
    req.on("end", () => {
      if (!body) return resolve({});
      try {
        resolve(JSON.parse(body));
      } catch (error) {
        reject(error);
      }
    });
  });
}

function json(res, status, body) {
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
  });
  res.end(JSON.stringify(body));
}

function fileResponse(req, res) {
  const requestedPath = req.url === "/" ? "/index.html" : new URL(req.url, `http://${req.headers.host}`).pathname;
  const safePath = path.normalize(requestedPath).replace(/^(\.\.[/\\])+/, "");
  const filePath = path.join(PUBLIC_DIR, safePath);
  if (!filePath.startsWith(PUBLIC_DIR)) {
    res.writeHead(403);
    res.end("Forbidden");
    return;
  }
  fs.readFile(filePath, (error, data) => {
    if (error) {
      res.writeHead(404);
      res.end("Not found");
      return;
    }
    const ext = path.extname(filePath);
    const type = {
      ".html": "text/html; charset=utf-8",
      ".css": "text/css; charset=utf-8",
      ".js": "text/javascript; charset=utf-8",
      ".json": "application/json; charset=utf-8",
      ".svg": "image/svg+xml",
    }[ext] || "application/octet-stream";
    res.writeHead(200, { "content-type": type, "cache-control": "no-store" });
    res.end(data);
  });
}

function findRoomOrThrow(code) {
  const room = rooms.get(String(code || "").toUpperCase());
  if (!room) throw new Error("Lobby not found");
  return room;
}

function findPlayer(room, playerId) {
  return room.players.find((player) => player.id === playerId);
}

function cellKey(row, col) {
  return `${row}:${col}`;
}

function allClues(room) {
  return [...room.puzzle.cluesAcross, ...room.puzzle.cluesDown];
}

function clueContainsCell(clue, row, col) {
  return clue.cells.some((cell) => cell.row === row && cell.col === col);
}

function clueSolved(room, clue) {
  return clue.cells.every(({ row, col }) => {
    const cell = room.puzzle.cells.find((candidate) => candidate.row === row && candidate.col === col);
    return cell.value && cell.value.toUpperCase() === cell.solution;
  });
}

function recalculate(room, finalPlayerId = null) {
  const solvedBefore = new Set([
    ...room.puzzle.cluesAcross,
    ...room.puzzle.cluesDown,
  ].filter((clue) => clue.solvedAt).map((clue) => clue.id));

  for (const player of room.players) player.solvedCount = 0;

  for (const clue of allClues(room)) {
    if (clueSolved(room, clue)) {
      if (!clue.solvedAt) {
        clue.solvedAt = new Date().toISOString();
        clue.ownerId = finalPlayerId;
        if (finalPlayerId) {
          const owner = findPlayer(room, finalPlayerId);
          room.activity.unshift({
            id: id("act_"),
            type: "CLUE_SOLVED",
            playerId: finalPlayerId,
            text: `${owner ? owner.username : "A player"} solved ${clue.number}-${clue.direction}`,
            at: clue.solvedAt,
          });
        }
      }
    } else {
      clue.solvedAt = null;
      clue.ownerId = null;
    }
    if (clue.ownerId) {
      const owner = findPlayer(room, clue.ownerId);
      if (owner) owner.solvedCount += 1;
    }
  }

  const allFillable = room.puzzle.cells.filter((cell) => !cell.isBlack);
  const correctCells = allFillable.filter((cell) => cell.value && cell.value.toUpperCase() === cell.solution).length;
  const allSolved = correctCells === allFillable.length;
  if (allSolved && !room.completedAt) {
    room.completedAt = new Date().toISOString();
    room.status = "completed";
    recordLeaderboardResult(room);
    room.activity.unshift({
      id: id("act_"),
      type: "GAME_COMPLETED",
      playerId: finalPlayerId,
      text: "Puzzle complete",
      at: room.completedAt,
    });
  } else if (!allSolved && room.status === "completed") {
    room.completedAt = null;
    room.status = "playing";
  }

  return {
    percent: Math.round((correctCells / allFillable.length) * 100),
    newlySolved: allClues(room)
      .filter((clue) => clue.solvedAt && !solvedBefore.has(clue.id))
      .map((clue) => clue.id),
  };
}

function recordLeaderboardResult(room) {
  if (room.leaderboardRecorded || !room.startedAt || !room.completedAt) return;
  const elapsedMs = new Date(room.completedAt).getTime() - new Date(room.startedAt).getTime();
  if (!Number.isFinite(elapsedMs) || elapsedMs < 0) return;
  const leaderboards = readLeaderboards();
  const puzzleId = room.puzzleId || room.puzzle.id;
  const entries = leaderboards[puzzleId] || [];
  entries.push({
    id: id("score_"),
    teamName: room.teamName || "Untitled Team",
    puzzleId,
    puzzleTitle: room.puzzle.title,
    elapsedMs,
    completedAt: room.completedAt,
    players: room.players.map((player) => player.username),
  });
  leaderboards[puzzleId] = entries.sort((a, b) => a.elapsedMs - b.elapsedMs).slice(0, 50);
  writeLeaderboards(leaderboards);
  room.leaderboardRecorded = true;
}

async function handleApi(req, res, pathname) {
  try {
    if (req.method === "GET" && pathname === "/api/puzzles") {
      const library = loadPuzzleLibrary();
      return json(res, library.puzzles.length ? 200 : 400, {
        puzzles: library.puzzles.map((puzzle) => ({
          id: puzzle.id,
          title: puzzle.title,
          author: puzzle.author,
          width: puzzle.width,
          height: puzzle.height,
          cluesAcross: puzzle.cluesAcross.length,
          cluesDown: puzzle.cluesDown.length,
        })),
        errors: library.errors,
      });
    }

    if (req.method === "GET" && pathname === "/api/puzzle") {
      const requested = new URL(req.url, `http://${req.headers.host}`).searchParams.get("id") || "";
      return json(res, 200, getPuzzleTemplate(requested));
    }

    if (req.method === "GET" && pathname === "/api/leaderboard") {
      const puzzleId = new URL(req.url, `http://${req.headers.host}`).searchParams.get("puzzleId");
      if (!puzzleId) throw new Error("Missing puzzleId");
      return json(res, 200, { entries: leaderboardForPuzzle(puzzleId) });
    }

    if (req.method === "POST" && pathname === "/api/lobby/create") {
      const body = await readJson(req);
      const teamName = String(body.teamName || "").trim();
      if (!teamName) throw new Error("Team name is required");
      const player = {
        id: body.playerId || id("player_"),
        username: body.username || "You",
        email: body.email || "",
      };
      const room = createRoom(player, body.puzzleId, teamName);
      return json(res, 200, { room: clientRoom(room), playerId: player.id });
    }

    if (req.method === "POST" && pathname === "/api/lobby/join") {
      const body = await readJson(req);
      const room = findRoomOrThrow(body.code);
      const player = addPlayer(room, {
        id: body.playerId || id("player_"),
        username: body.username,
        email: body.email,
      });
      broadcast(room, "PLAYER_JOINED");
      return json(res, 200, { room: clientRoom(room), playerId: player.id });
    }

    if (req.method === "POST" && pathname === "/api/lobby/leave") {
      const body = await readJson(req);
      const room = findRoomOrThrow(body.code);
      const player = findPlayer(room, body.playerId);
      if (player) {
        player.online = false;
        player.ready = false;
        room.activity.unshift({
          id: id("act_"),
          type: "PLAYER_LEFT",
          playerId: player.id,
          text: `${player.username} left the lobby`,
          at: new Date().toISOString(),
        });
      }
      broadcast(room, "PLAYER_LEFT");
      return json(res, 200, { room: clientRoom(room) });
    }

    if (req.method === "POST" && pathname === "/api/lobby/ready") {
      const body = await readJson(req);
      const room = findRoomOrThrow(body.code);
      const player = findPlayer(room, body.playerId);
      if (!player) throw new Error("Player not found");
      player.ready = Boolean(body.ready);
      room.activity.unshift({
        id: id("act_"),
        type: "PLAYER_READY",
        playerId: player.id,
        text: `${player.username} is ${player.ready ? "ready" : "not ready"}`,
        at: new Date().toISOString(),
      });
      broadcast(room, "PLAYER_READY");
      return json(res, 200, { room: clientRoom(room) });
    }

    if (req.method === "POST" && pathname === "/api/lobby/start") {
      const body = await readJson(req);
      const room = findRoomOrThrow(body.code);
      if (room.hostId !== body.playerId) throw new Error("Only the host can start");
      if (!room.players.every((player) => player.ready || player.id === room.hostId)) {
        throw new Error("Every guest must be ready");
      }
      room.status = "playing";
      room.startedAt = new Date().toISOString();
      room.activity.unshift({
        id: id("act_"),
        type: "GAME_STARTED",
        playerId: body.playerId,
        text: "Game started",
        at: room.startedAt,
      });
      broadcast(room, "GAME_STARTED");
      return json(res, 200, { room: clientRoom(room) });
    }

    if (req.method === "POST" && pathname === "/api/cell") {
      const body = await readJson(req);
      const room = findRoomOrThrow(body.code);
      const player = findPlayer(room, body.playerId);
      if (!player) throw new Error("Player not found");
      const cell = room.puzzle.cells.find((candidate) => candidate.row === body.row && candidate.col === body.col);
      if (!cell || cell.isBlack) throw new Error("Cell not playable");
      const nextValue = String(body.value || "").slice(0, 1).toUpperCase().replace(/[^A-Z]/g, "");
      const activeClue = allClues(room).find((clue) => clue.id === body.clueId);
      if (activeClue?.solvedAt) throw new Error("That clue is already solved");
      const solvedCellClues = allClues(room).filter((clue) => clue.solvedAt && clueContainsCell(clue, cell.row, cell.col));
      if (solvedCellClues.length && nextValue !== cell.value) throw new Error("Solved letters are locked");
      cell.value = nextValue;
      cell.updatedBy = player.id;
      cell.updatedAt = new Date().toISOString();
      player.accuracy.typed += nextValue ? 1 : 0;
      player.accuracy.correct += nextValue && nextValue === cell.solution ? 1 : 0;
      room.activity.unshift({
        id: id("act_"),
        type: "CELL_UPDATED",
        playerId: player.id,
        text: `${player.username} edited ${body.row + 1},${body.col + 1}`,
        at: cell.updatedAt,
      });
      recalculate(room, player.id);
      broadcast(room, "CELL_UPDATED");
      return json(res, 200, { room: clientRoom(room) });
    }

    if (req.method === "POST" && pathname === "/api/cursor") {
      const body = await readJson(req);
      const room = findRoomOrThrow(body.code);
      const player = findPlayer(room, body.playerId);
      if (!player) throw new Error("Player not found");
      player.cursor = {
        row: Number(body.row || 0),
        col: Number(body.col || 0),
        direction: body.direction === "down" ? "down" : "across",
        clueId: body.clueId || null,
      };
      player.online = true;
      player.lastSeen = Date.now();
      broadcast(room, "CURSOR_MOVED");
      return json(res, 200, { room: clientRoom(room) });
    }

    if (req.method === "POST" && pathname === "/api/chat") {
      const body = await readJson(req);
      const room = findRoomOrThrow(body.code);
      const player = findPlayer(room, body.playerId);
      if (!player) throw new Error("Player not found");
      const message = {
        id: id("msg_"),
        playerId: player.id,
        text: String(body.text || "").trim().slice(0, 500),
        at: new Date().toISOString(),
      };
      if (message.text) room.messages.push(message);
      broadcast(room, "CHAT_MESSAGE");
      return json(res, 200, { room: clientRoom(room) });
    }

    if (req.method === "POST" && pathname === "/api/dev/fill") {
      const body = await readJson(req);
      const room = findRoomOrThrow(body.code);
      for (const cell of room.puzzle.cells) {
        if (!cell.isBlack) cell.value = cell.solution;
      }
      recalculate(room, body.playerId);
      broadcast(room, "GAME_COMPLETED");
      return json(res, 200, { room: clientRoom(room) });
    }

    json(res, 404, { error: "Not found" });
  } catch (error) {
    json(res, 400, { error: error.message });
  }
}

function handleStream(req, res, searchParams) {
  try {
    const room = findRoomOrThrow(searchParams.get("code"));
    const player = findPlayer(room, searchParams.get("playerId"));
    if (player) {
      player.online = true;
      player.lastSeen = Date.now();
    }
    res.writeHead(200, {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
      "x-accel-buffering": "no",
    });
    res.write("retry: 1000\n\n");
    room.clients.add(res);
    send(res, "STATE", clientRoom(room));
    broadcast(room, "PLAYER_JOINED");
    req.on("close", () => {
      room.clients.delete(res);
      if (player) {
        player.online = false;
        player.lastSeen = Date.now();
        broadcast(room, "PLAYER_LEFT");
      }
    });
  } catch (error) {
    json(res, 400, { error: error.message });
  }
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  if (url.pathname === "/events") return handleStream(req, res, url.searchParams);
  if (url.pathname.startsWith("/api/")) return handleApi(req, res, url.pathname);
  return fileResponse(req, res);
});

server.listen(PORT, () => {
  console.log(`CrossWorld running on port ${PORT}`);
});
