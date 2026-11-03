/**
 * tools/probe.mjs — ad-hoc balance probe. Prints the player's board, the enemy
 * board and the resulting fight so we can see WHY a round is lost.
 *
 * node tools/probe.mjs [round]
 */
import { CFG } from '../src/config.js';
import { newRun, startCombat, finishCombat, continueRun } from '../src/state.js';
import { buySlot, reroll } from '../src/shop.js';
import { countOnBoard, capForRound, freeBenchIndex, unitInBench, autoPlace } from '../src/board.js';
import { runCombat, combatResult } from '../src/combat.js';
import { UNIT_BY_ID } from '../src/data/units.js';
import { traitSummaries } from '../src/traits.js';

function botPrep(state) {
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
      const space = freeBenchIndex(state) >= 0 || countOnBoard(state) < capForRound(state.round);
      if (UNIT_BY_ID[id].cost <= state.gold && space) buySlot(state, i);
    }
  }
}

const desc = (u) => `${u.defId}${u.star}★`.padEnd(14);

const target = Number(process.argv[2] || 4);
for (let run = 0; run < 3; run++) {
  const state = newRun(9000 + run * 37);
  while (state.round < target) {
    botPrep(state);
    if (startCombat(state).ok) { runCombat(state.combat); finishCombat(state); }
    if (state.phase === 'result') continueRun(state); else break;
  }
  if (state.round !== target) { console.log('run died before round', target); continue; }
  botPrep(state);
  console.log(`\n=== seed ${9000 + run * 37}  round ${target}  gold ${state.gold}  hp ${state.hp}`);
  const board = state.units.filter((u) => u.loc.type === 'board')
    .sort((a, b) => a.loc.row - b.loc.row || a.loc.col - b.loc.col);
  console.log('player:', board.map((u) => desc(u) + `@${u.loc.col},${u.loc.row}`).join('  '));
  console.log('player traits:', traitSummaries(board).map((t) => `${t.trait.id}:${t.count}`).join(' '));
  if (!startCombat(state).ok) { console.log('could not start'); continue; }
  const sim = state.combat;
  console.log('enemy: ', sim.units.filter((u) => u.side === 'enemy')
    .map((u) => `${u.defId}${u.star}★@${u.col},${u.row}`).join('  '));
  console.log('enemy traits:', traitSummaries(sim.units.filter((u) => u.side === 'enemy')
    .map((u) => ({ defId: u.defId }))).map((t) => `${t.trait.id}:${t.count}`).join(' '));
  const pw = sim.units.filter((u) => u.side === 'player').reduce((a, u) => a + u.maxHp + u.attack * 20, 0);
  const ew = sim.units.filter((u) => u.side === 'enemy').reduce((a, u) => a + u.maxHp + u.attack * 20, 0);
  console.log(`power player ${Math.round(pw)} vs enemy ${Math.round(ew)}`);
  runCombat(sim);
  const res = combatResult(sim);
  console.log(`result: ${res.winner}  t=${res.duration.toFixed(1)}s  survivors ${res.survivorCount}  ` +
    `pDamage ${Math.round(res.playerStats.damage)}  eDamage ${Math.round(res.enemyStats.damage)}`);
  for (const u of sim.units) {
    if (u.side !== 'player') continue;
    console.log(`  ${desc(u).padEnd(12)} hp ${Math.round(u.hp)}/${Math.round(u.maxHp)} ad ${u.attack.toFixed(0)} ` +
      `cast ${u.castCount || 0} dmg ${Math.round(u.dmgDone)} alive ${u.alive}`);
  }
  finishCombat(state);
}
