/**
 * state.js — the run: HP, gold, rounds, phases, and the bridge to combat.
 *
 * Phases: 'prep' -> 'combat' -> 'result' -> 'prep' ... -> 'gameover' | 'victory'
 */

import { CFG, interestFor } from './config.js';
import { makeRng, mixSeed } from './rng.js';
import { createPool, rollShop } from './shop.js';
import { playerBoardForCombat, countOnBoard } from './board.js';
import { buildEnemyBoard, isBossRound, planFor } from './ai.js';
import { DEFAULT_DIFFICULTY, difficultyScale } from './data/difficulty.js';
import { createCombat, stepCombat, combatResult } from './combat.js';

export function newRun(seed = CFG.seed) {
  const state = {
    runSeed: seed >>> 0,
    shopRng: makeRng(mixSeed(seed >>> 0, 0x1234)),

    hp: CFG.startHp,
    gold: CFG.startGold,
    round: 1,
    phase: 'prep',          // prep | combat | result | gameover | victory
    speed: 1,               // 1x / 2x / 4x
    difficulty: DEFAULT_DIFFICULTY,
    acc: 0,                 // fixed-timestep accumulator

    pool: createPool(),
    shop: [],
    units: [],
    nextUid: 1,

    combat: null,
    result: null,
    lastResult: null,
    history: [],
    log: [],
    toast: null,            // {text, kind, until}
    stats: { roundsWon: 0, roundsLost: 0, damageDealt: 0, goldSpent: 0, goldEarned: 0 },
    startedAt: Date.now(),
  };
  rollShop(state, state.shopRng);
  logMsg(state, 'A run begins. Summon your yokai.', 'ink');
  return state;
}

export function logMsg(state, text, kind = 'ink') {
  state.log.push({ text, kind });
  if (state.log.length > 60) state.log.shift();
}

export function toast(state, text, kind = 'ink') {
  state.toast = { text, kind, at: Date.now() };
}

export function capForRoundNow(state) {
  return Math.min(CFG.unitCapBase + state.round, CFG.unitCapMax);
}

/** Income for the next round. Interest is computed on the bank before income. */
export function gainIncome(state, won) {
  const interest = interestFor(state.gold);
  const base = CFG.incomeBase;
  const bonus = won ? CFG.winBonus : 0;
  const total = base + interest + bonus;
  state.gold += total;
  state.stats.goldEarned += total;
  return { base, interest, bonus, total };
}

/**
 * Begin the fight. Requires at least one unit on the board.
 */
export function startCombat(state) {
  if (state.phase !== 'prep') return { ok: false, reason: 'Not in prep.' };
  const playerUnits = playerBoardForCombat(state);
  if (playerUnits.length === 0) return { ok: false, reason: 'Place at least one yokai on the board.' };

  // The preset multiplies the fitted per-round scale rather than replacing it,
  // so every difficulty keeps the shape of the balance curve.
  const plan = planFor(state.round);
  const enemyUnits = buildEnemyBoard(state.round, {
    scale: (plan.scale === undefined ? 1 : plan.scale) * difficultyScale(state.difficulty),
  });
  const seed = mixSeed(state.runSeed, state.round * 104729 + 17);

  state.combat = createCombat({
    playerUnits, enemyUnits, seed, round: state.round,
  });
  state.phase = 'combat';
  state.acc = 0;
  logMsg(state, `Round ${state.round}: ${isBossRound(state.round) ? 'the Boss stirs.' : 'combat begins.'}`, 'combat');
  return { ok: true };
}

/**
 * Advance the sim in fixed steps. Returns true on the frame combat ended.
 */
export function updateCombat(state, dt) {
  if (state.phase !== 'combat' || !state.combat) return false;
  const sim = state.combat;
  state.acc += Math.min(dt, 0.1) * state.speed;
  const step = 1 / CFG.tickHz;
  let guard = 0;
  while (state.acc >= step && !sim.over && guard < 600) {
    stepCombat(sim);
    state.acc -= step;
    guard++;
  }
  if (sim.over) {
    finishCombat(state);
    return true;
  }
  return false;
}

export function finishCombat(state) {
  const sim = state.combat;
  const res = combatResult(sim);
  let damage = 0;
  if (res.winner === 'enemy') {
    damage = CFG.lossDamageBase + res.survivorCount;
    state.hp = Math.max(0, state.hp - damage);
    state.stats.roundsLost += 1;
    logMsg(state, `Defeat. You bleed ${damage} ink.`, 'loss');
  } else {
    state.stats.roundsWon += 1;
    logMsg(state, 'Victory. The board is yours.', 'win');
  }
  state.stats.damageDealt += res.playerStats.damage;

  const record = {
    round: state.round,
    winner: res.winner,
    damage,
    duration: res.duration,
    timeout: res.timeout,
    survivors: res.survivorCount,
  };
  state.result = record;
  state.lastResult = record;
  state.history.push(record);

  if (state.hp <= 0) state.phase = 'gameover';
  else if (res.winner === 'player' && isBossRound(state.round)) state.phase = 'victory';
  else state.phase = 'result';
}

/** Leave the result screen: pay income, deal a new shop, next round. */
export function continueRun(state) {
  if (state.phase !== 'result') return { ok: false };
  const won = state.result && state.result.winner === 'player';
  const inc = gainIncome(state, won);
  state.round += 1;
  rollShop(state, state.shopRng);
  state.phase = 'prep';
  state.combat = null;
  state.result = null;
  state.acc = 0;
  logMsg(state, `+${inc.total} gold (${inc.base} base, ${inc.interest} interest${inc.bonus ? `, +${inc.bonus} win` : ''}).`, 'gold');
  return { ok: true, income: inc };
}

export function setSpeed(state, speed) {
  state.speed = speed;
}

export { countOnBoard };
