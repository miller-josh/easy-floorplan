import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import "./board.css";
import { buildDXF } from "./lib/dxf";
import { fmtFtIn, normalize, sizeOf, worldBox, unite } from "./lib/transform";
import { buildIndex, computeGaps, dname, getItem, itemsAll, movesJSON, setT, tOf, withWorldSize } from "./model";
import { ItemView, StaticLayer } from "./Prims";
import { HistoryPanel, SharePanel } from "./Panels";
import { useBoardSync } from "./useBoardSync";

const fmt = fmtFtIn;
const fmtDate = (iso) => new Date(iso).toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
const download = (name, text, type) => {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([text], { type }));
  a.download = name; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
};

export default function LayoutBoard({ api, planId, onBack }) {
  const [toastMsg, setToastMsg] = useState(null);
  const toastT = useRef();
  const toast = useCallback((m) => { setToastMsg(m); clearTimeout(toastT.current); toastT.current = setTimeout(() => setToastMsg(null), 2800); }, []);
  const sync = useBoardSync(api, planId, toast);
  const { boot } = sync;

  return (
    <div className="lb">
      <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500&family=IBM+Plex+Sans:wght@400;500;600&display=swap" />
      {boot.status === "loading" && <div className="center">Loading layout…</div>}
      {boot.status === "error" && (
        <div className="center">
          <strong>{boot.code === "not_found" ? "You don’t have access to this plan." : boot.code === "not_configured" ? "The Layout Board database isn’t set up yet." : "Couldn’t load the plan."}</strong>
          <div className="note">{boot.code === "not_found" ? "Ask the owner for an invite link." : "Try again in a moment."}</div>
          <button onClick={onBack}>Back</button>
        </div>
      )}
      {boot.status === "ready" && <Editor key={planId} {...{ api, planId, onBack, sync, toast }} />}
      {toastMsg && <div className="toast" role="status">{toastMsg}</div>}
    </div>
  );
}

function Editor({ api, planId, onBack, sync, toast }) {
  const { plan, shared, state, role, conflict, saving, dirty, readOnly } = sync;
  const index = useMemo(() => buildIndex(plan.base), [plan]);

  const [preview, setPreview] = useState(null);       // {rev,state,by,at}
  const [panel, setPanel] = useState(null);           // 'history' | 'share'
  const [selected, setSelected] = useState(() => new Set());
  const [snap, setSnap] = useState(1);
  const [show, setShow] = useState({ zones: true, tags: true, dims: true });
  const [view, setView] = useState({ x: 0, y: 0, w: 100, h: 100 });
  const [size, setSize] = useState({ w: 1, h: 1 });
  const [dragId, setDragId] = useState(null);
  const [filter, setFilter] = useState("");
  const [confirmReset, setConfirmReset] = useState(false);
  const svgRef = useRef(), rootRef = useRef(), fileRef = useRef();
  const userZoomed = useRef(false);
  const g = useRef({}); // gesture state: pointers, drag, pan, pinch, rsz

  const cur = preview ? preview.state : state;
  const locked = !!preview;
  const items = useMemo(() => itemsAll(index, cur), [index, cur.dups]);
  const L = useRef({}); L.current = { cur, selected, snap, view, locked, index, sync };

  /* ----- view ----- */
  const fit = useCallback(() => {
    const r = svgRef.current.getBoundingClientRect(); const m = 18; const B = index.allB;
    const bw = B[2] - B[0] + 2 * m, bh = B[3] - B[1] + 2 * m; const ar = r.width / Math.max(r.height, 1);
    let w = bw, h = bh; if (w / h < ar) w = h * ar; else h = w / ar;
    setView({ x: (B[0] + B[2]) / 2 - w / 2, y: -(B[1] + B[3]) / 2 - h / 2, w, h });
  }, [index]);
  const zoomAt = useCallback((f, cx, cy) => {
    userZoomed.current = true;
    const r = svgRef.current.getBoundingClientRect(); const px = (cx - r.left) / r.width, py = (cy - r.top) / r.height;
    setView((v) => { const nw = Math.min(Math.max(v.w * f, 40), 3000), nh = nw * v.h / v.w; return { x: v.x + (v.w - nw) * px, y: v.y + (v.h - nh) * py, w: nw, h: nh }; });
  }, []);
  useEffect(() => {
    const el = svgRef.current;
    const ro = new ResizeObserver(() => {
      const r = el.getBoundingClientRect(); if (!r.width || !r.height) return;
      setSize({ w: r.width, h: r.height });
      if (!userZoomed.current) fit(); else setView((v) => ({ ...v, h: v.w / (r.width / r.height) }));
    });
    ro.observe(el);
    const wheel = (e) => { e.preventDefault(); zoomAt(Math.exp(e.deltaY * 0.0015), e.clientX, e.clientY); };
    el.addEventListener("wheel", wheel, { passive: false });
    return () => { ro.disconnect(); el.removeEventListener("wheel", wheel); };
  }, [fit, zoomAt]);
  const zoomBtn = (f) => { const r = svgRef.current.getBoundingClientRect(); zoomAt(f, r.left + r.width / 2, r.top + r.height / 2); };

  const toModel = (e) => {
    const svg = svgRef.current; const pt = svg.createSVGPoint(); pt.x = e.clientX; pt.y = e.clientY;
    const q = pt.matrixTransform(rootRef.current.getScreenCTM().inverse()); return [q.x, q.y];
  };

  /* ----- selection helpers ----- */
  const selIds = useMemo(() => [...selected].filter((id) => getItem(index, cur, id)), [selected, index, cur]);
  const canResize = (id) => { const t = tOf(cur, id); return selIds.length === 1 && !t.hidden && (((t.rot % 90) + 90) % 90) === 0; };

  /* ----- pointer gestures (port of the reference) ----- */
  const startPinch = () => {
    const p = [...g.current.pointers.values()]; if (p.length < 2) return;
    g.current.pan = null; g.current.drag = null;
    g.current.pinch = { d: Math.hypot(p[0].x - p[1].x, p[0].y - p[1].y), w: L.current.view.w };
  };
  g.current.pointers ||= new Map();
  const onItemDown = useCallback((e) => {
    const { locked, selected, cur, sync } = L.current;
    if (e.button > 0) return;
    if (locked) return;
    const id = e.currentTarget.dataset.id;
    e.stopPropagation();
    g.current.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (g.current.pointers.size > 1) { startPinch(); return; }
    let next = new Set(selected);
    if (e.shiftKey || e.metaKey || e.ctrlKey) { next.has(id) ? next.delete(id) : next.add(id); }
    else if (!next.has(id)) next = new Set([id]);
    setSelected(next);
    g.current.drag = { start: toModel(e), orig: [...next].map((i) => ({ id: i, dx: tOf(cur, i).dx, dy: tOf(cur, i).dy })), moved: false, before: sync.gestureStart() };
    svgRef.current.setPointerCapture(e.pointerId);
    setDragId(id);
  }, []);
  const onSvgDown = (e) => {
    if (e.button > 0) return;
    g.current.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (g.current.pointers.size > 1) { g.current.drag = null; startPinch(); return; }
    g.current.pan = { x: e.clientX, y: e.clientY, vx: view.x, vy: view.y, moved: false };
    svgRef.current.setPointerCapture(e.pointerId);
  };
  const onHandleDown = (e) => {
    if (e.button > 0 || locked) return; e.stopPropagation();
    const { id, h } = e.currentTarget.dataset;
    g.current.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    g.current.rsz = { id, k: h, start: toModel(e), b0: worldBox(getItem(index, cur, id), tOf(cur, id)), before: sync.gestureStart(), moved: false };
    svgRef.current.setPointerCapture(e.pointerId);
  };
  const onMove = (e) => {
    const G = g.current;
    if (G.pointers.has(e.pointerId)) G.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (G.pinch && G.pointers.size >= 2) {
      const p = [...G.pointers.values()]; const d = Math.hypot(p[0].x - p[1].x, p[0].y - p[1].y);
      zoomAt((G.pinch.d / d) * G.pinch.w / view.w, (p[0].x + p[1].x) / 2, (p[0].y + p[1].y) / 2); return;
    }
    if (G.rsz) {
      const r = G.rsz; const m = toModel(e); let ddx = m[0] - r.start[0], ddy = m[1] - r.start[1];
      if (snap) { ddx = Math.round(ddx / snap) * snap; ddy = Math.round(ddy / snap) * snap; }
      const b = r.b0; let x0 = b[0], x1 = b[2], y0 = b[1], y1 = b[3];
      if (r.k.includes("e")) x1 = Math.max(b[2] + ddx, x0 + 2);
      if (r.k.includes("w")) x0 = Math.min(b[0] + ddx, x1 - 2);
      if (r.k.includes("n")) y1 = Math.max(b[3] + ddy, y0 + 2);
      if (r.k.includes("s")) y0 = Math.min(b[1] + ddy, y1 - 2);
      if (ddx || ddy) r.moved = true;
      sync.live((s) => withWorldSize(index, s, r.id, x1 - x0, y1 - y0, (x0 + x1) / 2, (y0 + y1) / 2));
      return;
    }
    if (G.drag) {
      const d = G.drag; const m = toModel(e); let dx = m[0] - d.start[0], dy = m[1] - d.start[1];
      if (snap) { dx = Math.round(dx / snap) * snap; dy = Math.round(dy / snap) * snap; }
      if (dx || dy) d.moved = true;
      sync.live((s) => { let n = s; for (const o of d.orig) n = setT(n, o.id, { dx: o.dx + dx, dy: o.dy + dy }); return n; });
    } else if (G.pan) {
      const r = svgRef.current.getBoundingClientRect(); const s = view.w / r.width; const p = G.pan;
      const dx = (e.clientX - p.x) * s, dy = (e.clientY - p.y) * s;
      if (Math.abs(dx) + Math.abs(dy) > 0.5) { p.moved = true; userZoomed.current = true; }
      setView((v) => ({ ...v, x: p.vx - dx, y: p.vy - dy }));
    }
  };
  const onUp = (e) => {
    const G = g.current; G.pointers.delete(e.pointerId);
    if (G.pinch && G.pointers.size < 2) G.pinch = null;
    if (G.rsz) { if (G.rsz.moved) sync.gestureEnd(G.rsz.before); G.rsz = null; return; }
    if (G.drag) { if (G.drag.moved) sync.gestureEnd(G.drag.before); G.drag = null; setDragId(null); }
    else if (G.pan) { if (!G.pan.moved) setSelected(new Set()); G.pan = null; }
  };

  /* ----- actions ----- */
  const edit = (fn) => { if (!locked && selIds.length) sync.edit(fn); };
  const rotateSel = (deg) => edit((s) => {
    if (selIds.length === 1) return setT(s, selIds[0], { rot: (tOf(s, selIds[0]).rot + deg + 360) % 360 });
    const u = unite(selIds.map((id) => worldBox(getItem(index, s, id), tOf(s, id)))); const gx = (u[0] + u[2]) / 2, gy = (u[1] + u[3]) / 2;
    const a = deg * Math.PI / 180, c = Math.cos(a), sn = Math.sin(a); let n = s;
    for (const id of selIds) {
      const it = getItem(index, s, id), t = tOf(s, id); const ux = it.cx + t.dx - gx, uy = it.cy + t.dy - gy;
      n = setT(n, id, { dx: gx + ux * c - uy * sn - it.cx, dy: gy + ux * sn + uy * c - it.cy, rot: (t.rot + deg + 360) % 360 });
    }
    return n;
  });
  const nudge = (dx, dy) => edit((s) => selIds.reduce((n, id) => setT(n, id, { dx: tOf(s, id).dx + dx, dy: tOf(s, id).dy + dy }), s));
  const dupSel = () => {
    if (locked || !selIds.length) return;
    const fresh = []; 
    sync.edit((s) => {
      let n = { ...s, dups: [...s.dups], t: { ...s.t } };
      for (const id of selIds) {
        const it = getItem(index, s, id); const nid = "d" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
        const t0 = tOf(s, id);
        n.dups.push({ id: nid, src: Number(it.dupOf ?? it.id) });
        n.t[nid] = { dx: t0.dx + 12, dy: t0.dy - 12, rot: t0.rot, hidden: false, sx: t0.sx, sy: t0.sy };
        fresh.push(nid);
      }
      return n;
    });
    setSelected(new Set(fresh)); toast("Copy placed 1′ down and right");
  };
  const resetSel = () => edit((s) => selIds.reduce((n, id) => setT(n, id, { dx: 0, dy: 0, rot: 0, sx: 1, sy: 1 }), s));
  const removeSel = () => { if (!locked && selIds.length) { edit((s) => selIds.reduce((n, id) => setT(n, id, { hidden: true }), s)); setSelected(new Set()); toast("Removed. Undo or “Bring back” in the list restores it."); } };
  const setSize1 = (id, key, v) => edit((s) => {
    const it = getItem(index, s, id), t = tOf(s, id); const cur = sizeOf(it, t), wb = worldBox(it, t);
    return withWorldSize(index, s, id, key === "w" ? v : cur[0], key === "d" ? v : cur[1], (wb[0] + wb[2]) / 2, (wb[1] + wb[3]) / 2);
  });
  const originalSize = (id) => edit((s) => {
    const it = getItem(index, s, id), wb = worldBox(it, tOf(s, id));
    return setT(s, id, { sx: 1, sy: 1, dx: (wb[0] + wb[2]) / 2 - it.cx, dy: (wb[1] + wb[3]) / 2 - it.cy });
  });

  useEffect(() => {
    const onKey = (e) => {
      if (e.target.matches("input,select,textarea") || locked || panel) return;
      const k = e.key; const big = e.shiftKey ? 12 : 1;
      if ((e.ctrlKey || e.metaKey) && k.toLowerCase() === "z") { e.preventDefault(); e.shiftKey ? sync.redo() : sync.undo(); return; }
      if ((e.ctrlKey || e.metaKey) && k.toLowerCase() === "d") { e.preventDefault(); dupSel(); return; }
      if (!selIds.length) return;
      if (k === "ArrowLeft") { e.preventDefault(); nudge(-big, 0); } else if (k === "ArrowRight") { e.preventDefault(); nudge(big, 0); }
      else if (k === "ArrowUp") { e.preventDefault(); nudge(0, big); } else if (k === "ArrowDown") { e.preventDefault(); nudge(0, -big); }
      else if (k === "r" || k === "R") { e.preventDefault(); rotateSel(e.shiftKey ? -90 : 90); }
      else if (k === "Delete" || k === "Backspace") { e.preventDefault(); removeSel(); }
      else if (k === "Escape") setSelected(new Set());
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  });

  /* ----- derived views ----- */
  const pxIn = view.w / Math.max(size.w, 1);
  const gaps = useMemo(() => (show.dims && selIds.length === 1 ? computeGaps(index, cur, selIds[0]) : []), [show.dims, selIds, index, cur]);
  const groups = useMemo(() => {
    const zones = [], walls = [], mid = [], over = [];
    for (const it of items) (it.kind === "zone" ? zones : it.kind === "wall" ? walls : it.overhead ? over : mid).push(it);
    return { zones, walls, mid, over };
  }, [items]);
  const renderItems = (arr) => arr.map((it) => <ItemView key={it.id} it={it} t={tOf(cur, it.id)} showTags={show.tags} dragging={dragId === it.id} onDown={onItemDown} />);

  const removed = items.filter((i) => tOf(cur, i.id).hidden);
  const listItems = useMemo(() => {
    const q = filter.trim().toLowerCase(); const rank = (i) => (i.tag ? 0 : i.kind === "wall" ? 2 : 1);
    return items.filter((i) => !tOf(cur, i.id).hidden)
      .sort((a, b) => (rank(a) - rank(b)) || (a.tag || "").localeCompare(b.tag || "") || a.name.localeCompare(b.name))
      .filter((i) => !q || dname(i, tOf(cur, i.id)).toLowerCase().includes(q) || (i.tag || "").toLowerCase() === q);
  }, [items, cur, filter]);

  /* ----- save state text ----- */
  let stateText, stateCls = "";
  if (readOnly) stateText = "View only · you can try ideas, but only editors can save for everyone";
  else if (saving) stateText = "Saving…";
  else if (conflict) stateText = "A newer layout was saved · choose below";
  else if (dirty) { stateText = "Unsaved · only you see these changes"; stateCls = "dirty"; }
  else { stateText = shared.updated_at ? `Saved for everyone, ${fmtDate(shared.updated_at)}${shared.updated_by_name ? " by " + shared.updated_by_name : ""}` : "Everyone sees this layout"; stateCls = "ok"; }

  /* ----- output ----- */
  const exportDxf = () => { try { download((plan.name.replace(/[^\w]+/g, "_") || "floor_plan") + "_layout.dxf", buildDXF(plan.base, normalize(cur)), "application/dxf"); toast("Saved. Open the .dxf in QCAD."); } catch { toast("Couldn’t export the file."); } };
  const copyMoves = async () => {
    const txt = "Layout Board moves:\n" + JSON.stringify(movesJSON(index, cur, plan.name), null, 1);
    try { await navigator.clipboard.writeText(txt); toast("Copied. Paste it into the chat with Claude."); }
    catch { const ta = document.createElement("textarea"); ta.value = txt; ta.style.cssText = "position:fixed;opacity:0"; document.body.appendChild(ta); ta.select(); try { document.execCommand("copy"); toast("Copied. Paste it into the chat with Claude."); } catch { toast("Copy is blocked here."); } ta.remove(); }
  };
  const openFile = async (e) => {
    const f = e.target.files[0]; if (!f) return;
    try { const o = JSON.parse(await f.text()); if (!o || !o.t || !Array.isArray(o.dups)) throw 0; sync.replace(o); setSelected(new Set()); toast("Layout opened."); } catch { toast("That file isn’t a Layout Board file."); }
    e.target.value = "";
  };
  const restore = async () => {
    const p = preview; setPreview(null);
    sync.replace(p.state);
    await sync.save(p.state, `Restored from rev ${p.rev}`);
  };

  const single = selIds.length === 1 ? getItem(index, cur, selIds[0]) : null;
  const st1 = single ? tOf(cur, single.id) : null;

  return (
    <div className="app">
      <header>
        <a className="back" href="#" onClick={(e) => { e.preventDefault(); onBack(); }}>← Floor plans</a>
        <h1>{plan.name} <small>inches</small> <span className="role">{role}</span></h1>
        <div className="tools">
          <button onClick={sync.undo} disabled={!sync.canUndo || locked} title="Undo (Ctrl+Z)">Undo</button>
          <button onClick={sync.redo} disabled={!sync.canRedo || locked} title="Redo (Ctrl+Shift+Z)">Redo</button>
          <span className="seg" role="group" aria-label="Snap">
            {[[0, "Free"], [1, "1″"], [6, "6″"], [12, "1′"]].map(([v, l]) => <button key={v} aria-pressed={snap === v} onClick={() => setSnap(v)}>{l}</button>)}
          </span>
          {[["zones", "Zones"], ["tags", "Tags"], ["dims", "Gaps"]].map(([k, l]) => (
            <label key={k} className="chk"><input type="checkbox" checked={show[k]} onChange={(e) => setShow({ ...show, [k]: e.target.checked })} /> {l}</label>
          ))}
          <span className={"savestate " + stateCls} aria-live="polite">{stateText}</span>
          <button className="primary" disabled={readOnly || saving || !dirty || !!conflict || locked} onClick={() => sync.save()}>{readOnly ? "View only" : "Save for everyone"}</button>
          <button onClick={() => setPanel("history")}>History</button>
          {role === "owner" && <button onClick={() => setPanel("share")}>Share</button>}
          <button onClick={exportDxf}>Export DXF</button>
          <button onClick={copyMoves} title="Copies a short list of your moves to paste into chat">Copy moves for Claude</button>
        </div>
      </header>

      {conflict ? (
        <div className="notice" role="alert">
          <span>{conflict.late ? "Someone saved a new layout after your last changes. You’re seeing theirs now." : `${conflict.theirs.updated_by_name || "Someone"} saved a new layout.`}</span>
          <button onClick={sync.keepMine}>Keep mine</button><button onClick={sync.useTheirs}>Use theirs</button>
        </div>
      ) : preview ? (
        <div className="notice preview">
          <span>Previewing rev {preview.rev}{preview.by ? ` by ${preview.by}` : ""}, {fmtDate(preview.at)}. Nothing is changed until you restore.</span>
          {!readOnly && <button className="primary" onClick={restore}>Restore</button>}
          <button onClick={() => setPreview(null)}>Close preview</button>
        </div>
      ) : <div className="notice" hidden />}

      <div className="main">
        <div className="sheet">
          <svg id="plan" ref={svgRef} aria-label="Floor plan, drag items to move them" viewBox={`${view.x} ${view.y} ${view.w} ${view.h}`}
            onPointerDown={onSvgDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp}>
            <defs><pattern id="grid12" width="12" height="12" patternUnits="userSpaceOnUse"><path d="M12 0H0V12" fill="none" stroke="#e3e6eb" strokeWidth="0.35" /></pattern></defs>
            <g ref={rootRef} transform="scale(1,-1)">
              <rect x={index.allB[0] - 600} y={index.allB[1] - 600} width={index.allB[2] - index.allB[0] + 1200} height={index.allB[3] - index.allB[1] + 1200} fill="url(#grid12)" />
              <g data-layer="zones" style={show.zones ? undefined : { display: "none" }}>{renderItems(groups.zones)}</g>
              <g data-layer="walls">{renderItems(groups.walls)}</g>
              <StaticLayer prims={plan.base.static} />
              <g data-layer="items">{renderItems(groups.mid)}</g>
              <g data-layer="overhead">{renderItems(groups.over)}</g>
              <g data-layer="selection">
                {selIds.map((id) => {
                  const it = getItem(index, cur, id); const t = tOf(cur, id); if (!it || t.hidden) return null;
                  const b = worldBox(it, t); const hs = Math.max(9, 14 * (matchMedia("(pointer:coarse)").matches ? 1.6 : 1)) * pxIn;
                  const mx = (b[0] + b[2]) / 2, my = (b[1] + b[3]) / 2;
                  const H = { w: [b[0], my], e: [b[2], my], s: [mx, b[1]], n: [mx, b[3]], sw: [b[0], b[1]], se: [b[2], b[1]], nw: [b[0], b[3]], ne: [b[2], b[3]] };
                  return (
                    <g key={id}>
                      <rect className="selbox" x={b[0] - 1.5} y={b[1] - 1.5} width={b[2] - b[0] + 3} height={b[3] - b[1] + 3} />
                      {canResize(id) && !locked && Object.entries(H).map(([k, [x, y]]) => (
                        <rect key={k} className={"handle h-" + k} data-h={k} data-id={id} x={x - hs / 2} y={y - hs / 2} width={hs} height={hs} onPointerDown={onHandleDown} />
                      ))}
                    </g>
                  );
                })}
              </g>
              <g className="dim">
                {gaps.map((q) => {
                  const horiz = q.dir === "L" || q.dir === "R"; const cap = 3 * pxIn;
                  return (
                    <g key={q.dir}>
                      <line x1={q.x} y1={q.y} x2={q.x2} y2={q.y2} />
                      {horiz ? <line className="cap" x1={q.x2} y1={q.y - cap} x2={q.x2} y2={q.y + cap} /> : <line className="cap" x1={q.x - cap} y1={q.y2} x2={q.x + cap} y2={q.y2} />}
                      <g transform={`translate(${(q.x + q.x2) / 2} ${(q.y + q.y2) / 2}) scale(${pxIn} ${-pxIn})`}>
                        <text x={horiz ? 0 : 6} y={horiz ? -6 : 4} textAnchor={horiz ? "middle" : "start"}>{fmt(q.d)}</text>
                      </g>
                    </g>
                  );
                })}
              </g>
            </g>
          </svg>
          <div className="zoomctl">
            <button aria-label="Zoom in" onClick={() => zoomBtn(0.75)}>+</button>
            <button aria-label="Zoom out" onClick={() => zoomBtn(1.33)}>−</button>
            <button aria-label="Fit to sheet" onClick={() => { fit(); userZoomed.current = false; }}>⤢</button>
          </div>
          <div className="hint">Drag to move · drag a corner or edge square to resize · R rotate · arrows nudge 1″ · drag empty space to pan</div>
        </div>

        <aside>
          <div className="insp" aria-label="Inspector">
            {!selIds.length && (
              <div className="empty"><strong>Nothing selected.</strong><br />Click or tap an item on the plan, or pick one from the list. Shift-click adds more items so they move together. Interior walls and doors move too; the outside walls stay put. Drag the small squares on a selected item to resize it. The pink lines show the open space from the selected item to the nearest wall or item.</div>
            )}
            {selIds.length > 0 && (<>
              <h2>
                {single?.tag && <span className="badge">{single.tag}</span>}
                {single ? dname(single, st1) + (single.dupOf ? " (copy)" : "") : `${selIds.length} items selected`}
              </h2>
              {single && (() => {
                const [w, d] = sizeOf(single, st1); const mv = [];
                if (Math.abs(st1.dx) >= 0.25) mv.push(`${fmt(Math.abs(st1.dx))} ${st1.dx > 0 ? "right" : "left"}`);
                if (Math.abs(st1.dy) >= 0.25) mv.push(`${fmt(Math.abs(st1.dy))} ${st1.dy > 0 ? "up" : "down"}`);
                const field = (lab, val, key) => (
                  <label className="szf"><span>{lab}</span>
                    <input key={key + val.toFixed(1)} type="number" min="1" step="0.5" inputMode="decimal" aria-label={lab} defaultValue={+val.toFixed(1)} disabled={locked}
                      onBlur={(e) => { const v = parseFloat(e.target.value); if (v > 0 && Math.abs(v - val) > 0.04) setSize1(single.id, key, v); }}
                      onKeyDown={(e) => { if (e.key === "Enter") e.currentTarget.blur(); }} /><em>in</em></label>);
                return (<>
                  <dl className="kv"><dt>Size</dt><dd>{fmt(w)} × {fmt(d)}</dd><dt>Moved</dt><dd>{mv.length ? mv.join(", ") : "Not moved"}</dd><dt>Rotation</dt><dd>{((st1.rot % 360) + 360) % 360}°</dd></dl>
                  <div className="sizer">{field("Width", w, "w")}{field("Depth", d, "d")}
                    {(Math.abs(st1.sx - 1) > 1e-6 || Math.abs(st1.sy - 1) > 1e-6) && <button onClick={() => originalSize(single.id)} disabled={locked}>Original size</button>}</div>
                  {!canResize(single.id) && <div className="empty">Resize handles show when the item is turned to a multiple of 90°. You can still type a size above.</div>}
                </>);
              })()}
              <div className="row">
                <button disabled={locked} onClick={() => rotateSel(90)} title="Rotate counterclockwise (R)">⟲ 90°</button>
                <button disabled={locked} onClick={() => rotateSel(-90)} title="Rotate clockwise (Shift+R)">⟳ 90°</button>
                <button disabled={locked} onClick={() => rotateSel(15)}>⟲ 15°</button>
                <button disabled={locked} onClick={() => rotateSel(-15)}>⟳ 15°</button>
              </div>
              <div className="row">
                <button disabled={locked} onClick={dupSel} title="Ctrl+D">Duplicate</button>
                <button disabled={locked} onClick={resetSel} title="Return to its original spot">Put back</button>
                <button disabled={locked} onClick={removeSel} title="Delete key">Remove</button>
              </div>
            </>)}
          </div>
          <div className="list">
            <input type="search" placeholder="Find an item…" aria-label="Find an item" value={filter} onChange={(e) => setFilter(e.target.value)} />
            <ul>
              {listItems.map((it) => {
                const t = tOf(cur, it.id); const moved = t.dx || t.dy || t.rot || t.sx !== 1 || t.sy !== 1 || it.dupOf;
                return (
                  <li key={it.id}><button aria-current={selected.has(it.id) ? "true" : "false"} onClick={(e) => setSelected(e.shiftKey ? (() => { const n = new Set(selected); n.has(it.id) ? n.delete(it.id) : n.add(it.id); return n; })() : new Set([it.id]))}>
                    <span className="t">{it.tag || "·"}</span><span>{dname(it, t) + (it.dupOf ? " (copy)" : "")}</span>
                    {moved && <span className="moved">{it.dupOf ? "added" : "moved"}</span>}
                  </button></li>
                );
              })}
              {removed.length > 0 && !locked && <li><button onClick={() => sync.edit((s) => removed.reduce((n, i) => setT(n, i.id, { hidden: false }), s))}>Bring back {removed.length} removed item{removed.length > 1 ? "s" : ""}</button></li>}
            </ul>
          </div>
          <div className="foot">
            <div className="row">
              <button onClick={() => download("layout.json", JSON.stringify(cur), "application/json")}>Save layout file</button>
              <button onClick={() => fileRef.current.click()} disabled={locked}>Open layout file</button>
              <input ref={fileRef} type="file" accept=".json,application/json" hidden onChange={openFile} />
            </div>
            <div className="row">
              {confirmReset ? (
                <span className="confirm">Drop your unsaved changes?
                  <button onClick={() => { sync.replace(shared.state); setSelected(new Set()); setConfirmReset(false); toast("Back to the layout saved for everyone. Undo brings your changes back."); }}>Yes, reset</button>
                  <button onClick={() => setConfirmReset(false)}>Cancel</button></span>
              ) : <button onClick={() => setConfirmReset(true)} disabled={!dirty || locked}>Discard my changes</button>}
            </div>
            <div>Your changes are kept in this browser as you work. “Save for everyone” makes them the layout everyone with access sees.</div>
          </div>
        </aside>
      </div>

      {panel === "history" && <HistoryPanel api={api} planId={planId} canRestore={!readOnly} currentRev={shared.rev}
        onPreview={(p) => { setPreview(p); setSelected(new Set()); setPanel(null); }} onClose={() => setPanel(null)} />}
      {panel === "share" && <SharePanel api={api} planId={planId} onClose={() => setPanel(null)} />}
    </div>
  );
}
