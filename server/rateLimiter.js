/**
 * rateLimiter.js — Rate limiting middleware & input validation for UNO game
 * 
 * Features:
 *   - Per-socket event throttling with configurable limits per event type
 *   - Auto-disconnect after repeated violations
 *   - Player name sanitization & validation
 *   - Room code validation
 */

// ──────────────────────────────────────────────
//  RATE LIMITING
// ──────────────────────────────────────────────

// Events per second limits by category
const RATE_LIMITS = {
    // Game actions — moderate limit
    'play-card': { maxPerSecond: 10, category: 'game' },
    'draw-card': { maxPerSecond: 10, category: 'game' },
    'choose-color': { maxPerSecond: 10, category: 'game' },
    'call-uno': { maxPerSecond: 5, category: 'game' },
    'challenge-uno': { maxPerSecond: 5, category: 'game' },
    'challenge-wd4': { maxPerSecond: 5, category: 'game' },
    'resolve-drawn-card': { maxPerSecond: 10, category: 'game' },
    'start-game': { maxPerSecond: 2, category: 'game' },
    'restart-game': { maxPerSecond: 2, category: 'game' },
    'update-room-settings': { maxPerSecond: 5, category: 'game' },

    // Chat — stricter
    'chat-message': { maxPerSecond: 3, category: 'chat' },

    // Emoji — strictest
    'emoji-reaction': { maxPerSecond: 2, category: 'emoji' },

    // Room actions
    'create-room': { maxPerSecond: 2, category: 'room' },
    'join-room': { maxPerSecond: 2, category: 'room' },
    'join-spectator': { maxPerSecond: 2, category: 'room' },
    'reconnect-session': { maxPerSecond: 3, category: 'room' },
    'leave-room': { maxPerSecond: 2, category: 'room' },

    // Host actions
    'add-bot': { maxPerSecond: 3, category: 'game' },
    'remove-bot': { maxPerSecond: 3, category: 'game' },
    'kick-player': { maxPerSecond: 3, category: 'game' },
    'toggle-pause': { maxPerSecond: 2, category: 'game' },
};

const MAX_VIOLATIONS = 3;          // strikes before disconnect
const VIOLATION_WINDOW_MS = 30000; // reset violations after 30s of good behavior

/**
 * Creates a Socket.io middleware that rate-limits events per socket.
 * Apply with io.use() or as a socket-level middleware.
 */
function createRateLimiter() {
    // Per-socket tracking: Map<socketId, { counters, violations, lastViolation }>
    const trackers = new Map();

    // Cleanup old tracker entries every 60s
    setInterval(() => {
        const now = Date.now();
        for (const [id, tracker] of trackers) {
            if (now - tracker.lastActivity > 120000) {
                trackers.delete(id);
            }
        }
    }, 60000);

    return function rateLimitMiddleware(socket, next) {
        const tracker = {
            counters: {},       // { eventName: { count, windowStart } }
            violations: 0,
            lastViolation: 0,
            lastActivity: Date.now(),
        };
        trackers.set(socket.id, tracker);

        // Wrap socket.on to intercept events
        const originalOn = socket.on.bind(socket);
        socket.on = function (event, handler) {
            // Don't rate-limit internal Socket.io events
            if (event === 'disconnect' || event === 'error' || event === 'connect') {
                return originalOn(event, handler);
            }

            const limit = RATE_LIMITS[event];
            if (!limit) {
                // Unknown events — allow but with a default limit
                return originalOn(event, (...args) => {
                    tracker.lastActivity = Date.now();
                    handler(...args);
                });
            }

            return originalOn(event, (...args) => {
                const now = Date.now();
                tracker.lastActivity = now;

                // Reset violations after good behavior window
                if (tracker.violations > 0 && (now - tracker.lastViolation) > VIOLATION_WINDOW_MS) {
                    tracker.violations = 0;
                }

                // Check rate limit
                if (!tracker.counters[event]) {
                    tracker.counters[event] = { count: 0, windowStart: now };
                }

                const counter = tracker.counters[event];
                const elapsed = (now - counter.windowStart) / 1000;

                if (elapsed >= 1) {
                    // Reset window
                    counter.count = 1;
                    counter.windowStart = now;
                } else {
                    counter.count++;
                    if (counter.count > limit.maxPerSecond) {
                        // Rate limited!
                        tracker.violations++;
                        tracker.lastViolation = now;

                        socket.emit('error-message', {
                            message: `Slow down! You're sending too many actions. (Warning ${tracker.violations}/${MAX_VIOLATIONS})`
                        });

                        console.log(`[RateLimit] ${socket.id} exceeded ${event} limit (${tracker.violations}/${MAX_VIOLATIONS})`);

                        if (tracker.violations >= MAX_VIOLATIONS) {
                            socket.emit('error-message', {
                                message: 'Disconnected: Too many actions too quickly.'
                            });
                            console.log(`[RateLimit] ${socket.id} disconnected for repeated violations`);
                            socket.disconnect(true);
                        }
                        return; // Drop the event
                    }
                }

                handler(...args);
            });
        };

        // Cleanup on disconnect
        socket.on('disconnect', () => {
            trackers.delete(socket.id);
        });

        next();
    };
}

// ──────────────────────────────────────────────
//  INPUT VALIDATION
// ──────────────────────────────────────────────

/**
 * Validates and sanitizes a player name.
 * @returns {{ valid: boolean, name?: string, error?: string }}
 */
function sanitizeName(name) {
    if (typeof name !== 'string') {
        return { valid: false, error: 'Name must be a string' };
    }

    const trimmed = name.trim();

    if (trimmed.length < 2) {
        return { valid: false, error: 'Name must be at least 2 characters' };
    }

    if (trimmed.length > 15) {
        return { valid: false, error: 'Name must be 15 characters or less' };
    }

    // Allow letters, numbers, spaces, underscores, hyphens
    if (!/^[a-zA-Z0-9 _\-]+$/.test(trimmed)) {
        return { valid: false, error: 'Name can only contain letters, numbers, spaces, underscores, and hyphens' };
    }

    return { valid: true, name: trimmed };
}

/**
 * Validates a room code format.
 * @returns {{ valid: boolean, code?: string, error?: string }}
 */
function validateRoomCode(code) {
    if (typeof code !== 'string') {
        return { valid: false, error: 'Room code must be a string' };
    }

    const trimmed = code.toUpperCase().trim();

    if (trimmed.length !== 6) {
        return { valid: false, error: 'Room code must be exactly 6 characters' };
    }

    if (!/^[A-Z0-9]+$/.test(trimmed)) {
        return { valid: false, error: 'Room code can only contain letters and numbers' };
    }

    return { valid: true, code: trimmed };
}

/**
 * Validates that a value is a finite number.
 */
function isValidNumber(val) {
    return typeof val === 'number' && Number.isFinite(val);
}

/**
 * Validates a card ID.
 */
function isValidCardId(cardId) {
    return isValidNumber(cardId) && Number.isInteger(cardId) && cardId >= 0;
}

// ──────────────────────────────────────────────
//  SESSION TOKENS
// ──────────────────────────────────────────────

/**
 * Generates a random session token for reconnection.
 */
function generateSessionToken() {
    try {
        return require('crypto').randomBytes(24).toString('hex');
    } catch (_) {
        // Fallback if crypto unavailable
        const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
        let token = '';
        for (let i = 0; i < 48; i++) {
            token += chars[Math.floor(Math.random() * chars.length)];
        }
        return token;
    }
}

module.exports = {
    createRateLimiter,
    sanitizeName,
    validateRoomCode,
    isValidCardId,
    isValidNumber,
    generateSessionToken,
};
