// SVG drawing of plan geometry. Mirrors drawPrim/setTextXf/applyItem from the reference editor.
import React, { memo } from "react";
import { zoneLabel } from "./lib/transform";

const pathD = (pts, close) => {
  let d = "M" + pts[0] + " " + pts[1];
  for (let i = 2; i < pts.length; i += 2) d += "L" + pts[i] + " " + pts[i + 1];
  return close ? d + "Z" : d;
};
const ANCHOR = { l: "start", c: "middle", r: "end" };
const BASELINE = { t: "hanging", m: "central", b: "alphabetic" };

export function TextPrim({ p, it, t, inTag }) {
  let x = p.x, y = p.y;
  if (it && t && !inTag) { x = it.cx + (x - it.cx) * t.sx; y = it.cy + (y - it.cy) * t.sy; }
  const rotItem = it && t ? t.rot : 0;
  const fs = p.h / 0.72;
  const s = it && t && /sq ft/.test(p.s) && !p.s.includes("\n") ? zoneLabel(p.s, t) : p.s;
  const lines = s.split("\n");
  const shift = p.a[1] === "b" ? -(lines.length - 1) * fs * 1.15 : p.a[1] === "m" ? -(lines.length - 1) * fs * 0.575 : 0;
  return (
    <g transform={`translate(${x} ${y}) scale(1 -1) rotate(${-p.r + (p.up ? rotItem : 0)})`}>
      <text x={0} y={0} textAnchor={ANCHOR[p.a[0]]} dominantBaseline={BASELINE[p.a[1]]} fontSize={fs.toFixed(2)} fill={p.col}
        fontFamily="IBM Plex Sans, system-ui, sans-serif">
        {lines.length === 1 ? s : lines.map((ln, i) => <tspan key={i} x={0} dy={i === 0 ? shift : fs * 1.15}>{ln}</tspan>)}
      </text>
    </g>
  );
}

export function GeoPrim({ p, tag }) {
  if (p.t === "h") return null;
  if (p.t === "f") return <path d={pathD(p.pts, true)} fill={tag ? "#ffffff" : p.f} fillOpacity={tag ? undefined : p.o} stroke="none" />;
  if (p.t === "p") return <path d={pathD(p.pts, p.c)} fill="none" stroke={p.s} strokeWidth={1} vectorEffect="non-scaling-stroke" strokeLinejoin="round" />;
  if (p.t === "c") return <circle cx={p.x} cy={p.y} r={p.r} fill="none" stroke={p.s} strokeWidth={1} vectorEffect="non-scaling-stroke" />;
  return null;
}

export const StaticLayer = memo(function StaticLayer({ prims }) {
  return <g>{prims.map((p, i) => p.t === "x" ? <TextPrim key={i} p={p} /> : <GeoPrim key={i} p={p} />)}</g>;
});

export const ItemView = memo(function ItemView({ it, t, showTags, dragging, onDown }) {
  const b = it.box;
  const tagOff = it.tagC ? [(it.tagC[0] - it.cx) * (t.sx - 1), (it.tagC[1] - it.cy) * (t.sy - 1)] : [0, 0];
  return (
    <g className={"it" + (it.overhead ? " overhead" : "") + (dragging ? " dragging" : "")} data-id={it.id} onPointerDown={onDown}
      transform={`translate(${t.dx} ${t.dy}) rotate(${t.rot} ${it.cx} ${it.cy})`} style={t.hidden ? { display: "none" } : undefined}>
      <g className="geo" transform={`translate(${it.cx} ${it.cy}) scale(${t.sx} ${t.sy}) translate(${-it.cx} ${-it.cy})`}>
        <rect className="hit" x={b[0] - 1} y={b[1] - 1} width={b[2] - b[0] + 2} height={b[3] - b[1] + 2} />
        {it.prims.map((p, i) => p.L !== "TAGS" && p.t !== "x" ? <GeoPrim key={i} p={p} /> : null)}
      </g>
      {it.prims.map((p, i) => p.L !== "TAGS" && p.t === "x" ? <TextPrim key={i} p={p} it={it} t={t} /> : null)}
      <g className="tagg" transform={`translate(${tagOff[0]} ${tagOff[1]})`} style={showTags ? undefined : { display: "none" }}>
        {it.prims.map((p, i) => p.L === "TAGS" ? (p.t === "x" ? <TextPrim key={i} p={p} it={it} t={t} inTag /> : <GeoPrim key={i} p={p} tag />) : null)}
      </g>
    </g>
  );
}, (a, b) => a.it === b.it && a.t === b.t && a.showTags === b.showTags && a.dragging === b.dragging);
