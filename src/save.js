/**
 * save.js — one run, kept in localStorage so a refresh is not a loss.
 *
 * Only the preparation phase is ever saved: a fight is deterministic from the
 * board, so storing a half-finished combat would mean storing a frame of it for
 * no benefit. Everything here is plain JSON, and every failure is silent —
 * storage can be full, disabled, or hostile (private mode), and none of that is
 * worth interrupting a game for.
 */

import { CFG } from './config.js';
import { DIFFICULTIES, DEFAULT_DIFFICULTY } from './data/difficulty.js';

const DIFFICULTY_IDS = DIFFICULTIES.map((d) => d.id);
import { makeRng } from './rng.js';
import { rollShop } from './shop.js';

export const SAVE_KEY = 'yokai-ink.run.v1';
const VERSION = 1;

function storage() {
  try {
    const s = window.localStorage;
    // Touch it: some browsers expose the object but throw on use.
    const probe = '__yokai_probe__';
    s.setItem(probe, '1');
    s.removeItem(probe);
    return s;
  } catch {
    return null;
  }
}

/** The parts of a run worth keeping. Anything derived is rebuilt on load. */
export function snapshot(state) {
  return {
    v: VERSION,
    at: Date.now(),
    runSeed: state.runSeed,
    rng: state.shopRng.state(),
    hp: state.hp,
    gold: state.gold,
    round: state.round,
    speed: state.speed,
    difficulty: state.difficulty || DEFAULT_DIFFICULTY,
    pool: state.pool,
    shop: state.shop,
    units: state.units.map((u) => ({
      uid: u.uid, defId: u.defId, star: u.star, loc: { ...u.loc },
    })),
    nextUid: state.nextUid,
    log: state.log.slice(-40),
    history: state.history,
    stats: state.stats,
    startedAt: state.startedAt,
  };
}

export function saveRun(state) {
  if (!state || state.phase !== 'prep') return false;
  const s = storage();
  if (!s) return false;
  try {
    s.setItem(SAVE_KEY, JSON.stringify(snapshot(state)));
    return true;
  } catch {
    return false;
  }
}

export function clearSave() {
  const s = storage();
  if (!s) return;
  try { s.removeItem(SAVE_KEY); } catch { /* ignore */ }
}

/** Returns a restorable record, or null when there is nothing usable. */
export function readSave() {
  const s = storage();
  if (!s) return null;
  let data = null;
  try {
    const raw = s.getItem(SAVE_KEY);
    if (!raw) return null;
    data = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!data || data.v !== VERSION || !Array.isArray(data.units) || !data.pool) return null;
  if (typeof data.round !== 'number' || data.round < 1 || data.round > CFG.bossRound) return null;
  return data;
}

export function hasSave() {
  return readSave() !== null;
}

/**
 * Rebuild a run from a snapshot. `makeRun` is injected so this module never has
 * to import state.js (which imports combat.js, which imports everything else).
 */
export function restore(data, makeRun) {
  const state = makeRun(data.runSeed >>> 0);
  state.round = data.round;
  state.hp = data.hp;
  state.gold = data.gold;
  state.speed = data.speed || 1;
  // Older saves predate presets; they load as Standard.
  state.difficulty = DIFFICULTY_IDS.indexOf(data.difficulty) >= 0 ? data.difficulty : DEFAULT_DIFFICULTY;
  state.pool = { ...state.pool, ...data.pool };
  state.units = data.units
    .filter((u) => u && typeof u.defId === 'string' && u.loc)
    .map((u) => ({ uid: u.uid, defId: u.defId, star: u.star | 0 || 1, loc: { ...u.loc } }));
  state.nextUid = Math.max(data.nextUid || 1, state.units.length + 1);
  state.log = Array.isArray(data.log) ? data.log.slice(-40) : state.log;
  state.history = Array.isArray(data.history) ? data.history : [];
  state.stats = { ...state.stats, ...(data.stats || {}) };
  state.startedAt = data.startedAt || Date.now();
  state.shopRng = makeRng((data.rng >>> 0) || 1);

  // The shop was drawn from the saved pool, so it is still valid as stored.
  const shop = Array.isArray(data.shop) ? data.shop.slice(0, CFG.shopSize) : [];
  while (shop.length < CFG.shopSize) shop.push(null);
  state.shop = shop.map((id) => (typeof id === 'string' ? id : null));

  state.phase = 'prep';
  state.combat = null;
  state.result = null;
  state.acc = 0;
  return state;
}

/** Human-readable "round 4 · 82 ink" for the resume toast. */
export function describeSave() {
  const d = readSave();
  if (!d) return '';
  return `Round ${d.round} · ${d.hp} ink`;
}

/** A fresh shop for a restored run whose pool drifted (cheap safety net). */
export function repairShop(state) {
  const bad = state.shop.some((id) => id && !(id in state.pool));
  if (bad) rollShop(state, state.shopRng);
  return state;
}
