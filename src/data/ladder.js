/**
 * data/ladder.js — the campaign ladder.
 *
 * Each round names the yokai that appear (the "theme" of the encounter) and a
 * gold budget. The budget is spent automatically: every listed unit starts at
 * 1 star, then leftover budget upgrades units, most expensive first, until it
 * runs out.
 *
 * Squad sizes track the player's unit cap (round + 2, max 8) so fights are
 * about board quality rather than body count.
 *
 * `scale` is the stage pressure: it multiplies the squad's health and attack.
 * Budget shapes *who* shows up, scale fine-tunes *how hard the fight is*, which
 * is what keeps the difficulty curve smooth across nine rounds.
 */

export const LADDER = {
  1: {
    name: 'Lantern Road',
    units: ['tanuki', 'kappa', 'tanuki'],
    budget: 3,
    scale: 0.8,
  },
  2: {
    name: 'River Fog',
    units: ['kappa', 'tanuki', 'karakasa', 'kappa'],
    budget: 5,
    scale: 0.85,
  },
  3: {
    name: 'Bamboo Whispers',
    units: ['karakasa', 'kappa', 'yuki', 'tengu', 'kappa'],
    budget: 15,
    scale: 1.17,
  },
  4: {
    name: 'Mountain Pass',
    units: ['tengu', 'rokuro', 'karakasa', 'kappa', 'yuki', 'tengu'],
    budget: 25,
    scale: 1.05,
  },
  5: {
    name: 'Night Market',
    units: ['yuki', 'kappa', 'tanuki', 'karakasa', 'tengu', 'rokuro', 'karakasa'],
    budget: 23,
    scale: 1.18,
  },
  6: {
    name: 'Cursed Shrine',
    units: ['kitsune', 'rokuro', 'jorogumo', 'tengu', 'yuki', 'oni', 'karakasa', 'rokuro'],
    budget: 18,
    scale: 1.21,
  },
  7: {
    name: 'The Long Stair',
    units: ['oni', 'jorogumo', 'kitsune', 'tengu', 'karakasa', 'kappa', 'oni', 'yuki'],
    budget: 50,
    scale: 0.94,
  },
  8: {
    name: 'Black Tide',
    units: ['umibozu', 'nue', 'kitsune', 'jorogumo', 'oni', 'rokuro', 'yuki', 'karakasa'],
    budget: 46,
    scale: 1.04,
  },
  9: {
    name: 'Bone Colossus',
    boss: 'gashadokuro',
    units: ['nue', 'oni', 'umibozu', 'kitsune', 'jorogumo', 'tengu', 'karakasa'],
    budget: 64,
    scale: 0.68,
  },
};

export function ladderFor(round) {
  const r = Math.max(1, Math.min(9, round | 0));
  return LADDER[r];
}
