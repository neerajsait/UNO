/**
 * gameLogic.js — Server-authoritative UNO game engine
 * Full official rules + host-configurable house rules:
 *   - 108-card deck (number, skip, reverse, draw two, wild, wild draw four)
 *   - Turn order with direction reversal
 *   - Action card effects (skip, reverse, draw2, wild, wild4)
 *   - Wild Draw Four challenge system
 *   - UNO call & penalty system
 *   - Win detection & deck reshuffle
 *   - Draw-then-play (play drawn card immediately if valid)
 *   - Draw stacking (+2 on +2)
 *   - Jump-in (play identical card out of turn)
 *   - Configurable hand size, max players, penalties, turn timer
 *   - Score tracking across rounds
 */

// ──────────────────────────────────────────────
//  CONSTANTS
// ──────────────────────────────────────────────
const COLORS = ['red', 'blue', 'green', 'yellow'];
const NUMBER_VALUES = ['0', '1', '2', '3', '4', '5', '6', '7', '8', '9'];
const ACTION_VALUES = ['skip', 'reverse', 'draw2'];
const WILD_TYPES = ['wild', 'wild4'];

const DEFAULT_SETTINGS = {
    maxPlayers: 10,
    handSize: 7,
    drawStacking: false,
    jumpIn: false,
    forcePlayAfterDraw: false,
    unoPenalty: 2,
    turnTimer: 0,       // 0 = disabled
};

const DRAW2_COUNT = 2;
const DRAW4_COUNT = 4;
const CHALLENGE_FAIL_PENALTY = 6;

// Point values for scoring
const CARD_POINTS = {
    number: (card) => parseInt(card.value, 10),
    action: () => 20,     // skip, reverse, draw2
    wild: () => 50,       // wild, wild4
};

// ──────────────────────────────────────────────
//  DECK CREATION & SHUFFLING
// ──────────────────────────────────────────────

function createDeck() {
    const deck = [];
    let id = 0;

    for (const color of COLORS) {
        deck.push({ id: id++, color, value: '0', type: 'number' });
        for (let i = 1; i <= 9; i++) {
            deck.push({ id: id++, color, value: String(i), type: 'number' });
            deck.push({ id: id++, color, value: String(i), type: 'number' });
        }
        for (const action of ACTION_VALUES) {
            deck.push({ id: id++, color, value: action, type: 'action' });
            deck.push({ id: id++, color, value: action, type: 'action' });
        }
    }

    for (let i = 0; i < 4; i++) {
        deck.push({ id: id++, color: null, value: 'wild', type: 'wild' });
        deck.push({ id: id++, color: null, value: 'wild4', type: 'wild' });
    }

    return deck;
}

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

function createGame(players, settings = {}) {
    const s = { ...DEFAULT_SETTINGS, ...settings };
    const deck = shuffle(createDeck());

    const hands = {};
    for (const player of players) {
        hands[player.id] = deck.splice(0, s.handSize);
    }

    // Flip valid starting card
    let discardPile = [];
    let startCard = deck.pop();
    while (startCard.value === 'wild4') {
        deck.unshift(startCard);
        shuffle(deck);
        startCard = deck.pop();
    }
    discardPile.push(startCard);

    const game = {
        players: players.map(p => ({ ...p, cardCount: s.handSize, score: p.score || 0 })),
        hands,
        drawPile: deck,
        discardPile,
        currentPlayerIndex: 0,
        direction: 1,
        currentColor: startCard.color || COLORS[0],
        currentValue: startCard.value,
        topCard: startCard,
        status: 'playing',
        winner: null,
        lastAction: null,
        unoCalledBy: {},
        mustDraw: 0,
        mustDrawTarget: null,
        drawStack: 0,                   // for draw stacking
        pendingWild4Challenge: null,
        pendingDrawnCard: null,         // for force-play-after-draw
        pendingDrawnPlayerId: null,
        turnTimer: null,
        settings: s,
        log: [],
        _preWild4Color: null,
        _pendingWild4Draw: null,
    };

    applyStartingCard(game);
    return game;
}

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
            if (game.players.length === 2) advanceTurn(game);
            break;
        case 'draw2':
            if (game.settings.drawStacking) {
                game.drawStack = DRAW2_COUNT;
                game.lastAction = `First card is Draw Two — play a +2 to stack or draw ${game.drawStack}`;
            } else {
                game.mustDraw = DRAW2_COUNT;
                game.mustDrawTarget = getCurrentPlayer(game).id;
                game.lastAction = `First card is Draw Two — ${getCurrentPlayer(game).name} must draw 2`;
            }
            break;
        case 'wild':
            game.status = 'choosing_color';
            game.lastAction = 'First card is Wild — first player chooses a color';
            break;
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

function reshuffleDeck(game) {
    if (game.drawPile.length > 0) return;
    const topCard = game.discardPile.pop();
    game.drawPile = shuffle(game.discardPile);
    game.drawPile.forEach(c => { if (c.type === 'wild') c.color = null; });
    game.discardPile = [topCard];
    game.log.push('Draw pile reshuffled from discard pile');
}

function drawCards(game, playerId, count) {
    const drawn = [];
    for (let i = 0; i < count; i++) {
        if (game.drawPile.length === 0) reshuffleDeck(game);
        if (game.drawPile.length === 0) break;
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

function calculateScore(game, winnerId) {
    let points = 0;
    for (const player of game.players) {
        if (player.id === winnerId) continue;
        const hand = game.hands[player.id];
        if (!hand) continue;
        for (const card of hand) {
            const scorer = CARD_POINTS[card.type];
            if (scorer) points += scorer(card);
        }
    }
    return points;
}

// ──────────────────────────────────────────────
//  CARD VALIDATION
// ──────────────────────────────────────────────

function isValidPlay(game, playerId, card) {
    // If draw stacking is active, only matching draw cards allowed
    if (game.drawStack > 0) {
        if (card.value === 'draw2' && game.currentValue === 'draw2') return true;
        if (card.value === 'wild4') return true;
        return false; // must draw or stack
    }

    if (card.value === 'wild') return true;
    if (card.value === 'wild4') return true;
    return card.color === game.currentColor || card.value === game.currentValue;
}

function wasWild4Legal(game, playerId) {
    const hand = game.hands[playerId];
    const previousColor = game._preWild4Color;
    const hadMatchingColor = hand.some(c => c.color === previousColor);
    return !hadMatchingColor;
}

// ──────────────────────────────────────────────
//  JUMP-IN
// ──────────────────────────────────────────────

function attemptJumpIn(game, playerId, cardId) {
    if (!game.settings.jumpIn) {
        return { success: false, error: 'Jump-in is not enabled' };
    }

    const currentPlayer = getCurrentPlayer(game);
    if (currentPlayer.id === playerId) {
        return { success: false, error: 'It is already your turn' };
    }

    const hand = game.hands[playerId];
    const cardIndex = hand.findIndex(c => c.id === cardId);
    if (cardIndex === -1) {
        return { success: false, error: 'Card not in your hand' };
    }

    const card = hand[cardIndex];

    // Jump-in: must be exact same card (same color AND same value, no wilds)
    if (card.type === 'wild') {
        return { success: false, error: 'Cannot jump in with wild cards' };
    }

    if (card.color !== game.topCard.color || card.value !== game.topCard.value) {
        return { success: false, error: 'Jump-in requires an identical card (same color and value)' };
    }

    // Valid jump-in — play the card
    hand.splice(cardIndex, 1);
    updatePlayerCardCount(game, playerId);
    game.discardPile.push(card);
    game.topCard = card;
    game.currentColor = card.color;
    game.currentValue = card.value;

    // Set turn to the jump-in player
    const jumperIndex = game.players.findIndex(p => p.id === playerId);
    game.currentPlayerIndex = jumperIndex;

    delete game.unoCalledBy[playerId];
    game.pendingWild4Challenge = null;

    const playerName = game.players.find(p => p.id === playerId).name;

    // Apply card effects
    return applyCardEffect(game, playerId, card, true);
}

// ──────────────────────────────────────────────
//  CORE GAME ACTIONS
// ──────────────────────────────────────────────

function playCard(game, playerId, cardId, chosenColor) {
    if (game.status === 'finished') {
        return { success: false, error: 'Game is already finished' };
    }
    if (game.paused) {
        return { success: false, error: 'Game is paused' };
    }
    if (game.status === 'choosing_color') {
        return { success: false, error: 'Waiting for color choice' };
    }
    if (game.pendingDrawnCard) {
        return { success: false, error: 'Resolve the drawn card first (play or pass)' };
    }

    const currentPlayer = getCurrentPlayer(game);
    if (currentPlayer.id !== playerId) {
        // Try jump-in if enabled
        if (game.settings.jumpIn) {
            return attemptJumpIn(game, playerId, cardId);
        }
        return { success: false, error: 'Not your turn' };
    }

    // If must draw (non-stackable), force draw
    if (game.mustDraw > 0 && game.mustDrawTarget === playerId) {
        return { success: false, error: `You must draw ${game.mustDraw} cards first` };
    }

    // If draw stack active and player isn't stacking
    if (game.drawStack > 0) {
        const hand = game.hands[playerId];
        const card = hand.find(c => c.id === cardId);
        if (!card) return { success: false, error: 'Card not in your hand' };

        if (!isValidPlay(game, playerId, card)) {
            return { success: false, error: `You must stack a +2/+4 or draw ${game.drawStack} cards` };
        }
    }

    const hand = game.hands[playerId];
    const cardIndex = hand.findIndex(c => c.id === cardId);
    if (cardIndex === -1) {
        return { success: false, error: 'Card not in your hand' };
    }

    const card = hand[cardIndex];

    if (!isValidPlay(game, playerId, card)) {
        return { success: false, error: 'Invalid play — card does not match color or value' };
    }

    hand.splice(cardIndex, 1);
    updatePlayerCardCount(game, playerId);
    game.discardPile.push(card);
    game.topCard = card;

    delete game.unoCalledBy[playerId];
    game.pendingWild4Challenge = null;

    if (card.type === 'wild') {
        game._preWild4Color = game.currentColor;

        if (chosenColor && COLORS.includes(chosenColor)) {
            card.color = chosenColor;
            game.currentColor = chosenColor;
            game.currentValue = card.value;
            return applyCardEffect(game, playerId, card);
        } else {
            game.status = 'choosing_color';
            game.currentValue = card.value;
            game.lastAction = `${currentPlayer.name} played ${card.value === 'wild4' ? 'Wild Draw Four' : 'Wild'} — choosing color...`;
            return { success: true, game, needsColorChoice: true };
        }
    }

    game.currentColor = card.color;
    game.currentValue = card.value;
    return applyCardEffect(game, playerId, card);
}

function applyCardEffect(game, playerId, card, isJumpIn = false) {
    const playerName = game.players.find(p => p.id === playerId).name;
    let canChallenge = false;
    const prefix = isJumpIn ? '⚡ JUMP-IN! ' : '';

    switch (card.value) {
        case 'skip': {
            const skipped = game.players[getNextPlayerIndex(game)];
            game.lastAction = `${prefix}${playerName} played Skip — ${skipped.name} is skipped`;
            advanceTurn(game);
            advanceTurn(game);
            break;
        }
        case 'reverse': {
            game.direction *= -1;
            game.lastAction = `${prefix}${playerName} played Reverse`;
            if (game.players.length === 2) {
                advanceTurn(game);
            } else {
                advanceTurn(game);
            }
            break;
        }
        case 'draw2': {
            if (game.settings.drawStacking) {
                game.drawStack += DRAW2_COUNT;
                advanceTurn(game);
                const target = getCurrentPlayer(game);
                game.lastAction = `${prefix}${playerName} played +2 — Stack is now +${game.drawStack}! ${target.name} can stack or draw.`;
            } else {
                advanceTurn(game);
                const target = getCurrentPlayer(game);
                drawCards(game, target.id, DRAW2_COUNT);
                game.lastAction = `${prefix}${playerName} played Draw Two — ${target.name} draws 2 and is skipped`;
                advanceTurn(game);
            }
            break;
        }
        case 'wild': {
            game.lastAction = `${prefix}${playerName} played Wild — color is now ${game.currentColor}`;
            advanceTurn(game);
            break;
        }
        case 'wild4': {
            if (game.settings.drawStacking && game.drawStack > 0) {
                game.drawStack += DRAW4_COUNT;
                advanceTurn(game);
                const target4 = getCurrentPlayer(game);
                game.lastAction = `${prefix}${playerName} played +4 — Stack is now +${game.drawStack}! ${target4.name} can stack or draw.`;
            } else {
                advanceTurn(game);
                const target4 = getCurrentPlayer(game);

                game.pendingWild4Challenge = {
                    playerId: playerId,
                    challengerId: target4.id,
                    targetName: target4.name,
                    playerName: playerName
                };
                canChallenge = true;

                game.lastAction = `${prefix}${playerName} played Wild Draw Four — color is now ${game.currentColor}. ${target4.name} can challenge!`;
                game._pendingWild4Draw = {
                    targetId: target4.id,
                    playerId: playerId
                };
            }
            break;
        }
        default: {
            game.lastAction = `${prefix}${playerName} played ${card.color} ${card.value}`;
            advanceTurn(game);
        }
    }

    // Win check
    if (game.hands[playerId].length === 0) {
        game.status = 'finished';
        game.winner = playerId;
        const points = calculateScore(game, playerId);
        const winner = game.players.find(p => p.id === playerId);
        if (winner) winner.score += points;
        game.lastAction = `🎉 ${playerName} wins! (+${points} points)`;
        return { success: true, game };
    }

    return { success: true, game, canChallenge };
}

function chooseColor(game, playerId, color) {
    if (game.status !== 'choosing_color') {
        return { success: false, error: 'Not waiting for color choice' };
    }
    if (!COLORS.includes(color)) {
        return { success: false, error: 'Invalid color' };
    }

    game.currentColor = color;
    game.topCard.color = color;
    game.status = 'playing';

    return applyCardEffect(game, playerId, game.topCard);
}

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
        const legal = wasWild4Legal(game, wd4PlayerId);

        if (legal) {
            drawCards(game, targetId, CHALLENGE_FAIL_PENALTY);
            game.lastAction = `${targetName} challenged but failed! The Wild Draw Four was legal. ${targetName} draws 6 cards.`;
        } else {
            drawCards(game, wd4PlayerId, DRAW4_COUNT);
            game.lastAction = `${targetName} challenged successfully! ${playerName} had a matching color. ${playerName} draws 4 cards.`;
        }
    } else {
        drawCards(game, targetId, DRAW4_COUNT);
        game.lastAction = `${targetName} accepts the Wild Draw Four and draws 4 cards.`;
    }

    game.pendingWild4Challenge = null;
    game._pendingWild4Draw = null;
    advanceTurn(game);

    return { success: true, game };
}

// ──────────────────────────────────────────────
//  DRAW CARD — with force-play-after-draw & stacking
// ──────────────────────────────────────────────

function drawCard(game, playerId) {
    if (game.status !== 'playing') {
        return { success: false, error: 'Game is not in playing state' };
    }
    if (game.paused) {
        return { success: false, error: 'Game is paused' };
    }

    const currentPlayer = getCurrentPlayer(game);
    if (currentPlayer.id !== playerId) {
        return { success: false, error: 'Not your turn' };
    }

    // Draw stack resolution
    if (game.drawStack > 0) {
        const drawn = drawCards(game, playerId, game.drawStack);
        game.lastAction = `${currentPlayer.name} drew ${game.drawStack} cards from the stack!`;
        game.drawStack = 0;
        advanceTurn(game);
        return { success: true, game, drawnCards: drawn };
    }

    // Must draw (from starting Draw Two, non-stacking)
    if (game.mustDraw > 0 && game.mustDrawTarget === playerId) {
        const drawn = drawCards(game, playerId, game.mustDraw);
        game.lastAction = `${currentPlayer.name} drew ${game.mustDraw} cards`;
        game.mustDraw = 0;
        game.mustDrawTarget = null;
        advanceTurn(game);
        return { success: true, game, drawnCards: drawn };
    }

    // Normal draw 1 card
    const drawn = drawCards(game, playerId, 1);
    if (drawn.length === 0) {
        advanceTurn(game);
        game.lastAction = `${currentPlayer.name} has no cards to draw - turn passes`;
        return { success: true, game, drawnCards: [] };
    }

    const drawnCard = drawn[0];

    // Force play after draw
    if (game.settings.forcePlayAfterDraw) {
        const canPlay = isValidPlay(game, playerId, drawnCard);
        if (canPlay) {
            game.pendingDrawnCard = drawnCard;
            game.pendingDrawnPlayerId = playerId;
            game.lastAction = `${currentPlayer.name} drew a card — it's playable!`;
            return { success: true, game, drawnCards: drawn, canPlayDrawn: true, drawnCard: drawnCard };
        }
    }

    game.lastAction = `${currentPlayer.name} drew a card`;
    advanceTurn(game);
    return { success: true, game, drawnCards: drawn };
}

/**
 * When forcePlayAfterDraw is on and drawn card is playable,
 * player chooses to play it or pass.
 */
function resolveDrawnCard(game, playerId, doPlay, chosenColor) {
    if (!game.pendingDrawnCard || game.pendingDrawnPlayerId !== playerId) {
        return { success: false, error: 'No pending drawn card to resolve' };
    }

    const card = game.pendingDrawnCard;
    game.pendingDrawnCard = null;
    game.pendingDrawnPlayerId = null;

    if (!doPlay) {
        game.lastAction = `${getCurrentPlayer(game).name} kept the drawn card`;
        advanceTurn(game);
        return { success: true, game };
    }

    // Play the drawn card
    const hand = game.hands[playerId];
    const cardIndex = hand.findIndex(c => c.id === card.id);
    if (cardIndex === -1) {
        advanceTurn(game);
        return { success: false, error: 'Drawn card not found in hand' };
    }

    hand.splice(cardIndex, 1);
    updatePlayerCardCount(game, playerId);
    game.discardPile.push(card);
    game.topCard = card;
    delete game.unoCalledBy[playerId];

    if (card.type === 'wild') {
        game._preWild4Color = game.currentColor;
        if (chosenColor && COLORS.includes(chosenColor)) {
            card.color = chosenColor;
            game.currentColor = chosenColor;
            game.currentValue = card.value;
            return applyCardEffect(game, playerId, card);
        } else {
            game.status = 'choosing_color';
            game.currentValue = card.value;
            return { success: true, game, needsColorChoice: true };
        }
    }

    game.currentColor = card.color;
    game.currentValue = card.value;
    return applyCardEffect(game, playerId, card);
}

// ──────────────────────────────────────────────
//  UNO CALL & CHALLENGE
// ──────────────────────────────────────────────

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

    const penalty = game.settings.unoPenalty;
    drawCards(game, targetId, penalty);
    game.lastAction = `${challenger.name} caught ${target.name} not calling UNO! ${target.name} draws ${penalty} penalty cards.`;
    delete game.unoCalledBy[targetId];

    return { success: true, game };
}

// ──────────────────────────────────────────────
//  PLAYER MANAGEMENT
// ──────────────────────────────────────────────

function removePlayer(game, playerId) {
    const playerIndex = game.players.findIndex(p => p.id === playerId);
    if (playerIndex === -1) return game;

    const player = game.players[playerIndex];

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

    if (game.currentPlayerIndex >= game.players.length) {
        game.currentPlayerIndex = 0;
    }

    game.lastAction = `${player.name} left the game`;
    game.log.push(`${player.name} disconnected`);
    return game;
}

// ──────────────────────────────────────────────
//  PLAYER VIEW
// ──────────────────────────────────────────────

function getPlayerView(game, playerId) {
    return {
        players: game.players.map(p => ({
            id: p.id,
            name: p.name,
            cardCount: game.hands[p.id] ? game.hands[p.id].length : 0,
            isCurrentTurn: game.players[game.currentPlayerIndex]?.id === p.id,
            calledUno: !!game.unoCalledBy[p.id],
            score: p.score || 0
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
        canChallenge: game.pendingWild4Challenge?.challengerId === playerId,
        settings: game.settings,
        drawStack: game.drawStack,
        pendingDrawnCard: game.pendingDrawnPlayerId === playerId ? game.pendingDrawnCard : null,
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
    resolveDrawnCard,
    removePlayer,
    getPlayerView,
    COLORS,
    DEFAULT_SETTINGS,
};
