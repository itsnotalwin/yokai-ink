/**
 * ui.js — pointer, keyboard, drag & drop.
 *
 * This module owns the interaction model: what is selected, what is being
 * dragged, what the cursor is over, and which tooltip should be showing. It
 * calls into the model (shop/board/state) and never draws anything itself.
 */

import { CFG } from './config.js';
import { UNIT_BY_ID } from './data/units.js';
import { TRAITS, TRAIT_BY_ID } from './data/traits.js';
import { buySlot, reroll, sell } from './shop.js';
import { placeOnBoard, placeOnBench, unitAt, unitInBench } from './board.js';
import {
  startCombat, continueRun, toast, setSpeed, newRun, logMsg,
} from './state.js';
import {
  hitTest, buttons, cellAt, LAYOUT, shopCardRect, benchSlotRect, overlayButton,
  unitTooltip, W, H,
} from './render/render.js';
import { tierText } from './traits.js';
import { saveRun } from './save.js';
import { DIFFICULTIES, difficultyById, nextDifficulty } from './data/difficulty.js';

const SPEEDS = [1, 2, 4];

export function createUI(canvas, opts) {
  const audio = opts.audio;
  const getState = opts.getState;
  const setState = opts.setState;

  const view = {
    hover: null,
    drag: null,
    tooltip: null,
    cursor: null,
    time: 0,
    help: false,
    drop: null,          // {kind:'cell'|'bench'|'sell', ...} while dragging
  };

  const pointer = { x: 0, y: 0, down: false, id: null, downAt: 0, moved: false };

  // -------------------------------------------------------------------------
  // Coordinates
  // -------------------------------------------------------------------------

  function toLogical(ev) {
    const r = canvas.getBoundingClientRect();
    return {
      x: ((ev.clientX - r.left) / r.width) * W,
      y: ((ev.clientY - r.top) / r.height) * H,
    };
  }

  function state() { return getState(); }

  // -------------------------------------------------------------------------
  // Actions
  // -------------------------------------------------------------------------

  function tryBuy(index, drop) {
    const s = state();
    if (s.phase !== 'prep') return;
    const res = buySlot(s, index);
    if (!res.ok) {
      audio.error();
      toast(s, res.reason || 'Cannot buy that.');
      return;
    }
    audio.buy();
    const u = res.unit;
    if (drop && drop.kind === 'cell' && u) {
      const p = placeOnBoard(s, u, drop.col, drop.row);
      if (p.ok) audio.place();
    }
    if (res.merges && res.merges.length) {
      audio.buy();
      for (const m of res.merges) {
        logMsg(s, `${UNIT_BY_ID[m.defId].name} becomes ${'★'.repeat(m.star)}.`, 'win');
      }
      toast(s, `${UNIT_BY_ID[res.merges[res.merges.length - 1].defId].name} promoted!`);
    }
    s.selected = u || null;
  }

  /**
   * Cycle the preset. Only allowed before the first purchase of round 1, so the
   * difficulty of a run cannot be changed once it is a run.
   */
  function cycleDifficulty() {
    const s = state();
    if (s.phase !== 'prep' || s.round !== 1 || s.units.length > 0) {
      audio.error();
      toast(s, 'Difficulty is fixed once the run starts.');
      return null;
    }
    s.difficulty = nextDifficulty(s.difficulty);
    const preset = difficultyById(s.difficulty);
    toast(s, `${preset.name} — ${preset.blurb}`);
    audio.click();
    saveRun(s);
    return null;
  }

  function tryReroll() {
    const s = state();
    if (s.phase !== 'prep') return;
    const res = reroll(s, s.shopRng);
    if (!res.ok) { audio.error(); toast(s, res.reason || 'Not enough gold.'); return; }
    audio.reroll();
  }

  function trySell(unit) {
    const s = state();
    if (!unit || s.phase !== 'prep') return;
    const res = sell(s, unit);
    if (!res.ok) { audio.error(); toast(s, res.reason || 'Cannot sell that.'); return; }
    audio.sell();
    toast(s, `Sold ${UNIT_BY_ID[unit.defId].name} for ${res.refund}g.`);
    if (s.selected && s.selected.uid === unit.uid) s.selected = null;
  }

  function tryFight() {
    const s = state();
    if (s.phase !== 'prep') return;
    const res = startCombat(s);
    if (!res.ok) { audio.error(); toast(s, res.reason); return; }
    audio.start();
    if (s.round === CFG.bossRound) audio.boss();
    view.drag = null;
    s.selected = null;
  }

  function primary() {
    const s = state();
    if (s.phase === 'prep') return tryFight();
    if (s.phase === 'result') return advance();
    return restart();
  }

  function advance() {
    const s = state();
    const res = continueRun(s);
    if (res.ok) audio.click();
    return res;
  }

  function restart() {
    const s = state();
    const next = newRun(opts.seed ? opts.seed() : CFG.seed);
    // The preset is a player preference, so it survives a new run.
    next.difficulty = s.difficulty || next.difficulty;
    setState(next);
    saveRun(next);
    view.help = false;
    view.drag = null;
    audio.click();
    void s;
  }

  function handleButton(id) {
    const s = state();
    audio.unlock();
    if (id === 'fight') return tryFight();
    if (id === 'reroll') return tryReroll();
    if (id === 'speed') {
      const i = SPEEDS.indexOf(s.speed);
      setSpeed(s, SPEEDS[(i + 1) % SPEEDS.length]);
      audio.click();
      return null;
    }
    if (id === 'mute') { audio.toggle(); audio.click(); return null; }
    if (id === 'help') { view.help = !view.help; audio.click(); return null; }
    if (id === 'difficulty') return cycleDifficulty();
    if (id === 'newrun') {
      // Two steps, because this throws a run away: the first press arms it.
      const now = Date.now();
      if (s.armedNewRun && now - s.armedNewRun < 4000) {
        s.armedNewRun = 0;
        return restart();
      }
      s.armedNewRun = now;
      toast(s, 'Press New again to abandon this run', 'ink');
      audio.click();
      return null;
    }
    if (id === 'continue') {
      if (s.phase === 'result') return advance();
      return restart();
    }
    return null;
  }

  // -------------------------------------------------------------------------
  // Drag & drop
  // -------------------------------------------------------------------------

  function beginDrag(hit, pos) {
    const s = state();
    if (s.phase !== 'prep') return false;
    if (hit.kind === 'shop') {
      const id = s.shop[hit.index];
      if (!id) return false;
      if (UNIT_BY_ID[id].cost > s.gold) {
        audio.error();
        toast(s, `Need ${UNIT_BY_ID[id].cost} gold for ${UNIT_BY_ID[id].name}.`);
        return false;
      }
      view.drag = { kind: 'shop', index: hit.index, defId: id, x: pos.x, y: pos.y, sx: pos.x, sy: pos.y, moved: false };
      return true;
    }
    if (hit.kind === 'bench' || hit.kind === 'cell') {
      const u = hit.kind === 'bench' ? unitInBench(s, hit.index) : unitAt(s, hit.col, hit.row);
      if (!u) return false;
      s.selected = u;
      view.drag = { kind: 'unit', unit: u, x: pos.x, y: pos.y, sx: pos.x, sy: pos.y, moved: false };
      return true;
    }
    return false;
  }

  function dropTargetAt(pos) {
    const r = shopRowRect();
    if (pos.y >= r.y - 26 && pos.y <= r.y + r.h && pos.x >= r.x && pos.x <= r.x + r.w) {
      return { kind: 'sell' };
    }
    for (let i = 0; i < LAYOUT.bench.slots; i++) {
      const b = benchSlotRect(i);
      if (pos.x >= b.x && pos.x <= b.x + b.w && pos.y >= b.y && pos.y <= b.y + b.h) {
        return { kind: 'bench', index: i };
      }
    }
    const cell = cellAt(pos.x, pos.y);
    if (cell && cell.row >= 4) return { kind: 'cell', col: cell.col, row: cell.row };
    return null;
  }

  function shopRowRect() {
    const first = shopCardRect(0);
    const last = shopCardRect(LAYOUT.shop.cards - 1);
    return { x: first.x, y: first.y, w: last.x + last.w - first.x, h: first.h };
  }

  function endDrag(pos) {
    const s = state();
    const d = view.drag;
    view.drag = null;
    view.drop = null;
    if (!d) return;

    const target = dropTargetAt(pos);
    if (d.kind === 'shop') {
      if (!d.moved) { tryBuy(d.index, null); return; }
      tryBuy(d.index, target);
      return;
    }

    const u = d.unit;
    if (!u || !s.units.includes(u)) return;
    if (!d.moved) return;
    if (!target) return;
    if (target.kind === 'sell') {
      trySell(u);
      return;
    }
    if (target.kind === 'cell') {
      const res = placeOnBoard(s, u, target.col, target.row);
      if (res.ok) audio.place();
      else { audio.error(); toast(s, res.reason || 'Cannot place there.'); }
      return;
    }
    if (target.kind === 'bench') {
      const res = placeOnBench(s, u, target.index);
      if (res.ok) audio.place();
    }
  }

  // -------------------------------------------------------------------------
  // Tooltips
  // -------------------------------------------------------------------------

  function tooltipFor(hit, pos) {
    const s = state();
    if (!hit) return null;
    if (hit.kind === 'shop') {
      const id = s.shop[hit.index];
      if (!id) return null;
      const t = unitTooltip(id, 1);
      return { ...t, x: pos.x, y: pos.y };
    }
    if (hit.kind === 'bench' || hit.kind === 'cell') {
      const u = hit.kind === 'bench' ? unitInBench(s, hit.index) : unitAt(s, hit.col, hit.row);
      if (!u) return null;
      const t = unitTooltip(u.defId, u.star);
      const owned = s.units.filter((x) => x.defId === u.defId).length;
      t.lines = t.lines.concat([`you own ${owned} ${owned === 1 ? 'copy' : 'copies'}`]);
      return { ...t, x: pos.x, y: pos.y };
    }
    if (hit.kind === 'trait') {
      const trait = TRAIT_BY_ID[hit.trait];
      return {
        title: trait.name,
        sub: `${trait.glyph} · synergy`,
        lines: [
          trait.blurb,
          '',
          ...trait.tiers.map((t) => `${t.count} units — ${t.text}`),
        ],
        x: pos.x,
        y: pos.y,
      };
    }
    if (hit.kind === 'button') {
      const lines = {
        fight: ['Fight the round with your board.', 'Space also works.'],
        reroll: [`Refresh the shop for ${CFG.rerollCost} gold.`],
        speed: ['Cycle combat speed: 1x, 2x, 4x.'],
        mute: ['Toggle sound.'],
        help: ['Controls and rules.'],
        continue: ['Go on to the next round.'],
        difficulty: [
          'Enemy health and attack, on top of the fitted ladder.',
          '',
          ...DIFFICULTIES.map((d) => `${d.id === s.difficulty ? '> ' : '  '}${d.name}  ${Math.round(d.scale * 100)}%  —  ${d.blurb}`),
          '',
          s.round === 1 && s.units.length === 0
            ? 'Click or press D to change it. Fixed once you buy.'
            : 'Locked for this run.',
        ],
      }[hit.id];
      if (!lines) return null;
      if (hit.id === 'difficulty') return { title: 'Difficulty', sub: difficultyById(s.difficulty).name, lines, x: pos.x, y: pos.y };
      return { title: 'Button', sub: hit.id, lines, x: pos.x, y: pos.y };
    }
    return null;
  }

  // -------------------------------------------------------------------------
  // Events
  // -------------------------------------------------------------------------

  function onDown(ev) {
    if (ev.button === 2) return;
    const s = state();
    audio.unlock();
    const pos = toLogical(ev);
    pointer.down = true;
    pointer.id = ev.pointerId;
    pointer.downAt = performance.now();
    pointer.moved = false;
    pointer.x = pos.x;
    pointer.y = pos.y;
    canvas.setPointerCapture?.(ev.pointerId);

    const hit = hitTest(s, pos.x, pos.y);
    if (hit && hit.kind === 'trait') {
      s.selected = null;
      return;
    }
    if (hit && hit.kind === 'button') {
      handleButton(hit.id);
      return;
    }
    // Clicking empty paper dismisses the stat card.
    if (!beginDrag(hit || { kind: 'none' }, pos)) s.selected = null;
  }

  function onMove(ev) {
    const s = state();
    const pos = toLogical(ev);
    pointer.x = pos.x;
    pointer.y = pos.y;
    view.cursor = { x: pos.x, y: pos.y };

    if (view.drag) {
      if (Math.hypot(pos.x - view.drag.sx, pos.y - view.drag.sy) > 4) view.drag.moved = true;
      view.drag.x = pos.x;
      view.drag.y = pos.y;
      view.drop = dropTargetAt(pos);
      view.hover = view.drop && view.drop.kind === 'cell' ? view.drop : null;
      view.tooltip = null;
      return;
    }

    const hit = hitTest(s, pos.x, pos.y);
    view.hover = hit;
    view.tooltip = tooltipFor(hit, pos);
  }

  function onUp(ev) {
    if (!pointer.down) return;
    const pos = toLogical(ev);
    pointer.down = false;
    pointer.x = pos.x;
    pointer.y = pos.y;
    endDrag(pos);
    const s = state();
    view.hover = hitTest(s, pos.x, pos.y);
    view.tooltip = tooltipFor(view.hover, pos);
  }

  function onLeave() {
    view.cursor = null;
    if (!view.drag) { view.hover = null; view.tooltip = null; }
  }

  function onContext(ev) {
    ev.preventDefault();
    const s = state();
    const pos = toLogical(ev);
    const hit = hitTest(s, pos.x, pos.y);
    if (hit && (hit.kind === 'bench' || hit.kind === 'cell')) {
      const u = hit.kind === 'bench' ? unitInBench(s, hit.index) : unitAt(s, hit.col, hit.row);
      if (u) trySell(u);
    }
  }

  function onKey(ev) {
    const s = state();
    const k = ev.key;
    if (k === ' ' || k === 'Enter') {
      ev.preventDefault();
      primary();
      return;
    }
    if (k === 'r' || k === 'R') { tryReroll(); return; }
    if (k === 'm' || k === 'M') { audio.toggle(); return; }
    if (k === 'd' || k === 'D') { cycleDifficulty(); return; }
    // Z X C V B buy the five shop slots without touching the mouse (the number
    // keys are taken by speed, and r/s/m already mean reroll, sell, mute).
    const slot = 'zxcvb'.indexOf(k.length === 1 ? k.toLowerCase() : '');
    if (slot >= 0 && s.shop[slot]) { tryBuy(slot, null); return; }
    if (k === '1') { setSpeed(s, 1); return; }
    if (k === '2') { setSpeed(s, 2); return; }
    if (k === '4') { setSpeed(s, 4); return; }
    if (k === 'h' || k === 'H' || k === '?') { view.help = !view.help; return; }
    if (k === 'Escape') {
      view.help = false;
      view.drag = null;
      s.selected = null;
      return;
    }
    if (k === 's' || k === 'S' || k === 'Delete' || k === 'Backspace') {
      if (s.selected) trySell(s.selected);
    }
  }

  canvas.addEventListener('pointerdown', onDown);
  canvas.addEventListener('pointermove', onMove);
  canvas.addEventListener('pointerup', onUp);
  canvas.addEventListener('pointercancel', onUp);
  canvas.addEventListener('pointerleave', onLeave);
  canvas.addEventListener('contextmenu', onContext);
  window.addEventListener('keydown', onKey);

  // Selection hygiene: drop a stale selection when its unit is gone.
  function update(dt) {
    view.time += dt;
    const s = state();
    if (s.selected && !s.units.includes(s.selected)) s.selected = null;
    // The "New" button only stays armed for a few seconds, so a stray click
    // cannot be completed by a later, unrelated one.
    if (s.armedNewRun && Date.now() - s.armedNewRun > 4000) s.armedNewRun = 0;
    if (view.help) {
      view.hover = null;
      view.tooltip = null;
    }
  }

  function destroy() {
    canvas.removeEventListener('pointerdown', onDown);
    canvas.removeEventListener('pointermove', onMove);
    canvas.removeEventListener('pointerup', onUp);
    canvas.removeEventListener('pointercancel', onUp);
    canvas.removeEventListener('pointerleave', onLeave);
    canvas.removeEventListener('contextmenu', onContext);
    window.removeEventListener('keydown', onKey);
  }

  return { view, update, destroy, buttons, overlayButton, tryFight, tryReroll, setState };
}
