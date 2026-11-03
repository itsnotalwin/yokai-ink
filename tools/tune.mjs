/**
 * tools/tune.mjs — measure the difficulty curve with the greedy bot.
 *
 * Prints, per round: fights, win rate, average player board value at the start
 * of the fight, and average enemy squad value. Budgets can be overridden on the
 * command line so the ladder can be swept without editing source:
 *
 *   node tools/tune.mjs                     # 80 runs, ladder as authored
 *   node tools/tune.mjs 80 5=24 6=30        # override round budgets
 */
import { pathToFileURL } from 'node:url';
import { CFG } from '../src/config.js';import { newRun, startCombat, finishCombat, continueRun } from '../src/state.js';
import { buySlot, reroll } from '../src/shop.js';
import { countOnBoard, capForRound, freeBenchIndex, unitInBench, autoPlace } from '../src/board.js';
import { runCombat } from '../src/combat.js';
import { buildEnemyBoard, squadValue } from '../src/ai.js';
import { UNIT_BY_ID } from '../src/data/units.js';
import { LADDER } from '../src/data/ladder.js';

export function botPrep(state) {
  let guard = 0;
  while (guard++ < 40) {
    let bought = false;
    const order = state.shop.map((id, i) => ({ id, i })).filter((s) => s.id)
      .sort((a, b) => {
        const ownA = state.units.filter((u) => u.defId === a.id).length;
        const ownB = state.units.filter((u) => u.defId === b.id).length;
        if (ownA !== ownB) return ownB - ownA;
        return UNIT_BY_ID[a.id].cost - UNIT_BY_ID[b.id].cost;
      });
    for (const s of order) {
      const cost = UNIT_BY_ID[s.id].cost;
      const merging = state.units.filter((u) => u.defId === s.id && u.star === 1).length >= 2;
      const space = freeBenchIndex(state) >= 0 || countOnBoard(state) < capForRound(state.round) || merging;
      if (cost <= state.gold && space && buySlot(state, s.i).ok) bought = true;
    }
    if (!bought) break;
  }
  for (let i = 0; i < CFG.benchSize; i++) {
    const u = unitInBench(state, i);
    if (!u) continue;
    if (countOnBoard(state) >= capForRound(state.round)) break;
    autoPlace(state, u);
  }
  let rerolls = 0;
  while (state.gold >= 8 && rerolls < 4) {
    if (!reroll(state, state.shopRng).ok) break;
    rerolls++;
    for (let i = 0; i < state.shop.length; i++) {
      const id = state.shop[i];
      if (!id) continue;
      const space = freeBenchIndex(state) >= 0 || countOnBoard(state) < capForRound(state.round)
        || state.units.filter((u) => u.defId === id && u.star === 1).length >= 2;
      if (UNIT_BY_ID[id].cost <= state.gold && space) buySlot(state, i);
    }
  }
}

export function boardValue(state) {
  return state.units.filter((u) => u.loc.type === 'board')
    .reduce((a, u) => a + UNIT_BY_ID[u.defId].cost * Math.pow(3, u.star - 1), 0);
}

export function sweep(runs = 60, verbose = false) {
  const per = {};
  for (let run = 0; run < runs; run++) {
    const state = newRun(9000 + run * 37);
    let guard = 0;
    while (state.phase !== 'gameover' && state.phase !== 'victory' && guard++ < 30) {
      botPrep(state);
      if (!startCombat(state).ok) break;
      const round = state.round;
      const pv = boardValue(state);
      const ev = squadValue(buildEnemyBoard(round));
      runCombat(state.combat);
      finishCombat(state);
      const rec = state.result;
      per[round] ||= { n: 0, w: 0, pv: 0, ev: 0, lost: 0, dmg: 0 };
      per[round].n++;
      if (rec.winner === 'player') per[round].w++;
      else per[round].lost++;
      per[round].pv += pv;
      per[round].ev += ev;
      per[round].dmg += rec.damage;
      if (state.phase === 'result') continueRun(state);
    }
  }
  const rows = [];
  for (let r = 1; r <= CFG.bossRound; r++) {
    const d = per[r];
    if (!d) continue;
    rows.push({
      round: r,
      fights: d.n,
      win: Math.round((d.w / d.n) * 100) + '%',
      'playerVal': Math.round(d.pv / d.n),
      'enemyVal': Math.round(d.ev / d.n),
      'lossDmg': (d.dmg / d.n).toFixed(1),
    });
  }
  if (verbose) console.table(rows);
  return rows;
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  const args = process.argv.slice(2);
  const runs = Number(args.find((a) => /^\d+$/.test(a)) || 80);
  for (const a of args.filter((x) => x.includes('='))) {
    const [r, v] = a.split('=');
    const round = Number(r), budget = Number(v);
    if (LADDER[round]) { LADDER[round].budget = budget; console.log(`round ${round} budget -> ${budget}`); }
  }
  sweep(runs, true);
}
