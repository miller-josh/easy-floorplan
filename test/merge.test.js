import test from "node:test";
import assert from "node:assert/strict";
import { mergeStates } from "../src/board/merge.js";

const T = (o) => ({ dx: 0, dy: 0, rot: 0, hidden: false, sx: 1, sy: 1, ...o });
test("changes on different items are both kept", () => {
  const base = { t: {}, dups: [] };
  const mine = { t: { 9: T({ dx: 3 }) }, dups: [] };
  const theirs = { t: { 8: T({ dy: 2 }) }, dups: [] };
  const m = mergeStates(base, mine, theirs);
  assert.equal(m.t[8].dy, 2); assert.equal(m.t[9].dx, 3);
});
test("same item: mine wins", () => {
  const m = mergeStates({ t: {}, dups: [] }, { t: { 7: T({ dx: 5 }) }, dups: [] }, { t: { 7: T({ dx: 9 }) }, dups: [] });
  assert.equal(m.t[7].dx, 5);
});
test("items I did not touch come from theirs; items I put back are reset", () => {
  const base = { t: { 7: T({ dx: 5 }), 8: T({ dy: 1 }) }, dups: [] };
  const mine = { t: { 8: T({ dy: 1 }) }, dups: [] };              // put item 7 back
  const theirs = { t: { 7: T({ dx: 5 }), 8: T({ dy: 4 }) }, dups: [] };
  const m = mergeStates(base, mine, theirs);
  assert.equal(m.t[7].dx, 0); assert.equal(m.t[8].dy, 4);
});
test("duplicates from both sides are kept once", () => {
  const m = mergeStates({ t: {}, dups: [] }, { t: {}, dups: [{ id: "da", src: 1 }] }, { t: {}, dups: [{ id: "db", src: 2 }] });
  assert.deepEqual(m.dups.map((d) => d.id).sort(), ["da", "db"]);
});
