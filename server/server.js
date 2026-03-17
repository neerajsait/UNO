/**
 * server.js — Express + Socket.io server for UNO multiplayer game
 */

// Load environment variables (optional — works without .env file)
try { require('dotenv').config(); } catch (_) { /* dotenv not installed, using defaults */ }

const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const registerSocketHandler = require('./socketHandler');
const { createRateLimiter } = require('./rateLimiter');

const app = express();
const server = http.createServer(app);

// CORS — locked to allowed origins (comma-separated env var)
const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS || `http://localhost:${process.env.PORT || 3000}`)
    .split(',').map(s => s.trim()).filter(Boolean);

const io = new Server(server, {
    cors: {
        origin: ALLOWED_ORIGINS,
        methods: ['GET', 'POST']
    }
});

// Apply rate limiting middleware to all socket connections
io.use(createRateLimiter());

// Security headers (no external dependency needed)
app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('X-XSS-Protection', '1; mode=block');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
    next();
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
    console.log(`  ➜  CORS:    ${ALLOWED_ORIGINS.join(', ')}`);
    console.log(`  ➜  Ready for players!\n`);
});
