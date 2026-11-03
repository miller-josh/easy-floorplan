import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { freshDb, call, st, USERS } from "./helpers.js";

let db;
before(async () => { db = await freshDb(); });
after(async () => { await db.pool.end(); });
const P = () => "plans/" + db.planId;

test("requires sign in and membership", async () => {
  assert.equal((await call(db.router, null, "GET", P())).status, 401);
  assert.equal((await call(db.router, USERS.stranger, "GET", P())).status, 404);
  const r = await call(db.router, USERS.josh, "GET", P());
  assert.equal(r.status, 200);
  assert.equal(r.json.role, "owner");
  assert.equal(r.json.layout.rev, 1);
});

test("lists my plans", async () => {
  const r = await call(db.router, USERS.josh, "GET", "plans");
  assert.equal(r.json.plans.length, 1);
  assert.equal((await call(db.router, USERS.stranger, "GET", "plans")).json.plans.length, 0);
});

test("owner saves, rev increments, history records name", async () => {
  const r = await call(db.router, USERS.josh, "POST", P() + "/layout", { expectedRev: 1, state: st(10) });
  assert.equal(r.status, 200); assert.equal(r.json.rev, 2);
  const h = await call(db.router, USERS.josh, "GET", P() + "/revisions");
  assert.equal(h.json.revisions[0].rev, 2);
  assert.equal(h.json.revisions[0].saved_by_name, "Josh");
  const one = await call(db.router, USERS.josh, "GET", P() + "/revisions/2");
  assert.equal(one.json.state.t[5].dx, 10);
});

test("stale save gets 409 with the latest layout and loses nothing", async () => {
  const r = await call(db.router, USERS.josh, "POST", P() + "/layout", { expectedRev: 1, state: st(99) });
  assert.equal(r.status, 409); assert.equal(r.json.error, "conflict");
  assert.equal(r.json.layout.rev, 2); assert.equal(r.json.layout.state.t[5].dx, 10);
});

test("two simultaneous saves: exactly one wins", async () => {
  const cur = (await call(db.router, USERS.josh, "GET", P() + "/layout")).json.rev;
  const rs = await Promise.all([1, 2, 3, 4].map(i => call(db.router, USERS.josh, "POST", P() + "/layout", { expectedRev: cur, state: st(i) })));
  assert.equal(rs.filter(r => r.status === 200).length, 1);
  assert.equal(rs.filter(r => r.status === 409).length, 3);
});

test("polling returns unchanged when rev matches", async () => {
  const cur = (await call(db.router, USERS.josh, "GET", P() + "/layout")).json.rev;
  const same = await call(db.router, USERS.josh, "GET", P() + "/layout", null, { since: String(cur) });
  assert.equal(same.json.unchanged, true);
  const old = await call(db.router, USERS.josh, "GET", P() + "/layout", null, { since: "1" });
  assert.ok(old.json.state);
});

test("rejects malformed state", async () => {
  const cur = (await call(db.router, USERS.josh, "GET", P() + "/layout")).json.rev;
  for (const state of [null, { t: [], dups: [] }, { t: { 1: { dx: "a" } }, dups: [] }, { t: {} }]) {
    assert.equal((await call(db.router, USERS.josh, "POST", P() + "/layout", { expectedRev: cur, state })).status, 400);
  }
});

let editorTok, viewerTok;
test("invites: owner creates, others cannot; accept adds role; single use", async () => {
  assert.equal((await call(db.router, USERS.josh, "POST", P() + "/invites", { role: "owner" })).status, 400);
  const e = await call(db.router, USERS.josh, "POST", P() + "/invites", { role: "editor" });
  const v = await call(db.router, USERS.josh, "POST", P() + "/invites", { role: "viewer" });
  editorTok = e.json.token; viewerTok = v.json.token;
  assert.match(editorTok, /^[0-9a-f]+$/);
  const a = await call(db.router, USERS.shannon, "POST", `invites/${editorTok}/accept`);
  assert.equal(a.status, 200); assert.equal(a.json.planId, db.planId);
  assert.equal((await call(db.router, USERS.al, "POST", `invites/${editorTok}/accept`)).status, 404);
  assert.equal((await call(db.router, USERS.al, "POST", `invites/${viewerTok}/accept`)).status, 200);
  assert.equal((await call(db.router, USERS.shannon, "POST", P() + "/invites", { role: "viewer" })).status, 403);
  assert.equal((await call(db.router, USERS.shannon, "GET", P() + "/members")).status, 403);
});

test("expired invite is rejected", async () => {
  const t = (await call(db.router, USERS.josh, "POST", P() + "/invites", { role: "viewer" })).json.token;
  await db.pool.query("update lb_plan_invites set expires_at = now() - interval '1 minute' where token = $1", [t]);
  assert.equal((await call(db.router, USERS.stranger, "POST", `invites/${t}/accept`)).status, 404);
});

test("editor can save and name is recorded; viewer cannot", async () => {
  const cur = (await call(db.router, USERS.josh, "GET", P() + "/layout")).json.rev;
  const r = await call(db.router, USERS.shannon, "POST", P() + "/layout", { expectedRev: cur, state: st(7) });
  assert.equal(r.status, 200);
  const h = await call(db.router, USERS.al, "GET", P() + "/revisions");
  assert.equal(h.json.revisions[0].saved_by_name, "Shannon");
  const v = await call(db.router, USERS.al, "POST", P() + "/layout", { expectedRev: r.json.rev, state: st(1) });
  assert.equal(v.status, 403);
  assert.equal((await call(db.router, USERS.al, "GET", P())).json.role, "viewer");
});

test("owner changes and removes members; owner is protected", async () => {
  assert.equal((await call(db.router, USERS.josh, "PATCH", P() + "/members/" + USERS.al, { role: "editor" })).status, 200);
  assert.equal((await call(db.router, USERS.al, "GET", P())).json.role, "editor");
  assert.equal((await call(db.router, USERS.josh, "PATCH", P() + "/members/" + USERS.josh, { role: "viewer" })).status, 400);
  assert.equal((await call(db.router, USERS.josh, "DELETE", P() + "/members/" + USERS.al)).status, 200);
  assert.equal((await call(db.router, USERS.al, "GET", P())).status, 404);
  const m = await call(db.router, USERS.josh, "GET", P() + "/members");
  assert.deepEqual(m.json.members.map(x => x.role).sort(), ["editor", "owner"]);
});

test("restore = save an old revision's state as a new revision", async () => {
  const old = (await call(db.router, USERS.josh, "GET", P() + "/revisions/2")).json;
  const cur = (await call(db.router, USERS.josh, "GET", P() + "/layout")).json.rev;
  const r = await call(db.router, USERS.josh, "POST", P() + "/layout", { expectedRev: cur, state: old.state, note: "Restored from rev 2" });
  assert.equal(r.json.rev, cur + 1);
  const h = await call(db.router, USERS.josh, "GET", P() + "/revisions");
  assert.equal(h.json.revisions[0].note, "Restored from rev 2");
});

test("whoami reports what the deployment sees", async () => {
  const r = await call(db.router, USERS.josh, "GET", "whoami");
  assert.equal(r.status, 200);
  assert.equal(r.json.seenUserId, USERS.josh);
  assert.ok(r.json.plans >= 1);
  assert.equal((await call(db.router, null, "GET", "whoami")).status, 401);
});
