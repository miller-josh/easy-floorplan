import React, { useEffect, useState } from "react";

const fmtDate = (iso) => new Date(iso).toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });

export function HistoryPanel({ api, planId, canRestore, currentRev, onPreview, onClose }) {
  const [rows, setRows] = useState(null);
  const [err, setErr] = useState(null);
  useEffect(() => { api.listRevisions(planId).then((r) => setRows(r.revisions)).catch(() => setErr("Couldn’t load history.")); }, [api, planId]);
  const open = async (rev) => {
    try { const r = await api.getRevision(planId, rev.rev); onPreview({ ...r, rev: rev.rev, by: rev.saved_by_name, at: rev.saved_at }); }
    catch { setErr("Couldn’t load that revision."); }
  };
  return (
    <div className="modal-bg" onClick={onClose}>
      <div className="modal" role="dialog" aria-label="History" onClick={(e) => e.stopPropagation()}>
        <h2>History <button onClick={onClose}>Close</button></h2>
        {err && <div className="empty">{err}</div>}
        {!rows && !err && <div className="empty">Loading…</div>}
        <ul className="hist">
          {rows?.map((r) => (
            <li key={r.rev}>
              <div className="meta">
                <strong>Rev {r.rev}{r.rev === currentRev ? " (current)" : ""}</strong> · {r.saved_by_name || "Someone"}
                <small>{fmtDate(r.saved_at)}{r.note ? " · " + r.note : ""}</small>
              </div>
              <button onClick={() => open(r)}>Preview</button>
            </li>
          ))}
        </ul>
        {!canRestore && <div className="note">Only editors can restore a revision.</div>}
      </div>
    </div>
  );
}

export function SharePanel({ api, planId, onClose }) {
  const [data, setData] = useState(null);
  const [role, setRole] = useState("editor");
  const [link, setLink] = useState(null);
  const [msg, setMsg] = useState(null);
  const load = () => api.listMembers(planId).then(setData).catch(() => setMsg("Couldn’t load members."));
  useEffect(() => { load(); }, [planId]);
  const url = (t) => `${location.origin}/#invite/${t}`;
  const make = async () => { try { const r = await api.createInvite(planId, role); setLink(url(r.token)); load(); } catch { setMsg("Couldn’t create the invite."); } };
  const copy = async (text) => { try { await navigator.clipboard.writeText(text); setMsg("Link copied."); } catch { setMsg("Copy is blocked. Select the link and copy it."); } };
  const act = async (fn) => { try { await fn(); load(); } catch { setMsg("That didn’t work. Try again."); } };
  return (
    <div className="modal-bg" onClick={onClose}>
      <div className="modal" role="dialog" aria-label="Share" onClick={(e) => e.stopPropagation()}>
        <h2>Share this plan <button onClick={onClose}>Close</button></h2>
        <div className="row" style={{ alignItems: "center" }}>
          <select aria-label="Invite role" value={role} onChange={(e) => setRole(e.target.value)}>
            <option value="editor">Can edit and save</option>
            <option value="viewer">Can view only</option>
          </select>
          <button className="primary" onClick={make}>Create invite link</button>
        </div>
        {link && <div><div className="linkbox" data-testid="invite-link">{link}</div><div className="row" style={{ marginTop: 6 }}><button onClick={() => copy(link)}>Copy link</button></div></div>}
        <div className="note">Each link works once and expires in 14 days. The person signs in, opens the link, and is added with this access.</div>
        {msg && <div className="note" role="status">{msg}</div>}
        {data && (
          <table className="tbl">
            <thead><tr><th>Person</th><th>Access</th><th /></tr></thead>
            <tbody>
              {data.members.map((m) => (
                <tr key={m.user_id}>
                  <td>{m.display_name || m.user_id}</td>
                  <td>{m.role === "owner" ? "Owner" : (
                    <select aria-label={`Access for ${m.display_name || m.user_id}`} value={m.role} onChange={(e) => act(() => api.setRole(planId, m.user_id, e.target.value))}>
                      <option value="editor">Editor</option><option value="viewer">Viewer</option>
                    </select>)}</td>
                  <td>{m.role !== "owner" && <button onClick={() => act(() => api.removeMember(planId, m.user_id))}>Remove</button>}</td>
                </tr>
              ))}
              {data.invites.map((i) => (
                <tr key={i.token}>
                  <td colSpan={2}>Pending invite · {i.role} · expires {fmtDate(i.expires_at)}</td>
                  <td><button onClick={() => copy(url(i.token))}>Copy</button> <button onClick={() => act(() => api.deleteInvite(planId, i.token))}>Revoke</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
