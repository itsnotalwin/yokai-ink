/**
 * tools/presets.mjs — measure each difficulty preset with the greedy bot.
 *
 * The presets are one multiplier on enemy health and attack, so the fitted
 * curve shifts instead of breaking. This prints how far it shifts:
 *
 *   node tools/presets.mjs [runs]
 */
import { pathToFileURL } from 'node:url';
import { CFG } from '../src/config.js';
import { newRun, startCombat, finishCombat, continueRun } from '../src/state.js';
import { runCombat } from '../src/combat.js';
import { DIFFICULTIES } from '../src/data/difficulty.js';
import { botPrep } from './tune.mjs';

export function sweepPreset(preset, runs = 40) {
  const per = {};
  let cleared = 0;
  let broke = 0;
  for (let run = 0; run < runs; run++) {
    const state = newRun(7000 + run * 53);
    state.difficulty = preset;
    let guard = 0;
    while (state.phase !== 'gameover' && state.phase !== 'victory' && guard++ < 30) {
      botPrep(state);
      if (!startCombat(state).ok) break;
      const round = state.round;
      runCombat(state.combat);
      finishCombat(state);
      const rec = state.result;
      per[round] ||= { n: 0, w: 0, dur: 0 };
      per[round].n++;
      if (rec.winner === 'player') per[round].w++;
      per[round].dur += rec.duration;
      if (state.phase === 'result') continueRun(state);
    }
    if (state.phase === 'victory') cleared++;
    else broke++;
  }
  const rows = [];
  for (let r = 1; r <= CFG.bossRound; r++) {
    const d = per[r];
    if (!d) continue;
    rows.push({
      round: r,
      fights: d.n,
      win: Math.round((d.w / d.n) * 100) + '%',
      avgDur: (d.dur / d.n).toFixed(1) + 's',
    });
  }
  return { rows, cleared, broke, runs };
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  const runs = Number(process.argv[2]) || 40;
  for (const d of DIFFICULTIES) {
    const res = sweepPreset(d.id, runs);
    console.log(`\n${d.name}  (enemy stats x${d.scale}) — runs ${res.runs}, cleared ${res.cleared}, broke down ${res.broke}`);
    console.table(res.rows);
  }
}
