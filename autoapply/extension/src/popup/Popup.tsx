import { useEffect, useState } from "react";
import { getSettings, saveSettings } from "../lib/storage";

const wrap: React.CSSProperties = {
  fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
  padding: 16,
  color: "#0f172a",
};
const label: React.CSSProperties = { fontSize: 12, fontWeight: 600, display: "block", marginBottom: 4 };
const input: React.CSSProperties = {
  width: "100%", height: 34, padding: "0 8px", fontSize: 13,
  border: "1px solid #cbd5e1", borderRadius: 8, marginBottom: 12, boxSizing: "border-box",
};
const button: React.CSSProperties = {
  width: "100%", height: 36, background: "#2563eb", color: "#fff", border: "none",
  borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: "pointer",
};

export function Popup() {
  const [apiBase, setApiBase] = useState("http://localhost:3000");
  const [token, setToken] = useState("");
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    getSettings().then((s) => {
      setApiBase(s.apiBase);
      setToken(s.token ?? "");
    });
  }, []);

  async function save() {
    await saveSettings({ apiBase: apiBase.replace(/\/$/, ""), token: token.trim() || null });
    setSaved(true);
    setTimeout(() => setSaved(false), 1500);
  }

  return (
    <div style={wrap}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 14 }}>
        <span style={{ width: 24, height: 24, borderRadius: 7, background: "#2563eb", color: "#fff",
          display: "flex", alignItems: "center", justifyContent: "center", fontSize: 13 }}>⚡</span>
        <strong style={{ fontSize: 15 }}>AutoApply</strong>
      </div>

      <label style={label}>Dashboard URL</label>
      <input style={input} value={apiBase} onChange={(e) => setApiBase(e.target.value)} placeholder="http://localhost:3000" />

      <label style={label}>Extension token</label>
      <input style={input} type="password" value={token} onChange={(e) => setToken(e.target.value)} placeholder="aa_…" />
      <p style={{ fontSize: 11, color: "#64748b", marginTop: -6, marginBottom: 12 }}>
        Generate this on the dashboard → Profile → Browser extension.
      </p>

      <button style={button} onClick={save}>{saved ? "Saved ✓" : "Save"}</button>

      <p style={{ fontSize: 11, color: "#64748b", marginTop: 12, lineHeight: 1.5 }}>
        Click <b>Apply</b> in your dashboard. This extension opens the posting and fills the form.
        You always review and submit yourself.
      </p>
    </div>
  );
}
