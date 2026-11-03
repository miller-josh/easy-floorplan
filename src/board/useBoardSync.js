// Shared-layout state for one plan: load, local draft, undo/redo, Save for everyone,
// conflict handling, and live updates.
//
// Live updates: Neon has no Realtime channel, so open boards poll a tiny endpoint
// (GET /layout?since=rev answers {unchanged:true} when nothing moved) every few seconds
// and again whenever the tab becomes visible.
import { useCallback, useEffect, useRef, useState } from "react";
import { normalize } from "./lib/transform";
import { EMPTY_STATE } from "./model";
import { mergeStates } from "./merge";

const POLL_MS = 4000;
const same = (a, b) => JSON.stringify(normalize(a)) === JSON.stringify(normalize(b));
const draftKey = (planId) => `lb-draft:${planId}`;
const readDraft = (planId) => { try { const o = JSON.parse(localStorage.getItem(draftKey(planId))); return o && o.state && o.state.t ? o : null; } catch { return null; } };
const writeDraft = (planId, rev, state) => { try { localStorage.setItem(draftKey(planId), JSON.stringify({ rev, state })); } catch { /* storage blocked */ } };

export function useBoardSync(api, planId, toast) {
  const [boot, setBoot] = useState({ status: "loading" });
  const [shared, setSharedS] = useState(null);     // {rev,state,updated_by_name,updated_at}
  const [state, setStateS] = useState(EMPTY_STATE);
  const [role, setRole] = useState("viewer");
  const [conflict, setConflict] = useState(null);  // {theirs, mine, late?}
  const [saving, setSaving] = useState(false);
  const [, bump] = useState(0);
  const sharedRef = useRef(null), stateRef = useRef(EMPTY_STATE), conflictRef = useRef(null), savingRef = useRef(false);
  const undoRef = useRef([]), redoRef = useRef([]), userRef = useRef(null);

  const setShared = (v) => { sharedRef.current = v; setSharedS(v); };
  const setState = (v) => { stateRef.current = v; setStateS(v); };
  const setConf = (v) => { conflictRef.current = v; setConflict(v); };

  /* ----- load ----- */
  useEffect(() => {
    let dead = false;
    setBoot({ status: "loading" });
    api.getPlan(planId).then((r) => {
      if (dead) return;
      const layout = r.layout, draft = readDraft(planId);
      userRef.current = r.userId;
      setShared(layout); setRole(r.role);
      undoRef.current = []; redoRef.current = [];
      if (draft && draft.rev === layout.rev) { setState(draft.state); setConf(null); }
      else {
        setState(layout.state);
        const hasDraft = draft && !same(draft.state, layout.state) && !same(draft.state, EMPTY_STATE);
        setConf(hasDraft ? { theirs: layout, mine: draft.state, late: true } : null);
      }
      setBoot({ status: "ready", plan: r.plan });
    }).catch((e) => !dead && setBoot({ status: "error", code: e.status === 404 ? "not_found" : e.status === 401 ? "unauthorized" : e.body?.error || "error" }));
    return () => { dead = true; };
  }, [api, planId]);

  /* ----- draft persistence ----- */
  useEffect(() => { if (shared) writeDraft(planId, shared.rev, state); }, [state, shared, planId]);

  /* ----- live updates ----- */
  const poll = useCallback(async () => {
    const cur = sharedRef.current;
    if (!cur || savingRef.current) return;
    try {
      const l = await api.getLayout(planId, cur.rev);
      if (savingRef.current) return;
      if (l.role) setRole(l.role);
      if (l.unchanged) return;
      const base = sharedRef.current;
      if (conflictRef.current) { if (l.rev > conflictRef.current.theirs.rev) setConf({ ...conflictRef.current, theirs: l }); return; }
      if (l.rev <= base.rev) return;
      if (same(stateRef.current, base.state)) {
        setShared(l); setState(l.state); undoRef.current = []; redoRef.current = []; bump((n) => n + 1);
        toast?.(`${l.updated_by_name || "Someone"} saved a new layout`);
      } else setConf({ theirs: l, mine: stateRef.current, base: base.state });
    } catch { /* offline or sleeping DB: try again next tick */ }
  }, [api, planId, toast]);

  useEffect(() => {
    if (boot.status !== "ready") return;
    const id = setInterval(poll, POLL_MS);
    const vis = () => { if (document.visibilityState === "visible") poll(); };
    document.addEventListener("visibilitychange", vis);
    return () => { clearInterval(id); document.removeEventListener("visibilitychange", vis); };
  }, [boot.status, poll]);

  /* ----- editing with undo ----- */
  const pushUndo = (snap) => { undoRef.current.push(snap); if (undoRef.current.length > 200) undoRef.current.shift(); redoRef.current = []; bump((n) => n + 1); };
  const edit = useCallback((fn) => { const cur = stateRef.current; const next = fn(cur); if (next === cur) return; pushUndo(cur); setState(next); }, []);
  const live = useCallback((fn) => setState(fn(stateRef.current)), []);
  const gestureStart = useCallback(() => stateRef.current, []);
  const gestureEnd = useCallback((before) => { if (before !== stateRef.current) pushUndo(before); }, []);
  const undo = useCallback(() => { const p = undoRef.current.pop(); if (!p) return; redoRef.current.push(stateRef.current); setState(p); bump((n) => n + 1); }, []);
  const redo = useCallback(() => { const p = redoRef.current.pop(); if (!p) return; undoRef.current.push(stateRef.current); setState(p); bump((n) => n + 1); }, []);
  const replace = useCallback((next) => { pushUndo(stateRef.current); setState(next); }, []);

  /* ----- saving ----- */
  const save = useCallback(async (stateToSave, note) => {
    if (savingRef.current || conflictRef.current || role === "viewer") return false;
    const body = normalize(stateToSave || stateRef.current);
    savingRef.current = true; setSaving(true);
    try {
      const r = await api.saveLayout(planId, sharedRef.current.rev, body, note);
      setShared({ rev: r.rev, state: body, updated_by_name: r.updated_by_name, updated_at: new Date().toISOString() });
      toast?.("Saved. Everyone with access now sees this layout.");
      return true;
    } catch (e) {
      if (e.status === 409 && e.body.layout) setConf({ theirs: e.body.layout, mine: stateToSave || stateRef.current, base: sharedRef.current.state });
      else if (e.status === 403) { setRole("viewer"); toast?.("You no longer have edit access. Your changes stay on this device."); }
      else toast?.("Couldn’t save for everyone. Your changes are still here; try again.");
      return false;
    } finally { savingRef.current = false; setSaving(false); }
  }, [api, planId, role, toast]);

  const keepMine = useCallback(() => {
    const c = conflictRef.current; if (!c) return;
    // Put my changes on top of theirs when I know what I started from; otherwise keep my draft as is.
    const next = c.base ? mergeStates(c.base, c.mine, c.theirs.state) : c.mine;
    setShared(c.theirs); setConf(null);
    pushUndo(stateRef.current);
    setState(next);
    toast?.(c.base ? "Your changes are on top of their layout. Save for everyone to publish." : "Your version is back. Save for everyone to replace the shared one.");
  }, [toast]);
  const useTheirs = useCallback(() => {
    const c = conflictRef.current; if (!c) return;
    pushUndo(stateRef.current); setShared(c.theirs); setConf(null); setState(c.theirs.state);
  }, []);

  const dirty = !!shared && !same(state, shared.state);
  return { boot, plan: boot.plan, shared, state, role, userId: userRef.current, conflict, saving, dirty,
    readOnly: role === "viewer", canUndo: undoRef.current.length > 0, canRedo: redoRef.current.length > 0,
    edit, live, gestureStart, gestureEnd, undo, redo, replace, save, keepMine, useTheirs };
}

export { same };
