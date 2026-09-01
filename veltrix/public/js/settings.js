import { api } from "./api.js";

export function renderSettings() {
    const currentTheme = localStorage.getItem("hc-theme") || "dark";
    return `
    <h1>Settings</h1>
    <p class="hc-sub">Configure your panel preferences.</p>

    <div class="hc-card" style="max-width:520px">
      <h3 class="hc-section-title">Theme</h3>
      <p class="hc-muted" style="margin-bottom:12px;font-size:12px">
        Choose between dark and light mode.
      </p>
      <div style="display:flex;gap:8px">
        <button class="hc-connect-btn theme-btn ${currentTheme === "dark" ? "active" : ""}" data-theme="dark" style="flex:1;padding:10px">Dark</button>
        <button class="hc-connect-btn theme-btn ${currentTheme === "light" ? "active" : ""}" data-theme="light" style="flex:1;padding:10px">Light</button>
      </div>
    </div>

    <div class="hc-card" style="max-width:520px">
      <h3 class="hc-section-title">Discord Webhook</h3>
      <p class="hc-muted" style="margin-bottom:12px;font-size:12px">
        Get notified when a new client connects, builds are created, and more.
      </p>
      <label>Webhook URL</label>
      <input id="s-webhook" placeholder="https://discord.com/api/webhooks/..." />
      <div style="display:flex;gap:8px">
        <button class="hc-primary" id="s-save" style="flex:1">Save</button>
        <button class="hc-connect-btn" id="s-test" style="padding:10px 16px" disabled>Test Webhook</button>
      </div>
      <div id="s-msg" class="hc-muted" style="margin-top:10px;font-size:12px"></div>
    </div>

    <div class="hc-card" style="max-width:520px">
      <h3 class="hc-section-title">Webhook Events</h3>
      <div class="hc-info-row"><span>New client connected</span><span class="hc-muted">@everyone ping</span></div>
      <div class="hc-info-row"><span>Build created</span><span class="hc-muted">Build details embed</span></div>
      <div class="hc-info-row"><span>Client went offline</span><span class="hc-muted">Status change alert</span></div>
      <div class="hc-info-row"><span>Login attempt</span><span class="hc-muted">Security alert</span></div>
    </div>`;
}

export function bindSettings(view) {
    // Theme
    view.querySelectorAll(".theme-btn").forEach(btn => {
        btn.addEventListener("click", () => {
            const theme = btn.dataset["theme"];
            localStorage.setItem("hc-theme", theme);
            document.documentElement.setAttribute("data-theme", theme);
            document.body.style.background = "";
            view.querySelectorAll(".theme-btn").forEach(b => b.classList.remove("active"));
            btn.classList.add("active");
        });
    });

    // Webhook
    const webhookInput = view.querySelector("#s-webhook");
    const saveBtn = view.querySelector("#s-save");
    const testBtn = view.querySelector("#s-test");
    const msgEl = view.querySelector("#s-msg");
    api.settings().then(s => {
        webhookInput.value = s.webhookUrl || "";
        testBtn.disabled = !webhookInput.value;
    }).catch(() => {});
    webhookInput.addEventListener("input", () => { testBtn.disabled = !webhookInput.value; });
    saveBtn.addEventListener("click", async () => {
        saveBtn.disabled = true; saveBtn.textContent = "Saving..."; msgEl.textContent = "";
        try { await api.saveSettings({ webhookUrl: webhookInput.value }); msgEl.textContent = "Settings saved."; }
        catch (e) { msgEl.textContent = e instanceof Error ? e.message : "Failed"; }
        saveBtn.disabled = false; saveBtn.textContent = "Save";
    });
    testBtn.addEventListener("click", async () => {
        testBtn.disabled = true; testBtn.textContent = "Sending..."; msgEl.textContent = "";
        try { await api.testWebhook(); msgEl.textContent = "Webhook sent. Check your Discord."; }
        catch (e) { msgEl.textContent = e instanceof Error ? e.message : "Webhook failed"; }
        testBtn.disabled = false; testBtn.textContent = "Test Webhook";
    });
}
