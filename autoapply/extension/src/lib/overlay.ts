// Floating in-page UI injected on the employer's site after auto-fill.
// Shown as a fixed card. Not React — a shadow-DOM island so the host page's
// CSS can't distort it.

export interface OverlayHandlers {
  onSync: () => void;
  onDismiss: () => void;
}

export function mountOverlay(opts: {
  company: string;
  role: string;
  filledCount: number;
  handlers: OverlayHandlers;
}) {
  document.getElementById("autoapply-overlay-host")?.remove();

  const host = document.createElement("div");
  host.id = "autoapply-overlay-host";
  host.style.cssText = "position:fixed;bottom:20px;right:20px;z-index:2147483647;";
  const shadow = host.attachShadow({ mode: "open" });

  shadow.innerHTML = `
    <style>
      * { box-sizing: border-box; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; }
      .card { width: 320px; background: #fff; color: #0f172a; border: 1px solid #e2e8f0;
        border-radius: 14px; box-shadow: 0 12px 32px rgba(0,0,0,.18); overflow: hidden; }
      .top { display:flex; align-items:center; gap:8px; padding:12px 14px; background:#2563eb; color:#fff; }
      .top .dot { width:20px;height:20px;border-radius:6px;background:rgba(255,255,255,.2);
        display:flex;align-items:center;justify-content:center;font-size:12px; }
      .top strong { font-size: 13px; }
      .x { margin-left:auto; cursor:pointer; opacity:.85; background:none;border:none;color:#fff;font-size:16px; }
      .body { padding: 14px; }
      .count { font-size: 22px; font-weight: 700; }
      .count span { color:#10b981; }
      .sub { font-size: 12px; color:#64748b; margin-top:2px; }
      .job { font-size: 12px; margin-top:10px; padding:8px; background:#f8fafc; border-radius:8px; }
      .job b { display:block; }
      .actions { display:flex; gap:8px; padding: 0 14px 14px; }
      button.act { flex:1; height:36px; border-radius:8px; border:none; cursor:pointer; font-size:13px; font-weight:600; }
      .primary { background:#10b981; color:#fff; }
      .ghost { background:#f1f5f9; color:#0f172a; }
      .status { font-size:12px; padding:0 14px 12px; color:#10b981; display:none; }
    </style>
    <div class="card">
      <div class="top">
        <span class="dot">⚡</span>
        <strong>AutoApply</strong>
        <button class="x" title="Dismiss">✕</button>
      </div>
      <div class="body">
        <div class="count"><span id="n">0</span> fields auto-filled</div>
        <div class="sub">Review everything, then submit on this page yourself.</div>
        <div class="job"><b id="role"></b><span id="company"></span></div>
      </div>
      <div class="status" id="status"></div>
      <div class="actions">
        <button class="act primary" id="sync">I submitted — mark Applied</button>
        <button class="act ghost" id="dismiss">Dismiss</button>
      </div>
    </div>
  `;

  (shadow.getElementById("n") as HTMLElement).textContent = String(opts.filledCount);
  (shadow.getElementById("role") as HTMLElement).textContent = opts.role;
  (shadow.getElementById("company") as HTMLElement).textContent = opts.company;

  const statusEl = shadow.getElementById("status") as HTMLElement;
  const setStatus = (msg: string) => {
    statusEl.textContent = msg;
    statusEl.style.display = "block";
  };

  shadow.getElementById("sync")!.addEventListener("click", async () => {
    setStatus("Syncing…");
    try {
      await opts.handlers.onSync();
      setStatus("Marked Applied ✓ — you can close this.");
    } catch {
      setStatus("Sync failed. Check your token in the popup.");
      statusEl.style.color = "#ef4444";
    }
  });
  shadow.getElementById("dismiss")!.addEventListener("click", () => {
    opts.handlers.onDismiss();
    host.remove();
  });
  shadow.querySelector(".x")!.addEventListener("click", () => {
    opts.handlers.onDismiss();
    host.remove();
  });

  document.body.appendChild(host);
  return { setStatus };
}
