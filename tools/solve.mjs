/**
 * tools/solve.mjs — fit the ladder's stage pressure to a target difficulty curve.
 *
 * 1. Play N runs with the greedy bot and snapshot the player's board on the way
 *    into every round.
 * 2. For each round, binary-search `scale` (enemy hp/attack multiplier) until
 *    the win rate against those real boards matches the target for that round.
 * 3. Print the resulting table, ready to paste into src/data/ladder.js.
 *
 *   node tools/solve.mjs [runs]
 */
import { CFG } from '../src/config.js';
import { newRun, startCombat, finishCombat, continueRun } from '../src/state.js';
import { playerBoardForCombat } from '../src/board.js';
import { createCombat, runCombat } from '../src/combat.js';
import { buildEnemyBoard, planFor } from '../src/ai.js';
import { LADDER } from '../src/data/ladder.js';
import { botPrep } from './tune.mjs';

/** Win rate we want a competent-but-not-optimal player to have, per round. */
export const TARGETS = { 1: 1.0, 2: 1.0, 3: 0.96, 4: 0.92, 5: 0.86, 6: 0.79, 7: 0.7, 8: 0.58, 9: 0.35 };

function sampleStates(runs) {
  const perRound = {};
  for (let run = 0; run < runs; run++) {
    const state = newRun(9000 + run * 37);
    let guard = 0;
    while (state.phase !== 'gameover' && state.phase !== 'victory' && guard++ < 30) {
      botPrep(state);
      const round = state.round;
      const playerUnits = playerBoardForCombat(state);
      (perRound[round] ||= []).push({ playerUnits, seed: 7000 + run * 131 + round });
      if (!startCombat(state).ok) break;
      runCombat(state.combat);
      finishCombat(state);
      if (state.phase === 'result') continueRun(state);
    }
  }
  return perRound;
}

function winRate(samples, round, scale) {
  let wins = 0;
  for (const s of samples) {
    const enemyUnits = buildEnemyBoard(round, { scale });
    const sim = createCombat({ playerUnits: s.playerUnits, enemyUnits, seed: s.seed, round });
    runCombat(sim);
    if (sim.winner === 'player') wins++;
  }
  return wins / samples.length;
}

const runs = Number(process.argv[2] || 60);
console.log(`sampling ${runs} runs...`);
const states = sampleStates(runs);

const out = {};
for (let r = 1; r <= CFG.bossRound; r++) {
  const samples = states[r] || [];
  if (!samples.length) { out[r] = LADDER[r].scale; continue; }
  const target = TARGETS[r];
  let lo = 0.4, hi = 1.6;
  // win rate falls as scale rises: binary search the crossing.
  for (let i = 0; i < 9; i++) {
    const mid = (lo + hi) / 2;
    const wr = winRate(samples, r, mid);
    if (wr > target) lo = mid; else hi = mid;
  }
  const scale = Math.round(((lo + hi) / 2) * 100) / 100;
  const wr = winRate(samples, r, scale);
  const plan = planFor(r, { scale });
  out[r] = scale;
  console.log(`round ${r}: scale ${scale.toFixed(2)}  win ${(wr * 100).toFixed(0)}%  ` +
    `spent ${plan.spent}  units ${plan.squad.map((u) => u.defId + u.star).join(',')}`);
}

console.log('\nLADDER scales:');
for (let r = 1; r <= CFG.bossRound; r++) {
  console.log(`  ${r}: { name: ${JSON.stringify(LADDER[r].name)}, scale: ${out[r]} },`);
}
