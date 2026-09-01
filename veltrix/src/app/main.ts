import { api } from "./api.js";
import { renderLogin } from "./login.js";
import { renderDashboard } from "./dashboard.js";
import { renderClients, bindClients } from "./clients.js";
import { renderBuilder, bindBuilder } from "./builder.js";
import { renderAdminControl, bindAdminControl } from "./admin-control.js";
import { renderLogs, bindLogs } from "./logs.js";
import { renderSettings, bindSettings } from "./settings.js";
import type { StatsResponse, TabId } from "./types.js";

const root = document.getElementById("app") as HTMLElement;

const TABS: { id: TabId; label: string; icon: string }[] = [
  { id: "overview", label: "Overview", icon: "📊" },
  { id: "clients", label: "Clients", icon: "👥" },
  { id: "builder", label: "Builder", icon: "🔨" },
  { id: "chat", label: "Chat", icon: "💬" },
  { id: "notifications", label: "Notifications", icon: "🔔" },
  { id: "settings", label: "Settings", icon: "⚙" },
  { id: "admin", label: "Admin", icon: "🛡" },
];

let currentTab: TabId = "overview";
let connectedId: string | null = null;
let data: StatsResponse | null = null;
let sessionStart = Date.now();
let currentUser = "user";
let currentUserId = 0;

async function showPanel(): Promise<void> {
  try {
    const me = await api.me();
    if (me.ok && me.user) {
      currentUser = me.user;
      currentUserId = me.userId || 0;
    }
  } catch {}

  data = await api.stats();
  sessionStart = Date.now();

  root.innerHTML = `
    <div class="hc-root">
      <div class="hc-topbar">
        <div class="hc-topbar-left">
          <div class="hc-brand"><span class="hc-dot"></span> Veltrix</div>
        </div>
        <nav class="hc-topnav">
          ${TABS.map(t => `<button class="hc-topnav-btn ${t.id === currentTab ? "active" : ""}" data-tab="${t.id}"><span class="hc-topnav-icon">${t.icon}</span>${t.label}</button>`).join("")}
        </nav>
        <div class="hc-topbar-right">
          <div class="hc-mono hc-muted" style="font-size:11px">🕐 <span id="session-timer">00:00:00</span></div>
          <div class="hc-topbar-user">
            <div class="hc-status-dot hc-online"></div>
            <span>${currentUser}</span>
          </div>
          <button class="hc-logout-btn" id="logout">↗</button>
        </div>
      </div>
      <main class="hc-main" id="view"></main>

      <div class="cmd-palette-overlay" id="cmd-overlay" style="display:none">
        <div class="cmd-palette">
          <input id="cmd-input" placeholder="Type a command… (Ctrl+K)" />
          <div id="cmd-results" class="cmd-results"></div>
        </div>
      </div>
    </div>`;

  root.querySelectorAll<HTMLButtonElement>(".hc-topnav-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      currentTab = btn.dataset["tab"] as TabId;
      connectedId = null;
      root.querySelectorAll(".hc-topnav-btn").forEach(b => b.classList.remove("active"));
      btn.classList.add("active");
      renderTab();
    });
  });

  root.querySelector<HTMLButtonElement>("#logout")!.addEventListener("click", async () => {
    await api.logout();
    boot();
  });

  const timerEl = root.querySelector<HTMLElement>("#session-timer")!;
  setInterval(() => {
    const elapsed = Math.floor((Date.now() - sessionStart) / 1000);
    const h = String(Math.floor(elapsed / 3600)).padStart(2, "0");
    const m = String(Math.floor((elapsed % 3600) / 60)).padStart(2, "0");
    const s = String(elapsed % 60).padStart(2, "0");
    timerEl.textContent = `${h}:${m}:${s}`;
  }, 1000);

  // Auto-refresh data
  setInterval(async () => {
    try { data = await api.stats(); } catch {}
  }, 10000);

  setupCommandPalette();
  renderTab();
}

function setupCommandPalette(): void {
  const overlay = document.getElementById("cmd-overlay")!;
  const input = document.getElementById("cmd-input") as HTMLInputElement;
  const results = document.getElementById("cmd-results")!;

  const commands = [
    { label: "Go to Overview", action: () => { currentTab = "overview"; connectedId = null; renderTab(); } },
    { label: "Go to Clients", action: () => { currentTab = "clients"; connectedId = null; renderTab(); } },
    { label: "Go to Builder", action: () => { currentTab = "builder"; connectedId = null; renderTab(); } },
    { label: "Go to Logs", action: () => { currentTab = "admin"; connectedId = null; renderTab(); } },
    { label: "Go to Settings", action: () => { currentTab = "settings"; connectedId = null; renderTab(); } },
    { label: "Refresh Data", action: async () => { data = await api.stats(); renderTab(); } },
    { label: "Sign Out", action: async () => { await api.logout(); boot(); } },
  ];

  function show(): void { overlay.style.display = "flex"; input.value = ""; input.focus(); renderCommands(""); }
  function hide(): void { overlay.style.display = "none"; }

  function renderCommands(q: string): void {
    const filtered = commands.filter(c => c.label.toLowerCase().includes(q.toLowerCase()));
    results.innerHTML = filtered.map((c, i) => `<div class="cmd-item${i === 0 ? " active" : ""}" data-idx="${i}">${c.label}</div>`).join("");
    results.querySelectorAll<HTMLElement>(".cmd-item").forEach(el => {
      el.addEventListener("click", () => {
        const idx = Number(el.dataset["idx"]);
        const filtered2 = commands.filter(c2 => c2.label.toLowerCase().includes((input.value ?? "").toLowerCase()));
        filtered2[idx]?.action();
        hide();
      });
    });
  }

  input.addEventListener("input", () => renderCommands(input.value));
  input.addEventListener("keydown", (e) => { if (e.key === "Escape") hide(); if (e.key === "Enter") results.querySelector<HTMLElement>(".cmd-item")?.click(); });
  overlay.addEventListener("click", (e) => { if (e.target === overlay) hide(); });
  document.addEventListener("keydown", (e) => { if ((e.ctrlKey || e.metaKey) && e.key === "k") { e.preventDefault(); overlay.style.display === "none" ? show() : hide(); } });
}

async function renderTab(): Promise<void> {
  const view = root.querySelector<HTMLElement>("#view")!;

  if (currentTab === "overview") {
    if (!data) { view.innerHTML = '<div class="hc-card">Loading…</div>'; return; }
    view.innerHTML = renderDashboard(data);
    // Bind open buttons on dashboard
    view.querySelectorAll<HTMLButtonElement>(".dash-open-btn").forEach(btn => {
      btn.addEventListener("click", () => {
        connectedId = btn.dataset["id"] ?? null;
        currentTab = "clients";
        root.querySelectorAll(".hc-topnav-btn").forEach(b => {
          b.classList.toggle("active", (b as HTMLElement).dataset["tab"] === "clients");
        });
        void renderTab();
      });
    });
    return;
  }

  if (currentTab === "builder") { view.innerHTML = renderBuilder(); bindBuilder(view); return; }

  if (currentTab === "chat") {
    view.innerHTML = `
      <h1>Chat</h1>
      <p class="hc-sub">Communicate with connected clients.</p>
      <div class="hc-card" style="min-height:300px">
        <div class="hc-muted" style="text-align:center;padding:40px">
          <div style="font-size:32px;margin-bottom:8px">💬</div>
          <div>No active chat sessions. Connect to a client and start a chat.</div>
        </div>
      </div>`;
    return;
  }

  if (currentTab === "notifications") {
    view.innerHTML = `
      <h1>Notifications</h1>
      <p class="hc-sub">System alerts and events.</p>
      <div class="hc-card">
        <div class="hc-log-row hc-log-success">
          <span class="hc-log-badge">SUCCESS</span>
          <span class="hc-log-msg">System initialized</span>
          <span class="hc-muted">2m ago</span>
        </div>
        <div class="hc-log-row hc-log-info">
          <span class="hc-log-badge">INFO</span>
          <span class="hc-log-msg">Panel started</span>
          <span class="hc-muted">5m ago</span>
        </div>
      </div>`;
    return;
  }

  if (currentTab === "settings") { view.innerHTML = renderSettings(); bindSettings(view); return; }

  if (currentTab === "admin") {
    view.innerHTML = `<h1>Admin</h1><p class="hc-sub">System administration and logs.</p>`;
    const logsContainer = document.createElement("div");
    view.appendChild(logsContainer);
    logsContainer.innerHTML = renderLogs();
    bindLogs(logsContainer);
    return;
  }

  // Clients tab
  if (connectedId) {
    view.innerHTML = `<div class="hc-card" style="text-align:center;padding:40px"><div class="hc-muted">Connecting to ${connectedId}…</div></div>`;
    try {
      const detail = await api.client(connectedId);
      view.innerHTML = renderAdminControl(detail);
      bindAdminControl(view, detail, () => { connectedId = null; void renderTab(); });
    } catch {
      connectedId = null;
      view.innerHTML = '<div class="hc-card">Failed to connect.</div>';
    }
    return;
  }

  if (!data) { view.innerHTML = '<div class="hc-card">Loading…</div>'; return; }
  view.innerHTML = renderClients(data);
  bindClients(view);
  view.querySelectorAll<HTMLButtonElement>(".connect-btn").forEach(btn => {
    btn.addEventListener("click", () => { connectedId = btn.dataset["id"] ?? null; void renderTab(); });
  });
}

async function boot(): Promise<void> {
  const me = await api.me();
  if (me.ok) {
    await showPanel();
  } else {
    root.innerHTML = '<div class="hc-root"></div>';
    renderLogin(root.querySelector(".hc-root")!, () => void showPanel());
  }
}

void boot();
