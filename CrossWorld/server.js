const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");

const PORT = Number(process.env.PORT || 3000);
const PUBLIC_DIR = path.join(__dirname, "public");

const COLORS = ["#3B82F6", "#4ADE80", "#F59E0B", "#A855F7"];
const AVATARS = [
  "linear-gradient(135deg,#1d4ed8,#60a5fa)",
  "linear-gradient(135deg,#047857,#86efac)",
  "linear-gradient(135deg,#b45309,#fcd34d)",
  "linear-gradient(135deg,#7e22ce,#d8b4fe)",
];

const gridRows = [
  "ORBITAL#SOLVER#",
  "R#E#A#A#O#E#O##",
  "MOON#PIXEL#NODE",
  "ION#T#L#I#D#I##",
  "ASTRO#CHAT#ROOM",
  "T#R#E#R#C#E#B##",
  "CLUE#READY#SYNC",
  "O#A#D#I#A#A#K##",
  "LOGIC#CURSOR#UI",
  "L#E#A#S#H#D#T##",
  "BOARD#TIMER#WIN",
  "A#B#I#A#P#L#E##",
  "TEAM#ENTRY#GRID",
  "E#R#E#E#E#Y#I##",
  "STARRY#ANSWER#S",
];

const clueBank = {
  ORBITAL: "Things that circle planets",
  SOLVER: "Player filling the grid",
  MOON: "Night-sky satellite",
  PIXEL: "Tiny unit of a digital image",
  NODE: "Network point",
  ASTRO: "Space-themed prefix",
  CHAT: "Realtime message stream",
  ROOM: "Private place to gather",
  CLUE: "Hint for an entry",
  READY: "Lobby state before launch",
  SYNC: "What live collaboration needs",
  LOGIC: "Reasoning under the fill",
  CURSOR: "Indicator of active position",
  UI: "Interface, briefly",
  BOARD: "Crossword grid surface",
  TIMER: "Elapsed-time counter",
  WIN: "Puzzle-completion result",
  TEAM: "Collaborating group",
  ENTRY: "Answer slot",
  GRID: "Crossword lattice",
  STARRY: "Full of tiny lights",
  ANSWER: "What each clue seeks",
};

function buildPuzzle() {
  const cells = [];
  const size = 15;
  for (let row = 0; row < size; row += 1) {
    for (let col = 0; col < size; col += 1) {
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

  for (let row = 0; row < size; row += 1) {
    for (let col = 0; col < size; col += 1) {
      const cell = cellAt(row, col);
      if (cell.isBlack) continue;

      const startsAcross = (col === 0 || cellAt(row, col - 1).isBlack) && col + 1 < size && !cellAt(row, col + 1).isBlack;
      const startsDown = (row === 0 || cellAt(row - 1, col).isBlack) && row + 1 < size && !cellAt(row + 1, col).isBlack;
      if (!startsAcross && !startsDown) continue;

      cell.clueNumber = clueNumber;
      if (startsAcross) {
        const entryCells = [];
        let c = col;
        while (c < size && !cellAt(row, c).isBlack) {
          entryCells.push({ row, col: c });
          c += 1;
        }
        const answer = entryCells.map((pos) => cellAt(pos.row, pos.col).solution).join("");
        cluesAcross.push({
          id: `A-${clueNumber}`,
          number: clueNumber,
          direction: "across",
          text: clueBank[answer] || `Collaborative fill: ${answer.length} letters`,
          answer,
          cells: entryCells,
          ownerId: null,
          solvedAt: null,
        });
      }
      if (startsDown) {
        const entryCells = [];
        let r = row;
        while (r < size && !cellAt(r, col).isBlack) {
          entryCells.push({ row: r, col });
          r += 1;
        }
        const answer = entryCells.map((pos) => cellAt(pos.row, pos.col).solution).join("");
        cluesDown.push({
          id: `D-${clueNumber}`,
          number: clueNumber,
          direction: "down",
          text: clueBank[answer] || `Pattern entry: ${answer.length} letters`,
          answer,
          cells: entryCells,
          ownerId: null,
          solvedAt: null,
        });
      }
      clueNumber += 1;
    }
  }

  return {
    id: "sunday-stumper-001",
    title: "Sunday Stumper",
    subtitle: "A space and collaboration themed 15x15",
    size,
    cells,
    cluesAcross,
    cluesDown,
  };
}

const puzzleTemplate = buildPuzzle();
const rooms = new Map();

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

function createRoom(host) {
  const code = lobbyCode();
  const room = {
    id: id("room_"),
    code,
    hostId: host.id,
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

  for (const clue of [...room.puzzle.cluesAcross, ...room.puzzle.cluesDown]) {
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
    newlySolved: [...room.puzzle.cluesAcross, ...room.puzzle.cluesDown]
      .filter((clue) => clue.solvedAt && !solvedBefore.has(clue.id))
      .map((clue) => clue.id),
  };
}

async function handleApi(req, res, pathname) {
  try {
    if (req.method === "GET" && pathname === "/api/puzzle") {
      return json(res, 200, puzzleTemplate);
    }

    if (req.method === "POST" && pathname === "/api/lobby/create") {
      const body = await readJson(req);
      const player = {
        id: body.playerId || id("player_"),
        username: body.username || "You",
        email: body.email || "",
      };
      const room = createRoom(player);
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
