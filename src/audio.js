/**
 * audio.js — every sound in the game is synthesised, no files.
 *
 * The palette is deliberately dry: paper, wood, breath and plucked string.
 * One shared AudioContext, created on the first user gesture so autoplay
 * policies never block it.
 */

export function createAudio() {
  let ctx = null;
  let master = null;
  let muted = false;
  let noiseCache = null;
  let lastHit = 0;

  function ensure() {
    if (typeof window === 'undefined') return null;
    if (!ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return null;
      ctx = new AC();
      master = ctx.createGain();
      master.gain.value = 0.42;
      master.connect(ctx.destination);
    }
    if (ctx.state === 'suspended') ctx.resume();
    return ctx;
  }

  function noise() {
    if (noiseCache) return noiseCache;
    const len = Math.floor(ctx.sampleRate * 0.6);
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    noiseCache = buf;
    return buf;
  }

  /** A short pitched body with an exponential tail. */
  function tone({ freq = 220, to = null, type = 'sine', dur = 0.2, gain = 0.2, delay = 0, attack = 0.004 }) {
    if (!ensure() || muted) return;
    const t0 = ctx.currentTime + delay;
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t0);
    if (to !== null) osc.frequency.exponentialRampToValueAtTime(Math.max(20, to), t0 + dur);
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(gain, t0 + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    osc.connect(g).connect(master);
    osc.start(t0);
    osc.stop(t0 + dur + 0.02);
  }

  /** Filtered noise: paper, brushes, impacts. */
  function hiss({ dur = 0.12, gain = 0.14, freq = 1800, q = 1, type = 'bandpass', delay = 0, sweep = null }) {
    if (!ensure() || muted) return;
    const t0 = ctx.currentTime + delay;
    const src = ctx.createBufferSource();
    src.buffer = noise();
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.setValueAtTime(freq, t0);
    f.Q.value = q;
    if (sweep !== null) f.frequency.exponentialRampToValueAtTime(Math.max(60, sweep), t0 + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(gain, t0 + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    src.connect(f).connect(g).connect(master);
    src.start(t0);
    src.stop(t0 + dur + 0.02);
  }

  const api = {
    get muted() { return muted; },
    toggle() {
      muted = !muted;
      if (!muted) ensure();
      return muted;
    },
    unlock() { ensure(); },

    click() { hiss({ dur: 0.05, gain: 0.06, freq: 2400, q: 2 }); },
    buy() {
      hiss({ dur: 0.1, gain: 0.1, freq: 900, q: 1.4, sweep: 300 });
      tone({ freq: 520, to: 660, type: 'triangle', dur: 0.12, gain: 0.08 });
    },
    sell() {
      hiss({ dur: 0.16, gain: 0.1, freq: 700, q: 1, sweep: 180 });
      tone({ freq: 300, to: 180, type: 'triangle', dur: 0.16, gain: 0.07 });
    },
    place() { hiss({ dur: 0.07, gain: 0.09, freq: 420, q: 0.8, type: 'lowpass' }); },
    reroll() { hiss({ dur: 0.22, gain: 0.09, freq: 2600, q: 0.7, sweep: 900 }); },
    error() { tone({ freq: 160, to: 120, type: 'square', dur: 0.12, gain: 0.05 }); },

    cast() {
      hiss({ dur: 0.3, gain: 0.12, freq: 600, q: 0.8, sweep: 2600 });
      tone({ freq: 180, to: 90, type: 'sine', dur: 0.34, gain: 0.14 });
    },
    hit(power = 1) {
      const now = ctx ? ctx.currentTime : 0;
      if (now - lastHit < 0.045) return;
      lastHit = now;
      hiss({ dur: 0.06, gain: 0.05 * Math.min(1.4, power), freq: 1300, q: 1.6, sweep: 500 });
    },
    death() {
      hiss({ dur: 0.4, gain: 0.12, freq: 400, q: 0.6, sweep: 90 });
      tone({ freq: 120, to: 60, type: 'sine', dur: 0.5, gain: 0.1 });
    },
    win() {
      const notes = [523.25, 659.25, 783.99, 1046.5];
      notes.forEach((f, i) => tone({
        freq: f, type: 'triangle', dur: 0.5, gain: 0.09, delay: i * 0.09, attack: 0.006,
      }));
      hiss({ dur: 0.5, gain: 0.05, freq: 3200, q: 0.5 });
    },
    lose() {
      const notes = [392, 349.23, 293.66, 246.94];
      notes.forEach((f, i) => tone({
        freq: f, type: 'sine', dur: 0.7, gain: 0.1, delay: i * 0.12, attack: 0.01,
      }));
      tone({ freq: 98, to: 78, type: 'sine', dur: 1.1, gain: 0.08, delay: 0.1 });
    },
    boss() {
      tone({ freq: 70, to: 55, type: 'sine', dur: 1.4, gain: 0.16, attack: 0.02 });
      hiss({ dur: 1.2, gain: 0.07, freq: 220, q: 0.7, sweep: 80 });
    },
    start() {
      hiss({ dur: 0.25, gain: 0.1, freq: 800, q: 0.6, sweep: 2400 });
      tone({ freq: 220, to: 330, type: 'triangle', dur: 0.22, gain: 0.09 });
    },
  };

  return api;
}
