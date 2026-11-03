/**
 * render/render.js — the whole scene, painted on one canvas.
 *
 * Logical space is 1600×1000; everything below is expressed in those units and
 * the backing store simply scales by devicePixelRatio. Layout lives in one
 * place (`LAYOUT` / `buttons()`) so hit-testing and drawing can never disagree.
 *
 * Composition:
 *   [ HUD rail ][ opponent ][ board ][ traits ][ log ]
 *                      [ bench ]
 *                      [ shop  ]
 */

import { CFG } from '../config.js';
import { UNIT_BY_ID, STAR_GLYPH, hpAtStar, attackAtStar, sellValue } from '../data/units.js';
import { TRAITS, TRAIT_BY_ID } from '../data/traits.js';
import { ABILITIES } from '../data/abilities.js';
import { difficultyById, nextDifficulty, difficultyScale } from '../data/difficulty.js';
import { ladderFor } from '../data/ladder.js';
import { traitSummaries, tierText } from '../traits.js';
import { capForRound, boardUnits } from '../board.js';
import { planFor, isBossRound, buildEnemyBoard } from '../ai.js';
import { cellCenter } from '../hex.js';
import { INK, paperTexture, paperPanel, inkText, blob, brushLine, strokeRibbon, seal, wash, splat, roundRect, tracePoly } from './ink.js';
import { spriteCanvas, spriteRim, spriteThumb } from './sprites.js';
import { drawEffect, drawProjectile, drawSlash } from './fx.js';

export const W = 1600;
export const H = 1000;

export const LAYOUT = {
  header: { x: 20, y: 0, w: 1560, h: 96 },
  rail: { x: 20, y: 108, w: 260, h: 872 },
  preview: { x: 296, y: 108, w: 240, h: 582 },
  traits: { x: 1113, y: 108, w: 240, h: 582 },
  log: { x: 1369, y: 108, w: 211, h: 582 },
  board: { x: 552, y: 112, w: 545, h: 576, R: 44 },
  bench: { x: 552, y: 698, w: 801, h: 74, slots: 8 },
  shop: { x: 552, y: 786, w: 801, h: 194, cards: 5 },
};

// Board centre in logical space: hex cells are laid out from here.
LAYOUT.board.cx = LAYOUT.board.x + LAYOUT.board.R;
LAYOUT.board.cy = LAYOUT.board.y + LAYOUT.board.R;

// ---------------------------------------------------------------------------
// Geometry
// ---------------------------------------------------------------------------

/** hex cell (col,row) -> logical pixel centre */
export function cellPx(col, row, L = LAYOUT) {
  const c = cellCenter(col, row);
  return { x: L.board.cx + c.x * L.board.R, y: L.board.cy + c.y * L.board.R };
}

/** hex-space (sim units) -> logical pixel, for combat rendering */
export function simToPx(x, y, L = LAYOUT) {
  return { x: L.board.cx + x * L.board.R, y: L.board.cy + y * L.board.R };
}

export function shopCardRect(i) {
  const s = LAYOUT.shop;
  const gap = 12;
  const w = (s.w - gap * (s.cards - 1)) / s.cards;
  return { x: s.x + i * (w + gap), y: s.y, w, h: s.h };
}

export function benchSlotRect(i) {
  const b = LAYOUT.bench;
  const gap = 8;
  const w = (b.w - gap * (b.slots - 1)) / b.slots;
  return { x: b.x + i * (w + gap), y: b.y, w, h: b.h };
}

function inRect(r, x, y) {
  return x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h;
}

/** Action buttons for the current state — shared with hit-testing. */
export function buttons(state) {
  const r = LAYOUT.rail;
  const out = [];
  const fighting = state.phase === 'combat';
  out.push({
    id: 'fight',
    x: r.x + 16, y: 400, w: r.w - 32, h: 62,
    label: state.phase === 'prep' ? `開戦  ·  Fight` : '交戦中  ·  Fighting',
    sub: state.phase === 'prep' ? `Round ${state.round}` : `${Math.max(0, CFG.combatTimeout - (state.combat ? state.combat.t : 0)).toFixed(0)}s`,
    enabled: state.phase === 'prep' && boardUnits(state).length > 0,
    primary: true,
  });
  out.push({
    id: 'reroll',
    x: r.x + 16, y: 470, w: r.w - 32, h: 46,
    label: `Reroll  ·  ${CFG.rerollCost}g`,
    enabled: state.phase === 'prep' && state.gold >= CFG.rerollCost,
  });
  out.push({
    id: 'speed',
    x: r.x + 16, y: 528, w: 58, h: 34,
    label: `${state.speed}×`,
    enabled: true,
  });
  out.push({
    id: 'mute',
    x: r.x + 82, y: 528, w: 58, h: 34,
    label: 'Sound',
    enabled: true,
  });
  out.push({
    id: 'difficulty',
    x: r.x + 16, y: 578, w: r.w - 32, h: 34,
    label: `Difficulty  ·  ${difficultyById(state.difficulty).name}`,
    // A run's difficulty is fixed once it is under way, so the preset cannot be
    // a mid-run slider you ride to a win.
    enabled: state.phase === 'prep' && state.round === 1 && state.units.length === 0,
    cycle: true,
  });
  out.push({
    id: 'help',
    x: r.x + 148, y: 528, w: 44, h: 34,
    label: '?',
    enabled: true,
  });
  // Abandoning a run is destructive, so the button arms itself on the first
  // click and only replaces the run when pressed again while armed.
  out.push({
    id: 'newrun',
    x: r.x + 200, y: 528, w: 44, h: 34,
    label: state.armedNewRun ? '!' : 'New',
    enabled: true,
    armed: !!state.armedNewRun,
  });
  return out;
}

/** What is under the cursor? Returns a descriptive target or null. */
export function hitTest(state, x, y) {
  for (const b of buttons(state)) if (b.enabled && inRect(b, x, y)) return { kind: 'button', id: b.id, rect: b };
  if (state.phase === 'result' || state.phase === 'gameover' || state.phase === 'victory') {
    const o = overlayButton(state);
    if (o && inRect(o, x, y)) return { kind: 'button', id: 'continue', rect: o };
    return null;
  }
  for (let i = 0; i < LAYOUT.shop.cards; i++) {
    if (inRect(shopCardRect(i), x, y)) return { kind: 'shop', index: i };
  }
  for (let i = 0; i < LAYOUT.bench.slots; i++) {
    if (inRect(benchSlotRect(i), x, y)) return { kind: 'bench', index: i };
  }
  if (!fighting(state)) {
    const cell = cellAt(x, y);
    if (cell) return { kind: 'cell', col: cell.col, row: cell.row };
  }
  const t = traitRowAt(x, y);
  if (t) return { kind: 'trait', trait: t };
  return null;
}

function fighting(state) {
  return state.phase === 'combat' || state.phase === 'result';
}

export function overlayButton(state) {
  const w = 300, h = 62;
  return { x: W / 2 - w / 2, y: 700, w, h };
}

/** Nearest hex under a point, if the point is inside the board region. */
export function cellAt(x, y, L = LAYOUT) {
  const R = L.board.R;
  // Convert to cube-ish space, then round using the axial distance trick.
  const px = (x - L.board.cx) / R;
  const py = (y - L.board.cy) / R;
  let row = Math.round(py / 1.5);
  let col = Math.round(px / Math.sqrt(3) - (row & 1) * 0.5);
  col = Math.max(0, Math.min(CFG.cols - 1, col));
  row = Math.max(0, Math.min(CFG.rows - 1, row));
  const p = cellPx(col, row, L);
  if (Math.hypot(p.x - x, p.y - y) > R * 0.92) return null;
  return { col, row };
}

function traitRowAt(x, y) {
  const t = LAYOUT.traits;
  if (x < t.x || x > t.x + t.w) return null;
  const top = t.y + 64;
  const rowH = 58;
  for (let i = 0; i < TRAITS.length; i++) {
    const ry = top + i * rowH;
    if (y >= ry && y <= ry + rowH - 6) return TRAITS[i].id;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Small drawing helpers
// ---------------------------------------------------------------------------

function hexPath(ctx, x, y, r, seed = 1) {
  const pts = [];
  for (let i = 0; i < 6; i++) {
    const a = (Math.PI / 3) * i - Math.PI / 2;
    const j = 1 + (((seed * (i + 3)) % 7) - 3) * 0.006;
    pts.push([x + Math.cos(a) * r * j, y + Math.sin(a) * r * j]);
  }
  tracePoly(ctx, pts);
}

function inkBar(ctx, x, y, w, h, frac, fill, opts = {}) {
  ctx.save();
  ctx.globalAlpha = 0.28;
  ctx.fillStyle = INK.mid;
  roundRect(ctx, x, y, w, h, h / 2);
  ctx.fill();
  ctx.globalAlpha = opts.alpha === undefined ? 0.95 : opts.alpha;
  ctx.fillStyle = fill;
  const fw = Math.max(0, Math.min(1, frac)) * w;
  if (fw > 1) {
    roundRect(ctx, x, y, fw, h, h / 2);
    ctx.fill();
  }
  ctx.restore();
}

function coin(ctx, x, y, r, label, opts = {}) {
  ctx.save();
  ctx.globalAlpha = opts.alpha === undefined ? 1 : opts.alpha;
  ctx.fillStyle = opts.fill || INK.vermilion;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, 6.2832);
  ctx.fill();
  ctx.globalAlpha = 0.85;
  ctx.strokeStyle = '#f7f0e0';
  ctx.lineWidth = 1.4;
  ctx.beginPath();
  ctx.arc(x, y, r - 2.4, 0, 6.2832);
  ctx.stroke();
  inkText(ctx, label, x, y + r * 0.36, {
    size: r * 1.25, align: 'center', fill: '#f7f0e0', weight: '600', alpha: 0.95,
  });
  ctx.restore();
}

function stars(ctx, x, y, star, size = 9, alpha = 1) {
  ctx.save();
  ctx.globalAlpha = alpha;
  for (let i = 0; i < star; i++) {
    const cx = x + i * (size + 2);
    const pts = [];
    for (let k = 0; k < 5; k++) {
      const a = -Math.PI / 2 + (k * 2 * Math.PI) / 5;
      pts.push([cx + Math.cos(a) * size * 0.5, y + Math.sin(a) * size * 0.5]);
      const a2 = a + Math.PI / 5;
      pts.push([cx + Math.cos(a2) * size * 0.22, y + Math.sin(a2) * size * 0.22]);
    }
    ctx.fillStyle = INK.vermilion;
    tracePoly(ctx, pts);
    ctx.fill();
  }
  ctx.restore();
}

function panel(ctx, r, opts = {}) {
  paperPanel(ctx, r.x, r.y, r.w, r.h, {
    seed: opts.seed || 3, alpha: opts.alpha === undefined ? 0.92 : opts.alpha, rough: 2.5,
    stroke: opts.stroke, fill: opts.fill,
  });
}

/** Draw a yokai with its feet on (x, y). */
function yokai(ctx, defId, x, y, height, opts = {}) {
  const src = spriteCanvas(defId);
  const scale = height / 196;
  const w = 256 * scale;
  const h = 256 * scale;
  ctx.save();
  ctx.globalAlpha = opts.alpha === undefined ? 1 : opts.alpha;
  if (opts.flip) {
    ctx.translate(x, y);
    ctx.scale(-1, 1);
    if (opts.rim !== false) ctx.drawImage(spriteRim(defId), -w / 2, -248 * scale, w, h);
    ctx.drawImage(src, -w / 2, -248 * scale, w, h);
  } else {
    if (opts.rim !== false) ctx.drawImage(spriteRim(defId), x - w / 2, y - 248 * scale, w, h);
    ctx.drawImage(src, x - w / 2, y - 248 * scale, w, h);
  }
  ctx.restore();
}

// ---------------------------------------------------------------------------
// Renderer
// ---------------------------------------------------------------------------

export function createRenderer(canvas) {
  const ctx = canvas.getContext('2d');
  let paper = null;
  let boardBase = null;
  let dpr = 1;

  function resize() {
    dpr = Math.min(2, window.devicePixelRatio || 1);
    canvas.width = Math.round(W * dpr);
    canvas.height = Math.round(H * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    paper = paperTexture(W, H, 0x5eed);
    boardBase = paintBoardBase();
  }

  /** The static part of the board: grid, halves, divider. Cached once. */
  function paintBoardBase() {
    const c = document.createElement('canvas');
    c.width = Math.round(W * dpr);
    c.height = Math.round(H * dpr);
    const g = c.getContext('2d');
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    const B = LAYOUT.board;

    // Enemy half: a cold wash so the two sides read apart at a glance.
    g.save();
    g.globalAlpha = 0.5;
    wash(g, B.cx, B.cy - 3 * B.R, B.w * 0.58, B.R * 3.2, 0.22, '64,66,74');
    g.restore();

    for (let row = 0; row < CFG.rows; row++) {
      for (let col = 0; col < CFG.cols; col++) {
        const p = cellPx(col, row);
        const player = row >= 4;
        g.save();
        g.globalAlpha = player ? 0.1 : 0.07;
        g.fillStyle = player ? '#f7f0e0' : '#4a4238';
        hexPath(g, p.x, p.y, B.R * 0.94, col * 7 + row * 13 + 1);
        g.fill();
        g.globalAlpha = player ? 0.34 : 0.24;
        g.strokeStyle = INK.mid;
        g.lineWidth = 1.4;
        g.stroke();
        g.restore();
      }
    }

    // The divide: one confident horizontal brush stroke.
    const midY = B.cy + 1.5 * 3.5 * B.R;
    strokeRibbon(g, [
      [B.x + 10, midY + 2],
      [B.cx, midY - 3],
      [B.x + B.w - 10, midY + 1],
    ], { width: 5, endWidth: 1.5, alpha: 0.55, seed: 12, bristle: 6 });


    return c;
  }

  function drawHeader(state) {
    const h = LAYOUT.header;
    // Title: seal + brush lettering.
    seal(ctx, h.x + 34, h.y + 44, 52, '妖', { seed: 4, rot: -0.05 });
    inkText(ctx, 'Yokai Ink', h.x + 70, h.y + 42, { size: 30, weight: '600', spacing: 0.5 });
    inkText(ctx, 'a sumi-e autobattler', h.x + 71, h.y + 66, { size: 14, fill: INK.gray, spacing: 1.2 });

    // Round, centred.
    const plan = planFor(state.round);
    inkText(ctx, `第 ${state.round} 幕`, W / 2, h.y + 40, { size: 22, align: 'center', fill: INK.mid, spacing: 3 });
    inkText(ctx, plan.name, W / 2, h.y + 72, { size: 30, align: 'center', weight: '500' });
    if (isBossRound(state.round)) {
      seal(ctx, W / 2 + 148, h.y + 46, 34, '鬼', { seed: 8, rot: 0.08 });
    }

    // HP + gold mirrored on the right so they are readable from either side.
    const x = W - 40;
    inkText(ctx, `${state.hp}`, x - 132, h.y + 48, { size: 36, align: 'right', weight: '600' });
    inkText(ctx, 'ink left', x - 132, h.y + 78, { size: 11.5, align: 'right', fill: INK.gray });
    coin(ctx, x - 22, h.y + 48, 15, '両');
    inkText(ctx, `${state.gold}`, x - 44, h.y + 58, { size: 26, align: 'right', weight: '600' });
    inkText(ctx, 'banked', x - 44, h.y + 78, { size: 11, align: 'right', fill: INK.gray });

    strokeRibbon(ctx, [[h.x, 96], [W / 2, 99], [W - 20, 95]], { width: 3, endWidth: 0.6, alpha: 0.35, seed: 21 });
  }

  function drawRail(state) {
    const r = LAYOUT.rail;
    panel(ctx, { x: r.x, y: r.y, w: r.w, h: 280 }, { seed: 5 });
    inkText(ctx, '墨', r.x + 24, r.y + 44, { size: 26, fill: INK.mid });
    inkText(ctx, `${state.hp}`, r.x + 24, r.y + 96, { size: 52, weight: '600' });
    inkText(ctx, '/ ' + CFG.startHp, r.x + 108, r.y + 96, { size: 20, fill: INK.gray });
    inkBar(ctx, r.x + 24, r.y + 112, r.w - 48, 12, state.hp / CFG.startHp, INK.black);

    inkText(ctx, 'gold', r.x + 24, r.y + 158, { size: 13, fill: INK.gray, spacing: 1.4 });
    coin(ctx, r.x + 40, r.y + 186, 16, '両');
    inkText(ctx, `${state.gold}`, r.x + 64, r.y + 196, { size: 32, weight: '600' });
    const interest = Math.min(5, Math.floor(state.gold / 10));
    inkText(ctx, `interest +${interest}`, r.x + r.w - 24, r.y + 186, {
      size: 13, align: 'right', fill: INK.gray,
    });
    inkText(ctx, `cap ${capForRound(state.round)} units`, r.x + r.w - 24, r.y + 204, {
      size: 13, align: 'right', fill: INK.gray,
    });
    // Ten-gold marks: a tiny ledger, so saving for interest is legible.
    for (let i = 0; i < 5; i++) {
      const on = state.gold >= (i + 1) * 10;
      ctx.save();
      ctx.globalAlpha = on ? 0.85 : 0.2;
      ctx.fillStyle = on ? INK.vermilion : INK.mid;
      ctx.beginPath();
      ctx.arc(r.x + 28 + i * 20, r.y + 224, 5, 0, 6.2832);
      ctx.fill();
      ctx.restore();
    }
    inkText(ctx, 'gold chunks of 10', r.x + 132, r.y + 230, { size: 11, fill: INK.ghost });

    // Buttons.
    for (const b of buttons(state)) drawButton(b);

    // Selected unit card.
    drawSelection(state);
  }

  function drawButton(b) {
    const hot = b.enabled;
    ctx.save();
    ctx.globalAlpha = hot ? 1 : 0.4;
    if (b.primary) {
      paperPanel(ctx, b.x, b.y, b.w, b.h, { seed: 11, fill: 'rgba(194,65,42,0.92)', stroke: 'rgba(120,36,22,0.6)', alpha: 0.95 });
      inkText(ctx, b.label, b.x + b.w / 2, b.y + (b.sub ? 30 : 36), {
        size: 20, align: 'center', fill: '#f8f1e2', weight: '600', spacing: 1,
      });
      if (b.sub) {
        inkText(ctx, b.sub, b.x + b.w / 2, b.y + 50, { size: 12, align: 'center', fill: 'rgba(248,241,226,0.8)' });
      }
    } else {
      const armed = !!b.armed;
      paperPanel(ctx, b.x, b.y, b.w, b.h, {
        seed: 12, alpha: 0.85, rough: 2,
        fill: armed ? 'rgba(194,65,42,0.9)' : undefined,
      });
      inkText(ctx, b.label, b.x + b.w / 2, b.y + b.h / 2 + 6, {
        size: armed ? 18 : 13,
        align: 'center',
        fill: armed ? '#f8f1e2' : INK.deep,
        weight: armed ? '600' : '400',
        spacing: 0.4,
      });
    }
    ctx.restore();
  }

  /**
   * The left rail either explains the controls or, when a yokai is selected,
   * becomes its stat card: what it hits for, how fast, how far, and the exact
   * text of the ability it will cast. Everything shown is the number the
   * simulation will actually use at that star level.
   */
  function drawSelection(state) {
    const r = LAYOUT.rail;
    const y = r.y + 516;
    const u = state.selected;
    if (!u) {
      inkText(ctx, 'Drag a yokai onto the board.', r.x + 24, y + 26, { size: 14, fill: INK.gray });
      inkText(ctx, 'Right-click a yokai to sell it.', r.x + 24, y + 50, { size: 14, fill: INK.gray });
      inkText(ctx, 'Space fights the round.', r.x + 24, y + 74, { size: 14, fill: INK.gray });
      inkText(ctx, 'Z X C V B buy  ·  R reroll', r.x + 24, y + 98, { size: 13, fill: INK.ghost });
      inkText(ctx, 'click a yokai for its numbers', r.x + 24, y + 122, { size: 12, fill: INK.ghost });
      return;
    }
    const def = UNIT_BY_ID[u.defId];
    const hp = hpAtStar(def, u.star);
    const atk = attackAtStar(def, u.star);
    const dps = Math.round(atk * def.attackSpeed);
    const gold = sellValue(def, u.star);
    const cardX = r.x + 16;
    const cardW = r.w - 32;
    const cardH = 268;
    panel(ctx, { x: cardX, y, w: cardW, h: cardH }, { seed: 15 });

    // Header: portrait, name, trait, stars.
    spriteThumbInto(ctx, u.defId, cardX + 46, y + 46, 68);
    inkText(ctx, def.name, cardX + 88, y + 28, { size: 17, weight: '600' });
    inkText(ctx, `${def.trait}  ·  ${def.cost}g`, cardX + 88, y + 46, { size: 12.5, fill: INK.gray });
    stars(ctx, cardX + 88, y + 63, u.star, 8.5);
    brushLine(ctx, cardX + 14, y + 78, cardX + cardW - 14, y + 78, 1.1, { seed: 21 });

    // Stats, two columns, exactly as the simulation reads them.
    const rows = [
      ['HP', hp, 'ATK', atk],
      ['AS', def.attackSpeed.toFixed(2), 'DPS', dps],
      ['RNG', def.range, 'ARM', def.armor],
      ['MR', def.mr, 'MANA', def.mana],
    ];
    rows.forEach((row, i) => {
      const ry = y + 100 + i * 21;
      inkText(ctx, row[0], cardX + 14, ry, { size: 11, fill: INK.gray, spacing: 0.6 });
      inkText(ctx, `${row[1]}`, cardX + 56, ry, { size: 14, weight: '600' });
      inkText(ctx, row[2], cardX + 118, ry, { size: 11, fill: INK.gray, spacing: 0.6 });
      inkText(ctx, `${row[3]}`, cardX + 162, ry, { size: 14, weight: '600' });
    });

    // Ability: name in vermilion, text clipped to two lines.
    const ability = ABILITIES[u.defId];
    brushLine(ctx, cardX + 14, y + 184, cardX + cardW - 14, y + 184, 1.1, { seed: 22 });
    if (ability) {
      inkText(ctx, ability.name, cardX + 14, y + 204, { size: 13, weight: '600', fill: INK.vermilionDeep });
      const maxW = cardW - 28;
      ctx.save();
      ctx.beginPath();
      ctx.rect(cardX + 12, y + 210, maxW + 4, 36);
      ctx.clip();
      wrapLines(ctx, ability.text(u.star), maxW, 11.5).slice(0, 2).forEach((line, i) => {
        inkText(ctx, line, cardX + 14, y + 220 + i * 14, { size: 11.5, fill: INK.mid });
      });
      ctx.restore();
    }
    inkText(ctx, `sell ${gold}g  ·  right-click or S`, cardX + 14, y + cardH - 14, {
      size: 11.5, fill: INK.gray,
    });
  }

  /** Draw a sprite thumbnail centred in a box, used by the stat card. */
  function spriteThumbInto(c, defId, cx, cy, size) {
    const src = spriteCanvas(defId);
    const k = size / src.height;
    c.save();
    c.globalAlpha = 0.98;
    c.drawImage(src, cx - (src.width * k) / 2, cy - size / 2, src.width * k, size);
    c.restore();
  }

  function drawPreview(state) {
    const p = LAYOUT.preview;
    panel(ctx, p, { seed: 6 });
    const plan = planFor(state.round);
    inkText(ctx, 'next', p.x + 18, p.y + 30, { size: 12, fill: INK.gray, spacing: 2 });
    inkText(ctx, plan.name, p.x + 18, p.y + 58, { size: 20, weight: '500' });
    const total = plan.squad.reduce((a, u) => a + u.star, 0);
    inkText(ctx, `${plan.squad.length} yokai · ${total}★ · ${difficultyById(state.difficulty).name}`,
      p.x + 18, p.y + 78, { size: 12, fill: INK.gray });
    if (isBossRound(state.round)) {
      seal(ctx, p.x + p.w - 40, p.y + 44, 40, '鬼', { seed: 9, rot: -0.06 });
    }

    const top = p.y + 100;
    const rowH = 56;
    // Sort: the most upgraded first, so the threat reads top-down.
    const squad = plan.squad.slice().sort((a, b) => (b.star - a.star)
      || (UNIT_BY_ID[a.defId].range - UNIT_BY_ID[b.defId].range));
    squad.forEach((u, i) => {
      const y = top + i * rowH;
      if (y > p.y + p.h - 24) return;
      const def = UNIT_BY_ID[u.defId];
      ctx.save();
      ctx.globalAlpha = 0.9;
      yokai(ctx, u.defId, p.x + 40, y + 44, 52);
      ctx.restore();
      inkText(ctx, def.name, p.x + 74, y + 24, { size: 14, fill: INK.deep });
      stars(ctx, p.x + 74, y + 38, u.star, 7);
      inkText(ctx, TRAIT_BY_ID[def.trait].glyph, p.x + p.w - 24, y + 30, {
        size: 16, align: 'right', fill: INK.gray,
      });
      if (u.boss) inkText(ctx, 'boss', p.x + p.w - 24, y + 48, { size: 11, align: 'right', fill: INK.vermilion });
    });
  }

  function drawTraits(state) {
    const t = LAYOUT.traits;
    panel(ctx, t, { seed: 7 });
    inkText(ctx, 'traits', t.x + 18, t.y + 30, { size: 12, fill: INK.gray, spacing: 2 });
    const active = traitSummaries(boardUnits(state));
    const top = t.y + 64;
    ctx.save();
    ctx.beginPath();
    ctx.rect(t.x + 4, t.y + 40, t.w - 8, t.h - 62);
    ctx.clip();
    TRAITS.forEach((trait, i) => {
      const s = active.find((a) => a.trait.id === trait.id);
      const count = s ? s.count : 0;
      const tier = s ? s.tier : -1;
      const y = top + i * 58;
      const on = tier >= 0;
      ctx.save();
      ctx.globalAlpha = on ? 1 : 0.55;
      seal(ctx, t.x + 36, y + 18, 30, trait.glyph, {
        seed: 30 + i, alpha: on ? 0.92 : 0.22, rot: (i - 1.5) * 0.05,
      });
      inkText(ctx, trait.name, t.x + 60, y + 16, { size: 16, weight: '500' });
      const need = s && s.next ? s.next.count : trait.tiers[trait.tiers.length - 1].count;
      inkText(ctx, on ? `${count} active` : `${count} / ${need}`, t.x + t.w - 18, y + 16, {
        size: 13, align: 'right', fill: on ? INK.vermilion : INK.gray,
      });
      inkText(ctx, fit(ctx, on ? tierText(trait, tier) : trait.blurb, t.w - 78, 11.5), t.x + 60, y + 34, {
        size: 11.5, fill: on ? INK.mid : INK.ghost,
      });
      // count pips
      for (let k = 0; k < 3; k++) {
        ctx.save();
        ctx.globalAlpha = k < count ? (on ? 0.9 : 0.4) : 0.15;
        ctx.fillStyle = k < count ? INK.black : INK.mid;
        ctx.beginPath();
        ctx.arc(t.x + 60 + k * 11, y + 46, 3.4, 0, 6.2832);
        ctx.fill();
        ctx.restore();
      }
      ctx.restore();
    });
    ctx.restore();
    inkText(ctx, '2 yokai unlock the first tier, 3 the second', t.x + 18, t.y + t.h - 16, {
      size: 11, fill: INK.ghost,
    });
  }

  /** Truncate text with an ellipsis so it never bleeds out of a panel. */
  function fit(ctx, text, maxW, size) {
    ctx.save();
    ctx.font = `400 ${size}px "Yu Mincho","MS Mincho","Georgia",serif`;
    let s = String(text);
    if (ctx.measureText(s).width <= maxW) { ctx.restore(); return s; }
    while (s.length > 4 && ctx.measureText(s + '…').width > maxW) s = s.slice(0, -1);
    ctx.restore();
    return s.replace(/[\s,.;:—-]+$/, '') + '…';
  }

  function drawLog(state) {
    const l = LAYOUT.log;
    panel(ctx, l, { seed: 8 });
    inkText(ctx, 'chronicle', l.x + 16, l.y + 30, { size: 12, fill: INK.gray, spacing: 2 });

    const maxW = l.w - 32;
    const size = 14.5;
    const lead = size + 4;
    const entries = state.log.slice(-18).map((entry) => ({
      entry,
      lines: wrapLines(ctx, entry.text, maxW, size),
    }));

    // Anchor to the bottom so new entries push the oldest out of view.
    let y = l.y + l.h - 20;
    const floor = l.y + 52;
    for (let i = entries.length - 1; i >= 0; i--) {
      const { entry, lines } = entries[i];
      const blockH = lines.length * lead + 10;
      y -= blockH;
      if (y < floor) break;
      let fill = INK.mid;
      if (entry.kind === 'loss') fill = INK.vermilion;
      if (entry.kind === 'win') fill = INK.black;
      if (entry.kind === 'gold') fill = INK.vermilionDeep;
      ctx.save();
      ctx.globalAlpha = 0.55 + 0.45 * (i / Math.max(1, entries.length - 1));
      lines.forEach((line, k) => {
        inkText(ctx, line, l.x + 16, y + size + k * lead, { size, fill });
      });
      ctx.restore();
    }
  }

  function wrapLines(ctx, text, maxW, size) {
    ctx.save();
    ctx.font = `400 ${size}px "Yu Mincho","MS Mincho","Georgia",serif`;
    const words = String(text).split(' ');
    const out = [];
    let line = '';
    for (const w of words) {
      const test = line ? `${line} ${w}` : w;
      if (ctx.measureText(test).width > maxW && line) {
        out.push(line);
        line = w;
      } else {
        line = test;
      }
    }
    if (line) out.push(line);
    ctx.restore();
    return out;
  }

  function wrapText(ctx, text, x, y, maxW, size, fill) {
    const lines = wrapLines(ctx, text, maxW, size);
    lines.forEach((line, i) => inkText(ctx, line, x, y + i * (size + 3), { size, fill }));
  }

  // -------------------------------------------------------------------------
  // Board + units
  // -------------------------------------------------------------------------

  function drawBoard(state, view) {
    const B = LAYOUT.board;
    ctx.drawImage(boardBase, 0, 0, W, H);

    // Placement affordances during prep: highlight legal cells while dragging.
    if (view.drag && view.drag.kind === 'unit' && state.phase === 'prep') {
      for (let row = 4; row < CFG.rows; row++) {
        for (let col = 0; col < CFG.cols; col++) {
          const p = cellPx(col, row);
          ctx.save();
          ctx.globalAlpha = 0.16;
          ctx.fillStyle = INK.vermilion;
          hexPath(ctx, p.x, p.y, B.R * 0.88, col + row);
          ctx.fill();
          ctx.restore();
        }
      }
    }

    // Hover cell ring.
    const hover = view.hover;
    if (hover && hover.kind === 'cell' && state.phase === 'prep') {
      const p = cellPx(hover.col, hover.row);
      ctx.save();
      ctx.globalAlpha = 0.6;
      ctx.strokeStyle = INK.vermilion;
      ctx.lineWidth = 3;
      hexPath(ctx, p.x, p.y, B.R * 0.86, hover.col * 3 + hover.row);
      ctx.stroke();
      ctx.restore();
    }

    if (state.phase === 'combat' || state.phase === 'result') {
      drawCombat(state, view);
    } else {
      drawPrepUnits(state, view);
    }

    // Frame labels sit above the fight: a blot or a damage number must never be
    // able to erase the only thing telling you which half is which.
    inkText(ctx, 'enemy', B.x + 8, B.y + 24, { size: 12, fill: INK.gray, alpha: 0.5, spacing: 2 });
    inkText(ctx, 'your side', B.x + 8, B.y + B.h - 30, { size: 12, fill: INK.gray, alpha: 0.5, spacing: 2 });
  }

  let ghostCache = { round: -1, difficulty: '', units: [] };

  /**
   * The ghost line-up must use the same scale the fight will, or a Ruthless run
   * would preview a Standard board and the numbers would lie.
   */
  function enemyGhosts(round, difficulty) {
    if (ghostCache.round !== round || ghostCache.difficulty !== difficulty) {
      const plan = planFor(round);
      ghostCache = {
        round,
        difficulty,
        units: buildEnemyBoard(round, {
          scale: (plan.scale === undefined ? 1 : plan.scale) * difficultyScale(difficulty),
        }),
      };
    }
    return ghostCache.units;
  }

  function drawPrepUnits(state, view) {
    // Faint line-up on the far half: during prep the enemy only exists as ink
    // on the page, which keeps the matchup readable without hiding your board.
    if (!state.combat) {
      for (const e of enemyGhosts(state.round, state.difficulty)) {
        const p = cellPx(e.col, e.row);
        drawUnitAt({ defId: e.defId, star: 1 }, p.x, p.y + Math.sin(view.time * 1.8 + p.y * 0.02) * 1.4, {
          alpha: 0.21, enemy: true,
        });
      }
    }

    const units = boardUnits(state);
    for (const u of units) {
      const p = cellPx(u.loc.col, u.loc.row);
      const dragging = view.drag && view.drag.kind === 'unit' && view.drag.unit && view.drag.unit.uid === u.uid;
      const bob = Math.sin(view.time * 2.2 + p.x * 0.02) * 1.6;
      drawUnitAt(u, p.x, p.y + bob, { alpha: dragging ? 0.35 : 1, selected: state.selected && state.selected.uid === u.uid });
    }
  }

  function drawUnitAt(u, x, y, opts = {}) {
    const def = UNIT_BY_ID[u.defId];
    const h = LAYOUT.board.R * (1.18 + (u.star - 1) * 0.09) * (def.cost === 4 ? 1.12 : 1);
    // ground ring: pale for the player, vermilion for the enemy
    ctx.save();
    ctx.globalAlpha = opts.alpha === undefined ? 1 : opts.alpha;
    ctx.strokeStyle = opts.enemy ? 'rgba(194,65,42,0.5)' : 'rgba(60,52,40,0.32)';
    ctx.lineWidth = 1.8;
    ctx.beginPath();
    ctx.ellipse(x, y + 6, LAYOUT.board.R * 0.6, LAYOUT.board.R * 0.24, 0, 0, 6.2832);
    ctx.stroke();
    ctx.restore();
    yokai(ctx, u.defId, x, y + 4, h, { alpha: opts.alpha });
    if (u.star > 1) {
      inkText(ctx, '★'.repeat(u.star), x + LAYOUT.board.R * 0.42, y - h * 0.52, {
        size: 10, align: 'center', fill: INK.vermilion, weight: '600', alpha: 0.95,
      });
    }
    if (opts.selected) {
      ctx.save();
      ctx.globalAlpha = 0.75;
      ctx.strokeStyle = INK.vermilion;
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.ellipse(x, y + 6, LAYOUT.board.R * 0.68, LAYOUT.board.R * 0.28, 0, 0, 6.2832);
      ctx.stroke();
      ctx.restore();
    }
  }

  function drawCombat(state, view) {
    const sim = state.combat;
    if (!sim) return;
    const to = (x, y) => simToPx(x, y);

    // Sorted back-to-front by y so overlapping sprites stack naturally.
    const alive = sim.units.filter((u) => u.alive || (u.deathT >= 0 && sim.t - u.deathT < 0.5));
    alive.sort((a, b) => a.y - b.y);

    // The page shudders when something dies or the boss casts. Two pixels is
    // enough to register as impact without turning the board into a earthquake.
    let amt = 0;
    for (const fx of sim.effects) {
      const p = (sim.t - fx.t0) / (fx.type === 'castGlyph' ? 0.3 : 0.22);
      if (p < 0 || p >= 1) continue;
      if (fx.type === 'death') amt = Math.max(amt, (1 - p) * (fx.boss ? 5 : 2.4));
      else if (fx.type === 'castGlyph' && fx.boss) amt = Math.max(amt, (1 - p) * 4);
    }
    ctx.save();
    // Nothing in the fight may spill onto the panels: damage numbers drift up
    // and outward, so the board edge is the page edge here.
    const B = LAYOUT.board;
    ctx.beginPath();
    // Stop at the last hex row, not at the layout box: a dying unit's ink must
    // not run down onto the bench.
    ctx.rect(B.x - 6, B.y - 12, B.w + 12, B.R * 12.5 + 16);
    ctx.clip();
    if (amt > 0.03) {
      ctx.translate(Math.sin(sim.t * 87) * amt, Math.cos(sim.t * 71) * amt * 0.6);
    }

    // Ground-ink effects (cast glyphs, death blots) are painted into the page
    // before the figures, so a brawl never hides behind its own aftermath.
    for (const fx of sim.effects) {
      if (fx.type === 'castGlyph' || fx.type === 'death') drawEffect(ctx, fx, sim.t, to);
    }

    for (const u of alive) {
      const p = to(u.x, u.y);
      const enemy = u.side === 'enemy';
      let lunge = 0;
      if (u.attackAnim > 0) {
        const k = u.attackAnim / 0.2;
        lunge = Math.sin((1 - k) * Math.PI) * 7;
      }
      const dir = enemy ? 1 : -1;
      const h = LAYOUT.board.R * (1.18 + (u.star - 1) * 0.09) * (u.boss ? 1.55 : u.size || 1);
      const shake = u.hurtAnim > 0 ? (Math.random() - 0.5) * 4 * (u.hurtAnim / 0.16) : 0;
      const alpha = u.alive ? 1 : Math.max(0, 1 - (sim.t - u.deathT) / 0.5);
      if (alpha <= 0.01) continue;

      // attack lunge: lean toward the target
      let ax = 0, ay = lunge * dir * -1;
      if (u.range <= 1 && u.targetUid) {
        const t = sim.units.find((k2) => k2.uid === u.targetUid);
        if (t) {
          const tp = to(t.x, t.y);
          const d = Math.hypot(tp.x - p.x, tp.y - p.y) || 1;
          ax = ((tp.x - p.x) / d) * lunge;
          ay = ((tp.y - p.y) / d) * lunge;
        }
      }
      drawUnitAt({ ...u, star: u.star }, p.x + ax + shake, p.y + ay, { alpha, enemy });
      if (u.attackAnim > 0.12 && u.range <= 1) drawSlash(ctx, p.x + ax, p.y - 10, 1 - u.attackAnim / 0.2, u.x * 17 + u.y);
      drawUnitBars(u, p.x + ax, p.y + ay);
    }

    for (const p of sim.projectiles) drawProjectile(ctx, p, to);
    for (const fx of sim.effects) {
      if (fx.type === 'castGlyph' || fx.type === 'death') continue;
      if (fx.type === 'shield') {
        const u = sim.units.find((k) => k.uid === fx.uid);
        if (!u) continue;
        drawEffect(ctx, { ...fx, unit: u }, sim.t, to);
      } else {
        drawEffect(ctx, fx, sim.t, to);
      }
    }
    ctx.restore();

    // A thin clock at the bottom of the board.
    const elapsed = sim.t;
    const frac = Math.min(1, elapsed / CFG.combatTimeout);
    ctx.save();
    ctx.globalAlpha = 0.25;
    inkBar(ctx, LAYOUT.board.x + 40, LAYOUT.board.y + LAYOUT.board.h - 14, LAYOUT.board.w - 80, 4, frac, INK.mid);
    ctx.restore();
  }

  function drawUnitBars(u, x, y) {
    const w = LAYOUT.board.R * 0.92;
    const hh = 4;
    const by = y + 12;
    ctx.save();
    ctx.globalAlpha = 0.9;
    ctx.fillStyle = 'rgba(38,32,26,0.18)';
    roundRect(ctx, x - w / 2, by, w, hh, hh / 2);
    ctx.fill();
    ctx.fillStyle = u.side === 'enemy' ? INK.vermilion : INK.black;
    const f = Math.max(0, u.hp / u.maxHp);
    if (f > 0) {
      roundRect(ctx, x - w / 2, by, w * f, hh, hh / 2);
      ctx.fill();
    }
    // shield overlay
    if (u.shield > 0) {
      const sf = Math.min(1, u.shield / u.maxHp);
      ctx.fillStyle = 'rgba(240,232,214,0.9)';
      roundRect(ctx, x - w / 2, by, w * sf, hh, hh / 2);
      ctx.fill();
    }
    // mana
    ctx.fillStyle = 'rgba(194,65,42,0.8)';
    const mf = Math.max(0, Math.min(1, u.mana / u.maxMana));
    if (mf > 0.02) {
      ctx.fillRect(x - w / 2, by + hh + 1.5, w * mf, 2);
    }
    ctx.restore();
  }

  // -------------------------------------------------------------------------
  // Bench + shop
  // -------------------------------------------------------------------------

  function drawBench(state, view) {
    inkText(ctx, 'bench', LAYOUT.bench.x, LAYOUT.bench.y - 8, { size: 12, fill: INK.gray, spacing: 2 });
    for (let i = 0; i < LAYOUT.bench.slots; i++) {
      const r = benchSlotRect(i);
      paperPanel(ctx, r.x, r.y, r.w, r.h, { seed: 40 + i, alpha: 0.55, rough: 2 });
      const u = state.units.find((x) => x.loc.type === 'bench' && x.loc.index === i);
      if (!u) continue;
      const dragging = view.drag && view.drag.kind === 'unit' && view.drag.unit && view.drag.unit.uid === u.uid;
      const hovered = view.hover && view.hover.kind === 'bench' && view.hover.index === i;
      ctx.save();
      ctx.globalAlpha = dragging ? 0.3 : 1;
      yokai(ctx, u.defId, r.x + r.w / 2, r.y + r.h - 10, 58);
      stars(ctx, r.x + r.w / 2 - 12, r.y + 12, u.star, 6);
      ctx.restore();
      if (hovered) {
        ctx.save();
        ctx.globalAlpha = 0.8;
        ctx.strokeStyle = INK.vermilion;
        ctx.lineWidth = 2;
        roundRect(ctx, r.x + 1, r.y + 1, r.w - 2, r.h - 2, 6);
        ctx.stroke();
        ctx.restore();
      }
    }
  }

  function drawShop(state, view) {
    inkText(ctx, 'shop', LAYOUT.shop.x, LAYOUT.shop.y - 8, { size: 12, fill: INK.gray, spacing: 2 });
    for (let i = 0; i < LAYOUT.shop.cards; i++) {
      const r = shopCardRect(i);
      const id = state.shop[i] || null;
      const hovered = view.hover && view.hover.kind === 'shop' && view.hover.index === i;
      const cost = id ? UNIT_BY_ID[id].cost : 0;
      const afford = cost <= state.gold;
      ctx.save();
      ctx.globalAlpha = hovered ? 1 : 0.97;
      paperPanel(ctx, r.x, r.y - (hovered ? 4 : 0), r.w, r.h + (hovered ? 4 : 0), {
        seed: 50 + i, alpha: 0.95, rough: 2.5,
        stroke: hovered ? 'rgba(194,65,42,0.75)' : undefined,
      });
      ctx.restore();

      if (!id) {
        ctx.save();
        ctx.globalAlpha = 0.35;
        inkText(ctx, '売', r.x + r.w / 2, r.y + r.h / 2 + 14, { size: 40, align: 'center', fill: INK.ghost });
        ctx.restore();
        continue;
      }
      const def = UNIT_BY_ID[id];
      const yy = r.y - (hovered ? 4 : 0);
      ctx.save();
      ctx.globalAlpha = afford ? 1 : 0.45;
      yokai(ctx, id, r.x + r.w / 2, yy + r.h - 62, 96);
      inkText(ctx, def.name, r.x + r.w / 2, yy + r.h - 38, { size: 15, align: 'center', weight: '500' });
      inkText(ctx, TRAIT_BY_ID[def.trait].name, r.x + r.w / 2, yy + r.h - 20, {
        size: 12, align: 'center', fill: INK.gray,
      });
      ctx.restore();

      coin(ctx, r.x + 18, yy + 20, 13, String(def.cost), { alpha: afford ? 1 : 0.45 });
      inkText(ctx, TRAIT_BY_ID[def.trait].glyph, r.x + r.w - 18, yy + 28, {
        size: 20, align: 'right', fill: afford ? INK.mid : INK.ghost,
      });
      if (!afford) {
        ctx.save();
        ctx.globalAlpha = 0.30;
        strokeRibbon(ctx, [[r.x + 22, yy + r.h - 24], [r.x + r.w - 22, yy + 24]], {
          width: 4, endWidth: 1, alpha: 0.4, seed: i + 3,
        });
        ctx.restore();
      }
    }
  }

  // -------------------------------------------------------------------------
  // Overlays + cursors
  // -------------------------------------------------------------------------

  function drawOverlay(state, view) {
    if (state.phase === 'prep' || state.phase === 'combat') return;
    const win = state.phase === 'victory' || (state.result && state.result.winner === 'player');

    // Ink the room down, then lay a sheet of paper on top of it.
    ctx.save();
    ctx.globalAlpha = 0.42;
    ctx.fillStyle = '#191510';
    ctx.fillRect(0, 0, W, H);
    ctx.restore();

    const res = state.result;
    const final = state.phase === 'gameover' || state.phase === 'victory';
    const cardW = final ? 800 : 680;
    const cardH = final ? 620 : 460;
    const cardX = W / 2 - cardW / 2;
    const cardY = H / 2 - cardH / 2 - 16;
    paperPanel(ctx, cardX, cardY, cardW, cardH, { seed: 77, alpha: 0.99, stroke: 'rgba(90,76,56,0.5)' });

    const title = state.phase === 'gameover' ? '敗' : win ? '勝' : '敗';
    const sub = state.phase === 'gameover'
      ? 'The ink runs dry.'
      : state.phase === 'victory'
        ? 'The mountain is quiet again.'
        : win ? 'The round is yours.' : 'You are driven back.';

    seal(ctx, W / 2, cardY + 92, 132, title, { seed: 77, rot: -0.04, alpha: 0.95 });
    inkText(ctx, sub, W / 2, cardY + 206, { size: 27, align: 'center', fill: INK.deep });
    if (res) {
      const preset = difficultyById(state.difficulty).name;
      inkText(ctx, `${preset} · Round ${res.round} · ${(res.duration || 0).toFixed(1)}s${res.timeout ? ' · time' : ''}`,
        W / 2, cardY + 240, { size: 15, align: 'center', fill: INK.gray });
      if (res.winner === 'enemy') {
        inkText(ctx, `−${res.damage} ink · ${res.survivors} enemy survived`, W / 2, cardY + 266, {
          size: 16, align: 'center', fill: INK.vermilion,
        });
      } else if (res.survivors === 0 && !res.timeout) {
        inkText(ctx, 'a clean sweep', W / 2, cardY + 266, {
          size: 16, align: 'center', fill: INK.mid,
        });
      } else if (res.survivors > 0) {
        inkText(ctx, `${res.survivors} of yours still standing`, W / 2, cardY + 266, {
          size: 16, align: 'center', fill: INK.mid,
        });
      }
    }

    if (final) {
      const lines = [
        `rounds won ${state.stats.roundsWon} · lost ${state.stats.roundsLost}`,
        `damage dealt ${Math.round(state.stats.damageDealt)} · gold earned ${state.stats.goldEarned}`,
      ];
      lines.forEach((line, i) => {
        inkText(ctx, line, W / 2, cardY + 306 + i * 24, { size: 15, align: 'center', fill: INK.mid });
      });
      drawRunHistory(state, cardX, cardY, cardW);
    }

    const b = overlayButton(state);
    const bx = W / 2 - b.w / 2;
    const by = cardY + cardH - (final ? 120 : 160);
    const hovered = view.hover && view.hover.kind === 'button' && view.hover.id === 'continue';
    ctx.save();
    ctx.globalAlpha = hovered ? 1 : 0.96;
    paperPanel(ctx, bx, by, b.w, b.h, {
      seed: 91, fill: 'rgba(194,65,42,0.94)', stroke: 'rgba(120,36,22,0.6)',
    });
    inkText(ctx, final ? 'Begin again' : 'Continue',
      bx + b.w / 2, by + 40, { size: 21, align: 'center', fill: '#f8f1e2', weight: '600', spacing: 1 });
    ctx.restore();
    inkText(ctx, 'or press Space', W / 2, by + b.h + 28, { size: 13, align: 'center', fill: INK.gray });
  }

  /**
   * The end-of-run ledger: one line per round, so you can see where a run broke
   * into two columns of five to keep the card short.
   */
  function drawRunHistory(state, cardX, cardY, cardW) {
    const history = state.history || [];
    if (!history.length) return;
    const top = cardY + 348;
    // A straight hairline: a brush stroke over 720px wobbles into a visible arc.
    ctx.save();
    ctx.globalAlpha = 0.22;
    ctx.fillStyle = INK.mid;
    ctx.fillRect(cardX + 44, top, cardW - 88, 1.1);
    ctx.restore();
    inkText(ctx, 'the run so far', W / 2, top + 22, {
      size: 11.5, align: 'center', fill: INK.gray, spacing: 2.4,
    });

    const cols = 2;
    const perCol = Math.ceil(Math.min(history.length, 10) / cols);
    const colW = (cardW - 80) / cols;
    const rows = history.slice(0, cols * perCol);
    rows.forEach((h, i) => {
      const col = Math.floor(i / perCol);
      const row = i % perCol;
      const x = cardX + 40 + col * colW;
      const y = top + 44 + row * 21;
      const name = ladderFor(h.round).name;
      const won = h.winner === 'player';
      inkText(ctx, `R${h.round}`, x, y, { size: 11, fill: INK.gray, spacing: 0.8 });
      inkText(ctx, name, x + 30, y, { size: 12.5, fill: won ? INK.deep : INK.vermilion });
      inkText(ctx, `${won ? 'won' : 'lost'}`, x + colW - 96, y, {
        size: 11.5, align: 'right', fill: won ? INK.mid : INK.vermilion,
      });
      inkText(ctx, `${(h.duration || 0).toFixed(1)}s`, x + colW - 16, y, {
        size: 11.5, align: 'right', fill: INK.gray,
      });
    });
  }

  function drawDragGhost(view) {
    const d = view.drag;
    if (!d) return;
    if (d.kind === 'shop') {
      const def = UNIT_BY_ID[d.defId];
      yokai(ctx, d.defId, d.x, d.y + 16, 84, { alpha: 0.8 });
      inkText(ctx, def.name, d.x, d.y + 46, {
        size: 13, align: 'center', fill: INK.deep, alpha: 0.85,
      });
      return;
    }
    const u = d.unit;
    yokai(ctx, u.defId, d.x, d.y + 18, 74, { alpha: 0.85 });
    inkText(ctx, UNIT_BY_ID[u.defId].name, d.x, d.y + 44, {
      size: 13, align: 'center', fill: INK.deep, alpha: 0.8,
    });
  }

  /** A short-lived line of feedback, in the middle of the shop strip. */
  function drawToast(state) {
    const t = state.toast;
    if (!t) return;
    const age = (Date.now() - (t.at || 0)) / 1000;
    if (age > 2.6) return;
    const a = age < 0.15 ? age / 0.15 : age > 2.1 ? 1 - (age - 2.1) / 0.5 : 1;
    ctx.save();
    ctx.globalAlpha = Math.max(0, Math.min(1, a));
    // Sits in the dead strip under the shop so it never covers a card, a bench
    // slot or the board.
    const w = 460, h = 26;
    const x = W / 2 - w / 2;
    const y = H - h - 12;
    paperPanel(ctx, x, y, w, h, { seed: 71, alpha: 0.96, stroke: 'rgba(120,36,22,0.3)' });
    inkText(ctx, t.text, W / 2, y + 18, {
      size: 14, align: 'center', fill: t.kind === 'loss' ? INK.vermilion : INK.deep,
    });
    ctx.restore();
  }

  function drawHelp(view) {
    if (!view.help) return;
    ctx.save();
    ctx.globalAlpha = 0.55;
    ctx.fillStyle = '#1b1712';
    ctx.fillRect(0, 0, W, H);
    ctx.restore();

    const w = 720, h = 660;
    const x = W / 2 - w / 2, y = H / 2 - h / 2 - 10;
    paperPanel(ctx, x, y, w, h, { seed: 88, alpha: 0.99, stroke: 'rgba(90,76,56,0.5)' });
    seal(ctx, x + 54, y + 56, 46, '読', { seed: 31 });
    inkText(ctx, 'How to play', x + 92, y + 56, { size: 26, weight: '600' });
    inkText(ctx, 'a sumi-e autobattler in eight rounds', x + 92, y + 78, { size: 14, fill: INK.gray });

    const cols = [
      {
        title: 'The loop',
        lines: [
          'Buy yokai from the shop. Three copies',
          'of the same yokai merge into the next',
          'star, up to three stars.',
          '',
          'Drag them onto your half of the board',
          '(the lower four rows), then press Space',
          'or click Fight to start the round.',
          '',
          'Win and you keep your ink. Lose and the',
          'survivors drink it: 2 + their number.',
          '',
          'Survive eight rounds, then beat the',
          'Bone Colossus in round nine.',
        ],
      },
      {
        title: 'Economy & traits',
        lines: [
          'You start with 5 gold and 100 ink.',
          '',
          'Each round: 5 gold, plus 1 for every',
          '10 gold banked (up to 5), plus 1 for',
          'a win. Rerolling the shop costs 2.',
          '',
          'Selling refunds exactly what you paid.',
          '',
          'Two yokai of a trait unlock its first',
          'tier, three its second. Only distinct',
          'yokai count — duplicates do not help.',
          '',
          'Click a yokai to read its stats and the',
          'exact numbers it fights with.',
          '',
          'Difficulty (Story / Standard / Ruthless)',
          'scales enemy health and attack. It can',
          'only change before your first purchase.',
          '',
          'Your run is saved after every round, so',
          'a refresh resumes where you left off.',
          'New abandons it (press twice).',
        ],
      },
    ];

    cols.forEach((col, ci) => {
      const cx = x + 44 + ci * 340;
      let cy = y + 130;
      inkText(ctx, col.title, cx, cy, { size: 17, weight: '600', fill: INK.mid });
      cy += 26;
      for (const line of col.lines) {
        if (line) inkText(ctx, line, cx, cy, { size: 14, fill: INK.deep });
        cy += 20;
      }
    });

    ctx.save();
    ctx.globalAlpha = 0.2;
    brushLine(ctx, x + 44, y + h - 74, x + w - 44, y + h - 74, 1.4, { seed: 12 });
    ctx.restore();
    inkText(ctx, 'Space fight · R reroll · Z X C V B buy · 1/2/4 speed · right-click sell · ? close',
      W / 2, y + h - 46, { size: 13, align: 'center', fill: INK.gray });
    inkText(ctx, 'press ? or click the ? button to close',
      W / 2, y + h - 26, { size: 11, align: 'center', fill: INK.ghost });
  }

  function drawTooltip(view) {
    const t = view.tooltip;
    if (!t || view.help) return;
    const w = 300;
    const h = t.lines.length * 18 + 96;
    let x = t.x + 18;
    let y = t.y + 12;
    if (x + w > W - 8) x = t.x - w - 18;
    if (y + h > H - 8) y = H - h - 8;
    ctx.save();
    ctx.globalAlpha = 0.98;
    paperPanel(ctx, x, y, w, h, { seed: 66, alpha: 0.98, stroke: 'rgba(90,76,56,0.45)' });
    ctx.restore();
    inkText(ctx, t.title, x + 16, y + 30, { size: 19, weight: '600' });
    inkText(ctx, t.sub, x + 16, y + 50, { size: 13, fill: INK.gray });
    t.lines.forEach((line, i) => {
      inkText(ctx, line, x + 16, y + 76 + i * 18, { size: 13.5, fill: INK.deep });
    });
  }

  function drawCursor(view) {
    const c = view.cursor;
    if (!c) return;
    ctx.save();
    ctx.globalAlpha = 0.8;
    ctx.fillStyle = INK.black;
    ctx.beginPath();
    ctx.arc(c.x, c.y, 3.2, 0, 6.2832);
    ctx.fill();
    ctx.restore();
  }

  // -------------------------------------------------------------------------

  function draw(state, view) {
    if (!paper) resize();
    ctx.save();
    ctx.clearRect(0, 0, W, H);
    ctx.drawImage(paper, 0, 0, W, H);

    drawHeader(state);
    drawRail(state);
    drawPreview(state);
    drawBoard(state, view);
    drawTraits(state);
    drawLog(state);
    drawBench(state, view);
    drawShop(state, view);
    drawOverlay(state, view);
    drawToast(state);
    drawDragGhost(view);
    drawTooltip(view);
    drawHelp(view);
    drawCursor(view);
    ctx.restore();
  }

  return { resize, draw, canvas, ctx };
}

/** Build tooltip lines for a yokai definition. Pure data, used by ui.js too. */
export function unitTooltip(defId, star = 1) {
  const def = UNIT_BY_ID[defId];
  const ab = ABILITIES[defId];
  const hp = Math.round(def.hp * Math.pow(1.8, star - 1));
  const ad = Math.round(def.attack * Math.pow(1.8, star - 1));
  return {
    title: def.name,
    sub: `${def.cost}g · ${def.trait} · ${'★'.repeat(star)}`,
    lines: [
      `health ${hp}   attack ${ad}`,
      `speed ${def.attackSpeed.toFixed(2)}/s   range ${def.range}`,
      `armor ${def.armor}   magic resist ${def.mr}`,
      `mana ${def.startMana}/${def.mana}`,
      '',
      `${ab.name} — ${ab.text(star)}`,
      '',
      def.flavor,
    ],
  };
}
