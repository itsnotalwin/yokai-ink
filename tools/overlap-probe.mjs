import { newRun, startCombat } from '../src/state.js';
import { stepCombat } from '../src/combat.js';
import { botPrep } from './tune.mjs';

function cellOf(u) {
  return u.step ? { col: u.step.col, row: u.step.row } : { col: u.col, row: u.row };
}

for (let round = 1; round <= 9; round++) {
  for (let r = 0; r < 40; r++) {
    const state = newRun(1000 + r * 37);
    state.round = round;
    for (let played = 1; played < round; played++) { state.gold += 5; botPrep(state); state.gold += 1; }
    state.gold += 5; botPrep(state);
    if (!startCombat(state)) continue;
    const sim = state.combat;
    let ticks = 0;
    while (!sim.over && ticks++ < 60 * 45) {
      stepCombat(sim);
      const seen = new Map();
      for (const u of sim.units) {
        if (!u.alive) continue;
        const c = cellOf(u);
        const k = c.col + ',' + c.row;
        if (seen.has(k)) {
          const a = seen.get(k);
          console.log('OVERLAP round', round, 'seed', r, 't', sim.t.toFixed(2), 'cell', k);
          for (const v of [a, u]) {
            console.log('  ', v.uid, v.side, v.defId, 'col/row', v.col, v.row,
              'cell()', JSON.stringify(cellOf(v)), 'step', v.step ? `${v.step.col},${v.step.row} knock=${!!v.step.knock}` : null,
              'occHas', sim.occ.get(cellKeySafe(v)));
          }
          process.exit(0);
        }
        seen.set(k, u);
      }
    }
  }
}
console.log('no overlap in sweep');

function cellKeySafe(u) { const c = cellOf(u); return c.col + ',' + c.row; }
