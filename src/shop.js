/**
 * shop.js — the shared unit pool, the 5-slot shop, buying, selling, merging.
 *
 * The pool is finite: shown units are reserved (removed) until they are bought
 * or the shop is rerolled. That makes copies contested and stops infinite
 * rerolling from producing a 3-star of everything.
 */

import { CFG } from './config.js';
import { UNIT_BY_ID, UNITS, sellValue, copiesOfStar } from './data/units.js';
import { POOL_COPIES, oddsForRound } from './data/odds.js';
import {
  createUnit, freeBenchIndex, countOnBoard, capForRound, unitInBench, autoPlace, toBench, removeUnit,
} from './board.js';

/** Build a full pool: one entry per copy of every unit. */
export function createPool() {
  const pool = {};
  for (const def of UNITS) pool[def.id] = POOL_COPIES[def.cost];
  return pool;
}

function totalInPool(pool) {
  let n = 0;
  for (const k in pool) n += pool[k];
  return n;
}

/** Push the current shop back into the pool (before a reroll). */
export function returnShopToPool(state) {
  for (let i = 0; i < state.shop.length; i++) {
    const id = state.shop[i];
    if (id) { state.pool[id] = (state.pool[id] || 0) + 1; state.shop[i] = null; }
  }
}

/** Pick a cost tier from the round odds. */
function rollCost(odds, rng) {
  const roll = rng.next() * 100;
  let acc = 0;
  for (let i = 0; i < odds.length; i++) {
    acc += odds[i];
    if (roll < acc) return i + 1;
  }
  return 1;
}

/** Draw one unit id from the pool at a given cost, or null when exhausted. */
function drawOfCost(state, cost, rng) {
  const ids = Object.keys(state.pool).filter((id) => state.pool[id] > 0 && UNIT_BY_ID[id].cost === cost);
  if (!ids.length) return null;
  // Weight by remaining copies so a nearly-empty unit is rare, like TFT.
  const total = ids.reduce((a, id) => a + state.pool[id], 0);
  let roll = rng.next() * total;
  for (const id of ids) {
    roll -= state.pool[id];
    if (roll <= 0) return id;
  }
  return ids[ids.length - 1];
}

/**
 * Fill all five slots. Falls back to a cheaper tier when the rolled tier is
 * empty, so the shop never shows dead slots while the pool still has units.
 */
export function rollShop(state, rng) {
  returnShopToPool(state);
  const odds = oddsForRound(state.round);
  state.shop = new Array(CFG.shopSize).fill(null);
  for (let i = 0; i < CFG.shopSize; i++) {
    let id = null;
    let cost = rollCost(odds, rng);
    for (let tries = 0; tries < 4 && !id; tries++) {
      id = drawOfCost(state, cost, rng);
      if (!id) cost = Math.max(1, cost - 1);
    }
    if (!id && totalInPool(state.pool) > 0) {
      for (let c = 1; c <= 4 && !id; c++) id = drawOfCost(state, c, rng);
    }
    if (id) {
      state.shop[i] = id;
      state.pool[id] -= 1;
    }
  }
  return state.shop;
}

/** Reroll, paying the reroll cost. */
export function reroll(state, rng) {
  if (state.gold < CFG.rerollCost) return { ok: false, reason: 'Not enough gold to reroll.' };
  state.gold -= CFG.rerollCost;
  rollShop(state, rng);
  return { ok: true };
}

/**
 * Would buying this unit trigger a merge? Used to allow a purchase even when
 * bench and board are full, because the merge frees space.
 */
function mergeIsPossible(state, defId, star = 1) {
  return state.units.filter((u) => u.defId === defId && u.star === star).length >= 2;
}

/**
 * Buy shop slot `index`.
 * @returns {{ok:boolean, reason?:string, unit?:object, merges?:Array}}
 */
export function buySlot(state, index) {
  const defId = state.shop[index];
  if (!defId) return { ok: false, reason: 'Empty slot.' };
  const def = UNIT_BY_ID[defId];
  if (state.gold < def.cost) return { ok: false, reason: 'Not enough gold.' };

  const merging = mergeIsPossible(state, defId, 1);
  const space = freeBenchIndex(state) >= 0 || countOnBoard(state) < capForRound(state.round) || merging;
  if (!space) return { ok: false, reason: 'Bench and board are full.' };

  state.gold -= def.cost;
  state.shop[index] = null; // the copy was already reserved from the pool

  const unit = createUnit(state, defId, 1);
  state.units.push(unit);
  const placed = autoPlace(state, unit);
  if (!placed && !toBench(state, unit)) {
    // Should be unreachable because of the space check above.
    removeUnit(state, unit);
    state.gold += def.cost;
    state.pool[defId] += 1;
    return { ok: false, reason: 'No space.' };
  }

  const merges = mergeAll(state);
  return { ok: true, unit, merges };
}

/**
 * Combine every set of three identical (same unit, same star) copies, then
 * repeat so a 9th copy cascades 1★ -> 2★ -> 3★.
 * @returns {Array<{defId, star}>} the units created, for celebration effects.
 */
export function mergeAll(state) {
  const created = [];
  let changed = true;
  while (changed) {
    changed = false;
    const groups = new Map();
    for (const u of state.units) {
      if (u.star >= 3) continue;
      const k = u.defId + ':' + u.star;
      if (!groups.has(k)) groups.set(k, []);
      groups.get(k).push(u);
    }
    for (const list of groups.values()) {
      if (list.length < 3) continue;
      // Anchor on a board unit so the upgraded copy keeps its position.
      const trio = list.slice(0, 3);
      trio.sort((a, b) => (a.loc.type === 'board' ? 0 : 1) - (b.loc.type === 'board' ? 0 : 1));
      const anchor = trio[0];
      for (let i = 1; i < 3; i++) removeUnit(state, trio[i]);
      anchor.star += 1;
      created.push({ defId: anchor.defId, star: anchor.star });
      changed = true;
      break;
    }
  }
  return created;
}

/** Sell a unit back: refund its cost and return its copies to the pool. */
export function sell(state, unit) {
  if (!unit) return { ok: false };
  const def = UNIT_BY_ID[unit.defId];
  const refund = sellValue(def, unit.star);
  state.gold += refund;
  state.pool[unit.defId] = (state.pool[unit.defId] || 0) + copiesOfStar(unit.star);
  removeUnit(state, unit);
  return { ok: true, refund };
}

/** Total gold value of everything the player owns (for run stats). */
export function boardValue(state) {
  return state.units.reduce((a, u) => {
    const def = UNIT_BY_ID[u.defId];
    return a + def.cost * copiesOfStar(u.star);
  }, 0);
}

export { unitInBench };
