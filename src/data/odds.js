/**
 * data/odds.js — shop odds, pool sizes, star scaling of the shop.
 */

/** Chance (percent) of each cost appearing, by round. Deeper rounds lean expensive. */
export const SHOP_ODDS = {
  1: [100, 0, 0, 0],
  2: [100, 0, 0, 0],
  3: [75, 25, 0, 0],
  4: [55, 35, 10, 0],
  5: [40, 40, 18, 2],
  6: [30, 38, 25, 7],
  7: [22, 32, 33, 13],
  8: [15, 25, 40, 20],
  9: [10, 20, 45, 25],
};

/** How many copies of each distinct unit exist in the shared pool. */
export const POOL_COPIES = { 1: 26, 2: 18, 3: 12, 4: 9 };

/** Odds row for a round, clamped to the table. */
export function oddsForRound(round) {
  const r = Math.max(1, Math.min(round, 9));
  return SHOP_ODDS[r];
}
