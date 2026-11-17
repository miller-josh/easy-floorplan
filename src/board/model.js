// Plan index and geometry helpers for the board. Pivot math lives in ./lib/transform.ts (unchanged from the handoff).
import { primBox, unite, itemFrame, worldBox, sizeOf, fmtFtIn, makeXf, DEFAULT_T } from "./lib/transform";

export const EMPTY_STATE = { t: {}, dups: [] };

/** Index a plan's base geometry once. Item ids become strings everywhere in the UI. */
export function buildIndex(base) {
  const byId = new Map();
  const list = [];
  for (const it of base.items) {
    const f = itemFrame(it);
    const e = { ...it, id: String(it.id), cx: f.cx, cy: f.cy, box: f.box, tagC: f.tagC, overhead: it.name.startsWith("Overhead") };
    byId.set(e.id, e); list.push(e);
  }
  // Every fixed wall, shell line and label is an item too, so it can be selected, moved, reshaped or removed.
  const counts = {};
  base.static.forEach((p, i) => {
    const kind = p.t === "x" ? "Label" : p.t === "f" ? "Wall piece" : p.L === "WALLS" ? "Wall outline" : "Building line";
    counts[kind] = (counts[kind] || 0) + 1;
    const it = { id: "s" + i, name: p.t === "x" ? p.s.split("\n")[0] : kind + " " + counts[kind], kind: "wall", tag: null, prims: [p], static: true };
    const f = itemFrame(it);
    const e = { ...it, cx: f.cx, cy: f.cy, box: f.box, tagC: null, overhead: false };
    byId.set(e.id, e); list.push(e);
  });
  const wallSegs = [];
  for (const p of base.static) {
    if (p.t === "f" && p.L === "WALLS") {
      const q = p.pts, n = q.length / 2;
      for (let i = 0; i < n; i++) { const j = (i + 1) % n; wallSegs.push([q[2 * i], q[2 * i + 1], q[2 * j], q[2 * j + 1]]); }
    }
  }
  const allB = unite(list.filter((i) => !(i.static && i.prims[0].t === "x")).map((i) => i.box));
  return { base, byId, list, wallSegs, allB };
}

export const tOf = (state, id) => {
  const t = state.t[id];
  return t ? (t.sx == null || t.sy == null ? { ...DEFAULT_T, ...t, sx: t.sx ?? 1, sy: t.sy ?? 1 } : t) : DEFAULT_T;
};

/* ---------- editable geometry: reshaped static lines (state.geo) and walls drawn by the user (state.walls) ---------- */
export function triangulate(pts) {
  const n = pts.length / 2, idx = [...Array(n).keys()];
  const X = (i) => pts[2 * i], Y = (i) => pts[2 * i + 1];
  let area = 0; for (let i = 0; i < n; i++) { const j = (i + 1) % n; area += X(i) * Y(j) - X(j) * Y(i); }
  const sg = area >= 0 ? 1 : -1, out = [];
  const inTri = (p, a, b, c) => {
    const d = (p1, p2, p3) => (X(p1) - X(p3)) * (Y(p2) - Y(p3)) - (X(p2) - X(p3)) * (Y(p1) - Y(p3));
    const d1 = d(p, a, b), d2 = d(p, b, c), d3 = d(p, c, a);
    return !((d1 < 0 || d2 < 0 || d3 < 0) && (d1 > 0 || d2 > 0 || d3 > 0));
  };
  let guard = 0;
  while (idx.length > 3 && guard++ < 2000) {
    let cut = false;
    for (let k = 0; k < idx.length; k++) {
      const a = idx[(k + idx.length - 1) % idx.length], b = idx[k], c = idx[(k + 1) % idx.length];
      if (((X(b) - X(a)) * (Y(c) - Y(a)) - (Y(b) - Y(a)) * (X(c) - X(a))) * sg <= 1e-9) continue;
      if (idx.some((q) => q !== a && q !== b && q !== c && inTri(q, a, b, c))) continue;
      out.push(a, b, c); idx.splice(k, 1); cut = true; break;
    }
    if (!cut) break;
  }
  if (idx.length >= 3) for (let k = 1; k < idx.length - 1; k++) out.push(idx[0], idx[k], idx[k + 1]);
  return out;
}

const geoCache = new WeakMap(), wallCache = new WeakMap();
function withPts(e, pts) {
  const hit = geoCache.get(pts); if (hit && hit.e === e) return hit.out;
  const p = e.prims[0]; const np = p.t === "f" ? { ...p, pts, tri: triangulate(pts) } : { ...p, pts };
  const f = itemFrame({ prims: [np] });
  const out = { ...e, prims: [np], cx: f.cx, cy: f.cy, box: f.box };
  geoCache.set(pts, { e, out }); return out;
}
function wallItem(w) {
  let out = wallCache.get(w); if (out) return out;
  const prim = { t: "f", pts: w.pts, tri: triangulate(w.pts), f: "#6f7378", o: 1, L: "WALLS" };
  const it = { id: w.id, name: "New wall", kind: "wall", tag: null, prims: [prim], user: true };
  const f = itemFrame(it);
  out = { ...it, cx: f.cx, cy: f.cy, box: f.box, tagC: null, overhead: false };
  wallCache.set(w, out); return out;
}
/** Four corners of a wall drawn from a to b with the given thickness (inches), centered on the line a-b. */
export function wallPts(a, b, th) {
  const dx = b[0] - a[0], dy = b[1] - a[1], len = Math.hypot(dx, dy) || 1;
  const nx = (-dy / len) * th / 2, ny = (dx / len) * th / 2;
  return [a[0] + nx, a[1] + ny, b[0] + nx, b[1] + ny, b[0] - nx, b[1] - ny, a[0] - nx, a[1] - ny].map((v) => +v.toFixed(3));
}
export const canReshape = (it) => !!it && !it.dupOf && (it.user || (it.static && it.prims[0].t !== "x"));
export const userWalls = (state) => state.walls || [];

const txtCache = new WeakMap();
function withText(e, text) {
  const hit = txtCache.get(e); if (hit && hit.text === text) return hit.out;
  const out = { ...e, prims: [{ ...e.prims[0], s: text }], name: text.split("\n")[0] || "Label" };
  txtCache.set(e, { text, out }); return out;
}
function resolveStatic(e, state) {
  const g = state.geo && state.geo[e.id], x = state.txt && state.txt[e.id];
  return g ? withPts(e, g) : typeof x === "string" && e.prims[0].t === "x" ? withText(e, x) : e;
}

export function getItem(index, state, id) {
  id = String(id);
  const b = index.byId.get(id);
  if (b) return resolveStatic(b, state);
  const w = userWalls(state).find((x) => x.id === id);
  if (w) return wallItem(w);
  const d = state.dups.find((x) => x.id === id);
  const src = d && getItem(index, state, String(d.src));
  return src ? { ...src, id: d.id, dupOf: src.id } : null;
}
export function itemsAll(index, state) {
  const out = index.list.map((e) => resolveStatic(e, state));
  for (const w of userWalls(state)) out.push(wallItem(w));
  for (const d of state.dups) { const it = getItem(index, state, d.id); if (it) out.push(it); }
  return out;
}
/** Replace the points of a reshapeable item. */
export function setPts(state, id, pts) {
  if (userWalls(state).some((w) => w.id === id)) return { ...state, walls: state.walls.map((w) => (w.id === id ? { ...w, pts } : w)) };
  return { ...state, geo: { ...(state.geo || {}), [id]: pts } };
}
/** Fold an item's move/rotate/resize into its points so single corners can be dragged. */
export function bakeItem(index, state, id) {
  const it = getItem(index, state, id), t = tOf(state, id);
  if (!it || (!t.dx && !t.dy && !t.rot && t.sx === 1 && t.sy === 1)) return state;
  const f = makeXf(it, t), src = it.prims[0].pts, pts = [];
  for (let i = 0; i < src.length; i += 2) { const q = f(src[i], src[i + 1]); pts.push(+q[0].toFixed(3), +q[1].toFixed(3)); }
  return setT(setPts(state, id, pts), id, { dx: 0, dy: 0, rot: 0, sx: 1, sy: 1 });
}
/** Plan + layout in the shape the DXF writer expects, with edits folded in. */
export function exportView(index, state) {
  const items = itemsAll(index, state).map((i) => ({ ...i }));
  const t = {}; for (const i of items) if (state.t[i.id]) t[i.id] = state.t[i.id];
  return { base: { static: [], items }, state: { t, dups: [] } };
}

export const wbox = (it, t) => worldBox(it, t);
export const dname = (it, t) => it.static ? it.name : it.kind === "wall" ? "Wall · " + fmtFtIn(Math.max(...sizeOf(it, t))) + " long" : it.name;

/* ---------- gap lines ---------- */
export function rayHit(segs, x, y, dir, boxes) {
  let best = Infinity;
  for (const [ax, ay, bx, by] of segs) {
    if (dir === "L" || dir === "R") {
      if ((ay - y) * (by - y) > 0 || ay === by) continue;
      const ix = ax + (y - ay) * (bx - ax) / (by - ay);
      const d = dir === "L" ? x - ix : ix - x;
      if (d >= -0.01 && d < best) best = Math.max(d, 0);
    } else {
      if ((ax - x) * (bx - x) > 0 || ax === bx) continue;
      const iy = ay + (x - ax) * (by - ay) / (bx - ax);
      const d = dir === "D" ? y - iy : iy - y;
      if (d >= -0.01 && d < best) best = Math.max(d, 0);
    }
  }
  for (const b of boxes) {
    if (dir === "L" && y > b[1] && y < b[3] && b[2] <= x + 0.01) best = Math.min(best, x - b[2]);
    if (dir === "R" && y > b[1] && y < b[3] && b[0] >= x - 0.01) best = Math.min(best, b[0] - x);
    if (dir === "D" && x > b[0] && x < b[2] && b[3] <= y + 0.01) best = Math.min(best, y - b[3]);
    if (dir === "U" && x > b[0] && x < b[2] && b[1] >= y - 0.01) best = Math.min(best, b[1] - y);
  }
  return best;
}

/** Nearest wall or item in 4 directions from the selected item. */
export function computeGaps(index, state, id) {
  const it = getItem(index, state, id);
  const t = tOf(state, id);
  if (!it || t.hidden || it.kind === "zone") return [];
  const b = worldBox(it, t);
  // Wall edges at their current positions (moved, reshaped, drawn), not where they started.
  const segs = [];
  for (const w of itemsAll(index, state)) {
    const p = w.prims[0]; if (w.id === String(id) || !(w.static || w.user) || p.t !== "f" || p.L !== "WALLS") continue;
    const wt = tOf(state, w.id); if (wt.hidden) continue;
    const f = makeXf(w, wt), n = p.pts.length / 2, q = [];
    for (let i = 0; i < n; i++) q.push(f(p.pts[2 * i], p.pts[2 * i + 1]));
    for (let i = 0; i < n; i++) { const a = q[i], c = q[(i + 1) % n]; segs.push([a[0], a[1], c[0], c[1]]); }
  }
  const boxes = itemsAll(index, state)
    .filter((i) => i.id !== String(id) && i.kind !== "zone" && !i.static && !i.overhead && !tOf(state, i.id).hidden)
    .map((i) => worldBox(i, tOf(state, i.id)));
  const res = [];
  for (const dir of ["L", "R", "D", "U"]) {
    let best = { d: Infinity };
    for (let k = 1; k <= 5; k++) {
      const f = k / 6;
      if (dir === "L" || dir === "R") {
        const y = b[1] + (b[3] - b[1]) * f, x = dir === "L" ? b[0] : b[2];
        const d = rayHit(segs, x, y, dir, boxes); if (d < best.d) best = { d, x, y };
      } else {
        const x = b[0] + (b[2] - b[0]) * f, y = dir === "D" ? b[1] : b[3];
        const d = rayHit(segs, x, y, dir, boxes); if (d < best.d) best = { d, x, y };
      }
    }
    if (best.d < 600) {
      const { x, y, d } = best;
      res.push({ dir, d, x, y, x2: dir === "L" ? x - d : dir === "R" ? x + d : x, y2: dir === "D" ? y - d : dir === "U" ? y + d : y });
    }
  }
  return res;
}

/* ---------- immutable state edits (unchanged items keep object identity so React can skip them) ---------- */
export const setT = (state, id, patch) => ({ ...state, t: { ...state.t, [id]: { ...tOf(state, id), ...patch } } });

/** Set an item's on-screen size, keeping a chosen world center (mirrors the reference setWorldSize). */
export function withWorldSize(index, state, id, W, D, cxW, cyW) {
  const it = getItem(index, state, id), t = tOf(state, id);
  const q = ((t.rot % 360) + 360) % 360, swap = q === 90 || q === 270;
  const bw = it.box[2] - it.box[0], bh = it.box[3] - it.box[1];
  const lx = swap ? D : W, ly = swap ? W : D;
  const patch = { sx: Math.max(lx, 1) / Math.max(bw, 0.01), sy: Math.max(ly, 1) / Math.max(bh, 0.01) };
  if (cxW != null) { patch.dx = cxW - it.cx; patch.dy = cyW - it.cy; }
  return setT(state, id, patch);
}

export function movesJSON(index, state, planName) {
  const moves = [];
  for (const it of itemsAll(index, state)) {
    const t = state.t[it.id]; if (!t) continue;
    if (!(t.dx || t.dy || t.rot || t.hidden || it.dupOf || t.sx !== 1 || t.sy !== 1)) continue;
    const sz = sizeOf(it, t), b = worldBox(it, t);
    moves.push({ item: dname(it, t), tag: it.tag || undefined, id: it.id, copyOf: it.dupOf ? (isNaN(Number(it.dupOf)) ? it.dupOf : Number(it.dupOf)) : undefined, removed: t.hidden || undefined,
      move_right_in: +t.dx.toFixed(2), move_up_in: +t.dy.toFixed(2), rotate_ccw_deg: t.rot, resized: (t.sx !== 1 || t.sy !== 1) || undefined,
      size_w_by_d_in: [+sz[0].toFixed(1), +sz[1].toFixed(1)], new_box_in: b.map((v) => +v.toFixed(1)) });
  }
  return { plan: planName, units: "inches", moves };
}
