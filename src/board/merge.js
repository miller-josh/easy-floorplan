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
  return { t, dups };
}
