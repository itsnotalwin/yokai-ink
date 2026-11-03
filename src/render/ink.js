/**
 * render/ink.js — the sumi-e toolkit.
 *
 * Everything visible in the game is drawn with these primitives: paper, brush
 * strokes, blots, washes, splats and hanko seals. There are no image files.
 *
 * Two rules keep the look coherent:
 *   1. Ink is never pure black. It is a warm near-black that sits on paper.
 *   2. Vermilion (#c2412a) is the only colour, and it is spent sparingly:
 *      seals, prices, the boss, and things that are about to hurt.
 */

import { makeRng } from '../rng.js';

export const INK = {
  black: '#1b1712',
  deep: '#241f18',
  mid: '#4a423a',
  gray: '#6f6659',
  pale: '#9a9081',
  ghost: '#c3b8a5',
  paper: '#efe6d3',
  paperDeep: '#e2d6bf',
  vermilion: '#c2412a',
  vermilionDeep: '#9c2f1d',
};

// ---------------------------------------------------------------------------
// Geometry helpers
// ---------------------------------------------------------------------------

/** Catmull-Rom sample through points: [[x,y], ...] -> smooth polyline. */
export function smoothPath(points, steps = 8) {
  if (points.length < 2) return points.slice();
  const pts = [points[0], ...points, points[points.length - 1]];
  const out = [];
  for (let i = 1; i < pts.length - 2; i++) {
    const p0 = pts[i - 1], p1 = pts[i], p2 = pts[i + 1], p3 = pts[i + 2];
    for (let s = 0; s < steps; s++) {
      const t = s / steps;
      const t2 = t * t, t3 = t2 * t;
      out.push([
        0.5 * ((2 * p1[0]) + (-p0[0] + p2[0]) * t
          + (2 * p0[0] - 5 * p1[0] + 4 * p2[0] - p3[0]) * t2
          + (-p0[0] + 3 * p1[0] - 3 * p2[0] + p3[0]) * t3),
        0.5 * ((2 * p1[1]) + (-p0[1] + p2[1]) * t
          + (2 * p0[1] - 5 * p1[1] + 4 * p2[1] - p3[1]) * t2
          + (-p0[1] + 3 * p1[1] - 3 * p2[1] + p3[1]) * t3),
      ]);
    }
  }
  out.push(points[points.length - 1]);
  return out;
}

/** A closed, wobbly ring — the workhorse shape behind every blob. */
export function blobPath(cx, cy, rx, ry, opts = {}) {
  const { wobble = 0.12, points = 26, rot = 0, seed = 1 } = opts;
  const rng = makeRng(seed | 0);
  const phases = [rng.next() * 6.28, rng.next() * 6.28, rng.next() * 6.28];
  const out = [];
  const cos = Math.cos(rot), sin = Math.sin(rot);
  for (let i = 0; i < points; i++) {
    const a = (i / points) * Math.PI * 2;
    const w = 1
      + wobble * 0.6 * Math.sin(a * 2 + phases[0])
      + wobble * 0.4 * Math.sin(a * 3 + phases[1])
      + wobble * 0.25 * Math.sin(a * 5 + phases[2]);
    const x = Math.cos(a) * rx * w;
    const y = Math.sin(a) * ry * w;
    out.push([cx + x * cos - y * sin, cy + x * sin + y * cos]);
  }
  return out;
}

export function tracePoly(ctx, pts) {
  ctx.beginPath();
  ctx.moveTo(pts[0][0], pts[0][1]);
  for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
  ctx.closePath();
}

// ---------------------------------------------------------------------------
// Paper
// ---------------------------------------------------------------------------

/**
 * Rice paper: warm ground, subtle fibre grain, a few damp stains, and a
 * darkened deckled edge. Generated once and reused for every frame.
 */
export function paperTexture(w, h, seed = 0x9a9e) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const g = c.getContext('2d');
  const rng = makeRng(seed >>> 0 || 12345);

  const base = g.createLinearGradient(0, 0, w * 0.3, h);
  base.addColorStop(0, '#f4ecdb');
  base.addColorStop(0.45, INK.paper);
  base.addColorStop(1, '#e8dcc6');
  g.fillStyle = base;
  g.fillRect(0, 0, w, h);

  // Damp stains: big, soft, barely visible — they stop the field reading flat.
  g.globalCompositeOperation = 'multiply';
  for (let i = 0; i < 7; i++) {
    const x = rng.range(0, w), y = rng.range(0, h);
    const r = rng.range(140, 420);
    const grad = g.createRadialGradient(x, y, 0, x, y, r);
    grad.addColorStop(0, 'rgba(180,163,132,0.10)');
    grad.addColorStop(0.6, 'rgba(180,163,132,0.045)');
    grad.addColorStop(1, 'rgba(180,163,132,0)');
    g.fillStyle = grad;
    g.beginPath();
    g.ellipse(x, y, r, r * rng.range(0.55, 1), rng.range(0, 3), 0, 6.2832);
    g.fill();
  }

  // Fibre grain.
  g.lineCap = 'round';
  for (let i = 0; i < 2600; i++) {
    const x = rng.range(0, w), y = rng.range(0, h);
    const len = rng.range(3, 26);
    const a = rng.chance(0.75) ? rng.range(-0.25, 0.25) : rng.range(0, 6.28);
    g.strokeStyle = `rgba(120,104,80,${rng.range(0.012, 0.05).toFixed(3)})`;
    g.lineWidth = rng.range(0.4, 1.1);
    g.beginPath();
    g.moveTo(x, y);
    g.lineTo(x + Math.cos(a) * len, y + Math.sin(a) * len);
    g.stroke();
  }

  // Deckled edge: irregular darkening around the border.
  g.globalCompositeOperation = 'source-over';
  const edge = g.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.32, w / 2, h / 2, Math.max(w, h) * 0.78);
  edge.addColorStop(0, 'rgba(90,74,52,0)');
  edge.addColorStop(0.75, 'rgba(90,74,52,0.07)');
  edge.addColorStop(1, 'rgba(74,60,42,0.22)');
  g.fillStyle = edge;
  g.fillRect(0, 0, w, h);

  g.globalCompositeOperation = 'source-over';
  return c;
}

// ---------------------------------------------------------------------------
// Brush
// ---------------------------------------------------------------------------

/**
 * A tapered ink stroke along a path. Width eases in and out like a real brush
 * leaving the paper, and the edge is nudged so the outline is never mechanical.
 */
export function strokeRibbon(ctx, points, opts = {}) {
  const {
    width = 10, endWidth = 1.4, alpha = 1, fill = INK.black,
    seed = 7, bristle = 0, edgeJitter = 0.35,
  } = opts;
  if (points.length < 2) return;
  const path = smoothPath(points, opts.steps || 6);
  const rng = makeRng((seed | 0) + 11);
  const n = path.length;
  const left = [], right = [];
  let px = 0, py = 0;
  for (let i = 0; i < n; i++) {
    const p = path[i];
    const q = path[Math.min(n - 1, i + 1)];
    const o = path[Math.max(0, i - 1)];
    let dx = q[0] - o[0], dy = q[1] - o[1];
    const d = Math.hypot(dx, dy) || 1;
    dx /= d; dy /= d;
    const t = i / (n - 1);
    // Taper: full body just after the press, thin tail at the lift.
    const ease = Math.min(1, t * 6) * Math.min(1, (1 - t) * 3.2 + 0.18);
    const w = (width + (endWidth - width) * t) * (0.55 + 0.45 * ease);
    const nx = -dy, ny = dx;
    const j = (rng.next() - 0.5) * edgeJitter * w * 0.5;
    left.push([p[0] + nx * (w / 2 + j), p[1] + ny * (w / 2 + j)]);
    right.push([p[0] - nx * (w / 2 - j), p[1] - ny * (w / 2 - j)]);
    px = p[0]; py = p[1];
  }
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.fillStyle = fill;
  ctx.beginPath();
  ctx.moveTo(left[0][0], left[0][1]);
  for (let i = 1; i < n; i++) ctx.lineTo(left[i][0], left[i][1]);
  for (let i = n - 1; i >= 0; i--) ctx.lineTo(right[i][0], right[i][1]);
  ctx.closePath();
  ctx.fill();

  if (bristle > 0) {
    // Dry-brush strands: thin lines running off the tail. Widths are relative
    // to the stroke so the units of the caller's transform do not matter.
    for (let b = 0; b < bristle; b++) {
      const from = Math.floor(rng.range(0.25, 0.9) * (n - 1));
      const to = Math.min(n - 1, from + Math.floor(rng.range(2, 9)));
      const off = (rng.next() - 0.5) * width * 0.7;
      ctx.globalAlpha = alpha * rng.range(0.15, 0.4);
      ctx.lineWidth = width * rng.range(0.05, 0.14);
      ctx.strokeStyle = fill;
      ctx.beginPath();
      for (let i = from; i <= to; i++) {
        const p = path[i];
        const q = path[Math.min(n - 1, i + 1)];
        const o = path[Math.max(0, i - 1)];
        let dx = q[0] - o[0], dy = q[1] - o[1];
        const d = Math.hypot(dx, dy) || 1;
        const nx = -dy / d, ny = dx / d;
        const x = p[0] + nx * off, y = p[1] + ny * off;
        if (i === from) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      }
      ctx.stroke();
    }
  }
  ctx.restore();
}

/** Straight-ish tapered stroke between two points, with a gentle curve. */
export function brushLine(ctx, x1, y1, x2, y2, width = 8, opts = {}) {
  const bend = opts.bend === undefined ? 0.08 : opts.bend;
  const rng = makeRng((opts.seed | 0) + 3);
  const mx = (x1 + x2) / 2 + (y2 - y1) * bend * (rng.next() * 2 - 1);
  const my = (y1 + y2) / 2 + (x1 - x2) * bend * (rng.next() * 2 - 1);
  return strokeRibbon(ctx, [[x1, y1], [mx, my], [x2, y2]], { width, ...opts });
}

/** Filled organic blot — bodies, shadows, eyes. */
export function blob(ctx, cx, cy, rx, ry, opts = {}) {
  const pts = blobPath(cx, cy, rx, ry, opts);
  ctx.save();
  ctx.globalAlpha = opts.alpha === undefined ? 1 : opts.alpha;
  ctx.fillStyle = opts.fill || INK.black;
  tracePoly(ctx, pts);
  ctx.fill();
  if (opts.rim) {
    ctx.globalAlpha = (opts.alpha === undefined ? 1 : opts.alpha) * 0.5;
    ctx.lineWidth = opts.rimWidth || 2;
    ctx.strokeStyle = opts.fill || INK.black;
    ctx.stroke();
  }
  ctx.restore();
  return pts;
}

/** Soft ink wash: mist, ground shadow, vignette. */
export function wash(ctx, x, y, rx, ry, alpha = 0.12, fill = '58,48,36') {
  const g = ctx.createRadialGradient(x, y, 0, x, y, Math.max(rx, ry));
  g.addColorStop(0, `rgba(${fill},${alpha})`);
  g.addColorStop(0.55, `rgba(${fill},${alpha * 0.55})`);
  g.addColorStop(1, `rgba(${fill},0)`);
  ctx.save();
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.ellipse(x, y, rx, ry, 0, 0, 6.2832);
  ctx.fill();
  ctx.restore();
}

/** Ink thrown at the paper: a core blot plus a halo of droplets. */
export function splat(ctx, x, y, r, seed = 1, alpha = 0.75, fill = INK.black) {
  const rng = makeRng((seed | 0) + 97);
  ctx.save();
  ctx.fillStyle = fill;
  ctx.globalAlpha = alpha;
  tracePoly(ctx, blobPath(x, y, r, r * rng.range(0.72, 1.1), {
    wobble: 0.35, points: 18, seed: seed + 5,
  }));
  ctx.fill();
  const drops = 4 + rng.int(6);
  for (let i = 0; i < drops; i++) {
    const a = rng.range(0, 6.2832);
    const d = r * rng.range(1.05, 2.4);
    const rr = r * rng.range(0.06, 0.26);
    ctx.globalAlpha = alpha * rng.range(0.35, 0.9);
    ctx.beginPath();
    ctx.ellipse(x + Math.cos(a) * d, y + Math.sin(a) * d * 0.8, rr, rr * rng.range(0.7, 1.3), a, 0, 6.2832);
    ctx.fill();
  }
  ctx.restore();
}

/**
 * Hanko: the vermilion seal. Used for the title mark, round stamps and the
 * boss warning. Kept rough so it reads as pressed ink, not a vector square.
 */
export function seal(ctx, x, y, size, glyph, opts = {}) {
  const rng = makeRng((opts.seed | 0) + 41);
  const alpha = opts.alpha === undefined ? 0.9 : opts.alpha;
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(opts.rot || 0);
  ctx.globalAlpha = alpha;
  ctx.fillStyle = opts.fill || INK.vermilion;

  const half = size / 2;
  const pts = [];
  const steps = 24;
  for (let i = 0; i < steps; i++) {
    const t = i / steps;
    const per = Math.floor(t * 4);
    const u = (t * 4) % 1;
    const jx = (rng.next() - 0.5) * size * 0.035;
    const jy = (rng.next() - 0.5) * size * 0.035;
    const corners = [[-half, -half], [half, -half], [half, half], [-half, half]];
    const a = corners[per], b = corners[(per + 1) % 4];
    pts.push([a[0] + (b[0] - a[0]) * u + jx, a[1] + (b[1] - a[1]) * u + jy]);
  }
  tracePoly(ctx, pts);
  ctx.fill();

  if (glyph) {
    ctx.globalAlpha = alpha * 0.95;
    ctx.fillStyle = opts.paper || '#f3ecdc';
    ctx.font = `${Math.round(size * 0.62)}px "Yu Mincho","MS Mincho","Noto Serif JP",serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(glyph, 0, size * 0.02);
  }
  ctx.restore();
}

/** Brush lettering. Slightly rough, always on paper. */
export function inkText(ctx, str, x, y, opts = {}) {
  const {
    size = 24, fill = INK.black, alpha = 1, align = 'left', baseline = 'alphabetic',
    font = '"Yu Mincho","MS Mincho","Georgia",serif', weight = '400', spacing = 0,
  } = opts;
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.fillStyle = fill;
  ctx.textAlign = align;
  ctx.textBaseline = baseline;
  ctx.font = `${weight} ${size}px ${font}`;
  if (!spacing) {
    ctx.fillText(str, x, y);
  } else {
    // Manual letter-spacing: canvas has no reliable support across browsers.
    const chars = [...str];
    const widths = chars.map((c) => ctx.measureText(c).width);
    const total = widths.reduce((a, b) => a + b, 0) + spacing * (chars.length - 1);
    let cx = align === 'center' ? x - total / 2 : align === 'right' ? x - total : x;
    for (let i = 0; i < chars.length; i++) {
      ctx.fillText(chars[i], cx, y);
      cx += widths[i] + spacing;
    }
  }
  ctx.restore();
}

/** Small helper for the vertical layout of a paper card. */
export function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

/** A torn-paper panel: the backing for HUD modules and shop cards. */
export function paperPanel(ctx, x, y, w, h, opts = {}) {
  const rng = makeRng((opts.seed | 0) + 13);
  const alpha = opts.alpha === undefined ? 0.9 : opts.alpha;
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.fillStyle = opts.fill || 'rgba(247,241,228,0.94)';
  const pts = [];
  const rough = opts.rough === undefined ? 3 : opts.rough;
  const per = 18;
  for (let i = 0; i < per; i++) pts.push([x + (w * i) / per, y + (rng.next() - 0.5) * rough]);
  for (let i = 0; i < 5; i++) pts.push([x + w + (rng.next() - 0.5) * rough, y + (h * i) / 5]);
  for (let i = per - 1; i >= 0; i--) pts.push([x + (w * i) / per, y + h + (rng.next() - 0.5) * rough]);
  for (let i = 4; i >= 0; i--) pts.push([x + (rng.next() - 0.5) * rough, y + (h * i) / 5]);
  tracePoly(ctx, pts);
  ctx.fill();
  ctx.globalAlpha = alpha * 0.5;
  ctx.strokeStyle = opts.stroke || 'rgba(90,76,56,0.35)';
  ctx.lineWidth = opts.lineWidth || 1.5;
  ctx.stroke();
  ctx.restore();
}
