import { api } from "./api.js";

export function renderLogs(): string {
  return `
    <h1>Logs</h1>
    <p class="hc-sub">System event log.</p>
    <div class="hc-card">
      <button class="hc-connect-btn" id="clear-logs" style="margin-bottom:12px">Clear Logs</button>
      <div class="hc-log-list" id="log-list">
        <div class="hc-muted" style="text-align:center;padding:20px">Loading…</div>
      </div>
    </div>`;
}

export function bindLogs(view: HTMLElement): void {
  const list = view.querySelector<HTMLElement>("#log-list")!;

  async function load() {
    try {
      const logs = await api.logs();
      if (logs.length === 0) {
        list.innerHTML = '<div class="hc-muted" style="text-align:center;padding:20px">No logs</div>';
        return;
      }
      list.innerHTML = logs.map(l => `
        <div class="hc-log-row hc-log-${l.type}">
          <span class="hc-log-badge">${l.type.toUpperCase()}</span>
          <span class="hc-log-msg">${l.msg}</span>
          <span class="hc-muted">${new Date(l.ts).toLocaleTimeString()}</span>
        </div>`).join("");
    } catch {
      list.innerHTML = '<div class="hc-muted" style="text-align:center;padding:20px">Failed to load logs</div>';
    }
  }

  view.querySelector("#clear-logs")!.addEventListener("click", async () => {
    await api.clearLogs();
    load();
  });

  load();
}
