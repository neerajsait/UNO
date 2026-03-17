/**
 * client.js — UNO Game Client V6
 * Full-featured: sounds, avatars, themes, sorting, keyboard shortcuts,
 * spectator mode, pause, bots, kick, quick chat, reconnection.
 */

const socket = io();

/* ═══ PREFERENCES (single localStorage key) ═══ */
function getPrefs() {
    try { return JSON.parse(localStorage.getItem('uno_prefs') || '{}'); } catch { return {}; }
}
function savePrefs(p) {
    const c = getPrefs();
    localStorage.setItem('uno_prefs', JSON.stringify({ ...c, ...p }));
}

/* ═══ RECONNECTION ═══ */
socket.on('connect', () => {
    const savedToken = sessionStorage.getItem('uno_session_token');
    const savedRoom = sessionStorage.getItem('uno_room_code');
    if (savedToken && savedRoom) {
        console.log('[Reconnect] Attempting session restore...');
        socket.emit('reconnect-session', { sessionToken: savedToken, roomCode: savedRoom });
    }
});

socket.on('reconnected', ({ roomCode: c, playerId, playerName, sessionToken, isHost: host, gameInProgress }) => {
    myId = playerId; myName = playerName; roomCode = c; isHost = host;
    sessionStorage.setItem('uno_session_token', sessionToken);
    sessionStorage.setItem('uno_room_code', c);
    toast('Reconnected! ✅', true);
    if (gameInProgress) {
        $('#lobby-screen').classList.remove('active');
        $('#game-screen').classList.add('active');
        $('#room-code-header').textContent = c;
        updateHostUI();
    } else {
        showWaiting();
    }
});

socket.on('reconnect-failed', () => {
    sessionStorage.removeItem('uno_session_token');
    sessionStorage.removeItem('uno_room_code');
});

function saveSession(token, code) {
    sessionStorage.setItem('uno_session_token', token);
    sessionStorage.setItem('uno_room_code', code);
}
function clearSession() {
    sessionStorage.removeItem('uno_session_token');
    sessionStorage.removeItem('uno_room_code');
}

/* ═══ STATE ═══ */
let myId = null, myName = '', roomCode = '', isHost = false;
let gs = null;
let chatOpen = false, unread = 0;
let unoTimer = null;
let currentSettings = {};
let turnTimerInterval = null;
let drawnCardPending = null;
let selectedAvatar = getPrefs().avatar || '🦊';
let sortMode = getPrefs().sortBy || 'none'; // none, color, value
let isSpectator = false;
let isPaused = false;
let dealAnimPlayed = false;

/* ═══ DOM REFS ═══ */
const $ = s => document.querySelector(s);
const $$ = s => document.querySelectorAll(s);

/* ═══ INIT — Apply saved preferences ═══ */
(function initPrefs() {
    const prefs = getPrefs();
    // Theme
    const theme = prefs.theme || 'dark';
    document.documentElement.setAttribute('data-theme', theme);
    const ts = $('#theme-select');
    if (ts) ts.value = theme;
    // Avatar
    const avBtns = $$('.av-btn');
    avBtns.forEach(b => {
        b.classList.toggle('selected', b.dataset.avatar === selectedAvatar);
    });
    // Sound icons
    updateSoundIcons();
})();

function updateSoundIcons() {
    const sfxBtn = $('#btn-sfx');
    const musicBtn = $('#btn-music');
    if (sfxBtn) sfxBtn.textContent = SFX.isSfxOn() ? '🔊' : '🔇';
    if (musicBtn) musicBtn.textContent = SFX.isMusicOn() ? '🎵' : '🎶';
}

function updateHostUI() {
    const pauseBtn = $('#btn-pause');
    if (pauseBtn) pauseBtn.classList.toggle('hidden', !isHost);
}

/* ═══ AUTO-JOIN FROM INVITE LINK ═══ */
(function autoJoinFromURL() {
    const params = new URLSearchParams(window.location.search);
    const joinCode = params.get('join');
    if (joinCode) {
        $('#room-code-input').value = joinCode;
        // Clean URL without reload
        history.replaceState(null, '', window.location.pathname);
    }
})();

let firstRender = true;
let lastTopCardId = null;

/* ═══════════════════════════════════════════════
   LOBBY
   ═══════════════════════════════════════════════ */
// Avatar picker
$$('.av-btn').forEach(b => {
    b.addEventListener('click', () => {
        $$('.av-btn').forEach(x => x.classList.remove('selected'));
        b.classList.add('selected');
        selectedAvatar = b.dataset.avatar;
        savePrefs({ avatar: selectedAvatar });
    });
});

$('#btn-create').addEventListener('click', () => {
    const n = $('#player-name').value.trim();
    if (!n) return toast('Enter a nickname first');
    myName = n;
    SFX.init();
    socket.emit('create-room', { playerName: n, avatar: selectedAvatar });
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
    SFX.init();
    socket.emit('join-room', { roomCode: c, playerName: n, avatar: selectedAvatar });
}

$('#btn-start-game').addEventListener('click', () => {
    socket.emit('start-game');
    SFX.startMusic();
});

$('#display-room-code').addEventListener('click', () => {
    navigator.clipboard.writeText(roomCode).then(() => {
        $('#copy-hint').textContent = '✓ Copied!';
        setTimeout(() => $('#copy-hint').textContent = 'Tap to copy & share with friends', 2000);
    });
});

// Share invite link
$('#btn-share-link').addEventListener('click', () => {
    const url = `${window.location.origin}${window.location.pathname}?join=${roomCode}`;
    navigator.clipboard.writeText(url).then(() => {
        $('#btn-share-link').textContent = '✅ Link Copied!';
        setTimeout(() => $('#btn-share-link').textContent = '🔗 Copy Invite Link', 2500);
        toast('Invite link copied!', true);
    }).catch(() => {
        // Fallback: show the link
        prompt('Share this link:', url);
    });
});

// Leave room
$('#btn-leave-room').addEventListener('click', () => {
    socket.emit('leave-room');
    clearSession();
    returnToLobby();
});

$('#btn-leave-game').addEventListener('click', () => {
    if (confirm('Leave the current game?')) {
        socket.emit('leave-room');
        clearSession();
        returnToLobby();
    }
});

function returnToLobby() {
    $('#game-screen').classList.remove('active');
    $('#lobby-screen').classList.add('active');
    $('#lobby-form').classList.remove('hidden');
    $('#waiting-room').classList.add('hidden');
    gs = null; roomCode = ''; isHost = false; isSpectator = false; isPaused = false;
    SFX.stopMusic();
}

// Bot controls
$('#btn-add-bot').addEventListener('click', () => {
    const diff = $('#bot-difficulty').value;
    socket.emit('add-bot', { difficulty: diff });
});

/* ═══════════════════════════════════════════════
   SETTINGS — Host controls
   ═══════════════════════════════════════════════ */
const SETTING_STEPS = {
    maxPlayers: { min: 2, max: 10, step: 1 },
    handSize: { min: 3, max: 15, step: 1 },
    unoPenalty: { min: 1, max: 6, step: 1 },
    turnTimer: { min: 0, max: 120, step: 5 },
};

$$('.s-btn').forEach(btn => {
    btn.addEventListener('click', () => {
        const key = btn.dataset.key;
        const cfg = SETTING_STEPS[key];
        if (!cfg) return;
        const isPlus = btn.classList.contains('s-plus');
        let val = currentSettings[key] || 0;
        val = isPlus ? Math.min(cfg.max, val + cfg.step) : Math.max(cfg.min, val - cfg.step);
        currentSettings[key] = val;
        $(`#s-${key}`).textContent = val === 0 && key === 'turnTimer' ? 'OFF' : val;
        socket.emit('update-room-settings', { settings: { [key]: val } });
    });
});

['drawStacking', 'jumpIn', 'forcePlayAfterDraw'].forEach(key => {
    const el = $(`#s-${key}`);
    if (el) {
        el.addEventListener('change', () => {
            currentSettings[key] = el.checked;
            socket.emit('update-room-settings', { settings: { [key]: el.checked } });
        });
    }
});

/* ═══════════════════════════════════════════════
   TOP BAR CONTROLS
   ═══════════════════════════════════════════════ */
// Theme
$('#theme-select').addEventListener('change', (e) => {
    const theme = e.target.value;
    document.documentElement.setAttribute('data-theme', theme);
    savePrefs({ theme });
});

// Sound toggles
$('#btn-sfx').addEventListener('click', () => {
    SFX.toggleSfx();
    updateSoundIcons();
});
$('#btn-music').addEventListener('click', () => {
    SFX.toggleMusic();
    updateSoundIcons();
});

// Sort hand
$('#btn-sort').addEventListener('click', cycleSortMode);
function cycleSortMode() {
    const modes = ['none', 'color', 'value'];
    const idx = modes.indexOf(sortMode);
    sortMode = modes[(idx + 1) % modes.length];
    savePrefs({ sortBy: sortMode });
    const labels = { none: '🃏', color: '🎨', value: '🔢' };
    $('#btn-sort').textContent = labels[sortMode];
    toast(`Sort: ${sortMode === 'none' ? 'Off' : sortMode}`, true);
    if (gs) renderHand();
}

// Pause
$('#btn-pause').addEventListener('click', () => {
    socket.emit('toggle-pause');
});
$('#btn-resume').addEventListener('click', () => {
    socket.emit('toggle-pause');
});

// Quick chat
$$('.qc-btn').forEach(b => {
    b.addEventListener('click', () => {
        socket.emit('chat-message', { message: b.dataset.msg });
        SFX.play('chatMsg');
    });
});

/* ═══════════════════════════════════════════════
   SOCKET — LOBBY
   ═══════════════════════════════════════════════ */
socket.on('room-created', ({ roomCode: c, playerId, sessionToken }) => {
    myId = playerId; roomCode = c; isHost = true;
    if (sessionToken) saveSession(sessionToken, c);
    showWaiting();
    SFX.play('joinRoom');
});
socket.on('room-joined', ({ roomCode: c, playerId, sessionToken }) => {
    myId = playerId; roomCode = c; isHost = false;
    if (sessionToken) saveSession(sessionToken, c);
    showWaiting();
    SFX.play('joinRoom');
});
socket.on('player-list', ({ players, hostId }) => {
    isHost = socket.id === hostId;
    renderPlayers(players);
});
socket.on('room-settings', ({ settings, hostId }) => {
    currentSettings = { ...settings };
    isHost = socket.id === hostId;
    renderSettings();
});
socket.on('error-message', ({ message }) => {
    toast(message);
    SFX.play('error');
});
socket.on('game-started', () => {
    $('#lobby-screen').classList.remove('active');
    $('#game-screen').classList.add('active');
    $('#room-code-header').textContent = roomCode;
    updateHostUI();
    SFX.startMusic();
});

/* ═══════════════════════════════════════════════
   SOCKET — GAME
   ═══════════════════════════════════════════════ */
socket.on('game-state', state => {
    const prevTurn = gs?.currentPlayerId;
    gs = state;
    isSpectator = state.isSpectator || false;
    render();

    if (!isSpectator) {
        const me = gs.players.find(p => p.id === myId);
        if (gs.hand.length === 1 && !me?.calledUno) showUno();
        else hideUno();

        // Play sound when it becomes my turn
        if (gs.currentPlayerId === myId && prevTurn !== myId) {
            SFX.play('yourTurn');
        }
    }

    // Update spectator banner
    $('#spectator-banner').classList.toggle('hidden', !isSpectator);
});

socket.on('cards-drawn', () => { SFX.play('cardDraw'); });
socket.on('choose-color-prompt', () => showModal('color-picker-modal'));
socket.on('drawn-card-playable', ({ card }) => {
    drawnCardPending = card;
    showDrawnCardModal(card);
});
socket.on('uno-called', ({ playerName }) => {
    toast(`${playerName} called UNO! 🔴`, true);
    SFX.play('unoCall');
});
socket.on('game-over', ({ winnerId, winnerName }) => {
    $('#winner-text').textContent = winnerId === myId ? '🎉 You won!' : `${winnerName} wins!`;
    renderScoreboard();
    showModal('gameover-modal');
    // Fix Play Again for non-host
    $('#btn-again').classList.toggle('hidden', !isHost);
    $('#play-again-wait').classList.toggle('hidden', isHost);
    SFX.stopMusic();
    SFX.play(winnerId === myId ? 'win' : 'lose');
});
socket.on('chat-message', msg => {
    addChatMsg(msg);
    if (!chatOpen) {
        unread++;
        const b = $('#chat-badge');
        b.textContent = unread;
        b.classList.remove('hidden');
    }
    SFX.play('chatMsg');
});
socket.on('emoji-reaction', ({ playerName, emoji }) => {
    floatEmoji(playerName, emoji);
});
socket.on('turn-timer', ({ playerId, duration }) => {
    startTurnTimerUI(duration);
});
socket.on('game-paused', () => {
    isPaused = true;
    $('#pause-overlay').classList.remove('hidden');
    $('#btn-resume').classList.toggle('hidden', !isHost);
    SFX.play('pause');
});
socket.on('game-resumed', () => {
    isPaused = false;
    $('#pause-overlay').classList.add('hidden');
    SFX.play('resume');
});
socket.on('kicked', () => {
    SFX.play('kick');
    showModal('kicked-modal');
});
$('#btn-kicked-ok').addEventListener('click', () => {
    hideModal('kicked-modal');
    clearSession();
    returnToLobby();
});
socket.on('bot-played', ({ botName }) => {
    SFX.play('botPlay');
});
socket.on('spectator-joined', ({ name }) => {
    toast(`👀 ${name} is spectating`, true);
});

/* ═══════════════════════════════════════════════
   RENDER — LOBBY
   ═══════════════════════════════════════════════ */
function showWaiting() {
    $('#lobby-form').classList.add('hidden');
    $('#waiting-room').classList.remove('hidden');
    $('#display-room-code').textContent = roomCode;
    // Show bot controls for host
    $('#bot-controls').classList.toggle('hidden', !isHost);
}

function renderPlayers(players) {
    const ul = $('#players-list');
    ul.innerHTML = '';
    $('#player-count').textContent = players.length;

    players.forEach(p => {
        const li = document.createElement('li');
        li.className = 'pl-item';

        const av = document.createElement('span');
        av.className = 'opp-av';
        av.textContent = p.avatar || p.name[0].toUpperCase();
        if (!p.avatar) {
            av.style.background = '#A855F7';
        }

        const nm = document.createElement('span');
        nm.className = 'pl-name';
        nm.textContent = p.name + (p.isHost ? ' 👑' : '') + (p.isBot ? '' : '');

        li.append(av, nm);

        // Host can kick/remove non-host non-self players
        if (isHost && p.id !== myId) {
            const kickBtn = document.createElement('button');
            kickBtn.className = 'kick-btn';
            kickBtn.textContent = p.isBot ? '✕' : '👢';
            kickBtn.title = p.isBot ? 'Remove bot' : 'Kick player';
            kickBtn.onclick = (e) => {
                e.stopPropagation();
                if (p.isBot) {
                    socket.emit('remove-bot', { botId: p.id });
                } else {
                    socket.emit('kick-player', { targetId: p.id });
                }
            };
            li.appendChild(kickBtn);
        }

        ul.appendChild(li);
    });

    $('#btn-start-game').classList.toggle('hidden', !isHost);
    $('#waiting-message').classList.toggle('hidden', isHost);
    $('#bot-controls').classList.toggle('hidden', !isHost);
}

function renderSettings() {
    const s = currentSettings;
    Object.keys(SETTING_STEPS).forEach(key => {
        const el = $(`#s-${key}`);
        if (el) el.textContent = s[key] === 0 && key === 'turnTimer' ? 'OFF' : s[key];
    });
    ['drawStacking', 'jumpIn', 'forcePlayAfterDraw'].forEach(key => {
        const el = $(`#s-${key}`);
        if (el) el.checked = !!s[key];
    });
    if (isHost) {
        $('#settings-panel').classList.remove('hidden');
        $('#settings-display').classList.add('hidden');
    } else {
        $('#settings-panel').classList.add('hidden');
        renderSettingsReadonly(s);
    }
}

function renderSettingsReadonly(s) {
    const el = $('#settings-display');
    const rules = [];
    if (s.handSize !== 7) rules.push(`📋 ${s.handSize} starting cards`);
    if (s.maxPlayers !== 10) rules.push(`👥 Max ${s.maxPlayers} players`);
    if (s.drawStacking) rules.push('📚 Draw stacking ON');
    if (s.jumpIn) rules.push('⚡ Jump-in ON');
    if (s.forcePlayAfterDraw) rules.push('🃏 Play after draw ON');
    if (s.unoPenalty !== 2) rules.push(`⚠️ UNO penalty: ${s.unoPenalty} cards`);
    if (s.turnTimer > 0) rules.push(`⏱️ ${s.turnTimer}s turn timer`);
    if (rules.length === 0) {
        el.classList.add('hidden');
    } else {
        el.classList.remove('hidden');
        el.innerHTML = '<p class="settings-title">📜 House Rules</p>' +
            rules.map(r => `<div class="setting-readonly">${r}</div>`).join('');
    }
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
    renderDrawStack();
    checkChallenge();
}

/* — Opponents — */
function renderOpps() {
    const area = $('#opponents-area');
    area.innerHTML = '';

    gs.players.filter(p => p.id !== myId).forEach(p => {
        const d = document.createElement('div');
        d.className = 'opp' + (p.isCurrentTurn ? ' glow' : '');

        const av = document.createElement('span');
        av.className = 'opp-av';
        av.textContent = p.avatar || p.name[0].toUpperCase();
        if (!p.avatar) av.style.background = '#A855F7';

        const info = document.createElement('div');
        info.className = 'opp-info';

        const nm = document.createElement('span');
        nm.className = 'opp-name';
        nm.textContent = p.name;

        const cnt = document.createElement('span');
        cnt.className = 'opp-cnt';
        cnt.innerHTML = `🃏 <b>${p.cardCount}</b>`;

        const scoreEl = document.createElement('span');
        scoreEl.className = 'opp-score';
        scoreEl.textContent = `⭐ ${p.score}`;

        info.append(nm, cnt, scoreEl);
        d.append(av, info);

        if (p.cardCount === 1 && p.calledUno) {
            const u = document.createElement('span');
            u.className = 'opp-uno';
            u.textContent = 'UNO';
            d.appendChild(u);
        }
        if (p.cardCount === 1 && !p.calledUno && !isSpectator) {
            const btn = document.createElement('button');
            btn.className = 'catch';
            btn.textContent = 'Catch!';
            btn.onclick = e => { e.stopPropagation(); socket.emit('challenge-uno', { targetId: p.id }); };
            d.appendChild(btn);
        }

        // Host kick button during game
        if (isHost && p.id !== myId && !isSpectator) {
            const kickBtn = document.createElement('button');
            kickBtn.className = 'opp-kick';
            kickBtn.textContent = '👢';
            kickBtn.title = 'Kick player';
            kickBtn.onclick = (e) => {
                e.stopPropagation();
                socket.emit('kick-player', { targetId: p.id });
            };
            d.appendChild(kickBtn);
        }

        area.appendChild(d);
    });
}

/* — Discard pile & info — */
function renderDiscard() {
    const el = $('#top-card');
    const prevTopId = lastTopCardId;
    buildCardEl(el, gs.topCard, false);
    // Animate discard entrance when top card changes
    if (gs.topCard.id !== prevTopId) {
        el.classList.add('discard-new');
        el.addEventListener('animationend', () => el.classList.remove('discard-new'), { once: true });
        lastTopCardId = gs.topCard.id;
    }
    $('#draw-count').textContent = gs.drawPileCount;
    const cd = $('#cur-color');
    cd.className = 'cur-color c-' + gs.currentColor;
    const dl = $('#dir-label');
    dl.className = 'dir-label' + (gs.direction === -1 ? ' ccw' : '');
}

/* — Draw stack badge — */
function renderDrawStack() {
    const badge = $('#draw-stack-badge');
    if (gs.drawStack > 0) {
        badge.textContent = `+${gs.drawStack}`;
        badge.classList.remove('hidden');
    } else {
        badge.classList.add('hidden');
    }
}

/* — Player hand — */
function renderHand() {
    const hand = $('#player-hand');
    hand.innerHTML = '';

    if (isSpectator) {
        hand.innerHTML = '<p class="spectator-hand-msg">👀 Spectating</p>';
        return;
    }

    const myTurn = gs.currentPlayerId === myId;

    // Sort hand if needed
    let cards = [...gs.hand];
    if (sortMode === 'color') {
        const colorOrder = { red: 0, blue: 1, green: 2, yellow: 3 };
        cards.sort((a, b) => {
            const ca = a.type === 'wild' ? 99 : (colorOrder[a.color] ?? 50);
            const cb = b.type === 'wild' ? 99 : (colorOrder[b.color] ?? 50);
            if (ca !== cb) return ca - cb;
            const va = typeof a.value === 'number' ? a.value : 10;
            const vb = typeof b.value === 'number' ? b.value : 10;
            return va - vb;
        });
    } else if (sortMode === 'value') {
        cards.sort((a, b) => {
            const va = typeof a.value === 'number' ? a.value : (a.value === 'wild' ? 98 : a.value === 'wild4' ? 99 : 20);
            const vb = typeof b.value === 'number' ? b.value : (b.value === 'wild' ? 98 : b.value === 'wild4' ? 99 : 20);
            return va - vb;
        });
    }

    cards.forEach((c, idx) => {
        const el = document.createElement('div');
        buildCardEl(el, c, true);
        const ok = myTurn && canPlay(c);
        const jumpOk = !myTurn && gs.settings?.jumpIn && canJumpIn(c);

        if (myTurn) {
            if (ok) el.classList.add('ok');
            else el.classList.add('dim');
        } else if (jumpOk) {
            el.classList.add('jump');
        }

        if ((ok || jumpOk) && !isPaused) {
            el.addEventListener('click', () => {
                playCardAction(c);
                SFX.play('cardPlay');
            });
        }

        // Keyboard shortcut number label
        if (idx < 9) {
            el.setAttribute('data-key', idx + 1);
        }
        // Deal animation on first render
        if (firstRender) {
            el.classList.add('card-dealing');
            el.style.setProperty('--deal-idx', idx);
            el.addEventListener('animationend', () => el.classList.remove('card-dealing'), { once: true });
        }

        hand.appendChild(el);
    });
    if (firstRender) firstRender = false;
}

/* — Status bar — */
function renderInfo() {
    const pill = $('#game-status');
    const myTurn = gs.currentPlayerId === myId;
    const who = gs.players.find(p => p.id === gs.currentPlayerId)?.name || '?';
    if (isPaused) {
        pill.textContent = '⏸️ Paused';
        pill.classList.remove('my-turn');
    } else if (isSpectator) {
        pill.textContent = `👀 ${who}'s turn`;
        pill.classList.remove('my-turn');
    } else if (myTurn) {
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
    if (gs.canChallenge && gs.pendingWild4Challenge && !isSpectator) {
        const ch = gs.pendingWild4Challenge;
        $('#challenge-text').textContent = `${ch.playerName} played Wild Draw Four on you!`;
        showModal('challenge-modal');
    }
}

/* — Scoreboard (game over) — */
function renderScoreboard() {
    if (!gs) return;
    const sb = $('#scoreboard');
    const sorted = [...gs.players].sort((a, b) => b.score - a.score);
    sb.innerHTML = '<p class="sb-title">Scoreboard</p>' +
        sorted.map((p, i) => `<div class="sb-row ${p.id === myId ? 'sb-me' : ''}">
            <span class="sb-rank">${i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : `#${i + 1}`}</span>
            <span class="sb-name">${esc(p.name)}</span>
            <span class="sb-score">${p.score} pts</span>
        </div>`).join('');
}

/* ═══════════════════════════════════════════════
   CARD BUILDER — Realistic UNO Card Elements
   ═══════════════════════════════════════════════ */
function buildCardEl(el, card, interactive) {
    el.className = 'uno-card uc-' + cardColor(card);
    el.innerHTML = '';
    const oval = document.createElement('div');
    oval.className = 'card-oval';
    el.appendChild(oval);
    const val = document.createElement('span');
    const label = cardLabel(card);
    const isSym = isAction(card);
    val.className = 'card-val' + (isSym ? ' sym' : '');
    val.textContent = label;
    el.appendChild(val);
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
    if (c.type === 'wild') return c.color || 'wild';
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
    if (gs.drawStack > 0) {
        if (c.value === 'draw2' && gs.currentValue === 'draw2') return true;
        if (c.value === 'wild4') return true;
        return false;
    }
    if (c.type === 'wild') return true;
    return c.color === gs.currentColor || c.value === gs.currentValue;
}

function canJumpIn(c) {
    if (!gs || c.type === 'wild') return false;
    return c.color === gs.topCard.color && c.value === gs.topCard.value;
}

/* ═══════════════════════════════════════════════
   GAME ACTIONS
   ═══════════════════════════════════════════════ */
function playCardAction(card) {
    if (isPaused || isSpectator) return;
    if (card.type === 'wild') {
        window._pendingWild = card;
        showModal('color-picker-modal');
    } else {
        socket.emit('play-card', { cardId: card.id });
    }
}

$('#draw-pile').addEventListener('click', () => {
    if (!gs || isPaused || isSpectator) return;
    if (gs.currentPlayerId !== myId) return toast('Not your turn!', true);
    socket.emit('draw-card');
    SFX.play('cardDraw');
});

/* UNO */
$('#btn-uno').addEventListener('click', () => {
    socket.emit('call-uno');
    hideUno();
    toast('You called UNO! 🔴', true);
    SFX.play('unoCall');
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
        SFX.play('cardPlay');
    } else if (drawnCardPending) {
        socket.emit('resolve-drawn-card', { doPlay: true, chosenColor: color });
        drawnCardPending = null;
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

/* Drawn card play/keep */
$('#btn-play-drawn').addEventListener('click', () => {
    hideModal('drawn-card-modal');
    if (!drawnCardPending) return;
    if (drawnCardPending.type === 'wild') {
        window._pendingWild = null;
        showModal('color-picker-modal');
    } else {
        socket.emit('resolve-drawn-card', { doPlay: true });
        drawnCardPending = null;
    }
});
$('#btn-keep-drawn').addEventListener('click', () => {
    hideModal('drawn-card-modal');
    socket.emit('resolve-drawn-card', { doPlay: false });
    drawnCardPending = null;
});

function showDrawnCardModal(card) {
    const preview = $('#drawn-card-preview');
    preview.innerHTML = '';
    const el = document.createElement('div');
    buildCardEl(el, card, false);
    el.classList.add('drawn-card-big');
    preview.appendChild(el);
    showModal('drawn-card-modal');
}

/* Game over — Play Again */
$('#btn-again').addEventListener('click', () => {
    hideModal('gameover-modal');
    if (isHost) socket.emit('restart-game');
});

/* Emoji reactions */
$$('.emoji-btn').forEach(b => b.addEventListener('click', () => {
    socket.emit('emoji-reaction', { emoji: b.dataset.emoji });
}));

function floatEmoji(playerName, emoji) {
    const container = $('#emoji-float-container');
    const el = document.createElement('div');
    el.className = 'emoji-float';
    el.innerHTML = `<span class="ef-emoji">${emoji}</span><span class="ef-name">${esc(playerName)}</span>`;
    el.style.left = (20 + Math.random() * 60) + '%';
    container.appendChild(el);
    setTimeout(() => el.remove(), 2500);
}

/* Turn timer UI */
function startTurnTimerUI(duration) {
    const bar = $('#turn-timer-bar');
    const fill = $('#turn-timer-fill');
    bar.classList.remove('hidden');
    fill.style.transition = 'none';
    fill.style.width = '100%';

    clearInterval(turnTimerInterval);

    requestAnimationFrame(() => {
        requestAnimationFrame(() => {
            fill.style.transition = `width ${duration}s linear`;
            fill.style.width = '0%';
        });
    });

    // Timer tick sound for last 5 seconds
    let tickTimer = null;
    const tickStart = Math.max(0, (duration - 5)) * 1000;
    tickTimer = setTimeout(() => {
        let ticks = 5;
        const tickInterval = setInterval(() => {
            if (ticks <= 0) { clearInterval(tickInterval); return; }
            SFX.play('timerTick');
            ticks--;
        }, 1000);
    }, tickStart);

    turnTimerInterval = setTimeout(() => {
        bar.classList.add('hidden');
        clearTimeout(tickTimer);
    }, duration * 1000 + 200);
}

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
   KEYBOARD SHORTCUTS
   ═══════════════════════════════════════════════ */
document.addEventListener('keydown', (e) => {
    // Don't trigger shortcuts in input fields
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.tagName === 'SELECT') return;
    if (!gs || isSpectator || isPaused) return;

    const key = e.key.toUpperCase();

    // D = Draw card
    if (key === 'D') {
        if (gs.currentPlayerId === myId) {
            socket.emit('draw-card');
            SFX.play('cardDraw');
        }
    }

    // U = Call UNO
    if (key === 'U') {
        socket.emit('call-uno');
        hideUno();
        toast('You called UNO! 🔴', true);
        SFX.play('unoCall');
    }

    // 1-9 = Play card by position
    if (key >= '1' && key <= '9') {
        const idx = parseInt(key) - 1;
        let cards = getSortedHand();
        if (idx < cards.length) {
            const card = cards[idx];
            const myTurn = gs.currentPlayerId === myId;
            const ok = myTurn && canPlay(card);
            const jumpOk = !myTurn && gs.settings?.jumpIn && canJumpIn(card);
            if (ok || jumpOk) {
                playCardAction(card);
                SFX.play('cardPlay');
            }
        }
    }

    // S = Sort hand
    if (key === 'S') {
        cycleSortMode();
    }

    // Escape = Close modals
    if (e.key === 'Escape') {
        ['color-picker-modal', 'challenge-modal', 'drawn-card-modal', 'gameover-modal'].forEach(id => {
            hideModal(id);
        });
    }
});

function getSortedHand() {
    if (!gs) return [];
    let cards = [...gs.hand];
    if (sortMode === 'color') {
        const colorOrder = { red: 0, blue: 1, green: 2, yellow: 3 };
        cards.sort((a, b) => {
            const ca = a.type === 'wild' ? 99 : (colorOrder[a.color] ?? 50);
            const cb = b.type === 'wild' ? 99 : (colorOrder[b.color] ?? 50);
            if (ca !== cb) return ca - cb;
            return (typeof a.value === 'number' ? a.value : 10) - (typeof b.value === 'number' ? b.value : 10);
        });
    } else if (sortMode === 'value') {
        cards.sort((a, b) => {
            const va = typeof a.value === 'number' ? a.value : (a.value === 'wild' ? 98 : a.value === 'wild4' ? 99 : 20);
            const vb = typeof b.value === 'number' ? b.value : (b.value === 'wild' ? 98 : b.value === 'wild4' ? 99 : 20);
            return va - vb;
        });
    }
    return cards;
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
