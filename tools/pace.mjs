/**
 * pace.mjs — how long do fights actually last, and do they feel eventful?
 *
 * Plays the greedy bot into every round of the ladder, runs each fight to
 * completion, and reports duration percentiles, timeout rate, how many
 * abilities fire, and when the first one lands. Use it before and after
 * touching combat numbers.
 *
 * Run: node tools/pace.mjs [runs]
 */

import { newRun, startCombat } from '../src/state.js';
import { runCombat } from '../src/combat.js';
import { botPrep } from './tune.mjs';

const RUNS = Number(process.argv[2] || 40);

function pct(list, p) {
  if (!list.length) return 0;
  const sorted = [...list].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))];
}

const rows = [];
for (let round = 1; round <= 9; round++) {
  const durations = [];
  const casts = [];
  const deaths = [];
  const firsts = [];
  let timeouts = 0;
  let wins = 0;
  let n = 0;

  for (let r = 0; r < RUNS; r++) {
    const state = newRun(1000 + r * 37);
    state.round = round;
    // Buy as though we had played the previous rounds.
    for (let played = 1; played < round; played++) {
      state.gold += 5;
      botPrep(state);
      state.gold += 1;
    }
    state.gold += 5;
    botPrep(state);
    if (!state.units.some((u) => u.loc && u.loc.kind !== 'bench' && u.loc.row !== undefined)) continue;
    if (!startCombat(state)) continue;
    const sim = state.combat;
    runCombat(sim);
    const castEvents = sim.events.filter((e) => / — /.test(e.text));
    n++;
    durations.push(sim.t);
    casts.push(castEvents.length);
    deaths.push(sim.events.filter((e) => / falls$/.test(e.text)).length);
    firsts.push(castEvents.length ? castEvents[0].t : sim.t);
    if (sim.timeout) timeouts++;
    if (sim.winner === 'player') wins++;
  }

  rows.push({
    round,
    n,
    med: pct(durations, 0.5),
    p90: pct(durations, 0.9),
    to: n ? timeouts / n : 0,
    casts: casts.reduce((a, b) => a + b, 0) / Math.max(1, n),
    first: pct(firsts, 0.5),
    deaths: deaths.reduce((a, b) => a + b, 0) / Math.max(1, n),
    win: n ? wins / n : 0,
  });
}

const f = (x, d = 1) => x.toFixed(d).padStart(5);
console.log('round   n   med    p90  timeout  casts  first  deaths   win');
for (const r of rows) {
  console.log(
    `${String(r.round).padStart(5)} ${String(r.n).padStart(3)}  ${f(r.med)}  ${f(r.p90)}   ${f(r.to * 100, 0)}%   ${f(r.casts)}   ${f(r.first)}   ${f(r.deaths)}   ${f(r.win * 100, 0)}%`,
  );
}
const allMed = rows.map((r) => r.med);
const allTo = rows.reduce((a, r) => a + r.to, 0) / rows.length;
const allFirst = rows.reduce((a, r) => a + r.first, 0) / rows.length;
console.log(`\nmedian fight ${(allMed.reduce((a, b) => a + b, 0) / rows.length).toFixed(1)}s · timeout ${(allTo * 100).toFixed(0)}% · first cast at ${allFirst.toFixed(1)}s`);
