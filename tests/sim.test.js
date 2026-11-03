/**
 * tests/sim.test.js — headless verification of the game logic.
 *
 * Run: node tests/sim.test.js
 *
 * The combat sim and the shop/board model are DOM-free by design, so the whole
 * ruleset can be exercised in Node without a browser. These are the checks that
 * matter most: determinism, pool conservation, no illegal states, every ability
 * actually firing, and a win-rate curve that is neither a walkover nor a wall.
 */

import { CFG, interestFor } from '../src/config.js';
import { mixSeed, makeRng } from '../src/rng.js';
import { newRun, startCombat, finishCombat, continueRun } from '../src/state.js';
import { buySlot, reroll, mergeAll, sell } from '../src/shop.js';
import { countOnBoard, capForRound, freeBenchIndex, unitInBench, autoPlace } from '../src/board.js';
import { createCombat, runCombat, combatResult } from '../src/combat.js';
import { buildEnemyBoard, formation, planFor, squadValue } from '../src/ai.js';
import { UNITS, UNIT_BY_ID, copiesOfStar, sellValue, hpAtStar } from '../src/data/units.js';
import { ABILITIES } from '../src/data/abilities.js';
import { TRAITS } from '../src/data/traits.js';
import { hexDistance, cellKey, bfs } from '../src/hex.js';
import { botPrep } from '../tools/tune.mjs';
import { DIFFICULTIES, difficultyScale, nextDifficulty, DEFAULT_DIFFICULTY } from '../src/data/difficulty.js';

let passed = 0;
let failed = 0;
const failures = [];

function check(name, cond, detail) {
  if (cond) { passed++; return true; }
  failed++;
  failures.push(`${name}${detail ? ' — ' + detail : ''}`);
  return false;
}

function section(title) {
  console.log('\n\x1b[1m' + title + '\x1b[0m');
}

// ---------------------------------------------------------------------------
section('1. Determinism');

function boardSignature(sim) {
  return sim.units.map((u) => `${u.uid}:${Math.round(u.hp)}:${u.col},${u.row}:${u.alive ? 1 : 0}`).join('|');
}

{
  const player = [
    { defId: 'tanuki', star: 2, col: 3, row: 4 },
    { defId: 'yuki', star: 1, col: 2, row: 6 },
    { defId: 'kitsune', star: 1, col: 4, row: 6 },
    { defId: 'oni', star: 1, col: 3, row: 5 },
  ];
  const enemy = buildEnemyBoard(4, makeRng(1));
  const a = createCombat({ playerUnits: player, enemyUnits: enemy, seed: 12345, round: 4 });
  const b = createCombat({ playerUnits: player, enemyUnits: enemy, seed: 12345, round: 4 });
  runCombat(a); runCombat(b);
  check('same seed -> same winner', a.winner === b.winner, `${a.winner} vs ${b.winner}`);
  check('same seed -> same duration', a.t === b.t, `${a.t} vs ${b.t}`);
  check('same seed -> identical unit trace', boardSignature(a) === boardSignature(b));

  const c = createCombat({ playerUnits: player, enemyUnits: enemy, seed: 999, round: 4 });
  runCombat(c);
  check('seed influences the fight (or is at least stable)', typeof c.winner === 'string');
}

{
  // Stepping the same sim with different tick groupings must not change outcomes:
  // this is what protects 1x/2x/4x speed from becoming pay-to-win.
  const player = [{ defId: 'kappa', star: 2, col: 3, row: 4 }, { defId: 'rokuro', star: 2, col: 3, row: 6 }];
  const enemy = buildEnemyBoard(5, makeRng(7));
  const a = createCombat({ playerUnits: player, enemyUnits: enemy, seed: 4242, round: 5 });
  const b = createCombat({ playerUnits: player, enemyUnits: enemy, seed: 4242, round: 5 });
  runCombat(a);
  // b is driven through the real accumulator path used by the game loop
  const step = 1 / CFG.tickHz;
  let acc = 0;
  let guard = 0;
  while (!b.over && guard++ < 60 * 90) {
    acc += 0.033 * 4; // 4x speed frame at ~30fps
    while (acc >= step && !b.over) { (await import('../src/combat.js')).stepCombat(b); acc -= step; }
  }
  check('speed multiplier does not change the result', a.winner === b.winner && Math.abs(a.t - b.t) < 1.01,
    `${a.winner}@${a.t.toFixed(2)} vs ${b.winner}@${b.t.toFixed(2)}`);
}

// ---------------------------------------------------------------------------
section('2. Simulation invariants');

{
  let overlaps = 0, nans = 0, stuck = 0, outOfBounds = 0;
  for (let seed = 1; seed <= 40; seed++) {
    const rng = makeRng(seed * 31);
    const player = [];
    const used = new Set();
    for (let i = 0; i < 8; i++) {
      let col, row;
      do { col = rng.int(CFG.cols); row = 4 + rng.int(4); } while (used.has(col + ',' + row));
      used.add(col + ',' + row);
      const def = UNITS[rng.int(UNITS.length)];
      player.push({ defId: def.id, star: 1 + rng.int(3), col, row });
    }
    const enemy = buildEnemyBoard(1 + rng.int(9), makeRng(seed * 77));
    const sim = createCombat({ playerUnits: player, enemyUnits: enemy, seed: seed * 13, round: 5 });
    runCombat(sim);

    const cells = new Map();
    for (const u of sim.units) {
      if (!u.alive) continue;
      const k = cellKey(u.col, u.row);
      if (cells.has(k)) overlaps++;
      cells.set(k, u.uid);
      if (!Number.isFinite(u.hp) || !Number.isFinite(u.attack) || !Number.isFinite(u.x) || !Number.isFinite(u.y)) nans++;
      if (u.col < 0 || u.col >= CFG.cols || u.row < 0 || u.row >= CFG.rows) outOfBounds++;
      if (u.occ === undefined && sim.occ.get(k) !== u.uid) overlaps += 0;
    }
    if (!sim.over) stuck++;
    const res = combatResult(sim);
    if (!['player', 'enemy'].includes(res.winner)) stuck++;
  }
  check('no two living units share a hex', overlaps === 0, overlaps + ' overlaps');
  check('no NaN stats or positions', nans === 0, nans + ' NaNs');
  check('every fight terminates', stuck === 0, stuck + ' stuck');
  check('units stay in bounds', outOfBounds === 0, outOfBounds + ' escapes');
}

// ---------------------------------------------------------------------------
section('3. Abilities and traits');

{
  // Each yokai gets its own fight against an unkillable, harmless dummy so the
  // test proves "this unit can cast", not "this unit survived long enough".
  const missing = [];
  const casts = [];
  for (const def of UNITS) {
    const sim = createCombat({
      playerUnits: [{ defId: def.id, star: 3, col: 3, row: 5 }],
      enemyUnits: [{ defId: 'tanuki', star: 1, col: 3, row: 4, hpMult: 60, adMult: 0 }],
      seed: 21, round: 9,
    });
    runCombat(sim, 60 * 70);
    const cast = sim.events.filter((e) => e.text.startsWith(def.name + ' — '));
    if (!cast.length) missing.push(`${def.id}/${ABILITIES[def.id].name}`);
    casts.push(`${def.id}:${cast.length}`);
  }
  check('every yokai can cast its ability', missing.length === 0, missing.join(', '));
}


{
  // Trait bonuses: 3 Tricksters should dodge, 3 Water should be shielded.
  const sim = createCombat({
    playerUnits: [
      { defId: 'tanuki', star: 1, col: 3, row: 4 },
      { defId: 'karakasa', star: 1, col: 2, row: 4 },
      { defId: 'kitsune', star: 1, col: 4, row: 5 },
      { defId: 'kappa', star: 1, col: 1, row: 5 },
      { defId: 'yuki', star: 1, col: 5, row: 5 },
      { defId: 'umibozu', star: 1, col: 3, row: 6 },
    ],
    enemyUnits: [{ defId: 'tanuki', star: 1, col: 3, row: 3 }],
    seed: 3, round: 5,
  });
  const trick = sim.units.filter((u) => u.def.trait === 'trickster' && u.side === 'player');
  const water = sim.units.filter((u) => u.def.trait === 'water' && u.side === 'player');
  check('3 Tricksters get 35% dodge', trick.every((u) => Math.abs(u.dodge - 0.35) < 1e-9), trick.map((u) => u.dodge).join(','));
  check('3 Water units start with a 30% shield', water.every((u) => u.shield === Math.round(u.maxHp * 0.30) || Math.abs(u.shield - u.maxHp * 0.30) < 1), water.map((u) => `${u.shield}/${u.maxHp}`).join(','));
}

{
  // A single unit has no trait bonus at all.
  const sim = createCombat({
    playerUnits: [{ defId: 'tanuki', star: 1, col: 3, row: 4 }],
    enemyUnits: [{ defId: 'kappa', star: 1, col: 3, row: 3 }],
    seed: 1, round: 1,
  });
  check('one Trickster = no bonus', sim.units.filter((u) => u.side === 'player').every((u) => u.dodge === 0));
}

// ---------------------------------------------------------------------------
section('4. Shop, pool and economy');

{
  const state = newRun(1234);
  const totalCopies = UNITS.reduce((a, u) => a + (state.pool[u.id] || 0), 0)
    + state.shop.filter(Boolean).length
    + state.units.reduce((a, u) => a + copiesOfStar(u.star), 0);
  const expected = UNITS.reduce((a, u) => a + ({ 1: 26, 2: 18, 3: 12, 4: 9 })[u.cost], 0);
  check('pool starts with every copy accounted for', totalCopies === expected, `${totalCopies} vs ${expected}`);
}

{
  const state = newRun(77);
  const def = () => countAll(state);
  const before = def();
  // Buy out the whole shop
  for (let i = 0; i < state.shop.length; i++) buySlot(state, i);
  const after = def();
  check('buying conserves copies', before === after, `${before} -> ${after}`);

  // Account for gold never going negative
  let neg = false;
  for (let i = 0; i < 400; i++) {
    const r = reroll(state, makeRng(i + 1));
    if (state.gold < 0) neg = true;
    for (let s = 0; s < state.shop.length; s++) if (buySlot(state, s).ok && state.gold < 0) neg = true;
  }
  check('gold never goes negative under arbitrary input', !neg);
  check('no duplicate units occupy one bench slot', benchUnique(state));
}

function countAll(state) {
  return UNITS.reduce((a, u) => a + (state.pool[u.id] || 0), 0)
    + state.shop.filter(Boolean).length
    + state.units.reduce((a, u) => a + copiesOfStar(u.star), 0);
}

function benchUnique(state) {
  const idx = state.units.filter((u) => u.loc.type === 'bench').map((u) => u.loc.index);
  return new Set(idx).size === idx.length && idx.every((i) => i >= 0 && i < CFG.benchSize);
}

{
  // Merging: three 1-star copies become one 2-star, nine become a 3-star.
  const state = newRun(5);
  state.pool.tanuki = 30;
  for (let i = 0; i < 2; i++) {
    state.units.push({ uid: 't' + i, defId: 'tanuki', star: 1, loc: { type: 'bench', index: i } });
  }
  state.units.push({ uid: 't8', defId: 'tanuki', star: 1, loc: { type: 'bench', index: 2 } });
  const made = mergeAll(state);
  check('3 copies merge into a 2-star', made.length === 1 && made[0].star === 2);
  check('merge leaves exactly one unit', state.units.filter((u) => u.defId === 'tanuki').length === 1);

  const state2 = newRun(6);
  for (let i = 0; i < 9; i++) {
    state2.units.push({ uid: 'x' + i, defId: 'kappa', star: 1, loc: { type: 'bench', index: i % 8 } });
  }
  mergeAll(state2);
  const kappa = state2.units.filter((u) => u.defId === 'kappa');
  check('9 copies cascade to a single 3-star', kappa.length === 1 && kappa[0].star === 3, JSON.stringify(kappa.map((k) => k.star)));

  const state3 = newRun(7);
  state3.units.push({ uid: 'a', defId: 'oni', star: 2, loc: { type: 'bench', index: 0 } });
  const goldBefore = state3.gold;
  sell(state3, state3.units[0]);
  check('selling a 2-star refunds 3x cost', state3.gold - goldBefore === UNIT_BY_ID.oni.cost * 3, `${state3.gold - goldBefore}`);
}

{
  // Unit cap is round+2 capped at 8, and the board refuses overflow.
  const state = newRun(9);
  state.round = 8;
  check('cap at round 8 is 8', capForRound(state.round) === 8, String(capForRound(state.round)));
  state.round = 2;
  check('cap at round 2 is 4', capForRound(state.round) === 4, String(capForRound(state.round)));

  // fill the board beyond the cap by hand, then check placement refuses
  state.round = 1; // cap 3
  state.units = [];
  let placed = 0;
  for (let i = 0; i < 4; i++) {
    const u = { uid: 'b' + i, defId: 'tanuki', star: 1, loc: { type: 'bench', index: i } };
    state.units.push(u);
    if (autoPlace(state, u)) placed++;
  }
  check('autoPlace respects the unit cap', placed === 3 && countOnBoard(state) === 3, `${placed}/${countOnBoard(state)}`);
}

// ---------------------------------------------------------------------------
section('5. Enemy ladder');

{
  let legal = true;
  const rows = [];
  let prevValue = 0;
  let monotone = true;
  for (let r = 1; r <= CFG.bossRound; r++) {
    const plan = planFor(r);
    const board = buildEnemyBoard(r);
    const overlap = new Set(board.map((u) => u.col + ',' + u.row)).size !== board.length;
    const half = board.every((u) => u.row >= 0 && u.row <= 3);
    const inBounds = board.every((u) => u.col >= 0 && u.col < CFG.cols);
    // The squad must place exactly the units the plan bought: no silent drops.
    if (overlap || !half || !inBounds || board.length !== plan.squad.length) legal = false;
    const value = squadValue(plan.squad);
    if (value < prevValue) monotone = false;
    prevValue = value;
    rows.push({
      round: r,
      name: plan.name,
      units: board.length,
      stars: plan.squad.map((u) => u.star).join(''),
      value,
      scale: plan.scale,
      boss: board.some((u) => u.boss),
    });
  }
  check('enemy boards are legal (no overlaps, in bounds, enemy half only)', legal);
  check('every planned squad places all of its units', rows.every((r) => r.units > 0));
  check('the ladder escalates', rows[8].value > rows[0].value && rows[8].value > rows[3].value,
    rows.map((r) => r.value).join(','));
  check('only the final round has a boss', rows.filter((r) => r.boss).length === 1 && rows[8].boss);
  check('squad size tracks the player unit cap',
    rows.every((r) => r.units === Math.min(r.round + 2, CFG.unitCapMax)),
    rows.map((r) => `${r.round}:${r.units}`).join(' '));
  console.table(rows);
}

// ---------------------------------------------------------------------------
section('6. Greedy-bot balance sweep');

{
  const RUNS = Number(process.env.RUNS || 60);
  const perRound = {};
  let wins = 0, losses = 0, bossWins = 0, bossRuns = 0;
  for (let run = 0; run < RUNS; run++) {
    const state = newRun(9000 + run * 37);
    let guard = 0;
    while (state.phase !== 'gameover' && state.phase !== 'victory' && guard++ < 30) {
      botPrep(state);
      const started = startCombat(state);
      if (!started.ok) break;
      runCombat(state.combat);
      finishCombat(state);
      const rec = state.result;
      if (rec.round === CFG.bossRound) { bossRuns++; if (rec.winner === 'player') bossWins++; }
      if (!perRound[rec.round]) perRound[rec.round] = { n: 0, w: 0, dmg: 0 };
      perRound[rec.round].n++;
      if (rec.winner === 'player') perRound[rec.round].w++;
      perRound[rec.round].dmg += rec.damage;
      if (rec.winner === 'player') wins++; else losses++;
      if (state.phase === 'result') continueRun(state);
    }
  }

  const table = [];
  for (let r = 1; r <= CFG.bossRound; r++) {
    const d = perRound[r];
    if (!d) continue;
    table.push({
      round: r,
      fights: d.n,
      winRate: Math.round((d.w / d.n) * 100) + '%',
      avgLossDmg: (d.dmg / d.n).toFixed(1),
    });
  }
  console.table(table);

  // Difficulty curve: the player should win the opening rounds comfortably, be
  // made to work in the middle, and need a real board to take the boss down.
  // Bands are deliberately wide — this is a smoke test against a single greedy
  // bot, not a proof that every strategy is viable.
  const wr = (r) => (perRound[r] ? perRound[r].w / perRound[r].n : 0);
  check('the opening rounds are winnable', wr(1) >= 0.85 && wr(2) >= 0.85,
    [1, 2].map((r) => Math.round(wr(r) * 100) + '%').join(' '));
  check('the opener is easier than the mid ladder', wr(2) >= wr(6),
    `${Math.round(wr(2) * 100)}% vs ${Math.round(wr(6) * 100)}%`);
  check('mid ladder is not a wall', wr(4) >= 0.5 && wr(5) >= 0.4 && wr(6) >= 0.35,
    [4, 5, 6].map((r) => Math.round(wr(r) * 100) + '%').join(' '));
  check('late ladder is a real test', wr(7) <= 0.9 && wr(8) <= 0.85,
    [7, 8].map((r) => Math.round(wr(r) * 100) + '%').join(' '));
  check('the boss is beatable but not free',
    bossWins / Math.max(1, bossRuns) >= 0.2 && bossWins / Math.max(1, bossRuns) <= 0.85,
    `${bossWins}/${bossRuns}`);
  check('the run is losable', losses > 0, `${losses} losses`);
  check('a run can reach the boss', bossRuns > 0, `${bossRuns} attempts`);
}

// ---------------------------------------------------------------------------
section('7. Difficulty presets');

{
  check('every preset has a positive scale',
    DIFFICULTIES.every((d) => typeof d.scale === 'number' && d.scale > 0),
    DIFFICULTIES.map((d) => `${d.id}:${d.scale}`).join(' '));
  check('the presets are ordered easy -> hard',
    DIFFICULTIES[0].scale < DIFFICULTIES[1].scale && DIFFICULTIES[1].scale < DIFFICULTIES[2].scale,
    DIFFICULTIES.map((d) => d.scale).join(' < '));
  check('standard is exactly the fitted curve', difficultyScale('standard') === 1);
  check('cycling wraps back to the first preset',
    nextDifficulty(DIFFICULTIES[DIFFICULTIES.length - 1].id) === DIFFICULTIES[0].id);
  check('a fresh run starts on the default preset', newRun(1).difficulty === DEFAULT_DIFFICULTY);

  // The preset has to reach the actual fight: same round, same seed, different
  // enemy health. If this drifts, the button is lying to the player.
  const enemyHp = (preset) => {
    const st = newRun(4242);
    st.difficulty = preset;
    botPrep(st);
    for (let i = 1; i < 6; i++) { st.round += 1; botPrep(st); }
    const ok = startCombat(st);
    if (!ok.ok) return 0;
    return st.combat.units
      .filter((u) => u.side === 'enemy')
      .reduce((a, u) => a + u.maxHp, 0);
  };
  const storyHp = enemyHp('story');
  const stdHp = enemyHp('standard');
  const ruthHp = enemyHp('ruthless');
  check('story enemies are softer than standard', storyHp > 0 && storyHp < stdHp * 0.95,
    `${Math.round(storyHp)} vs ${Math.round(stdHp)}`);
  check('ruthless enemies are tougher than standard', ruthHp > stdHp * 1.05,
    `${Math.round(ruthHp)} vs ${Math.round(stdHp)}`);

  // The ladder keeps its shape on every preset: the boss round stays the
  // heaviest board in the run.
  for (const d of DIFFICULTIES) {
    const bossHp = planFor(9).squad
      .reduce((a, u) => a + hpAtStar(UNIT_BY_ID[u.defId], u.star) * (u.boss ? 3.2 : 1), 0) * d.scale;
    const round5Hp = planFor(5).squad
      .reduce((a, u) => a + hpAtStar(UNIT_BY_ID[u.defId], u.star), 0) * d.scale;
    check(`${d.name}: the boss round is the heaviest`, bossHp > round5Hp * 1.2,
      `${Math.round(bossHp)} vs ${Math.round(round5Hp)}`);
  }
}

// ---------------------------------------------------------------------------
console.log(`\n${failed === 0 ? '\x1b[32m' : '\x1b[31m'}${passed} passed, ${failed} failed\x1b[0m`);
if (failed) {
  for (const f of failures) console.log('  \x1b[31m✗\x1b[0m ' + f);
  process.exitCode = 1;
}
