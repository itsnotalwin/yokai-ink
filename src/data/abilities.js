/**
 * data/abilities.js — one ability per yokai.
 *
 * Abilities are pure functions over the combat `api` handed in by combat.js,
 * so the roster can grow without touching the simulation.
 *
 * Shape: { name, text(star), cast(api, unit) }
 * Number triples are [1-star, 2-star, 3-star].
 */

import { hexDistance } from '../hex.js';

const val = (arr, star) => arr[Math.max(0, Math.min(2, star - 1))];

export const ABILITIES = {
  tanuki: {
    name: 'Belly Drum',
    text: (s) => `Heals ${val([22, 30, 45], s)}% of max HP and gains 30% attack speed for 4s.`,
    cast(api, u) {
      api.heal(u, u.maxHp * (val([22, 30, 45], u.star) / 100));
      api.buffStat(u, 'attackSpeed', 'mult', 1.30, 4, 'bellydr');
      api.fx('ring', { x: u.x, y: u.y, r: 1.1, dur: 0.5, tint: 'ink' });
    },
  },

  kappa: {
    name: 'Cucumber Dip',
    text: (s) => `Heals itself for ${val([30, 40, 55], s)}% of max HP and adjacent allies for 15%.`,
    cast(api, u) {
      api.heal(u, u.maxHp * (val([30, 40, 55], u.star) / 100));
      for (const a of api.allies(u)) {
        if (hexDistance(a.cell(), u.cell()) <= 1) api.heal(a, a.maxHp * 0.15);
      }
      api.fx('ring', { x: u.x, y: u.y, r: 1.5, dur: 0.6, tint: 'water' });
    },
  },

  karakasa: {
    name: 'Gust',
    text: (s) => `Blasts the nearest enemy for ${val([90, 140, 220], s)} magic damage, disarms it for 2s and knocks it back a hex.`,
    cast(api, u) {
      const t = api.nearestEnemy(u);
      if (!t) return;
      api.damage(u, t, val([90, 140, 220], u.star), 'magic');
      api.disarm(t, 2);
      api.knockback(t, u.cell(), 1);
      api.fx('gust', { from: { x: u.x, y: u.y }, to: { x: t.x, y: t.y }, dur: 0.45 });
    },
  },

  yuki: {
    name: 'Frost Breath',
    text: (s) => `Chills enemies near the nearest foe for ${val([90, 140, 220], s)} magic damage and a 35% slow for 3s.`,
    cast(api, u) {
      const t = api.nearestEnemy(u);
      if (!t) return;
      const cell = t.cell();
      for (const e of api.enemiesWithin(cell, 2)) {
        api.damage(u, e, val([90, 140, 220], u.star), 'magic');
        api.slow(e, 0.35, 3);
      }
      api.fx('frost', { x: t.x, y: t.y, r: 2.2, dur: 0.8 });
    },
  },

  tengu: {
    name: 'Wind Slash',
    text: (s) => `For 5s attacks strike 60% splash to adjacent enemies and gain ${val([15, 25, 40], s)}% attack speed.`,
    cast(api, u) {
      api.buffStat(u, 'attackSpeed', 'mult', 1 + val([0.15, 0.25, 0.40], u.star), 5, 'tengu');
      u.cleaveFrac = 0.60;
      u.cleaveUntil = api.sim.t + 5;
      api.fx('slashArc', { u, dur: 0.4 });
    },
  },

  rokuro: {
    name: 'Neck Bite',
    text: (s) => `The neck lashes the farthest enemy for ${val([140, 200, 300], s)} magic damage and 2%/s bleeding for 4s.`,
    cast(api, u) {
      const t = api.farthestEnemy(u);
      if (!t) return;
      api.damage(u, t, val([140, 200, 300], u.star), 'magic');
      api.dot(t, t.maxHp * 0.02, 4, u);
      api.fx('lash', { from: { x: u.x, y: u.y }, to: { x: t.x, y: t.y }, dur: 0.5 });
    },
  },

  kitsune: {
    name: 'Foxfire',
    text: (s) => `Three wisps strike up to three foes for ${val([110, 165, 240], s)} magic damage each.`,
    cast(api, u) {
      const targets = api.enemies(u).slice().sort((a, b) => a.hp - b.hp).slice(0, 3);
      for (const t of targets) {
        api.damage(u, t, val([110, 165, 240], u.star), 'magic');
        api.fx('foxfire', { x: t.x, y: t.y, dur: 0.55 });
      }
    },
  },

  oni: {
    name: 'Crimson Oni',
    text: (s) => `Gains ${val([40, 60, 90], s)} attack damage and 20% life-steal for 6s.`,
    cast(api, u) {
      api.buffStat(u, 'attack', 'flat', val([40, 60, 90], u.star), 6, 'oni');
      api.buffStat(u, 'lifesteal', 'flat', 0.20, 6, 'oni');
      api.fx('ring', { x: u.x, y: u.y, r: 1.2, dur: 0.6, tint: 'red' });
    },
  },

  jorogumo: {
    name: 'Web Snare',
    text: (s) => `Binds the two nearest enemies for 1.6s and deals ${val([100, 150, 230], s)} magic damage.`,
    cast(api, u) {
      const targets = api.nearestEnemies(u, 2);
      for (const t of targets) {
        api.damage(u, t, val([100, 150, 230], u.star), 'magic');
        api.root(t, 1.6);
        api.fx('web', { x: t.x, y: t.y, dur: 1.6 });
      }
    },
  },

  umibozu: {
    name: 'Black Tide',
    text: (s) => `A wave hits every enemy in front for ${val([220, 330, 500], s)} magic damage and stuns close ones for 1.2s.`,
    cast(api, u) {
      const dir = u.side === 'player' ? -1 : 1;
      for (const e of api.enemies(u)) {
        const d = hexDistance(e.cell(), u.cell());
        if (d > 3) continue;
        if ((e.row - u.row) * dir < 0) continue;
        api.damage(u, e, val([220, 330, 500], u.star), 'magic');
        if (d <= 2) api.stun(e, 1.2);
      }
      api.fx('tide', { u, dir, dur: 0.9 });
    },
  },

  nue: {
    name: 'Chimera',
    text: (s) => `For 7s gains 50% attack speed and its attacks deal ${val([70, 105, 160], s)} bonus magic damage.`,
    cast(api, u) {
      api.buffStat(u, 'attackSpeed', 'mult', 1.5, 7, 'nue');
      u.onHitMagic = val([70, 105, 160], u.star);
      u.onHitMagicUntil = api.sim.t + 7;
      api.fx('ring', { x: u.x, y: u.y, r: 1.3, dur: 0.6, tint: 'red' });
    },
  },

  gashadokuro: {
    name: 'Bone Colossus',
    text: (s) => `Devours the weakest enemy for ${val([380, 560, 900], s)} true damage, or executes it below 20% HP. Heals for half of it.`,
    cast(api, u) {
      const t = api.lowestHpEnemy(u);
      if (!t) return;
      const pct = t.hp / t.maxHp;
      const execute = pct < 0.20 && !t.boss;
      const dmg = execute ? t.hp : val([380, 560, 900], u.star);
      api.damage(u, t, dmg, 'true');
      api.heal(u, dmg * 0.5);
      api.fx('crunch', { x: t.x, y: t.y, dur: 0.6 });
    },
  },
};

/** Short helper for UI: ability name for a unit id. */
export function abilityName(defId) {
  return ABILITIES[defId] ? ABILITIES[defId].name : '';
}
