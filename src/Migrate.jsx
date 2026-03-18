import { useState, useEffect, useRef } from "react";
import { supabase, isSupabaseConfigured } from "./supabaseClient";

const LP = "fp_";

function lsLoadIndex() {
  try { return JSON.parse(localStorage.getItem(LP + "index")) || []; } catch { return []; }
}
function lsLoadData(id) {
  try { return JSON.parse(localStorage.getItem(LP + "data:" + id)); } catch { return null; }
}

function validateImport(data) {
  if (!data || typeof data !== "object") return "Invalid file format";
  if (data._format !== "easy-floorplan") return "Not a floor plan file";
  if (!data.gridW || !data.gridH) return "Missing grid dimensions";
  if (!Array.isArray(data.shapes)) return "Missing shapes data";
  return null;
}

export default function Migrate({ session, onDone }) {
  const userId = session?.user?.id;
  const [localDesigns, setLocalDesigns] = useState([]);
  const [jsonFiles, setJsonFiles] = useState([]);
  const [selected, setSelected] = useState(new Set());
  const [migrating, setMigrating] = useState(false);
  const [results, setResults] = useState([]);
  const [done, setDone] = useState(false);
  const fileInputRef = useRef(null);

  // Load localStorage designs on mount
  useEffect(() => {
    const index = lsLoadIndex();
    const designs = index.map((entry) => {
      const data = lsLoadData(entry.id);
      return {
        source: "localStorage",
        localId: entry.id,
        name: entry.name || data?.designName || "Untitled",
        gridW: entry.gridW || data?.gridW || 0,
        gridH: entry.gridH || data?.gridH || 0,
        shapeCount: entry.shapeCount || (data?.shapes || []).length,
        data,
      };
    }).filter((d) => d.data !== null);

    setLocalDesigns(designs);
    // Select all by default
    setSelected(new Set(designs.map((_, i) => `ls-${i}`)));
  }, []);

  // Handle JSON file uploads
  const handleFiles = (e) => {
    const files = Array.from(e.target.files || []);
    const readers = files.map(
      (file) =>
        new Promise((resolve) => {
          const reader = new FileReader();
          reader.onload = (evt) => {
            try {
              const data = JSON.parse(evt.target.result);
              const err = validateImport(data);
              if (err) {
                resolve({ filename: file.name, error: err });
              } else {
                resolve({
                  source: "file",
                  filename: file.name,
                  name: data.designName || file.name.replace(".json", ""),
                  gridW: data.gridW,
                  gridH: data.gridH,
                  shapeCount: (data.shapes || []).length,
                  data: {
                    gridW: data.gridW,
                    gridH: data.gridH,
                    shapes: (data.shapes || []).map((s) => ({
                      ...s,
                      rotation: s.rotation || 0,
                    })),
                    idCounter: data.idCounter || 1,
                    designName: data.designName || file.name.replace(".json", ""),
                  },
                  error: null,
                });
              }
            } catch {
              resolve({ filename: file.name, error: "Invalid JSON" });
            }
          };
          reader.readAsText(file);
        })
    );

    Promise.all(readers).then((results) => {
      const valid = results.filter((r) => !r.error);
      const invalid = results.filter((r) => r.error);

      setJsonFiles((prev) => [...prev, ...valid]);

      // Auto-select new files
      setSelected((prev) => {
        const next = new Set(prev);
        valid.forEach((_, i) => next.add(`file-${jsonFiles.length + i}`));
        return next;
      });

      if (invalid.length > 0) {
        alert(
          `Skipped ${invalid.length} file(s):\n` +
            invalid.map((r) => `  ${r.filename}: ${r.error}`).join("\n")
        );
      }
    });

    e.target.value = "";
  };

  const allItems = [
    ...localDesigns.map((d, i) => ({ ...d, key: `ls-${i}` })),
    ...jsonFiles.map((d, i) => ({ ...d, key: `file-${i}` })),
  ];

  const toggleSelect = (key) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const toggleAll = () => {
    if (selected.size === allItems.length) {
      setSelected(new Set());
    } else {
      setSelected(new Set(allItems.map((d) => d.key)));
    }
  };

  const handleMigrate = async () => {
    if (!userId) return;
    setMigrating(true);
    setResults([]);
    const newResults = [];

    const toMigrate = allItems.filter((d) => selected.has(d.key));

    for (const item of toMigrate) {
      try {
        const { data: insertedRow, error } = await supabase
          .from("designs")
          .insert({
            user_id: userId,
            name: item.name,
            grid_w: item.data.gridW,
            grid_h: item.data.gridH,
            shape_count: (item.data.shapes || []).length,
            data: item.data,
          })
          .select("id")
          .single();

        if (error) {
          newResults.push({ name: item.name, status: "error", message: error.message });
        } else {
          newResults.push({ name: item.name, status: "ok", id: insertedRow.id });
        }
      } catch (err) {
        newResults.push({ name: item.name, status: "error", message: err.message });
      }
    }

    setResults(newResults);
    setMigrating(false);
    setDone(true);
  };

  const successCount = results.filter((r) => r.status === "ok").length;
  const errorCount = results.filter((r) => r.status === "error").length;

  if (!isSupabaseConfigured() || !session) {
    return (
      <div style={pageStyle}>
        <div style={cardStyle}>
          <h2 style={{ margin: 0, color: "#DC2626" }}>Not Connected</h2>
          <p style={{ color: "#64748b" }}>
            You need to be signed in with Supabase to migrate designs to the
            cloud. Please sign in first, then come back to this page.
          </p>
          <button onClick={onDone} style={primaryBtnStyle}>
            Back to App
          </button>
        </div>
      </div>
    );
  }

  return (
    <div style={pageStyle}>
      <link
        href="https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700&display=swap"
        rel="stylesheet"
      />
      <input
        ref={fileInputRef}
        type="file"
        accept=".json"
        multiple
        onChange={handleFiles}
        style={{ display: "none" }}
      />

      <div style={{ ...cardStyle, maxWidth: 600 }}>
        <div style={{ textAlign: "center", marginBottom: 24 }}>
          <div style={{ fontSize: 32, marginBottom: 8 }}>🚚</div>
          <h1
            style={{
              margin: 0,
              fontSize: 22,
              fontWeight: 700,
              color: "#0f172a",
            }}
          >
            Migrate Designs to Cloud
          </h1>
          <p style={{ color: "#94a3b8", fontSize: 13, marginTop: 4 }}>
            Import from browser localStorage and/or .json files into your
            Supabase account
          </p>
        </div>

        {!done ? (
          <>
            {/* Source sections */}
            <div
              style={{
                display: "flex",
                gap: 8,
                marginBottom: 16,
              }}
            >
              <div
                style={{
                  flex: 1,
                  padding: "12px 16px",
                  background: "#f8fafc",
                  borderRadius: 10,
                  border: "1px solid #e2e8f0",
                }}
              >
                <div
                  style={{
                    fontSize: 12,
                    fontWeight: 600,
                    color: "#475569",
                    marginBottom: 2,
                  }}
                >
                  💾 localStorage
                </div>
                <div style={{ fontSize: 20, fontWeight: 700, color: "#0f172a" }}>
                  {localDesigns.length}
                </div>
                <div style={{ fontSize: 11, color: "#94a3b8" }}>
                  design{localDesigns.length !== 1 ? "s" : ""} found
                </div>
              </div>

              <div
                style={{
                  flex: 1,
                  padding: "12px 16px",
                  background: "#f8fafc",
                  borderRadius: 10,
                  border: "1px solid #e2e8f0",
                }}
              >
                <div
                  style={{
                    fontSize: 12,
                    fontWeight: 600,
                    color: "#475569",
                    marginBottom: 2,
                  }}
                >
                  📄 JSON Files
                </div>
                <div style={{ fontSize: 20, fontWeight: 700, color: "#0f172a" }}>
                  {jsonFiles.length}
                </div>
                <button
                  onClick={() => fileInputRef.current?.click()}
                  style={{
                    fontSize: 11,
                    color: "#3B82F6",
                    background: "none",
                    border: "none",
                    cursor: "pointer",
                    padding: 0,
                    fontFamily: "inherit",
                    textDecoration: "underline",
                  }}
                >
                  + Add .json files
                </button>
              </div>
            </div>

            {/* Design list */}
            {allItems.length > 0 ? (
              <>
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    marginBottom: 8,
                  }}
                >
                  <span style={{ fontSize: 12, fontWeight: 600, color: "#475569" }}>
                    {selected.size} of {allItems.length} selected
                  </span>
                  <button
                    onClick={toggleAll}
                    style={{
                      fontSize: 11,
                      color: "#3B82F6",
                      background: "none",
                      border: "none",
                      cursor: "pointer",
                      fontFamily: "inherit",
                    }}
                  >
                    {selected.size === allItems.length
                      ? "Deselect All"
                      : "Select All"}
                  </button>
                </div>

                <div
                  style={{
                    maxHeight: 300,
                    overflow: "auto",
                    border: "1px solid #e2e8f0",
                    borderRadius: 10,
                    marginBottom: 16,
                  }}
                >
                  {allItems.map((item) => (
                    <div
                      key={item.key}
                      onClick={() => toggleSelect(item.key)}
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 10,
                        padding: "10px 14px",
                        cursor: "pointer",
                        borderBottom: "1px solid #f1f5f9",
                        background: selected.has(item.key)
                          ? "#EFF6FF"
                          : "transparent",
                        transition: "background 0.1s",
                      }}
                    >
                      <div
                        style={{
                          width: 18,
                          height: 18,
                          borderRadius: 4,
                          border: selected.has(item.key)
                            ? "2px solid #3B82F6"
                            : "2px solid #d1d5db",
                          background: selected.has(item.key)
                            ? "#3B82F6"
                            : "#fff",
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                          flexShrink: 0,
                          color: "#fff",
                          fontSize: 12,
                          fontWeight: 700,
                        }}
                      >
                        {selected.has(item.key) ? "✓" : ""}
                      </div>

                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div
                          style={{
                            fontSize: 13,
                            fontWeight: 600,
                            color: "#0f172a",
                            overflow: "hidden",
                            textOverflow: "ellipsis",
                            whiteSpace: "nowrap",
                          }}
                        >
                          {item.name}
                        </div>
                        <div
                          style={{
                            fontSize: 11,
                            color: "#94a3b8",
                            fontFamily: "monospace",
                          }}
                        >
                          {item.gridW}×{item.gridH} ft · {item.shapeCount}{" "}
                          shapes
                        </div>
                      </div>

                      <span
                        style={{
                          fontSize: 10,
                          padding: "2px 8px",
                          borderRadius: 4,
                          background:
                            item.source === "localStorage"
                              ? "#FEF3C7"
                              : "#DBEAFE",
                          color:
                            item.source === "localStorage"
                              ? "#92400E"
                              : "#1E40AF",
                          fontWeight: 500,
                        }}
                      >
                        {item.source === "localStorage" ? "localStorage" : item.filename}
                      </span>
                    </div>
                  ))}
                </div>

                <button
                  onClick={handleMigrate}
                  disabled={selected.size === 0 || migrating}
                  style={{
                    ...primaryBtnStyle,
                    opacity: selected.size === 0 || migrating ? 0.5 : 1,
                    cursor:
                      selected.size === 0 || migrating ? "not-allowed" : "pointer",
                    width: "100%",
                  }}
                >
                  {migrating
                    ? "Migrating..."
                    : `Migrate ${selected.size} Design${selected.size !== 1 ? "s" : ""} to Cloud ☁️`}
                </button>
              </>
            ) : (
              <div
                style={{
                  textAlign: "center",
                  padding: "32px 16px",
                  color: "#94a3b8",
                }}
              >
                <div style={{ fontSize: 13 }}>
                  No designs found in localStorage.
                </div>
                <div style={{ fontSize: 13, marginTop: 8 }}>
                  <button
                    onClick={() => fileInputRef.current?.click()}
                    style={{
                      color: "#3B82F6",
                      background: "none",
                      border: "none",
                      cursor: "pointer",
                      fontFamily: "inherit",
                      fontSize: 13,
                      textDecoration: "underline",
                    }}
                  >
                    Add .json files to import
                  </button>
                </div>
              </div>
            )}

            <div style={{ textAlign: "center", marginTop: 12 }}>
              <button
                onClick={onDone}
                style={{
                  background: "none",
                  border: "none",
                  color: "#94a3b8",
                  fontSize: 12,
                  cursor: "pointer",
                  fontFamily: "inherit",
                }}
              >
                Skip — go to the floor plan tool
              </button>
            </div>
          </>
        ) : (
          /* Results screen */
          <>
            <div
              style={{
                textAlign: "center",
                padding: "16px 0",
                marginBottom: 16,
              }}
            >
              <div
                style={{ fontSize: 40, marginBottom: 8 }}
              >
                {errorCount === 0 ? "✅" : "⚠️"}
              </div>
              <div
                style={{ fontSize: 16, fontWeight: 600, color: "#0f172a" }}
              >
                {successCount} design{successCount !== 1 ? "s" : ""} migrated
                successfully
                {errorCount > 0 && (
                  <span style={{ color: "#EF4444" }}>
                    , {errorCount} failed
                  </span>
                )}
              </div>
            </div>

            <div
              style={{
                maxHeight: 250,
                overflow: "auto",
                border: "1px solid #e2e8f0",
                borderRadius: 10,
                marginBottom: 16,
              }}
            >
              {results.map((r, i) => (
                <div
                  key={i}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 8,
                    padding: "8px 14px",
                    borderBottom: "1px solid #f1f5f9",
                  }}
                >
                  <span style={{ fontSize: 14 }}>
                    {r.status === "ok" ? "✅" : "❌"}
                  </span>
                  <span
                    style={{
                      fontSize: 13,
                      color: "#0f172a",
                      flex: 1,
                    }}
                  >
                    {r.name}
                  </span>
                  {r.status === "error" && (
                    <span
                      style={{
                        fontSize: 10,
                        color: "#EF4444",
                        maxWidth: 180,
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {r.message}
                    </span>
                  )}
                </div>
              ))}
            </div>

            <button
              onClick={onDone}
              style={{ ...primaryBtnStyle, width: "100%" }}
            >
              Done — Open Floor Plan Tool
            </button>
          </>
        )}
      </div>
    </div>
  );
}

const pageStyle = {
  height: "100vh",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  background: "#f1f5f9",
  fontFamily: "'DM Sans', sans-serif",
};

const cardStyle = {
  background: "#fff",
  borderRadius: 16,
  padding: 32,
  width: "90%",
  maxWidth: 520,
  boxShadow: "0 4px 24px rgba(0,0,0,0.08)",
  border: "1px solid #e2e8f0",
};

const primaryBtnStyle = {
  padding: "12px 24px",
  background: "#3B82F6",
  color: "#fff",
  border: "none",
  borderRadius: 10,
  fontSize: 14,
  fontWeight: 600,
  cursor: "pointer",
  fontFamily: "inherit",
};
