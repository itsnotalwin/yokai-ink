/**
 * combat.js — deterministic, fixed-timestep battle simulation.
 *
 * Deliberately free of any DOM/Canvas reference: this module is imported both
 * by the browser build and by the Node test harness in tests/sim.test.js.
 *
 * Model
 *  - Units own one hex cell. Moving to a neighbour is an animated step that
 *    reserves the destination immediately, so two units never share a cell.
 *  - Ranged attacks spawn projectile entities that resolve on arrival; melee
 *    resolves on the swing frame. Both live inside the sim, so damage timing
 *    is part of the deterministic timeline, not the renderer.
 *  - Everything random draws from sim.rng, seeded by the caller.
 */

import { CFG } from './config.js';
import { makeRng } from './rng.js';
import {
  bfs, cellCenter, cellKey, firstStepOf, hexDistance, inBounds, neighbors,
} from './hex.js';
import { UNIT_BY_ID, hpAtStar, attackAtStar } from './data/units.js';
import { ABILITIES } from './data/abilities.js';
import { TRAIT_BY_ID, tierIndexFor } from './data/traits.js';

const now = (sim) => sim.t;

// ---------------------------------------------------------------------------
// Construction
// ---------------------------------------------------------------------------

/**
 * @param {object} opts
 * @param {Array} opts.playerUnits [{defId, star, col, row}]
 * @param {Array} opts.enemyUnits  [{defId, star, col, row, boss?, hpMult?, adMult?}]
 * @param {number} opts.seed
 * @param {number} opts.round
 */
export function createCombat(opts) {
  const cols = opts.cols ?? CFG.cols;
  const rows = opts.rows ?? CFG.rows;

  const sim = {
    t: 0,
    dt: 1 / CFG.tickHz,
    cols, rows,
    round: opts.round ?? 1,
    rng: makeRng(opts.seed >>> 0),
    units: [],
    projectiles: [],
    effects: [],
    events: [],          // human-readable log of casts/kills for the UI ticker
    occ: new Map(),      // cellKey -> unit uid
    over: false,
    winner: null,        // 'player' | 'enemy'
    timeout: false,
    startDelay: 0.45,    // short beat before anyone moves
  };

  let idx = 0;
  for (const spec of opts.playerUnits) sim.units.push(makeUnit(sim, spec, 'player', idx++));
  idx = 0;
  for (const spec of opts.enemyUnits) sim.units.push(makeUnit(sim, spec, 'enemy', idx++));

  for (const u of sim.units) {
    const k = cellKey(u.col, u.row);
    if (!sim.occ.has(k)) sim.occ.set(k, u.uid);
  }

  // The ability/trait api must exist before traits run: they can shield units,
  // which routes through the same helpers the abilities use.
  sim._api = makeApi(sim);
  applyAllTraits(sim);
  return sim;
}

function makeUnit(sim, spec, side, index) {
  const def = UNIT_BY_ID[spec.defId];
  if (!def) throw new Error('unknown unit: ' + spec.defId);
  const star = spec.star || 1;
  const center = cellCenter(spec.col, spec.row);
  const maxHp = Math.round(hpAtStar(def, star) * (spec.hpMult || 1));

  const u = {
    uid: `${side}:${index}`,
    defId: def.id,
    def,
    star,
    side,
    row: spec.row,
    col: spec.col,
    x: center.x,
    y: center.y,
    facing: side === 'player' ? -Math.PI / 2 : Math.PI / 2,
    // stats
    hp: maxHp,
    maxHp,
    shield: 0,
    attack: Math.round(attackAtStar(def, star) * (spec.adMult || 1)),
    attackSpeed: def.attackSpeed,
    range: def.range,
    moveSpeed: def.moveSpeed * CFG.moveSpeedScale,
    armor: def.armor,
    mr: def.mr,
    // A head start on mana means the first ability lands around two seconds in —
    // without it, a 15-second fight spends its first third as a slap fight.
    mana: (def.startMana || 0) + Math.round(def.mana * CFG.manaHeadStart),
    maxMana: def.mana,
    // modifiers granted by traits / abilities
    dodge: 0,
    lifesteal: 0,
    inkStain: false,
    onHitMagic: 0,
    onHitMagicUntil: -1,
    cleaveFrac: 0,
    cleaveUntil: -1,
    // action state
    attackCd: 0,
    castLock: 0,
    stunUntil: -1,
    rootUntil: -1,
    disarmUntil: -1,
    slows: [],
    buffs: [],
    dots: [],
    targetUid: null,
    retargetAt: 0,
    nextPathAt: 0,
    step: null,
    // presentation + bookkeeping
    attackAnim: 0,
    castAnim: 0,
    hurtAnim: 0,
    alive: true,
    deathT: -1,
    boss: !!spec.boss,
    size: spec.boss ? 1.42 : 1,
    dmgDone: 0,
    healDone: 0,
    cell() { return { col: this.col, row: this.row }; },
  };
  return u;
}

// ---------------------------------------------------------------------------
// API handed to abilities and traits
// ---------------------------------------------------------------------------

function makeApi(sim) {
  const allies = (u) => sim.units.filter((x) => x.alive && x.side === u.side && x !== u);
  const enemies = (u) => sim.units.filter((x) => x.alive && x.side !== u.side);

  const byDistance = (u) => {
    const list = enemies(u);
    return list.sort((a, b) => {
      const da = hexDistance(a.cell(), u.cell());
      const db = hexDistance(b.cell(), u.cell());
      if (da !== db) return da - db;
      const ha = a.hp / a.maxHp, hb = b.hp / b.maxHp;
      if (ha !== hb) return ha - hb;
      return a.uid < b.uid ? -1 : 1;
    });
  };

  const api = {
    sim,
    rng: sim.rng,
    allies,
    enemies,
    nearestEnemy: (u) => byDistance(u)[0] || null,
    farthestEnemy: (u) => {
      const list = enemies(u);
      if (!list.length) return null;
      return list.sort((a, b) => hexDistance(b.cell(), u.cell()) - hexDistance(a.cell(), u.cell()))[0];
    },
    lowestHpEnemy: (u) => {
      const list = enemies(u);
      if (!list.length) return null;
      return list.sort((a, b) => a.hp - b.hp)[0];
    },
    nearestEnemies: (u, n) => byDistance(u).slice(0, n),
    enemiesWithin(cell, radius) {
      return sim.units.filter((x) => x.alive && hexDistance(x.cell(), cell) <= radius);
    },
    damage: (src, tgt, amount, type) => dealDamage(sim, src, tgt, amount, type),
    heal(u, amount) {
      if (!u.alive || amount <= 0) return 0;
      const before = u.hp;
      u.hp = Math.min(u.maxHp, u.hp + amount);
      u.healDone += u.hp - before;
      if (u.hp > before) pushFx(sim, 'healText', { x: u.x, y: u.y, value: Math.round(u.hp - before), dur: 0.9 });
      return u.hp - before;
    },
    addShield(u, amount) {
      if (!u.alive || amount <= 0) return;
      u.shield += amount;
      pushFx(sim, 'shield', { uid: u.uid, dur: 0.7 });
      return amount;
    },
    stun(u, dur) {
      if (!u.alive) return;
      u.stunUntil = Math.max(u.stunUntil, now(sim) + dur);
      abortStep(sim, u);
    },
    root(u, dur) { if (u.alive) u.rootUntil = Math.max(u.rootUntil, now(sim) + dur); },
    disarm(u, dur) { if (u.alive) u.disarmUntil = Math.max(u.disarmUntil, now(sim) + dur); },
    slow(u, pct, dur) { if (u.alive) u.slows.push({ pct, until: now(sim) + dur }); },
    buffStat(u, key, mode, amount, dur, id) {
      if (!u.alive) return;
      const b = { key, mode, amount, until: now(sim) + dur, id: id || key };
      if (mode === 'mult') u[key] *= amount; else u[key] += amount;
      u.buffs.push(b);
    },
    dot(u, dps, dur, src) {
      if (!u.alive) return;
      u.dots.push({ dps, until: now(sim) + dur, srcUid: src ? src.uid : null, tickAt: 0 });
    },
    knockback(target, fromCell, cells = 1) {
      // Step directly away from the source, to the first free cell.
      let best = null;
      for (let i = 0; i < cells; i++) {
        const cur = target.cell();
        let picked = null;
        let bestD = hexDistance(cur, fromCell);
        for (const n of neighbors(cur.col, cur.row)) {
          if (!inBounds(n.col, n.row, sim.cols, sim.rows)) continue;
          const k = cellKey(n.col, n.row);
          if (sim.occ.has(k)) continue;
          const d = hexDistance(n, fromCell);
          if (d > bestD) { bestD = d; picked = n; }
        }
        if (!picked) break;
        best = picked;
        if (i < cells - 1) { target.col = picked.col; target.row = picked.row; }
      }
      if (!best) return;
      abortStep(sim, target);
      sim.occ.delete(cellKey(target.col, target.row));
      const center = cellCenter(best.col, best.row);
      target.col = best.col;
      target.row = best.row;
      target.step = {
        fromX: target.x, fromY: target.y, toX: center.x, toY: center.y,
        col: best.col, row: best.row, t: 0, dur: 0.22, knock: true,
      };
      sim.occ.set(cellKey(best.col, best.row), target.uid);
    },
    fx: (type, payload) => pushFx(sim, type, payload),
  };
  return api;
}

function pushFx(sim, type, payload) {
  sim.effects.push({ type, t0: now(sim), dur: payload.dur ?? 0.5, ...payload });
}

// ---------------------------------------------------------------------------
// Traits
// ---------------------------------------------------------------------------

function countSideTraits(sim, side) {
  const counts = {};
  for (const u of sim.units) {
    if (!u.alive || u.side !== side) continue;
    counts[u.def.trait] = (counts[u.def.trait] || 0) + 1;
  }
  return counts;
}

function applyAllTraits(sim) {
  const api = sim._api || makeApi(sim);
  for (const side of ['player', 'enemy']) {
    const counts = countSideTraits(sim, side);
    for (const [traitId, count] of Object.entries(counts)) {
      const trait = TRAIT_BY_ID[traitId];
      if (!trait) continue;
      const tier = tierIndexFor(trait, count);
      if (tier < 0) continue;
      for (const u of sim.units) {
        if (u.side === side && u.def.trait === traitId) trait.apply(api, u, tier);
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Damage
// ---------------------------------------------------------------------------

function dealDamage(sim, src, tgt, amount, type) {
  if (!tgt.alive || amount <= 0) return 0;

  let dmg = amount;
  if (type === 'physical') dmg *= 100 / (100 + tgt.armor);
  else if (type === 'magic') dmg *= 100 / (100 + tgt.mr);
  dmg = Math.max(1, dmg);

  const absorbed = Math.min(tgt.shield, dmg);
  tgt.shield -= absorbed;
  dmg -= absorbed;

  tgt.hp -= dmg;
  tgt.hurtAnim = 0.16;
  // Taking damage builds mana, capped so a burst cannot instantly refill it.
  if (dmg > 0) tgt.mana = Math.min(tgt.maxMana, tgt.mana + Math.min(10, dmg * 0.06));

  if (src && src.alive) {
    src.dmgDone += dmg + absorbed;
    if (src.lifesteal > 0) {
      const before = src.hp;
      src.hp = Math.min(src.maxHp, src.hp + dmg * src.lifesteal);
      src.healDone += src.hp - before;
    }
  }

  if (dmg >= 1) {
    const dir = src ? Math.atan2(tgt.y - src.y, tgt.x - src.x) : 0;
    // Only worthwhile hits leave a mark; a page covered in specks reads as
    // noise instead of violence.
    if (dmg >= 26) {
      pushFx(sim, 'splat', {
        x: tgt.x, y: tgt.y, dur: 0.5, seed: sim.rng.int(1000), dir, heavy: dmg >= 70,
      });
    }
    pushFx(sim, 'text', {
      x: tgt.x + Math.cos(dir) * 5, y: tgt.y, value: Math.round(dmg), kind: type, dur: 0.7,
      seed: sim.rng.int(1000),
    });
  }

  if (tgt.hp <= 0) killUnit(sim, tgt, src);
  return dmg;
}

function killUnit(sim, u, src) {
  if (!u.alive) return;
  u.alive = false;
  u.hp = 0;
  u.deathT = now(sim);
  u.targetUid = null;
  abortStep(sim, u);
  u.step = null;
  sim.occ.delete(cellKey(u.col, u.row));
  pushFx(sim, 'death', { x: u.x, y: u.y, dur: 1.0, defId: u.defId, boss: u.boss });
  sim.events.push({ t: now(sim), text: `${u.def.name} falls` });
  // Survivors retarget immediately rather than walking to a corpse.
  for (const o of sim.units) {
    if (o.alive && o.side === u.side) continue;
    if (o.targetUid === u.uid) { o.targetUid = null; o.retargetAt = now(sim); }
  }
}

// ---------------------------------------------------------------------------
// Steps
// ---------------------------------------------------------------------------

function isBlockedFor(sim, self) {
  return (col, row, k) => {
    const other = sim.occ.get(k);
    return other !== undefined && other !== self.uid;
  };
}

/**
 * Choose the neighbouring cell to step into: the reachable cell that puts us in
 * attack range with the fewest steps, else the reachable cell closest to the goal.
 */
function chooseStep(sim, u, target) {
  const blocked = isBlockedFor(sim, u);
  const dist = bfs({ col: u.col, row: u.row }, sim.cols, sim.rows, blocked);

  let best = null;
  let bestScore = Infinity;
  for (const node of dist.values()) {
    if (node.steps === 0) continue;
    const d = hexDistance(node, target.cell());
    const score = Math.max(0, d - u.range) * 100 + node.steps;
    if (score < bestScore) { bestScore = score; best = node; }
  }
  if (!best) return null;
  return firstStepOf(best);
}

function beginStep(sim, u, cell) {
  if (cell.col === u.col && cell.row === u.row) return false;   // never "step" in place
  if (sim.occ.has(cellKey(cell.col, cell.row))) return false;   // cell got taken this tick
  const center = cellCenter(cell.col, cell.row);
  sim.occ.delete(cellKey(u.col, u.row));
  sim.occ.set(cellKey(cell.col, cell.row), u.uid);
  const fromX = u.x;
  const fromY = u.y;
  const dist = Math.hypot(center.x - fromX, center.y - fromY);
  const speed = Math.max(0.6, u.moveSpeed) * slowFactor(u);
  // 1.5 hex heights is roughly one cell of travel.
  const dur = Math.max(0.14, Math.min(0.55, dist / (speed * 1.05)));
  // The move is committed the moment it starts: col/row, occ and the step
  // destination must never disagree, or two units can end up on one hex.
  u.col = cell.col;
  u.row = cell.row;
  u.step = { fromX, fromY, toX: center.x, toY: center.y, col: cell.col, row: cell.row, t: 0, dur };
  return true;
}

function slowFactor(u) {
  let slow = 0;
  for (const s of u.slows) slow = Math.max(slow, s.pct);
  return 1 - slow;
}

/**
 * Abort a walk in progress.
 *
 * A stepping unit keeps `col`/`row` at the cell it is leaving and reserves the
 * destination in `occ`. If something interrupts the walk (a stun, a knockback,
 * death), the unit stays where it stands, so the reservation has to travel back
 * with it — otherwise the occupied cell is left unmarked and the destination
 * stays marked by nobody, which is how two units end up sharing a hex.
 */
function abortStep(sim, u) {
  if (!u.step) return;
  // col/row already point at the committed destination; snap the sprite there
  // so the figure is not left stranded between two hexes.
  u.x = u.step.toX;
  u.y = u.step.toY;
  u.step = null;
  sim.occ.set(cellKey(u.col, u.row), u.uid);
}

// ---------------------------------------------------------------------------
// Per-tick updates
// ---------------------------------------------------------------------------

function expireModifiers(sim, u) {
  if (u.buffs.length) {
    u.buffs = u.buffs.filter((b) => {
      if (sim.t >= b.until) {
        if (b.mode === 'mult') u[b.key] /= b.amount; else u[b.key] -= b.amount;
        return false;
      }
      return true;
    });
  }
  if (u.slows.length) u.slows = u.slows.filter((s) => sim.t < s.until);
  if (u.cleaveUntil >= 0 && sim.t >= u.cleaveUntil) { u.cleaveFrac = 0; u.cleaveUntil = -1; }
  if (u.onHitMagicUntil >= 0 && sim.t >= u.onHitMagicUntil) { u.onHitMagic = 0; u.onHitMagicUntil = -1; }

  if (u.dots.length) {
    for (const d of u.dots) {
      if (sim.t < d.until) {
        const ticks = Math.floor((sim.t - d.tickAt) / 0.5);
        if (ticks > 0) {
          d.tickAt += ticks * 0.5;
          const src = d.srcUid ? sim.units.find((x) => x.uid === d.srcUid) : null;
          dealDamage(sim, src, u, d.dps * 0.5 * ticks, 'true');
          if (!u.alive) break;
        }
      }
    }
    u.dots = u.dots.filter((d) => sim.t < d.until);
  }
}

function updateStep(sim, u) {
  if (!u.step) return;
  const s = u.step;
  s.t += sim.dt;
  const p = Math.min(1, s.t / s.dur);
  const e = p * p * (3 - 2 * p); // smoothstep
  u.x = s.fromX + (s.toX - s.fromX) * e;
  u.y = s.fromY + (s.toY - s.fromY) * e;
  u.facing = Math.atan2(s.toY - s.fromY, s.toX - s.fromX);
  if (p >= 1) {
    u.col = s.col;
    u.row = s.row;
    u.x = s.toX;
    u.y = s.toY;
    u.step = null;
  }
}

function currentTarget(sim, u) {
  let t = u.targetUid ? sim.units.find((x) => x.uid === u.targetUid) : null;
  if (t && !t.alive) { t = null; u.targetUid = null; }
  if (!t || sim.t >= u.retargetAt) {
    const api = sim._api;
    const next = api.nearestEnemy(u);
    if (next) {
      if (!t || next.uid !== t.uid) u.retargetAt = sim.t + 0.75;
      u.targetUid = next.uid;
      t = next;
    }
  }
  return t;
}

function tryAttack(sim, u, target) {
  if (u.attackCd > 0) return false;
  if (sim.t < u.disarmUntil) return false;
  if (u.castLock > 0) return false;
  if (hexDistance(u.cell(), target.cell()) > u.range) return false;

  u.attackCd = 1 / Math.max(0.15, u.attackSpeed);
  u.attackAnim = 0.2;
  u.facing = Math.atan2(target.y - u.y, target.x - u.x);

  if (u.range <= 1) {
    resolveBasicHit(sim, u, target);
  } else {
    sim.projectiles.push({
      x: u.x, y: u.y, targetUid: target.uid, srcUid: u.uid,
      dmg: u.attack, type: 'physical', speed: 9, age: 0,
    });
    pushFx(sim, 'muzzle', { x: u.x, y: u.y, dur: 0.18 });
  }
  u.mana = Math.min(u.maxMana, u.mana + 10);
  return true;
}

/** A landed (or dodged) auto-attack, including on-hit riders and cleave. */
function resolveBasicHit(sim, src, tgt) {
  if (!tgt.alive) return;
  if (sim.rng.chance(tgt.dodge)) {
    pushFx(sim, 'miss', { x: tgt.x, y: tgt.y, dur: 0.6 });
    return;
  }
  const dealt = dealDamage(sim, src, tgt, src.attack, 'physical');

  if (src.onHitMagic > 0) dealDamage(sim, src, tgt, src.onHitMagic, 'magic');
  if (src.inkStain) sim._api.dot(tgt, tgt.maxHp * 0.015, 3, src);

  if (src.cleaveFrac > 0 && sim.t < src.cleaveUntil) {
    for (const o of sim.units) {
      if (!o.alive || o.side === src.side || o === tgt) continue;
      if (hexDistance(o.cell(), tgt.cell()) <= 1) {
        dealDamage(sim, src, o, dealt * src.cleaveFrac, 'physical');
      }
    }
  }

  if (tgt.alive && tgt.boss) pushFx(sim, 'splat', { x: tgt.x, y: tgt.y, dur: 0.4, seed: sim.rng.int(1000) });
}

function tryCast(sim, u) {
  if (u.mana < u.maxMana) return false;
  if (u.castLock > 0) return false;
  if (sim.t < u.stunUntil) return false;
  const ability = ABILITIES[u.defId];
  if (!ability) return false;
  u.mana = 0;
  u.castLock = 0.35;
  u.castAnim = 0.45;
  ability.cast(sim._api, u);
  sim.events.push({ t: now(sim), text: `${u.def.name} — ${ability.name}` });
  const trait = TRAIT_BY_ID[u.def.trait];
  pushFx(sim, 'castRing', { x: u.x, y: u.y, dur: 0.55, boss: u.boss });
  // The trait glyph blooms behind the caster: the one big, readable beat that
  // says "an ability just fired".
  pushFx(sim, 'castGlyph', {
    x: u.x, y: u.y, dur: 0.9, boss: u.boss,
    glyph: (trait && trait.glyph) || '妖',
    seed: sim.rng.int(1000),
  });
  return true;
}

function updateUnit(sim, u) {
  if (!u.alive) return;

  u.attackCd = Math.max(0, u.attackCd - sim.dt);
  u.castLock = Math.max(0, u.castLock - sim.dt);
  u.attackAnim = Math.max(0, u.attackAnim - sim.dt);
  u.castAnim = Math.max(0, u.castAnim - sim.dt);
  u.hurtAnim = Math.max(0, u.hurtAnim - sim.dt);

  expireModifiers(sim, u);
  if (!u.alive) return;

  updateStep(sim, u);

  if (sim.t < u.stunUntil) return;      // stunned: no move, no attack, no cast

  const target = currentTarget(sim, u);
  if (!target) return;

  if (tryCast(sim, u)) return;

  const inRange = hexDistance(u.cell(), target.cell()) <= u.range;
  if (inRange && !u.step) {
    tryAttack(sim, u, target);
    return;
  }

  if (u.step) return;
  if (sim.t < u.rootUntil) return;
  if (sim.t < u.nextPathAt) return;
  u.nextPathAt = sim.t + 0.1;

  const next = chooseStep(sim, u, target);
  if (next) beginStep(sim, u, next);
}

function updateProjectiles(sim) {
  for (const p of sim.projectiles) {
    if (p.dead) continue;
    const t = sim.units.find((x) => x.uid === p.targetUid);
    if (!t || !t.alive) { p.dead = true; continue; }
    const dx = t.x - p.x, dy = t.y - p.y;
    const d = Math.hypot(dx, dy);
    const step = p.speed * sim.dt;
    if (d <= step || d < 0.12) {
      p.x = t.x; p.y = t.y;
      p.dead = true;
      const src = sim.units.find((x) => x.uid === p.srcUid);
      if (t.alive) {
        if (sim.rng.chance(t.dodge)) pushFx(sim, 'miss', { x: t.x, y: t.y, dur: 0.6 });
        else {
          dealDamage(sim, src, t, p.dmg, p.type);
          if (src && src.onHitMagic > 0) dealDamage(sim, src, t, src.onHitMagic, 'magic');
          if (src && src.inkStain) sim._api.dot(t, t.maxHp * 0.015, 3, src);
        }
      }
      pushFx(sim, 'impact', { x: p.x, y: p.y, dur: 0.35 });
    } else {
      p.x += (dx / d) * step;
      p.y += (dy / d) * step;
      p.age += sim.dt;
    }
  }
  if (sim.projectiles.some((p) => p.dead)) sim.projectiles = sim.projectiles.filter((p) => !p.dead);
}

function sideAlive(sim, side) {
  return sim.units.some((u) => u.alive && u.side === side);
}

function decideWinner(sim) {
  const pAlive = sideAlive(sim, 'player');
  const eAlive = sideAlive(sim, 'enemy');
  if (pAlive && !eAlive) { sim.over = true; sim.winner = 'player'; }
  else if (!pAlive && eAlive) { sim.over = true; sim.winner = 'enemy'; }
  else if (!pAlive && !eAlive) {
    // Both wiped on the same frame: the board that still holds the field wins.
    sim.over = true; sim.winner = 'enemy';
  } else if (sim.t >= CFG.combatTimeout) {
    const frac = (side) => sim.units
      .filter((u) => u.side === side && u.alive)
      .reduce((a, u) => a + u.hp / u.maxHp, 0);
    sim.over = true;
    sim.timeout = true;
    sim.winner = frac('player') > frac('enemy') ? 'player' : 'enemy';
  }
}

/** Advance the simulation by exactly one tick. */
export function stepCombat(sim) {
  if (sim.over) return sim;
  sim.t += sim.dt;
  if (sim.t >= sim.startDelay) {
    for (const u of sim.units) updateUnit(sim, u);
    updateProjectiles(sim);
  }
  decideWinner(sim);
  if (sim.effects.length > 60) {
    sim.effects = sim.effects.filter((e) => e.t0 + e.dur > sim.t - 2);
  }
  if (sim.events.length > 200) sim.events.splice(0, sim.events.length - 200);
  return sim;
}

/** Run the whole fight, tick by tick (used by tests and by "instant resolve"). */
export function runCombat(sim, maxTicks = 60 * 90) {
  let ticks = 0;
  while (!sim.over && ticks < maxTicks) { stepCombat(sim); ticks++; }
  if (!sim.over) { sim.over = true; sim.winner = 'enemy'; sim.timeout = true; }
  return sim;
}

/** Result summary for the game layer. */
export function combatResult(sim) {
  const survivors = sim.units.filter((u) => u.alive && u.side === 'enemy').length;
  return {
    winner: sim.winner,
    survivorCount: survivors,
    duration: sim.t,
    timeout: sim.timeout,
    playerStats: sideStats(sim, 'player'),
    enemyStats: sideStats(sim, 'enemy'),
  };
}

function sideStats(sim, side) {
  const list = sim.units.filter((u) => u.side === side);
  return {
    damage: Math.round(list.reduce((a, u) => a + u.dmgDone, 0)),
    healing: Math.round(list.reduce((a, u) => a + u.healDone, 0)),
    alive: list.filter((u) => u.alive).length,
  };
}


