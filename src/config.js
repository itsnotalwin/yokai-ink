/**
 * config.js — every tunable number in one place.
 *
 * The roadmap's economy is labelled "draft, tune later", so the numbers that
 * differ from the draft are marked DEVIATION and explained in README.md.
 */

export const CFG = {
  // ---- board shape -------------------------------------------------------
  cols: 7,
  rows: 8,          // 4 enemy rows (0..3) + 4 player rows (4..7)
  benchSize: 8,
  shopSize: 5,

  // ---- run structure -----------------------------------------------------
  startHp: 100,
  startGold: 5,
  rounds: 8,          // rounds 1..8, then the boss round
  bossRound: 9,

  // ---- economy (draft from roadmap) --------------------------------------
  incomeBase: 5,
  interestPer: 10,    // 1 gold per 10 banked
  interestMax: 5,
  rerollCost: 2,
  // DEVIATION: +1 gold for a win. The draft has no reward for winning, which
  // makes a win streak economically pointless. Set to 0 for strict draft rules.
  winBonus: 1,

  // ---- combat ------------------------------------------------------------
  unitCapBase: 2,     // cap = round + 2, max 8
  unitCapMax: 8,
  tickHz: 60,
  // Global health multiplier. Lowering it shortens every fight without
  // touching relative unit power (both sides scale), which is what keeps a
  // 1v1 from turning into a 40-second slap fight. See tools/pace.mjs.
  hpScale: 0.55,
  // Fraction of the mana bar every unit starts with, so the opening is not
  // twenty seconds of auto-attacks.
  manaHeadStart: 0.45,
  // Units close the gap a little faster than their listed move speed, so more
  // of a short fight is spent trading blows instead of walking.
  moveSpeedScale: 1.25,
  combatTimeout: 40,  // seconds of simulated time before a decision
  lossDamageBase: 2,  // + surviving enemy units

  // ---- presentation ------------------------------------------------------
  logicalW: 1600,
  logicalH: 1000,
  seed: 0x5eed1e,     // base seed; the run mixes in per-combat counters
};

/** Unit cap for a given round (1-indexed). */
export function unitCapForRound(round) {
  return Math.min(CFG.unitCapBase + round, CFG.unitCapMax);
}

/** Gold-interest bonus for a bank size. */
export function interestFor(gold) {
  return Math.min(Math.floor(gold / CFG.interestPer), CFG.interestMax);
}
