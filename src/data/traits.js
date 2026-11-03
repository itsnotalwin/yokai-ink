/**
 * data/traits.js — the four yokai traits and their 2/3 unit bonuses.
 *
 * Each trait has exactly three units in v0.1, so the tiers are 2 and 3.
 * `apply(api, unit, tier)` runs once per unit at the start of combat, where
 * `tier` is 0-based (0 = two units, 1 = three units).
 */

export const TRAITS = [
  {
    id: 'trickster', name: 'Trickster', glyph: '化',
    blurb: 'Misdirection. They are already somewhere else.',
    tiers: [
      { count: 2, text: 'Tricksters gain 20% dodge.' },
      { count: 3, text: 'Tricksters gain 35% dodge and 15% attack speed.' },
    ],
    apply(api, u, tier) {
      u.dodge += tier === 0 ? 0.20 : 0.35;
      if (tier >= 1) api.buffStat(u, 'attackSpeed', 'mult', 1.15, 9999, 'traits');
    },
  },
  {
    id: 'water', name: 'Water', glyph: '水',
    blurb: 'Stillness with weight behind it.',
    tiers: [
      { count: 2, text: 'Water units begin combat with a 15% max-HP shield.' },
      { count: 3, text: 'Water units begin combat with a 30% max-HP shield.' },
    ],
    apply(api, u, tier) {
      api.addShield(u, u.maxHp * (tier === 0 ? 0.15 : 0.30));
    },
  },
  {
    id: 'mountain', name: 'Mountain', glyph: '山',
    blurb: 'The mountain does not move. You move around it.',
    tiers: [
      { count: 2, text: 'Mountain units gain 20% attack damage.' },
      { count: 3, text: 'Mountain units gain 45% attack damage and 15 armour.' },
    ],
    apply(api, u, tier) {
      api.buffStat(u, 'attack', 'mult', tier === 0 ? 1.20 : 1.45, 9999, 'traits');
      if (tier >= 1) u.armor += 15;
    },
  },
  {
    id: 'cursed', name: 'Cursed', glyph: '呪',
    blurb: 'Something was paid for this power, and not by them.',
    tiers: [
      { count: 2, text: 'Cursed units heal for 15% of damage dealt.' },
      { count: 3, text: 'Cursed units heal 30% of damage dealt and their attacks leave an ink stain.' },
    ],
    apply(api, u, tier) {
      u.lifesteal += tier === 0 ? 0.15 : 0.30;
      if (tier >= 1) u.inkStain = true;
    },
  },
];

export const TRAIT_BY_ID = Object.fromEntries(TRAITS.map((t) => [t.id, t]));

/** Highest reached tier index for a unit count, or -1. */
export function tierIndexFor(trait, count) {
  let idx = -1;
  for (let i = 0; i < trait.tiers.length; i++) {
    if (count >= trait.tiers[i].count) idx = i;
  }
  return idx;
}
