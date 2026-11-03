/**
 * render/fx.js — things that happen for a moment and then are gone.
 *
 * The simulation pushes plain records into `sim.effects` (damage numbers,
 * splats, cast rings). This module is the only place that knows how to draw
 * them, so the sim keeps its guarantee of being DOM-free.
 */

import { INK, splat, wash, seal, inkText, blob, strokeRibbon } from './ink.js';
import { makeRng } from '../rng.js';

const easeOut = (t) => 1 - Math.pow(1 - t, 3);
const easeIn = (t) => t * t;

function age(fx, t) {
  return Math.min(1, Math.max(0, (t - fx.t0) / (fx.dur || 0.5)));
}

/**
 * Draw one effect. `to` converts hex-unit coordinates to screen pixels.
 * `t` is the simulation clock (`sim.t`), not wall time, so 4x speed looks 4x.
 */
export function drawEffect(ctx, fx, t, to) {
  const p = age(fx, t);
  if (p >= 1) return;
  const pos = to(fx.x, fx.y);

  switch (fx.type) {
    case 'text': {
      // Damage numbers: they leap up and settle, fading like wet ink. Size and
      // colour carry the information — a 12 is a scratch, a 300 is a verdict.
      const rise = easeOut(p) * (fx.value >= 120 ? 54 : 40);
      const alpha = p < 0.7 ? 1 : 1 - (p - 0.7) / 0.3;
      const big = fx.value >= 120;
      const mid = fx.value >= 55;
      // A per-hit offset so four numbers in one hex do not print on top of
      // each other. The spread is wider than the digits are tall, because a
      // brawl lands several hits on the same cell in the same second.
      const jx = ((fx.seed || 0) % 23) - 11;
      const jy = ((fx.seed || 0) % 13) - 6;
      ctx.save();
      ctx.globalAlpha = alpha * (big ? 0.98 : 0.85);
      inkText(ctx, String(fx.value), pos.x + jx, pos.y - 22 - rise + jy, {
        size: big ? 30 : mid ? 23 : 17,
        align: 'center',
        fill: fx.kind === 'true' ? INK.vermilion : fx.kind === 'magic' ? INK.vermilionDeep : INK.black,
        weight: big || mid ? '600' : '500',
        alpha: 0.95,
      });
      ctx.restore();
      break;
    }
    case 'healText': {
      const rise = easeOut(p) * 38;
      ctx.save();
      ctx.globalAlpha = (1 - p) * 0.75;
      inkText(ctx, '+' + fx.value, pos.x, pos.y - 20 - rise, {
        size: 19, align: 'center', fill: '#4b6b4a', weight: '600',
      });
      ctx.restore();
      break;
    }
    case 'splat': {
      // Ink thrown along the line of the blow, not a polite circle at the feet.
      const r = (fx.heavy ? 15 : 9) + easeOut(p) * (fx.heavy ? 22 : 13);
      const dir = fx.dir || 0;
      const push = 6 + easeOut(p) * 12;
      const cx = pos.x + Math.cos(dir) * push;
      const cy = pos.y - 10 + Math.sin(dir) * push * 0.5;
      ctx.save();
      ctx.globalAlpha = (1 - p) * (fx.heavy ? 0.55 : 0.38);
      splat(ctx, cx, cy, r, (fx.seed || 1) + 0, 0.7, INK.black);
      if (fx.heavy) {
        // A heavier hit drags a short streak behind the spray.
        ctx.globalAlpha = (1 - p) * 0.36;
        blob(ctx, pos.x + Math.cos(dir) * push * 0.35, cy + 4,
          r * 0.34, r * 0.14, { rot: dir, wobble: 0.3, seed: (fx.seed || 1) + 7, alpha: 0.5 });
      }
      ctx.restore();
      break;
    }
    case 'death': {
      // A yokai does not fade: it collapses into a spreading blot, and the ink
      // runs down the page from the bottom of it.
      const r = 14 + easeOut(p) * 20;
      const fade = p < 0.35 ? 1 : 1 - (p - 0.35) / 0.65;
      ctx.save();
      ctx.globalAlpha = fade * 0.22;
      wash(ctx, pos.x, pos.y + 2, r * 1.25, r * 0.5, 0.55);
      ctx.globalAlpha = fade * 0.34;
      blob(ctx, pos.x, pos.y - 6, r * 0.62, r * 0.46, {
        wobble: 0.34, seed: (fx.seed || 3) + 11, alpha: 0.62,
      });
      ctx.globalAlpha = fade * 0.24;
      blob(ctx, pos.x - r * 0.28, pos.y - 2, r * 0.3, r * 0.22, { wobble: 0.5, seed: 17, alpha: 0.5 });
      blob(ctx, pos.x + r * 0.3, pos.y + 2, r * 0.24, r * 0.18, { wobble: 0.5, seed: 29, alpha: 0.5 });
      // Drips: thin, gravity-bound strokes that keep travelling after the blot
      // has stopped growing. They taper to nothing rather than ending on a hard
      // cut, because the bottom row of the board clips them.
      const drip = easeIn(Math.max(0, p - 0.25) / 0.75);
      for (let i = 0; i < 3; i++) {
        const dx = (i - 1) * r * 0.32 + Math.sin(i * 2.1 + (fx.seed || 0)) * 3;
        const dy = 6 + drip * (10 + i * 5);
        const len = 5 + drip * (11 + i * 4);
        const seg = (a, b, alpha) => strokeRibbon(ctx, [
          [pos.x + dx, pos.y + dy + len * a],
          [pos.x + dx + 0.5, pos.y + dy + len * (a + b) * 0.5],
          [pos.x + dx - 0.5, pos.y + dy + len * b],
        ], { width: 2.6 - i * 0.5, endWidth: 0.5, alpha, seed: i + 5 });
        ctx.globalAlpha = fade * (0.4 - i * 0.08);
        seg(0, 0.6, 0.5);
        ctx.globalAlpha = fade * (0.2 - i * 0.05);
        seg(0.55, 1, 0.4);
      }
      ctx.restore();
      break;
    }
    case 'castGlyph': {
      // The trait kanji blooms behind the caster like a stamp pressed into wet
      // paper, then thins out. Drawn before the units so it reads as a shadow
      // on the page rather than a signboard in front of them.
      const grow = easeOut(p);
      const size = (fx.boss ? 46 : 30) * (0.85 + grow * 0.25);
      ctx.save();
      ctx.globalAlpha = (1 - p) * (1 - p) * (fx.boss ? 0.3 : 0.22);
      ctx.translate(pos.x, pos.y - 26);
      ctx.rotate(((fx.seed || 0) % 20 - 10) * 0.004);
      inkText(ctx, fx.glyph || '妖', 0, 0, {
        size,
        align: 'center',
        baseline: 'middle',
        fill: fx.boss ? INK.vermilion : INK.mid,
        alpha: 0.9,
      });
      ctx.restore();
      break;
    }
    case 'muzzle': {
      ctx.save();
      ctx.globalAlpha = 1 - p;
      splat(ctx, pos.x, pos.y - 14, 12 + p * 8, 3, 0.5);
      ctx.restore();
      break;
    }
    case 'impact': {
      ctx.save();
      ctx.globalAlpha = (1 - p) * 0.7;
      splat(ctx, pos.x, pos.y - 10, 14 + p * 18, 7, 0.55);
      ctx.restore();
      break;
    }
    case 'miss': {
      ctx.save();
      ctx.globalAlpha = (1 - p) * 0.8;
      const off = 18 + p * 16;
      inkText(ctx, '空', pos.x + off, pos.y - 18 - p * 14, {
        size: 22, align: 'center', fill: INK.gray, alpha: 0.8,
      });
      ctx.restore();
      break;
    }
    case 'castRing': {
      const r = 24 + easeOut(p) * (fx.boss ? 120 : 62);
      ctx.save();
      ctx.globalAlpha = (1 - p) * (fx.boss ? 0.5 : 0.65);
      ctx.strokeStyle = fx.boss ? INK.vermilion : INK.black;
      ctx.lineWidth = fx.boss ? 5 : 3;
      ctx.beginPath();
      ctx.ellipse(pos.x, pos.y + 8, r, r * 0.42, 0, 0, 6.2832);
      ctx.stroke();
      ctx.restore();
      break;
    }
    case 'shield': {
      const target = fx.unit;
      if (!target) break;
      const q = to(target.x, target.y);
      ctx.save();
      ctx.globalAlpha = (1 - p) * 0.6;
      ctx.strokeStyle = INK.vermilion;
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.ellipse(q.x, q.y - 4, 34, 40, 0, 0, 6.2832);
      ctx.stroke();
      ctx.restore();
      break;
    }
    default:
      break;
  }
}

/** Ranged shots: a small ink dot with a short tail. */
export function drawProjectile(ctx, proj, to) {
  const pos = to(proj.x, proj.y);
  ctx.save();
  ctx.globalAlpha = 0.85;
  ctx.fillStyle = INK.black;
  ctx.beginPath();
  ctx.arc(pos.x, pos.y - 10, 4.5, 0, 6.2832);
  ctx.fill();
  ctx.globalAlpha = 0.25;
  ctx.beginPath();
  ctx.arc(pos.x, pos.y - 10, 9, 0, 6.2832);
  ctx.fill();
  ctx.restore();
}

/** A slash arc drawn for melee swings; `k` animates 0 -> 1. */
export function drawSlash(ctx, x, y, k, seed = 1) {
  const rng = makeRng(seed | 0);
  const a0 = rng.range(-0.9, -0.2);
  const sweep = 1.6;
  const p = Math.min(1, k);
  const alpha = p < 0.6 ? 0.9 : 1 - (p - 0.6) / 0.4;
  ctx.save();
  ctx.globalAlpha = alpha * 0.8;
  ctx.strokeStyle = INK.black;
  ctx.lineWidth = 5;
  ctx.beginPath();
  ctx.arc(x, y, 30, a0, a0 + sweep * easeOut(p));
  ctx.stroke();
  ctx.restore();
}
