/**
 * main.js — boot, the frame loop, and the bridge between model and screen.
 *
 * The simulation advances in fixed 1/60s steps inside updateCombat(); this file
 * only supplies wall-clock delta, plays the right sound at the right moment,
 * and hands state + view to the renderer.
 */

import { newRun, updateCombat, toast } from './state.js';
import { createRenderer } from './render/render.js';
import { createUI } from './ui.js';
import { createAudio } from './audio.js';
import { readSave, restore, saveRun, clearSave } from './save.js';

const canvas = document.getElementById('game');
const renderer = createRenderer(canvas);
renderer.resize();

function seedFromLocation() {
  const m = /seed=(\d+)/.exec(location.search);
  if (m) return Number(m[1]) >>> 0;
  return (Math.random() * 0xffffffff) >>> 0;
}

// A run survives a refresh: only the preparation phase is ever persisted, so a
// reload always lands you in front of a shop, never inside a fight.
const saved = readSave();
let state = saved ? restore(saved, newRun) : newRun(seedFromLocation());
const resumed = !!saved;
const audio = createAudio();

const ui = createUI(canvas, {
  audio,
  getState: () => state,
  setState: (s) => { state = s; combatRef = null; prevPhase = s.phase; },
  seed: seedFromLocation,
});

if (resumed) toast(state, `Resumed · round ${state.round}`, 'ink');

let last = performance.now();
let prevPhase = state.phase;
let combatRef = null;
let eventsSeen = 0;
let deathsSeen = 0;

function syncCombatSounds() {
  const sim = state.combat;
  if (!sim) return;
  if (sim !== combatRef) {
    combatRef = sim;
    eventsSeen = 0;
    deathsSeen = 0;
  }
  // Ability casts are announced through sim.events.
  if (sim.events.length > eventsSeen) {
    const fresh = sim.events.slice(eventsSeen);
    eventsSeen = sim.events.length;
    if (fresh.length) audio.cast();
  }
  const deaths = sim.effects.reduce((n, fx) => n + (fx.type === 'death' ? 1 : 0), 0);
  if (deaths > deathsSeen) {
    deathsSeen = deaths;
    audio.death();
  }
}

function frame(now) {
  const dt = Math.min(0.05, Math.max(0, (now - last) / 1000));
  last = now;

  if (state.phase === 'combat') {
    updateCombat(state, dt);
    syncCombatSounds();
    if (state.phase !== 'combat') {
      combatRef = null;
      const won = state.phase === 'victory' || (state.result && state.result.winner === 'player');
      if (state.phase === 'gameover') audio.lose();
      else if (won) audio.win();
      else audio.lose();
    }
  }

  if (state.phase !== prevPhase) {
    prevPhase = state.phase;
    if (state.phase === 'prep') saveRun(state);
    // A finished run is not resumable; the next load should start clean.
    if (state.phase === 'gameover' || state.phase === 'victory') clearSave();
  }

  ui.update(dt);
  renderer.draw(state, ui.view);
  requestAnimationFrame(frame);
}

window.addEventListener('resize', () => renderer.resize());
window.addEventListener('blur', () => { last = performance.now(); });
// Buying, selling and placing all happen without a phase change, so the tab
// closing is the only chance to keep the last few seconds of preparation.
window.addEventListener('pagehide', () => saveRun(state));
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') saveRun(state);
});

// Expose a tiny handle for debugging in the console; harmless in production.
window.__yokai = {
  get state() { return state; },
  restart: () => { state = newRun(seedFromLocation()); combatRef = null; prevPhase = state.phase; saveRun(state); },
  save: () => saveRun(state),
  snapshot: () => readSave(),
};

requestAnimationFrame(frame);
