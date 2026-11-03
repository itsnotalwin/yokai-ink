/**
 * board.js — the spatial model of a run: which unit sits in which cell or
 * bench slot, what placement is legal, and how swaps work.
 *
 * Coordinates: rows 0..3 are the enemy half (top), rows 4..7 the player half
 * (bottom). The player may only place units in rows >= 4.
 */

import { CFG, unitCapForRound } from './config.js';
import { UNIT_BY_ID } from './data/units.js';
import { cellKey } from './hex.js';

export const PLAYER_ROW_MIN = 4;
export const PLAYER_ROW_MAX = 7;

/** Fresh unit instance owned by the player. */
export function createUnit(state, defId, star = 1) {
  const def = UNIT_BY_ID[defId];
  if (!def) throw new Error('unknown unit ' + defId);
  return {
    uid: 'u' + state.nextUid++,
    defId,
    star,
    loc: { type: 'bench', index: -1 },
  };
}

export function boardUnits(state) {
  return state.units.filter((u) => u.loc.type === 'board');
}

export function benchUnits(state) {
  return state.units.filter((u) => u.loc.type === 'bench');
}

export function unitAt(state, col, row) {
  return state.units.find((u) => u.loc.type === 'board' && u.loc.col === col && u.loc.row === row) || null;
}

export function unitInBench(state, index) {
  return state.units.find((u) => u.loc.type === 'bench' && u.loc.index === index) || null;
}

export function countOnBoard(state) {
  return boardUnits(state).length;
}

export function capForRound(round) {
  return unitCapForRound(round);
}

export function isPlayerCell(col, row) {
  return row >= PLAYER_ROW_MIN && row <= PLAYER_ROW_MAX && col >= 0 && col < CFG.cols;
}

export function freeBenchIndex(state) {
  for (let i = 0; i < CFG.benchSize; i++) if (!unitInBench(state, i)) return i;
  return -1;
}

/** Put a unit in the first free bench slot. Returns false when full. */
export function toBench(state, unit) {
  const idx = freeBenchIndex(state);
  if (idx < 0) return false;
  unit.loc = { type: 'bench', index: idx };
  return true;
}

/** Remove a unit from the run entirely (already refunded by the caller). */
export function removeUnit(state, unit) {
  const i = state.units.indexOf(unit);
  if (i >= 0) state.units.splice(i, 1);
}

/**
 * Move a unit onto a board cell. If the target holds another unit they swap,
 * which is what a drag onto an occupied hex should feel like.
 * Returns {ok, swappedWith}.
 */
export function placeOnBoard(state, unit, col, row) {
  if (!isPlayerCell(col, row)) return { ok: false, reason: 'Not your half of the board.' };
  const occupant = unitAt(state, col, row);
  if (occupant && occupant.uid === unit.uid) return { ok: true, swappedWith: null };

  // Cap only limits *additions*, so a swap or a drag from the board is always legal.
  const comingFromBoard = unit.loc.type === 'board';
  if (!occupant && !comingFromBoard && countOnBoard(state) >= capForRound(state.round)) {
    return { ok: false, reason: `Board is full (${capForRound(state.round)} units this round).` };
  }

  const from = { ...unit.loc };
  if (occupant) {
    if (from.type === 'bench') {
      occupant.loc = { type: 'bench', index: from.index };
    } else {
      occupant.loc = { type: 'board', col: from.col, row: from.row };
    }
  } else if (from.type === 'board') {
    // Moving to an empty cell: nothing to vacate, the assignment below covers it.
  }
  unit.loc = { type: 'board', col, row };
  return { ok: true, swappedWith: occupant };
}

/** Move a unit to a bench slot, swapping with whoever is there. */
export function placeOnBench(state, unit, index) {
  if (index < 0 || index >= CFG.benchSize) return { ok: false };
  const occupant = unitInBench(state, index);
  if (occupant && occupant.uid === unit.uid) return { ok: true };
  const from = { ...unit.loc };
  if (occupant) {
    if (from.type === 'board') occupant.loc = { type: 'board', col: from.col, row: from.row };
    else occupant.loc = { type: 'bench', index: from.index };
  }
  unit.loc = { type: 'bench', index };
  return { ok: true, swappedWith: occupant };
}

/** Column preference: middle first, then outward. */
const COL_PREF = [3, 2, 4, 1, 5, 0, 6];

/**
 * Auto-place a freshly bought unit: melee toward the front row, ranged toward
 * the back. Returns true when it landed on the board.
 */
export function autoPlace(state, unit) {
  if (countOnBoard(state) >= capForRound(state.round)) return false;
  const def = UNIT_BY_ID[unit.defId];
  const melee = def.range <= 1;
  const rows = melee ? [4, 5, 6, 7] : [7, 6, 5, 4];
  for (const row of rows) {
    for (const col of COL_PREF) {
      if (!unitAt(state, col, row)) {
        unit.loc = { type: 'board', col, row };
        return true;
      }
    }
  }
  return false;
}

/** Board snapshot for the combat simulation, in absolute cell coordinates. */
export function playerBoardForCombat(state) {
  return boardUnits(state).map((u) => ({
    defId: u.defId,
    star: u.star,
    col: u.loc.col,
    row: u.loc.row,
  }));
}

export function keyFor(col, row) {
  return cellKey(col, row);
}
