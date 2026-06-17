import { useState, useRef, useCallback, useEffect } from "react";
// Supabase client is passed in as a prop (bound to the Clerk session). See supabaseClient.js / main.jsx.

const PALETTE = [
  "#3B82F6","#EF4444","#22C55E","#F59E0B","#A855F7",
  "#14B8A6","#F97316","#EC4899","#06B6D4","#6366F1",
  "#84CC16","#78716C",
];

const INCH = 1 / 12;
// Snap increments offered in the UI (stored as decimal feet)
const SNAP_OPTIONS = [
  { label: '1"', feet: 1 / 12 },
  { label: '3"', feet: 0.25 },
  { label: '6"', feet: 0.5 },
  { label: '12"', feet: 1 },
];
const snapInches = (v) => Math.round(v * 12) / 12; // round to whole inch

// Convert "#RRGGBB" + alpha to an rgba() string for canvas fills
function hexWithAlpha(hex, alpha) {
  const h = (hex || "#000000").replace("#", "");
  const r = parseInt(h.slice(0, 2), 16), g = parseInt(h.slice(2, 4), 16), b = parseInt(h.slice(4, 6), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}

const snapTo = (v, step) => Math.round(v / step) * step;
const clamp = (v, mn, mx) => Math.max(mn, Math.min(mx, v));
const degToRad = (d) => (d * Math.PI) / 180;
const normAngle = (a) => ((a % 360) + 360) % 360;

function getRotatedBounds(w, h, deg) {
  const a = degToRad(deg % 360);
  return { bw: w * Math.abs(Math.cos(a)) + h * Math.abs(Math.sin(a)), bh: w * Math.abs(Math.sin(a)) + h * Math.abs(Math.cos(a)) };
}

// ── localStorage helpers (fallback) ──
const LP = "fp_";
function lsLoadIndex() { try { return JSON.parse(localStorage.getItem(LP + "index")) || []; } catch { return []; } }
function lsSaveIndex(idx) { try { localStorage.setItem(LP + "index", JSON.stringify(idx)); } catch {} }
function lsLoadData(id) { try { return JSON.parse(localStorage.getItem(LP + "data:" + id)); } catch { return null; } }
function lsSaveData(id, d) { try { localStorage.setItem(LP + "data:" + id, JSON.stringify(d)); } catch {} }
function lsDeleteData(id) { try { localStorage.removeItem(LP + "data:" + id); } catch {} }

// ── Supabase helpers ──
async function sbLoadIndex(client, userId) {
  const { data, error } = await client
    .from("designs")
    .select("id, name, grid_w, grid_h, shape_count, created_at, updated_at")
    .eq("user_id", userId)
    .order("updated_at", { ascending: false });
  if (error) { console.error("sbLoadIndex:", error); return []; }
  return data.map(r => ({
    id: r.id, name: r.name, gridW: r.grid_w, gridH: r.grid_h,
    shapeCount: r.shape_count, createdAt: new Date(r.created_at).getTime(),
    updatedAt: new Date(r.updated_at).getTime(),
  }));
}

async function sbLoadData(client, id) {
  const { data, error } = await client
    .from("designs")
    .select("data")
    .eq("id", id)
    .single();
  if (error) { console.error("sbLoadData:", error); return null; }
  return data?.data || null;
}

async function sbSaveNew(client, userId, name, designData, gridW, gridH, shapeCount) {
  const { data, error } = await client
    .from("designs")
    .insert({
      user_id: userId,
      name,
      grid_w: gridW,
      grid_h: gridH,
      shape_count: shapeCount,
      data: designData,
    })
    .select("id")
    .single();
  if (error) { console.error("sbSaveNew:", error); return null; }
  return data.id;
}

async function sbUpdate(client, id, name, designData, gridW, gridH, shapeCount) {
  const { error } = await client
    .from("designs")
    .update({
      name,
      grid_w: gridW,
      grid_h: gridH,
      shape_count: shapeCount,
      data: designData,
      updated_at: new Date().toISOString(),
    })
    .eq("id", id);
  if (error) { console.error("sbUpdate:", error); return false; }
  return true;
}

async function sbDelete(client, id) {
  const { error } = await client.from("designs").delete().eq("id", id);
  if (error) { console.error("sbDelete:", error); return false; }
  return true;
}

async function sbRename(client, id, name) {
  const { error } = await client
    .from("designs")
    .update({ name, updated_at: new Date().toISOString() })
    .eq("id", id);
  if (error) { console.error("sbRename:", error); return false; }
  return true;
}

async function sbDuplicate(client, id, userId, newName) {
  const original = await sbLoadData(client, id);
  if (!original) return null;
  return sbSaveNew(client, userId, newName, original, original.gridW, original.gridH, (original.shapes || []).length);
}

// ── File export helpers ──
const FILE_VERSION = 2;
function buildExportData(designName, gridW, gridH, shapes, idCounter, precision) {
  return { _format: "easy-floorplan", _version: FILE_VERSION, exportedAt: new Date().toISOString(), designName, gridW, gridH, shapes, idCounter, precision: precision || 0.5 };
}
function downloadJSON(data, filename) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a"); a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
function validateImport(data) {
  if (!data || typeof data !== "object") return "Invalid file format";
  if (data._format !== "easy-floorplan") return "Not a floor plan file";
  if (!data.gridW || !data.gridH) return "Missing grid dimensions";
  if (!Array.isArray(data.shapes)) return "Missing shapes data";
  for (const s of data.shapes) { if (typeof s.x !== "number" || typeof s.y !== "number" || typeof s.w !== "number" || typeof s.h !== "number") return "Corrupted shape data"; }
  return null;
}
function sanitizeFilename(name) { return name.replace(/[^a-zA-Z0-9_\- ]/g, "").replace(/\s+/g, "-").toLowerCase() || "floorplan"; }
function genId() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 6); }

// ── Feet & inches conversion ──
// Storage stays in decimal feet everywhere. These only affect display/input.
function feetToFtIn(v) {
  const totalInches = Math.round((v || 0) * 12);
  let ft = Math.floor(totalInches / 12);
  let inch = totalInches - ft * 12;
  return { ft, inch };
}
function fmtFtIn(v) {
  const { ft, inch } = feetToFtIn(v);
  return inch === 0 ? `${ft}'` : `${ft}'${inch}"`;
}
// Parse flexible input into decimal feet. Accepts: 5'6", 5' 6, 5', 5, 5.5, 6", etc.
// Returns null if it can't be parsed (caller reverts to previous value).
function parseFtIn(str) {
  if (str == null) return null;
  let s = String(str).trim().replace(/[″”]/g, '"').replace(/[′’]/g, "'");
  if (s === "") return null;
  if (s.includes("'")) {
    const idx = s.indexOf("'");
    const ft = parseFloat(s.slice(0, idx));
    const inch = parseFloat(s.slice(idx + 1).replace(/"/g, "").trim());
    return (isNaN(ft) ? 0 : ft) + (isNaN(inch) ? 0 : inch) / 12;
  }
  if (s.includes('"')) {
    const inch = parseFloat(s.replace(/"/g, "").trim());
    return isNaN(inch) ? null : inch / 12;
  }
  const f = parseFloat(s);
  return isNaN(f) ? null : f;
}
function fmtDate(ts) {
  const diff = Date.now() - ts;
  if (diff < 60000) return "just now";
  if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
  if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`;
  return new Date(ts).toLocaleDateString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

export default function FloorPlanTool({ supabase, user, offlineMode, onSignOut }) {
  const useCloud = !!user && !!supabase && !offlineMode;
  const userId = user?.id;
  const userEmail = user?.primaryEmailAddress?.emailAddress || user?.emailAddresses?.[0]?.emailAddress;

  const [gridW, setGridW] = useState(19);
  const [gridH, setGridH] = useState(60);
  const [tempGridW, setTempGridW] = useState("19");
  const [tempGridH, setTempGridH] = useState("60");
  const [cellSize, setCellSize] = useState(32);
  const [precision, setPrecision] = useState(0.5);
  const [sidebarWidth, setSidebarWidth] = useState(() => {
    const saved = parseInt(localStorage.getItem("fp_sidebar_width"), 10);
    return saved >= 240 && saved <= 560 ? saved : 300;
  });
  const [resizingSidebar, setResizingSidebar] = useState(false);
  const [shapes, setShapes] = useState([]);
  const [selectedId, setSelectedId] = useState(null);
  const [idCounter, setIdCounter] = useState(1);

  const [newW, setNewW] = useState("4");
  const [newH, setNewH] = useState("4");
  const [newLabel, setNewLabel] = useState("");
  const [newColor, setNewColor] = useState(PALETTE[0]);

  const [dragState, setDragState] = useState(null);
  const [resizeState, setResizeState] = useState(null);
  const gridRef = useRef(null);
  const fileInputRef = useRef(null);
  const [tab, setTab] = useState("add");

  const [designs, setDesigns] = useState([]);
  const [currentDesignId, setCurrentDesignId] = useState(null);
  const [designName, setDesignName] = useState("Untitled Layout");
  const [showFiles, setShowFiles] = useState(false);
  const [saveAsMode, setSaveAsMode] = useState(false);
  const [saveAsInput, setSaveAsInput] = useState("");
  const [hasUnsaved, setHasUnsaved] = useState(false);
  const [storageReady, setStorageReady] = useState(false);
  const [statusMsg, setStatusMsg] = useState(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState(null);
  const [renameId, setRenameId] = useState(null);
  const [renameInput, setRenameInput] = useState("");
  const [syncing, setSyncing] = useState(false);
  const [exporting, setExporting] = useState(false);
  const statusTimer = useRef(null);

  const selected = shapes.find((s) => s.id === selectedId);

  // Snap to the current floorplan's precision (0.5 ft default, 0.25 ft when enabled)
  const snap = (v) => snapTo(v, precision);

  const flash = (msg) => {
    setStatusMsg(msg);
    if (statusTimer.current) clearTimeout(statusTimer.current);
    statusTimer.current = setTimeout(() => setStatusMsg(null), 2500);
  };

  // Load design index on mount
  useEffect(() => {
    (async () => {
      if (useCloud) {
        setSyncing(true);
        const idx = await sbLoadIndex(supabase, userId);
        setDesigns(idx);
        setSyncing(false);
      } else {
        setDesigns(lsLoadIndex());
      }
      setStorageReady(true);
    })();
  }, [useCloud, userId, supabase]);

  useEffect(() => { if (storageReady) setHasUnsaved(true); }, [shapes, gridW, gridH, precision]);

  const getDesignState = () => ({ gridW, gridH, shapes, idCounter, designName, precision });

  const applyDesign = (data) => {
    setGridW(data.gridW); setGridH(data.gridH);
    setTempGridW(String(data.gridW)); setTempGridH(String(data.gridH));
    setPrecision(data.precision || 0.5);
    setShapes((data.shapes || []).map(s => ({ ...s, rotation: s.rotation || 0 })));
    setIdCounter(data.idCounter || (data.shapes?.length ? Math.max(...data.shapes.map(s => s.id)) + 1 : 1));
    setDesignName(data.designName || "Untitled Layout");
    setSelectedId(null); setHasUnsaved(false);
  };

  const refreshIndex = async () => {
    if (useCloud) {
      const idx = await sbLoadIndex(supabase, userId);
      setDesigns(idx);
    }
  };

  // ── Save ──
  const handleSave = async () => {
    if (!currentDesignId) {
      setSaveAsMode(true); setSaveAsInput(designName); setShowFiles(true); return;
    }
    setSyncing(true);
    const state = getDesignState();
    if (useCloud) {
      const ok = await sbUpdate(supabase, currentDesignId, designName, state, gridW, gridH, shapes.length);
      if (ok) { await refreshIndex(); setHasUnsaved(false); flash("Saved to cloud ✓"); }
      else flash("Save failed");
    } else {
      lsSaveData(currentDesignId, state);
      const idx = designs.map(d => d.id === currentDesignId ? { ...d, name: designName, updatedAt: Date.now(), gridW, gridH, shapeCount: shapes.length } : d);
      lsSaveIndex(idx); setDesigns(idx); setHasUnsaved(false); flash("Saved ✓");
    }
    setSyncing(false);
  };

  // ── Save As ──
  const handleSaveAs = async (name) => {
    const n = name.trim() || "Untitled Layout";
    setDesignName(n);
    setSyncing(true);
    const state = { ...getDesignState(), designName: n };

    if (useCloud) {
      const newId = await sbSaveNew(supabase, userId, n, state, gridW, gridH, shapes.length);
      if (newId) {
        await refreshIndex(); setCurrentDesignId(newId);
        setHasUnsaved(false); flash(`Saved "${n}" to cloud ✓`);
      } else flash("Save failed");
    } else {
      const id = genId();
      lsSaveData(id, state);
      const entry = { id, name: n, createdAt: Date.now(), updatedAt: Date.now(), gridW, gridH, shapeCount: shapes.length };
      const idx = [...designs, entry]; lsSaveIndex(idx); setDesigns(idx);
      setCurrentDesignId(id); setHasUnsaved(false); flash(`Saved as "${n}" ✓`);
    }
    setSaveAsMode(false); setSyncing(false);
  };

  // ── Load ──
  const handleLoad = async (id) => {
    setSyncing(true);
    let data;
    if (useCloud) { data = await sbLoadData(supabase, id); }
    else { data = lsLoadData(id); }
    if (!data) { flash("Failed to load"); setSyncing(false); return; }
    applyDesign(data); setCurrentDesignId(id); setShowFiles(false);
    flash(useCloud ? "Loaded from cloud ✓" : "Loaded ✓");
    setSyncing(false);
  };

  // ── Delete ──
  const handleDelete = async (id) => {
    setSyncing(true);
    if (useCloud) { await sbDelete(supabase, id); await refreshIndex(); }
    else { lsDeleteData(id); const idx = designs.filter(d => d.id !== id); lsSaveIndex(idx); setDesigns(idx); }
    if (currentDesignId === id) { setCurrentDesignId(null); setDesignName("Untitled Layout"); }
    setConfirmDeleteId(null); flash("Deleted"); setSyncing(false);
  };

  // ── Rename ──
  const handleRename = async (id, newName) => {
    const n = newName.trim() || "Untitled Layout";
    setSyncing(true);
    if (useCloud) { await sbRename(supabase, id, n); await refreshIndex(); }
    else {
      const idx = designs.map(d => d.id === id ? { ...d, name: n, updatedAt: Date.now() } : d);
      lsSaveIndex(idx); setDesigns(idx);
      const data = lsLoadData(id); if (data) { data.designName = n; lsSaveData(id, data); }
    }
    if (currentDesignId === id) setDesignName(n);
    setRenameId(null); flash("Renamed ✓"); setSyncing(false);
  };

  const handleNew = () => {
    setShapes([]); setGridW(19); setGridH(60);
    setTempGridW("19"); setTempGridH("60"); setIdCounter(1);
    setPrecision(INCH);
    setDesignName("Untitled Layout"); setCurrentDesignId(null);
    setSelectedId(null); setHasUnsaved(false); setShowFiles(false); flash('New layout · 1" snap');
  };

  const handleDuplicateDesign = async (id) => {
    const src = designs.find(d => d.id === id);
    const newName = (src?.name || "Layout") + " copy";
    setSyncing(true);
    if (useCloud) {
      await sbDuplicate(supabase, id, userId, newName); await refreshIndex();
    } else {
      const data = lsLoadData(id); if (!data) { setSyncing(false); return; }
      const newId = genId(); data.designName = newName; lsSaveData(newId, data);
      const entry = { id: newId, name: newName, createdAt: Date.now(), updatedAt: Date.now(), gridW: data.gridW, gridH: data.gridH, shapeCount: (data.shapes || []).length };
      const idx = [...designs, entry]; lsSaveIndex(idx); setDesigns(idx);
    }
    flash("Duplicated ✓"); setSyncing(false);
  };

  // ── File export/import ──
  const handleExportFile = () => {
    downloadJSON(buildExportData(designName, gridW, gridH, shapes, idCounter, precision), sanitizeFilename(designName) + ".json");
    flash("Exported to file ✓");
  };

  const handleExportDesignFile = async (id) => {
    let data;
    if (useCloud) { data = await sbLoadData(supabase, id); }
    else { data = lsLoadData(id); }
    if (!data) { flash("Export failed"); return; }
    downloadJSON(buildExportData(data.designName, data.gridW, data.gridH, data.shapes, data.idCounter, data.precision), sanitizeFilename(data.designName) + ".json");
    flash("Exported ✓");
  };

  const handleImportFile = (e) => {
    const file = e.target.files?.[0]; if (!file) return;
    const reader = new FileReader();
    reader.onload = (evt) => {
      try {
        const data = JSON.parse(evt.target.result);
        const err = validateImport(data); if (err) { flash("Import failed: " + err); return; }
        applyDesign({ ...data, shapes: data.shapes.map(s => ({ ...s, rotation: s.rotation || 0 })) });
        setCurrentDesignId(null); setHasUnsaved(true); setShowFiles(false);
        flash(`Imported "${data.designName}" ✓`);
      } catch { flash("Import failed: invalid JSON"); }
    };
    reader.readAsText(file); e.target.value = "";
  };

  // ── Image / PDF export ──
  // Render the whole floor plan to an offscreen canvas from the data model (crisp, independent of on-screen zoom).
  const renderToCanvas = (dpi = 2) => {
    const CELL = 26;            // px per foot in the export
    const MARGIN = 24;
    const RULER_PX = 30;
    const TITLE_H = 64;
    const plotW = gridW * CELL, plotH = gridH * CELL;
    const W = MARGIN + RULER_PX + plotW + MARGIN;
    const H = MARGIN + TITLE_H + RULER_PX + plotH + MARGIN;
    const ox = MARGIN + RULER_PX;          // grid origin x
    const oy = MARGIN + TITLE_H + RULER_PX; // grid origin y

    const canvas = document.createElement("canvas");
    canvas.width = Math.round(W * dpi);
    canvas.height = Math.round(H * dpi);
    const ctx = canvas.getContext("2d");
    ctx.scale(dpi, dpi);
    ctx.textBaseline = "alphabetic";

    // Background
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, W, H);

    // Title block
    ctx.fillStyle = "#0f172a";
    ctx.font = "700 20px 'DM Sans', Arial, sans-serif";
    ctx.fillText(designName || "Floor Plan", MARGIN, MARGIN + 22);
    ctx.fillStyle = "#64748b";
    ctx.font = "400 12px 'DM Sans', Arial, sans-serif";
    const snapLabel = (SNAP_OPTIONS.find(o => Math.abs(o.feet - precision) < 1e-6) || {}).label || `${precision}'`;
    ctx.fillText(`${gridW}' × ${gridH}'  ·  ${gridW * gridH} sq ft  ·  snap ${snapLabel}  ·  ${new Date().toLocaleDateString()}`, MARGIN, MARGIN + 42);

    // Plot white area + border
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(ox, oy, plotW, plotH);

    // Grid lines (minor 1 ft, major 5 ft)
    ctx.lineWidth = 1;
    for (let i = 0; i <= gridW; i++) {
      const x = Math.round(ox + i * CELL) + 0.5;
      ctx.strokeStyle = i % 5 === 0 ? "#dcdcdc" : "#f0f0f0";
      ctx.beginPath(); ctx.moveTo(x, oy); ctx.lineTo(x, oy + plotH); ctx.stroke();
    }
    for (let i = 0; i <= gridH; i++) {
      const y = Math.round(oy + i * CELL) + 0.5;
      ctx.strokeStyle = i % 5 === 0 ? "#dcdcdc" : "#f0f0f0";
      ctx.beginPath(); ctx.moveTo(ox, y); ctx.lineTo(ox + plotW, y); ctx.stroke();
    }
    // Plot outer border
    ctx.strokeStyle = "#aaaaaa";
    ctx.strokeRect(ox + 0.5, oy + 0.5, plotW, plotH);

    // Rulers (foot numbers every 5 ft)
    ctx.fillStyle = "#64748b";
    ctx.font = "400 11px monospace";
    ctx.textAlign = "center";
    for (let i = 0; i <= gridW; i += 5) ctx.fillText(`${i}'`, ox + i * CELL, oy - 8);
    if (gridW % 5 !== 0) ctx.fillText(`${gridW}'`, ox + gridW * CELL, oy - 8);
    ctx.textAlign = "right";
    for (let i = 0; i <= gridH; i += 5) ctx.fillText(`${i}'`, ox - 8, oy + i * CELL + 4);
    if (gridH % 5 !== 0) ctx.fillText(`${gridH}'`, ox - 8, oy + gridH * CELL + 4);
    ctx.textAlign = "left";

    // Shapes
    for (const s of shapes) {
      const { bw, bh } = getRotatedBounds(s.w, s.h, s.rotation);
      const cx = ox + (s.x + bw / 2) * CELL;
      const cy = oy + (s.y + bh / 2) * CELL;
      const w = s.w * CELL, h = s.h * CELL;
      ctx.save();
      ctx.translate(cx, cy);
      ctx.rotate((s.rotation || 0) * Math.PI / 180);
      // fill (light tint) + border
      ctx.fillStyle = hexWithAlpha(s.color, 0.19);
      ctx.fillRect(-w / 2, -h / 2, w, h);
      ctx.strokeStyle = s.color;
      ctx.lineWidth = 2;
      ctx.strokeRect(-w / 2, -h / 2, w, h);
      // label + dimensions, clipped to the shape
      ctx.beginPath(); ctx.rect(-w / 2, -h / 2, w, h); ctx.clip();
      ctx.fillStyle = s.color;
      ctx.textAlign = "center";
      const fs = Math.max(8, Math.min(14, w / ((s.label || "").length * 0.6 + 1), h * 0.32));
      ctx.font = `600 ${fs}px 'DM Sans', Arial, sans-serif`;
      const showDim = h > 34;
      ctx.fillText(s.label || "", 0, showDim ? -1 : fs / 3);
      if (showDim) {
        ctx.font = `400 ${Math.max(7, fs - 3)}px monospace`;
        ctx.globalAlpha = 0.75;
        ctx.fillText(`${fmtFtIn(s.w)}×${fmtFtIn(s.h)}`, 0, fs + 1);
        ctx.globalAlpha = 1;
      }
      ctx.restore();
    }
    return { canvas, W, H };
  };

  const exportPNG = async () => {
    setExporting(true);
    try {
      const { canvas } = renderToCanvas(2);
      await new Promise((res) => canvas.toBlob((blob) => {
        if (blob) {
          const url = URL.createObjectURL(blob);
          const a = document.createElement("a");
          a.href = url; a.download = sanitizeFilename(designName) + ".png";
          document.body.appendChild(a); a.click(); document.body.removeChild(a);
          URL.revokeObjectURL(url);
        }
        res();
      }, "image/png"));
      flash("PNG downloaded ✓");
    } catch (e) { console.error(e); flash("PNG export failed"); }
    setExporting(false);
  };

  const exportPDF = async () => {
    setExporting(true);
    try {
      const { canvas, W, H } = renderToCanvas(2);
      const imgData = canvas.toDataURL("image/png");
      const { jsPDF } = await import("jspdf");
      const orientation = W >= H ? "landscape" : "portrait";
      const pdf = new jsPDF({ orientation, unit: "pt", format: [W, H] });
      pdf.addImage(imgData, "PNG", 0, 0, W, H);
      pdf.save(sanitizeFilename(designName) + ".pdf");
      flash("PDF downloaded ✓");
    } catch (e) { console.error(e); flash("PDF export failed"); }
    setExporting(false);
  };

  // ── Shape operations ──
  const applyGridSize = () => { const w = parseFloat(tempGridW), h = parseFloat(tempGridH); if (w > 0 && h > 0) { setGridW(w); setGridH(h); } };
  const addShape = () => {
    const w = Math.max(precision, parseFloat(newW) || 2), h = Math.max(precision, parseFloat(newH) || 2);
    setShapes(prev => [...prev, { id: idCounter, x: 0.5, y: 0.5, w, h, label: newLabel || `Item ${idCounter}`, color: newColor, rotation: 0 }]);
    setSelectedId(idCounter); setIdCounter(c => c + 1); setNewLabel(""); setTab("edit");
  };
  const updateShape = (id, u) => setShapes(prev => prev.map(s => s.id === id ? { ...s, ...u } : s));
  const deleteShape = (id) => { setShapes(prev => prev.filter(s => s.id !== id)); if (selectedId === id) setSelectedId(null); };
  const duplicateShape = (id) => {
    const src = shapes.find(s => s.id === id); if (!src) return;
    const { bw, bh } = getRotatedBounds(src.w, src.h, src.rotation);
    setShapes(prev => [...prev, { ...src, id: idCounter, x: snap(clamp(src.x + 1, 0, gridW - bw)), y: snap(clamp(src.y + 1, 0, gridH - bh)), label: src.label + " copy" }]);
    setSelectedId(idCounter); setIdCounter(c => c + 1);
  };
  const rotateShape = (id, delta) => {
    const s = shapes.find(x => x.id === id); if (!s) return;
    const na = normAngle(s.rotation + delta), ob = getRotatedBounds(s.w, s.h, s.rotation), nb = getRotatedBounds(s.w, s.h, na);
    const cx = s.x + ob.bw / 2, cy = s.y + ob.bh / 2;
    updateShape(id, { rotation: na, x: clamp(snap(cx - nb.bw / 2), 0, Math.max(0, gridW - nb.bw)), y: clamp(snap(cy - nb.bh / 2), 0, Math.max(0, gridH - nb.bh)) });
  };
  const setShapeAngle = (id, angle) => {
    const s = shapes.find(x => x.id === id); if (!s) return;
    const na = normAngle(angle), ob = getRotatedBounds(s.w, s.h, s.rotation), nb = getRotatedBounds(s.w, s.h, na);
    const cx = s.x + ob.bw / 2, cy = s.y + ob.bh / 2;
    updateShape(id, { rotation: na, x: clamp(snap(cx - nb.bw / 2), 0, Math.max(0, gridW - nb.bw)), y: clamp(snap(cy - nb.bh / 2), 0, Math.max(0, gridH - nb.bh)) });
  };
  const bringToFront = (id) => setShapes(prev => { const s = prev.find(x => x.id === id); return [...prev.filter(x => x.id !== id), s]; });
  const sendToBack = (id) => setShapes(prev => { const s = prev.find(x => x.id === id); return [s, ...prev.filter(x => x.id !== id)]; });

  // ── Mouse handlers ──
  const getGridPos = useCallback((e) => {
    if (!gridRef.current) return { x: 0, y: 0 };
    const r = gridRef.current.getBoundingClientRect();
    return { x: (e.clientX - r.left + gridRef.current.scrollLeft) / cellSize, y: (e.clientY - r.top + gridRef.current.scrollTop) / cellSize };
  }, [cellSize]);

  const handleShapeMouseDown = (e, shape) => { e.stopPropagation(); e.preventDefault(); setSelectedId(shape.id); setTab("edit"); const p = getGridPos(e); setDragState({ id: shape.id, startX: p.x, startY: p.y, origX: shape.x, origY: shape.y }); };
  const handleResizeMouseDown = (e, shape, handle) => { e.stopPropagation(); e.preventDefault(); const p = getGridPos(e); setResizeState({ id: shape.id, handle, startX: p.x, startY: p.y, origX: shape.x, origY: shape.y, origW: shape.w, origH: shape.h, rotation: shape.rotation }); };

  useEffect(() => {
    const onMove = (e) => {
      if (dragState) {
        const p = getGridPos(e), s = shapes.find(x => x.id === dragState.id); if (!s) return;
        const { bw, bh } = getRotatedBounds(s.w, s.h, s.rotation);
        updateShape(dragState.id, { x: snap(clamp(dragState.origX + p.x - dragState.startX, 0, gridW - bw)), y: snap(clamp(dragState.origY + p.y - dragState.startY, 0, gridH - bh)) });
      }
      if (resizeState) {
        const p = getGridPos(e), dx = p.x - resizeState.startX, dy = p.y - resizeState.startY;
        const rot = resizeState.rotation; if (normAngle(rot) % 90 !== 0) return;
        const h = resizeState.handle; let { origX, origY, origW, origH } = resizeState;
        let ldx, ldy; const nr = normAngle(rot);
        if (nr === 0) { ldx = dx; ldy = dy; } else if (nr === 90) { ldx = dy; ldy = -dx; } else if (nr === 180) { ldx = -dx; ldy = -dy; } else { ldx = -dy; ldy = dx; }
        let nw = origW, nh = origH;
        if (h.includes("e")) nw = snap(Math.max(precision, origW + ldx));
        if (h.includes("s")) nh = snap(Math.max(precision, origH + ldy));
        if (h.includes("w")) nw = snap(Math.max(precision, origW - Math.max(-origW + precision, Math.min(snap(ldx), origW - precision))));
        if (h.includes("n")) nh = snap(Math.max(precision, origH - Math.max(-origH + precision, Math.min(snap(ldy), origH - precision))));
        nw = snap(Math.max(precision, nw)); nh = snap(Math.max(precision, nh));
        const ob = getRotatedBounds(origW, origH, rot), nb = getRotatedBounds(nw, nh, rot);
        let fx = origX, fy = origY;
        if (h === "n") fy = origY + (ob.bh - nb.bh);
        if (h === "w") fx = origX + (ob.bw - nb.bw);
        if (h === "nw") { fx = origX + (ob.bw - nb.bw); fy = origY + (ob.bh - nb.bh); }
        if (h === "ne") fy = origY + (ob.bh - nb.bh);
        if (h === "sw") fx = origX + (ob.bw - nb.bw);
        updateShape(resizeState.id, { w: nw, h: nh, x: clamp(fx, 0, gridW - nb.bw), y: clamp(fy, 0, gridH - nb.bh) });
      }
    };
    const onUp = () => { setDragState(null); setResizeState(null); };
    if (dragState || resizeState) {
      window.addEventListener("mousemove", onMove); window.addEventListener("mouseup", onUp);
      return () => { window.removeEventListener("mousemove", onMove); window.removeEventListener("mouseup", onUp); };
    }
  }, [dragState, resizeState, shapes, gridW, gridH, cellSize, getGridPos, precision]);

  // Sidebar resize drag
  useEffect(() => {
    if (!resizingSidebar) return;
    const onMove = (e) => {
      const w = Math.max(240, Math.min(560, e.clientX));
      setSidebarWidth(w);
    };
    const onUp = () => {
      setResizingSidebar(false);
      setSidebarWidth((w) => { localStorage.setItem("fp_sidebar_width", String(w)); return w; });
    };
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
  }, [resizingSidebar]);

  // Arrow-key nudge: move selected shape by one snap step (Shift = 1 ft)
  useEffect(() => {
    const onKey = (e) => {
      if (!selectedId) return;
      const tag = (e.target.tagName || "").toLowerCase();
      if (tag === "input" || tag === "textarea" || e.target.isContentEditable) return;
      const dirs = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
      const d = dirs[e.key];
      if (!d) return;
      e.preventDefault();
      const step = e.shiftKey ? 1 : precision;
      const s = shapes.find(x => x.id === selectedId);
      if (!s) return;
      const { bw, bh } = getRotatedBounds(s.w, s.h, s.rotation);
      const nx = clamp(snapInches(s.x + d[0] * step), 0, gridW - bw);
      const ny = clamp(snapInches(s.y + d[1] * step), 0, gridH - bh);
      updateShape(selectedId, { x: nx, y: ny });
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selectedId, shapes, precision, gridW, gridH]);

  const handleGridClick = (e) => { if (e.target === e.currentTarget || e.target.dataset.grid) setSelectedId(null); };
  const zoomIn = () => setCellSize(s => Math.min(80, s + 4));
  const zoomOut = () => setCellSize(s => Math.max(12, s - 4));

  const RULER = 24, cW = gridW * cellSize, cH = gridH * cellSize;
  const hTicks = [], vTicks = [];
  for (let i = 0; i <= gridW; i++) if (i % 5 === 0 || i === Math.floor(gridW)) hTicks.push(<text key={i} x={i * cellSize + RULER} y={16} fontSize={10} fill="#64748b" textAnchor="middle" fontFamily="monospace">{i}′</text>);
  for (let i = 0; i <= gridH; i++) if (i % 5 === 0 || i === Math.floor(gridH)) vTicks.push(<text key={i} x={12} y={i * cellSize + RULER + 4} fontSize={10} fill="#64748b" textAnchor="middle" fontFamily="monospace">{i}′</text>);
  const isCardinal = (r) => normAngle(r) % 90 === 0;

  const resizeHandles = (shape) => {
    if (shape.id !== selectedId || !isCardinal(shape.rotation)) return null;
    const sz = 8, { bw, bh } = getRotatedBounds(shape.w, shape.h, shape.rotation), pw = bw * cellSize, ph = bh * cellSize;
    return [
      { h: "nw", s: { left: -sz/2, top: -sz/2, cursor: "nw-resize" } }, { h: "ne", s: { left: pw-sz/2, top: -sz/2, cursor: "ne-resize" } },
      { h: "sw", s: { left: -sz/2, top: ph-sz/2, cursor: "sw-resize" } }, { h: "se", s: { left: pw-sz/2, top: ph-sz/2, cursor: "se-resize" } },
      { h: "n", s: { left: pw/2-sz/2, top: -sz/2, cursor: "n-resize" } }, { h: "s", s: { left: pw/2-sz/2, top: ph-sz/2, cursor: "s-resize" } },
      { h: "w", s: { left: -sz/2, top: ph/2-sz/2, cursor: "w-resize" } }, { h: "e", s: { left: pw-sz/2, top: ph/2-sz/2, cursor: "e-resize" } },
    ].map(({ h: handle, s: style }) => (
      <div key={handle} onMouseDown={(e) => handleResizeMouseDown(e, shape, handle)} style={{ position: "absolute", width: sz, height: sz, background: "#fff", border: "2px solid #3B82F6", borderRadius: 2, zIndex: 10, ...style }} />
    ));
  };

  const DimInput = ({ value, onChange, label, min = 0.5, step = "0.5" }) => (
    <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
      <span style={{ fontSize: 11, color: "#64748b", fontFamily: "inherit" }}>{label}</span>
      <input type="number" step={step} min={min} value={value} onChange={(e) => onChange(e.target.value)}
        style={{ width: "100%", padding: "6px 8px", border: "1px solid #d1d5db", borderRadius: 6, fontSize: 13, fontFamily: "monospace", background: "#f8fafc", outline: "none" }}
        onFocus={(e) => e.target.style.borderColor = "#3B82F6"} onBlur={(e) => e.target.style.borderColor = "#d1d5db"} />
    </div>
  );

  // ── Files panel ──
  const FilesPanel = () => (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.4)", zIndex: 9999, display: "flex", alignItems: "center", justifyContent: "center" }}
      onClick={() => { setShowFiles(false); setSaveAsMode(false); setConfirmDeleteId(null); setRenameId(null); }}>
      <div onClick={e => e.stopPropagation()} style={{ background: "#fff", borderRadius: 16, width: 520, maxHeight: "80vh", display: "flex", flexDirection: "column", boxShadow: "0 25px 50px rgba(0,0,0,0.25)", overflow: "hidden" }}>
        <div style={{ padding: "20px 24px 16px", borderBottom: "1px solid #e2e8f0", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div>
            <div style={{ fontSize: 16, fontWeight: 700, color: "#0f172a" }}>{saveAsMode ? "Save As New Design" : "Saved Designs"}</div>
            <div style={{ fontSize: 12, color: "#94a3b8", marginTop: 2 }}>
              {designs.length} design{designs.length !== 1 ? "s" : ""} · {useCloud ? "☁️ cloud sync" : "💾 local storage"}
            </div>
          </div>
          <button onClick={() => { setShowFiles(false); setSaveAsMode(false); }} style={{ background: "none", border: "none", fontSize: 20, color: "#94a3b8", cursor: "pointer", padding: "4px 8px" }}>×</button>
        </div>

        {saveAsMode && (
          <div style={{ padding: "16px 24px", borderBottom: "1px solid #e2e8f0", display: "flex", gap: 8 }}>
            <input type="text" value={saveAsInput} onChange={e => setSaveAsInput(e.target.value)} placeholder="Design name..." autoFocus
              onKeyDown={e => e.key === "Enter" && handleSaveAs(saveAsInput)}
              style={{ flex: 1, padding: "8px 12px", border: "1px solid #d1d5db", borderRadius: 8, fontSize: 14, outline: "none", fontFamily: "inherit" }} />
            <button onClick={() => handleSaveAs(saveAsInput)} style={{ padding: "8px 20px", background: "#3B82F6", color: "#fff", border: "none", borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: "pointer", fontFamily: "inherit" }}>Save</button>
          </div>
        )}

        <div style={{ flex: 1, overflow: "auto", padding: "8px 12px" }}>
          {designs.length === 0 && !saveAsMode && (
            <div style={{ textAlign: "center", padding: "40px 20px", color: "#94a3b8" }}>
              <div style={{ fontSize: 32, marginBottom: 8 }}>📂</div>
              <div style={{ fontSize: 14 }}>No saved designs yet</div>
              <div style={{ fontSize: 12, marginTop: 4 }}>Save your current layout, or import a .json file</div>
            </div>
          )}
          {[...designs].sort((a, b) => b.updatedAt - a.updatedAt).map(d => (
            <div key={d.id} style={{ padding: "12px 14px", borderRadius: 10, marginBottom: 4, cursor: "pointer", background: currentDesignId === d.id ? "#EFF6FF" : "transparent", border: currentDesignId === d.id ? "1px solid #BFDBFE" : "1px solid transparent", transition: "background 0.1s" }}
              onMouseEnter={e => { if (currentDesignId !== d.id) e.currentTarget.style.background = "#f8fafc"; }}
              onMouseLeave={e => { if (currentDesignId !== d.id) e.currentTarget.style.background = "transparent"; }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  {renameId === d.id ? (
                    <div style={{ display: "flex", gap: 6 }}>
                      <input type="text" value={renameInput} onChange={e => setRenameInput(e.target.value)}
                        onKeyDown={e => { if (e.key === "Enter") handleRename(d.id, renameInput); if (e.key === "Escape") setRenameId(null); }} autoFocus
                        style={{ flex: 1, padding: "4px 8px", border: "1px solid #3B82F6", borderRadius: 4, fontSize: 13, outline: "none", fontFamily: "inherit" }} />
                      <button onClick={() => handleRename(d.id, renameInput)} style={{ padding: "4px 10px", background: "#3B82F6", color: "#fff", border: "none", borderRadius: 4, fontSize: 11, cursor: "pointer", fontFamily: "inherit" }}>OK</button>
                    </div>
                  ) : (
                    <>
                      <div style={{ fontSize: 14, fontWeight: 600, color: "#0f172a", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {d.name} {currentDesignId === d.id && <span style={{ fontSize: 10, color: "#3B82F6", marginLeft: 6, fontWeight: 500 }}>● CURRENT</span>}
                      </div>
                      <div style={{ fontSize: 11, color: "#94a3b8", marginTop: 2, fontFamily: "monospace" }}>
                        {d.gridW}×{d.gridH} ft · {d.shapeCount || 0} shapes · {fmtDate(d.updatedAt)}
                      </div>
                    </>
                  )}
                </div>
                {confirmDeleteId === d.id ? (
                  <div style={{ display: "flex", gap: 4, alignItems: "center", flexShrink: 0 }}>
                    <span style={{ fontSize: 11, color: "#EF4444" }}>Delete?</span>
                    <button onClick={() => handleDelete(d.id)} style={{ padding: "3px 10px", background: "#EF4444", color: "#fff", border: "none", borderRadius: 4, fontSize: 11, cursor: "pointer", fontFamily: "inherit" }}>Yes</button>
                    <button onClick={() => setConfirmDeleteId(null)} style={{ padding: "3px 10px", background: "#f1f5f9", color: "#64748b", border: "1px solid #e2e8f0", borderRadius: 4, fontSize: 11, cursor: "pointer", fontFamily: "inherit" }}>No</button>
                  </div>
                ) : (
                  <div style={{ display: "flex", gap: 2, flexShrink: 0 }}>
                    <MiniBtn onClick={() => handleLoad(d.id)} tip="Load">📂</MiniBtn>
                    <MiniBtn onClick={() => handleExportDesignFile(d.id)} tip="Export to file">⬇️</MiniBtn>
                    <MiniBtn onClick={() => handleDuplicateDesign(d.id)} tip="Duplicate">📋</MiniBtn>
                    <MiniBtn onClick={() => { setRenameId(d.id); setRenameInput(d.name); }} tip="Rename">✏️</MiniBtn>
                    <MiniBtn onClick={() => setConfirmDeleteId(d.id)} tip="Delete">🗑️</MiniBtn>
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>

        <div style={{ padding: "12px 24px", borderTop: "1px solid #e2e8f0" }}>
          <div style={{ display: "flex", gap: 8, marginBottom: saveAsMode ? 0 : 10, padding: "10px 12px", background: "#f8fafc", borderRadius: 8, border: "1px solid #e2e8f0" }}>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 11, fontWeight: 600, color: "#475569", marginBottom: 4 }}>FILE IMPORT / EXPORT</div>
              <div style={{ fontSize: 10, color: "#94a3b8" }}>Save to disk or load a .json floor plan file</div>
            </div>
            <button onClick={handleExportFile} style={{ ...fileBtnStyle, background: "#0f172a", color: "#fff", border: "none" }}>⬇️ Export</button>
            <button onClick={() => fileInputRef.current?.click()} style={fileBtnStyle}>⬆️ Import</button>
          </div>
          {!saveAsMode && (
            <div style={{ display: "flex", gap: 8 }}>
              <button onClick={handleNew} style={{ padding: "8px 16px", background: "#f1f5f9", color: "#475569", border: "1px solid #e2e8f0", borderRadius: 8, fontSize: 13, fontWeight: 500, cursor: "pointer", fontFamily: "inherit" }}>New Blank</button>
              <button onClick={() => { setSaveAsMode(true); setSaveAsInput(designName); }}
                style={{ padding: "8px 16px", background: "#3B82F6", color: "#fff", border: "none", borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: "pointer", fontFamily: "inherit", marginLeft: "auto" }}>Save As New</button>
            </div>
          )}
        </div>
      </div>
    </div>
  );

  return (
    <div style={{ display: "flex", height: "100vh", fontFamily: "'DM Sans', sans-serif", background: "#f1f5f9", overflow: "hidden" }}>
      <link href="https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700&display=swap" rel="stylesheet" />
      <input ref={fileInputRef} type="file" accept=".json" onChange={handleImportFile} style={{ display: "none" }} />

      {statusMsg && (
        <div style={{ position: "fixed", top: 16, left: "50%", transform: "translateX(-50%)", zIndex: 10000, background: "#0f172a", color: "#fff", padding: "8px 20px", borderRadius: 8, fontSize: 13, fontWeight: 500, boxShadow: "0 4px 12px rgba(0,0,0,0.2)", animation: "fadeIn 0.2s ease" }}>{statusMsg}</div>
      )}
      <style>{`@keyframes fadeIn { from { opacity: 0; transform: translateX(-50%) translateY(-8px); } to { opacity: 1; transform: translateX(-50%) translateY(0); } }`}</style>

      {showFiles && <FilesPanel />}

      {/* Sidebar */}
      <div style={{ width: sidebarWidth, minWidth: sidebarWidth, background: "#fff", borderRight: "1px solid #e2e8f0", display: "flex", flexDirection: "column", overflow: "hidden", position: "relative" }}>
        {/* Header */}
        <div style={{ padding: "14px 16px", borderBottom: "1px solid #e2e8f0", background: "linear-gradient(180deg, #fafbfc 0%, #ffffff 100%)" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12 }}>
            <div style={{ width: 34, height: 34, borderRadius: 9, background: "#FEF3E2", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 18, flexShrink: 0 }}>🍕</div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 15, fontWeight: 700, color: "#0f172a", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", lineHeight: 1.2 }} title={designName}>
                {designName}
              </div>
              <div style={{ fontSize: 10, color: "#94a3b8", marginTop: 1, display: "flex", alignItems: "center", gap: 5 }}>
                {syncing ? (
                  <span style={{ color: "#3B82F6", fontWeight: 500 }}>● syncing…</span>
                ) : hasUnsaved ? (
                  <span style={{ color: "#D97706", fontWeight: 500, display: "flex", alignItems: "center", gap: 4 }}>
                    <span style={{ width: 6, height: 6, borderRadius: "50%", background: "#F59E0B" }} />unsaved changes
                  </span>
                ) : currentDesignId ? (
                  <span style={{ color: "#16A34A", fontWeight: 500 }}>✓ saved</span>
                ) : (
                  <span>not saved yet</span>
                )}
              </div>
            </div>
          </div>
          <div style={{ display: "flex", gap: 6, marginBottom: 10 }}>
            <button onClick={handleSave} style={primaryActionStyle}>💾 Save</button>
            <button onClick={() => { setSaveAsMode(true); setSaveAsInput(designName); setShowFiles(true); }} style={actionStyle}>Save As</button>
            <button onClick={() => { setShowFiles(true); setSaveAsMode(false); }} style={actionStyle}>📂 Open</button>
            <button onClick={handleExportFile} style={iconActionStyle} title="Export to .json file">⬇️</button>
            <button onClick={() => fileInputRef.current?.click()} style={iconActionStyle} title="Import .json file">⬆️</button>
          </div>
          <div style={{ fontSize: 10, color: "#94a3b8", display: "flex", alignItems: "center", gap: 6 }}>
            <span style={{ display: "flex", alignItems: "center", gap: 4, padding: "2px 7px", background: useCloud ? "#EFF6FF" : "#F1F5F9", color: useCloud ? "#2563EB" : "#64748b", borderRadius: 5, fontWeight: 500, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: "70%" }}>
              {useCloud ? `☁️ ${userEmail}` : "💾 Local storage"}
            </span>
            {useCloud && (
              <button onClick={onSignOut} style={{ marginLeft: "auto", background: "none", border: "none", color: "#94a3b8", fontSize: 10, cursor: "pointer", fontFamily: "inherit", textDecoration: "underline", flexShrink: 0 }}>Sign out</button>
            )}
          </div>
        </div>

        {/* Grid Size */}
        <div style={{ padding: "12px 16px", borderBottom: "1px solid #e2e8f0" }}>
          <div style={{ fontSize: 12, fontWeight: 600, color: "#475569", marginBottom: 8, textTransform: "uppercase", letterSpacing: "0.05em" }}>Space Dimensions</div>
          <div style={{ display: "flex", gap: 8, alignItems: "end" }}>
            <DimInput label="Width (ft)" value={tempGridW} onChange={setTempGridW} min={1} />
            <span style={{ paddingBottom: 8, color: "#94a3b8", fontWeight: 600 }}>×</span>
            <DimInput label="Depth (ft)" value={tempGridH} onChange={setTempGridH} min={1} />
            <button onClick={applyGridSize} style={{ padding: "6px 12px", background: "#0f172a", color: "#fff", border: "none", borderRadius: 6, fontSize: 12, fontWeight: 600, cursor: "pointer", whiteSpace: "nowrap", height: 32, fontFamily: "inherit" }}>Set</button>
          </div>
          <div style={{ fontSize: 11, color: "#94a3b8", marginTop: 6 }}>Total: {gridW * gridH} sq ft ({gridW}′ × {gridH}′)</div>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 10 }}>
            <span style={{ fontSize: 11, fontWeight: 600, color: "#475569" }}>Snap</span>
            <div style={{ display: "flex", background: "#f1f5f9", borderRadius: 6, padding: 2, border: "1px solid #e2e8f0" }}>
              {SNAP_OPTIONS.map(opt => (
                <button key={opt.label} onClick={() => setPrecision(opt.feet)}
                  title={`Move and resize in ${opt.label} steps`}
                  style={{
                    padding: "3px 9px", fontSize: 11, fontWeight: 600, fontFamily: "monospace",
                    border: "none", borderRadius: 4, cursor: "pointer",
                    background: Math.abs(precision - opt.feet) < 1e-6 ? "#3B82F6" : "transparent",
                    color: Math.abs(precision - opt.feet) < 1e-6 ? "#fff" : "#64748b",
                  }}>{opt.label}</button>
              ))}
            </div>
          </div>
          <div style={{ fontSize: 10, color: "#94a3b8", marginTop: 5 }}>Tip: select a shape and use arrow keys to nudge (Shift = 1 ft)</div>
        </div>

        {/* Zoom */}
        <div style={{ padding: "8px 16px", borderBottom: "1px solid #e2e8f0", display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ fontSize: 11, fontWeight: 600, color: "#475569", textTransform: "uppercase", letterSpacing: "0.05em" }}>Zoom</span>
          <button onClick={zoomOut} style={zoomBtnStyle}>−</button>
          <span style={{ fontSize: 12, color: "#64748b", fontFamily: "monospace", minWidth: 36, textAlign: "center" }}>{cellSize}px</span>
          <button onClick={zoomIn} style={zoomBtnStyle}>+</button>
        </div>

        {/* Tabs */}
        <div style={{ display: "flex", borderBottom: "1px solid #e2e8f0" }}>
          {["add", "edit", "list"].map(t => (
            <button key={t} onClick={() => setTab(t)} style={{ flex: 1, padding: "8px 0", background: tab === t ? "#f1f5f9" : "transparent", border: "none", borderBottom: tab === t ? "2px solid #3B82F6" : "2px solid transparent", fontSize: 12, fontWeight: tab === t ? 600 : 400, color: tab === t ? "#0f172a" : "#94a3b8", cursor: "pointer", fontFamily: "inherit" }}>
              {t === "add" ? "➕ Add" : t === "edit" ? "✏️ Edit" : "📋 List"}
            </button>
          ))}
        </div>

        {/* Tab content */}
        <div style={{ flex: 1, overflow: "auto", padding: 16 }}>
          {tab === "add" && (
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              <div style={{ display: "flex", gap: 8 }}><FtInInput label="Width" valueFeet={parseFloat(newW) || 0} onChangeFeet={v => setNewW(String(Math.max(precision, v)))} minFeet={precision} /><FtInInput label="Height" valueFeet={parseFloat(newH) || 0} onChangeFeet={v => setNewH(String(Math.max(precision, v)))} minFeet={precision} /></div>
              <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                <span style={{ fontSize: 11, color: "#64748b" }}>Label</span>
                <input type="text" value={newLabel} onChange={e => setNewLabel(e.target.value)} placeholder={`Item ${idCounter}`}
                  style={{ padding: "6px 8px", border: "1px solid #d1d5db", borderRadius: 6, fontSize: 13, background: "#f8fafc", outline: "none", fontFamily: "inherit" }}
                  onFocus={e => e.target.style.borderColor = "#3B82F6"} onBlur={e => e.target.style.borderColor = "#d1d5db"} onKeyDown={e => e.key === "Enter" && addShape()} />
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                <span style={{ fontSize: 11, color: "#64748b" }}>Color</span>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
                  {PALETTE.map(c => (<div key={c} onClick={() => setNewColor(c)} style={{ width: 24, height: 24, borderRadius: 4, background: c, cursor: "pointer", border: newColor === c ? "2px solid #0f172a" : "2px solid transparent" }} />))}
                </div>
              </div>
              <button onClick={addShape} style={{ padding: "10px 16px", background: "#3B82F6", color: "#fff", border: "none", borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: "pointer", marginTop: 4, fontFamily: "inherit" }}>Add Shape</button>
            </div>
          )}

          {tab === "edit" && (
            selected ? (
              <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                <div style={{ padding: 8, background: selected.color + "18", borderRadius: 8, border: `1px solid ${selected.color}40`, display: "flex", alignItems: "center", gap: 8 }}>
                  <div style={{ width: 16, height: 16, borderRadius: 3, background: selected.color }} />
                  <span style={{ fontSize: 13, fontWeight: 600, color: "#0f172a" }}>{selected.label}</span>
                  <span style={{ fontSize: 11, color: "#64748b", marginLeft: "auto", fontFamily: "monospace" }}>{fmtFtIn(selected.w)}×{fmtFtIn(selected.h)}{selected.rotation ? ` ↻${selected.rotation}°` : ""}</span>
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                  <span style={{ fontSize: 11, color: "#64748b" }}>Label</span>
                  <input type="text" value={selected.label} onChange={e => updateShape(selected.id, { label: e.target.value })} style={{ padding: "6px 8px", border: "1px solid #d1d5db", borderRadius: 6, fontSize: 13, background: "#f8fafc", outline: "none", fontFamily: "inherit" }} />
                </div>
                <div style={{ display: "flex", gap: 8 }}>
                  <FtInInput label="Width" valueFeet={selected.w} minFeet={precision} onChangeFeet={v => { const val = Math.max(precision, v); updateShape(selected.id, { w: val, x: clamp(selected.x, 0, gridW - getRotatedBounds(val, selected.h, selected.rotation).bw) }); }} />
                  <FtInInput label="Height" valueFeet={selected.h} minFeet={precision} onChangeFeet={v => { const val = Math.max(precision, v); updateShape(selected.id, { h: val, y: clamp(selected.y, 0, gridH - getRotatedBounds(selected.w, val, selected.rotation).bh) }); }} />
                </div>
                <div style={{ display: "flex", gap: 8 }}>
                  <FtInInput label="X pos" valueFeet={selected.x} minFeet={0} onChangeFeet={v => updateShape(selected.id, { x: clamp(v, 0, gridW - getRotatedBounds(selected.w, selected.h, selected.rotation).bw) })} />
                  <FtInInput label="Y pos" valueFeet={selected.y} minFeet={0} onChangeFeet={v => updateShape(selected.id, { y: clamp(v, 0, gridH - getRotatedBounds(selected.w, selected.h, selected.rotation).bh) })} />
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                  <span style={{ fontSize: 11, color: "#64748b" }}>Rotation</span>
                  <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                    <button onClick={() => rotateShape(selected.id, -90)} style={rotateBtnStyle}>↺ 90°</button>
                    <button onClick={() => rotateShape(selected.id, 90)} style={rotateBtnStyle}>↻ 90°</button>
                    <button onClick={() => rotateShape(selected.id, -45)} style={rotateBtnStyle}>↺ 45°</button>
                    <button onClick={() => rotateShape(selected.id, 45)} style={rotateBtnStyle}>↻ 45°</button>
                  </div>
                  <div style={{ display: "flex", gap: 8, alignItems: "end" }}>
                    <DimInput label="Angle (°)" value={selected.rotation} onChange={v => setShapeAngle(selected.id, parseFloat(v) || 0)} min={0} step="1" />
                    <button onClick={() => setShapeAngle(selected.id, 0)} style={{ ...rotateBtnStyle, height: 32, fontSize: 11, padding: "4px 10px" }}>Reset 0°</button>
                  </div>
                  <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
                    {[0,45,90,135,180,225,270,315].map(a => (
                      <button key={a} onClick={() => setShapeAngle(selected.id, a)} style={{ padding: "2px 8px", fontSize: 10, fontFamily: "monospace", background: selected.rotation === a ? "#3B82F6" : "#f1f5f9", color: selected.rotation === a ? "#fff" : "#64748b", border: "1px solid " + (selected.rotation === a ? "#3B82F6" : "#e2e8f0"), borderRadius: 4, cursor: "pointer" }}>{a}°</button>
                    ))}
                  </div>
                  {!isCardinal(selected.rotation) && <div style={{ fontSize: 10, color: "#F59E0B", background: "#FFFBEB", padding: "4px 8px", borderRadius: 4, border: "1px solid #FDE68A" }}>Resize handles at 0°/90°/180°/270° only</div>}
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                  <span style={{ fontSize: 11, color: "#64748b" }}>Color</span>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
                    {PALETTE.map(c => (<div key={c} onClick={() => updateShape(selected.id, { color: c })} style={{ width: 24, height: 24, borderRadius: 4, background: c, cursor: "pointer", border: selected.color === c ? "2px solid #0f172a" : "2px solid transparent" }} />))}
                  </div>
                </div>
                <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 4 }}>
                  <SmallBtn onClick={() => duplicateShape(selected.id)} label="Duplicate" />
                  <SmallBtn onClick={() => bringToFront(selected.id)} label="To Front" />
                  <SmallBtn onClick={() => sendToBack(selected.id)} label="To Back" />
                  <SmallBtn onClick={() => deleteShape(selected.id)} label="Delete" color="#EF4444" />
                </div>
                <div style={{ fontSize: 11, color: "#94a3b8", marginTop: 4, fontFamily: "monospace" }}>Area: {(selected.w * selected.h).toFixed(2)} sq ft | ({fmtFtIn(selected.x)}, {fmtFtIn(selected.y)}){selected.rotation ? ` | ${selected.rotation}°` : ""}</div>
              </div>
            ) : (
              <div style={{ textAlign: "center", padding: "32px 16px", color: "#94a3b8" }}>
                <div style={{ fontSize: 28, marginBottom: 8 }}>👆</div>
                <div style={{ fontSize: 13 }}>Click a shape to edit</div>
              </div>
            )
          )}

          {tab === "list" && (
            <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              {shapes.length === 0 && <div style={{ textAlign: "center", padding: "32px 16px", color: "#94a3b8", fontSize: 13 }}>No shapes yet.</div>}
              {shapes.map(s => (
                <div key={s.id} onClick={() => { setSelectedId(s.id); setTab("edit"); }} style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 10px", borderRadius: 6, cursor: "pointer", background: selectedId === s.id ? "#f1f5f9" : "transparent", border: selectedId === s.id ? "1px solid #e2e8f0" : "1px solid transparent" }}>
                  <div style={{ width: 14, height: 14, borderRadius: 3, background: s.color, flexShrink: 0 }} />
                  <span style={{ fontSize: 13, color: "#0f172a", flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{s.label}</span>
                  <span style={{ fontSize: 10, color: "#94a3b8", fontFamily: "monospace", flexShrink: 0 }}>{fmtFtIn(s.w)}×{fmtFtIn(s.h)}{s.rotation ? ` ↻${s.rotation}°` : ""}</span>
                  <button onClick={e => { e.stopPropagation(); deleteShape(s.id); }} style={{ background: "none", border: "none", cursor: "pointer", color: "#cbd5e1", fontSize: 14, padding: "0 2px" }}>×</button>
                </div>
              ))}
              {shapes.length > 0 && <div style={{ fontSize: 11, color: "#94a3b8", marginTop: 8, fontFamily: "monospace" }}>{shapes.length} shapes · {shapes.reduce((a, s) => a + s.w * s.h, 0).toFixed(1)} of {gridW * gridH} sq ft</div>}
            </div>
          )}
        </div>

        {/* Drag handle to resize sidebar */}
        <div
          onMouseDown={(e) => { e.preventDefault(); setResizingSidebar(true); }}
          onDoubleClick={() => { setSidebarWidth(300); localStorage.setItem("fp_sidebar_width", "300"); }}
          title="Drag to resize · double-click to reset"
          style={{
            position: "absolute", top: 0, right: 0, width: 6, height: "100%",
            cursor: "col-resize", zIndex: 50,
            background: resizingSidebar ? "#3B82F6" : "transparent",
            transition: resizingSidebar ? "none" : "background 0.15s",
          }}
          onMouseEnter={(e) => { if (!resizingSidebar) e.currentTarget.style.background = "#bfdbfe"; }}
          onMouseLeave={(e) => { if (!resizingSidebar) e.currentTarget.style.background = "transparent"; }}
        />
      </div>
      <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
        <div style={{ padding: "6px 16px", background: "#fff", borderBottom: "1px solid #e2e8f0", display: "flex", alignItems: "center", gap: 12, fontSize: 12, color: "#64748b" }}>
          <span style={{ fontFamily: "monospace" }}>{gridW}′×{gridH}′ = {gridW * gridH} sq ft</span>
          <span style={{ color: "#e2e8f0" }}>|</span>
          <span>1ft = {cellSize}px</span>
          {selected && <><span style={{ color: "#e2e8f0" }}>|</span><span style={{ color: "#3B82F6", fontWeight: 500 }}>{selected.label} ({fmtFtIn(selected.w)}×{fmtFtIn(selected.h)}{selected.rotation ? ` ${selected.rotation}°` : ""})</span></>}
          <div style={{ marginLeft: "auto", display: "flex", gap: 6 }}>
            <button onClick={exportPNG} disabled={exporting} style={exportImgBtnStyle} title="Download a PNG image of this drawing">🖼️ PNG</button>
            <button onClick={exportPDF} disabled={exporting} style={exportImgBtnStyle} title="Download a PDF of this drawing">📄 PDF</button>
          </div>
        </div>

        <div ref={gridRef} style={{ flex: 1, overflow: "auto", background: "#e8ecf1", cursor: dragState ? "grabbing" : "default" }} onClick={handleGridClick}>
          <div style={{ display: "inline-block", padding: 8, minWidth: "100%", minHeight: "100%" }}>
            <svg width={cW + RULER + 1} height={cH + RULER + 1} style={{ display: "block" }}>
              <rect x={0} y={0} width={RULER} height={RULER} fill="#f8fafc" />
              <rect x={RULER} y={0} width={cW} height={RULER} fill="#f8fafc" />
              <rect x={0} y={RULER} width={RULER} height={cH} fill="#f8fafc" />
              {hTicks}{vTicks}
              <line x1={RULER} y1={RULER} x2={cW+RULER} y2={RULER} stroke="#cbd5e1" strokeWidth={1} />
              <line x1={RULER} y1={RULER} x2={RULER} y2={cH+RULER} stroke="#cbd5e1" strokeWidth={1} />
            </svg>
            <div data-grid="true" onClick={handleGridClick} style={{
              position: "relative", width: cW, height: cH, marginLeft: RULER, marginTop: -cH - 1, background: "#fff",
              backgroundImage: `linear-gradient(to right,#f0f0f0 1px,transparent 1px),linear-gradient(to bottom,#f0f0f0 1px,transparent 1px),linear-gradient(to right,#dcdcdc 1px,transparent 1px),linear-gradient(to bottom,#dcdcdc 1px,transparent 1px)`,
              backgroundSize: `${cellSize}px ${cellSize}px,${cellSize}px ${cellSize}px,${cellSize*5}px ${cellSize*5}px,${cellSize*5}px ${cellSize*5}px`,
              border: "1px solid #aaa", boxSizing: "content-box",
            }}>
              {shapes.map(s => {
                const isSel = s.id === selectedId;
                const { bw, bh } = getRotatedBounds(s.w, s.h, s.rotation);
                const pxBW = bw * cellSize, pxBH = bh * cellSize, pxW = s.w * cellSize, pxH = s.h * cellSize;
                const fs = Math.min(13, Math.min(pxW / (s.label.length * 0.6 + 1), pxH * 0.35));
                return (
                  <div key={s.id} style={{ position: "absolute", left: s.x * cellSize, top: s.y * cellSize, width: pxBW, height: pxBH, zIndex: isSel ? 100 : 1 }}>
                    <div onMouseDown={e => handleShapeMouseDown(e, s)} style={{
                      position: "absolute", left: (pxBW-pxW)/2, top: (pxBH-pxH)/2, width: pxW, height: pxH,
                      transform: `rotate(${s.rotation}deg)`, background: s.color+"30", border: `2px solid ${s.color}${isSel?"":"99"}`,
                      borderRadius: 2, cursor: dragState?.id===s.id?"grabbing":"grab",
                      display: "flex", alignItems: "center", justifyContent: "center", textAlign: "center",
                      overflow: "hidden", userSelect: "none", boxSizing: "border-box",
                      boxShadow: isSel ? "0 2px 8px rgba(0,0,0,0.15)" : "0 1px 2px rgba(0,0,0,0.06)",
                    }}>
                      <div style={{ fontSize: Math.max(8,fs), fontWeight: 600, color: s.color, lineHeight: 1.2, padding: 2, pointerEvents: "none", maxWidth: "100%", overflow: "hidden", textOverflow: "ellipsis", fontFamily: "inherit" }}>
                        {s.label}
                        {pxH>30 && <div style={{ fontSize: Math.max(7,fs-2), fontWeight: 400, opacity: 0.7, fontFamily: "monospace", marginTop: 1 }}>{fmtFtIn(s.w)}×{fmtFtIn(s.h)}</div>}
                      </div>
                    </div>
                    {isSel && s.rotation !== 0 && <div style={{ position: "absolute", inset: 0, border: "2px dashed #3B82F6", borderRadius: 2, pointerEvents: "none", opacity: 0.4 }} />}
                    {isSel && s.rotation !== 0 && <div style={{ position: "absolute", top: -20, right: -8, fontSize: 10, color: "#3B82F6", fontFamily: "monospace", fontWeight: 600, background: "#fff", padding: "1px 4px", borderRadius: 3, border: "1px solid #3B82F6", whiteSpace: "nowrap", pointerEvents: "none", zIndex: 20 }}>↻ {s.rotation}°</div>}
                    {resizeHandles(s)}
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

const zoomBtnStyle = { width: 26, height: 26, display: "flex", alignItems: "center", justifyContent: "center", background: "#f1f5f9", border: "1px solid #e2e8f0", borderRadius: 4, cursor: "pointer", fontSize: 14, fontWeight: 600, color: "#475569", fontFamily: "inherit" };
const rotateBtnStyle = { padding: "5px 10px", background: "#f1f5f9", border: "1px solid #e2e8f0", borderRadius: 5, fontSize: 12, fontWeight: 500, cursor: "pointer", color: "#475569", fontFamily: "inherit", whiteSpace: "nowrap" };
const saveBtnStyle = { padding: "5px 12px", background: "#f8fafc", border: "1px solid #e2e8f0", borderRadius: 6, fontSize: 11, fontWeight: 500, cursor: "pointer", color: "#475569", fontFamily: "inherit", whiteSpace: "nowrap" };
const primaryActionStyle = { flex: 1, padding: "7px 10px", background: "#3B82F6", border: "1px solid #3B82F6", borderRadius: 7, fontSize: 12, fontWeight: 600, cursor: "pointer", color: "#fff", fontFamily: "inherit", whiteSpace: "nowrap" };
const actionStyle = { flex: 1, padding: "7px 10px", background: "#fff", border: "1px solid #e2e8f0", borderRadius: 7, fontSize: 12, fontWeight: 500, cursor: "pointer", color: "#475569", fontFamily: "inherit", whiteSpace: "nowrap" };
const iconActionStyle = { padding: "7px 9px", background: "#fff", border: "1px solid #e2e8f0", borderRadius: 7, fontSize: 12, cursor: "pointer", fontFamily: "inherit", whiteSpace: "nowrap", flexShrink: 0 };
const fileBtnStyle = { padding: "6px 14px", border: "1px solid #e2e8f0", borderRadius: 6, fontSize: 12, fontWeight: 600, cursor: "pointer", fontFamily: "inherit", whiteSpace: "nowrap" };
const exportImgBtnStyle = { padding: "4px 10px", background: "#fff", border: "1px solid #e2e8f0", borderRadius: 6, fontSize: 11, fontWeight: 600, cursor: "pointer", color: "#475569", fontFamily: "inherit", whiteSpace: "nowrap" };

// Single-box feet+inches input. Type freely (5'6", 5' 6, 5.5, 6"); formats on blur.
function FtInInput({ valueFeet, onChangeFeet, label, minFeet = 0 }) {
  const [text, setText] = useState(() => fmtFtIn(valueFeet));
  const [focused, setFocused] = useState(false);
  useEffect(() => { if (!focused) setText(fmtFtIn(valueFeet)); }, [valueFeet, focused]);
  const commit = () => {
    const parsed = parseFtIn(text);
    if (parsed == null) { setText(fmtFtIn(valueFeet)); return; }
    const v = Math.max(minFeet, Math.round(parsed * 12) / 12); // snap to whole inch
    onChangeFeet(v);
    setText(fmtFtIn(v));
  };
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 2, flex: 1 }}>
      <span style={{ fontSize: 11, color: "#64748b", fontFamily: "inherit" }}>{label}</span>
      <input type="text" value={text} placeholder={`5'6"`}
        onChange={(e) => setText(e.target.value)}
        onFocus={(e) => { setFocused(true); e.target.select(); e.target.style.borderColor = "#3B82F6"; }}
        onBlur={(e) => { setFocused(false); commit(); e.target.style.borderColor = "#d1d5db"; }}
        onKeyDown={(e) => { if (e.key === "Enter") e.target.blur(); }}
        style={{ width: "100%", padding: "6px 8px", border: "1px solid #d1d5db", borderRadius: 6, fontSize: 13, fontFamily: "monospace", background: "#f8fafc", outline: "none" }} />
    </div>
  );
}

function SmallBtn({ onClick, label, color = "#475569" }) {
  return <button onClick={onClick} style={{ padding: "4px 10px", background: color === "#EF4444" ? "#FEF2F2" : "#f8fafc", color, border: `1px solid ${color}30`, borderRadius: 5, fontSize: 11, fontWeight: 500, cursor: "pointer", fontFamily: "inherit" }}>{label}</button>;
}

function MiniBtn({ onClick, children, tip }) {
  return <button onClick={e => { e.stopPropagation(); onClick(); }} title={tip}
    style={{ width: 28, height: 28, display: "flex", alignItems: "center", justifyContent: "center", background: "transparent", border: "1px solid transparent", borderRadius: 4, cursor: "pointer", fontSize: 13 }}
    onMouseEnter={e => { e.currentTarget.style.background = "#f1f5f9"; e.currentTarget.style.borderColor = "#e2e8f0"; }}
    onMouseLeave={e => { e.currentTarget.style.background = "transparent"; e.currentTarget.style.borderColor = "transparent"; }}
  >{children}</button>;
}
