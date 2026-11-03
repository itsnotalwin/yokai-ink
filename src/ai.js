/**
 * ai.js — enemy board construction.
 *
 * The opponent is a scripted ladder (see data/ladder.js). Each round names a
 * themed set of yokai plus a gold budget; this module turns that into a squad
 * with star levels, then lays it out front-to-back by attack range so the
 * formation always looks deliberate.
 *
 * Construction is deterministic: the same round always produces the same squad,
 * so players can learn the ladder and tests can assert against it.
 */

import { CFG } from './config.js';
import { UNIT_BY_ID } from './data/units.js';
import { LADDER, ladderFor } from './data/ladder.js';

const COL_PREF = [3, 2, 4, 1, 5, 0, 6];

/** Round 9 boss gets extra bulk so it reads as a boss, not a normal 3-star. */
const BOSS_MODS = { hpMult: 3.2, adMult: 1.35 };

/** Gold-equivalent value of one unit: cost x 3^(star-1). */
export function unitValue(u) {
  return UNIT_BY_ID[u.defId].cost * Math.pow(3, (u.star || 1) - 1);
}

/** Total shop cost of a squad, used by balance tests and the ladder UI. */
export function squadValue(squad) {
  return squad.reduce((a, u) => a + unitValue(u), 0);
}

/** Cost of upgrading a unit one star (3 copies -> 1). */
function upgradeCost(u) {
  return UNIT_BY_ID[u.defId].cost * 2 * Math.pow(3, u.star - 1);
}

/**
 * Turn a ladder entry into a concrete squad. Exported because the prep screen
 * shows the player what they are about to face.
 */
export function planFor(round, opts) {
  opts = opts || {};
  const plan = ladderFor(round);
  const budget = opts.budget === undefined ? plan.budget : opts.budget;
  const scale = opts.scale === undefined ? (plan.scale === undefined ? 1 : plan.scale) : opts.scale;
  const squad = plan.units.map((defId) => ({ defId, star: 1, boss: false }));
  if (plan.boss) squad.unshift({ defId: plan.boss, star: 3, boss: true });

  // Spend the leftover budget on the most expensive unit we can still upgrade.
  let left = budget - squadValue(squad);
  let guard = 0;
  while (left > 0 && guard++ < 40) {
    let pick = null;
    for (const u of squad) {
      if (u.boss || u.star >= 3) continue;
      const cost = upgradeCost(u);
      if (cost > left) continue;
      if (!pick || UNIT_BY_ID[u.defId].cost > UNIT_BY_ID[pick.defId].cost) pick = u;
    }
    if (!pick) break;
    left -= upgradeCost(pick);
    pick.star += 1;
  }
  return { name: plan.name, squad, budget, scale, spent: squadValue(squad) };
}

/**
 * Lay out a squad on one side.
 * @param {Array} squad [{defId, star, boss?}]
 * @param {'enemy'|'player'} side
 */
export function formation(squad, side) {
  const used = new Set();
  const rowsMelee = side === 'enemy' ? [3, 2] : [4, 5];
  const rowsRanged = side === 'enemy' ? [1, 0] : [7, 6];

  const take = (rows) => {
    for (const row of rows) {
      for (const col of COL_PREF) {
        const k = col + ',' + row;
        if (!used.has(k)) { used.add(k); return { col, row }; }
      }
    }
    return null;
  };

  const rangeOf = (u) => UNIT_BY_ID[u.defId].range;
  // Front-load the shortest ranges so the melee block lands in the front row.
  const ordered = squad.slice().sort((a, b) => rangeOf(a) - rangeOf(b));

  const out = [];
  for (const u of ordered) {
    const r = rangeOf(u);
    const rows = u.boss ? [side === 'enemy' ? 3 : 4]
      : r <= 1 ? rowsMelee
      : r <= 2 ? [rowsMelee[0], rowsRanged[0]]
      : rowsRanged;
    const cell = take(rows);
    if (!cell) continue;
    out.push({ ...u, col: cell.col, row: cell.row });
  }
  return out;
}

/** Build the enemy board for a round, ready for createCombat(). */
export function buildEnemyBoard(round, opts) {
  const { squad, scale } = planFor(round, opts);
  const placed = formation(squad, 'enemy');

  return placed.map((u) => {
    const entry = {
      defId: u.defId, star: u.star, col: u.col, row: u.row,
      hpMult: scale, adMult: scale,
    };
    if (u.boss) {
      entry.boss = true;
      entry.hpMult = BOSS_MODS.hpMult * scale;
      entry.adMult = BOSS_MODS.adMult * scale;
    }
    return entry;
  });
}

/** Is this round the boss round? */
export function isBossRound(round) {
  return round >= CFG.bossRound;
}

export { LADDER };
