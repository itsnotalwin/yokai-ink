/**
 * traits.js — synergy counting for the UI and for combat setup.
 *
 * A trait counts *distinct* yokai: two copies of the same Kappa still only
 * count once toward Water, exactly like TFT.
 */

import { TRAITS, tierIndexFor } from './data/traits.js';
import { UNIT_BY_ID } from './data/units.js';

/** @returns {Object<string, number>} trait id -> distinct unit count */
export function countTraits(units) {
  const seen = {};
  const counts = {};
  for (const u of units) {
    const def = UNIT_BY_ID[u.defId];
    if (!def) continue;
    if (seen[def.trait + ':' + def.id]) continue;
    seen[def.trait + ':' + def.id] = true;
    counts[def.trait] = (counts[def.trait] || 0) + 1;
  }
  return counts;
}

/**
 * Everything the synergy panel needs, in roster order.
 * tier: 0-based active tier or -1; next: the next tier object or null.
 */
export function traitSummaries(units) {
  const counts = countTraits(units);
  return TRAITS.map((trait) => {
    const count = counts[trait.id] || 0;
    const tier = tierIndexFor(trait, count);
    const next = trait.tiers.find((t) => count < t.count) || null;
    const members = units
      .filter((u) => UNIT_BY_ID[u.defId] && UNIT_BY_ID[u.defId].trait === trait.id)
      .map((u) => UNIT_BY_ID[u.defId].id);
    return { trait, count, tier, next, members };
  });
}

/** Active tier text for a trait summary (or '' when inactive). */
export function tierText(trait, tier) {
  if (tier < 0) return '';
  return trait.tiers[tier].text;
}
