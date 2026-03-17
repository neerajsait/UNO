/**
 * botPlayer.js — AI Bot Players for UNO
 * Three difficulty levels: easy, medium, hard
 * Runs server-side — called by socketHandler on bot's turn.
 */

const { COLORS } = require('./gameLogic');

const BOT_NAMES = [
    'Bot Alice 🤖', 'Bot Bob 🤖', 'Bot Charlie 🤖', 'Bot Diana 🤖',
    'Bot Echo 🤖', 'Bot Felix 🤖', 'Bot Grace 🤖', 'Bot Hugo 🤖',
];

const BOT_AVATARS = ['🤖', '👾', '🎮', '🕹️', '💻', '🧠', '⚡', '🔮'];

let botCounter = 0;

/**
 * Create a bot player object.
 */
function createBot(difficulty = 'medium') {
    const idx = botCounter % BOT_NAMES.length;
    botCounter++;
    return {
        id: `bot_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        name: BOT_NAMES[idx],
        avatar: BOT_AVATARS[idx % BOT_AVATARS.length],
        isBot: true,
        difficulty,
        sessionToken: `bot_token_${Date.now()}`,
    };
}

/**
 * Decide what move a bot should make.
 * Returns: { action: 'play', cardId, chosenColor? }
 *       or { action: 'draw' }
 *       or { action: 'callUno' }
 */
function decideBotMove(game, botId, difficulty = 'medium') {
    const hand = game.hands[botId];
    if (!hand || hand.length === 0) return { action: 'draw' };

    const topCard = game.discardPile[game.discardPile.length - 1];
    const currentColor = game.currentColor;
    const currentValue = game.currentValue;

    // Find all playable cards
    const playable = hand.filter(card => isPlayable(card, currentColor, currentValue, game));

    if (playable.length === 0) {
        return { action: 'draw' };
    }

    let chosen;

    switch (difficulty) {
        case 'easy':
            chosen = playEasy(playable, hand);
            break;
        case 'hard':
            chosen = playHard(playable, hand, game, botId);
            break;
        case 'medium':
        default:
            chosen = playMedium(playable, hand, game);
            break;
    }

    const result = { action: 'play', cardId: chosen.id };

    // Choose color for wilds
    if (chosen.type === 'wild') {
        result.chosenColor = chooseColorForBot(hand, difficulty);
    }

    return result;
}

/**
 * Easy: Play random valid card
 */
function playEasy(playable) {
    return playable[Math.floor(Math.random() * playable.length)];
}

/**
 * Medium: Prioritize action cards, save wilds for later
 */
function playMedium(playable, hand, game) {
    // Prefer non-wild cards
    const nonWild = playable.filter(c => c.type !== 'wild');
    if (nonWild.length > 0) {
        // Prefer action cards (skip, reverse, draw2)
        const actions = nonWild.filter(c => ['skip', 'reverse', 'draw2'].includes(c.value));
        if (actions.length > 0 && Math.random() > 0.3) {
            return actions[Math.floor(Math.random() * actions.length)];
        }
        return nonWild[Math.floor(Math.random() * nonWild.length)];
    }
    return playable[Math.floor(Math.random() * playable.length)];
}

/**
 * Hard: Strategic play — considers opponent hand sizes, saves wilds,
 * prioritizes color consolidation
 */
function playHard(playable, hand, game, botId) {
    // Count colors in hand
    const colorCounts = {};
    hand.forEach(c => {
        if (c.color && c.type !== 'wild') {
            colorCounts[c.color] = (colorCounts[c.color] || 0) + 1;
        }
    });

    // Find dominant color
    const dominantColor = Object.entries(colorCounts)
        .sort((a, b) => b[1] - a[1])[0]?.[0];

    // Check if any opponent is close to winning
    const opponentNearWin = game.players.some(p => p.id !== botId && p.cardCount <= 2);

    // If opponent near win, play action cards aggressively
    if (opponentNearWin) {
        const actionCards = playable.filter(c => ['skip', 'reverse', 'draw2', 'wild4'].includes(c.value));
        if (actionCards.length > 0) {
            return actionCards[0];
        }
    }

    // Prefer cards of dominant color
    const dominantCards = playable.filter(c => c.color === dominantColor && c.type !== 'wild');
    if (dominantCards.length > 0) {
        // Among dominant color, prefer higher value cards
        dominantCards.sort((a, b) => {
            const va = typeof a.value === 'number' ? a.value : 10;
            const vb = typeof b.value === 'number' ? b.value : 10;
            return vb - va;
        });
        return dominantCards[0];
    }

    // Try non-wild cards
    const nonWild = playable.filter(c => c.type !== 'wild');
    if (nonWild.length > 0) {
        return nonWild[0];
    }

    // Play wild only if no other choice (save it)
    // Prefer regular wild over wild4
    const regularWild = playable.find(c => c.value === 'wild');
    return regularWild || playable[0];
}

/**
 * Choose the best color for a wild card
 */
function chooseColorForBot(hand, difficulty) {
    if (difficulty === 'easy') {
        return COLORS[Math.floor(Math.random() * COLORS.length)];
    }

    // Count colors in remaining hand
    const counts = {};
    COLORS.forEach(c => counts[c] = 0);
    hand.forEach(card => {
        if (card.color && card.type !== 'wild') {
            counts[card.color]++;
        }
    });

    // Pick most frequent color
    const best = Object.entries(counts).sort((a, b) => b[1] - a[1])[0];
    return best ? best[0] : COLORS[Math.floor(Math.random() * COLORS.length)];
}

/**
 * Check if a card is playable (client-side validation mirror)
 */
function isPlayable(card, currentColor, currentValue, game) {
    // Draw stack active
    if (game.drawStack > 0) {
        if (card.value === 'draw2' && currentValue === 'draw2') return true;
        if (card.value === 'wild4') return true;
        return false;
    }
    if (card.type === 'wild') return true;
    return card.color === currentColor || card.value === currentValue;
}

/**
 * Decide whether bot should call UNO after playing
 */
function shouldCallUno(game, botId, difficulty) {
    const hand = game.hands[botId];
    if (!hand || hand.length !== 1) return false;

    // Easy bots forget sometimes
    if (difficulty === 'easy') return Math.random() > 0.3;

    // Medium/Hard always call
    return true;
}

/**
 * Decide if bot should play a drawn card (when forcePlayAfterDraw is on)
 */
function shouldPlayDrawnCard(card, game, difficulty) {
    if (difficulty === 'easy') return Math.random() > 0.4;
    // Medium/Hard always play if possible
    return true;
}

module.exports = {
    createBot,
    decideBotMove,
    shouldCallUno,
    shouldPlayDrawnCard,
    BOT_NAMES,
    BOT_AVATARS,
};
