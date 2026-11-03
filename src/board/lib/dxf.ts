// DXF R12 (AC1009) writer ported from reference/layout-board.html. Opens in QCAD, LibreCAD, AutoCAD.
// Walls and fills export as SOLID triangles, lines as LINE/POLYLINE, text as TEXT. Units: inches.
import type { PlanBase, PlanItem, Prim, LayoutState, ItemTransform } from './plan-types';
import { DEFAULT_T, makeXf, makeTagXf, zoneLabel } from './transform';

const HEX2ACI: Record<string, number> = { '#1e1e1e': 7, '#7a7a7a': 8, '#bdbdbd': 9, '#d2d2d2': 254, '#5b5b5b': 251, '#7fd67f': 3, '#2f55d4': 5, '#d4342c': 1, '#ffffff': 255, '#e0b400': 2, '#e07a1e': 30, '#6f7378': 8 };
const aci = (h?: string) => HEX2ACI[(h || '').toLowerCase()] ?? 7;

type Xf = ((x: number, y: number) => [number, number]) & { sc?: [number, number]; t?: ItemTransform };

export function allItems(base: PlanBase, st: LayoutState): (PlanItem & { _id: string })[] {
  const byId = new Map(base.items.map(i => [i.id, i]));
  return [
    ...base.items.map(i => ({ ...i, _id: String(i.id) })),
    ...st.dups.flatMap(d => { const src = byId.get(d.src); return src ? [{ ...src, _id: d.id }] : []; }),
  ];
}

export function buildDXF(base: PlanBase, st: LayoutState): string {
  const out: (string | number)[] = [];
  const w = (c: number, v: string | number) => out.push(c, typeof v === 'number' ? String(+v.toFixed(4)) : v);
  w(0, 'SECTION'); w(2, 'HEADER'); w(9, '$ACADVER'); w(1, 'AC1009'); w(9, '$INSUNITS'); w(70, 1); w(9, '$MEASUREMENT'); w(70, 0); w(0, 'ENDSEC');
  const layers = new Set<string>();
  const ents: any[] = [];
  const emit = (p: Prim, f: Xf, rot: number, layer: string) => {
    layers.add(layer);
    if (p.t === 'h') return;
    if (p.t === 'f') {
      const P: [number, number][] = []; for (let i = 0; i < p.pts.length; i += 2) P.push(f(p.pts[i], p.pts[i + 1]));
      const col = p.L === 'TAGS' ? 255 : aci(p.f);
      for (let i = 0; i < p.tri.length; i += 3) {
        const a = P[p.tri[i]], b = P[p.tri[i + 1]], c = P[p.tri[i + 2]];
        ents.push(['SOLID', layer, col, [[10, a[0]], [20, a[1]], [11, b[0]], [21, b[1]], [12, c[0]], [22, c[1]], [13, c[0]], [23, c[1]]]]);
      }
      return;
    }
    if (p.t === 'p') {
      const P: [number, number][] = []; for (let i = 0; i < p.pts.length; i += 2) P.push(f(p.pts[i], p.pts[i + 1]));
      if (P.length === 2 && !p.c) ents.push(['LINE', layer, aci(p.s), [[10, P[0][0]], [20, P[0][1]], [11, P[1][0]], [21, P[1][1]]]]);
      else ents.push(['POLY', layer, aci(p.s), P, p.c ? 1 : 0]);
      return;
    }
    if (p.t === 'c') {
      const sc = f.sc || [1, 1];
      if (Math.abs(sc[0] - sc[1]) < 1e-6) { const c = f(p.x, p.y); ents.push(['CIRCLE', layer, aci(p.s), [[10, c[0]], [20, c[1]], [40, p.r * sc[0]]]]); }
      else { const P: [number, number][] = []; for (let i = 0; i < 48; i++) { const a = i / 48 * 2 * Math.PI; P.push(f(p.x + p.r * Math.cos(a), p.y + p.r * Math.sin(a))); } ents.push(['POLY', layer, aci(p.s), P, 1]); }
      return;
    }
    if (p.t === 'x') {
      const c = f(p.x, p.y); const r = p.up ? p.r : p.r + rot;
      const text = f.t && /sq ft/.test(p.s) ? zoneLabel(p.s, f.t) : p.s;
      const ha = ({ l: 0, c: 1, r: 2 } as any)[p.a[0]], va = ({ b: 1, m: 2, t: 3 } as any)[p.a[1]];
      const lines = text.split('\n'); const step = p.h * 1.6; const rr = r * Math.PI / 180;
      const start = p.a[1] === 'b' ? (lines.length - 1) * step : p.a[1] === 'm' ? (lines.length - 1) * step / 2 : 0;
      lines.forEach((ln, i) => {
        const off = i * step - start; const x = c[0] + off * Math.sin(rr), y = c[1] - off * Math.cos(rr);
        ents.push(['TEXT', layer, aci(p.col), [[10, x], [20, y], [40, p.h], [1, ln.replace(/[\r\n]/g, ' ')], [50, r], [72, ha], [11, x], [21, y], [73, va]]]);
      });
    }
  };
  const tOf = (id: string): ItemTransform => ({ ...DEFAULT_T, ...(st.t[id] || {}) });
  const sxf = (it: PlanItem, t: ItemTransform): Xf => { const f = makeXf(it, t) as Xf; f.sc = [t.sx, t.sy]; f.t = t; return f; };
  const ident: Xf = (x, y) => [x, y];
  const all = allItems(base, st).filter(i => !tOf(i._id).hidden);
  // draw order: zones, static shell, walls/equipment, tags
  for (const it of all.filter(i => i.kind === 'zone')) { const t = tOf(it._id); for (const p of it.prims) emit(p, sxf(it, t), t.rot, p.L); }
  for (const p of base.static) emit(p, ident, 0, p.L);
  for (const it of all.filter(i => i.kind !== 'zone')) { const t = tOf(it._id); for (const p of it.prims) if (p.L !== 'TAGS') emit(p, sxf(it, t), t.rot, p.L); }
  for (const it of all.filter(i => i.kind !== 'zone')) { const t = tOf(it._id); for (const p of it.prims) if (p.L === 'TAGS') emit(p, makeTagXf(it, t) as Xf, t.rot, p.L); }

  w(0, 'SECTION'); w(2, 'TABLES'); w(0, 'TABLE'); w(2, 'LAYER'); w(70, layers.size);
  for (const L of layers) { w(0, 'LAYER'); w(2, L); w(70, 0); w(62, 7); w(6, 'CONTINUOUS'); }
  w(0, 'ENDTAB'); w(0, 'ENDSEC');
  w(0, 'SECTION'); w(2, 'ENTITIES');
  for (const e of ents) {
    const [type, L, col] = e;
    if (type === 'POLY') {
      w(0, 'POLYLINE'); w(8, L); w(62, col); w(66, 1); w(10, 0); w(20, 0); w(30, 0); w(70, e[4]);
      for (const q of e[3]) { w(0, 'VERTEX'); w(8, L); w(10, q[0]); w(20, q[1]); w(30, 0); }
      w(0, 'SEQEND'); w(8, L);
    } else { w(0, type); w(8, L); w(62, col); for (const [c, v] of e[3]) w(c, v); }
  }
  w(0, 'ENDSEC'); w(0, 'EOF');
  return out.join('\n') + '\n';
}
