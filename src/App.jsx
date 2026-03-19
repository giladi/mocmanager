import React, { useEffect, useMemo, useState } from "react";
import {
  createMoc,
  createPart,
  deleteMoc,
  deletePart,
  getSession,
  listAllPartsForUser,
  listMocParts,
  listMocs,
  signIn,
  signOut,
  signUp,
  updateMoc,
  updatePart
} from "./lib/api";
import { supabase } from "./lib/supabase";

const REBRICKABLE_COLOR_MAP = {
  "0": "Black",
  "1": "Blue",
  "2": "Tan",
  "4": "Orange",
  "14": "Yellow",
  "15": "White",
  "19": "Trans Green",
  "25": "Orange",
  "34": "Lime",
  "36": "Bright Green",
  "40": "Trans Clear",
  "41": "Trans Red",
  "47": "Trans Yellow",
  "71": "Light Bluish Gray",
  "72": "Dark Bluish Gray",
  "73": "Medium Blue",
  "179": "Flat Silver",
  "182": "Trans Orange",
  "272": "Dark Blue",
  "484": "Dark Orange",
  "9999": "Unknown"
};

const BRICKLINK_COLOR_CODES = {
  "White": 1,
  "Yellow": 3,
  "Red": 5,
  "Blue": 7,
  "Black": 11,
  "Tan": 2,
  "Orange": 4,
  "Lime": 34,
  "Bright Green": 36,
  "Trans Clear": 12,
  "Trans Red": 41,
  "Trans Yellow": 46,
  "Trans Green": 20,
  "Light Bluish Gray": 86,
  "Dark Bluish Gray": 85,
  "Medium Blue": 42,
  "Dark Blue": 63,
  "Dark Orange": 68,
  "Flat Silver": 95
};

function parseCSV(text) {
  const rows = [];
  let row = [];
  let field = "";
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    const next = text[i + 1];
    if (char === '"') {
      if (inQuotes && next === '"') {
        field += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (char === "," && !inQuotes) {
      row.push(field);
      field = "";
    } else if ((char === "\n" || char === "\r") && !inQuotes) {
      if (char === "\r" && next === "\n") i++;
      row.push(field);
      if (row.some((cell) => cell !== "")) rows.push(row);
      row = [];
      field = "";
    } else {
      field += char;
    }
  }
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    if (row.some((cell) => cell !== "")) rows.push(row);
  }
  return rows;
}

function normalizeHeader(h) {
  return (h || "").trim().toLowerCase().replace(/\s+/g, " ");
}

function decodeRebrickableColor(value) {
  const key = String(value || "").trim();
  if (!key) return "Unknown";
  if (/^[A-Za-z]/.test(key)) return key;
  return REBRICKABLE_COLOR_MAP[key] || `Color ${key}`;
}

function filenameToTitle(fileName) {
  const base = fileName.replace(/\.[^/.]+$/, "").trim();
  const cleaned = base
    .replace(/^rebrickable_parts_/, "")
    .replace(/^\d+-\d+-/, "")
    .replace(/^\d+-/, "")
    .replace(/[_-]+/g, " ")
    .trim();
  return (cleaned || base || "Imported MOC").replace(/\b\w/g, (c) => c.toUpperCase());
}

function importRebrickableCSV(fileName, text) {
  const rows = parseCSV(text);
  if (!rows.length) throw new Error("CSV appears to be empty.");

  const headers = rows[0].map(normalizeHeader);
  const idxPart = headers.findIndex((h) => ["part", "part num", "part_num", "part number"].includes(h));
  const idxColor = headers.findIndex((h) => ["color", "color name", "color_name"].includes(h));
  const idxQty = headers.findIndex((h) => ["quantity", "qty"].includes(h));
  const idxModel = headers.findIndex((h) => ["model", "moc", "set", "name"].includes(h));
  const idxSpare = headers.findIndex((h) => ["is spare", "spare", "is_spare"].includes(h));

  if (idxPart === -1 || idxColor === -1 || idxQty === -1) {
    throw new Error("Could not find required CSV columns. Need part, color, and quantity.");
  }

  const grouped = new Map();
  let csvModelName = "";
  let spareCount = 0;
  let unknownColors = 0;

  for (let i = 1; i < rows.length; i++) {
    const r = rows[i];
    const partNumber = (r[idxPart] || "").trim();
    const rawColor = (r[idxColor] || "").trim();
    const color = decodeRebrickableColor(rawColor);
    const requiredQty = parseInt((r[idxQty] || "0").trim(), 10) || 0;
    const spareValue = idxSpare !== -1 ? String(r[idxSpare] || "").trim().toLowerCase() : "";
    const isSpare = ["true", "1", "yes"].includes(spareValue);

    if (!csvModelName && idxModel !== -1) {
      csvModelName = (r[idxModel] || "").trim();
    }
    if (!rawColor || color.startsWith("Color ")) {
      unknownColors += 1;
    }
    if (isSpare) {
      spareCount += 1;
      continue;
    }
    if (!partNumber || requiredQty <= 0) continue;

    const key = `${partNumber}__${color}`;
    if (!grouped.has(key)) {
      grouped.set(key, {
        partNumber,
        color,
        requiredQty: 0,
        haveQty: 0,
        ordered: false,
        arrived: false,
        completed: false
      });
    }
    grouped.get(key).requiredQty += requiredQty;
  }

  const parts = [...grouped.values()];
  if (!parts.length) {
    throw new Error("No valid non-spare parts found in the CSV.");
  }

  return {
    mocName: csvModelName || filenameToTitle(fileName),
    sourceFileName: fileName,
    parts,
    stats: {
      groupedEntries: parts.length,
      totalPieces: parts.reduce((sum, p) => sum + p.requiredQty, 0),
      spareCount,
      unknownColors
    },
    sample: parts.slice(0, 8)
  };
}

function brickLinkImageCandidates(partNumber, color) {
  const code = BRICKLINK_COLOR_CODES[color];
  if (!code) return [];
  return [
    `https://img.bricklink.com/ItemImage/PN/${code}/${partNumber}.png`,
    `https://img.bricklink.com/ItemImage/PN/${code}/${partNumber}.jpg`,
    `https://img.bricklink.com/ItemImage/PL/${code}/${partNumber}.png`,
    `https://img.bricklink.com/ItemImage/PL/${code}/${partNumber}.jpg`
  ];
}

function brickLinkSearchUrl(partNumber) {
  return `https://www.bricklink.com/v2/search.page?q=${encodeURIComponent(partNumber)}#T=P`;
}

function brickOwlSearchUrl(partNumber, color) {
  return `https://www.brickowl.com/search/catalog?query=${encodeURIComponent(`${partNumber} ${color}`)}`;
}

function rebrickableSearchUrl(partNumber) {
  return `https://rebrickable.com/parts/?q=${encodeURIComponent(partNumber)}`;
}

function PartImage({ partNumber, color }) {
  const [index, setIndex] = useState(0);
  const candidates = useMemo(() => brickLinkImageCandidates(partNumber, color), [partNumber, color]);

  if (!candidates.length) {
    return (
      <div className="part-image-fallback">
        <div>No image</div>
        <a href={brickOwlSearchUrl(partNumber, color)} target="_blank" rel="noreferrer">Brick Owl</a>
      </div>
    );
  }

  return (
    <img
      className="part-image"
      src={candidates[index]}
      alt={`${partNumber} ${color}`}
      onError={() => {
        if (index < candidates.length - 1) setIndex(index + 1);
      }}
    />
  );
}

function AuthScreen({ onAuthed }) {
  const [mode, setMode] = useState("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function handleSubmit(e) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      if (mode === "signin") await signIn(email, password);
      else await signUp(email, password);
      onAuthed();
    } catch (err) {
      setError(err.message || "Authentication failed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="page centered">
      <div className="panel auth-panel">
        <h1>LEGO MOC Manager</h1>
        <p className="subtitle">Sign in to access your MOCs from anywhere.</p>
        <form onSubmit={handleSubmit} className="stack">
          <label><span>Email</span><input value={email} onChange={(e) => setEmail(e.target.value)} type="email" required /></label>
          <label><span>Password</span><input value={password} onChange={(e) => setPassword(e.target.value)} type="password" required /></label>
          {error ? <div className="error">{error}</div> : null}
          <button className="btn primary" disabled={busy}>
            {busy ? "Please wait..." : mode === "signin" ? "Sign in" : "Create account"}
          </button>
        </form>
        <button className="btn secondary" onClick={() => setMode(mode === "signin" ? "signup" : "signin")}>
          {mode === "signin" ? "Need an account? Sign up" : "Already have an account? Sign in"}
        </button>
      </div>
    </div>
  );
}

function ImportPreviewModal({ preview, onCancel, onConfirm, busy }) {
  const [name, setName] = useState(preview?.mocName || "");
  const [url, setUrl] = useState("");

  useEffect(() => {
    setName(preview?.mocName || "");
    setUrl("");
  }, [preview]);

  if (!preview) return null;

  return (
    <div className="modal-backdrop">
      <div className="modal wide-modal modal-shell">
        <div className="modal-scroll">
          <h3>Import preview</h3>
          <p className="subtitle">Source file: {preview.sourceFileName}</p>

          <div className="stats compact-stats">
            <div className="panel"><div className="stat-label">Grouped entries</div><div className="stat-value small-stat">{preview.stats.groupedEntries}</div></div>
            <div className="panel"><div className="stat-label">Total pieces</div><div className="stat-value small-stat">{preview.stats.totalPieces}</div></div>
            <div className="panel"><div className="stat-label">Ignored spare rows</div><div className="stat-value small-stat">{preview.stats.spareCount}</div></div>
            <div className="panel"><div className="stat-label">Unknown colors</div><div className="stat-value small-stat">{preview.stats.unknownColors}</div></div>
          </div>

          <div className="stack">
            <label><span>MOC title</span><input value={name} onChange={(e) => setName(e.target.value)} required /></label>
            <label><span>MOC URL</span><input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="Optional URL" /></label>

            <div>
              <div className="section-title">Sample imported parts</div>
              <div className="preview-list preview-list-scroll">
                {preview.sample.map((part, idx) => (
                  <div className="preview-item" key={`${part.partNumber}-${part.color}-${idx}`}>
                    {part.partNumber} • {part.color} • Qty {part.requiredQty}
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>

        <div className="modal-actions sticky-actions">
          <button className="btn primary" disabled={busy || !name.trim()} onClick={() => onConfirm({ name, url })}>
            {busy ? "Importing..." : "Create MOC"}
          </button>
          <button className="btn" onClick={onCancel}>Cancel</button>
        </div>
      </div>
    </div>
  );
}

function PartEditorModal({ part, busy, onSave, onCancel }) {
  if (part === null) return null;

  return (
    <div className="modal-backdrop">
      <div className="modal">
        <h3>{part?.id ? "Edit part" : "Add part"}</h3>
        <form
          className="stack"
          onSubmit={(e) => {
            e.preventDefault();
            const form = new FormData(e.currentTarget);
            onSave({
              partNumber: String(form.get("partNumber") || "").trim(),
              color: String(form.get("color") || "").trim(),
              requiredQty: Number(form.get("requiredQty") || 1),
              haveQty: Number(form.get("haveQty") || 0),
              ordered: form.get("ordered") === "on",
              arrived: form.get("arrived") === "on",
              completed: form.get("completed") === "on"
            });
          }}
        >
          <label><span>Part number</span><input name="partNumber" defaultValue={part.part_number || ""} /></label>
          <label><span>Color</span><input name="color" defaultValue={part.color || ""} /></label>
          <label><span>Required quantity</span><input name="requiredQty" type="number" min="1" defaultValue={part.required_qty ?? 1} /></label>
          <label><span>Have quantity</span><input name="haveQty" type="number" min="0" defaultValue={part.have_qty ?? 0} /></label>
          <label className="checkbox"><input name="ordered" type="checkbox" defaultChecked={!!part.ordered} /><span>Ordered</span></label>
          <label className="checkbox"><input name="arrived" type="checkbox" defaultChecked={!!part.arrived} /><span>Arrived</span></label>
          <label className="checkbox"><input name="completed" type="checkbox" defaultChecked={!!part.completed} /><span>Completed</span></label>
          <div className="toolbar">
            <button className="btn primary" disabled={busy}>Save</button>
            <button type="button" className="btn" onClick={onCancel}>Cancel</button>
          </div>
        </form>
      </div>
    </div>
  );
}

function PartTable({ parts, onEdit, onDelete, onPatch }) {
  if (!parts.length) return <div className="muted">No parts here.</div>;

  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            <th>Image</th>
            <th>Part</th>
            <th>Color</th>
            <th>Need</th>
            <th>Have</th>
            <th>Missing</th>
            <th>Ordered</th>
            <th>Arrived</th>
            <th>Completed</th>
            <th>Links</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {parts.map((part) => {
            const missing = Math.max(part.required_qty - part.have_qty, 0);
            return (
              <tr key={part.id}>
                <td className="image-cell"><PartImage partNumber={part.part_number} color={part.color} /></td>
                <td>{part.part_number}</td>
                <td>{part.color}</td>
                <td>{part.required_qty}</td>
                <td>{part.have_qty}</td>
                <td>{missing}</td>
                <td>
                  <input
                    type="checkbox"
                    checked={part.ordered}
                    onChange={(e) => onPatch(part.id, { ordered: e.target.checked, arrived: e.target.checked ? part.arrived : false })}
                  />
                </td>
                <td>
                  <input
                    type="checkbox"
                    checked={part.arrived}
                    disabled={!part.ordered}
                    onChange={(e) => onPatch(part.id, { arrived: e.target.checked })}
                  />
                </td>
                <td>
                  <input
                    type="checkbox"
                    checked={part.completed}
                    onChange={(e) => onPatch(part.id, { completed: e.target.checked })}
                  />
                </td>
                <td className="link-cell">
                  <a href={brickLinkSearchUrl(part.part_number)} target="_blank" rel="noreferrer">BrickLink</a><br />
                  <a href={brickOwlSearchUrl(part.part_number, part.color)} target="_blank" rel="noreferrer">Brick Owl</a><br />
                  <a href={rebrickableSearchUrl(part.part_number)} target="_blank" rel="noreferrer">Rebrickable</a>
                </td>
                <td>
                  <div className="toolbar compact">
                    <button className="btn small" onClick={() => onEdit(part)}>Edit</button>
                    <button className="btn small danger" onClick={() => onDelete(part.id)}>Delete</button>
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function BuyList({ rows, onToggleArrived }) {
  if (!rows.length) {
    return <div className="panel">No ordered parts yet.</div>;
  }

  return (
    <div className="panel">
      <h2>Grouped Buy List</h2>
      <p className="subtitle">Grouped by part + color. Arrival is tracked per MOC line.</p>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Part</th>
              <th>Color</th>
              <th>Total buy qty</th>
              <th>Arrived qty</th>
              <th>Pending qty</th>
              <th>MOC lines</th>
              <th>Links</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={`${row.partNumber}-${row.color}`}>
                <td>{row.partNumber}</td>
                <td>{row.color}</td>
                <td>{row.totalMissing}</td>
                <td>{row.arrivedQty}</td>
                <td>{row.pendingQty}</td>
                <td>
                  {row.lines.map((line) => (
                    <label key={line.partId} className="buy-line">
                      <input
                        type="checkbox"
                        checked={line.arrived}
                        onChange={(e) => onToggleArrived(line.partId, e.target.checked)}
                      />
                      <span>
                        <strong>{line.mocName}</strong> — Qty {line.missing}
                        {line.mocUrl ? <> — <a href={line.mocUrl} target="_blank" rel="noreferrer">URL</a></> : null}
                        <br />
                        <span className="muted">{line.arrived ? "Arrived" : "Pending arrival"}</span>
                      </span>
                    </label>
                  ))}
                </td>
                <td className="link-cell">
                  <a href={brickLinkSearchUrl(row.partNumber)} target="_blank" rel="noreferrer">BrickLink</a><br />
                  <a href={brickOwlSearchUrl(row.partNumber, row.color)} target="_blank" rel="noreferrer">Brick Owl</a><br />
                  <a href={rebrickableSearchUrl(row.partNumber)} target="_blank" rel="noreferrer">Rebrickable</a>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export default function App() {
  const [session, setSession] = useState(null);
  const [loadingSession, setLoadingSession] = useState(true);
  const [mocs, setMocs] = useState([]);
  const [selectedMocId, setSelectedMocId] = useState(null);
  const [parts, setParts] = useState([]);
  const [allParts, setAllParts] = useState([]);
  const [partSearch, setPartSearch] = useState("");
  const [colorFilter, setColorFilter] = useState("All");
  const [showBuyList, setShowBuyList] = useState(false);
  const [editingPart, setEditingPart] = useState(null);
  const [editingMoc, setEditingMoc] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [csvPreview, setCsvPreview] = useState(null);

  const selectedMoc = useMemo(
    () => mocs.find((m) => m.id === selectedMocId) || null,
    [mocs, selectedMocId]
  );

  useEffect(() => {
    let mounted = true;
    getSession()
      .then((s) => { if (mounted) setSession(s); })
      .finally(() => { if (mounted) setLoadingSession(false); });

    const { data } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      setSession(nextSession);
    });

    return () => {
      mounted = false;
      data.subscription.unsubscribe();
    };
  }, []);

  useEffect(() => {
    if (session?.user) {
      refreshMocs();
      refreshAllParts();
    }
  }, [session?.user?.id]);

  useEffect(() => {
    if (selectedMocId) refreshParts(selectedMocId);
    else setParts([]);
  }, [selectedMocId]);

  async function refreshMocs() {
    try {
      const data = await listMocs();
      setMocs(data);
      if (!selectedMocId && data.length) setSelectedMocId(data[0].id);
      if (selectedMocId && !data.find((m) => m.id === selectedMocId)) {
        setSelectedMocId(data[0]?.id ?? null);
      }
    } catch (err) {
      setError(err.message || "Could not load MOCs.");
    }
  }

  async function refreshParts(mocId) {
    try {
      const data = await listMocParts(mocId);
      setParts(data);
    } catch (err) {
      setError(err.message || "Could not load parts.");
    }
  }

  async function refreshAllParts() {
    try {
      const data = await listAllPartsForUser();
      setAllParts(data);
    } catch (err) {
      setError(err.message || "Could not load buy list.");
    }
  }

  async function handleCreateMoc() {
    const name = window.prompt("MOC name:");
    if (!name?.trim()) return;
    const url = window.prompt("Optional MOC URL:") || "";
    try {
      setBusy(true);
      const moc = await createMoc({
        name: name.trim(),
        url: url.trim(),
        sourceFileName: null,
        userId: session.user.id
      });
      await refreshMocs();
      setSelectedMocId(moc.id);
      setShowBuyList(false);
    } catch (err) {
      setError(err.message || "Could not create MOC.");
    } finally {
      setBusy(false);
    }
  }

  async function handleImportCsv(file) {
    try {
      const preview = importRebrickableCSV(file.name, await file.text());
      setCsvPreview(preview);
      setError("");
    } catch (err) {
      setError(err.message || "Could not import CSV.");
    }
  }

  async function confirmImportCsv({ name, url }) {
    if (!csvPreview || !session?.user) return;
    try {
      setBusy(true);
      const moc = await createMoc({
        name: name.trim(),
        url: url.trim(),
        sourceFileName: csvPreview.sourceFileName,
        userId: session.user.id
      });
      for (const part of csvPreview.parts) {
        await createPart(moc.id, part);
      }
      setCsvPreview(null);
      await refreshMocs();
      await refreshAllParts();
      setSelectedMocId(moc.id);
      setShowBuyList(false);
    } catch (err) {
      setError(err.message || "Could not save imported MOC.");
    } finally {
      setBusy(false);
    }
  }

  async function handleDeleteMoc() {
    if (!selectedMoc || !window.confirm(`Delete "${selectedMoc.name}"?`)) return;
    try {
      setBusy(true);
      await deleteMoc(selectedMoc.id);
      await refreshMocs();
      await refreshAllParts();
      setParts([]);
    } catch (err) {
      setError(err.message || "Could not delete MOC.");
    } finally {
      setBusy(false);
    }
  }

  async function handleSaveMocMeta(e) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    try {
      setBusy(true);
      await updateMoc(selectedMoc.id, {
        name: String(form.get("name") || ""),
        url: String(form.get("url") || "")
      });
      await refreshMocs();
      await refreshAllParts();
      setEditingMoc(false);
    } catch (err) {
      setError(err.message || "Could not update MOC.");
    } finally {
      setBusy(false);
    }
  }

  async function handleSavePart(payload) {
    if (!selectedMoc) return;
    if (!payload.partNumber || !payload.color || payload.requiredQty < 1) {
      setError("Part number, color, and required quantity are required.");
      return;
    }
    try {
      setBusy(true);
      if (editingPart?.id) await updatePart(editingPart.id, payload);
      else await createPart(selectedMoc.id, payload);
      await refreshParts(selectedMoc.id);
      await refreshAllParts();
      setEditingPart(null);
    } catch (err) {
      setError(err.message || "Could not save part.");
    } finally {
      setBusy(false);
    }
  }

  async function handleDeletePart(id) {
    if (!window.confirm("Delete this part?")) return;
    try {
      setBusy(true);
      await deletePart(id);
      await refreshParts(selectedMoc.id);
      await refreshAllParts();
    } catch (err) {
      setError(err.message || "Could not delete part.");
    } finally {
      setBusy(false);
    }
  }

  async function patchPart(id, patch) {
    try {
      setBusy(true);
      await updatePart(id, patch);
      await refreshParts(selectedMoc.id);
      await refreshAllParts();
    } catch (err) {
      setError(err.message || "Could not update part.");
    } finally {
      setBusy(false);
    }
  }

  const filteredParts = useMemo(() => {
    return parts.filter((p) => {
      const matchesSearch = !partSearch ||
        p.part_number.toLowerCase().includes(partSearch.toLowerCase()) ||
        p.color.toLowerCase().includes(partSearch.toLowerCase());
      const matchesColor = colorFilter === "All" || p.color === colorFilter;
      return matchesSearch && matchesColor;
    });
  }, [parts, partSearch, colorFilter]);

  const activeParts = filteredParts.filter((p) => !p.completed && !(p.ordered && p.required_qty - p.have_qty > 0));
  const orderedParts = filteredParts.filter((p) => !p.completed && p.ordered && p.required_qty - p.have_qty > 0);
  const completedParts = filteredParts.filter((p) => p.completed);
  const colors = [...new Set(parts.map((p) => p.color))].sort();

  const groupedBuyList = useMemo(() => {
    const grouped = new Map();
    for (const part of allParts) {
      const missing = Math.max(part.required_qty - part.have_qty, 0);
      if (!part.ordered || part.completed || missing <= 0) continue;
      const key = `${part.part_number}__${part.color}`;
      if (!grouped.has(key)) {
        grouped.set(key, {
          partNumber: part.part_number,
          color: part.color,
          totalMissing: 0,
          arrivedQty: 0,
          pendingQty: 0,
          lines: []
        });
      }
      const row = grouped.get(key);
      row.totalMissing += missing;
      if (part.arrived) row.arrivedQty += missing;
      else row.pendingQty += missing;
      row.lines.push({
        partId: part.id,
        mocName: part.mocs?.name || "MOC",
        mocUrl: part.mocs?.url || "",
        missing,
        arrived: !!part.arrived
      });
    }
    return [...grouped.values()].sort((a, b) =>
      a.partNumber.localeCompare(b.partNumber) || a.color.localeCompare(b.color)
    );
  }, [allParts]);

  if (loadingSession) {
    return <div className="page centered"><div className="panel">Loading…</div></div>;
  }

  if (!session?.user) {
    return <AuthScreen onAuthed={async () => setSession(await getSession())} />;
  }

  return (
    <div className="page">
      <header className="header">
        <div>
          <h1>LEGO MOC Manager</h1>
          <p className="subtitle">Hosted React version with grouped buy list, CSV import preview, and part images.</p>
        </div>
        <div className="toolbar">
          <button className="btn" onClick={() => setShowBuyList(false)}>Dashboard</button>
          <button className="btn" onClick={() => setShowBuyList(true)}>Buy List</button>
          <button className="btn primary" onClick={handleCreateMoc} disabled={busy}>New MOC</button>
          <label className="btn">
            Import CSV
            <input
              type="file"
              accept=".csv,text/csv"
              style={{ display: "none" }}
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) handleImportCsv(file);
                e.target.value = "";
              }}
            />
          </label>
          <button className="btn" onClick={() => signOut()}>Sign out</button>
        </div>
      </header>

      {error ? <div className="error-banner">{error}</div> : null}

      {!showBuyList ? (
        <div className="layout">
          <aside className="sidebar panel">
            <div className="sidebar-header"><h2>MOCs</h2></div>
            <div className="stack">
              {mocs.map((moc) => (
                <button
                  key={moc.id}
                  className={`moc-item ${moc.id === selectedMocId ? "selected" : ""}`}
                  onClick={() => setSelectedMocId(moc.id)}
                >
                  <strong>{moc.name}</strong>
                  <span>{moc.source_file_name || "Manual MOC"}</span>
                </button>
              ))}
              {!mocs.length ? <div className="muted">No MOCs yet.</div> : null}
            </div>
          </aside>

          <main className="content">
            {selectedMoc ? (
              <>
                <div className="panel">
                  <div className="row-between">
                    <div>
                      <h2>{selectedMoc.name}</h2>
                      <div className="muted">
                        {selectedMoc.url ? (
                          <a href={selectedMoc.url} target="_blank" rel="noreferrer">Open MOC URL</a>
                        ) : "No URL set"}
                      </div>
                    </div>
                    <div className="toolbar">
                      <button className="btn" onClick={() => setEditingMoc((v) => !v)}>Edit MOC</button>
                      <button className="btn danger" onClick={handleDeleteMoc} disabled={busy}>Delete MOC</button>
                    </div>
                  </div>

                  {editingMoc ? (
                    <form className="stack" onSubmit={handleSaveMocMeta}>
                      <label><span>Name</span><input name="name" defaultValue={selectedMoc.name} /></label>
                      <label><span>URL</span><input name="url" defaultValue={selectedMoc.url || ""} /></label>
                      <div className="toolbar">
                        <button className="btn primary" disabled={busy}>Save MOC</button>
                        <button type="button" className="btn" onClick={() => setEditingMoc(false)}>Cancel</button>
                      </div>
                    </form>
                  ) : null}
                </div>

                <div className="panel">
                  <div className="row-between">
                    <h3>Parts</h3>
                    <button className="btn primary" onClick={() => setEditingPart({})}>Add part</button>
                  </div>

                  <div className="filters">
                    <input
                      className="search"
                      placeholder="Search by part number or color"
                      value={partSearch}
                      onChange={(e) => setPartSearch(e.target.value)}
                    />
                    <select value={colorFilter} onChange={(e) => setColorFilter(e.target.value)}>
                      <option value="All">All colors</option>
                      {colors.map((color) => <option key={color} value={color}>{color}</option>)}
                    </select>
                  </div>

                  <div className="section-block">
                    <h3>Active</h3>
                    <PartTable parts={activeParts} onEdit={setEditingPart} onDelete={handleDeletePart} onPatch={patchPart} />
                  </div>

                  <div className="section-block">
                    <h3>Ordered / Arriving</h3>
                    <PartTable parts={orderedParts} onEdit={setEditingPart} onDelete={handleDeletePart} onPatch={patchPart} />
                  </div>

                  <div className="section-block">
                    <h3>Completed</h3>
                    <PartTable parts={completedParts} onEdit={setEditingPart} onDelete={handleDeletePart} onPatch={patchPart} />
                  </div>
                </div>
              </>
            ) : (
              <div className="panel">Create or import a MOC to get started.</div>
            )}
          </main>
        </div>
      ) : (
        <BuyList
          rows={groupedBuyList}
          onToggleArrived={(partId, arrived) => patchPart(partId, { arrived })}
        />
      )}

      <PartEditorModal
        part={editingPart}
        busy={busy}
        onSave={handleSavePart}
        onCancel={() => setEditingPart(null)}
      />

      <ImportPreviewModal
        preview={csvPreview}
        busy={busy}
        onCancel={() => setCsvPreview(null)}
        onConfirm={confirmImportCsv}
      />
    </div>
  );
}
