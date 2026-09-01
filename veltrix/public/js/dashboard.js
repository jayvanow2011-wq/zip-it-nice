export function renderDashboard(data) {
    const a = data.analytics;
    const cards = [
        { label: "TOTAL CLIENTS", value: a.total },
        { label: "ACTIVE NOW", value: a.online },
        { label: "OFFLINE", value: a.offline },
        { label: "BUILDS", value: a.builds || 0 },
    ];
    const activeClients = data.clients.filter(c => c.status === "online" || c.status === "idle");
    return `
    <div style="display:flex;justify-content:space-between;align-items:center">
      <div>
        <h1>Overview</h1>
        <p class="hc-sub">Live fleet status — past 24 hours.</p>
      </div>
      <div class="hc-realtime-badge"><span class="hc-pulse"></span> Realtime</div>
    </div>

    <div class="hc-overview-grid">
      ${cards.map(c => `
        <div class="hc-overview-card">
          <div class="hc-overview-card-top">
            <span class="hc-overview-label">${c.label}</span>
          </div>
          <div class="hc-overview-value">${c.value}</div>
        </div>`).join("")}
    </div>

    <h2>Last 24 hours</h2>
    <p class="hc-muted" style="margin-top:-8px;margin-bottom:12px">Average CPU and RAM across all clients.</p>
    <div class="hc-card hc-chart-card">
      <div style="display:flex;justify-content:flex-end;gap:16px;margin-bottom:12px">
        <span style="display:flex;align-items:center;gap:4px;font-size:12px">
          <span style="width:8px;height:8px;border-radius:50%;background:var(--hc-green);display:inline-block"></span> CPU
        </span>
        <span style="display:flex;align-items:center;gap:4px;font-size:12px">
          <span style="width:8px;height:8px;border-radius:50%;background:var(--hc-blue);display:inline-block"></span> RAM
        </span>
      </div>
      <div class="hc-chart-placeholder">
        <div class="hc-chart-y">
          ${[100, 75, 50, 25, 0].map(v => `<span>${v}</span>`).join("")}
        </div>
        <div class="hc-chart-area"><div class="hc-chart-line"></div></div>
      </div>
      <div class="hc-chart-x">
        ${["18:00", "22:00", "02:00", "06:00", "10:00", "14:00"].map(t => `<span>${t}</span>`).join("")}
      </div>
    </div>

    <h2>Active clients</h2>
    <div class="hc-card">
      ${activeClients.length === 0
        ? '<div class="hc-muted" style="text-align:center;padding:20px">No active clients</div>'
        : activeClients.map(c => `
          <div class="hc-active-client-row">
            <div style="display:flex;align-items:center;gap:10px">
              <div class="hc-status-dot ${c.status === "online" ? "hc-online" : "hc-idle-dot"}"></div>
              <div>
                <div style="font-weight:500;font-size:14px">${c.name}</div>
                <div class="hc-muted" style="font-size:12px">${c.name} / ${c.ip}</div>
              </div>
            </div>
            <button class="hc-open-btn dash-open-btn" data-id="${c.id}">Open</button>
          </div>`).join("")}
    </div>`;
}
