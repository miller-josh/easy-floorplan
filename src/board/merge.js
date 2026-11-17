// Three-way merge of layout states, used by "Keep mine" when someone else saved first.
// base = the shared layout my draft started from, mine = my draft, theirs = the newly saved layout.
// Anything I changed relative to base is applied on top of theirs (mine wins on the same item);
// everything else comes from theirs, so neither person's moves are lost.
const DEFAULT = { dx: 0, dy: 0, rot: 0, hidden: false, sx: 1, sy: 1 };
const eq = (a, b) => JSON.stringify({ ...DEFAULT, ...a }) === JSON.stringify({ ...DEFAULT, ...b });

export function mergeStates(base, mine, theirs) {
  const t = { ...theirs.t };
  for (const k of new Set([...Object.keys(base.t), ...Object.keys(mine.t)])) {
    if (!eq(base.t[k], mine.t[k])) t[k] = { ...DEFAULT, ...(mine.t[k] || {}) };
  }
  const have = new Set(theirs.dups.map((d) => d.id));
  const baseIds = new Set(base.dups.map((d) => d.id));
  const dups = [...theirs.dups, ...mine.dups.filter((d) => !baseIds.has(d.id) && !have.has(d.id))];
  const out = { t, dups };
  // Walls drawn by either person are kept; reshaped lines follow whoever changed them (mine wins on a tie).
  const wl = (x) => x.walls || [];
  const wHave = new Set(wl(theirs).map((w) => w.id)), wBase = new Map(wl(base).map((w) => [w.id, JSON.stringify(w)]));
  const walls = wl(theirs).map((w) => { const m = wl(mine).find((x) => x.id === w.id); return m && wBase.get(w.id) !== JSON.stringify(m) ? m : w; });
  for (const w of wl(mine)) if (!wHave.has(w.id) && !wBase.has(w.id)) walls.push(w);
  if (walls.length) out.walls = walls;
  const geo = { ...(theirs.geo || {}) }, bg = base.geo || {}, mg = mine.geo || {};
  for (const k of new Set([...Object.keys(bg), ...Object.keys(mg)])) if (JSON.stringify(bg[k]) !== JSON.stringify(mg[k])) { if (mg[k]) geo[k] = mg[k]; else delete geo[k]; }
  if (Object.keys(geo).length) out.geo = geo;
  return out;
}
