/**
 * sounds.js — Web Audio API sound effects & background music for UNO
 * Zero external files. All sounds synthesized in-browser.
 */

const SFX = (() => {
    let ctx = null;
    let musicGain = null;
    let sfxGain = null;
    let musicOscillators = [];
    let musicPlaying = false;

    // Load preferences
    function getPrefs() {
        try {
            return JSON.parse(localStorage.getItem('uno_prefs') || '{}');
        } catch { return {}; }
    }

    function savePrefs(p) {
        const current = getPrefs();
        localStorage.setItem('uno_prefs', JSON.stringify({ ...current, ...p }));
    }

    function init() {
        if (ctx) return;
        ctx = new (window.AudioContext || window.webkitAudioContext)();

        // Master gains
        sfxGain = ctx.createGain();
        sfxGain.connect(ctx.destination);

        musicGain = ctx.createGain();
        musicGain.connect(ctx.destination);

        const prefs = getPrefs();
        sfxGain.gain.value = prefs.sfx === false ? 0 : (prefs.volume ?? 0.5);
        musicGain.gain.value = prefs.music === false ? 0 : (prefs.volume ?? 0.3) * 0.4;
    }

    function ensureCtx() {
        if (!ctx) init();
        if (ctx.state === 'suspended') ctx.resume();
    }

    // ── SOUND SYNTHESIS ──────────────────────────

    function playTone(freq, duration, type = 'sine', vol = 0.3, attack = 0.01, decay = 0.1) {
        ensureCtx();
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = type;
        osc.frequency.value = freq;
        gain.gain.setValueAtTime(0, ctx.currentTime);
        gain.gain.linearRampToValueAtTime(vol, ctx.currentTime + attack);
        gain.gain.linearRampToValueAtTime(vol * 0.7, ctx.currentTime + duration - decay);
        gain.gain.linearRampToValueAtTime(0, ctx.currentTime + duration);
        osc.connect(gain);
        gain.connect(sfxGain);
        osc.start(ctx.currentTime);
        osc.stop(ctx.currentTime + duration);
    }

    function playNoise(duration, vol = 0.1) {
        ensureCtx();
        const bufferSize = ctx.sampleRate * duration;
        const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
        const data = buffer.getChannelData(0);
        for (let i = 0; i < bufferSize; i++) {
            data[i] = (Math.random() * 2 - 1) * vol;
        }
        const source = ctx.createBufferSource();
        source.buffer = buffer;
        const gain = ctx.createGain();
        gain.gain.setValueAtTime(vol, ctx.currentTime);
        gain.gain.linearRampToValueAtTime(0, ctx.currentTime + duration);
        source.connect(gain);
        gain.connect(sfxGain);
        source.start();
    }

    // ── SOUND LIBRARY ────────────────────────────

    const sounds = {
        cardPlay() {
            // Snappy click
            playTone(800, 0.08, 'square', 0.15, 0.005, 0.03);
            playNoise(0.05, 0.08);
        },

        cardDraw() {
            // Swoosh
            ensureCtx();
            const osc = ctx.createOscillator();
            const gain = ctx.createGain();
            osc.type = 'sawtooth';
            osc.frequency.setValueAtTime(200, ctx.currentTime);
            osc.frequency.exponentialRampToValueAtTime(800, ctx.currentTime + 0.15);
            gain.gain.setValueAtTime(0.1, ctx.currentTime);
            gain.gain.linearRampToValueAtTime(0, ctx.currentTime + 0.2);
            osc.connect(gain);
            gain.connect(sfxGain);
            osc.start();
            osc.stop(ctx.currentTime + 0.2);
            playNoise(0.1, 0.05);
        },

        unoCall() {
            // Alarm buzz — two quick tones
            playTone(880, 0.12, 'square', 0.2);
            setTimeout(() => playTone(1100, 0.15, 'square', 0.25), 130);
        },

        skip() {
            // Descending whoosh
            ensureCtx();
            const osc = ctx.createOscillator();
            const gain = ctx.createGain();
            osc.type = 'triangle';
            osc.frequency.setValueAtTime(1000, ctx.currentTime);
            osc.frequency.exponentialRampToValueAtTime(200, ctx.currentTime + 0.25);
            gain.gain.setValueAtTime(0.15, ctx.currentTime);
            gain.gain.linearRampToValueAtTime(0, ctx.currentTime + 0.25);
            osc.connect(gain);
            gain.connect(sfxGain);
            osc.start();
            osc.stop(ctx.currentTime + 0.25);
        },

        reverse() {
            // Quick up-down sweep
            playTone(400, 0.1, 'triangle', 0.15);
            setTimeout(() => playTone(800, 0.1, 'triangle', 0.15), 100);
            setTimeout(() => playTone(400, 0.1, 'triangle', 0.15), 200);
        },

        drawPenalty() {
            // Negative tone — descending
            playTone(600, 0.15, 'sawtooth', 0.12);
            setTimeout(() => playTone(400, 0.2, 'sawtooth', 0.15), 150);
            setTimeout(() => playTone(250, 0.3, 'sawtooth', 0.12), 350);
        },

        win() {
            // Victory fanfare
            const notes = [523, 659, 784, 1047]; // C5, E5, G5, C6
            notes.forEach((f, i) => {
                setTimeout(() => playTone(f, 0.3, 'triangle', 0.2), i * 200);
            });
            setTimeout(() => playTone(1047, 0.6, 'sine', 0.25), 800);
        },

        lose() {
            // Sad trombone
            const notes = [392, 370, 349, 330];
            notes.forEach((f, i) => {
                setTimeout(() => playTone(f, 0.3, 'triangle', 0.15), i * 300);
            });
        },

        yourTurn() {
            // Soft ding
            playTone(880, 0.15, 'sine', 0.15);
            setTimeout(() => playTone(1320, 0.2, 'sine', 0.12), 100);
        },

        timerTick() {
            playTone(1000, 0.05, 'square', 0.1);
        },

        chatMsg() {
            // Pop
            playTone(600, 0.06, 'sine', 0.1);
            setTimeout(() => playTone(900, 0.04, 'sine', 0.08), 60);
        },

        error() {
            playTone(200, 0.2, 'square', 0.15);
        },

        joinRoom() {
            playTone(523, 0.1, 'sine', 0.12);
            setTimeout(() => playTone(659, 0.1, 'sine', 0.12), 100);
            setTimeout(() => playTone(784, 0.15, 'sine', 0.15), 200);
        },

        kick() {
            playTone(300, 0.15, 'sawtooth', 0.15);
            setTimeout(() => playTone(150, 0.3, 'sawtooth', 0.12), 150);
        },

        pause() {
            playTone(440, 0.15, 'triangle', 0.1);
            setTimeout(() => playTone(330, 0.2, 'triangle', 0.1), 150);
        },

        resume() {
            playTone(330, 0.15, 'triangle', 0.1);
            setTimeout(() => playTone(440, 0.2, 'triangle', 0.1), 150);
        },

        botPlay() {
            playTone(500, 0.08, 'sine', 0.08);
        }
    };

    // ── BACKGROUND MUSIC ─────────────────────────

    function startMusic() {
        if (musicPlaying) return;
        ensureCtx();
        musicPlaying = true;

        // Simple looping melody using oscillators
        const melody = [
            // [freq, duration, delay]
            [330, 0.4, 0],    // E4
            [392, 0.4, 0.5],  // G4
            [440, 0.4, 1.0],  // A4
            [392, 0.4, 1.5],  // G4
            [330, 0.4, 2.0],  // E4
            [294, 0.4, 2.5],  // D4
            [330, 0.6, 3.0],  // E4
            [262, 0.4, 3.7],  // C4
            [294, 0.4, 4.2],  // D4
            [330, 0.4, 4.7],  // E4
            [392, 0.4, 5.2],  // G4
            [440, 0.6, 5.7],  // A4
            [392, 0.4, 6.4],  // G4
            [330, 0.8, 6.9],  // E4
        ];

        const loopDuration = 8; // seconds

        function playLoop() {
            if (!musicPlaying) return;
            melody.forEach(([freq, dur, delay]) => {
                const osc = ctx.createOscillator();
                const gain = ctx.createGain();
                osc.type = 'sine';
                osc.frequency.value = freq;
                gain.gain.setValueAtTime(0, ctx.currentTime + delay);
                gain.gain.linearRampToValueAtTime(0.06, ctx.currentTime + delay + 0.05);
                gain.gain.setValueAtTime(0.06, ctx.currentTime + delay + dur - 0.1);
                gain.gain.linearRampToValueAtTime(0, ctx.currentTime + delay + dur);
                osc.connect(gain);
                gain.connect(musicGain);
                osc.start(ctx.currentTime + delay);
                osc.stop(ctx.currentTime + delay + dur);
                musicOscillators.push(osc);
            });

            // Pad/chord layer
            const chords = [
                [262, 330, 392], // C major
                [294, 370, 440], // D major
                [262, 330, 392], // C major
                [247, 311, 370], // B major
            ];
            chords.forEach((chord, i) => {
                chord.forEach(freq => {
                    const osc = ctx.createOscillator();
                    const gain = ctx.createGain();
                    osc.type = 'triangle';
                    osc.frequency.value = freq;
                    const start = i * 2;
                    gain.gain.setValueAtTime(0, ctx.currentTime + start);
                    gain.gain.linearRampToValueAtTime(0.02, ctx.currentTime + start + 0.2);
                    gain.gain.setValueAtTime(0.02, ctx.currentTime + start + 1.8);
                    gain.gain.linearRampToValueAtTime(0, ctx.currentTime + start + 2);
                    osc.connect(gain);
                    gain.connect(musicGain);
                    osc.start(ctx.currentTime + start);
                    osc.stop(ctx.currentTime + start + 2);
                    musicOscillators.push(osc);
                });
            });

            setTimeout(playLoop, loopDuration * 1000);
        }

        playLoop();
    }

    function stopMusic() {
        musicPlaying = false;
        musicOscillators.forEach(o => { try { o.stop(); } catch { } });
        musicOscillators = [];
    }

    // ── PUBLIC API ───────────────────────────────

    return {
        play(name) {
            const prefs = getPrefs();
            if (prefs.sfx === false) return;
            ensureCtx();
            if (sounds[name]) sounds[name]();
        },

        startMusic() {
            const prefs = getPrefs();
            if (prefs.music === false) return;
            startMusic();
        },

        stopMusic() {
            stopMusic();
        },

        toggleSfx() {
            const prefs = getPrefs();
            const on = prefs.sfx === false;
            savePrefs({ sfx: on });
            if (sfxGain) sfxGain.gain.value = on ? (prefs.volume ?? 0.5) : 0;
            return on;
        },

        toggleMusic() {
            const prefs = getPrefs();
            const on = prefs.music === false;
            savePrefs({ music: on });
            if (on) {
                if (musicGain) musicGain.gain.value = (prefs.volume ?? 0.3) * 0.4;
                startMusic();
            } else {
                stopMusic();
                if (musicGain) musicGain.gain.value = 0;
            }
            return on;
        },

        setVolume(v) {
            v = Math.max(0, Math.min(1, v));
            savePrefs({ volume: v });
            if (sfxGain) {
                const prefs = getPrefs();
                sfxGain.gain.value = prefs.sfx === false ? 0 : v;
            }
            if (musicGain) {
                const prefs = getPrefs();
                musicGain.gain.value = prefs.music === false ? 0 : v * 0.4;
            }
        },

        isSfxOn() { return getPrefs().sfx !== false; },
        isMusicOn() { return getPrefs().music !== false; },
        getVolume() { return getPrefs().volume ?? 0.5; },

        init() { ensureCtx(); }
    };
})();
