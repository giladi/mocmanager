import React, { useEffect, useMemo, useState } from "react";
import {
  addPartToOrder, createMoc, createOrder, createPart, deleteMoc, deleteOrder, deletePart,
  getSession, listAllPartsForUser, listMocParts, listMocs, listOrders, removePartFromOrder,
  signIn, signOut, signUp, updateMoc, updateOrder, updateOrderItem, updatePart
} from "./lib/api";
import { supabase } from "./lib/supabase";

const REBRICKABLE_COLOR_MAP = {"0":"Black","1":"Blue","2":"Tan","4":"Orange","14":"Yellow","15":"White","19":"Trans Green","25":"Orange","34":"Lime","36":"Bright Green","40":"Trans Clear","41":"Trans Red","47":"Trans Yellow","71":"Light Bluish Gray","72":"Dark Bluish Gray","73":"Medium Blue","179":"Flat Silver","182":"Trans Orange","272":"Dark Blue","484":"Dark Orange","9999":"Unknown"};
const BRICKLINK_COLOR_CODES = {"White":1,"Yellow":3,"Red":5,"Blue":7,"Black":11,"Tan":2,"Orange":4,"Lime":34,"Bright Green":36,"Trans Clear":12,"Trans Red":41,"Trans Yellow":46,"Trans Green":20,"Light Bluish Gray":86,"Dark Bluish Gray":85,"Medium Blue":42,"Dark Blue":63,"Dark Orange":68,"Flat Silver":95};

const brickLinkSearchUrl = (partNumber) => `https://www.bricklink.com/v2/search.page?q=${encodeURIComponent(partNumber)}#T=P`;
const brickOwlSearchUrl = (partNumber, color) => `https://www.brickowl.com/search/catalog?query=${encodeURIComponent(`${partNumber} ${color}`)}`;
const rebrickableSearchUrl = (partNumber) => `https://rebrickable.com/parts/?q=${encodeURIComponent(partNumber)}`;

function imageCandidates(partNumber, color) {
  const code = BRICKLINK_COLOR_CODES[color];
  if (!code) return [];
  return [
    `https://img.bricklink.com/ItemImage/PN/${code}/${partNumber}.png`,
    `https://img.bricklink.com/ItemImage/PN/${code}/${partNumber}.jpg`,
    `https://img.bricklink.com/ItemImage/PL/${code}/${partNumber}.png`,
    `https://img.bricklink.com/ItemImage/PL/${code}/${partNumber}.jpg`,
  ];
}
function PartImage({ partNumber, color }) {
  const candidates = useMemo(() => imageCandidates(partNumber, color), [partNumber, color]);
  const [index, setIndex] = useState(0);
  const [failed, setFailed] = useState(candidates.length === 0);
  useEffect(() => { setIndex(0); setFailed(candidates.length === 0); }, [partNumber, color, candidates.length]);
  if (failed) return <div className="part-image-fallback"><div>No image</div></div>;
  return <img className="part-image" src={candidates[index]} alt={`${partNumber} ${color}`} onError={() => {
    if (index < candidates.length - 1) setIndex(i => i + 1); else setFailed(true);
  }} />;
}

function parseCSV(text) {
  const rows = []; let row = []; let field = ""; let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const char = text[i], next = text[i + 1];
    if (char === '"') {
      if (inQuotes && next === '"') { field += '"'; i++; } else inQuotes = !inQuotes;
    } else if (char === "," && !inQuotes) {
      row.push(field); field = "";
    } else if ((char === "\n" || char === "\r") && !inQuotes) {
      if (char === "\r" && next === "\n") i++;
      row.push(field); if (row.some(c => c !== "")) rows.push(row); row = []; field = "";
    } else field += char;
  }
  if (field.length > 0 || row.length > 0) { row.push(field); if (row.some(c => c !== "")) rows.push(row); }
  return rows;
}
const normalizeHeader = (h) => (h || "").trim().toLowerCase().replace(/\s+/g, " ");
function decodeRebrickableColor(value) {
  const key = String(value || "").trim();
  if (!key) return "Unknown";
  if (/^[A-Za-z]/.test(key)) return key;
  return REBRICKABLE_COLOR_MAP[key] || `Color ${key}`;
}
function filenameToTitle(fileName) {
  const base = fileName.replace(/\.[^/.]+$/, "").trim();
  const cleaned = base.replace(/^rebrickable_parts_/, "").replace(/^\d+-\d+-/, "").replace(/^\d+-/, "").replace(/[_-]+/g, " ").trim();
  return (cleaned || base || "Imported MOC").replace(/\b\w/g, c => c.toUpperCase());
}
function importRebrickableCSV(fileName, text) {
  const rows = parseCSV(text);
  if (!rows.length) throw new Error("CSV appears to be empty.");
  const headers = rows[0].map(normalizeHeader);
  const idxPart = headers.findIndex(h => ["part","part num","part_num","part number"].includes(h));
  const idxColor = headers.findIndex(h => ["color","color name","color_name"].includes(h));
  const idxQty = headers.findIndex(h => ["quantity","qty"].includes(h));
  const idxModel = headers.findIndex(h => ["model","moc","set","name"].includes(h));
  const idxSpare = headers.findIndex(h => ["is spare","spare","is_spare"].includes(h));
  if (idxPart === -1 || idxColor === -1 || idxQty === -1) throw new Error("Could not find required CSV columns.");
  const grouped = new Map(); let csvModelName = ""; let spareCount = 0; let unknownColors = 0;
  for (let i = 1; i < rows.length; i++) {
    const r = rows[i];
    const partNumber = (r[idxPart] || "").trim();
    const rawColor = (r[idxColor] || "").trim();
    const color = decodeRebrickableColor(rawColor);
    const requiredQty = parseInt((r[idxQty] || "0").trim(), 10) || 0;
    const spareValue = idxSpare !== -1 ? String(r[idxSpare] || "").trim().toLowerCase() : "";
    const isSpare = ["true","1","yes"].includes(spareValue);
    if (!csvModelName && idxModel !== -1) csvModelName = (r[idxModel] || "").trim();
    if (!rawColor || color.startsWith("Color ")) unknownColors += 1;
    if (isSpare) { spareCount += 1; continue; }
    if (!partNumber || requiredQty <= 0) continue;
    const key = `${partNumber}__${color}`;
    if (!grouped.has(key)) grouped.set(key, { partNumber, color, requiredQty: 0, haveQty: 0, ordered: false, arrived: false, completed: false });
    grouped.get(key).requiredQty += requiredQty;
  }
  const parts = [...grouped.values()];
  return { mocName: csvModelName || filenameToTitle(fileName), sourceFileName: fileName, parts, stats: { groupedEntries: parts.length, totalPieces: parts.reduce((s,p)=>s+p.requiredQty,0), spareCount, unknownColors }, sample: parts.slice(0,8) };
}

function AuthScreen({ onAuthed }) {
  const [mode, setMode] = useState("signin"), [email, setEmail] = useState(""), [password, setPassword] = useState(""), [busy, setBusy] = useState(false), [error, setError] = useState("");
  async function handleSubmit(e) {
    e.preventDefault(); setBusy(true); setError("");
    try { if (mode === "signin") await signIn(email, password); else await signUp(email, password); onAuthed(); }
    catch (err) { setError(err.message || "Authentication failed."); }
    finally { setBusy(false); }
  }
  return <div className="page centered"><div className="panel auth-panel"><h1>LEGO MOC Manager</h1><p className="subtitle">Sign in to access your MOCs from anywhere.</p>
    <form onSubmit={handleSubmit} className="stack">
      <label><span>Email</span><input value={email} onChange={(e)=>setEmail(e.target.value)} type="email" required /></label>
      <label><span>Password</span><input value={password} onChange={(e)=>setPassword(e.target.value)} type="password" required /></label>
      {error ? <div className="error">{error}</div> : null}
      <button className="btn primary" disabled={busy}>{busy ? "Please wait..." : mode === "signin" ? "Sign in" : "Create account"}</button>
    </form>
    <button className="btn secondary" onClick={()=>setMode(mode === "signin" ? "signup" : "signin")}>{mode === "signin" ? "Need an account? Sign up" : "Already have an account? Sign in"}</button>
  </div></div>;
}

function ModalShell({ children, wide=false }) {
  return <div className="modal-backdrop"><div className={`modal ${wide ? "wide-modal" : ""}`}>{children}</div></div>;
}

function ImportPreviewModal({ preview, onCancel, onConfirm, busy }) {
  const [name, setName] = useState(preview?.mocName || ""), [url, setUrl] = useState("");
  useEffect(() => { setName(preview?.mocName || ""); setUrl(""); }, [preview]);
  if (!preview) return null;
  return <div className="modal-backdrop"><div className="modal wide-modal modal-shell"><div className="modal-scroll">
    <h3>Import preview</h3><p className="subtitle">Source file: {preview.sourceFileName}</p>
    <div className="stats compact-stats">
      <div className="panel"><div className="stat-label">Grouped entries</div><div className="stat-value small-stat">{preview.stats.groupedEntries}</div></div>
      <div className="panel"><div className="stat-label">Total pieces</div><div className="stat-value small-stat">{preview.stats.totalPieces}</div></div>
      <div className="panel"><div className="stat-label">Ignored spare rows</div><div className="stat-value small-stat">{preview.stats.spareCount}</div></div>
      <div className="panel"><div className="stat-label">Unknown colors</div><div className="stat-value small-stat">{preview.stats.unknownColors}</div></div>
    </div>
    <div className="stack">
      <label><span>MOC title</span><input value={name} onChange={(e)=>setName(e.target.value)} required /></label>
      <label><span>MOC URL</span><input value={url} onChange={(e)=>setUrl(e.target.value)} placeholder="Optional URL" /></label>
      <div><div className="section-title">Sample imported parts</div><div className="preview-list preview-list-scroll">
        {preview.sample.map((part, idx) => <div className="preview-item" key={`${part.partNumber}-${part.color}-${idx}`}>{part.partNumber} • {part.color} • Qty {part.requiredQty}</div>)}
      </div></div>
    </div>
  </div><div className="modal-actions sticky-actions">
    <button className="btn primary" disabled={busy || !name.trim()} onClick={() => onConfirm({ name, url })}>{busy ? "Importing..." : "Create MOC"}</button>
    <button className="btn" onClick={onCancel}>Cancel</button>
  </div></div></div>;
}

function PartEditorModal({ part, busy, onSave, onCancel }) {
  if (part === null) return null;
  return <ModalShell><h3>{part?.id ? "Edit part" : "Add part"}</h3>
    <form className="stack" onSubmit={(e)=>{ e.preventDefault(); const f=new FormData(e.currentTarget); onSave({
      partNumber:String(f.get("partNumber")||"").trim(), color:String(f.get("color")||"").trim(),
      requiredQty:Number(f.get("requiredQty")||1), haveQty:Number(f.get("haveQty")||0),
      ordered:f.get("ordered")==="on", arrived:f.get("arrived")==="on", completed:f.get("completed")==="on"
    }); }}>
      <label><span>Part number</span><input name="partNumber" defaultValue={part.part_number || ""} /></label>
      <label><span>Color</span><input name="color" defaultValue={part.color || ""} /></label>
      <label><span>Required quantity</span><input name="requiredQty" type="number" min="1" defaultValue={part.required_qty ?? 1} /></label>
      <label><span>Have quantity</span><input name="haveQty" type="number" min="0" defaultValue={part.have_qty ?? 0} /></label>
      <label className="checkbox"><input name="ordered" type="checkbox" defaultChecked={!!part.ordered} /><span>Ordered</span></label>
      <label className="checkbox"><input name="arrived" type="checkbox" defaultChecked={!!part.arrived} /><span>Arrived</span></label>
      <label className="checkbox"><input name="completed" type="checkbox" defaultChecked={!!part.completed} /><span>Completed</span></label>
      <div className="toolbar"><button className="btn primary" disabled={busy}>Save</button><button type="button" className="btn" onClick={onCancel}>Cancel</button></div>
    </form>
  </ModalShell>;
}

function OrderEditorModal({ order, busy, onSave, onCancel, onDelete }) {
  if (order === null) return null;
  return <ModalShell><h3>{order?.id ? "Edit order" : "Create order"}</h3>
    <form className="stack" onSubmit={(e)=>{ e.preventDefault(); const f=new FormData(e.currentTarget); onSave({
      name:String(f.get("name")||"").trim(), vendor:String(f.get("vendor")||"").trim(), orderDate:String(f.get("orderDate")||""),
      trackingNumber:String(f.get("trackingNumber")||"").trim(), notes:String(f.get("notes")||"").trim(), status:String(f.get("status")||"draft")
    }); }}>
      <label><span>Name</span><input name="name" defaultValue={order.name || ""} required /></label>
      <label><span>Vendor</span><input name="vendor" defaultValue={order.vendor || ""} /></label>
      <label><span>Order date</span><input name="orderDate" type="date" defaultValue={order.order_date || ""} /></label>
      <label><span>Tracking number</span><input name="trackingNumber" defaultValue={order.tracking_number || ""} /></label>
      <label><span>Status</span><select name="status" defaultValue={order.status || "draft"}>
        <option value="draft">Draft</option><option value="placed">Placed</option><option value="in_transit">In transit</option><option value="completed">Completed</option>
      </select></label>
      <label><span>Notes</span><input name="notes" defaultValue={order.notes || ""} /></label>
      <div className="toolbar"><button className="btn primary" disabled={busy}>Save order</button>{order?.id ? <button type="button" className="btn danger" onClick={()=>onDelete(order.id)}>Delete</button> : null}<button type="button" className="btn" onClick={onCancel}>Cancel</button></div>
    </form>
  </ModalShell>;
}


function OrderDetailsModal({ order, lines, selectedIds, onToggleSelected, onSelectAll, onClearSelection, onClose, onOpenMoc, onRemoveLine, onRemoveSelected, onPatchArrived, onPatchManyArrived, onUpdateOrderLine }) {
  if (!order) return null;
  const totalQty = lines.reduce((sum, line) => sum + (line.qtyOrdered || 0), 0);
  const arrivedQty = lines.reduce((sum, line) => sum + Math.min(line.qtyArrived || 0, line.qtyOrdered || 0), 0);
  const pendingQty = totalQty - arrivedQty;

  return (
    <div className="modal-backdrop">
      <div className="modal wide-modal modal-shell">
        <div className="modal-scroll">
          <div className="row-between modal-sticky-header">
            <div>
              <h3>{order.name}</h3>
              <div className="muted">{order.vendor || "No vendor"} • {order.status}</div>
              <div className="muted">{order.order_date || "No date"}{order.tracking_number ? ` • ${order.tracking_number}` : ""}</div>
              <div className="muted">{order.notes || "No notes"}</div>
            </div>
            <button className="btn" onClick={onClose}>Close</button>
          </div>

          <div className="order-summary-grid">
            <div className="panel"><div className="stat-label">Lines</div><div className="stat-value small-stat">{lines.length}</div></div>
            <div className="panel"><div className="stat-label">Ordered qty</div><div className="stat-value small-stat">{totalQty}</div></div>
            <div className="panel"><div className="stat-label">Arrived qty</div><div className="stat-value small-stat">{arrivedQty}</div></div>
            <div className="panel"><div className="stat-label">Pending qty</div><div className="stat-value small-stat">{pendingQty}</div></div>
          </div>

          <div className="section-block">
            <div className="row-between">
              <h3>Assigned lines</h3>
              <div className="bulk-bar">
                <div className="muted">{selectedIds.length} selected</div>
                <button className="btn" onClick={onSelectAll}>Select all</button>
                <button className="btn" onClick={onClearSelection} disabled={!selectedIds.length}>Clear</button>
                <button className="btn" onClick={onPatchManyArrived(true)} disabled={!selectedIds.length}>Mark selected arrived</button>
                <button className="btn" onClick={onPatchManyArrived(false)} disabled={!selectedIds.length}>Mark selected pending</button>
                <button className="btn danger" onClick={onRemoveSelected} disabled={!selectedIds.length}>Remove selected</button>
              </div>
            </div>

            {!lines.length ? <div className="muted">No lines assigned to this order.</div> : (
              <div className="table-wrap order-lines-wrap">
                <table>
                  <thead><tr><th></th><th>MOC</th><th>Part</th><th>Color</th><th>Ordered</th><th>Arrived</th><th>Status</th><th>Vendor SKU</th><th>Substitution / Note</th><th></th></tr></thead>
                  <tbody>
                    {lines.map((line) => (
                      <tr key={line.partId}>
                        <td><input type="checkbox" checked={selectedIds.includes(line.partId)} onChange={(e) => onToggleSelected(line.partId, e.target.checked)} /></td>
                        <td><button className="link-button" onClick={() => onOpenMoc(line.mocId)}>{line.mocName}</button></td>
                        <td>{line.partNumber}</td>
                        <td>{line.color}</td>
                        <td><input className="inline-number" type="number" min="0" value={line.qtyOrdered} onChange={(e) => onUpdateOrderLine(line.partId, { qtyOrdered: Math.max(0, Number(e.target.value || 0)) })} /></td>
                        <td><input className="inline-number" type="number" min="0" value={line.qtyArrived} onChange={(e) => onUpdateOrderLine(line.partId, { qtyArrived: Math.max(0, Number(e.target.value || 0)) })} /></td>
                        <td>
                          <select value={line.lineStatus} onChange={(e) => onUpdateOrderLine(line.partId, { lineStatus: e.target.value })}>
                            <option value="ordered">Ordered</option>
                            <option value="in_transit">In transit</option>
                            <option value="partial_arrived">Partial arrived</option>
                            <option value="arrived">Arrived</option>
                            <option value="cancelled">Cancelled</option>
                            <option value="substituted">Substituted</option>
                          </select>
                        </td>
                        <td><input value={line.vendorSku} onChange={(e) => onUpdateOrderLine(line.partId, { vendorSku: e.target.value })} placeholder="Optional" /></td>
                        <td><input value={line.substitutionNote} onChange={(e) => onUpdateOrderLine(line.partId, { substitutionNote: e.target.value })} placeholder="Optional note" /></td>
                        <td><button className="btn small danger" onClick={() => onRemoveLine(order.id, line.partId)}>Remove</button></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
function PartTable({ parts, onEdit, onDelete, onPatch }) {
  if (!parts.length) return <div className="muted">No parts here.</div>;
  return <div className="table-wrap"><table><thead><tr><th>Image</th><th>Part</th><th>Color</th><th>Need</th><th>Have</th><th>Missing</th><th>Ordered</th><th>Arrived</th><th>Completed</th><th></th></tr></thead><tbody>
    {parts.map((part) => {
      const missing = Math.max(part.required_qty - part.have_qty, 0);
      return <tr key={part.id}>
        <td className="image-cell"><PartImage partNumber={part.part_number} color={part.color} /></td>
        <td><div className="part-number-cell">{part.part_number}</div></td>
        <td>{part.color}</td><td>{part.required_qty}</td>
        <td><input className="inline-number" type="number" min="0" value={part.have_qty} onChange={(e)=>onPatch(part.id, { haveQty: Math.max(0, Number(e.target.value || 0)) })} /></td>
        <td>{missing}</td>
        <td><input type="checkbox" checked={part.ordered} onChange={(e)=>onPatch(part.id, { ordered:e.target.checked, arrived:e.target.checked ? part.arrived : false })} /></td>
        <td><input type="checkbox" checked={part.arrived} disabled={!part.ordered} onChange={(e)=>onPatch(part.id, { arrived:e.target.checked })} /></td>
        <td><input type="checkbox" checked={part.completed} onChange={(e)=>onPatch(part.id, { completed:e.target.checked })} /></td>
        <td><div className="toolbar compact"><button className="btn small" onClick={()=>onEdit(part)}>Edit</button><button className="btn small danger" onClick={()=>onDelete(part.id)}>Delete</button></div></td>
      </tr>;
    })}
  </tbody></table></div>;
}

function groupBuyRows(allParts, orderedState, mocFilterId, ordersByPartId) {
  const grouped = new Map();
  for (const part of allParts) {
    const missing = Math.max(part.required_qty - part.have_qty, 0);
    if (part.completed || missing <= 0) continue;
    if (orderedState === "to_order" && part.ordered) continue;
    if (orderedState === "ordered" && !part.ordered) continue;
    const belongsToFilteredMoc = !mocFilterId || part.mocs?.id === mocFilterId;
    const key = `${part.part_number}__${part.color}`;
    if (!grouped.has(key)) grouped.set(key, { partNumber: part.part_number, color: part.color, totalMissing: 0, arrivedQty: 0, pendingQty: 0, lines: [], matchesFilter: false });
    const row = grouped.get(key);
    row.totalMissing += missing;
    if (part.arrived) row.arrivedQty += missing; else row.pendingQty += missing;
    if (belongsToFilteredMoc) row.matchesFilter = true;
    row.lines.push({
      partId: part.id, mocId: part.mocs?.id || "", mocName: part.mocs?.name || "MOC", mocUrl: part.mocs?.url || "",
      partNumber: part.part_number, color: part.color,
      missing, ordered: !!part.ordered, arrived: !!part.arrived, belongsToFilteredMoc,
      orderName: ordersByPartId[part.id]?.name || "", orderId: ordersByPartId[part.id]?.id || ""
    });
  }
  const rows = [...grouped.values()].filter((row)=>!mocFilterId || row.matchesFilter).sort((a,b)=>a.partNumber.localeCompare(b.partNumber) || a.color.localeCompare(b.color));
  rows.forEach((row)=>row.lines.sort((a,b)=>{ if (a.belongsToFilteredMoc !== b.belongsToFilteredMoc) return a.belongsToFilteredMoc ? -1 : 1; return a.mocName.localeCompare(b.mocName); }));
  return rows;
}

function BuyListSection({ title, subtitle, rows, mode, mocFilterId, orders, selectedIds, selectedOrderId, onToggleSelected, onSelectRow, onSelectAllVisible, onAssignSelectedToOrder, onRemoveSelectedFromOrder, onQuickAssignLine, onPatch, onPatchMany, onOpenMoc }) {
  return <div className="panel"><h2>{title}</h2><p className="subtitle">{subtitle}</p>
    {mode === "ordered" ? <div className="bulk-bar">
      <div className="muted">{selectedIds.length} selected</div>
      <button className="btn" onClick={() => onSelectAllVisible(rows, true)}>Select all visible</button>
      <button className="btn" onClick={() => onSelectAllVisible(rows, false)} disabled={!selectedIds.length}>Clear visible</button>
      <select value={selectedOrderId} onChange={(e) => onAssignSelectedToOrder("set_order_picker", e.target.value)}>
        <option value="">Choose order for selected</option>
        {orders.map((order) => <option key={order.id} value={order.id}>{order.name}</option>)}
      </select>
      <button className="btn" onClick={() => onAssignSelectedToOrder("assign_selected", selectedOrderId)} disabled={!selectedIds.length || !selectedOrderId}>Assign selected to order</button>
      <button className="btn" onClick={onRemoveSelectedFromOrder} disabled={!selectedIds.length}>Remove selected from order</button>
    </div> : null}
    {!rows.length ? <div className="muted">Nothing here right now.</div> : <div className="table-wrap"><table><thead><tr><th>Part</th><th>Color</th><th>Total qty</th><th>Arrived qty</th><th>Pending qty</th><th>MOC lines</th></tr></thead><tbody>
      {rows.map((row)=>{ const allIds = row.lines.map((line)=>line.partId); return <tr key={`${mode}-${row.partNumber}-${row.color}`}>
        <td><div className="part-number-cell">{row.partNumber}</div><div className="group-actions">
          {mode === "to_order" ? <>
            <button className="btn small" onClick={()=>onPatchMany(allIds, { ordered:true, arrived:false })}>Order all</button>
            <button className="btn small" onClick={()=>onPatchMany(allIds, { ordered:false, arrived:false })}>Clear all</button>
          </> : <>
            <button className="btn small" onClick={() => onSelectRow(allIds, true)}>Select all</button>
            <button className="btn small" onClick={() => onSelectRow(allIds, false)}>Clear select</button>
            <button className="btn small" onClick={()=>onPatchMany(allIds, { arrived:true })}>Mark all arrived</button>
            <button className="btn small" onClick={()=>onPatchMany(allIds, { ordered:false, arrived:false })}>Back all to To Order</button>
          </>}
        </div></td>
        <td>{row.color}</td><td>{row.totalMissing}</td><td>{row.arrivedQty}</td><td>{row.pendingQty}</td>
        <td className="moc-lines-cell">
          {row.lines.map((line)=> <div key={line.partId} className={`buy-line ${line.belongsToFilteredMoc ? "buy-line-focus" : ""}`}>
            <div className="buy-line-checkbox">
              {mode === "to_order" ? <input type="checkbox" checked={line.ordered} onChange={(e)=>onPatch(line.partId, { ordered:e.target.checked, arrived:false })} /> :
              <div className="buy-line-actions">
                <input type="checkbox" checked={selectedIds.includes(line.partId)} onChange={(e)=>onToggleSelected(line.partId, e.target.checked)} />
                <input type="checkbox" checked={line.arrived} onChange={(e)=>onPatch(line.partId, { arrived:e.target.checked })} />
                <button className="btn small" onClick={()=>onPatch(line.partId, { ordered:false, arrived:false })}>Back to To Order</button>
              </div>}
            </div>
            <div className="buy-line-text">
              <div className="buy-line-title"><button className="link-button" onClick={()=>onOpenMoc(line.mocId)}>{line.mocName}</button><span> — Qty {line.missing}</span>{line.mocUrl ? <> — <a href={line.mocUrl} target="_blank" rel="noreferrer">URL</a></> : null}</div>
              <div className="muted">{mode === "to_order" ? (line.ordered ? "Marked as ordered" : "Still to order") : (line.arrived ? "Arrived" : "Pending arrival")}{mocFilterId && !line.belongsToFilteredMoc ? " • also needed by another MOC" : ""}{line.orderName ? ` • ${line.orderName}` : ""}</div>
              {mode === "ordered" ? <div className="inline-order-assign">
                <select value={line.orderId || ""} onChange={(e) => onQuickAssignLine(line.partId, line.orderId, e.target.value)}>
                  <option value="">No order</option>
                  {orders.map((order) => <option key={order.id} value={order.id}>{order.name}</option>)}
                </select>
              </div> : null}
            </div>
          </div>)}
        </td>
      </tr>;})}
    </tbody></table></div>}
  </div>;
}


function OrdersPanel({ orders, groupedBuyRows, onOpenOrderEditor, onOpenOrderDetails, metricsByOrderId }) {
  return <div className="panel">
    <div className="row-between"><h2>Orders</h2><button className="btn primary" onClick={() => onOpenOrderEditor({ status:"draft" })}>Create order</button></div>
    <p className="subtitle">Orders page is summary-focused. Open an order to inspect its assigned lines.</p>
    {!orders.length ? <div className="muted">No orders yet.</div> : <div className="orders-grid">{orders.map((order) => {
      const metrics = metricsByOrderId[order.id] || { lines: 0, totalQty: 0, arrivedQty: 0, pendingQty: 0, allArrived: false };
      return <div key={order.id} className="order-card">
        <div className="row-between">
          <div>
            <div className="order-title">{order.name}</div>
            <div className="muted">{order.vendor || "No vendor"} • {order.status}</div>
          </div>
          <button className="btn small" onClick={() => onOpenOrderEditor(order)}>Edit</button>
        </div>
        <div className="muted order-meta">{order.order_date || "No date"}{order.tracking_number ? ` • ${order.tracking_number}` : ""}</div>
        <div className="muted order-meta">{order.notes || "No notes"}</div>
        <div className="order-metrics">
          <div><strong>{metrics.lines}</strong> lines</div>
          <div><strong>{metrics.totalQty}</strong> total qty</div>
          <div><strong>{metrics.arrivedQty}</strong> arrived</div>
          <div><strong>{metrics.pendingQty}</strong> pending</div>
        </div>
        {metrics.allArrived && metrics.lines > 0 ? <div className="success-hint">All assigned lines arrived</div> : null}
        <div className="toolbar"><button className="btn small" onClick={() => onOpenOrderDetails(order)}>View details</button></div>
      </div>;
    })}</div>}
    <div className="section-block">
      <h3>Unassigned ordered lines</h3>
      {groupedBuyRows.length ? <div className="muted">Use the Buy List to bulk-assign or per-line assign ordered items to orders.</div> : <div className="muted">No ordered lines right now.</div>}
    </div>
  </div>;
}
export default function App() {
  const [session, setSession] = useState(null), [loadingSession, setLoadingSession] = useState(true), [mocs, setMocs] = useState([]), [selectedMocId, setSelectedMocId] = useState(null), [parts, setParts] = useState([]), [allParts, setAllParts] = useState([]), [orders, setOrders] = useState([]), [partSearch, setPartSearch] = useState(""), [colorFilter, setColorFilter] = useState("All"), [sortField, setSortField] = useState("part"), [sortDir, setSortDir] = useState("asc"), [showBuyList, setShowBuyList] = useState(false), [showOrders, setShowOrders] = useState(false), [buyListMocFilter, setBuyListMocFilter] = useState("all"), [editingPart, setEditingPart] = useState(null), [editingMoc, setEditingMoc] = useState(false), [editingOrder, setEditingOrder] = useState(null), [viewingOrder, setViewingOrder] = useState(null), [busy, setBusy] = useState(false), [error, setError] = useState(""), [csvPreview, setCsvPreview] = useState(null), [selectedOrderedIds, setSelectedOrderedIds] = useState([]), [selectedOrderId, setSelectedOrderId] = useState(""), [selectedOrderDetailIds, setSelectedOrderDetailIds] = useState([]);
  const selectedMoc = useMemo(() => mocs.find((m) => m.id === selectedMocId) || null, [mocs, selectedMocId]);

  const ordersByPartId = useMemo(() => {
  const map = {};
  for (const order of orders) {
    for (const item of order.order_items || []) {
      map[item.moc_part_id] = {
        orderId: order.id,
        orderName: order.name,
        orderItemId: item.id,
        qtyOrdered: item.qty_ordered,
        qtyArrived: item.qty_arrived ?? 0,
        lineStatus: item.line_status || "ordered",
        vendorSku: item.vendor_sku || "",
        substitutionNote: item.substitution_note || ""
      };
    }
  }
  return map;
}, [orders]);

  useEffect(() => {
    let mounted = true;
    getSession().then((s)=>{ if (mounted) setSession(s); }).finally(()=>{ if (mounted) setLoadingSession(false); });
    const { data } = supabase.auth.onAuthStateChange((_event, nextSession) => setSession(nextSession));
    return () => { mounted = false; data.subscription.unsubscribe(); };
  }, []);

  useEffect(() => { if (session?.user) { refreshMocs(); refreshAllParts(); refreshOrders(); } }, [session?.user?.id]);
  useEffect(() => { if (selectedMocId) { setPartSearch(""); setColorFilter("All"); setSortField("part"); setSortDir("asc"); refreshParts(selectedMocId); } else setParts([]); }, [selectedMocId]);
  useEffect(() => { if (!showBuyList) { setSelectedOrderedIds([]); setSelectedOrderId(""); } }, [showBuyList]);
  useEffect(() => { if (!viewingOrder) setSelectedOrderDetailIds([]); }, [viewingOrder]);

  async function refreshMocs() {
    try { const data = await listMocs(); setMocs(data); if (!selectedMocId && data.length) setSelectedMocId(data[0].id); if (selectedMocId && !data.find((m)=>m.id===selectedMocId)) setSelectedMocId(data[0]?.id ?? null); }
    catch (err) { setError(err.message || "Could not load MOCs."); }
  }
  async function refreshParts(mocId) { try { setParts(await listMocParts(mocId)); } catch (err) { setError(err.message || "Could not load parts."); } }
  async function refreshAllParts() { try { setAllParts(await listAllPartsForUser()); } catch (err) { setError(err.message || "Could not load buy list."); } }
  async function refreshOrders() { try { setOrders(await listOrders()); } catch (err) { setError(err.message || "Could not load orders."); } }

  function getMissingQtyForPart(partId) {
    const part = allParts.find((p) => p.id === partId);
    return part ? Math.max(part.required_qty - part.have_qty, 0) : 0;
  }


  async function handleCreateMoc() {
    const name = window.prompt("MOC name:"); if (!name?.trim()) return;
    const url = window.prompt("Optional MOC URL:") || "";
    try { setBusy(true); const moc = await createMoc({ name:name.trim(), url:url.trim(), sourceFileName:null, userId:session.user.id }); await refreshMocs(); setSelectedMocId(moc.id); setShowBuyList(false); setShowOrders(false); }
    catch (err) { setError(err.message || "Could not create MOC."); }
    finally { setBusy(false); }
  }
  async function handleImportCsv(file) { try { setCsvPreview(importRebrickableCSV(file.name, await file.text())); setError(""); } catch (err) { setError(err.message || "Could not import CSV."); } }
  async function confirmImportCsv({ name, url }) {
    if (!csvPreview || !session?.user) return;
    try {
      setBusy(true);
      const moc = await createMoc({ name:name.trim(), url:url.trim(), sourceFileName:csvPreview.sourceFileName, userId:session.user.id });
      for (const part of csvPreview.parts) await createPart(moc.id, part);
      setCsvPreview(null); await refreshMocs(); await refreshAllParts(); setSelectedMocId(moc.id); setShowBuyList(false); setShowOrders(false);
    } catch (err) { setError(err.message || "Could not save imported MOC."); }
    finally { setBusy(false); }
  }
  async function handleDeleteMoc() { if (!selectedMoc || !window.confirm(`Delete "${selectedMoc.name}"?`)) return; try { setBusy(true); await deleteMoc(selectedMoc.id); await refreshMocs(); await refreshAllParts(); setParts([]); } catch (err) { setError(err.message || "Could not delete MOC."); } finally { setBusy(false); } }
  async function handleSaveMocMeta(e) { e.preventDefault(); const f=new FormData(e.currentTarget); try { setBusy(true); await updateMoc(selectedMoc.id,{ name:String(f.get("name")||""), url:String(f.get("url")||"") }); await refreshMocs(); await refreshAllParts(); setEditingMoc(false); } catch (err) { setError(err.message || "Could not update MOC."); } finally { setBusy(false); } }
  async function handleSaveOrder(payload) { if (!payload.name) { setError("Order name is required."); return; } try { setBusy(true); if (editingOrder?.id) await updateOrder(editingOrder.id, payload); else await createOrder({ ...payload, userId: session.user.id }); await refreshOrders(); setEditingOrder(null); } catch (err) { setError(err.message || "Could not save order."); } finally { setBusy(false); } }
  async function handleDeleteOrder(id) { if (!window.confirm("Delete this order?")) return; try { setBusy(true); await deleteOrder(id); await refreshOrders(); setEditingOrder(null); setViewingOrder(null); } catch (err) { setError(err.message || "Could not delete order."); } finally { setBusy(false); } }
  async function handleAssignOrder(newOrderId, oldOrderId, partId) {
    try {
      setBusy(true);
      if (oldOrderId && oldOrderId !== newOrderId) await removePartFromOrder(oldOrderId, partId);
      if (newOrderId) {
        const missing = getMissingQtyForPart(partId);
        await addPartToOrder(newOrderId, partId, { qtyOrdered: missing, qtyArrived: 0, lineStatus: "ordered" });
      }
      await refreshOrders();
    } catch (err) { setError(err.message || "Could not assign order."); }
    finally { setBusy(false); }
  }
  async function handleRemoveFromOrder(orderId, partId) { if (!orderId) return; try { setBusy(true); await removePartFromOrder(orderId, partId); await refreshOrders(); } catch (err) { setError(err.message || "Could not remove from order."); } finally { setBusy(false); } }
  async function handleSavePart(payload) { if (!selectedMoc) return; if (!payload.partNumber || !payload.color || payload.requiredQty < 1) { setError("Part number, color, and required quantity are required."); return; } try { setBusy(true); if (editingPart?.id) await updatePart(editingPart.id, payload); else await createPart(selectedMoc.id, payload); await refreshParts(selectedMoc.id); await refreshAllParts(); setEditingPart(null); } catch (err) { setError(err.message || "Could not save part."); } finally { setBusy(false); } }
  async function handleDeletePart(id) { if (!window.confirm("Delete this part?")) return; try { setBusy(true); await deletePart(id); await refreshParts(selectedMoc.id); await refreshAllParts(); } catch (err) { setError(err.message || "Could not delete part."); } finally { setBusy(false); } }
  async function patchPart(id, patch) { try { setBusy(true); await updatePart(id, patch); if (selectedMocId) await refreshParts(selectedMocId); await refreshAllParts(); } catch (err) { setError(err.message || "Could not update part."); } finally { setBusy(false); } }
  async function patchMultipleParts(partIds, patch) { try { setBusy(true); for (const id of partIds) await updatePart(id, patch); if (selectedMocId) await refreshParts(selectedMocId); await refreshAllParts(); } catch (err) { setError(err.message || "Could not update parts."); } finally { setBusy(false); } }
  async function assignSelectedToOrder(action, orderId) {
    if (action === "set_order_picker") { setSelectedOrderId(orderId); return; }
    if (!selectedOrderedIds.length || !orderId) return;
    try {
      setBusy(true);
      for (const partId of selectedOrderedIds) {
        const existing = ordersByPartId[partId]?.orderId || "";
        if (existing && existing !== orderId) await removePartFromOrder(existing, partId);
        const missing = getMissingQtyForPart(partId);
        await addPartToOrder(orderId, partId, { qtyOrdered: missing, qtyArrived: 0, lineStatus: "ordered" });
      }
      setSelectedOrderedIds([]);
      await refreshOrders();
    } catch (err) { setError(err.message || "Could not assign selected lines."); }
    finally { setBusy(false); }
  }
  async function removeSelectedFromOrder() {
    if (!selectedOrderedIds.length) return;
    try {
      setBusy(true);
      for (const partId of selectedOrderedIds) {
        const existing = ordersByPartId[partId]?.orderId || "";
        if (existing) await removePartFromOrder(existing, partId);
      }
      setSelectedOrderedIds([]);
      await refreshOrders();
    } catch (err) { setError(err.message || "Could not remove selected lines from orders."); }
    finally { setBusy(false); }
  }
  function toggleSelectedOrdered(partId, checked) {
    setSelectedOrderedIds((prev) => checked ? [...new Set([...prev, partId])] : prev.filter((id) => id !== partId));
  }
  function selectOrderedRow(partIds, checked) {
    setSelectedOrderedIds((prev) => checked ? [...new Set([...prev, ...partIds])] : prev.filter((id) => !partIds.includes(id)));
  }
  function selectAllVisibleOrdered(rows, checked) {
    const visibleIds = rows.flatMap((row) => row.lines.map((line) => line.partId));
    setSelectedOrderedIds((prev) => checked ? [...new Set([...prev, ...visibleIds])] : prev.filter((id) => !visibleIds.includes(id)));
  }
  function openMocFromBuyList(mocId) { setShowBuyList(false); setShowOrders(false); setSelectedMocId(mocId); }


  function toggleSelectedOrderDetail(partId, checked) {
    setSelectedOrderDetailIds((prev) => checked ? [...new Set([...prev, partId])] : prev.filter((id) => id !== partId));
  }
  function selectAllOrderDetails(lines, checked) {
    const ids = lines.map((line) => line.partId);
    setSelectedOrderDetailIds((prev) => checked ? [...new Set([...prev, ...ids])] : prev.filter((id) => !ids.includes(id)));
  }
  async function removeSelectedFromViewingOrder() {
    if (!viewingOrder || !selectedOrderDetailIds.length) return;
    try {
      setBusy(true);
      for (const partId of selectedOrderDetailIds) {
        await removePartFromOrder(viewingOrder.id, partId);
      }
      setSelectedOrderDetailIds([]);
      await refreshOrders();
    } catch (err) {
      setError(err.message || "Could not remove selected lines from order.");
    } finally {
      setBusy(false);
    }
  }
  function patchManyViewingOrderArrived(arrived) {
    return async () => {
      if (!selectedOrderDetailIds.length) return;
      try {
        setBusy(true);
        for (const partId of selectedOrderDetailIds) {
          const info = ordersByPartId[partId];
          const qtyOrdered = info?.qtyOrdered ?? getMissingQtyForPart(partId);
          const qtyArrived = arrived ? qtyOrdered : 0;
          const lineStatus = arrived ? "arrived" : "ordered";
          if (info?.orderItemId) {
            await updateOrderItem(info.orderItemId, { qtyArrived, lineStatus });
          }
          await updatePart(partId, { arrived });
        }
        await refreshOrders();
        await refreshAllParts();
        if (selectedMocId) await refreshParts(selectedMocId);
      } catch (err) {
        setError(err.message || "Could not update selected order lines.");
      } finally {
        setBusy(false);
      }
    };
  }

  async function patchViewingOrderItemField(partId, patch) {
    const info = ordersByPartId[partId];
    if (!info?.orderItemId) return;
    try {
      setBusy(true);
      const nextQtyOrdered = "qtyOrdered" in patch ? patch.qtyOrdered : (info.qtyOrdered ?? getMissingQtyForPart(partId));
      const nextQtyArrived = "qtyArrived" in patch ? patch.qtyArrived : (info.qtyArrived ?? 0);
      const nextStatus = "lineStatus" in patch ? patch.lineStatus : (info.lineStatus || "ordered");
      await updateOrderItem(info.orderItemId, patch);
      const arrivedFlag = nextQtyArrived >= nextQtyOrdered && nextQtyOrdered > 0;
      if ("qtyArrived" in patch || "qtyOrdered" in patch || "lineStatus" in patch) {
        await updatePart(partId, { arrived: arrivedFlag || nextStatus === "arrived" });
      }
      await refreshOrders();
      await refreshAllParts();
      if (selectedMocId) await refreshParts(selectedMocId);
    } catch (err) {
      setError(err.message || "Could not update order line.");
    } finally {
      setBusy(false);
    }
  }

  const filteredParts = useMemo(() => parts.filter((p) => {
    const matchesSearch = !partSearch || p.part_number.toLowerCase().includes(partSearch.toLowerCase()) || p.color.toLowerCase().includes(partSearch.toLowerCase());
    const matchesColor = colorFilter === "All" || p.color === colorFilter;
    return matchesSearch && matchesColor;
  }), [parts, partSearch, colorFilter]);

  const sortedParts = useMemo(() => {
    const items = [...filteredParts], mult = sortDir === "asc" ? 1 : -1;
    items.sort((a,b) => {
      const aMissing = Math.max(a.required_qty - a.have_qty, 0), bMissing = Math.max(b.required_qty - b.have_qty, 0);
      const getVal = (item, missing) => ({part:item.part_number,color:item.color,need:item.required_qty,have:item.have_qty,missing,ordered:item.ordered?1:0,arrived:item.arrived?1:0,completed:item.completed?1:0}[sortField] ?? item.part_number);
      const av = getVal(a, aMissing), bv = getVal(b, bMissing);
      if (typeof av === "number" && typeof bv === "number") return (av - bv) * mult;
      return String(av).localeCompare(String(bv)) * mult;
    });
    return items;
  }, [filteredParts, sortField, sortDir]);

  const activeParts = sortedParts.filter((p) => !p.completed && !(p.ordered && p.required_qty - p.have_qty > 0));
  const orderedParts = sortedParts.filter((p) => !p.completed && p.ordered && p.required_qty - p.have_qty > 0);
  const completedParts = sortedParts.filter((p) => p.completed);
  const colors = [...new Set(parts.map((p) => p.color))].sort();
  const buyFilterValue = buyListMocFilter === "all" ? null : buyListMocFilter;
  const toOrderRows = useMemo(() => groupBuyRows(allParts, "to_order", buyFilterValue, ordersByPartId), [allParts, buyFilterValue, ordersByPartId]);
  const orderedRows = useMemo(() => groupBuyRows(allParts, "ordered", buyFilterValue, ordersByPartId), [allParts, buyFilterValue, ordersByPartId]);
  const metricsByOrderId = useMemo(() => {
    const metrics = {};
    for (const order of orders) {
      const items = order.order_items || [];
      const lines = items.map((item) => {
        const part = allParts.find((p) => p.id === item.moc_part_id);
        const missing = part ? Math.max(part.required_qty - part.have_qty, 0) : (item.qty_ordered || 0);
        return {
          qtyOrdered: item.qty_ordered ?? missing,
          qtyArrived: item.qty_arrived ?? 0,
          lineStatus: item.line_status || "ordered"
        };
      });
      const totalQty = lines.reduce((sum, line) => sum + (line.qtyOrdered || 0), 0);
      const arrivedQty = lines.reduce((sum, line) => sum + Math.min(line.qtyArrived || 0, line.qtyOrdered || 0), 0);
      const pendingQty = Math.max(totalQty - arrivedQty, 0);
      metrics[order.id] = {
        lines: lines.length,
        totalQty,
        arrivedQty,
        pendingQty,
        allArrived: lines.length > 0 && pendingQty === 0
      };
    }
    return metrics;
  }, [orders, allParts]);

  const viewingOrderLines = useMemo(() => {
    if (!viewingOrder) return [];
    const allowed = new Set((viewingOrder.order_items || []).map((i) => i.moc_part_id));
    return allParts
      .filter((part) => allowed.has(part.id))
      .map((part) => {
        const info = ordersByPartId[part.id] || {};
        const missing = Math.max(part.required_qty - part.have_qty, 0);
        const qtyOrdered = info.qtyOrdered ?? missing;
        const qtyArrived = info.qtyArrived ?? 0;
        return {
          partId: part.id,
          orderItemId: info.orderItemId || "",
          mocId: part.mocs?.id || "",
          mocName: part.mocs?.name || "MOC",
          partNumber: part.part_number,
          color: part.color,
          missing,
          qtyOrdered,
          qtyArrived,
          lineStatus: info.lineStatus || "ordered",
          vendorSku: info.vendorSku || "",
          substitutionNote: info.substitutionNote || "",
          arrived: qtyArrived >= qtyOrdered && qtyOrdered > 0
        };
      })
      .sort((a, b) => a.mocName.localeCompare(b.mocName) || a.partNumber.localeCompare(b.partNumber));
  }, [viewingOrder, allParts, ordersByPartId]);

  if (loadingSession) return <div className="page centered"><div className="panel">Loading…</div></div>;
  if (!session?.user) return <AuthScreen onAuthed={async ()=>setSession(await getSession())} />;

  return <div className="page">
    <header className="header">
      <div><h1>LEGO MOC Manager</h1><p className="subtitle">Sprint 2: arrival & sourcing workflow.</p></div>
      <div className="toolbar">
        <button className="btn" onClick={() => { setShowBuyList(false); setShowOrders(false); }}>Dashboard</button>
        <button className="btn" onClick={() => { setShowBuyList(true); setShowOrders(false); }}>Buy List</button>
        <button className="btn" onClick={() => { setShowOrders(true); setShowBuyList(false); }}>Orders</button>
        <button className="btn primary" onClick={handleCreateMoc} disabled={busy}>New MOC</button>
        <label className="btn">Import CSV<input type="file" accept=".csv,text/csv" style={{ display:"none" }} onChange={(e)=>{ const file = e.target.files?.[0]; if (file) handleImportCsv(file); e.target.value = ""; }} /></label>
        <button className="btn" onClick={() => signOut()}>Sign out</button>
      </div>
    </header>
    {error ? <div className="error-banner">{error}</div> : null}

    {!showBuyList && !showOrders ? <div className="layout">
      <aside className="sidebar panel"><div className="sidebar-header"><h2>MOCs</h2></div><div className="stack">
        {mocs.map((moc) => <button key={moc.id} className={`moc-item ${moc.id===selectedMocId?"selected":""}`} onClick={() => setSelectedMocId(moc.id)}><strong>{moc.name}</strong><span>{moc.source_file_name || "Manual MOC"}</span></button>)}
        {!mocs.length ? <div className="muted">No MOCs yet.</div> : null}
      </div></aside>
      <main className="content">
        {selectedMoc ? <>
          <div className="panel">
            <div className="row-between"><div><h2>{selectedMoc.name}</h2><div className="muted">{selectedMoc.url ? <a href={selectedMoc.url} target="_blank" rel="noreferrer">Open MOC URL</a> : "No URL set"}</div></div><div className="toolbar"><button className="btn" onClick={() => setEditingMoc(v=>!v)}>Edit MOC</button><button className="btn danger" onClick={handleDeleteMoc} disabled={busy}>Delete MOC</button></div></div>
            {editingMoc ? <form className="stack" onSubmit={handleSaveMocMeta}><label><span>Name</span><input name="name" defaultValue={selectedMoc.name} /></label><label><span>URL</span><input name="url" defaultValue={selectedMoc.url || ""} /></label><div className="toolbar"><button className="btn primary" disabled={busy}>Save MOC</button><button type="button" className="btn" onClick={()=>setEditingMoc(false)}>Cancel</button></div></form> : null}
          </div>

          <div className="panel">
            <div className="row-between"><h3>Parts</h3><button className="btn primary" onClick={() => setEditingPart({})}>Add part</button></div>
            <div className="filters">
              <input className="search" placeholder="Search by part number or color" value={partSearch} onChange={(e)=>setPartSearch(e.target.value)} />
              <select value={colorFilter} onChange={(e)=>setColorFilter(e.target.value)}><option value="All">All colors</option>{colors.map((color)=><option key={color} value={color}>{color}</option>)}</select>
              <select value={sortField} onChange={(e)=>setSortField(e.target.value)}><option value="part">Sort: Part</option><option value="color">Sort: Color</option><option value="need">Sort: Need</option><option value="have">Sort: Have</option><option value="missing">Sort: Missing</option><option value="ordered">Sort: Ordered</option><option value="arrived">Sort: Arrived</option><option value="completed">Sort: Completed</option></select>
              <select value={sortDir} onChange={(e)=>setSortDir(e.target.value)}><option value="asc">Asc</option><option value="desc">Desc</option></select>
            </div>
            <div className="section-block"><h3>Active</h3><PartTable parts={activeParts} onEdit={setEditingPart} onDelete={handleDeletePart} onPatch={patchPart} /></div>
            <div className="section-block"><h3>Ordered / Arriving</h3><PartTable parts={orderedParts} onEdit={setEditingPart} onDelete={handleDeletePart} onPatch={patchPart} /></div>
            <div className="section-block"><h3>Completed</h3><PartTable parts={completedParts} onEdit={setEditingPart} onDelete={handleDeletePart} onPatch={patchPart} /></div>
          </div>
        </> : <div className="panel">Create or import a MOC to get started.</div>}
      </main>
    </div> : showBuyList ? <div className="content">
      <div className="panel"><div className="row-between"><h2>Buy List</h2><div className="buy-filter"><label><span>Filter To Order by MOC</span></label><select value={buyListMocFilter} onChange={(e)=>setBuyListMocFilter(e.target.value)}><option value="all">All MOCs</option>{mocs.map((moc)=><option key={moc.id} value={moc.id}>{moc.name}</option>)}</select></div></div><p className="subtitle">Assign to orders directly here. In Ordered, you can select multiple lines, select all visible, and assign them to an order in one action.</p></div>
      <BuyListSection title="To Order" subtitle="Any missing quantity automatically appears here until you mark it as ordered." rows={toOrderRows} mode="to_order" mocFilterId={buyFilterValue} orders={orders} selectedIds={selectedOrderedIds} selectedOrderId={selectedOrderId} onToggleSelected={toggleSelectedOrdered} onSelectRow={selectOrderedRow} onSelectAllVisible={selectAllVisibleOrdered} onAssignSelectedToOrder={assignSelectedToOrder} onRemoveSelectedFromOrder={removeSelectedFromOrder} onQuickAssignLine={handleAssignOrder} onPatch={patchPart} onPatchMany={patchMultipleParts} onOpenMoc={openMocFromBuyList} />
      <BuyListSection title="Ordered" subtitle="Assign to orders directly here, line by line or in bulk." rows={orderedRows} mode="ordered" mocFilterId={buyFilterValue} orders={orders} selectedIds={selectedOrderedIds} selectedOrderId={selectedOrderId} onToggleSelected={toggleSelectedOrdered} onSelectRow={selectOrderedRow} onSelectAllVisible={selectAllVisibleOrdered} onAssignSelectedToOrder={assignSelectedToOrder} onRemoveSelectedFromOrder={removeSelectedFromOrder} onQuickAssignLine={handleAssignOrder} onPatch={patchPart} onPatchMany={patchMultipleParts} onOpenMoc={openMocFromBuyList} />
    </div> : <OrdersPanel orders={orders} groupedBuyRows={orderedRows} onOpenOrderEditor={setEditingOrder} onOpenOrderDetails={setViewingOrder} metricsByOrderId={metricsByOrderId} />}
    <PartEditorModal part={editingPart} busy={busy} onSave={handleSavePart} onCancel={() => setEditingPart(null)} />
    <OrderEditorModal order={editingOrder} busy={busy} onSave={handleSaveOrder} onCancel={() => setEditingOrder(null)} onDelete={handleDeleteOrder} />
    <OrderDetailsModal order={viewingOrder} lines={viewingOrderLines} selectedIds={selectedOrderDetailIds} onToggleSelected={toggleSelectedOrderDetail} onSelectAll={() => selectAllOrderDetails(viewingOrderLines, true)} onClearSelection={() => selectAllOrderDetails(viewingOrderLines, false)} onClose={() => setViewingOrder(null)} onOpenMoc={openMocFromBuyList} onRemoveLine={handleRemoveFromOrder} onRemoveSelected={removeSelectedFromViewingOrder} onPatchArrived={(partId, arrived) => patchPart(partId, { arrived })} onPatchManyArrived={patchManyViewingOrderArrived} onUpdateOrderLine={patchViewingOrderItemField} />
    <ImportPreviewModal preview={csvPreview} busy={busy} onCancel={() => setCsvPreview(null)} onConfirm={confirmImportCsv} />
  </div>;
}
