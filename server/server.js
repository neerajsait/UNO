/**
 * server.js — Express + Socket.io server for UNO multiplayer game
 */

const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const registerSocketHandler = require('./socketHandler');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
    cors: {
        origin: '*',
        methods: ['GET', 'POST']
    }
});

// Serve static files from the public directory
app.use(express.static(path.join(__dirname, '..', 'public')));

// Fallback route — serve index.html
app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, '..', 'public', 'index.html'));
});

// Register all Socket.io event handlers
registerSocketHandler(io);

// Start the server
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`\n  🎴 UNO Game Server running at:`);
    console.log(`  ➜  Local:   http://localhost:${PORT}`);
    console.log(`  ➜  Ready for players!\n`);
});
