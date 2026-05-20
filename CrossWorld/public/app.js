const app = document.querySelector("#app");

const STORAGE_USER = "crossworld:user";
const STORAGE_SESSION = "crossworld:session";

const state = {
  user: loadJson(STORAGE_USER),
  room: null,
  playerId: null,
  active: { row: 0, col: 0, direction: "across", clueId: null },
  clueTab: "across",
  view: "login",
  stream: null,
  collapsedChat: false,
  openChat: false,
  openSidebar: false,
  openClueList: false,
  toast: "",
  solvedSeen: new Set(),
  solvedFlash: new Set(),
  unreadChat: 0,
  lastMessageCount: 0,
  elapsedNow: Date.now(),
};

if (state.user) {
  state.view = "home";
  const session = loadJson(STORAGE_SESSION);
  if (session?.code && session?.playerId) {
    state.playerId = session.playerId;
    joinExistingSession(session.code, session.playerId);
  } else {
    render();
  }
} else {
  render();
}

setInterval(() => {
  state.elapsedNow = Date.now();
  if (state.room?.status === "playing") renderGameChromeOnly();
}, 1000);

function loadJson(key) {
  try {
    return JSON.parse(localStorage.getItem(key));
  } catch {
    return null;
  }
}

function saveJson(key, value) {
  localStorage.setItem(key, JSON.stringify(value));
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function initials(name) {
  return String(name || "?")
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() || "")
    .join("");
}

function timeLabel(iso) {
  return new Intl.DateTimeFormat([], { hour: "numeric", minute: "2-digit" }).format(new Date(iso));
}

function duration(startIso, endIso) {
  if (!startIso) return "00:00";
  const end = endIso ? new Date(endIso).getTime() : state.elapsedNow;
  const total = Math.max(0, Math.floor((end - new Date(startIso).getTime()) / 1000));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  return hours > 0
    ? `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`
    : `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

function allClues(room = state.room) {
  if (!room) return [];
  return [...room.puzzle.cluesAcross, ...room.puzzle.cluesDown];
}

function activeClues() {
  return allClues().sort((a, b) => {
    if (a.number !== b.number) return a.number - b.number;
    if (a.direction === b.direction) return 0;
    return a.direction === "across" ? -1 : 1;
  });
}

function cellAt(row, col) {
  return state.room?.puzzle.cells.find((cell) => cell.row === row && cell.col === col);
}

function clueById(id) {
  return allClues().find((clue) => clue.id === id);
}

function cluesForCell(row, col) {
  return allClues().filter((clue) => clue.cells.some((cell) => cell.row === row && cell.col === col));
}

function solvedCluesForCell(row, col) {
  return cluesForCell(row, col).filter((clue) => clue.solvedAt);
}

function playerById(id) {
  return state.room?.players.find((player) => player.id === id);
}

function clueForCell(row, col, direction = state.active.direction) {
  const direct = allClues().find((clue) => clue.direction === direction && clue.cells.some((cell) => cell.row === row && cell.col === col));
  if (direct) return direct;
  return allClues().find((clue) => clue.cells.some((cell) => cell.row === row && cell.col === col));
}

function progress(room = state.room) {
  if (!room) return { total: 0, correct: 0, percent: 0 };
  const fillable = room.puzzle.cells.filter((cell) => !cell.isBlack);
  const correct = fillable.filter((cell) => cell.value && cell.value === cell.solution).length;
  return {
    total: fillable.length,
    correct,
    percent: Math.round((correct / fillable.length) * 100),
  };
}

async function api(path, body) {
  const response = await fetch(path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const payload = await response.json();
  if (!response.ok || payload.error) throw new Error(payload.error || "Request failed");
  return payload;
}

function setToast(text) {
  state.toast = text;
  renderToast();
  setTimeout(() => {
    if (state.toast === text) {
      state.toast = "";
      renderToast();
    }
  }, 2200);
}

function compactLayout() {
  return typeof window !== "undefined" && window.matchMedia("(max-width: 1320px)").matches;
}

function applyRoom(room) {
  const previousMessageCount = state.room?.messages.length ?? state.lastMessageCount;
  const nextMessageCount = room.messages.length;
  if (nextMessageCount > previousMessageCount && state.view === "game") {
    const chatHidden = state.collapsedChat || (compactLayout() && !state.openChat);
    if (chatHidden) state.unreadChat += nextMessageCount - previousMessageCount;
  }
  state.lastMessageCount = nextMessageCount;

  const nextSolved = new Set(allClues(room).filter((clue) => clue.solvedAt).map((clue) => clue.id));
  for (const clueId of nextSolved) {
    if (!state.solvedSeen.has(clueId)) {
      state.solvedFlash.add(clueId);
      setTimeout(() => {
        state.solvedFlash.delete(clueId);
        renderBoardOnly();
      }, 580);
    }
  }
  state.solvedSeen = nextSolved;
  state.room = room;
  if (!state.active.clueId) {
    const first = room.puzzle.cluesAcross[0];
    state.active = { row: first.cells[0].row, col: first.cells[0].col, direction: "across", clueId: first.id };
  }
  if (room.status === "completed") {
    state.view = "results";
  } else if (room.status === "playing") {
    state.view = "game";
  } else {
    state.view = "lobby";
  }
  render();
}

function openStream(code, playerId) {
  if (state.stream) state.stream.close();
  state.stream = new EventSource(`/events?code=${encodeURIComponent(code)}&playerId=${encodeURIComponent(playerId)}`);
  const updateEvents = [
    "STATE",
    "PLAYER_JOINED",
    "PLAYER_LEFT",
    "PLAYER_READY",
    "GAME_STARTED",
    "CELL_UPDATED",
    "CURSOR_MOVED",
    "CLUE_SOLVED",
    "CHAT_MESSAGE",
    "GAME_COMPLETED",
  ];
  for (const event of updateEvents) {
    state.stream.addEventListener(event, (message) => applyRoom(JSON.parse(message.data)));
  }
  state.stream.onerror = () => setToast("Reconnecting to lobby...");
}

async function joinExistingSession(code, playerId) {
  try {
    const payload = await api("/api/lobby/join", {
      code,
      playerId,
      username: state.user.username,
      email: state.user.email,
    });
    state.playerId = payload.playerId;
    saveJson(STORAGE_SESSION, { code: payload.room.code, playerId: payload.playerId });
    openStream(payload.room.code, payload.playerId);
    applyRoom(payload.room);
  } catch {
    localStorage.removeItem(STORAGE_SESSION);
    state.view = "home";
    render();
  }
}

function render() {
  document.body.classList.toggle("game-mode", state.view === "game");
  if (!state.user || state.view === "login") return renderLogin();
  if (state.view === "home") return renderHome();
  if (state.view === "lobby") return renderLobby();
  if (state.view === "results") return renderResults();
  return renderGame();
}

function renderLogin() {
  app.innerHTML = `
    <main class="login-screen">
      <section class="login-card panel">
        <div class="login-form">
          <div class="brand"><span class="logo-mark"></span> CrossWorld</div>
          <p class="kicker">Welcome to</p>
          <h1>CrossWorld</h1>
          <p class="lede">Collaborative crosswords with live cursors, clue ownership, lobby chat, and a calm premium workspace for friends.</p>
          <form id="login-form" class="input-stack">
            <label class="field">Username<input id="username" required maxlength="24" autocomplete="nickname" value="You" /></label>
            <label class="field">Email<input id="email" type="email" required autocomplete="email" value="you@crossworld.test" /></label>
            <button class="primary" type="submit">Log In</button>
          </form>
          <div class="divider">Continue with</div>
          <div class="provider-row">
            <button class="secondary" data-provider="google">Google</button>
            <button class="secondary" data-provider="demo">Demo Guest</button>
          </div>
        </div>
        <div class="sphere-stage" aria-hidden="true">
          ${[...Array(18)].map((_, index) => `<span class="star" style="left:${8 + ((index * 29) % 84)}%;top:${8 + ((index * 47) % 70)}%"></span>`).join("")}
          <div class="crossword-sphere"></div>
          <div class="sphere-copy">
            <h2>One puzzle. Every cursor alive.</h2>
            <p class="lede">Create a private room, invite up to three teammates, and solve in sync.</p>
          </div>
        </div>
      </section>
    </main>
  `;

  document.querySelector("#login-form").addEventListener("submit", (event) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    completeLogin({
      username: document.querySelector("#username").value.trim() || "You",
      email: document.querySelector("#email").value.trim() || "you@crossworld.test",
    });
  });
  for (const button of document.querySelectorAll("[data-provider]")) {
    button.addEventListener("click", () => {
      const google = button.dataset.provider === "google";
      completeLogin({
        username: google ? "Maya" : `Guest ${Math.floor(Math.random() * 90) + 10}`,
        email: google ? "maya@crossworld.test" : "guest@crossworld.test",
      });
    });
  }
}

function completeLogin(profile) {
  state.user = {
    id: cryptoId("user"),
    username: profile.username,
    email: profile.email,
    avatarUrl: "",
    createdAt: new Date().toISOString(),
  };
  saveJson(STORAGE_USER, state.user);
  state.view = "home";
  render();
}

function cryptoId(prefix) {
  const bytes = new Uint32Array(2);
  crypto.getRandomValues(bytes);
  return `${prefix}_${bytes[0].toString(16)}${bytes[1].toString(16)}`;
}

function renderHome() {
  app.innerHTML = `
    <main class="app-shell">
      <section class="lobby-wrap">
        <div class="lobby-hero panel">
          <div class="brand"><span class="logo-mark"></span> CrossWorld</div>
          <div class="lobby-title">
            <p class="kicker">Private multiplayer crossword</p>
            <h1>Start a room, solve together.</h1>
            <p class="lede">Playable imported puzzles with live typing, active-clue presence, clue ownership, chat, and results.</p>
          </div>
          <div class="lobby-actions">
            <button class="primary" id="create-room">Create Lobby</button>
            <button class="secondary" id="logout">Switch Profile</button>
          </div>
        </div>
        <aside class="lobby-card panel">
          <p class="section-label">Join Lobby</p>
          <h2>Enter invite code</h2>
          <p class="lede">Private rooms support 2-4 players, but you can start alone for local testing.</p>
          <form id="join-form" class="input-stack">
            <label class="field">Invite Code<input id="join-code" required maxlength="6" autocomplete="off" placeholder="7X9K2A" /></label>
            <button class="primary" type="submit">Join Lobby</button>
          </form>
        </aside>
      </section>
      <div id="toast-root"></div>
    </main>
  `;
  document.querySelector("#create-room").addEventListener("click", createLobby);
  document.querySelector("#logout").addEventListener("click", () => {
    localStorage.removeItem(STORAGE_USER);
    localStorage.removeItem(STORAGE_SESSION);
    state.user = null;
    state.room = null;
    state.view = "login";
    render();
  });
  document.querySelector("#join-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const code = document.querySelector("#join-code").value.trim().toUpperCase();
    await joinLobby(code);
  });
  renderToast();
}

async function createLobby() {
  try {
    const payload = await api("/api/lobby/create", {
      playerId: state.user.id,
      username: state.user.username,
      email: state.user.email,
    });
    state.playerId = payload.playerId;
    saveJson(STORAGE_SESSION, { code: payload.room.code, playerId: payload.playerId });
    openStream(payload.room.code, payload.playerId);
    applyRoom(payload.room);
  } catch (error) {
    setToast(error.message);
  }
}

async function joinLobby(code) {
  try {
    const payload = await api("/api/lobby/join", {
      code,
      playerId: state.user.id,
      username: state.user.username,
      email: state.user.email,
    });
    state.playerId = payload.playerId;
    saveJson(STORAGE_SESSION, { code: payload.room.code, playerId: payload.playerId });
    openStream(payload.room.code, payload.playerId);
    applyRoom(payload.room);
  } catch (error) {
    setToast(error.message);
  }
}

function avatar(player, size = "") {
  return `<span class="avatar ${size}" style="--player-color:${player.color};background:${player.avatarStyle}">${escapeHtml(initials(player.username))}</span>`;
}

function icon(name) {
  const icons = {
    back: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m15 18-6-6 6-6"/></svg>',
    pause: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M10 4v16"/><path d="M14 4v16"/></svg>',
    help: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M9.8 9a2.3 2.3 0 0 1 4.4 1c0 1.7-2.2 2-2.2 3.6"/><path d="M12 17h.01"/></svg>',
    print: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 9V4h10v5"/><path d="M7 17H5a3 3 0 0 1-3-3v-2a3 3 0 0 1 3-3h14a3 3 0 0 1 3 3v2a3 3 0 0 1-3 3h-2"/><path d="M7 14h10v6H7z"/></svg>',
    settings: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 15.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7Z"/><path d="M19.4 15a1.6 1.6 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.6 1.6 0 0 0-1.8-.3 1.6 1.6 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.2a1.6 1.6 0 0 0-1-1.5 1.6 1.6 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1A1.6 1.6 0 0 0 4.6 15a1.6 1.6 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.2a1.6 1.6 0 0 0 1.5-1 1.6 1.6 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1A1.6 1.6 0 0 0 9 4.6a1.6 1.6 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.2a1.6 1.6 0 0 0 1 1.5 1.6 1.6 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.6 1.6 0 0 0-.3 1.8 1.6 1.6 0 0 0 1.5 1h.2a2 2 0 1 1 0 4h-.2a1.6 1.6 0 0 0-1.4 1Z"/></svg>',
    grid: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 4h6v6H4z"/><path d="M14 4h6v6h-6z"/><path d="M4 14h6v6H4z"/><path d="M14 14h6v6h-6z"/></svg>',
    users: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>',
    chat: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M21 15a4 4 0 0 1-4 4H8l-5 3V7a4 4 0 0 1 4-4h10a4 4 0 0 1 4 4z"/></svg>',
    chevronUp: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m18 15-6-6-6 6"/></svg>',
    chevronDown: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg>',
    send: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m22 2-7 20-4-9-9-4Z"/><path d="M22 2 11 13"/></svg>',
  };
  return icons[name] || "";
}

function playerRows(players = state.room.players) {
  return players.map((player) => `
    <div class="player-row" style="--player-color:${player.color}">
      ${avatar(player)}
      <div>
        <div class="player-name">${escapeHtml(player.username)}${player.id === state.room.hostId ? " (Host)" : ""}</div>
        <div class="status"><span class="dot"></span>${player.online ? "Online" : "Away"}${player.ready ? " - Ready" : ""}</div>
      </div>
      <div class="score">${player.solvedCount}</div>
    </div>
  `).join("");
}

function renderLobby() {
  const room = state.room;
  const me = playerById(state.playerId);
  const isHost = room.hostId === state.playerId;
  const canStart = isHost && room.players.every((player) => player.id === room.hostId || player.ready);
  const puzzleSize = `${room.puzzle.width || room.puzzle.size}x${room.puzzle.height || room.puzzle.size}`;
  app.innerHTML = `
    <main class="app-shell">
      <section class="lobby-wrap">
        <div class="lobby-hero panel">
          <div class="brand"><span class="logo-mark"></span> CrossWorld</div>
          <div class="lobby-title">
            <p class="kicker">Lobby</p>
            <h1>${escapeHtml(room.puzzle.title)}</h1>
            <p class="lede">${escapeHtml(room.puzzle.subtitle)} - ${puzzleSize} - Private room - ${room.players.length}/${room.maxPlayers} players</p>
            <div class="room-code">
              <div>
                <p class="section-label" style="margin:0 0 6px">Invite Code</p>
                <div class="code">${escapeHtml(room.code)}</div>
              </div>
              <button class="ghost" id="copy-code">Copy</button>
            </div>
          </div>
          <div class="lobby-actions">
            <button class="secondary" id="ready-toggle">${me?.ready ? "Unready" : "Ready"}</button>
            <button class="primary" id="start-game" ${canStart ? "" : "disabled"}>Start Puzzle</button>
          </div>
        </div>
        <aside class="lobby-card panel">
          <p class="section-label">Players (${room.players.length}/${room.maxPlayers})</p>
          <div class="player-list">${playerRows(room.players)}</div>
          <div class="meter">
            <p class="section-label">Puzzle Metadata</p>
            <strong>${puzzleSize}</strong>
            <p class="lede" style="margin:0">Across and down clues, black squares, live clue validation, and contribution ownership.</p>
          </div>
          <button class="ghost" id="leave-room">Leave Lobby</button>
        </aside>
      </section>
      <div id="toast-root"></div>
    </main>
  `;
  document.querySelector("#ready-toggle").addEventListener("click", () => toggleReady(!me?.ready));
  document.querySelector("#start-game").addEventListener("click", startGame);
  document.querySelector("#leave-room").addEventListener("click", leaveRoom);
  document.querySelector("#copy-code").addEventListener("click", async () => {
    await navigator.clipboard.writeText(room.code);
    setToast("Invite code copied");
  });
  renderToast();
}

async function toggleReady(ready) {
  try {
    const payload = await api("/api/lobby/ready", { code: state.room.code, playerId: state.playerId, ready });
    applyRoom(payload.room);
  } catch (error) {
    setToast(error.message);
  }
}

async function startGame() {
  try {
    const payload = await api("/api/lobby/start", { code: state.room.code, playerId: state.playerId });
    applyRoom(payload.room);
  } catch (error) {
    setToast(error.message);
  }
}

async function leaveRoom() {
  try {
    if (state.room) await api("/api/lobby/leave", { code: state.room.code, playerId: state.playerId });
  } catch {
    // Leaving should still return the local user home.
  }
  if (state.stream) state.stream.close();
  localStorage.removeItem(STORAGE_SESSION);
  state.room = null;
  state.playerId = null;
  state.view = "home";
  render();
}

function renderGame() {
  const room = state.room;
  const stats = progress(room);
  app.innerHTML = `
    <main class="app-shell game-screen">
      <header class="topbar">
        <button class="back-button" id="back-button" type="button" aria-label="Back">${icon("back")}<span>Back</span></button>
        <div class="game-title">
          <div id="timer" class="timer">${duration(room.startedAt, room.completedAt)}</div>
        </div>
        <div class="toolbar">
          <div class="mobile-actions">
            <button class="icon-button" id="toggle-sidebar" title="Players" aria-label="Players">${icon("users")}</button>
            <button class="icon-button ${state.unreadChat ? "has-unread" : ""}" id="toggle-chat-mobile" title="Chat" aria-label="Chat">${icon("chat")}${state.unreadChat ? '<span class="unread-dot"></span>' : ""}</button>
          </div>
          <button class="icon-button desktop-tool" type="button" title="Help" aria-label="Help">${icon("help")}</button>
          <button class="icon-button desktop-tool" type="button" title="Print" aria-label="Print">${icon("print")}</button>
          <button class="icon-button desktop-tool" type="button" title="Settings" aria-label="Settings">${icon("settings")}</button>
        </div>
      </header>
      <section class="game-grid ${state.openClueList ? "clue-list-open" : ""}">
        ${renderSidebar(stats)}
        <section class="board-zone">
          <div class="board-shell"><div id="board" class="crossword-board" style="--grid-width:${room.puzzle.width || room.puzzle.size};--grid-height:${room.puzzle.height || room.puzzle.size}">${renderBoardCells()}</div></div>
          ${renderClueCard()}
          <input id="puzzle-keyboard" class="puzzle-keyboard" inputmode="none" autocomplete="off" autocapitalize="characters" readonly aria-label="Puzzle keyboard input" />
          ${renderMobileKeyboard()}
        </section>
        ${renderClues()}
        ${renderChat()}
      </section>
      <div id="toast-root"></div>
    </main>
  `;
  bindGameEvents();
  renderToast();
}

function renderGameChromeOnly() {
  const timer = document.querySelector("#timer");
  if (timer && state.room) timer.textContent = duration(state.room.startedAt, state.room.completedAt);
}

function renderSidebar(stats = progress()) {
  return `
    <aside class="sidebar panel ${state.openSidebar ? "open" : ""}" id="sidebar">
      <p class="section-label">Players</p>
      <div class="player-list">${playerRows()}</div>
      <div class="meter">
        <p class="section-label">Total Solved</p>
        <strong>${allClues().filter((clue) => clue.solvedAt).length}<span style="font-size:18px;color:var(--dim)"> / ${allClues().length}</span></strong>
        <div class="bar" style="--progress:${stats.percent}%"><span></span></div>
        <div class="status" style="margin-top:9px">${stats.percent}% Completed</div>
      </div>
      <p class="section-label">Presence</p>
      <div class="status">Active cells and clue highlights sync instantly across the lobby.</div>
    </aside>
  `;
}

function renderBoardCells() {
  const activeClue = clueById(state.active.clueId) || clueForCell(state.active.row, state.active.col);
  const activeKeys = new Set(activeClue?.cells.map((cell) => `${cell.row}:${cell.col}`) || []);
  const me = playerById(state.playerId);
  const width = state.room.puzzle.width || state.room.puzzle.size;
  return state.room.puzzle.cells.map((cell) => {
    const edgeClass = cell.col === width - 1 ? "last-column" : "";
    if (cell.isBlack) return `<div class="cell black ${edgeClass}" data-row="${cell.row}" data-col="${cell.col}"></div>`;
    const peers = state.room.players.filter((player) =>
      player.id !== state.playerId &&
      player.online &&
      player.cursor?.row === cell.row &&
      player.cursor?.col === cell.col
    );
    const peer = peers[0];
    const peerCluePlayers = state.room.players.filter((player) => {
      if (player.id === state.playerId || !player.online || !player.cursor?.clueId) return false;
      const clue = clueById(player.cursor.clueId);
      return clue?.solvedAt && clue.cells.some((pos) => pos.row === cell.row && pos.col === cell.col);
    });
    const peerCluePlayer = peerCluePlayers[0];
    const solvedClues = allClues().filter((clue) =>
      clue.solvedAt &&
      clue.ownerId &&
      clue.cells.some((pos) => pos.row === cell.row && pos.col === cell.col)
    );
    const acrossClue = solvedClues.find((clue) => clue.direction === "across");
    const downClue = solvedClues.find((clue) => clue.direction === "down");
    const acrossOwner = playerById(acrossClue?.ownerId);
    const downOwner = playerById(downClue?.ownerId);
    const splitOwner = acrossOwner && downOwner && acrossOwner.id !== downOwner.id;
    const singleOwner = splitOwner ? null : (acrossOwner || downOwner);
    const ownedSolved = Boolean(acrossOwner || downOwner);
    const triangleColors = splitOwner ? solvedTriangleColors(cell, acrossClue, acrossOwner, downClue, downOwner) : null;
    const classes = [
      "cell",
      edgeClass,
      activeKeys.has(`${cell.row}:${cell.col}`) ? "selected-clue" : "",
      peerCluePlayer ? "peer-clue" : "",
      state.active.row === cell.row && state.active.col === cell.col ? "active" : "",
      peer ? "peer" : "",
      singleOwner ? "solved-owner" : "",
      splitOwner ? "triangle-owner" : "",
      state.solvedFlash.size && ownedSolved ? "solved" : "",
    ].filter(Boolean).join(" ");
    const styleParts = [];
    if (peer) styleParts.push(`--peer-color:${peer.color}`);
    if (me) styleParts.push(`--active-color:${me.color}`);
    if (peerCluePlayer) styleParts.push(`--peer-clue-color:${peerCluePlayer.color}`);
    if (singleOwner) styleParts.push(`--solve-color-a:${singleOwner.color}`);
    if (triangleColors) {
      styleParts.push(`--tri-top:${triangleColors.top}`);
      styleParts.push(`--tri-right:${triangleColors.right}`);
      styleParts.push(`--tri-bottom:${triangleColors.bottom}`);
      styleParts.push(`--tri-left:${triangleColors.left}`);
    }
    return `
      <button class="${classes}" data-row="${cell.row}" data-col="${cell.col}" style="${styleParts.join(";")}" aria-label="Row ${cell.row + 1}, column ${cell.col + 1}">
        ${cell.clueNumber ? `<span class="num">${cell.clueNumber}</span>` : ""}
        <span class="cell-value">${escapeHtml(cell.value)}</span>
        ${peer ? `<span class="peer-cursor" title="${escapeHtml(peer.username)}" style="--peer-color:${peer.color}"></span>` : ""}
      </button>
    `;
  }).join("");
}

function renderBoardOnly() {
  const board = document.querySelector("#board");
  if (board && state.room) board.innerHTML = renderBoardCells();
}

function clueExtensionTriangles(clue, row, col) {
  if (!clue || clue.cells.length <= 1) return [];
  const index = clue.cells.findIndex((cell) => cell.row === row && cell.col === col);
  if (index < 0) return [];
  const lastIndex = clue.cells.length - 1;
  if (clue.direction === "across") {
    if (index === 0) return ["right"];
    if (index === lastIndex) return ["left"];
    return ["left", "right"];
  }
  if (index === 0) return ["bottom"];
  if (index === lastIndex) return ["top"];
  return ["top", "bottom"];
}

function solvedTriangleColors(cell, acrossClue, acrossOwner, downClue, downOwner) {
  const base = "transparent";
  const colors = { top: base, right: base, bottom: base, left: base };
  const acrossSides = clueExtensionTriangles(acrossClue, cell.row, cell.col);
  const downSides = clueExtensionTriangles(downClue, cell.row, cell.col);
  const acrossColor = colorMix(acrossOwner.color, 30);
  const downColor = colorMix(downOwner.color, 30);

  for (const side of acrossSides) colors[side] = acrossColor;
  for (const side of downSides) colors[side] = downColor;

  const unfilled = Object.keys(colors).filter((side) => colors[side] === base);
  if (unfilled.length) {
    const fallback = downSides.length > acrossSides.length ? downColor : acrossSides.length > downSides.length ? acrossColor : base;
    if (fallback !== base) {
      for (const side of unfilled) colors[side] = fallback;
    }
  }

  return colors;
}

function colorMix(color, amount) {
  return `color-mix(in srgb, ${color} ${amount}%, #f8fafc)`;
}

function renderMobileKeyboard() {
  const rows = ["QWERTYUIOP", "ASDFGHJKL"];
  return `
    <div class="mobile-keyboard" aria-label="Mobile crossword keyboard">
      ${rows.map((row) => `
        <div class="mobile-keyboard-row ${row === "ASDFGHJKL" ? "with-list" : ""}">
          ${row.split("").map((key) => `<button type="button" class="mobile-key" data-key="${key}">${key}</button>`).join("")}
          ${row === "ASDFGHJKL" ? '<button type="button" class="mobile-key utility-list" data-key="List">List</button>' : ""}
        </div>
      `).join("")}
      <div class="mobile-keyboard-row utility">
        <button type="button" class="mobile-key utility-number" data-key="Number">123</button>
        ${"ZXCVBNM".split("").map((key) => `<button type="button" class="mobile-key" data-key="${key}">${key}</button>`).join("")}
        <button type="button" class="mobile-key utility-delete" data-key="Backspace">←</button>
      </div>
    </div>
  `;
}

function renderClueCard() {
  const clue = clueById(state.active.clueId) || state.room.puzzle.cluesAcross[0];
  const direction = clue.direction[0].toUpperCase() + clue.direction.slice(1);
  return `
    <div class="clue-card panel" id="clue-card">
      <button class="clue-card-arrow" id="previous-clue" type="button" aria-label="Previous clue">&lt;</button>
      <div class="clue-card-content">
        <strong>${clue.number} ${escapeHtml(direction)}:</strong>
        <span>${escapeHtml(clue.text)}</span>
      </div>
      <button class="clue-card-arrow" id="next-clue" type="button" aria-label="Next clue">&gt;</button>
    </div>
  `;
}

function renderClues() {
  const clues = state.clueTab === "across" ? state.room.puzzle.cluesAcross : state.room.puzzle.cluesDown;
  return `
    <aside class="clues-panel panel ${state.openClueList ? "open" : ""}">
      <div class="tabs">
        <button class="tab ${state.clueTab === "across" ? "active" : ""}" data-tab="across">Across</button>
        <button class="tab ${state.clueTab === "down" ? "active" : ""}" data-tab="down">Down</button>
      </div>
      <div class="clue-list">
        ${clues.map((clue) => {
          const owner = playerById(clue.ownerId);
          return `
            <button class="clue ${state.active.clueId === clue.id ? "active" : ""} ${clue.solvedAt ? "solved" : ""}" data-clue-id="${clue.id}">
              <strong>${clue.number}</strong>
              <span>${escapeHtml(clue.text)}</span>
              ${owner ? `<span class="mini-owner" style="--player-color:${owner.color};background:${owner.avatarStyle}">${escapeHtml(initials(owner.username))}</span>` : `<span>${clue.answer.length}</span>`}
            </button>
          `;
        }).join("")}
      </div>
    </aside>
  `;
}

function renderChat() {
  const unread = state.unreadChat && (state.collapsedChat || (compactLayout() && !state.openChat));
  const cls = [
    "chat-panel",
    "panel",
    state.collapsedChat ? "collapsed" : "",
    state.openChat ? "open" : "",
  ].join(" ");
  return `
    <aside class="${cls}" id="chat">
      <div class="chat-head">
        <p class="section-label" style="margin:0"><span>Chat</span></p>
        <button class="icon-button ${unread ? "has-unread" : ""}" id="toggle-chat" title="Toggle chat" aria-label="Toggle chat">${state.collapsedChat ? icon("chevronDown") : icon("chevronUp")}${unread ? '<span class="unread-dot"></span>' : ""}</button>
      </div>
      <div class="chat-body">
        ${state.room.messages.slice(-40).map((message) => {
          const player = playerById(message.playerId) || { username: "Player", color: "#B8C2D6", avatarStyle: "rgba(255,255,255,.14)" };
          return `
            <article class="message" style="--player-color:${player.color}">
              ${avatar(player)}
              <div>
                <div class="message-meta"><strong>${escapeHtml(player.username)}</strong><span>${timeLabel(message.at)}</span></div>
                <p>${escapeHtml(message.text)}</p>
              </div>
            </article>
          `;
        }).join("") || `<p class="lede">No messages yet.</p>`}
      </div>
      <form class="chat-form" id="chat-form">
        <input id="chat-input" placeholder="Type a message..." maxlength="500" autocomplete="off" />
        <button class="primary" type="submit" aria-label="Send">${icon("send")}</button>
      </form>
    </aside>
  `;
}

function bindGameEvents() {
  const board = document.querySelector("#board");
  board.addEventListener("pointerdown", (event) => {
    const button = event.target.closest("[data-row]");
    if (!button || button.classList.contains("black")) return;
    focusPuzzleKeyboard();
  });
  board.addEventListener("click", (event) => {
    const button = event.target.closest("[data-row]");
    if (!button || button.classList.contains("black")) return;
    const row = Number(button.dataset.row);
    const col = Number(button.dataset.col);
    if (state.active.row === row && state.active.col === col) {
      toggleDirection();
    } else {
      selectCell(row, col);
    }
  });
  document.onkeydown = handleKeydown;
  bindClueControls();
  document.querySelector("#toggle-chat").addEventListener("click", () => {
    if (window.matchMedia("(max-width: 1320px)").matches) state.openChat = !state.openChat;
    state.collapsedChat = !state.collapsedChat;
    if (!state.collapsedChat || state.openChat) state.unreadChat = 0;
    renderGame();
    if (state.openChat || !state.collapsedChat) focusChatInput();
  });
  document.querySelector("#chat-form").addEventListener("submit", sendChat);
  const puzzleInput = document.querySelector("#puzzle-keyboard");
  puzzleInput?.addEventListener("input", handlePuzzleInput);
  puzzleInput?.addEventListener("keydown", handlePuzzleInputKeydown);
  bindMobileKeyboard();
  document.querySelector("#back-button")?.addEventListener("click", leaveRoom);
  document.querySelector("#toggle-sidebar")?.addEventListener("click", () => {
    state.openSidebar = !state.openSidebar;
    renderGame();
  });
  document.querySelector("#toggle-chat-mobile")?.addEventListener("click", () => {
    state.openChat = !state.openChat;
    state.collapsedChat = false;
    if (state.openChat) state.unreadChat = 0;
    renderGame();
    if (state.openChat) focusChatInput();
  });
}

function bindClueControls() {
  bindClueCardControls();
  bindClueListControls();
}

function bindClueCardControls() {
  document.querySelector("#previous-clue")?.addEventListener("click", goToPreviousClue);
  document.querySelector("#next-clue")?.addEventListener("click", goToNextClue);
}

function bindClueListControls() {
  document.querySelectorAll("[data-tab]").forEach((button) => {
    button.addEventListener("click", () => {
      state.clueTab = button.dataset.tab;
      refreshGameSelection();
    });
  });
  document.querySelectorAll("[data-clue-id]").forEach((button) => {
    button.addEventListener("click", () => selectClue(button.dataset.clueId));
  });
}

function refreshGameSelection() {
  renderBoardOnly();
  const clueCard = document.querySelector("#clue-card");
  if (clueCard) {
    clueCard.outerHTML = renderClueCard();
    bindClueCardControls();
  }
  const cluesPanel = document.querySelector(".clues-panel");
  if (cluesPanel) {
    cluesPanel.outerHTML = renderClues();
    bindClueListControls();
  }
}

function bindMobileKeyboard() {
  document.querySelectorAll("[data-key]").forEach((button) => {
    button.addEventListener("click", () => {
      const key = button.dataset.key;
      if (/^[A-Z]$/.test(key)) {
        updateCell(key);
      } else if (key === "Backspace") {
        const current = cellAt(state.active.row, state.active.col);
        if (current?.value) {
          updateCell("");
        } else {
          moveBy(-1);
          updateCell("");
        }
      } else if (key === "Enter") {
        toggleDirection();
      } else if (key === "List") {
        state.openClueList = !state.openClueList;
        renderGame();
      }
    });
  });
}

function isTypingInInput(event) {
  const tag = event.target?.tagName?.toLowerCase();
  return tag === "input" || tag === "textarea";
}

function handleKeydown(event) {
  if (state.view !== "game" || isTypingInInput(event)) return;
  const key = event.key;
  if (/^[a-zA-Z]$/.test(key)) {
    event.preventDefault();
    updateCell(key.toUpperCase());
    return;
  }
  if (key === "Backspace") {
    event.preventDefault();
    const current = cellAt(state.active.row, state.active.col);
    if (current?.value) {
      updateCell("");
    } else {
      moveBy(-1);
      updateCell("");
    }
    return;
  }
  if (key === "Enter" || key === " ") {
    event.preventDefault();
    toggleDirection();
    return;
  }
  if (key === "Tab") {
    event.preventDefault();
    if (event.shiftKey) {
      goToPreviousClue();
    } else {
      goToNextClue();
    }
    return;
  }
  const arrows = {
    ArrowLeft: [0, -1, "across"],
    ArrowRight: [0, 1, "across"],
    ArrowUp: [-1, 0, "down"],
    ArrowDown: [1, 0, "down"],
  };
  if (arrows[key]) {
    event.preventDefault();
    const [dr, dc, direction] = arrows[key];
    state.active.direction = direction;
    moveGrid(dr, dc);
  }
}

function selectCell(row, col, direction = state.active.direction) {
  const clue = clueForCell(row, col, direction);
  if (!clue) return;
  state.active = { row, col, direction: clue.direction, clueId: clue.id };
  state.clueTab = clue.direction;
  postCursor();
  refreshGameSelection();
  focusPuzzleKeyboard();
}

function selectClue(clueId) {
  const clue = clueById(clueId);
  if (!clue) return;
  state.openClueList = false;
  activateClue(clue);
  renderGame();
}

function activateClue(clue) {
  const first = clue.cells[0];
  state.active = { row: first.row, col: first.col, direction: clue.direction, clueId: clue.id };
  state.clueTab = clue.direction;
  postCursor();
  refreshGameSelection();
  focusPuzzleKeyboard();
}

function goToClueOffset(offset) {
  const clues = activeClues();
  if (!clues.length) return;
  const currentIndex = Math.max(0, clues.findIndex((clue) => clue.id === state.active.clueId));
  const nextIndex = (currentIndex + offset + clues.length) % clues.length;
  activateClue(clues[nextIndex]);
}

function goToPreviousClue() {
  goToClueOffset(-1);
}

function goToNextClue() {
  goToClueOffset(1);
}

function focusPuzzleKeyboard() {
  const input = document.querySelector("#puzzle-keyboard");
  if (!input) return;
  input.value = "";
  input.blur();
}

function handlePuzzleInput(event) {
  const next = String(event.target.value || "").slice(-1).toUpperCase();
  event.target.value = "";
  if (/^[A-Z]$/.test(next)) updateCell(next);
}

function handlePuzzleInputKeydown(event) {
  if (event.key === "Backspace") {
    event.preventDefault();
    const current = cellAt(state.active.row, state.active.col);
    if (current?.value) {
      updateCell("");
    } else {
      moveBy(-1);
      updateCell("");
    }
  } else if (event.key === "Enter" || event.key === " ") {
    event.preventDefault();
    toggleDirection();
  } else if (event.key === "Tab") {
    event.preventDefault();
    if (event.shiftKey) {
      goToPreviousClue();
    } else {
      goToNextClue();
    }
  } else if (event.key === "ArrowLeft") {
    event.preventDefault();
    state.active.direction = "across";
    moveGrid(0, -1);
  } else if (event.key === "ArrowRight") {
    event.preventDefault();
    state.active.direction = "across";
    moveGrid(0, 1);
  } else if (event.key === "ArrowUp") {
    event.preventDefault();
    state.active.direction = "down";
    moveGrid(-1, 0);
  } else if (event.key === "ArrowDown") {
    event.preventDefault();
    state.active.direction = "down";
    moveGrid(1, 0);
  }
}

function toggleDirection() {
  const nextDirection = state.active.direction === "across" ? "down" : "across";
  const clue = clueForCell(state.active.row, state.active.col, nextDirection);
  if (clue) {
    state.active.direction = clue.direction;
    state.active.clueId = clue.id;
    state.clueTab = clue.direction;
    postCursor();
    refreshGameSelection();
    focusPuzzleKeyboard();
  }
}

function moveGrid(dr, dc) {
  let row = state.active.row + dr;
  let col = state.active.col + dc;
  const width = state.room.puzzle.width || state.room.puzzle.size;
  const height = state.room.puzzle.height || state.room.puzzle.size;
  while (row >= 0 && row < height && col >= 0 && col < width) {
    const cell = cellAt(row, col);
    if (cell && !cell.isBlack) {
      selectCell(row, col, state.active.direction);
      return;
    }
    row += dr;
    col += dc;
  }
}

function moveBy(offset) {
  const clue = clueById(state.active.clueId) || clueForCell(state.active.row, state.active.col);
  if (!clue) return;
  const index = clue.cells.findIndex((pos) => pos.row === state.active.row && pos.col === state.active.col);
  const next = clue.cells[Math.max(0, Math.min(clue.cells.length - 1, index + offset))];
  if (next) selectCell(next.row, next.col, clue.direction);
}

async function updateCell(value) {
  const cell = cellAt(state.active.row, state.active.col);
  if (!cell || cell.isBlack) return;
  const activeClue = clueById(state.active.clueId);
  if (activeClue?.solvedAt) {
    setToast("That clue is already solved.");
    return;
  }
  const solvedCellClues = solvedCluesForCell(cell.row, cell.col);
  if (solvedCellClues.length && value !== cell.value) {
    setToast("Solved letters are locked.");
    return;
  }
  cell.value = value;
  renderBoardOnly();
  if (value) moveBy(1);
  try {
    await api("/api/cell", {
      code: state.room.code,
      playerId: state.playerId,
      row: cell.row,
      col: cell.col,
      clueId: state.active.clueId,
      value,
    });
  } catch (error) {
    setToast(error.message);
  }
}

async function postCursor() {
  try {
    await api("/api/cursor", {
      code: state.room.code,
      playerId: state.playerId,
      row: state.active.row,
      col: state.active.col,
      direction: state.active.direction,
      clueId: state.active.clueId,
    });
  } catch {
    // Cursor sync should never interrupt local solving.
  }
}

async function sendChat(event) {
  event.preventDefault();
  const input = document.querySelector("#chat-input");
  const text = input.value.trim();
  if (!text) return;
  input.value = "";
  try {
    await api("/api/chat", { code: state.room.code, playerId: state.playerId, text });
    focusChatInput();
  } catch (error) {
    setToast(error.message);
  }
}

function focusChatInput() {
  setTimeout(() => {
    const input = document.querySelector("#chat-input");
    if (!input || input.closest(".chat-panel.collapsed")) return;
    input.focus({ preventScroll: true });
  }, 0);
}

function renderResults() {
  const room = state.room;
  const ranked = [...room.players].sort((a, b) => b.solvedCount - a.solvedCount);
  const stats = progress(room);
  app.innerHTML = `
    <main class="app-shell">
      <section class="results-screen">
        <div class="results-card panel">
          <div class="brand"><span class="logo-mark"></span> CrossWorld</div>
          <p class="kicker">Puzzle Complete</p>
          <h1>Great job, team.</h1>
          <p class="lede">Completed in ${duration(room.startedAt, room.completedAt)} with ${stats.correct}/${stats.total} correct cells.</p>
          <div class="podium">
            ${ranked.slice(0, 3).map((player, index) => `
              <div class="podium-card" style="--player-color:${player.color}">
                ${avatar(player, "large")}
                <p class="section-label" style="margin:14px 0 4px">Rank ${index + 1}</p>
                <h3>${escapeHtml(player.username)}</h3>
                <div class="score">${player.solvedCount}</div>
              </div>
            `).join("")}
          </div>
          <div class="stat-grid">
            <div class="stat"><span>Total Clues Solved</span><strong>${allClues().filter((clue) => clue.solvedAt).length}</strong></div>
            <div class="stat"><span>Completion Time</span><strong>${duration(room.startedAt, room.completedAt)}</strong></div>
            <div class="stat"><span>Accuracy</span><strong>${teamAccuracy()}%</strong></div>
          </div>
          <div class="lobby-actions" style="grid-template-columns:1fr 1fr">
            <button class="secondary" id="back-lobby">Back to Lobby</button>
            <button class="primary" id="home">Home</button>
          </div>
        </div>
      </section>
      <div id="toast-root"></div>
    </main>
  `;
  document.querySelector("#back-lobby").addEventListener("click", () => {
    state.view = "lobby";
    renderLobby();
  });
  document.querySelector("#home").addEventListener("click", leaveRoom);
  renderToast();
}

function teamAccuracy() {
  const typed = state.room.players.reduce((sum, player) => sum + player.accuracy.typed, 0);
  const correct = state.room.players.reduce((sum, player) => sum + player.accuracy.correct, 0);
  return typed ? Math.round((correct / typed) * 100) : 100;
}

function renderToast() {
  const root = document.querySelector("#toast-root");
  if (!root) return;
  root.innerHTML = state.toast ? `<div class="toast">${escapeHtml(state.toast)}</div>` : "";
}
