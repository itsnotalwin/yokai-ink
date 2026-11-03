/**
 * difficulty.js — three presets on the fitted difficulty curve.
 *
 * The ladder was fitted so a greedy bot wins roughly 100/100/97/97/85/70/63/65/45
 * per round (see tools/solve.mjs). Rather than hand-tune nine more squads per
 * preset, every preset is one multiplier applied to enemy health and attack on
 * top of that fitted `scale`. Because `scale` multiplies both stats, the ratio
 * between two presets is a clean percentage, and the curve keeps its shape.
 */

export const DIFFICULTIES = [
  {
    id: 'story',
    name: 'Story',
    scale: 0.9,
    blurb: 'Enemies are 10% softer. For learning the shop and the traits.',
  },
  {
    id: 'standard',
    name: 'Standard',
    scale: 1,
    blurb: 'The fitted curve. The run the balance tools measure.',
  },
  {
    id: 'ruthless',
    name: 'Ruthless',
    scale: 1.1,
    blurb: 'Enemies are 10% harder. The early rounds start to bite.',
  },
];

export const DEFAULT_DIFFICULTY = 'standard';

/** Look a preset up by id, falling back to Standard. */
export function difficultyById(id) {
  return DIFFICULTIES.find((d) => d.id === id) || DIFFICULTIES[1];
}

/** The enemy stat multiplier for a preset id. */
export function difficultyScale(id) {
  return difficultyById(id).scale;
}

/** Cycle Story -> Standard -> Ruthless -> Story. */
export function nextDifficulty(id) {
  const i = DIFFICULTIES.findIndex((d) => d.id === id);
  return DIFFICULTIES[(i + 1) % DIFFICULTIES.length].id;
}
