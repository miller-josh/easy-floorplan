// Plan index and geometry helpers for the board. Pivot math lives in ./lib/transform.ts (unchanged from the handoff).
import { primBox, unite, itemFrame, worldBox, sizeOf, fmtFtIn, DEFAULT_T } from "./lib/transform";

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
  const wallSegs = [];
  for (const p of base.static) {
    if (p.t === "f" && p.L === "WALLS") {
      const q = p.pts, n = q.length / 2;
      for (let i = 0; i < n; i++) { const j = (i + 1) % n; wallSegs.push([q[2 * i], q[2 * i + 1], q[2 * j], q[2 * j + 1]]); }
    }
  }
  const allB = unite(base.static.filter((p) => p.t !== "x").map(primBox).concat(list.map((i) => i.box)));
  return { base, byId, list, wallSegs, allB };
}

export const tOf = (state, id) => {
  const t = state.t[id];
  return t ? (t.sx == null || t.sy == null ? { ...DEFAULT_T, ...t, sx: t.sx ?? 1, sy: t.sy ?? 1 } : t) : DEFAULT_T;
};

export function getItem(index, state, id) {
  id = String(id);
  const b = index.byId.get(id);
  if (b) return b;
  const d = state.dups.find((x) => x.id === id);
  const src = d && index.byId.get(String(d.src));
  return src ? { ...src, id: d.id, dupOf: src.id } : null;
}
export function itemsAll(index, state) {
  const out = index.list.slice();
  for (const d of state.dups) { const it = getItem(index, state, d.id); if (it) out.push(it); }
  return out;
}

export const wbox = (it, t) => worldBox(it, t);
export const dname = (it, t) => it.kind === "wall" ? "Wall · " + fmtFtIn(Math.max(...sizeOf(it, t))) + " long" : it.name;

/* ---------- gap lines ---------- */
export function rayHit(index, x, y, dir, boxes) {
  let best = Infinity;
  for (const [ax, ay, bx, by] of index.wallSegs) {
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
  const boxes = itemsAll(index, state)
    .filter((i) => i.id !== String(id) && i.kind !== "zone" && !i.overhead && !tOf(state, i.id).hidden)
    .map((i) => worldBox(i, tOf(state, i.id)));
  const res = [];
  for (const dir of ["L", "R", "D", "U"]) {
    let best = { d: Infinity };
    for (let k = 1; k <= 5; k++) {
      const f = k / 6;
      if (dir === "L" || dir === "R") {
        const y = b[1] + (b[3] - b[1]) * f, x = dir === "L" ? b[0] : b[2];
        const d = rayHit(index, x, y, dir, boxes); if (d < best.d) best = { d, x, y };
      } else {
        const x = b[0] + (b[2] - b[0]) * f, y = dir === "D" ? b[1] : b[3];
        const d = rayHit(index, x, y, dir, boxes); if (d < best.d) best = { d, x, y };
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
    moves.push({ item: dname(it, t), tag: it.tag || undefined, id: it.id, copyOf: it.dupOf ? Number(it.dupOf) : undefined, removed: t.hidden || undefined,
      move_right_in: +t.dx.toFixed(2), move_up_in: +t.dy.toFixed(2), rotate_ccw_deg: t.rot, resized: (t.sx !== 1 || t.sy !== 1) || undefined,
      size_w_by_d_in: [+sz[0].toFixed(1), +sz[1].toFixed(1)], new_box_in: b.map((v) => +v.toFixed(1)) });
  }
  return { plan: planName, units: "inches", moves };
}
