// Hash routes for the Layout Board: #board, #board/<planId>, #invite/<token>
import React, { useEffect, useMemo, useState } from "react";
import LayoutBoard from "./LayoutBoard";
import { makeApi } from "./api";
import "./board.css";

const PENDING = "lb-pending-invite";
export const parseBoardHash = (hash) => {
  const m = /^#board(?:\/([0-9a-f-]{36}))?$/i.exec(hash || ""); if (m) return { kind: "board", planId: m[1] || null };
  const i = /^#invite\/([0-9a-f]{20,64})$/i.exec(hash || ""); if (i) return { kind: "invite", token: i[1] };
  return null;
};
// Remember an invite link across the sign-in screen, which may drop the hash.
export const rememberInvite = (hash) => {
  const r = parseBoardHash(hash);
  if (r?.kind === "invite") { try { localStorage.setItem(PENDING, r.token); } catch { /* ignore */ } }
};
export const pendingInvite = () => { try { return localStorage.getItem(PENDING); } catch { return null; } };
const go = (hash) => { window.location.hash = hash; };

function Message({ children }) {
  return <div className="lb"><div className="center">{children}</div></div>;
}

export default function BoardRoutes({ route, getToken, offlineMode }) {
  const api = useMemo(() => makeApi(getToken), [getToken]);
  if (offlineMode) return <Message><strong>Sign in to use the Layout Board.</strong><button onClick={() => go("")}>Back</button></Message>;
  if (route.kind === "invite") return <Invite api={api} token={route.token} />;
  if (route.planId) return <LayoutBoard api={api} planId={route.planId} onBack={() => go("")} />;
  return <BoardHome api={api} />;
}

function BoardHome({ api }) {
  const [state, setState] = useState({ status: "loading" });
  useEffect(() => {
    api.listPlans().then((r) => {
      if (r.plans.length === 1) window.location.replace("#board/" + r.plans[0].id);
      else setState({ status: "ready", plans: r.plans });
    }).catch((e) => setState({ status: "error", code: e.body?.error }));
  }, [api]);
  if (state.status === "loading") return <Message>Loading…</Message>;
  if (state.status === "error") return <Message><strong>{state.code === "not_configured" ? "The Layout Board database isn’t set up yet." : "Couldn’t load your plans."}</strong><button onClick={() => go("")}>Back</button></Message>;
  return (
    <Message>
      {state.plans.length ? <><strong>Your plans</strong>{state.plans.map((p) => <button key={p.id} onClick={() => go("board/" + p.id)}>{p.name} ({p.role})</button>)}</>
        : <><strong>No plans yet.</strong><span className="note">Ask the owner for an invite link.</span></>}
      <button onClick={() => go("")}>Back to the floor plan tool</button>
    </Message>
  );
}

function Invite({ api, token }) {
  const [state, setState] = useState("working");
  useEffect(() => {
    api.acceptInvite(token).then((r) => { try { localStorage.removeItem(PENDING); } catch { /* ignore */ } window.location.replace("#board/" + r.planId); })
      .catch(() => setState("bad"));
  }, [api, token]);
  if (state === "working") return <Message>Joining…</Message>;
  return <Message><strong>This invite link isn’t valid.</strong><span className="note">It may have been used or expired. Ask the owner for a new one.</span><button onClick={() => go("")}>Back</button></Message>;
}
