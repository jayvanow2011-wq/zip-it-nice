import type { StatsResponse } from "./types.js";

export function renderClients(data: StatsResponse): string {
  return `
    <h1>Clients</h1>
    <p class="hc-sub">${data.clients.length} connected clients.</p>
    <input class="hc-search" id="client-search" placeholder="Search clients…" />
    <div class="hc-card">
      <table class="hc-table">
        <thead>
          <tr><th>ID</th><th>Name</th><th>OS</th><th>IP</th><th>Country</th><th>Status</th><th></th></tr>
        </thead>
        <tbody id="clients-tbody">
          ${data.clients.map(c => clientRow(c)).join("")}
        </tbody>
      </table>
    </div>`;
}

function clientRow(c: any): string {
  return `<tr data-search="${(c.id + c.name + c.ip).toLowerCase()}">
    <td class="hc-mono">${c.id}</td>
    <td>${c.name}</td>
    <td>${c.os}</td>
    <td class="hc-mono">${c.ip}</td>
    <td>${c.country}</td>
    <td><span class="hc-badge ${c.status}">${c.status}</span></td>
    <td><button class="hc-connect-btn connect-btn" data-id="${c.id}">Open</button></td>
  </tr>`;
}

export function bindClients(view: HTMLElement): void {
  const search = view.querySelector<HTMLInputElement>("#client-search");
  const tbody = view.querySelector("#clients-tbody");
  if (search && tbody) {
    search.addEventListener("input", () => {
      const q = search.value.toLowerCase();
      tbody.querySelectorAll<HTMLTableRowElement>("tr").forEach(row => {
        row.style.display = (row.dataset["search"] || "").includes(q) ? "" : "none";
      });
    });
  }
}
