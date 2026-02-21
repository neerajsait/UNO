/**
 * gameLogic.js — Server-authoritative UNO game engine
 * Implements all official UNO rules including:
 *   - 108-card deck (number, skip, reverse, draw two, wild, wild draw four)
 *   - Turn order with direction reversal
 *   - Action card effects
 *   - Wild Draw Four challenge system
 *   - UNO call & penalty system
 *   - Win detection & deck reshuffle
 */

// ──────────────────────────────────────────────
//  CONSTANTS
// ──────────────────────────────────────────────
const COLORS = ['red', 'blue', 'green', 'yellow'];
const NUMBER_VALUES = ['0', '1', '2', '3', '4', '5', '6', '7', '8', '9'];
const ACTION_VALUES = ['skip', 'reverse', 'draw2'];
const WILD_TYPES = ['wild', 'wild4'];

const HAND_SIZE = 7;
const UNO_PENALTY = 2;
const DRAW2_COUNT = 2;
const DRAW4_COUNT = 4;
const CHALLENGE_FAIL_PENALTY = 6;

// ──────────────────────────────────────────────
//  DECK CREATION & SHUFFLING
// ──────────────────────────────────────────────

/**
 * Build the standard 108-card UNO deck:
 *   - For each color: one 0, two of 1-9, two Skip, two Reverse, two Draw Two
 *   - Four Wild cards, four Wild Draw Four cards
 */
function createDeck() {
    const deck = [];
    let id = 0;

    for (const color of COLORS) {
        // One 0 per color
        deck.push({ id: id++, color, value: '0', type: 'number' });

        // Two of each 1-9
        for (let i = 1; i <= 9; i++) {
            deck.push({ id: id++, color, value: String(i), type: 'number' });
            deck.push({ id: id++, color, value: String(i), type: 'number' });
        }

        // Two of each action card per color
        for (const action of ACTION_VALUES) {
            deck.push({ id: id++, color, value: action, type: 'action' });
            deck.push({ id: id++, color, value: action, type: 'action' });
        }
    }

    // Wild cards (4 each)
    for (let i = 0; i < 4; i++) {
        deck.push({ id: id++, color: null, value: 'wild', type: 'wild' });
        deck.push({ id: id++, color: null, value: 'wild4', type: 'wild' });
    }

    return deck;
}

/** Fisher-Yates shuffle — mutates array in place */
function shuffle(arr) {
    for (let i = arr.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
}

// ──────────────────────────────────────────────
//  GAME STATE MANAGEMENT
// ──────────────────────────────────────────────

/**
 * Create a new game for the given list of players.
 * @param {Array<{id: string, name: string}>} players
 * @returns {Object} game state
 */
function createGame(players) {
    const deck = shuffle(createDeck());

    // Deal 7 cards to each player
    const hands = {};
    for (const player of players) {
        hands[player.id] = deck.splice(0, HAND_SIZE);
    }

    // Flip the first valid starting card (cannot start on Wild Draw Four)
    let discardPile = [];
    let startCard = deck.pop();
    while (startCard.value === 'wild4') {
        deck.unshift(startCard);
        shuffle(deck);
        startCard = deck.pop();
    }
    discardPile.push(startCard);

    const game = {
        players: players.map(p => ({ ...p, cardCount: HAND_SIZE })),
        hands,                          // { playerId: [card, ...] }
        drawPile: deck,
        discardPile,
        currentPlayerIndex: 0,
        direction: 1,                   // 1 = clockwise, -1 = counter-clockwise
        currentColor: startCard.color || COLORS[0], // for wilds
        currentValue: startCard.value,
        topCard: startCard,
        status: 'playing',              // 'playing' | 'choosing_color' | 'finished'
        winner: null,
        lastAction: null,
        unoCalledBy: {},                // { playerId: true } — tracks who has called UNO
        mustDraw: 0,                    // stacked draw count (0 if none pending)
        mustDrawTarget: null,           // playerId forced to draw
        pendingWild4Challenge: null,    // { challengerId, playerId } when challenge is available
        turnTimer: null,
        log: []
    };

    // Apply the effect of the starting card (if it's an action card)
    applyStartingCard(game);

    return game;
}

/**
 * If the starting discard is an action card, apply its effect.
 */
function applyStartingCard(game) {
    const card = game.topCard;

    switch (card.value) {
        case 'skip':
            game.lastAction = `First card is Skip — ${getCurrentPlayer(game).name} is skipped`;
            advanceTurn(game);
            break;
        case 'reverse':
            game.direction *= -1;
            game.lastAction = 'First card is Reverse — direction reversed';
            if (game.players.length === 2) {
                advanceTurn(game); // In 2-player, reverse acts as skip
            }
            break;
        case 'draw2':
            game.mustDraw = DRAW2_COUNT;
            game.mustDrawTarget = getCurrentPlayer(game).id;
            game.lastAction = `First card is Draw Two — ${getCurrentPlayer(game).name} must draw 2`;
            break;
        case 'wild':
            // First player chooses color (handled by client emitting choose-color)
            game.status = 'choosing_color';
            game.lastAction = 'First card is Wild — first player chooses a color';
            break;
        // wild4 is never the starting card (filtered above)
    }
}

// ──────────────────────────────────────────────
//  TURN HELPERS
// ──────────────────────────────────────────────

function getCurrentPlayer(game) {
    return game.players[game.currentPlayerIndex];
}

function getNextPlayerIndex(game) {
    return (game.currentPlayerIndex + game.direction + game.players.length) % game.players.length;
}

function advanceTurn(game) {
    game.currentPlayerIndex = getNextPlayerIndex(game);
}

/** Reshuffle discard pile back into draw pile, keeping the top card */
function reshuffleDeck(game) {
    if (game.drawPile.length > 0) return;

    const topCard = game.discardPile.pop();
    game.drawPile = shuffle(game.discardPile);

    // Reset card colors for any wilds in the reshuffled pile
    game.drawPile.forEach(c => {
        if (c.type === 'wild') c.color = null;
    });

    game.discardPile = [topCard];
    game.log.push('Draw pile reshuffled from discard pile');
}

/** Draw N cards from the pile for a player */
function drawCards(game, playerId, count) {
    const drawn = [];
    for (let i = 0; i < count; i++) {
        if (game.drawPile.length === 0) reshuffleDeck(game);
        if (game.drawPile.length === 0) break; // truly out of cards
        drawn.push(game.drawPile.pop());
    }
    game.hands[playerId].push(...drawn);
    updatePlayerCardCount(game, playerId);
    return drawn;
}

function updatePlayerCardCount(game, playerId) {
    const p = game.players.find(pl => pl.id === playerId);
    if (p) p.cardCount = game.hands[playerId].length;
}

// ──────────────────────────────────────────────
//  CARD VALIDATION
// ──────────────────────────────────────────────

/**
 * Check if a card can be played on the current discard.
 * Wild cards can always be played.
 * Wild Draw Four can only be played if player has no cards matching current color.
 */
function isValidPlay(game, playerId, card) {
    // Wild is always playable
    if (card.value === 'wild') return true;

    // Wild Draw Four — always playable (challenge system checks legality)
    if (card.value === 'wild4') return true;

    // Match by color or value
    return card.color === game.currentColor || card.value === game.currentValue;
}

/**
 * Check if Wild Draw Four was played legally (player truly had no matching color).
 * Used for the challenge system.
 */
function wasWild4Legal(game, playerId, cardPlayed) {
    // Check the hand BEFORE the card was played (we reconstruct by adding it back temporarily)
    const hand = game.hands[playerId];
    // At the time of play, the player's hand + the played card is the original hand
    // We need the color that was current BEFORE the wild4 was played
    // This is stored in game._preWild4Color
    const previousColor = game._preWild4Color;
    const hadMatchingColor = hand.some(c => c.color === previousColor);
    return !hadMatchingColor;
}

// ──────────────────────────────────────────────
//  CORE GAME ACTIONS
// ──────────────────────────────────────────────

/**
 * Play a card from the current player's hand.
 * Returns { success, game, error, needsColorChoice, canChallenge }
 */
function playCard(game, playerId, cardId, chosenColor) {
    // Basic validation
    if (game.status === 'finished') {
        return { success: false, error: 'Game is already finished' };
    }
    if (game.status === 'choosing_color') {
        return { success: false, error: 'Waiting for color choice' };
    }

    const currentPlayer = getCurrentPlayer(game);
    if (currentPlayer.id !== playerId) {
        return { success: false, error: 'Not your turn' };
    }

    // If player must draw, they can't play (unless it's being handled)
    if (game.mustDraw > 0 && game.mustDrawTarget === playerId) {
        return { success: false, error: `You must draw ${game.mustDraw} cards first` };
    }

    // Find card in hand
    const hand = game.hands[playerId];
    const cardIndex = hand.findIndex(c => c.id === cardId);
    if (cardIndex === -1) {
        return { success: false, error: 'Card not in your hand' };
    }

    const card = hand[cardIndex];

    // Validate play
    if (!isValidPlay(game, playerId, card)) {
        return { success: false, error: 'Invalid play — card does not match color or value' };
    }

    // Remove card from hand
    hand.splice(cardIndex, 1);
    updatePlayerCardCount(game, playerId);

    // Place on discard pile
    game.discardPile.push(card);
    game.topCard = card;

    // Clear UNO call status for this player (fresh for next round)
    delete game.unoCalledBy[playerId];
    game.pendingWild4Challenge = null;

    // Handle wild cards — need color choice
    if (card.type === 'wild') {
        game._preWild4Color = game.currentColor; // save for challenge

        if (chosenColor && COLORS.includes(chosenColor)) {
            card.color = chosenColor;
            game.currentColor = chosenColor;
            game.currentValue = card.value;
            return applyCardEffect(game, playerId, card);
        } else {
            // Need client to choose color
            game.status = 'choosing_color';
            game.currentValue = card.value;
            game.lastAction = `${currentPlayer.name} played ${card.value === 'wild4' ? 'Wild Draw Four' : 'Wild'} — choosing color...`;
            return { success: true, game, needsColorChoice: true };
        }
    }

    // Normal / action card
    game.currentColor = card.color;
    game.currentValue = card.value;

    return applyCardEffect(game, playerId, card);
}

/**
 * Apply the effect of a played card and advance the turn.
 */
function applyCardEffect(game, playerId, card) {
    const playerName = game.players.find(p => p.id === playerId).name;
    let canChallenge = false;

    switch (card.value) {
        case 'skip': {
            const skipped = game.players[getNextPlayerIndex(game)];
            game.lastAction = `${playerName} played Skip — ${skipped.name} is skipped`;
            advanceTurn(game); // skip next
            advanceTurn(game); // move to player after
            break;
        }
        case 'reverse': {
            game.direction *= -1;
            game.lastAction = `${playerName} played Reverse`;
            if (game.players.length === 2) {
                advanceTurn(game); // acts as skip in 2-player
            } else {
                advanceTurn(game);
            }
            break;
        }
        case 'draw2': {
            advanceTurn(game);
            const target = getCurrentPlayer(game);
            const drawn = drawCards(game, target.id, DRAW2_COUNT);
            game.lastAction = `${playerName} played Draw Two — ${target.name} draws 2 and is skipped`;
            advanceTurn(game); // skip the target
            break;
        }
        case 'wild': {
            game.lastAction = `${playerName} played Wild — color is now ${game.currentColor}`;
            advanceTurn(game);
            break;
        }
        case 'wild4': {
            advanceTurn(game);
            const target4 = getCurrentPlayer(game);

            // The target can challenge
            game.pendingWild4Challenge = {
                playerId: playerId,          // who played the WD4
                challengerId: target4.id,    // who can challenge
                targetName: target4.name,
                playerName: playerName
            };
            canChallenge = true;

            game.lastAction = `${playerName} played Wild Draw Four — color is now ${game.currentColor}. ${target4.name} can challenge!`;
            // Don't draw yet — wait for challenge decision
            // Store that we need to resolve this
            game._pendingWild4Draw = {
                targetId: target4.id,
                playerId: playerId
            };
            break;
        }
        default: {
            // Number card
            game.lastAction = `${playerName} played ${card.color} ${card.value}`;
            advanceTurn(game);
        }
    }

    // Check win condition
    if (game.hands[playerId].length === 0) {
        game.status = 'finished';
        game.winner = playerId;
        game.lastAction = `🎉 ${playerName} wins!`;
        return { success: true, game };
    }

    return { success: true, game, canChallenge };
}

/**
 * Handle color choice after playing a Wild / Wild Draw Four.
 */
function chooseColor(game, playerId, color) {
    if (game.status !== 'choosing_color') {
        return { success: false, error: 'Not waiting for color choice' };
    }
    if (!COLORS.includes(color)) {
        return { success: false, error: 'Invalid color' };
    }

    const currentPlayer = getCurrentPlayer(game);

    game.currentColor = color;
    game.topCard.color = color;
    game.status = 'playing';

    return applyCardEffect(game, playerId, game.topCard);
}

/**
 * Resolve a Wild Draw Four challenge.
 * @param {boolean} doChallenge - true if the target challenges
 */
function resolveWild4Challenge(game, doChallenge) {
    const pending = game.pendingWild4Challenge;
    const drawPending = game._pendingWild4Draw;
    if (!pending || !drawPending) {
        return { success: false, error: 'No pending Wild Draw Four challenge' };
    }

    const targetId = drawPending.targetId;
    const wd4PlayerId = drawPending.playerId;
    const targetName = pending.targetName;
    const playerName = pending.playerName;

    if (doChallenge) {
        // Check if the WD4 was played legally
        const legal = wasWild4Legal(game, wd4PlayerId, null);

        if (legal) {
            // Challenge fails — challenger draws 6 instead of 4
            drawCards(game, targetId, CHALLENGE_FAIL_PENALTY);
            game.lastAction = `${targetName} challenged but failed! The Wild Draw Four was legal. ${targetName} draws 6 cards.`;
        } else {
            // Challenge succeeds — WD4 player draws 4 instead
            drawCards(game, wd4PlayerId, DRAW4_COUNT);
            game.lastAction = `${targetName} challenged successfully! ${playerName} had a matching color. ${playerName} draws 4 cards.`;
        }
    } else {
        // No challenge — target draws 4
        drawCards(game, targetId, DRAW4_COUNT);
        game.lastAction = `${targetName} accepts the Wild Draw Four and draws 4 cards.`;
    }

    // Clean up
    game.pendingWild4Challenge = null;
    game._pendingWild4Draw = null;

    // Skip the target's turn (already advanced to target, advance again)
    advanceTurn(game);

    return { success: true, game };
}

/**
 * Current player draws a card from the draw pile.
 */
function drawCard(game, playerId) {
    if (game.status !== 'playing') {
        return { success: false, error: 'Game is not in playing state' };
    }

    const currentPlayer = getCurrentPlayer(game);
    if (currentPlayer.id !== playerId) {
        return { success: false, error: 'Not your turn' };
    }

    // If must draw (from Draw Two on start), handle that
    if (game.mustDraw > 0 && game.mustDrawTarget === playerId) {
        const drawn = drawCards(game, playerId, game.mustDraw);
        game.lastAction = `${currentPlayer.name} drew ${game.mustDraw} cards`;
        game.mustDraw = 0;
        game.mustDrawTarget = null;
        advanceTurn(game);
        return { success: true, game, drawnCards: drawn };
    }

    // Normal draw — draw 1 card, turn passes
    const drawn = drawCards(game, playerId, 1);
    game.lastAction = `${currentPlayer.name} drew a card`;
    advanceTurn(game);

    return { success: true, game, drawnCards: drawn };
}

/**
 * Player calls UNO (when they have exactly 1 card remaining).
 * Non-blocking: game continues regardless; others can catch if not called.
 */
function callUno(game, playerId) {
    const hand = game.hands[playerId];
    if (!hand || hand.length !== 1) {
        return { success: false, error: 'You can only call UNO when you have 1 card' };
    }
    game.unoCalledBy[playerId] = true;
    const player = game.players.find(p => p.id === playerId);
    game.lastAction = `${player.name} called UNO!`;
    return { success: true, game };
}

/**
 * Another player catches someone who didn't call UNO.
 * The target must have exactly 1 card and not have called UNO.
 */
function challengeUno(game, challengerId, targetId) {
    const target = game.players.find(p => p.id === targetId);
    const challenger = game.players.find(p => p.id === challengerId);

    if (!target || !challenger) {
        return { success: false, error: 'Invalid player' };
    }

    if (game.hands[targetId].length !== 1) {
        return { success: false, error: 'Target does not have exactly 1 card' };
    }

    if (game.unoCalledBy[targetId]) {
        return { success: false, error: `${target.name} already called UNO` };
    }

    // Penalty — target draws 2 cards
    drawCards(game, targetId, UNO_PENALTY);
    game.lastAction = `${challenger.name} caught ${target.name} not calling UNO! ${target.name} draws ${UNO_PENALTY} penalty cards.`;
    delete game.unoCalledBy[targetId];

    return { success: true, game };
}

/**
 * Remove a player from the game (e.g., on disconnect).
 * Their cards go back into the draw pile.
 */
function removePlayer(game, playerId) {
    const playerIndex = game.players.findIndex(p => p.id === playerId);
    if (playerIndex === -1) return game;

    const player = game.players[playerIndex];

    // Put their cards back into draw pile
    if (game.hands[playerId]) {
        game.drawPile.push(...game.hands[playerId]);
        shuffle(game.drawPile);
        delete game.hands[playerId];
    }

    game.players.splice(playerIndex, 1);

    if (game.players.length < 2) {
        game.status = 'finished';
        if (game.players.length === 1) {
            game.winner = game.players[0].id;
            game.lastAction = `${game.players[0].name} wins — all other players left!`;
        }
        return game;
    }

    // Adjust current player index
    if (game.currentPlayerIndex >= game.players.length) {
        game.currentPlayerIndex = 0;
    }

    game.lastAction = `${player.name} left the game`;
    game.log.push(`${player.name} disconnected`);

    return game;
}

/**
 * Get the game state as seen by a specific player.
 * Hides other players' card details (only shows count).
 */
function getPlayerView(game, playerId) {
    return {
        players: game.players.map(p => ({
            id: p.id,
            name: p.name,
            cardCount: game.hands[p.id] ? game.hands[p.id].length : 0,
            isCurrentTurn: game.players[game.currentPlayerIndex]?.id === p.id,
            calledUno: !!game.unoCalledBy[p.id]
        })),
        hand: game.hands[playerId] || [],
        topCard: game.topCard,
        currentColor: game.currentColor,
        currentValue: game.currentValue,
        direction: game.direction,
        drawPileCount: game.drawPile.length,
        status: game.status,
        winner: game.winner,
        lastAction: game.lastAction,
        currentPlayerId: getCurrentPlayer(game)?.id,
        pendingWild4Challenge: game.pendingWild4Challenge,
        canChallenge: game.pendingWild4Challenge?.challengerId === playerId
    };
}

// ──────────────────────────────────────────────
//  EXPORTS
// ──────────────────────────────────────────────
module.exports = {
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
};
