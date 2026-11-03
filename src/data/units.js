/**
 * data/units.js — the v0.1 roster.
 *
 * Field names follow the roadmap: id, name, cost, trait, hp, attack,
 * attackSpeed, range, moveSpeed, plus the combat extras (armor, mr, mana).
 * Star level multiplies hp/attack by 1.8 per star; ability tables in
 * data/abilities.js carry their own per-star numbers.
 */

import { CFG } from '../config.js';

export const STAR_MULT = 1.8;

export const UNITS = [
  // ---- cost 1 -----------------------------------------------------------
  {
    id: 'tanuki', name: 'Tanuki', cost: 1, trait: 'trickster',
    hp: 650, attack: 42, attackSpeed: 0.65, range: 1, moveSpeed: 3.0,
    armor: 25, mr: 20, mana: 60, startMana: 0,
    flavor: 'A sake-soaked shapeshifter with a drum for a belly.',
  },
  {
    id: 'kappa', name: 'Kappa', cost: 1, trait: 'water',
    hp: 600, attack: 44, attackSpeed: 0.70, range: 1, moveSpeed: 3.2,
    armor: 30, mr: 25, mana: 70, startMana: 0,
    flavor: 'River guardian. Polite, unless you forget to bow.',
  },

  // ---- cost 2 -----------------------------------------------------------
  {
    id: 'karakasa', name: 'Karakasa-obake', cost: 2, trait: 'trickster',
    hp: 700, attack: 48, attackSpeed: 0.75, range: 1, moveSpeed: 3.2,
    armor: 20, mr: 20, mana: 60, startMana: 0,
    flavor: 'A one-legged umbrella that hops out of the rain to scare you.',
  },
  {
    id: 'yuki', name: 'Yuki-onna', cost: 2, trait: 'water',
    hp: 550, attack: 36, attackSpeed: 0.70, range: 3, moveSpeed: 2.6,
    armor: 15, mr: 25, mana: 70, startMana: 0,
    flavor: 'Snow woman. Her breath stops a heart at ten paces.',
  },
  {
    id: 'tengu', name: 'Tengu', cost: 2, trait: 'mountain',
    hp: 650, attack: 52, attackSpeed: 0.80, range: 2, moveSpeed: 3.1,
    armor: 20, mr: 20, mana: 50, startMana: 0,
    flavor: 'Mountain goblin with a nose for arrogance and a fan of iron.',
  },
  {
    id: 'rokuro', name: 'Rokurokubi', cost: 2, trait: 'cursed',
    hp: 600, attack: 50, attackSpeed: 0.75, range: 3, moveSpeed: 2.8,
    armor: 18, mr: 22, mana: 60, startMana: 0,
    flavor: 'By day a woman; by night a neck that goes looking for trouble.',
  },

  // ---- cost 3 -----------------------------------------------------------
  {
    id: 'kitsune', name: 'Kitsune', cost: 3, trait: 'trickster',
    hp: 700, attack: 40, attackSpeed: 0.75, range: 4, moveSpeed: 2.6,
    armor: 15, mr: 30, mana: 80, startMana: 0,
    flavor: 'Fox spirit. Every tail is a lie it has told successfully.',
  },
  {
    id: 'oni', name: 'Oni', cost: 3, trait: 'mountain',
    hp: 950, attack: 65, attackSpeed: 0.70, range: 1, moveSpeed: 3.0,
    armor: 35, mr: 25, mana: 70, startMana: 0,
    flavor: 'An ogre of the high passes. Hits first, never asks.',
  },
  {
    id: 'jorogumo', name: 'Jorogumo', cost: 3, trait: 'cursed',
    hp: 800, attack: 55, attackSpeed: 0.80, range: 2, moveSpeed: 3.0,
    armor: 25, mr: 30, mana: 70, startMana: 0,
    flavor: 'Spider woman who keeps her suitors very close to home.',
  },

  // ---- cost 4 -----------------------------------------------------------
  {
    id: 'umibozu', name: 'Umibozu', cost: 4, trait: 'water',
    hp: 1150, attack: 60, attackSpeed: 0.60, range: 1, moveSpeed: 2.6,
    armor: 40, mr: 40, mana: 90, startMana: 0,
    flavor: 'The sea rising into a shape that has no face.',
  },
  {
    id: 'nue', name: 'Nue', cost: 4, trait: 'mountain',
    hp: 1000, attack: 75, attackSpeed: 0.90, range: 1, moveSpeed: 3.4,
    armor: 30, mr: 25, mana: 60, startMana: 0,
    flavor: 'Head of a monkey, body of a tiger, tail of a snake. Bad luck all round.',
  },
  {
    id: 'gashadokuro', name: 'Gashadokuro', cost: 4, trait: 'cursed',
    hp: 1050, attack: 80, attackSpeed: 0.70, range: 1, moveSpeed: 2.8,
    armor: 35, mr: 30, mana: 100, startMana: 0,
    flavor: 'A skeleton the size of a house, built from the unburied.',
  },
];

/** Fast lookup by id. */
export const UNIT_BY_ID = Object.fromEntries(UNITS.map((u) => [u.id, u]));

/** Units of one cost, used by the shop pool and the AI. */
export function unitsOfCost(cost) {
  return UNITS.filter((u) => u.cost === cost);
}

/** Star-scaled max hp. CFG.hpScale shortens every fight at once. */
export function hpAtStar(def, star) {
  return Math.round(def.hp * Math.pow(STAR_MULT, star - 1) * CFG.hpScale);
}

/** Star-scaled attack damage. */
export function attackAtStar(def, star) {
  return Math.round(def.attack * Math.pow(STAR_MULT, star - 1));
}

/** Copies consumed by a unit of this star (1 / 3 / 9). */
export function copiesOfStar(star) {
  return Math.pow(3, star - 1);
}

/** Sell value: full cost of every copy that went into the unit. */
export function sellValue(def, star) {
  return def.cost * copiesOfStar(star);
}

export const STAR_GLYPH = ['', '•', '••', '•••'];
