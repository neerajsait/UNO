/**
 * socketHandler.js — Socket.io event handler for UNO multiplayer
 * Manages rooms, players, bots, spectators, game events, chat, room settings,
 * emojis, input validation, room cleanup, reconnection, kick, and pause.
 */

const {
    createGame,
    playCard,
    drawCard,
    chooseColor,
    callUno,
    challengeUno,
    resolveWild4Challenge,
    resolveDrawnCard,
    removePlayer,
    getPlayerView,
    COLORS,
    DEFAULT_SETTINGS
} = require('./gameLogic');

const {
    sanitizeName,
    validateRoomCode,
    isValidCardId,
    generateSessionToken
} = require('./rateLimiter');

const {
    createBot,
    decideBotMove,
    shouldCallUno,
    shouldPlayDrawnCard
} = require('./botPlayer');

const rooms = new Map();

// ──────────────────────────────────────────────
//  ROOM CLEANUP
// ──────────────────────────────────────────────
const ROOM_IDLE_TIMEOUT_MS = 30 * 60 * 1000;
const CLEANUP_INTERVAL_MS = 5 * 60 * 1000;

setInterval(() => {
    const now = Date.now();
    let cleaned = 0;
    for (const [code, room] of rooms) {
        if (now - room.lastActivity > ROOM_IDLE_TIMEOUT_MS) {
            clearTurnTimer(code);
            rooms.delete(code);
            cleaned++;
        }
    }
    if (cleaned > 0) console.log(`[Cleanup] Removed ${cleaned} idle room(s). Active: ${rooms.size}`);
}, CLEANUP_INTERVAL_MS);

// ──────────────────────────────────────────────
//  HELPERS
// ──────────────────────────────────────────────

function generateRoomCode() {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let code = '';
    for (let i = 0; i < 6; i++) code += chars[Math.floor(Math.random() * chars.length)];
    return rooms.has(code) ? generateRoomCode() : code;
}

const VALID_AVATARS = ['🦊','🐱','🦁','🐸','🐙','🦄','🐺','🦇','🐲','🐨','🦈','🐍'];
function sanitizeAvatar(av) {
    return VALID_AVATARS.includes(av) ? av : '🦊';
}

function touchRoom(room) { room.lastActivity = Date.now(); }

function broadcastGameState(io, room) {
    if (!room.game) return;
    for (const player of room.players) {
        if (player.isBot) continue;
        const view = getPlayerView(room.game, player.id);
        view.avatar = player.avatar;
        // Include avatar info for all players
        view.players = view.players.map(p => {
            const roomPlayer = room.players.find(rp => rp.id === p.id);
            return { ...p, avatar: roomPlayer?.avatar, isBot: roomPlayer?.isBot || false };
        });
        io.to(player.id).emit('game-state', view);
    }
    // Send spectator view
    for (const spec of (room.spectators || [])) {
        const view = getPlayerView(room.game, null);
        view.isSpectator = true;
        view.players = view.players.map(p => {
            const roomPlayer = room.players.find(rp => rp.id === p.id);
            return { ...p, avatar: roomPlayer?.avatar, isBot: roomPlayer?.isBot || false };
        });
        io.to(spec.id).emit('game-state', view);
    }
}

function broadcastPlayerList(io, room) {
    const playerList = room.players.map(p => ({
        id: p.id,
        name: p.name,
        avatar: p.avatar,
        isHost: p.id === room.hostId,
        isBot: p.isBot || false,
    }));
    io.to(room.code).emit('player-list', {
        players: playerList,
        roomCode: room.code,
        hostId: room.hostId
    });
}

function broadcastSettings(io, room) {
    io.to(room.code).emit('room-settings', {
        settings: room.settings,
        hostId: room.hostId
    });
}

// ──────────────────────────────────────────────
//  TURN TIMER
// ──────────────────────────────────────────────
const turnTimers = new Map();

function startTurnTimer(io, room) {
    const gameId = room.code;
    clearTurnTimer(gameId);
    if (!room.game || !room.settings.turnTimer || room.settings.turnTimer <= 0) return;
    if (room.game.status !== 'playing' || room.game.paused) return;

    const currentPlayer = room.game.players[room.game.currentPlayerIndex];
    if (!currentPlayer) return;

    const timeout = room.settings.turnTimer * 1000;
    io.to(room.code).emit('turn-timer', {
        playerId: currentPlayer.id,
        duration: room.settings.turnTimer
    });

    const timer = setTimeout(() => {
        if (!room.game || room.game.status !== 'playing' || room.game.paused) return;
        const cp = room.game.players[room.game.currentPlayerIndex];
        if (cp && cp.id === currentPlayer.id) {
            const result = drawCard(room.game, cp.id);
            if (result.success) {
                if (result.canPlayDrawn) resolveDrawnCard(room.game, cp.id, false);
                broadcastGameState(io, room);
                triggerBotTurnIfNeeded(io, room);
                startTurnTimer(io, room);
                io.to(room.code).emit('chat-message', {
                    sender: '⏱️ Timer', message: `${cp.name} ran out of time`,
                    timestamp: Date.now(), isSystem: true
                });
            }
        }
    }, timeout);

    turnTimers.set(gameId, timer);
}

function clearTurnTimer(gameId) {
    if (turnTimers.has(gameId)) {
        clearTimeout(turnTimers.get(gameId));
        turnTimers.delete(gameId);
    }
}

// ──────────────────────────────────────────────
//  BOT AI TURN
// ──────────────────────────────────────────────
function triggerBotTurnIfNeeded(io, room) {
    if (!room.game || room.game.status !== 'playing' || room.game.paused) return;

    const currentPlayer = room.game.players[room.game.currentPlayerIndex];
    if (!currentPlayer) return;

    const roomPlayer = room.players.find(p => p.id === currentPlayer.id);
    if (!roomPlayer || !roomPlayer.isBot) return;

    // Bot plays after a realistic delay
    const delay = 800 + Math.random() * 1200;
    setTimeout(() => {
        if (!room.game || room.game.status !== 'playing' || room.game.paused) return;
        const cp = room.game.players[room.game.currentPlayerIndex];
        if (!cp || cp.id !== currentPlayer.id) return;

        const move = decideBotMove(room.game, cp.id, roomPlayer.difficulty);

        if (move.action === 'draw') {
            const result = drawCard(room.game, cp.id);
            if (result.success) {
                if (result.canPlayDrawn) {
                    const play = shouldPlayDrawnCard(result.drawnCard, room.game, roomPlayer.difficulty);
                    if (play && result.drawnCard.type === 'wild') {
                        const color = COLORS[Math.floor(Math.random() * COLORS.length)];
                        resolveDrawnCard(room.game, cp.id, true, color);
                    } else {
                        resolveDrawnCard(room.game, cp.id, play);
                    }
                }
                broadcastGameState(io, room);
                io.to(room.code).emit('bot-played', { botName: roomPlayer.name });

                // Check UNO call
                if (shouldCallUno(room.game, cp.id, roomPlayer.difficulty)) {
                    callUno(room.game, cp.id);
                    broadcastGameState(io, room);
                }

                if (room.game.status === 'finished') {
                    handleGameOver(io, room);
                } else {
                    triggerBotTurnIfNeeded(io, room);
                    startTurnTimer(io, room);
                }
            }
        } else if (move.action === 'play') {
            const result = playCard(room.game, cp.id, move.cardId, move.chosenColor);
            if (result.success) {
                if (result.needsColorChoice) {
                    const color = move.chosenColor || COLORS[Math.floor(Math.random() * COLORS.length)];
                    chooseColor(room.game, cp.id, color);
                }

                broadcastGameState(io, room);
                io.to(room.code).emit('bot-played', { botName: roomPlayer.name });

                // Check UNO call
                if (shouldCallUno(room.game, cp.id, roomPlayer.difficulty)) {
                    callUno(room.game, cp.id);
                    broadcastGameState(io, room);
                }

                // Play sound cue for action cards
                const card = room.game.discardPile[room.game.discardPile.length - 1];
                if (card && ['skip', 'reverse'].includes(card.value)) {
                    io.to(room.code).emit('action-sound', { type: card.value });
                }

                if (room.game.status === 'finished') {
                    handleGameOver(io, room);
                } else {
                    triggerBotTurnIfNeeded(io, room);
                    startTurnTimer(io, room);
                }
            } else {
                // Fallback: draw
                const drawResult = drawCard(room.game, cp.id);
                if (drawResult.success) {
                    if (drawResult.canPlayDrawn) resolveDrawnCard(room.game, cp.id, false);
                    broadcastGameState(io, room);
                    triggerBotTurnIfNeeded(io, room);
                    startTurnTimer(io, room);
                }
            }
        }
    }, delay);
}

// ──────────────────────────────────────────────
//  GAME OVER HANDLER
// ──────────────────────────────────────────────
function handleGameOver(io, room) {
    if (!room.game || room.game.status !== 'finished') return;
    clearTurnTimer(room.code);
    const winnerName = room.players.find(p => p.id === room.game.winner)?.name || 'Unknown';
    io.to(room.code).emit('game-over', { winnerId: room.game.winner, winnerName });
    io.to(room.code).emit('chat-message', {
        sender: '🎮 System', message: `🏆 ${winnerName} wins the game!`,
        timestamp: Date.now(), isSystem: true
    });
}

// ──────────────────────────────────────────────
//  MAIN HANDLER
// ──────────────────────────────────────────────
function registerSocketHandler(io) {
    io.on('connection', (socket) => {
        console.log(`[Socket] Connected: ${socket.id}`);

        // ─── CREATE ROOM ─────────────────────────────
        socket.on('create-room', ({ playerName, avatar }) => {
            const nameResult = sanitizeName(playerName);
            if (!nameResult.valid) {
                socket.emit('error-message', { message: nameResult.error });
                return;
            }

            const code = generateRoomCode();
            const sessionToken = generateSessionToken();
            const player = {
                id: socket.id, name: nameResult.name, avatar: sanitizeAvatar(avatar),
                sessionToken, isBot: false
            };

            const room = {
                code, hostId: socket.id, players: [player], spectators: [],
                game: null, chat: [], status: 'lobby',
                settings: { ...DEFAULT_SETTINGS }, lastActivity: Date.now(),
            };

            rooms.set(code, room);
            socket.join(code);
            socket.roomCode = code;
            socket.playerName = nameResult.name;
            socket.sessionToken = sessionToken;

            socket.emit('room-created', { roomCode: code, playerId: socket.id, sessionToken });
            broadcastPlayerList(io, room);
            broadcastSettings(io, room);
            console.log(`[Room] ${nameResult.name} created room ${code}`);
        });

        // ─── JOIN ROOM ───────────────────────────────
        socket.on('join-room', ({ roomCode, playerName, avatar }) => {
            const nameResult = sanitizeName(playerName);
            if (!nameResult.valid) {
                socket.emit('error-message', { message: nameResult.error });
                return;
            }
            const codeResult = validateRoomCode(roomCode);
            if (!codeResult.valid) {
                socket.emit('error-message', { message: codeResult.error });
                return;
            }

            const code = codeResult.code;
            const room = rooms.get(code);

            if (!room) {
                socket.emit('error-message', { message: 'Room not found.' });
                return;
            }
            if (room.status === 'playing') {
                // Allow joining as spectator if game in progress
                const sessionToken = generateSessionToken();
                const spectator = {
                    id: socket.id, name: nameResult.name, avatar: sanitizeAvatar(avatar),
                    sessionToken
                };
                room.spectators = room.spectators || [];
                room.spectators.push(spectator);
                socket.join(code);
                socket.roomCode = code;
                socket.playerName = nameResult.name;
                socket.sessionToken = sessionToken;
                socket.isSpectator = true;

                socket.emit('room-joined', { roomCode: code, playerId: socket.id, sessionToken });
                io.to(code).emit('spectator-joined', { name: nameResult.name });
                broadcastGameState(io, room);
                console.log(`[Room] ${nameResult.name} joined ${code} as spectator`);
                return;
            }
            if (room.players.length >= room.settings.maxPlayers) {
                socket.emit('error-message', { message: `Room is full (max ${room.settings.maxPlayers}).` });
                return;
            }
            if (room.players.some(p => p.name === nameResult.name)) {
                socket.emit('error-message', { message: 'Name already taken in this room.' });
                return;
            }

            const sessionToken = generateSessionToken();
            const player = {
                id: socket.id, name: nameResult.name, avatar: sanitizeAvatar(avatar),
                sessionToken, isBot: false
            };
            room.players.push(player);
            socket.join(code);
            socket.roomCode = code;
            socket.playerName = nameResult.name;
            socket.sessionToken = sessionToken;
            touchRoom(room);

            socket.emit('room-joined', { roomCode: code, playerId: socket.id, sessionToken });
            broadcastPlayerList(io, room);
            broadcastSettings(io, room);

            io.to(code).emit('chat-message', {
                sender: '🎮 System', message: `${nameResult.name} joined the room!`,
                timestamp: Date.now(), isSystem: true
            });
        });

        // ─── JOIN AS SPECTATOR ───────────────────────
        socket.on('join-spectator', ({ roomCode, playerName }) => {
            const nameResult = sanitizeName(playerName);
            if (!nameResult.valid) return;
            const codeResult = validateRoomCode(roomCode);
            if (!codeResult.valid) return;

            const room = rooms.get(codeResult.code);
            if (!room) return;

            const sessionToken = generateSessionToken();
            room.spectators = room.spectators || [];
            room.spectators.push({
                id: socket.id, name: nameResult.name, sessionToken
            });
            socket.join(codeResult.code);
            socket.roomCode = codeResult.code;
            socket.playerName = nameResult.name;
            socket.isSpectator = true;

            socket.emit('room-joined', { roomCode: codeResult.code, playerId: socket.id, sessionToken });
            io.to(codeResult.code).emit('spectator-joined', { name: nameResult.name });
            if (room.game) broadcastGameState(io, room);
        });

        // ─── RECONNECT ──────────────────────────────
        socket.on('reconnect-session', ({ sessionToken, roomCode }) => {
            if (!sessionToken || typeof sessionToken !== 'string') return;
            const codeResult = validateRoomCode(roomCode);
            if (!codeResult.valid) {
                socket.emit('reconnect-failed', { reason: 'Invalid room code.' });
                return;
            }

            const room = rooms.get(codeResult.code);
            if (!room) {
                socket.emit('reconnect-failed', { reason: 'Room no longer exists.' });
                return;
            }

            const player = room.players.find(p => p.sessionToken === sessionToken);
            if (!player) {
                socket.emit('reconnect-failed', { reason: 'Session expired.' });
                return;
            }

            const oldSocketId = player.id;
            const newSocketId = socket.id;
            player.id = newSocketId;
            delete player._disconnectedAt;

            if (room.hostId === oldSocketId) room.hostId = newSocketId;

            if (room.game) {
                const gp = room.game.players.find(p => p.id === oldSocketId);
                if (gp) gp.id = newSocketId;
                if (room.game.hands[oldSocketId]) {
                    room.game.hands[newSocketId] = room.game.hands[oldSocketId];
                    delete room.game.hands[oldSocketId];
                }
                if (room.game.unoCalledBy[oldSocketId]) {
                    room.game.unoCalledBy[newSocketId] = true;
                    delete room.game.unoCalledBy[oldSocketId];
                }
                if (room.game.mustDrawTarget === oldSocketId) room.game.mustDrawTarget = newSocketId;
                if (room.game.pendingDrawnPlayerId === oldSocketId) room.game.pendingDrawnPlayerId = newSocketId;
                if (room.game.pendingWild4Challenge) {
                    const ch = room.game.pendingWild4Challenge;
                    if (ch.playerId === oldSocketId) ch.playerId = newSocketId;
                    if (ch.challengerId === oldSocketId) ch.challengerId = newSocketId;
                }
                if (room.game._pendingWild4Draw) {
                    const wd = room.game._pendingWild4Draw;
                    if (wd.targetId === oldSocketId) wd.targetId = newSocketId;
                    if (wd.playerId === oldSocketId) wd.playerId = newSocketId;
                }
                if (room.game.winner === oldSocketId) room.game.winner = newSocketId;
            }

            socket.join(codeResult.code);
            socket.roomCode = codeResult.code;
            socket.playerName = player.name;
            socket.sessionToken = sessionToken;
            touchRoom(room);

            socket.emit('reconnected', {
                roomCode: codeResult.code, playerId: newSocketId,
                playerName: player.name, sessionToken,
                isHost: room.hostId === newSocketId,
                gameInProgress: room.status === 'playing',
            });

            broadcastPlayerList(io, room);
            broadcastSettings(io, room);
            if (room.game) broadcastGameState(io, room);

            io.to(codeResult.code).emit('chat-message', {
                sender: '🎮 System', message: `${player.name} reconnected!`,
                timestamp: Date.now(), isSystem: true
            });
        });

        // ─── ADD BOT ─────────────────────────────────
        socket.on('add-bot', ({ difficulty }) => {
            const room = rooms.get(socket.roomCode);
            if (!room || socket.id !== room.hostId) return;
            if (room.status === 'playing') return;
            if (room.players.length >= room.settings.maxPlayers) {
                socket.emit('error-message', { message: 'Room is full.' });
                return;
            }

            const validDiffs = ['easy', 'medium', 'hard'];
            const diff = validDiffs.includes(difficulty) ? difficulty : 'medium';
            const bot = createBot(diff);
            room.players.push(bot);
            touchRoom(room);
            broadcastPlayerList(io, room);

            io.to(room.code).emit('chat-message', {
                sender: '🎮 System', message: `${bot.name} (${diff}) joined!`,
                timestamp: Date.now(), isSystem: true
            });
        });

        // ─── REMOVE BOT ──────────────────────────────
        socket.on('remove-bot', ({ botId }) => {
            const room = rooms.get(socket.roomCode);
            if (!room || socket.id !== room.hostId) return;
            if (room.status === 'playing') return;

            const bot = room.players.find(p => p.id === botId && p.isBot);
            if (!bot) return;

            room.players = room.players.filter(p => p.id !== botId);
            broadcastPlayerList(io, room);

            io.to(room.code).emit('chat-message', {
                sender: '🎮 System', message: `${bot.name} removed.`,
                timestamp: Date.now(), isSystem: true
            });
        });

        // ─── KICK PLAYER ─────────────────────────────
        socket.on('kick-player', ({ targetId }) => {
            const room = rooms.get(socket.roomCode);
            if (!room || socket.id !== room.hostId) return;
            if (targetId === socket.id) return;

            const target = room.players.find(p => p.id === targetId);
            if (!target) return;

            // Remove from game if playing
            if (room.game && room.game.status === 'playing') {
                removePlayer(room.game, targetId);
            }

            room.players = room.players.filter(p => p.id !== targetId);

            if (!target.isBot) {
                io.to(targetId).emit('kicked');
                // Force leave socket room
                const targetSocket = io.sockets.sockets.get(targetId);
                if (targetSocket) {
                    targetSocket.leave(room.code);
                    targetSocket.roomCode = null;
                }
            }

            broadcastPlayerList(io, room);
            if (room.game) {
                broadcastGameState(io, room);
                if (room.game.status === 'finished' && room.game.winner) {
                    handleGameOver(io, room);
                }
            }

            io.to(room.code).emit('chat-message', {
                sender: '🎮 System', message: `${target.name} was kicked.`,
                timestamp: Date.now(), isSystem: true
            });
        });

        // ─── LEAVE ROOM ──────────────────────────────
        socket.on('leave-room', () => {
            const room = rooms.get(socket.roomCode);
            if (!room) return;

            handlePlayerLeave(io, socket, room);
        });

        // ─── TOGGLE PAUSE ────────────────────────────
        socket.on('toggle-pause', () => {
            const room = rooms.get(socket.roomCode);
            if (!room || !room.game || socket.id !== room.hostId) return;
            if (room.game.status !== 'playing') return;

            room.game.paused = !room.game.paused;
            touchRoom(room);

            if (room.game.paused) {
                clearTurnTimer(room.code);
                io.to(room.code).emit('game-paused');
                io.to(room.code).emit('chat-message', {
                    sender: '🎮 System', message: '⏸️ Game paused by host',
                    timestamp: Date.now(), isSystem: true
                });
            } else {
                io.to(room.code).emit('game-resumed');
                broadcastGameState(io, room);
                startTurnTimer(io, room);
                triggerBotTurnIfNeeded(io, room);
                io.to(room.code).emit('chat-message', {
                    sender: '🎮 System', message: '▶️ Game resumed!',
                    timestamp: Date.now(), isSystem: true
                });
            }
        });

        // ─── UPDATE ROOM SETTINGS ────────────────────
        socket.on('update-room-settings', ({ settings }) => {
            const room = rooms.get(socket.roomCode);
            if (!room || socket.id !== room.hostId || room.status === 'playing') return;
            if (!settings || typeof settings !== 'object') return;

            const validKeys = Object.keys(DEFAULT_SETTINGS);
            for (const key of validKeys) {
                if (settings[key] !== undefined) room.settings[key] = settings[key];
            }

            room.settings.maxPlayers = Math.max(2, Math.min(10, room.settings.maxPlayers));
            room.settings.handSize = Math.max(3, Math.min(15, room.settings.handSize));
            room.settings.unoPenalty = Math.max(1, Math.min(6, room.settings.unoPenalty));
            room.settings.turnTimer = Math.max(0, Math.min(120, room.settings.turnTimer));
            room.settings.drawStacking = !!room.settings.drawStacking;
            room.settings.jumpIn = !!room.settings.jumpIn;
            room.settings.forcePlayAfterDraw = !!room.settings.forcePlayAfterDraw;

            touchRoom(room);
            broadcastSettings(io, room);
        });

        // ─── START GAME ──────────────────────────────
        socket.on('start-game', () => {
            const room = rooms.get(socket.roomCode);
            if (!room || socket.id !== room.hostId) return;
            if (room.players.length < 2) {
                socket.emit('error-message', { message: 'Need at least 2 players.' });
                return;
            }

            room.game = createGame(room.players, room.settings);
            room.game.paused = false;
            room.status = 'playing';
            touchRoom(room);

            io.to(room.code).emit('game-started');
            broadcastGameState(io, room);
            startTurnTimer(io, room);
            triggerBotTurnIfNeeded(io, room);

            io.to(room.code).emit('chat-message', {
                sender: '🎮 System', message: 'Game started! Good luck! 🃏',
                timestamp: Date.now(), isSystem: true
            });
        });

        // ─── PLAY CARD ───────────────────────────────
        socket.on('play-card', ({ cardId, chosenColor }) => {
            const room = rooms.get(socket.roomCode);
            if (!room || !room.game || room.game.paused) return;
            if (!isValidCardId(cardId)) return;
            if (chosenColor !== undefined && chosenColor !== null && !COLORS.includes(chosenColor)) return;

            const result = playCard(room.game, socket.id, cardId, chosenColor);
            if (!result.success) {
                socket.emit('error-message', { message: result.error });
                return;
            }
            touchRoom(room);

            if (result.needsColorChoice) {
                socket.emit('choose-color-prompt');
                broadcastGameState(io, room);
                return;
            }

            broadcastGameState(io, room);
            startTurnTimer(io, room);

            if (room.game.status === 'finished') {
                handleGameOver(io, room);
            } else {
                triggerBotTurnIfNeeded(io, room);
            }
        });

        // ─── CHOOSE COLOR ────────────────────────────
        socket.on('choose-color', ({ color }) => {
            const room = rooms.get(socket.roomCode);
            if (!room || !room.game || room.game.paused) return;
            if (!color || !COLORS.includes(color)) return;

            const result = chooseColor(room.game, socket.id, color);
            if (!result.success) return;
            touchRoom(room);
            broadcastGameState(io, room);
            startTurnTimer(io, room);

            if (room.game.status === 'finished') {
                handleGameOver(io, room);
            } else {
                triggerBotTurnIfNeeded(io, room);
            }
        });

        // ─── DRAW CARD ───────────────────────────────
        socket.on('draw-card', () => {
            const room = rooms.get(socket.roomCode);
            if (!room || !room.game || room.game.paused) return;

            const result = drawCard(room.game, socket.id);
            if (!result.success) return;
            touchRoom(room);

            socket.emit('cards-drawn', { cards: result.drawnCards });
            if (result.canPlayDrawn) socket.emit('drawn-card-playable', { card: result.drawnCard });
            broadcastGameState(io, room);
            if (!result.canPlayDrawn) {
                startTurnTimer(io, room);
                triggerBotTurnIfNeeded(io, room);
            }
        });

        // ─── RESOLVE DRAWN CARD ──────────────────────
        socket.on('resolve-drawn-card', ({ doPlay, chosenColor }) => {
            const room = rooms.get(socket.roomCode);
            if (!room || !room.game || room.game.paused) return;
            if (chosenColor !== undefined && chosenColor !== null && !COLORS.includes(chosenColor)) return;

            const result = resolveDrawnCard(room.game, socket.id, !!doPlay, chosenColor);
            if (!result.success) return;
            touchRoom(room);

            if (result.needsColorChoice) {
                socket.emit('choose-color-prompt');
                broadcastGameState(io, room);
                return;
            }

            broadcastGameState(io, room);
            startTurnTimer(io, room);

            if (room.game.status === 'finished') {
                handleGameOver(io, room);
            } else {
                triggerBotTurnIfNeeded(io, room);
            }
        });

        // ─── CALL UNO ────────────────────────────────
        socket.on('call-uno', () => {
            const room = rooms.get(socket.roomCode);
            if (!room || !room.game) return;
            const result = callUno(room.game, socket.id);
            if (result.success) {
                touchRoom(room);
                broadcastGameState(io, room);
                io.to(room.code).emit('uno-called', { playerId: socket.id, playerName: socket.playerName });
            }
        });

        // ─── CHALLENGE UNO ───────────────────────────
        socket.on('challenge-uno', ({ targetId }) => {
            const room = rooms.get(socket.roomCode);
            if (!room || !room.game) return;
            if (typeof targetId !== 'string') return;

            const result = challengeUno(room.game, socket.id, targetId);
            if (result.success) {
                touchRoom(room);
                broadcastGameState(io, room);
            }
        });

        // ─── CHALLENGE WILD DRAW FOUR ────────────────
        socket.on('challenge-wd4', ({ doChallenge }) => {
            const room = rooms.get(socket.roomCode);
            if (!room || !room.game) return;
            const result = resolveWild4Challenge(room.game, !!doChallenge);
            if (result.success) {
                touchRoom(room);
                broadcastGameState(io, room);
                startTurnTimer(io, room);
                triggerBotTurnIfNeeded(io, room);
            }
        });

        // ─── EMOJI REACTION ──────────────────────────
        socket.on('emoji-reaction', ({ emoji }) => {
            const room = rooms.get(socket.roomCode);
            if (!room) return;
            const allowed = ['😂', '😮', '😡', '🎉', '👏', '💀', '🔥', '❤️'];
            if (typeof emoji !== 'string' || !allowed.includes(emoji)) return;
            io.to(room.code).emit('emoji-reaction', {
                playerId: socket.id, playerName: socket.playerName, emoji
            });
        });

        // ─── CHAT MESSAGE ────────────────────────────
        socket.on('chat-message', ({ message }) => {
            const room = rooms.get(socket.roomCode);
            if (!room) return;
            if (typeof message !== 'string') return;
            const trimmed = message.trim();
            if (!trimmed || trimmed.length > 500) return;

            const chatMsg = {
                sender: socket.playerName, message: trimmed,
                timestamp: Date.now(), isSystem: false
            };
            room.chat.push(chatMsg);
            if (room.chat.length > 200) room.chat.shift();
            io.to(room.code).emit('chat-message', chatMsg);
        });

        // ─── RESTART GAME ────────────────────────────
        socket.on('restart-game', () => {
            const room = rooms.get(socket.roomCode);
            if (!room || socket.id !== room.hostId) return;
            if (room.players.length < 2) return;

            const scores = {};
            if (room.game) room.game.players.forEach(p => { scores[p.id] = p.score || 0; });
            room.players.forEach(p => { p.score = scores[p.id] || 0; });

            room.game = createGame(room.players, room.settings);
            room.game.paused = false;
            room.status = 'playing';
            touchRoom(room);

            io.to(room.code).emit('game-started');
            broadcastGameState(io, room);
            startTurnTimer(io, room);
            triggerBotTurnIfNeeded(io, room);

            io.to(room.code).emit('chat-message', {
                sender: '🎮 System', message: 'New game started! 🔄',
                timestamp: Date.now(), isSystem: true
            });
        });

        // ─── DISCONNECT ──────────────────────────────
        socket.on('disconnect', () => {
            const room = rooms.get(socket.roomCode);
            if (!room) return;

            // Remove spectator
            if (socket.isSpectator) {
                room.spectators = (room.spectators || []).filter(s => s.id !== socket.id);
                return;
            }

            const playerName = socket.playerName || 'Unknown';
            const disconnectedPlayer = room.players.find(p => p.id === socket.id);
            if (disconnectedPlayer) disconnectedPlayer._disconnectedAt = Date.now();

            setTimeout(() => {
                const currentRoom = rooms.get(socket.roomCode);
                if (!currentRoom) return;
                const player = currentRoom.players.find(p => p.sessionToken === socket.sessionToken);
                if (!player || player.id !== socket.id) return;
                if (!player._disconnectedAt) return;

                handlePlayerLeave(io, socket, currentRoom);
            }, 60000);
        });
    });
}

function handlePlayerLeave(io, socket, room) {
    const playerName = socket.playerName || 'Unknown';
    room.players = room.players.filter(p => p.id !== socket.id);

    if (room.game && room.game.status === 'playing') {
        removePlayer(room.game, socket.id);
        if (room.game.status === 'finished' && room.game.winner) {
            handleGameOver(io, room);
        }
        broadcastGameState(io, room);
    }

    if (room.players.length === 0) {
        clearTurnTimer(room.code);
        rooms.delete(room.code);
        return;
    }

    if (room.hostId === socket.id) {
        const humanPlayer = room.players.find(p => !p.isBot);
        room.hostId = humanPlayer ? humanPlayer.id : room.players[0].id;
    }

    socket.leave(room.code);
    socket.roomCode = null;

    broadcastPlayerList(io, room);
    broadcastSettings(io, room);
    io.to(room.code).emit('chat-message', {
        sender: '🎮 System', message: `${playerName} left the room.`,
        timestamp: Date.now(), isSystem: true
    });
}

module.exports = registerSocketHandler;
