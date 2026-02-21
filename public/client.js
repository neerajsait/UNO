/**
 * client.js — UNO Game Client V3
 * Realistic card rendering, non-blocking UNO, premium UI.
 */

const socket = io();

/* ═══ STATE ═══ */
let myId = null, myName = '', roomCode = '', isHost = false;
let gs = null;              // game state
let chatOpen = false, unread = 0;
let unoTimer = null;

const AV_COLORS = ['#EF4444', '#3B82F6', '#22C55E', '#EAB308', '#A855F7', '#F97316', '#14B8A6', '#EC4899', '#06B6D4', '#F43F5E'];

/* ═══ DOM REFS ═══ */
const $ = s => document.querySelector(s);
const $$ = s => document.querySelectorAll(s);

/* ═══════════════════════════════════════════════
   LOBBY
   ═══════════════════════════════════════════════ */
$('#btn-create').addEventListener('click', () => {
    const n = $('#player-name').value.trim();
    if (!n) return toast('Enter a nickname first');
    myName = n;
    socket.emit('create-room', { playerName: n });
});

$('#btn-join').addEventListener('click', joinRoom);
$('#room-code-input').addEventListener('keydown', e => e.key === 'Enter' && joinRoom());
$('#player-name').addEventListener('keydown', e => {
    if (e.key === 'Enter') {
        $('#room-code-input').value.trim() ? joinRoom() : $('#btn-create').click();
    }
});

function joinRoom() {
    const n = $('#player-name').value.trim();
    const c = $('#room-code-input').value.trim();
    if (!n) return toast('Enter a nickname first');
    if (!c) return toast('Enter a room code');
    myName = n;
    socket.emit('join-room', { roomCode: c, playerName: n });
}

$('#btn-start-game').addEventListener('click', () => socket.emit('start-game'));

$('#display-room-code').addEventListener('click', () => {
    navigator.clipboard.writeText(roomCode).then(() => {
        $('#copy-hint').textContent = '✓ Copied!';
        setTimeout(() => $('#copy-hint').textContent = 'Tap to copy & share with friends', 2000);
    });
});

/* ═══════════════════════════════════════════════
   SOCKET — LOBBY
   ═══════════════════════════════════════════════ */
socket.on('room-created', ({ roomCode: c, playerId }) => {
    myId = playerId; roomCode = c; isHost = true;
    showWaiting();
});
socket.on('room-joined', ({ roomCode: c, playerId }) => {
    myId = playerId; roomCode = c; isHost = false;
    showWaiting();
});
socket.on('player-list', ({ players, hostId }) => {
    isHost = socket.id === hostId;
    renderPlayers(players);
});
socket.on('error-message', ({ message }) => toast(message));
socket.on('game-started', () => {
    $('#lobby-screen').classList.remove('active');
    $('#game-screen').classList.add('active');
    $('#room-code-header').textContent = roomCode;
});

/* ═══════════════════════════════════════════════
   SOCKET — GAME
   ═══════════════════════════════════════════════ */
socket.on('game-state', state => {
    gs = state;
    render();
    // UNO button: show when 1 card, auto-hide after 5s (never blocks)
    const me = gs.players.find(p => p.id === myId);
    if (gs.hand.length === 1 && !me?.calledUno) showUno();
    else hideUno();
});
socket.on('cards-drawn', () => { });
socket.on('choose-color-prompt', () => showModal('color-picker-modal'));
socket.on('uno-called', ({ playerName }) => toast(`${playerName} called UNO! 🔴`, true));
socket.on('game-over', ({ winnerId, winnerName }) => {
    $('#winner-text').textContent = winnerId === myId ? '🎉 You won!' : `${winnerName} wins!`;
    showModal('gameover-modal');
});
socket.on('chat-message', msg => {
    addChatMsg(msg);
    if (!chatOpen) {
        unread++;
        const b = $('#chat-badge');
        b.textContent = unread;
        b.classList.remove('hidden');
    }
});

/* ═══════════════════════════════════════════════
   RENDER — LOBBY
   ═══════════════════════════════════════════════ */
function showWaiting() {
    $('#lobby-form').classList.add('hidden');
    $('#waiting-room').classList.remove('hidden');
    $('#display-room-code').textContent = roomCode;
}

function renderPlayers(players) {
    const ul = $('#players-list');
    ul.innerHTML = '';
    $('#player-count').textContent = players.length;

    players.forEach((p, i) => {
        const li = document.createElement('li');
        const av = document.createElement('span');
        av.className = 'opp-av';
        av.style.background = AV_COLORS[i % AV_COLORS.length];
        av.textContent = p.name[0].toUpperCase();
        const nm = document.createElement('span');
        nm.textContent = p.name + (p.isHost ? ' 👑' : '');
        li.append(av, nm);
        ul.appendChild(li);
    });

    $('#btn-start-game').classList.toggle('hidden', !isHost);
    $('#waiting-message').classList.toggle('hidden', isHost);
}

/* ═══════════════════════════════════════════════
   RENDER — GAME
   ═══════════════════════════════════════════════ */
function render() {
    if (!gs) return;
    renderOpps();
    renderDiscard();
    renderHand();
    renderInfo();
    renderFeed();
    checkChallenge();
}

/* — Opponents — */
function renderOpps() {
    const area = $('#opponents-area');
    area.innerHTML = '';

    gs.players.filter(p => p.id !== myId).forEach(p => {
        const d = document.createElement('div');
        d.className = 'opp' + (p.isCurrentTurn ? ' glow' : '');

        const ci = gs.players.findIndex(x => x.id === p.id);
        const av = document.createElement('span');
        av.className = 'opp-av';
        av.style.background = AV_COLORS[ci % AV_COLORS.length];
        av.textContent = p.name[0].toUpperCase();

        const nm = document.createElement('span');
        nm.textContent = p.name;

        const cnt = document.createElement('span');
        cnt.className = 'opp-cnt';
        cnt.innerHTML = `🃏 <b>${p.cardCount}</b>`;

        d.append(av, nm, cnt);

        if (p.cardCount === 1 && p.calledUno) {
            const u = document.createElement('span');
            u.className = 'opp-uno';
            u.textContent = 'UNO';
            d.appendChild(u);
        }
        if (p.cardCount === 1 && !p.calledUno) {
            const btn = document.createElement('button');
            btn.className = 'catch';
            btn.textContent = 'Catch!';
            btn.onclick = e => { e.stopPropagation(); socket.emit('challenge-uno', { targetId: p.id }); };
            d.appendChild(btn);
        }

        area.appendChild(d);
    });
}

/* — Discard pile & info — */
function renderDiscard() {
    const el = $('#top-card');
    buildCardEl(el, gs.topCard, false);
    $('#draw-count').textContent = gs.drawPileCount;

    const cd = $('#cur-color');
    cd.className = 'cur-color c-' + gs.currentColor;

    const dl = $('#dir-label');
    dl.className = 'dir-label' + (gs.direction === -1 ? ' ccw' : '');
}

/* — Player hand — */
function renderHand() {
    const hand = $('#player-hand');
    hand.innerHTML = '';
    const myTurn = gs.currentPlayerId === myId;

    gs.hand.forEach(c => {
        const el = document.createElement('div');
        buildCardEl(el, c, true);
        const ok = myTurn && canPlay(c);
        if (myTurn) {
            if (ok) el.classList.add('ok');
            else el.classList.add('dim');
        }
        if (ok) el.addEventListener('click', () => playCard(c));
        hand.appendChild(el);
    });
}

/* — Status bar — */
function renderInfo() {
    const pill = $('#game-status');
    const myTurn = gs.currentPlayerId === myId;
    const who = gs.players.find(p => p.id === gs.currentPlayerId)?.name || '?';
    if (myTurn) {
        pill.textContent = '🟢 Your turn!';
        pill.classList.add('my-turn');
    } else {
        pill.textContent = `⏳ ${who}'s turn`;
        pill.classList.remove('my-turn');
    }
}

/* — Action feed — */
function renderFeed() {
    const f = $('#action-feed');
    if (gs.lastAction) {
        f.textContent = gs.lastAction;
        f.classList.remove('hidden');
    } else f.classList.add('hidden');
}

/* — Challenge check — */
function checkChallenge() {
    if (gs.canChallenge && gs.pendingWild4Challenge) {
        const ch = gs.pendingWild4Challenge;
        $('#challenge-text').textContent = `${ch.playerName} played Wild Draw Four on you!`;
        showModal('challenge-modal');
    }
}

/* ═══════════════════════════════════════════════
   CARD BUILDER — Realistic UNO Card Elements
   Creates: colored card, white oval, center value,
   two corner values (top-left, bottom-right)
   ═══════════════════════════════════════════════ */
function buildCardEl(el, card, interactive) {
    el.className = 'uno-card uc-' + cardColor(card);
    el.innerHTML = '';

    // White center oval
    const oval = document.createElement('div');
    oval.className = 'card-oval';
    el.appendChild(oval);

    // Center value
    const val = document.createElement('span');
    const label = cardLabel(card);
    const isSym = isAction(card);
    val.className = 'card-val' + (isSym ? ' sym' : '');
    val.textContent = label;
    el.appendChild(val);

    // Corner values (top-left & bottom-right)
    const cornerLabel = cornerText(card);
    const tl = document.createElement('span');
    tl.className = 'corner tl';
    tl.textContent = cornerLabel;
    el.appendChild(tl);

    const br = document.createElement('span');
    br.className = 'corner br';
    br.textContent = cornerLabel;
    el.appendChild(br);
}

function cardColor(c) {
    if (c.type === 'wild') return 'wild';
    return c.color;
}

function cardLabel(c) {
    switch (c.value) {
        case 'skip': return '⊘';
        case 'reverse': return '⇄';
        case 'draw2': return '+2';
        case 'wild': return 'W';
        case 'wild4': return '+4';
        default: return c.value;
    }
}

function cornerText(c) {
    switch (c.value) {
        case 'skip': return '⊘';
        case 'reverse': return '⇄';
        case 'draw2': return '+2';
        case 'wild': return '✦';
        case 'wild4': return '+4';
        default: return c.value;
    }
}

function isAction(c) {
    return ['skip', 'reverse', 'draw2', 'wild', 'wild4'].includes(c.value);
}

function canPlay(c) {
    if (!gs || gs.status !== 'playing') return false;
    if (c.type === 'wild') return true;
    return c.color === gs.currentColor || c.value === gs.currentValue;
}

/* ═══════════════════════════════════════════════
   GAME ACTIONS
   ═══════════════════════════════════════════════ */
function playCard(card) {
    if (card.type === 'wild') {
        window._pendingWild = card;
        showModal('color-picker-modal');
    } else {
        socket.emit('play-card', { cardId: card.id });
    }
}

$('#draw-pile').addEventListener('click', () => {
    if (!gs) return;
    if (gs.currentPlayerId !== myId) return toast('Not your turn!', true);
    socket.emit('draw-card');
});

/* UNO — non-blocking */
$('#btn-uno').addEventListener('click', () => {
    socket.emit('call-uno');
    hideUno();
    toast('You called UNO! 🔴', true);
});
function showUno() {
    $('#btn-uno').classList.remove('hidden');
    clearTimeout(unoTimer);
    unoTimer = setTimeout(hideUno, 5000);
}
function hideUno() {
    $('#btn-uno').classList.add('hidden');
    clearTimeout(unoTimer);
}

/* Color picker */
$$('.cp-btn').forEach(b => b.addEventListener('click', () => {
    const color = b.dataset.color;
    hideModal('color-picker-modal');
    if (window._pendingWild) {
        socket.emit('play-card', { cardId: window._pendingWild.id, chosenColor: color });
        window._pendingWild = null;
    } else {
        socket.emit('choose-color', { color });
    }
}));

/* WD4 Challenge */
$('#btn-ch-yes').addEventListener('click', () => {
    socket.emit('challenge-wd4', { doChallenge: true });
    hideModal('challenge-modal');
});
$('#btn-ch-no').addEventListener('click', () => {
    socket.emit('challenge-wd4', { doChallenge: false });
    hideModal('challenge-modal');
});

/* Game over */
$('#btn-again').addEventListener('click', () => {
    hideModal('gameover-modal');
    if (isHost) socket.emit('restart-game');
});

/* ═══════════════════════════════════════════════
   CHAT
   ═══════════════════════════════════════════════ */
$('#btn-toggle-chat').addEventListener('click', () => {
    chatOpen = !chatOpen;
    $('#chat-panel').classList.toggle('open', chatOpen);
    if (chatOpen) { unread = 0; $('#chat-badge').classList.add('hidden'); }
});
$('#btn-close-chat').addEventListener('click', () => {
    chatOpen = false;
    $('#chat-panel').classList.remove('open');
});

$('#chat-form').addEventListener('submit', e => {
    e.preventDefault();
    const msg = $('#chat-input').value.trim();
    if (!msg) return;
    socket.emit('chat-message', { message: msg });
    $('#chat-input').value = '';
});

function addChatMsg({ sender, message, timestamp, isSystem }) {
    const el = document.createElement('div');
    el.className = 'ch-msg ' + (isSystem ? 'sys' : 'usr');
    const t = new Date(timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    if (isSystem) {
        el.innerHTML = `<span>${message}</span><span class="ts">${t}</span>`;
    } else {
        el.innerHTML = `<span class="sn">${esc(sender)}:</span>${esc(message)}<span class="ts">${t}</span>`;
    }
    $('#chat-messages').appendChild(el);
    $('#chat-messages').scrollTop = $('#chat-messages').scrollHeight;
}

/* ═══════════════════════════════════════════════
   UTILITIES
   ═══════════════════════════════════════════════ */
function showModal(id) { document.getElementById(id).classList.remove('hidden'); }
function hideModal(id) { document.getElementById(id).classList.add('hidden'); }

function toast(msg, info) {
    const el = document.createElement('div');
    el.className = 'notif ' + (info ? 'inf' : 'err');
    el.textContent = msg;
    document.body.appendChild(el);
    setTimeout(() => el.remove(), 3000);
}

function esc(s) {
    const d = document.createElement('div');
    d.textContent = s;
    return d.innerHTML;
}
