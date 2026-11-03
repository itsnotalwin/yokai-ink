/**
 * hex.js — pointy-top hex grid math on an odd-r offset layout.
 *
 * Storage uses offset coordinates {col,row} because they map directly onto the
 * 7x4 boards in the design. All distance/path maths convert to axial coordinates.
 *
 * Layout: rows are stacked 1.5*s apart, odd rows are shifted right by half a
 * hex, exactly like a TFT board.
 */

export const SQRT3 = Math.sqrt(3);

/** Convert offset (odd-r) to axial. */
export function toAxial(col, row) {
  const q = col - ((row - (row & 1)) >> 1);
  return { q, r: row };
}

/** Convert axial back to offset (odd-r). */
export function toOffset(q, r) {
  return { col: q + ((r - (r & 1)) >> 1), row: r };
}

const AXIAL_DIRS = [
  [+1, 0], [+1, -1], [0, -1], [-1, 0], [-1, +1], [0, +1],
];

/** The six neighbouring cells of an offset cell. */
export function neighbors(col, row) {
  const { q, r } = toAxial(col, row);
  const out = [];
  for (const [dq, dr] of AXIAL_DIRS) {
    out.push(toOffset(q + dq, r + dr));
  }
  return out;
}

/** Hex distance in cells. */
export function hexDistance(a, b) {
  const A = toAxial(a.col, a.row);
  const B = toAxial(b.col, b.row);
  const dx = A.q - B.q;
  const dz = A.r - B.r;
  const dy = -dx - dz;
  return Math.max(Math.abs(dx), Math.abs(dy), Math.abs(dz));
}

export const cellKey = (col, row) => col + ',' + row;

export function inBounds(col, row, cols, rows) {
  return col >= 0 && col < cols && row >= 0 && row < rows;
}

/**
 * Nearest cell in a set, by hex distance, ignoring a blocked set.
 * Used for "closest free cell" placement and path fallbacks.
 */
export function closestBy(list, target, score) {
  let best = null;
  let bestScore = Infinity;
  for (const item of list) {
    const s = score(item);
    if (s < bestScore) { bestScore = s; best = item; }
  }
  return best;
}

/** Render-space centre of a cell, in units of hex size (multiply by size). */
export function cellCenter(col, row) {
  return { x: SQRT3 * (col + (row & 1) * 0.5), y: 1.5 * row };
}

/** Euclidean distance between two render-space points. */
export function dist2(ax, ay, bx, by) {
  const dx = ax - bx, dy = ay - by;
  return dx * dx + dy * dy;
}

/**
 * Cells in a straight-ish line from a to b (used by beam abilities).
 * Walks the euclidean segment and samples cells, de-duplicated.
 */
export function lineCells(a, b) {
  const A = cellCenter(a.col, a.row);
  const B = cellCenter(b.col, b.row);
  const len = Math.hypot(B.x - A.x, B.y - A.y);
  const steps = Math.max(1, Math.round(len / 0.35));
  const seen = new Set();
  const out = [];
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    // cube-round the sampled point back to the nearest cell
    const cell = roundToCell(A.x + (B.x - A.x) * t, A.y + (B.y - A.y) * t);
    const k = cellKey(cell.col, cell.row);
    if (!seen.has(k)) { seen.add(k); out.push(cell); }
  }
  return out;
}

/** Inverse of cellCenter: nearest cell to a render-space point. */
export function roundToCell(x, y) {
  const row = Math.round(y / 1.5);
  const col = Math.round((x - SQRT3 * 0.5 * (row & 1)) / SQRT3);
  return { col, row };
}

/**
 * Breadth-first search over the grid.
 *
 * Returns { dist: Map<key,{col,row,steps,prev}>, start } covering every cell
 * reachable from `start` without stepping onto a blocked cell. Callers then
 * pick a goal cell out of it. O(cells) per call, which is trivial at 7x8.
 */
export function bfs(start, cols, rows, isBlocked) {
  const startKey = cellKey(start.col, start.row);
  const dist = new Map();
  dist.set(startKey, { col: start.col, row: start.row, steps: 0, prev: null });
  const queue = [{ col: start.col, row: start.row }];
  for (let head = 0; head < queue.length; head++) {
    const cur = queue[head];
    const curNode = dist.get(cellKey(cur.col, cur.row));
    for (const n of neighbors(cur.col, cur.row)) {
      if (!inBounds(n.col, n.row, cols, rows)) continue;
      const k = cellKey(n.col, n.row);
      if (dist.has(k)) continue;
      if (isBlocked(n.col, n.row, k)) continue;
      dist.set(k, { col: n.col, row: n.row, steps: curNode.steps + 1, prev: curNode });
      queue.push(n);
    }
  }
  return dist;
}

/**
 * First step of the path stored in a BFS node.
 * Returns null when the goal *is* the start cell.
 */
export function firstStepOf(node) {
  if (!node || !node.prev) return null;   // the goal is the start cell: no step
  let cur = node;
  // Walk back to the neighbour of the start (the node whose parent is the root).
  while (cur.prev && cur.prev.prev) cur = cur.prev;
  return { col: cur.col, row: cur.row };
}
