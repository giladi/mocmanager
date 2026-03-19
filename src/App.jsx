import React, { useEffect, useMemo, useState } from "react";
import {
  createMoc,
  createPart,
  deleteMoc,
  deletePart,
  getSession,
  listMocParts,
  listMocs,
  signIn,
  signOut,
  signUp,
  updateMoc,
  updatePart,
} from "./lib/api";
import { supabase } from "./lib/supabase";

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
        <p className="subtitle">
          Sign in to access your MOCs from anywhere.
        </p>
        <form onSubmit={handleSubmit} className="stack">
          <label>
            <span>Email</span>
            <input value={email} onChange={(e) => setEmail(e.target.value)} type="email" required />
          </label>
          <label>
            <span>Password</span>
            <input value={password} onChange={(e) => setPassword(e.target.value)} type="password" required />
          </label>
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

function App() {
  const [session, setSession] = useState(null);
  const [loadingSession, setLoadingSession] = useState(true);
  const [mocs, setMocs] = useState([]);
  const [selectedMocId, setSelectedMocId] = useState(null);
  const [parts, setParts] = useState([]);
  const [partSearch, setPartSearch] = useState("");
  const [colorFilter, setColorFilter] = useState("All");
  const [showBuyList, setShowBuyList] = useState(false);
  const [editingPart, setEditingPart] = useState(null);
  const [editingMoc, setEditingMoc] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const selectedMoc = useMemo(
    () => mocs.find((m) => m.id === selectedMocId) || null,
    [mocs, selectedMocId]
  );

  useEffect(() => {
    let mounted = true;
    getSession()
      .then((s) => {
        if (mounted) setSession(s);
      })
      .finally(() => {
        if (mounted) setLoadingSession(false);
      });

    const { data } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      setSession(nextSession);
    });

    return () => {
      mounted = false;
      data.subscription.unsubscribe();
    };
  }, []);

  useEffect(() => {
    if (!session?.user) return;
    refreshMocs();
  }, [session?.user?.id]);

  useEffect(() => {
    if (!selectedMocId) {
      setParts([]);
      return;
    }
    refreshParts(selectedMocId);
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
        userId: session.user.id,
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

  async function handleDeleteMoc() {
    if (!selectedMoc) return;
    if (!window.confirm(`Delete "${selectedMoc.name}"?`)) return;
    try {
      setBusy(true);
      await deleteMoc(selectedMoc.id);
      await refreshMocs();
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
        url: String(form.get("url") || ""),
      });
      await refreshMocs();
      setEditingMoc(false);
    } catch (err) {
      setError(err.message || "Could not update MOC.");
    } finally {
      setBusy(false);
    }
  }

  async function handleSavePart(e) {
    e.preventDefault();
    if (!selectedMoc) return;
    const form = new FormData(e.currentTarget);
    const payload = {
      partNumber: String(form.get("partNumber") || "").trim(),
      color: String(form.get("color") || "").trim(),
      requiredQty: Number(form.get("requiredQty") || 1),
      haveQty: Number(form.get("haveQty") || 0),
      ordered: form.get("ordered") === "on",
      arrived: form.get("arrived") === "on",
      completed: form.get("completed") === "on",
    };

    if (!payload.partNumber || !payload.color || payload.requiredQty < 1) {
      setError("Part number, color, and required quantity are required.");
      return;
    }

    try {
      setBusy(true);
      if (editingPart?.id) await updatePart(editingPart.id, payload);
      else await createPart(selectedMoc.id, payload);
      await refreshParts(selectedMoc.id);
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
    } catch (err) {
      setError(err.message || "Could not update part.");
    } finally {
      setBusy(false);
    }
  }

  const filteredParts = useMemo(() => {
    return parts.filter((p) => {
      const matchesSearch =
        !partSearch ||
        p.part_number.toLowerCase().includes(partSearch.toLowerCase()) ||
        p.color.toLowerCase().includes(partSearch.toLowerCase());
      const matchesColor = colorFilter === "All" || p.color === colorFilter;
      return matchesSearch && matchesColor;
    });
  }, [parts, partSearch, colorFilter]);

  const activeParts = filteredParts.filter((p) => !p.completed && !(p.ordered && p.required_qty - p.have_qty > 0));
  const orderedParts = filteredParts.filter((p) => !p.completed && p.ordered && p.required_qty - p.have_qty > 0);
  const completedParts = filteredParts.filter((p) => p.completed);

  const buyList = useMemo(() => {
    const grouped = new Map();
    for (const moc of mocs) {
      // parts are only loaded for selected MOC in this starter.
      // cross-MOC buy list requires loading parts for all MOCs.
    }
    return grouped;
  }, [mocs]);

  const selectedColors = [...new Set(parts.map((p) => p.color))].sort();

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
          <p className="subtitle">React + Supabase starter for your hosted MOC tracker.</p>
        </div>
        <div className="toolbar">
          <button className="btn" onClick={() => setShowBuyList(false)}>Dashboard</button>
          <button className="btn" onClick={() => setShowBuyList(true)}>Buy List</button>
          <button className="btn primary" onClick={handleCreateMoc} disabled={busy}>New MOC</button>
          <button className="btn" onClick={() => signOut()}>Sign out</button>
        </div>
      </header>

      {error ? <div className="error-banner">{error}</div> : null}

      {!showBuyList ? (
        <div className="layout">
          <aside className="sidebar panel">
            <div className="sidebar-header">
              <h2>MOCs</h2>
            </div>
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
                        {selectedMoc.url ? <a href={selectedMoc.url} target="_blank" rel="noreferrer">Open MOC URL</a> : "No URL set"}
                      </div>
                    </div>
                    <div className="toolbar">
                      <button className="btn" onClick={() => setEditingMoc((v) => !v)}>Edit MOC</button>
                      <button className="btn danger" onClick={handleDeleteMoc} disabled={busy}>Delete MOC</button>
                    </div>
                  </div>

                  {editingMoc ? (
                    <form className="stack" onSubmit={handleSaveMocMeta}>
                      <label>
                        <span>Name</span>
                        <input name="name" defaultValue={selectedMoc.name} />
                      </label>
                      <label>
                        <span>URL</span>
                        <input name="url" defaultValue={selectedMoc.url || ""} />
                      </label>
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
                      {selectedColors.map((color) => (
                        <option key={color} value={color}>{color}</option>
                      ))}
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
              <div className="panel">Create a MOC to get started.</div>
            )}
          </main>
        </div>
      ) : (
        <div className="panel">
          <h2>Buy List</h2>
          <p className="subtitle">
            This starter includes the buy-list screen shell. The next step is loading parts for all MOCs at once and grouping them by part + color.
          </p>
          <div className="muted">
            The database structure already supports ordered / arrived per part record. The grouped buy-list logic from your local version should move here next.
          </div>
        </div>
      )}

      {editingPart !== null ? (
        <div className="modal-backdrop">
          <div className="modal">
            <h3>{editingPart?.id ? "Edit part" : "Add part"}</h3>
            <form className="stack" onSubmit={handleSavePart}>
              <label>
                <span>Part number</span>
                <input name="partNumber" defaultValue={editingPart.part_number || ""} />
              </label>
              <label>
                <span>Color</span>
                <input name="color" defaultValue={editingPart.color || ""} />
              </label>
              <label>
                <span>Required quantity</span>
                <input name="requiredQty" type="number" min="1" defaultValue={editingPart.required_qty ?? 1} />
              </label>
              <label>
                <span>Have quantity</span>
                <input name="haveQty" type="number" min="0" defaultValue={editingPart.have_qty ?? 0} />
              </label>
              <label className="checkbox">
                <input name="ordered" type="checkbox" defaultChecked={!!editingPart.ordered} />
                <span>Ordered</span>
              </label>
              <label className="checkbox">
                <input name="arrived" type="checkbox" defaultChecked={!!editingPart.arrived} />
                <span>Arrived</span>
              </label>
              <label className="checkbox">
                <input name="completed" type="checkbox" defaultChecked={!!editingPart.completed} />
                <span>Completed</span>
              </label>
              <div className="toolbar">
                <button className="btn primary" disabled={busy}>Save</button>
                <button type="button" className="btn" onClick={() => setEditingPart(null)}>Cancel</button>
              </div>
            </form>
          </div>
        </div>
      ) : null}
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
            <th>Part</th>
            <th>Color</th>
            <th>Need</th>
            <th>Have</th>
            <th>Missing</th>
            <th>Ordered</th>
            <th>Arrived</th>
            <th>Completed</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {parts.map((part) => {
            const missing = Math.max(part.required_qty - part.have_qty, 0);
            return (
              <tr key={part.id}>
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
                    onChange={(e) => onPatch(part.id, { arrived: e.target.checked })}
                    disabled={!part.ordered}
                  />
                </td>
                <td>
                  <input
                    type="checkbox"
                    checked={part.completed}
                    onChange={(e) => onPatch(part.id, { completed: e.target.checked })}
                  />
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

export default App;
