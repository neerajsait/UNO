/**
 * socketHandler.js — Socket.io event handler for UNO multiplayer
 * Manages rooms, player connections, game events, and chat.
 */

const {
    createGame,
    playCard,
    drawCard,
    chooseColor,
    callUno,
    challengeUno,
    resolveWild4Challenge,
    removePlayer,
    getPlayerView,
    COLORS
} = require('./gameLogic');

// In-memory store for all game rooms
const rooms = new Map();

/**
 * Generate a random 6-character room code.
 */
function generateRoomCode() {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // avoid confusing chars
    let code = '';
    for (let i = 0; i < 6; i++) {
        code += chars[Math.floor(Math.random() * chars.length)];
    }
    return rooms.has(code) ? generateRoomCode() : code; // ensure unique
}

/**
 * Broadcast the updated game state to all players in the room.
 * Each player receives their own personalized view (hiding other hands).
 */
function broadcastGameState(io, room) {
    if (!room.game) return;

    for (const player of room.players) {
        const view = getPlayerView(room.game, player.id);
        io.to(player.id).emit('game-state', view);
    }
}

/**
 * Broadcast the player list (lobby) to everyone in the room.
 */
function broadcastPlayerList(io, room) {
    const playerList = room.players.map(p => ({
        id: p.id,
        name: p.name,
        isHost: p.id === room.hostId
    }));
    io.to(room.code).emit('player-list', {
        players: playerList,
        roomCode: room.code,
        hostId: room.hostId
    });
}

/**
 * Register all socket events.
 */
function registerSocketHandler(io) {
    io.on('connection', (socket) => {
        console.log(`[Socket] Connected: ${socket.id}`);

        // ─── CREATE ROOM ─────────────────────────────
        socket.on('create-room', ({ playerName }) => {
            const code = generateRoomCode();
            const player = { id: socket.id, name: playerName };

            const room = {
                code,
                hostId: socket.id,
                players: [player],
                game: null,
                chat: [],
                status: 'lobby' // 'lobby' | 'playing'
            };

            rooms.set(code, room);
            socket.join(code);
            socket.roomCode = code;
            socket.playerName = playerName;

            socket.emit('room-created', { roomCode: code, playerId: socket.id });
            broadcastPlayerList(io, room);
            console.log(`[Room] ${playerName} created room ${code}`);
        });

        // ─── JOIN ROOM ───────────────────────────────
        socket.on('join-room', ({ roomCode, playerName }) => {
            const code = roomCode.toUpperCase().trim();
            const room = rooms.get(code);

            if (!room) {
                socket.emit('error-message', { message: 'Room not found. Check the code and try again.' });
                return;
            }
            if (room.status === 'playing') {
                socket.emit('error-message', { message: 'Game already in progress. Cannot join.' });
                return;
            }
            if (room.players.length >= 10) {
                socket.emit('error-message', { message: 'Room is full (max 10 players).' });
                return;
            }
            if (room.players.some(p => p.name === playerName)) {
                socket.emit('error-message', { message: 'A player with that name already exists in this room.' });
                return;
            }

            const player = { id: socket.id, name: playerName };
            room.players.push(player);
            socket.join(code);
            socket.roomCode = code;
            socket.playerName = playerName;

            socket.emit('room-joined', { roomCode: code, playerId: socket.id });
            broadcastPlayerList(io, room);

            // Notify others
            io.to(code).emit('chat-message', {
                sender: '🎮 System',
                message: `${playerName} joined the room!`,
                timestamp: Date.now(),
                isSystem: true
            });

            console.log(`[Room] ${playerName} joined room ${code} (${room.players.length} players)`);
        });

        // ─── START GAME ──────────────────────────────
        socket.on('start-game', () => {
            const room = rooms.get(socket.roomCode);
            if (!room) return;
            if (socket.id !== room.hostId) {
                socket.emit('error-message', { message: 'Only the host can start the game.' });
                return;
            }
            if (room.players.length < 2) {
                socket.emit('error-message', { message: 'Need at least 2 players to start.' });
                return;
            }

            room.game = createGame(room.players);
            room.status = 'playing';

            io.to(room.code).emit('game-started');
            broadcastGameState(io, room);

            io.to(room.code).emit('chat-message', {
                sender: '🎮 System',
                message: 'Game started! Good luck! 🃏',
                timestamp: Date.now(),
                isSystem: true
            });

            console.log(`[Game] Room ${room.code} started with ${room.players.length} players`);
        });

        // ─── PLAY CARD ───────────────────────────────
        socket.on('play-card', ({ cardId, chosenColor }) => {
            const room = rooms.get(socket.roomCode);
            if (!room || !room.game) return;

            const result = playCard(room.game, socket.id, cardId, chosenColor);

            if (!result.success) {
                socket.emit('error-message', { message: result.error });
                return;
            }

            if (result.needsColorChoice) {
                socket.emit('choose-color-prompt');
                broadcastGameState(io, room);
                return;
            }

            broadcastGameState(io, room);

            // If game finished, notify
            if (room.game.status === 'finished') {
                const winnerName = room.players.find(p => p.id === room.game.winner)?.name || 'Unknown';
                io.to(room.code).emit('game-over', { winnerId: room.game.winner, winnerName });
                io.to(room.code).emit('chat-message', {
                    sender: '🎮 System',
                    message: `🏆 ${winnerName} wins the game!`,
                    timestamp: Date.now(),
                    isSystem: true
                });
            }
        });

        // ─── CHOOSE COLOR ────────────────────────────
        socket.on('choose-color', ({ color }) => {
            const room = rooms.get(socket.roomCode);
            if (!room || !room.game) return;

            const result = chooseColor(room.game, socket.id, color);
            if (!result.success) {
                socket.emit('error-message', { message: result.error });
                return;
            }

            broadcastGameState(io, room);

            if (room.game.status === 'finished') {
                const winnerName = room.players.find(p => p.id === room.game.winner)?.name || 'Unknown';
                io.to(room.code).emit('game-over', { winnerId: room.game.winner, winnerName });
            }
        });

        // ─── DRAW CARD ───────────────────────────────
        socket.on('draw-card', () => {
            const room = rooms.get(socket.roomCode);
            if (!room || !room.game) return;

            const result = drawCard(room.game, socket.id);
            if (!result.success) {
                socket.emit('error-message', { message: result.error });
                return;
            }

            // Send drawn cards privately to the player
            socket.emit('cards-drawn', { cards: result.drawnCards });
            broadcastGameState(io, room);
        });

        // ─── CALL UNO ────────────────────────────────
        socket.on('call-uno', () => {
            const room = rooms.get(socket.roomCode);
            if (!room || !room.game) return;

            const result = callUno(room.game, socket.id);
            if (result.success) {
                broadcastGameState(io, room);
                io.to(room.code).emit('uno-called', { playerId: socket.id, playerName: socket.playerName });
            }
        });

        // ─── CHALLENGE UNO ───────────────────────────
        socket.on('challenge-uno', ({ targetId }) => {
            const room = rooms.get(socket.roomCode);
            if (!room || !room.game) return;

            const result = challengeUno(room.game, socket.id, targetId);
            if (result.success) {
                broadcastGameState(io, room);
            } else {
                socket.emit('error-message', { message: result.error });
            }
        });

        // ─── CHALLENGE WILD DRAW FOUR ────────────────
        socket.on('challenge-wd4', ({ doChallenge }) => {
            const room = rooms.get(socket.roomCode);
            if (!room || !room.game) return;

            const result = resolveWild4Challenge(room.game, doChallenge);
            if (result.success) {
                broadcastGameState(io, room);
            } else {
                socket.emit('error-message', { message: result.error });
            }
        });

        // ─── CHAT MESSAGE ────────────────────────────
        socket.on('chat-message', ({ message }) => {
            const room = rooms.get(socket.roomCode);
            if (!room) return;

            const trimmed = message.trim();
            if (!trimmed || trimmed.length > 500) return;

            const chatMsg = {
                sender: socket.playerName,
                message: trimmed,
                timestamp: Date.now(),
                isSystem: false
            };

            room.chat.push(chatMsg);
            // Keep chat history reasonable
            if (room.chat.length > 200) room.chat.shift();

            io.to(room.code).emit('chat-message', chatMsg);
        });

        // ─── RESTART GAME ────────────────────────────
        socket.on('restart-game', () => {
            const room = rooms.get(socket.roomCode);
            if (!room) return;
            if (socket.id !== room.hostId) {
                socket.emit('error-message', { message: 'Only the host can restart the game.' });
                return;
            }
            if (room.players.length < 2) {
                socket.emit('error-message', { message: 'Need at least 2 players.' });
                return;
            }

            room.game = createGame(room.players);
            room.status = 'playing';

            io.to(room.code).emit('game-started');
            broadcastGameState(io, room);

            io.to(room.code).emit('chat-message', {
                sender: '🎮 System',
                message: 'New game started! 🔄',
                timestamp: Date.now(),
                isSystem: true
            });
        });

        // ─── DISCONNECT ──────────────────────────────
        socket.on('disconnect', () => {
            const room = rooms.get(socket.roomCode);
            if (!room) return;

            const playerName = socket.playerName || 'Unknown';
            console.log(`[Socket] ${playerName} disconnected from room ${room.code}`);

            // Remove player from room
            room.players = room.players.filter(p => p.id !== socket.id);

            // If game in progress, remove from game
            if (room.game && room.game.status === 'playing') {
                removePlayer(room.game, socket.id);
                if (room.game.status === 'finished' && room.game.winner) {
                    const winnerName = room.players.find(p => p.id === room.game.winner)?.name || 'Unknown';
                    io.to(room.code).emit('game-over', { winnerId: room.game.winner, winnerName });
                }
                broadcastGameState(io, room);
            }

            // If room empty, delete it
            if (room.players.length === 0) {
                rooms.delete(room.code);
                console.log(`[Room] Room ${room.code} deleted (empty)`);
                return;
            }

            // Reassign host if host left
            if (room.hostId === socket.id) {
                room.hostId = room.players[0].id;
            }

            broadcastPlayerList(io, room);
            io.to(room.code).emit('chat-message', {
                sender: '🎮 System',
                message: `${playerName} left the room.`,
                timestamp: Date.now(),
                isSystem: true
            });
        });
    });
}

module.exports = registerSocketHandler;
