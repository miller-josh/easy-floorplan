// Pure geometry helpers ported from reference/layout-board.html. No DOM.
import type { Prim, PlanItem, ItemTransform, LayoutState } from './plan-types';

export type Box = [number, number, number, number]; // minx, miny, maxx, maxy

export function primBox(p: Prim): Box {
  if (p.t === 'c') return [p.x - p.r, p.y - p.r, p.x + p.r, p.y + p.r];
  if (p.t === 'x') return [p.x, p.y, p.x, p.y];
  const a: Box = [Infinity, Infinity, -Infinity, -Infinity];
  for (let i = 0; i < p.pts.length; i += 2) {
    const x = p.pts[i], y = p.pts[i + 1];
    if (x < a[0]) a[0] = x; if (y < a[1]) a[1] = y; if (x > a[2]) a[2] = x; if (y > a[3]) a[3] = y;
  }
  return a;
}
export const unite = (bs: Box[]): Box =>
  bs.reduce<Box>((a, b) => [Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.max(a[2], b[2]), Math.max(a[3], b[3])],
    [Infinity, Infinity, -Infinity, -Infinity]);

/** Base bbox and pivot of an item (must match the reference exactly so saved transforms stay valid). */
export function itemFrame(it: PlanItem) {
  const geo = it.prims.filter(p => p.t !== 'x' && p.t !== 'h' && p.L !== 'TAGS');
  const box = unite((geo.length ? geo : it.prims).map(primBox));
  const tagText = it.prims.find(p => p.L === 'TAGS' && p.t === 'x') as Extract<Prim, { t: 'x' }> | undefined;
  return { box, cx: (box[0] + box[2]) / 2, cy: (box[1] + box[3]) / 2, tagC: tagText ? [tagText.x, tagText.y] as const : null };
}

export const DEFAULT_T: ItemTransform = { dx: 0, dy: 0, rot: 0, hidden: false, sx: 1, sy: 1 };

/** Map a base point to the world for this item. noScale=true is used for tags. */
export function makeXf(it: PlanItem, t: ItemTransform, noScale = false) {
  const { cx, cy } = itemFrame(it);
  const a = t.rot * Math.PI / 180, c = Math.cos(a), s = Math.sin(a);
  const sx = noScale ? 1 : t.sx, sy = noScale ? 1 : t.sy;
  return (x: number, y: number): [number, number] => {
    const ux = (x - cx) * sx, uy = (y - cy) * sy;
    return [cx + ux * c - uy * s + t.dx, cy + ux * s + uy * c + t.dy];
  };
}

/** Tags keep their size; their center follows the scaled item. */
export function makeTagXf(it: PlanItem, t: ItemTransform) {
  const { cx, cy, tagC } = itemFrame(it);
  const f = makeXf(it, t, true);
  const off = tagC ? [(tagC[0] - cx) * (t.sx - 1), (tagC[1] - cy) * (t.sy - 1)] : [0, 0];
  return (x: number, y: number) => f(x + off[0], y + off[1]);
}

export function worldBox(it: PlanItem, t: ItemTransform): Box {
  const f = makeXf(it, t); const b = itemFrame(it).box;
  const pts = [f(b[0], b[1]), f(b[2], b[1]), f(b[2], b[3]), f(b[0], b[3])];
  return [Math.min(...pts.map(p => p[0])), Math.min(...pts.map(p => p[1])), Math.max(...pts.map(p => p[0])), Math.max(...pts.map(p => p[1]))];
}

/** Size shown to the user (width x depth after rotation). */
export function sizeOf(it: PlanItem, t: ItemTransform): [number, number] {
  const b = itemFrame(it).box; const w = (b[2] - b[0]) * t.sx, h = (b[3] - b[1]) * t.sy;
  const q = ((t.rot % 180) + 180) % 180; return (q > 45 && q < 135) ? [h, w] : [w, h];
}

/** Drop default transforms so two states compare equal when they look the same. */
export function normalize(st: LayoutState): LayoutState {
  const t: LayoutState['t'] = {};
  for (const k in st.t) {
    const v = st.t[k];
    if (v.dx || v.dy || v.rot || v.hidden || (v.sx ?? 1) !== 1 || (v.sy ?? 1) !== 1)
      t[k] = { dx: v.dx || 0, dy: v.dy || 0, rot: v.rot || 0, hidden: !!v.hidden, sx: v.sx ?? 1, sy: v.sy ?? 1 };
  }
  return { t, dups: (st.dups || []).filter(d => (t[d.id] ? !t[d.id].hidden : true)) };
}

/** Clearance zone labels like "45.71 sq ft" update with the zone's scale. */
export function zoneLabel(text: string, t: ItemTransform) {
  const m = /^([\d.]+)\s*sq ft/.exec(text);
  return m ? (Number(m[1]) * t.sx * t.sy).toFixed(2) + ' sq ft' : text;
}

/** Feet-inches label, rounded to 1/2 inch: 26.5 -> 2′-2½″ */
export function fmtFtIn(inches: number) {
  const neg = inches < 0; const v = Math.round(Math.abs(inches) * 2) / 2;
  const ft = Math.floor(v / 12); let i = v - ft * 12; const frac = i % 1 ? '½' : ''; i = Math.floor(i);
  return (neg ? '−' : '') + (ft ? `${ft}′-${i}${frac}″` : `${i}${frac}″`);
}
