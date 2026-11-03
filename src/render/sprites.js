/**
 * render/sprites.js — twelve yokai, painted in code.
 *
 * Each sprite is drawn once into a small offscreen canvas (transparent ink on
 * nothing), then stamped onto the paper at whatever size the board needs. That
 * keeps the frame cheap: the expensive brush work happens once per yokai.
 *
 * Coordinates inside a sprite are local units where the figure is roughly one
 * unit tall: feet at y ≈ +0.46, crown at y ≈ -0.46. The renderer scales that to
 * the hex radius, so a boss is just "the same yokai, drawn bigger".
 */

import { INK, blob, blobPath, tracePoly, brushLine, strokeRibbon, wash, splat, seal } from './ink.js';
import { makeRng } from '../rng.js';

const CANVAS = 256;
const SPAN = 196;          // local 1.0 unit maps to this many pixels
const CY = 150;            // local origin inside the sprite canvas

// ---------------------------------------------------------------------------
// Local helpers (all coordinates are in local units)
// ---------------------------------------------------------------------------

function ink(c, alpha = 1) {
  c.fillStyle = c.strokeStyle = INK.black;
  c.globalAlpha = alpha;
}

function dot(c, x, y, r, fill = INK.black, alpha = 1) {
  c.save();
  c.globalAlpha = alpha;
  c.fillStyle = fill;
  c.beginPath();
  c.arc(x, y, r, 0, 6.2832);
  c.fill();
  c.restore();
}

function eye(c, x, y, r, opts = {}) {
  // A brush eye: a filled almond, then a paper glint so it reads at small size.
  c.save();
  c.globalAlpha = opts.alpha === undefined ? 0.95 : opts.alpha;
  c.fillStyle = opts.fill || INK.black;
  c.beginPath();
  c.ellipse(x, y, r, r * 0.78, opts.tilt || 0, 0, 6.2832);
  c.fill();
  c.globalAlpha = (opts.alpha === undefined ? 0.95 : opts.alpha) * 0.85;
  c.fillStyle = '#f6efdf';
  c.beginPath();
  c.arc(x + r * 0.26, y - r * 0.26, r * 0.3, 0, 6.2832);
  c.fill();
  c.restore();
}

function limb(c, pts, width, opts = {}) {
  strokeRibbon(c, pts, {
    width, endWidth: opts.endWidth === undefined ? width * 0.45 : opts.endWidth,
    alpha: opts.alpha === undefined ? 0.95 : opts.alpha,
    bristle: opts.bristle || 0,
    seed: opts.seed || 3,
  });
}

function groundShadow(c, rx = 0.3, alpha = 0.16) {
  wash(c, 0, 0.45, rx, rx * 0.3, alpha);
}

function ring(c, x, y, r, width, alpha = 0.8, fill = INK.black) {
  c.save();
  c.globalAlpha = alpha;
  c.strokeStyle = fill;
  c.lineWidth = width;
  c.beginPath();
  c.arc(x, y, r, 0, 6.2832);
  c.stroke();
  c.restore();
}

// ---------------------------------------------------------------------------
// Dry brush
// ---------------------------------------------------------------------------

/**
 * Skip the ink off the paper in thin streaks, after the figure is painted.
 *
 * Silhouettes drawn with flat fills read as vector shapes; real sumi-e has
 * places where the brush ran dry and the paper shows through. This erodes the
 * sprite with low-alpha streaks so the figure looks loaded, not filled.
 * Runs in local units, so widths are fractions of the figure's height.
 */
function dryBrush(c, seed) {
  const rng = makeRng((seed | 0) + 41);
  c.save();
  c.globalCompositeOperation = 'destination-out';
  c.lineCap = 'round';

  for (let i = 0; i < 40; i++) {
    const x0 = rng.range(-0.42, 0.36);
    const y0 = rng.range(-0.46, 0.46);
    // Mostly along the figure's gesture (roughly horizontal), never a grid.
    const ang = rng.range(-0.55, 0.55);
    const len = rng.range(0.04, 0.19);
    const ca = Math.cos(ang), sa = Math.sin(ang);
    c.globalAlpha = rng.range(0.12, 0.42);
    c.strokeStyle = '#000';
    c.lineWidth = rng.range(0.004, 0.014);
    c.beginPath();
    c.moveTo(x0, y0);
    c.quadraticCurveTo(
      x0 + ca * len * 0.5 - sa * rng.range(-0.012, 0.012),
      y0 + sa * len * 0.5 + ca * rng.range(-0.012, 0.012),
      x0 + ca * len, y0 + sa * len,
    );
    c.stroke();
  }

  // A few larger patches, as if the brush ran out of water mid-stroke.
  for (let i = 0; i < 7; i++) {
    blob(c, rng.range(-0.3, 0.32), rng.range(-0.32, 0.4),
      rng.range(0.02, 0.075), rng.range(0.012, 0.05),
      { wobble: 0.5, rot: rng.range(-1, 1), seed: i + 101, alpha: rng.range(0.1, 0.26) });
  }
  c.restore();
}

// ---------------------------------------------------------------------------
// The roster
// ---------------------------------------------------------------------------

const painters = {
  // Round belly, leaf on the head, ringed tail. Reads as a friendly trickster.
  tanuki(c) {
    groundShadow(c, 0.34);
    // tail: a thick brush sweep with pale rings
    limb(c, [[0.18, 0.22], [0.4, 0.1], [0.44, -0.12], [0.32, -0.3]], 0.2, {
      seed: 2, endWidth: 0.09, bristle: 3,
    });
    c.save();
    c.globalAlpha = 0.8;
    c.fillStyle = '#f3ecdc';
    for (const [x, y, rot] of [[0.34, 0.1, 0.5], [0.43, -0.08, 0.15]]) {
      c.beginPath();
      c.ellipse(x, y, 0.032, 0.085, rot, 0, 6.2832);
      c.fill();
    }
    c.restore();
    // body
    blob(c, 0, 0.18, 0.3, 0.26, { seed: 21, wobble: 0.1 });
    // pale belly
    c.save();
    c.globalAlpha = 0.35;
    c.fillStyle = '#f6efdf';
    blob(c, 0.02, 0.2, 0.19, 0.18, { seed: 22, wobble: 0.14 });
    c.restore();
    // head, separated from the body by a paper gap
    c.save();
    c.globalAlpha = 0.55;
    c.strokeStyle = '#f6efdf';
    c.lineWidth = 0.05;
    c.beginPath();
    c.arc(0, -0.2, 0.215, 0.35, Math.PI - 0.35);
    c.stroke();
    c.restore();
    blob(c, 0, -0.22, 0.21, 0.19, { seed: 33, wobble: 0.08 });
    // ears: triangular, not round
    c.save();
    c.fillStyle = INK.black;
    for (const sx of [-1, 1]) {
      c.beginPath();
      c.moveTo(sx * 0.08, -0.35);
      c.lineTo(sx * 0.2, -0.5);
      c.lineTo(sx * 0.22, -0.32);
      c.closePath();
      c.fill();
    }
    c.restore();
    // raccoon mask: pale brows over dark eye patches
    c.save();
    c.globalAlpha = 0.85;
    c.fillStyle = '#f6efdf';
    blob(c, -0.09, -0.27, 0.075, 0.035, { seed: 55, rot: -0.2 });
    blob(c, 0.09, -0.27, 0.075, 0.035, { seed: 56, rot: 0.2 });
    c.restore();
    eye(c, -0.09, -0.2, 0.033);
    eye(c, 0.09, -0.2, 0.033);
    dot(c, 0, -0.13, 0.036);
    // leaf
    blob(c, 0.04, -0.44, 0.11, 0.05, { seed: 66, rot: -0.55, fill: INK.mid, alpha: 0.85 });
    limb(c, [[0.02, -0.42], [-0.04, -0.34]], 0.014, { alpha: 0.8 });
    // feet
    blob(c, -0.16, 0.43, 0.085, 0.045, { seed: 77 });
    blob(c, 0.16, 0.43, 0.085, 0.045, { seed: 78 });
  },

  // Turtle-backed river spirit with the water dish on its head.
  kappa(c) {
    groundShadow(c, 0.33);
    // shell: a dome behind the body, with plates
    c.save();
    c.globalAlpha = 0.95;
    c.fillStyle = INK.black;
    c.beginPath();
    c.ellipse(0, 0.18, 0.31, 0.27, 0, Math.PI, Math.PI * 2);
    c.closePath();
    c.fill();
    c.globalAlpha = 0.4;
    c.strokeStyle = '#f3ecdc';
    c.lineWidth = 0.013;
    for (let i = 1; i < 5; i++) {
      const a = Math.PI + (i / 5) * Math.PI;
      c.beginPath();
      c.moveTo(0, 0.18);
      c.lineTo(Math.cos(a) * 0.3, 0.18 + Math.sin(a) * 0.26);
      c.stroke();
    }
    for (const k of [0.55, 0.85]) {
      c.beginPath();
      c.ellipse(0, 0.18, 0.31 * k, 0.27 * k, 0, Math.PI, Math.PI * 2);
      c.stroke();
    }
    c.restore();
    // shell rim
    limb(c, [[-0.3, 0.16], [0.3, 0.16]], 0.03, { seed: 11, alpha: 0.9 });
    // legs under the shell
    limb(c, [[-0.12, 0.3], [-0.14, 0.42]], 0.06, { seed: 17, endWidth: 0.05 });
    limb(c, [[0.12, 0.3], [0.14, 0.42]], 0.06, { seed: 18, endWidth: 0.05 });
    // head
    blob(c, 0, -0.18, 0.19, 0.16, { seed: 13, wobble: 0.07 });
    // beak
    c.save();
    c.fillStyle = INK.black;
    c.beginPath();
    c.moveTo(0.13, -0.19);
    c.lineTo(0.27, -0.15);
    c.lineTo(0.13, -0.1);
    c.closePath();
    c.fill();
    c.restore();
    // water dish: a wide shallow bowl with a raised rim
    c.save();
    c.globalAlpha = 0.95;
    c.strokeStyle = INK.black;
    c.lineWidth = 0.028;
    c.beginPath();
    c.ellipse(0, -0.38, 0.16, 0.05, 0, 0, 6.2832);
    c.stroke();
    c.globalAlpha = 0.4;
    c.fillStyle = INK.mid;
    c.beginPath();
    c.ellipse(0, -0.38, 0.13, 0.035, 0, 0, 6.2832);
    c.fill();
    c.globalAlpha = 0.25;
    c.strokeStyle = '#f6efdf';
    c.lineWidth = 0.012;
    c.beginPath();
    c.ellipse(0, -0.385, 0.075, 0.02, 0, 0, 6.2832);
    c.stroke();
    c.restore();
    eye(c, -0.08, -0.2, 0.026);
    eye(c, 0.06, -0.2, 0.026);
    // webbed hands
    for (const sx of [-1, 1]) {
      limb(c, [[sx * 0.2, 0.06], [sx * 0.32, 0.16], [sx * 0.3, 0.27]], 0.05, { seed: 14 + sx });
      c.save();
      c.globalAlpha = 0.75;
      c.strokeStyle = INK.black;
      c.lineWidth = 0.012;
      for (let i = 0; i < 3; i++) {
        c.beginPath();
        c.moveTo(sx * 0.3, 0.25);
        c.lineTo(sx * (0.28 + i * 0.03), 0.33);
        c.stroke();
      }
      c.restore();
    }
    blob(c, -0.12, 0.4, 0.075, 0.04, { seed: 15 });
    blob(c, 0.12, 0.4, 0.075, 0.04, { seed: 16 });
  },

  // One-eyed umbrella: canopy, ribs, tongue, one geta.
  karakasa(c) {
    groundShadow(c, 0.3);
    // canopy
    c.save();
    c.globalAlpha = 0.95;
    c.fillStyle = INK.black;
    c.beginPath();
    c.moveTo(-0.36, -0.04);
    c.quadraticCurveTo(-0.3, -0.42, 0, -0.46);
    c.quadraticCurveTo(0.3, -0.42, 0.36, -0.04);
    c.quadraticCurveTo(0, 0.04, -0.36, -0.04);
    c.closePath();
    c.fill();
    c.restore();
    // ribs
    c.save();
    c.globalAlpha = 0.45;
    c.strokeStyle = '#f3ecdc';
    c.lineWidth = 0.016;
    for (const dx of [-0.26, -0.11, 0.11, 0.26]) {
      c.beginPath();
      c.moveTo(0, -0.44);
      c.quadraticCurveTo(dx * 1.1, -0.24, dx, -0.02);
      c.stroke();
    }
    c.restore();
    // body / face
    blob(c, 0, 0.05, 0.16, 0.13, { seed: 22, wobble: 0.08 });
    dot(c, 0, 0.02, 0.075, '#f3ecdc', 0.95);
    eye(c, 0, 0.02, 0.052);
    // tongue
    c.save();
    c.globalAlpha = 0.9;
    c.fillStyle = INK.mid;
    c.beginPath();
    c.moveTo(-0.03, 0.1);
    c.quadraticCurveTo(0, 0.24, 0.03, 0.1);
    c.closePath();
    c.fill();
    c.restore();
    // leg + geta
    limb(c, [[0.02, 0.16], [0.06, 0.3], [0.02, 0.4]], 0.035, { seed: 23 });
    c.save();
    c.globalAlpha = 0.95;
    c.fillStyle = INK.black;
    c.fillRect(-0.06, 0.4, 0.17, 0.05);
    c.restore();
    // tassel
    limb(c, [[-0.34, -0.02], [-0.3, 0.08]], 0.02, { seed: 24, alpha: 0.7 });
  },

  // Tall, hair-heavy, dissolving into mist at the hem.
  yuki(c) {
    wash(c, 0, 0.32, 0.42, 0.16, 0.18);
    // kimono: a narrow column that widens to the hem
    c.save();
    c.globalAlpha = 0.95;
    c.fillStyle = INK.black;
    c.beginPath();
    c.moveTo(-0.13, -0.22);
    c.lineTo(0.13, -0.22);
    c.lineTo(0.24, 0.32);
    c.quadraticCurveTo(0, 0.42, -0.24, 0.32);
    c.closePath();
    c.fill();
    c.restore();
    // collar
    c.save();
    c.globalAlpha = 0.6;
    c.strokeStyle = '#f6efdf';
    c.lineWidth = 0.018;
    c.beginPath();
    c.moveTo(-0.08, -0.22);
    c.lineTo(0, -0.1);
    c.lineTo(0.08, -0.22);
    c.stroke();
    c.beginPath();
    c.moveTo(-0.17, 0.04);
    c.lineTo(0.17, 0.04);
    c.stroke();
    c.restore();
    // hair: a heavy mass framing a pale face
    limb(c, [[-0.06, -0.42], [-0.2, -0.26], [-0.24, 0.1]], 0.13, { seed: 41, endWidth: 0.02 });
    limb(c, [[0.06, -0.42], [0.2, -0.26], [0.24, 0.1]], 0.13, { seed: 42, endWidth: 0.02 });
    blob(c, 0, -0.34, 0.165, 0.15, { seed: 31, wobble: 0.06 });
    c.save();
    c.globalAlpha = 0.92;
    c.fillStyle = '#f3ecdc';
    c.beginPath();
    c.ellipse(0, -0.31, 0.093, 0.105, 0, 0, 6.2832);
    c.fill();
    c.restore();
    // long side locks
    limb(c, [[-0.16, -0.4], [-0.24, -0.18], [-0.2, 0.12]], 0.06, { seed: 43, endWidth: 0.008 });
    limb(c, [[0.16, -0.4], [0.24, -0.18], [0.2, 0.12]], 0.06, { seed: 44, endWidth: 0.008 });
    eye(c, -0.035, -0.32, 0.017, { fill: INK.mid });
    eye(c, 0.035, -0.32, 0.017, { fill: INK.mid });
    // a single vermilion hairpin — the only colour on her
    dot(c, 0.1, -0.42, 0.015, INK.vermilion, 0.9);
    // sleeves
    limb(c, [[-0.12, -0.16], [-0.28, -0.04], [-0.26, 0.12]], 0.08, { seed: 45, endWidth: 0.05 });
    limb(c, [[0.12, -0.16], [0.28, -0.04], [0.26, 0.12]], 0.08, { seed: 46, endWidth: 0.05 });
    // mist at the hem
    for (let i = 0; i < 3; i++) {
      wash(c, -0.2 + i * 0.2, 0.4 + (i % 2) * 0.03, 0.17, 0.05, 0.16);
    }
  },

  // Mountain guardian: beak-nosed, winged, fan in hand.
  tengu(c) {
    groundShadow(c, 0.3);
    // wings behind
    for (const sx of [-1, 1]) {
      c.save();
      c.globalAlpha = 0.9;
      c.fillStyle = INK.black;
      c.beginPath();
      c.moveTo(sx * 0.08, -0.12);
      c.quadraticCurveTo(sx * 0.46, -0.34, sx * 0.4, 0.06);
      c.quadraticCurveTo(sx * 0.3, 0.02, sx * 0.1, 0.1);
      c.closePath();
      c.fill();
      c.restore();
      c.save();
      c.globalAlpha = 0.5;
      c.strokeStyle = '#f3ecdc';
      c.lineWidth = 0.012;
      for (let i = 0; i < 4; i++) {
        c.beginPath();
        c.moveTo(sx * 0.12, -0.06 + i * 0.04);
        c.lineTo(sx * (0.34 - i * 0.02), -0.2 + i * 0.07);
        c.stroke();
      }
      c.restore();
    }
    // body
    blob(c, 0, 0.12, 0.17, 0.24, { seed: 51, wobble: 0.08 });
    // head + long nose
    blob(c, 0, -0.2, 0.14, 0.13, { seed: 52, wobble: 0.06 });
    c.save();
    c.globalAlpha = 0.95;
    c.fillStyle = INK.vermilion;
    c.beginPath();
    c.ellipse(0.02, -0.21, 0.1, 0.075, 0.1, 0, 6.2832);
    c.fill();
    c.restore();
    limb(c, [[0.06, -0.2], [0.26, -0.16]], 0.05, { seed: 53, endWidth: 0.01 });
    eye(c, -0.02, -0.22, 0.024);
    eye(c, 0.09, -0.22, 0.02);
    // fan
    limb(c, [[-0.24, 0.02], [-0.3, -0.12]], 0.018, { seed: 54 });
    c.save();
    c.globalAlpha = 0.9;
    c.fillStyle = INK.mid;
    c.beginPath();
    c.ellipse(-0.33, -0.1, 0.09, 0.13, -0.5, 0, 6.2832);
    c.fill();
    c.restore();
    // robe hem + feet
    c.save();
    c.globalAlpha = 0.9;
    c.fillStyle = INK.black;
    c.beginPath();
    c.moveTo(-0.16, 0.3);
    c.lineTo(0.16, 0.3);
    c.lineTo(0.2, 0.42);
    c.lineTo(-0.2, 0.42);
    c.closePath();
    c.fill();
    c.restore();
  },

  // The long neck. Head floats up and to the side, hair trailing.
  rokuro(c) {
    groundShadow(c, 0.32);
    // seated body: a robe mound
    blob(c, 0, 0.3, 0.25, 0.16, { seed: 61, wobble: 0.08 });
    // shoulders
    blob(c, 0, 0.18, 0.17, 0.12, { seed: 62, wobble: 0.1 });
    // neck: a long, thick, tapering S curve
    limb(c, [[0, 0.12], [-0.05, 0.0], [0.1, -0.14], [0.07, -0.26]], 0.075, {
      seed: 63, endWidth: 0.05, alpha: 0.97,
    });
    // head at the end of the neck
    blob(c, 0.07, -0.32, 0.115, 0.105, { seed: 64, wobble: 0.06 });
    c.save();
    c.globalAlpha = 0.85;
    c.fillStyle = '#f3ecdc';
    c.beginPath();
    c.ellipse(0.075, -0.31, 0.062, 0.07, 0, 0, 6.2832);
    c.fill();
    c.restore();
    // hair: three trails back to the shoulders
    for (const [dx, seed] of [[-0.02, 65], [0.06, 66], [0.14, 67]]) {
      limb(c, [[0.07 + dx * 0.3, -0.42], [0.07 + dx, -0.2], [0.06 + dx * 1.1, 0.06]], 0.06, {
        seed, endWidth: 0.006, alpha: 0.9,
      });
    }
    eye(c, 0.035, -0.32, 0.018);
    eye(c, 0.105, -0.32, 0.018);
    // mouth
    c.save();
    c.globalAlpha = 0.7;
    c.strokeStyle = INK.black;
    c.lineWidth = 0.01;
    c.beginPath();
    c.moveTo(0.05, -0.27);
    c.quadraticCurveTo(0.07, -0.25, 0.1, -0.27);
    c.stroke();
    c.restore();
  },

  // Fox: low body, three bushy flame tails, foxfire.
  kitsune(c) {
    groundShadow(c, 0.34);
    // tails: three broad brush sweeps fanning up and back
    for (const [i, seed] of [[0, 71], [1, 72], [2, 73]]) {
      const dx = (i - 1) * 0.16;
      limb(c, [[0.16, 0.14], [0.32 + dx, -0.04], [0.34 + dx * 1.4, -0.28]], 0.19, {
        seed, endWidth: 0.07, bristle: 4,
      });
      dot(c, 0.34 + dx * 1.4, -0.3, 0.045, '#f3ecdc', 0.85);
    }
    // body
    blob(c, 0, 0.16, 0.26, 0.15, { seed: 74, wobble: 0.08 });
    // legs
    for (const x of [-0.16, -0.02, 0.1]) limb(c, [[x, 0.24], [x + 0.01, 0.4]], 0.045, { seed: 75 + x * 10 });
    // head
    blob(c, -0.18, -0.14, 0.16, 0.125, { seed: 76, wobble: 0.07 });
    // ears
    c.save();
    c.fillStyle = INK.black;
    c.beginPath();
    c.moveTo(-0.28, -0.24); c.lineTo(-0.26, -0.42); c.lineTo(-0.14, -0.26); c.closePath();
    c.fill();
    c.beginPath();
    c.moveTo(-0.12, -0.26); c.lineTo(-0.06, -0.44); c.lineTo(-0.01, -0.24); c.closePath();
    c.fill();
    c.restore();
    // long snout
    c.save();
    c.fillStyle = INK.black;
    c.beginPath();
    c.moveTo(-0.26, -0.16);
    c.quadraticCurveTo(-0.42, -0.14, -0.46, -0.08);
    c.quadraticCurveTo(-0.36, -0.05, -0.24, -0.08);
    c.closePath();
    c.fill();
    c.restore();
    dot(c, -0.44, -0.09, 0.012, '#f3ecdc', 0.9);
    eye(c, -0.23, -0.17, 0.022);
    // foxfire
    for (const [x, y, r] of [[-0.4, -0.34, 0.03], [-0.28, -0.48, 0.022], [-0.5, -0.2, 0.017]]) {
      wash(c, x, y, r * 2.6, r * 2.6, 0.24, '194,65,42');
      dot(c, x, y, r, INK.vermilion, 0.9);
    }
  },

  // Horned brute with a club and tiger-striped loincloth.
  oni(c) {
    groundShadow(c, 0.36);
    // kanabo: a long studded club held across the body
    limb(c, [[0.16, 0.3], [0.3, 0.06], [0.34, -0.26]], 0.075, { seed: 81, endWidth: 0.13, alpha: 0.96 });
    c.save();
    c.globalAlpha = 0.5;
    c.fillStyle = '#f3ecdc';
    for (let i = 0; i < 5; i++) {
      const t = i / 4;
      dot(c, 0.3 + t * 0.04, 0.04 - t * 0.28, 0.011);
    }
    c.restore();
    // body
    blob(c, 0, 0.12, 0.29, 0.26, { seed: 82, wobble: 0.12 });
    // shoulders
    blob(c, -0.22, -0.02, 0.11, 0.1, { seed: 82.5, wobble: 0.15 });
    blob(c, 0.2, -0.06, 0.1, 0.09, { seed: 82.6, wobble: 0.15 });
    // arms
    limb(c, [[-0.2, 0.0], [-0.35, 0.14], [-0.28, 0.3]], 0.1, { seed: 83 });
    limb(c, [[0.18, 0.0], [0.3, 0.08], [0.3, 0.22]], 0.095, { seed: 84 });
    // head
    blob(c, 0, -0.26, 0.18, 0.15, { seed: 85, wobble: 0.1 });
    // horns
    c.save();
    c.fillStyle = INK.black;
    for (const sx of [-1, 1]) {
      c.beginPath();
      c.moveTo(sx * 0.09, -0.36);
      c.quadraticCurveTo(sx * 0.2, -0.48, sx * 0.15, -0.54);
      c.quadraticCurveTo(sx * 0.05, -0.45, sx * 0.03, -0.36);
      c.closePath();
      c.fill();
    }
    c.restore();
    // face
    c.save();
    c.globalAlpha = 0.92;
    c.fillStyle = INK.vermilion;
    c.beginPath();
    c.ellipse(0, -0.24, 0.125, 0.095, 0, 0, 6.2832);
    c.fill();
    c.restore();
    // eyes: pale with dark pupils, so they read at board size
    for (const sx of [-1, 1]) {
      dot(c, sx * 0.055, -0.27, 0.03, '#f6efdf', 0.95);
      dot(c, sx * 0.055, -0.27, 0.014);
    }
    // brow stroke
    limb(c, [[-0.1, -0.34], [0.1, -0.32]], 0.018, { seed: 86, alpha: 0.8 });
    // fangs
    c.save();
    c.fillStyle = '#f6efdf';
    c.globalAlpha = 0.95;
    for (const sx of [-1, 1]) {
      c.beginPath();
      c.moveTo(sx * 0.03, -0.17);
      c.lineTo(sx * 0.05, -0.1);
      c.lineTo(sx * 0.01, -0.17);
      c.closePath();
      c.fill();
    }
    c.restore();
    // loincloth
    c.save();
    c.globalAlpha = 0.92;
    c.fillStyle = INK.mid;
    c.beginPath();
    c.moveTo(-0.25, 0.32);
    c.lineTo(0.25, 0.32);
    c.lineTo(0.27, 0.42);
    c.lineTo(-0.27, 0.42);
    c.closePath();
    c.fill();
    c.globalAlpha = 0.55;
    c.fillStyle = '#f3ecdc';
    for (let i = -2; i <= 2; i++) c.fillRect(i * 0.1 - 0.011, 0.32, 0.02, 0.1);
    c.restore();
  },

  // Spider woman: eight legs, web threads, human torso.
  jorogumo(c) {
    groundShadow(c, 0.38);
    // web
    c.save();
    c.globalAlpha = 0.22;
    c.strokeStyle = INK.black;
    c.lineWidth = 0.012;
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * 6.2832;
      c.beginPath();
      c.moveTo(0, 0.05);
      c.lineTo(Math.cos(a) * 0.48, 0.05 + Math.sin(a) * 0.3);
      c.stroke();
    }
    for (let r = 0.16; r < 0.48; r += 0.12) {
      c.beginPath();
      for (let i = 0; i <= 8; i++) {
        const a = (i / 8) * 6.2832;
        const x = Math.cos(a) * r, y = 0.05 + Math.sin(a) * r * 0.62;
        if (i === 0) c.moveTo(x, y); else c.lineTo(x, y);
      }
      c.stroke();
    }
    c.restore();
    // legs
    for (let i = 0; i < 4; i++) {
      for (const sx of [-1, 1]) {
        const spread = 0.16 + i * 0.07;
        limb(c, [[sx * 0.08, 0.1], [sx * spread * 1.5, -0.02 + i * 0.04], [sx * spread * 1.9, 0.3 + i * 0.02]], 0.028, { seed: 91 + i, endWidth: 0.006 });
      }
    }
    // abdomen
    blob(c, 0, 0.24, 0.14, 0.12, { seed: 92, wobble: 0.14 });
    // torso
    blob(c, 0, -0.06, 0.11, 0.16, { seed: 93, wobble: 0.08 });
    // head
    blob(c, 0, -0.26, 0.09, 0.09, { seed: 94, wobble: 0.06 });
    // hair bun
    blob(c, 0, -0.35, 0.06, 0.045, { seed: 95 });
    limb(c, [[0, -0.3], [-0.12, -0.16], [-0.14, 0.02]], 0.05, { seed: 96, endWidth: 0.01 });
    limb(c, [[0, -0.3], [0.12, -0.16], [0.14, 0.02]], 0.05, { seed: 97, endWidth: 0.01 });
    eye(c, -0.04, -0.26, 0.016);
    eye(c, 0.04, -0.26, 0.016);
    dot(c, 0.02, 0.2, 0.03, INK.vermilion, 0.8);
  },

  // The black tide: an enormous dark head with two pale eyes.
  umibozu(c) {
    // sea body
    c.save();
    c.globalAlpha = 0.5;
    c.fillStyle = INK.black;
    c.beginPath();
    c.moveTo(-0.5, 0.44);
    c.quadraticCurveTo(-0.3, 0.16, 0, 0.2);
    c.quadraticCurveTo(0.3, 0.16, 0.5, 0.44);
    c.closePath();
    c.fill();
    c.restore();
    for (let i = 0; i < 4; i++) {
      wash(c, (i - 1.5) * 0.24, 0.34, 0.2, 0.07, 0.16);
    }
    // the head-mass
    blob(c, 0, 0.0, 0.34, 0.32, { seed: 101, wobble: 0.16 });
    blob(c, -0.02, -0.08, 0.28, 0.26, { seed: 102, wobble: 0.13, alpha: 0.5 });
    // pale eyes
    for (const sx of [-1, 1]) {
      c.save();
      c.globalAlpha = 0.95;
      c.fillStyle = '#f3ecdc';
      c.beginPath();
      c.ellipse(sx * 0.12, -0.1, 0.06, 0.045, sx * 0.2, 0, 6.2832);
      c.fill();
      c.globalAlpha = 0.85;
      c.fillStyle = INK.black;
      c.beginPath();
      c.arc(sx * 0.12, -0.1, 0.024, 0, 6.2832);
      c.fill();
      c.restore();
    }
    // drips
    for (let i = 0; i < 5; i++) {
      limb(c, [[-0.3 + i * 0.15, 0.24], [-0.3 + i * 0.15, 0.32 + (i % 2) * 0.06]], 0.015, { seed: 103 + i, alpha: 0.6 });
    }
  },

  // Chimera: monkey head, tiger body, snake tail.
  nue(c) {
    groundShadow(c, 0.36);
    // snake tail
    limb(c, [[0.24, 0.16], [0.4, 0.04], [0.44, -0.14], [0.34, -0.26]], 0.05, { seed: 111, endWidth: 0.012 });
    limb(c, [[0.34, -0.26], [0.42, -0.3], [0.38, -0.36]], 0.03, { seed: 112, endWidth: 0.02 });
    // body
    blob(c, 0, 0.12, 0.28, 0.16, { seed: 113, wobble: 0.08 });
    // tiger stripes
    c.save();
    c.globalAlpha = 0.55;
    c.strokeStyle = '#f3ecdc';
    c.lineWidth = 0.018;
    for (let i = -1; i <= 1; i++) {
      c.beginPath();
      c.moveTo(-0.06 + i * 0.1, 0.0);
      c.quadraticCurveTo(-0.02 + i * 0.1, 0.12, -0.08 + i * 0.1, 0.24);
      c.stroke();
    }
    c.restore();
    // legs
    for (const x of [-0.18, -0.04, 0.12]) limb(c, [[x, 0.2], [x, 0.38]], 0.04, { seed: 114 + x * 20 });
    // head
    blob(c, -0.24, -0.1, 0.14, 0.14, { seed: 115, wobble: 0.09 });
    // ears
    blob(c, -0.32, -0.22, 0.05, 0.05, { seed: 116 });
    blob(c, -0.16, -0.22, 0.05, 0.05, { seed: 117 });
    // monkey face
    c.save();
    c.globalAlpha = 0.55;
    c.fillStyle = '#f6efdf';
    blob(c, -0.26, -0.08, 0.09, 0.09, { seed: 118 });
    c.restore();
    eye(c, -0.3, -0.11, 0.02);
    eye(c, -0.2, -0.11, 0.02);
    dot(c, -0.25, -0.02, 0.014);
    // fang
    c.save();
    c.fillStyle = '#f6efdf';
    c.beginPath();
    c.moveTo(-0.29, -0.02); c.lineTo(-0.27, 0.03); c.lineTo(-0.25, -0.02);
    c.closePath();
    c.fill();
    c.restore();
  },

  // The boss: a skull and a ribcage the size of a house.
  gashadokuro(c) {
    wash(c, 0, 0.3, 0.44, 0.2, 0.2);
    // ribcage
    c.save();
    c.globalAlpha = 0.95;
    c.strokeStyle = INK.black;
    c.lineWidth = 0.028;
    for (let i = 0; i < 4; i++) {
      c.beginPath();
      c.moveTo(-0.02, 0.06 + i * 0.09);
      c.quadraticCurveTo(-0.24, 0.08 + i * 0.09, -0.2, 0.16 + i * 0.09);
      c.stroke();
      c.beginPath();
      c.moveTo(-0.02, 0.06 + i * 0.09);
      c.quadraticCurveTo(0.2, 0.08 + i * 0.09, 0.17, 0.16 + i * 0.09);
      c.stroke();
    }
    c.restore();
    // spine
    limb(c, [[0, 0.02], [0, 0.42]], 0.045, { seed: 121 });
    // arms
    limb(c, [[-0.2, 0.02], [-0.36, 0.16], [-0.32, 0.3]], 0.06, { seed: 122, endWidth: 0.02 });
    limb(c, [[0.2, 0.02], [0.36, 0.16], [0.32, 0.3]], 0.06, { seed: 123, endWidth: 0.02 });
    // skull
    blob(c, 0, -0.22, 0.24, 0.22, { seed: 124, wobble: 0.1 });
    // jaw
    c.save();
    c.globalAlpha = 0.95;
    c.fillStyle = INK.black;
    c.beginPath();
    c.moveTo(-0.16, -0.04);
    c.lineTo(0.16, -0.04);
    c.lineTo(0.12, 0.06);
    c.lineTo(-0.12, 0.06);
    c.closePath();
    c.fill();
    c.restore();
    // teeth
    c.save();
    c.globalAlpha = 0.5;
    c.strokeStyle = '#f3ecdc';
    c.lineWidth = 0.008;
    for (let i = -3; i <= 3; i++) {
      c.beginPath();
      c.moveTo(i * 0.045, -0.04);
      c.lineTo(i * 0.045, 0.05);
      c.stroke();
    }
    c.restore();
    // hollow eyes, vermilion
    for (const sx of [-1, 1]) {
      c.save();
      c.globalAlpha = 0.95;
      c.fillStyle = INK.vermilion;
      c.beginPath();
      c.ellipse(sx * 0.1, -0.24, 0.07, 0.06, 0, 0, 6.2832);
      c.fill();
      c.globalAlpha = 1;
      c.fillStyle = INK.black;
      c.beginPath();
      c.arc(sx * 0.1, -0.24, 0.03, 0, 6.2832);
      c.fill();
      c.restore();
    }
    // cracks
    c.save();
    c.globalAlpha = 0.35;
    c.strokeStyle = '#f3ecdc';
    c.lineWidth = 0.012;
    c.beginPath();
    c.moveTo(-0.06, -0.4);
    c.lineTo(-0.02, -0.32);
    c.lineTo(-0.08, -0.28);
    c.stroke();
    c.restore();
  },
};

// ---------------------------------------------------------------------------
// Cache
// ---------------------------------------------------------------------------

const cache = new Map();

/**
 * Return the painted sprite for a yokai: a 256×256 canvas with the figure
 * centred, plus the local->pixel scale so the renderer can size it.
 */
export function spriteFor(defId) {
  if (cache.has(defId)) return cache.get(defId);
  const paint = painters[defId];
  const c = document.createElement('canvas');
  c.width = CANVAS;
  c.height = CANVAS;
  const g = c.getContext('2d');
  g.save();
  g.translate(CANVAS / 2, CY);
  g.scale(SPAN, SPAN);
  g.lineCap = 'round';
  g.lineJoin = 'round';
  if (paint) paint(g);
  dryBrush(g, defId.length * 31 + defId.charCodeAt(0));
  g.restore();

  const out = { canvas: c, span: SPAN, cy: CY, ready: true };
  cache.set(defId, out);
  return out;
}

/** Canvas for a yokai, guaranteed painted. */
export function spriteCanvas(defId) {
  return spriteFor(defId).canvas;
}

/**
 * A paper-coloured cut-out of the same yokai, a few pixels fatter.
 *
 * Board sprites overlap when units stand next to each other, and two ink
 * silhouettes touching read as one animal. Drawing this rim underneath gives
 * every figure a pale breath of paper around it, like cut-outs laid on a page.
 */
export function spriteRim(defId, color = '#efe6d3') {
  const key = `rim:${defId}:${color}`;
  if (cache.has(key)) return cache.get(key);
  const src = spriteFor(defId).canvas;
  const c = document.createElement('canvas');
  c.width = CANVAS;
  c.height = CANVAS;
  const g = c.getContext('2d');
  const reach = 8;
  for (let i = 0; i < 18; i++) {
    const a = (i / 18) * Math.PI * 2;
    g.drawImage(src, Math.cos(a) * reach, Math.sin(a) * reach);
  }
  g.drawImage(src, 0, 0);
  // Flood only the pixels the silhouette covers.
  g.globalCompositeOperation = 'source-in';
  g.fillStyle = color;
  g.fillRect(0, 0, CANVAS, CANVAS);
  cache.set(key, c);
  return c;
}

/** Small square badge with the yokai's face — used on shop cards and the bench. */
export function spriteThumb(defId, size) {
  const key = `thumb:${defId}:${size}`;
  if (cache.has(key)) return cache.get(key);
  const src = spriteFor(defId).canvas;
  const c = document.createElement('canvas');
  c.width = size;
  c.height = size;
  const g = c.getContext('2d');
  const s = size / CANVAS;
  g.drawImage(src, 0, 0, CANVAS, CANVAS, 0, 0, size, size);
  void s;
  cache.set(key, c);
  return c;
}

export const SPRITE_IDS = Object.keys(painters);
