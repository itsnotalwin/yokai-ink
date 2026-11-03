/**
 * rng.js — small deterministic PRNG (mulberry32).
 *
 * The combat simulation must be reproducible: same seed + same board must give
 * the same fight, otherwise "2x speed" could change the outcome. Every random
 * decision inside the sim draws from one of these, never from Math.random.
 */

export function makeRng(seed) {
  let a = seed >>> 0;
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), 1 | t);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return {
    /** float in [0,1) */
    next,
    /** integer in [0,n) */
    int: (n) => Math.floor(next() * n),
    /** float in [a,b) */
    range: (a, b) => a + next() * (b - a),
    /** true with probability p */
    chance: (p) => next() < p,
    /** random element of an array (or undefined if empty) */
    pick: (arr) => (arr.length ? arr[Math.floor(next() * arr.length)] : undefined),
    /** Fisher-Yates in place */
    shuffle: (arr) => {
      for (let i = arr.length - 1; i > 0; i--) {
        const j = Math.floor(next() * (i + 1));
        const tmp = arr[i]; arr[i] = arr[j]; arr[j] = tmp;
      }
      return arr;
    },
    state: () => a,
  };
}

/** Mix two integers into a new seed (used to derive per-combat streams). */
export function mixSeed(a, b) {
  let h = (a >>> 0) ^ Math.imul(b >>> 0, 0x9e3779b1);
  h = Math.imul(h ^ (h >>> 16), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return (h ^ (h >>> 16)) >>> 0;
}
