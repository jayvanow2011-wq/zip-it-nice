import { api } from "./api.js";
import { renderLogin } from "./login.js";
import { renderDashboard } from "./dashboard.js";
import { renderClients, bindClients } from "./clients.js";
import { renderBuilder, bindBuilder } from "./builder.js";
import { renderAdminControl, bindAdminControl } from "./admin-control.js";
import { renderLogs, bindLogs } from "./logs.js";
import { renderSettings, bindSettings } from "./settings.js";
import { renderSubscription, bindSubscription } from "./subscription.js";

const root = document.getElementById("app");

const TABS = [
    { id: "overview", label: "Overview" },
    { id: "clients", label: "Clients" },
    { id: "builder", label: "Builder" },
    { id: "chat", label: "Chat" },
    { id: "notifications", label: "Logs" },
    { id: "subscription", label: "Subscription" },
    { id: "settings", label: "Settings" },
    { id: "admin", label: "Admin" },
];

let currentTab = "overview";
let connectedId = null;
let data = null;
let sessionStart = Date.now();
let currentUser = "user";
let currentUserId = 0;
let isAdmin = false;
let subExpires = null; // null = no sub, 0 = expired, timestamp = active, -1 = lifetime

function getTheme() {
    return localStorage.getItem("hc-theme") || "dark";
}
function applyTheme() {
    document.documentElement.setAttribute("data-theme", getTheme());
    document.body.style.background = "";
}
applyTheme();

function hasActiveSub() {
    if (isAdmin) return true;
    if (subExpires === -1) return true; // lifetime
    if (subExpires && subExpires > Date.now()) return true;
    return false;
}

function getAllowedTabs() {
    if (hasActiveSub()) return TABS;
    return TABS.filter(t => t.id === "settings" || t.id === "subscription");
}

async function showPanel() {
    try {
        const me = await api.me();
        if (me.ok && me.user) {
            currentUser = me.user;
            currentUserId = me.userId || 0;
            isAdmin = !!me.isAdmin;
            subExpires = me.subExpires ?? null;
        }
    } catch {}
    const allowed = getAllowedTabs();
    if (!allowed.find(t => t.id === currentTab)) {
        currentTab = allowed[0]?.id || "subscription";
    }
    if (hasActiveSub()) {
        try { data = await api.stats(); } catch {}
    }
    sessionStart = Date.now();
    root.innerHTML = `
    <div class="hc-root">
      <div class="hc-topbar">
        <div class="hc-topbar-left">
          <div class="hc-brand"><span class="hc-dot"></span> Veltrix</div>
        </div>
        <nav class="hc-topnav">
          ${allowed.map(t => `<button class="hc-topnav-btn ${t.id === currentTab ? "active" : ""}" data-tab="${t.id}">${t.label}</button>`).join("")}
        </nav>
        <div class="hc-topbar-right">
          <div class="hc-mono hc-muted" style="font-size:11px"><span id="session-timer">00:00:00</span></div>
          <div class="hc-topbar-user">
            <div class="hc-status-dot hc-online"></div>
            <span>${currentUser}</span>
            ${isAdmin ? '<span class="hc-badge admin" style="margin-left:4px">ADMIN</span>' : ''}
          </div>
          <button class="hc-logout-btn" id="logout" title="Sign out">Exit</button>
        </div>
      </div>
      <main class="hc-main" id="view"></main>
      <div class="cmd-palette-overlay" id="cmd-overlay" style="display:none">
        <div class="cmd-palette">
          <input id="cmd-input" placeholder="Type a command... (Ctrl+K)" />
          <div id="cmd-results" class="cmd-results"></div>
        </div>
      </div>
    </div>`;

    root.querySelectorAll(".hc-topnav-btn").forEach(btn => {
        btn.addEventListener("click", () => {
            currentTab = btn.dataset["tab"];
            connectedId = null;
            root.querySelectorAll(".hc-topnav-btn").forEach(b => b.classList.remove("active"));
            btn.classList.add("active");
            renderTab();
        });
    });
    root.querySelector("#logout").addEventListener("click", async () => {
        await api.logout();
        boot();
    });
    const timerEl = root.querySelector("#session-timer");
    setInterval(() => {
        const elapsed = Math.floor((Date.now() - sessionStart) / 1000);
        const h = String(Math.floor(elapsed / 3600)).padStart(2, "0");
        const m = String(Math.floor((elapsed % 3600) / 60)).padStart(2, "0");
        const s = String(elapsed % 60).padStart(2, "0");
        timerEl.textContent = `${h}:${m}:${s}`;
    }, 1000);

    if (hasActiveSub()) {
        setInterval(async () => {
            try { data = await api.stats(); } catch {}
        }, 10000);
    }
    setupCommandPalette();
    renderTab();
}

function setupCommandPalette() {
    const overlay = document.getElementById("cmd-overlay");
    const input = document.getElementById("cmd-input");
    const results = document.getElementById("cmd-results");
    const commands = [
        { label: "Go to Overview", action: () => { currentTab = "overview"; connectedId = null; renderTab(); } },
        { label: "Go to Clients", action: () => { currentTab = "clients"; connectedId = null; renderTab(); } },
        { label: "Go to Builder", action: () => { currentTab = "builder"; connectedId = null; renderTab(); } },
        { label: "Go to Logs", action: () => { currentTab = "notifications"; connectedId = null; renderTab(); } },
        { label: "Go to Settings", action: () => { currentTab = "settings"; connectedId = null; renderTab(); } },
        { label: "Go to Subscription", action: () => { currentTab = "subscription"; connectedId = null; renderTab(); } },
        { label: "Refresh Data", action: async () => { if (hasActiveSub()) data = await api.stats(); renderTab(); } },
        { label: "Sign Out", action: async () => { await api.logout(); boot(); } },
    ];
    function show() { overlay.style.display = "flex"; input.value = ""; input.focus(); renderCommands(""); }
    function hide() { overlay.style.display = "none"; }
    function renderCommands(q) {
        const filtered = commands.filter(c => c.label.toLowerCase().includes(q.toLowerCase()));
        results.innerHTML = filtered.map((c, i) => `<div class="cmd-item${i === 0 ? " active" : ""}" data-idx="${i}">${c.label}</div>`).join("");
        results.querySelectorAll(".cmd-item").forEach(el => {
            el.addEventListener("click", () => {
                const idx = Number(el.dataset["idx"]);
                const filtered2 = commands.filter(c2 => c2.label.toLowerCase().includes((input.value ?? "").toLowerCase()));
                filtered2[idx]?.action();
                hide();
            });
        });
    }
    input.addEventListener("input", () => renderCommands(input.value));
    input.addEventListener("keydown", (e) => { if (e.key === "Escape") hide(); if (e.key === "Enter") results.querySelector(".cmd-item")?.click(); });
    overlay.addEventListener("click", (e) => { if (e.target === overlay) hide(); });
    document.addEventListener("keydown", (e) => { if ((e.ctrlKey || e.metaKey) && e.key === "k") { e.preventDefault(); overlay.style.display === "none" ? show() : hide(); } });
}

async function renderTab() {
    const view = root.querySelector("#view");
    if (!hasActiveSub() && currentTab !== "settings" && currentTab !== "subscription") {
        currentTab = "subscription";
    }

    if (currentTab === "overview") {
        if (!data) { view.innerHTML = '<div class="hc-card">Loading...</div>'; return; }
        view.innerHTML = renderDashboard(data);
        view.querySelectorAll(".dash-open-btn").forEach(btn => {
            btn.addEventListener("click", () => {
                connectedId = btn.dataset["id"] ?? null;
                currentTab = "clients";
                root.querySelectorAll(".hc-topnav-btn").forEach(b => b.classList.toggle("active", b.dataset["tab"] === "clients"));
                void renderTab();
            });
        });
        return;
    }
    if (currentTab === "builder") {
        view.innerHTML = renderBuilder();
        bindBuilder(view);
        return;
    }
    if (currentTab === "chat") {
        view.innerHTML = `
      <h1>Chat</h1>
      <p class="hc-sub">Communicate with connected clients.</p>
      <div class="hc-card" style="min-height:300px">
        <div class="hc-muted" style="text-align:center;padding:40px">
          <div style="font-size:14px;margin-bottom:8px;font-weight:500">No active sessions</div>
          <div>Connect to a client to start a chat.</div>
        </div>
      </div>`;
        return;
    }
    if (currentTab === "notifications") {
        view.innerHTML = `<h1>Logs</h1><p class="hc-sub">System event log.</p>`;
        const logsContainer = document.createElement("div");
        view.appendChild(logsContainer);
        logsContainer.innerHTML = renderLogs();
        bindLogs(logsContainer);
        return;
    }
    if (currentTab === "subscription") {
        view.innerHTML = renderSubscription();
        bindSubscription(view, { isAdmin, subExpires });
        return;
    }
    if (currentTab === "settings") {
        view.innerHTML = renderSettings();
        bindSettings(view);
        return;
    }
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
        view.innerHTML = `<div class="hc-card" style="text-align:center;padding:40px"><div class="hc-muted">Connecting to ${connectedId}...</div></div>`;
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
    if (!data) { view.innerHTML = '<div class="hc-card">Loading...</div>'; return; }
    view.innerHTML = renderClients(data);
    bindClients(view);
    view.querySelectorAll(".connect-btn").forEach(btn => {
        btn.addEventListener("click", () => { connectedId = btn.dataset["id"] ?? null; void renderTab(); });
    });
}

async function boot() {
    applyTheme();
    const me = await api.me();
    if (me.ok) {
        await showPanel();
    } else {
        root.innerHTML = '<div class="hc-root"></div>';
        renderLogin(root.querySelector(".hc-root"), () => void showPanel());
    }
}
void boot();
