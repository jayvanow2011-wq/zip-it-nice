import { api } from "./api.js";
export function renderLogin(root, onSuccess) {
    let mode = "login";
    let signupKey = null;
    function render() {
        if (signupKey) {
            root.innerHTML = `
        <div class="hc-login-wrap">
          <div class="hc-login-card">
            <div class="hc-brand"><span class="hc-dot"></span> Veltrix</div>
            <p class="hc-version">v3.0.0</p>
            <div style="margin:20px 0 12px;padding:16px;background:rgba(0,212,170,0.08);border:1px solid rgba(0,212,170,0.2);border-radius:8px">
              <div class="hc-success-text" style="font-weight:600;margin-bottom:8px">Account Created</div>
              <div style="font-size:12px;color:var(--hc-muted);margin-bottom:12px">Save this auth key. You can use it to recover your account.</div>
              <div id="auth-key-display" style="font-family:'SF Mono',Menlo,monospace;font-size:13px;background:var(--hc-bg);border:1px solid var(--hc-border);border-radius:6px;padding:10px 12px;word-break:break-all;color:var(--hc-text);cursor:pointer;user-select:all">${signupKey}</div>
              <button class="hc-connect-btn" id="copy-key-btn" style="margin-top:8px;font-size:11px">Copy Key</button>
            </div>
            <p class="hc-warn-text" style="margin:8px 0">This key will NOT be shown again. Save it now.</p>
            <button class="hc-primary" id="continue-login-btn">Continue to Login</button>
          </div>
        </div>`;
            root.querySelector("#copy-key-btn").addEventListener("click", () => navigator.clipboard.writeText(signupKey));
            root.querySelector("#continue-login-btn").addEventListener("click", () => { signupKey = null; mode = "login"; render(); });
            return;
        }
        const tabs = [
            { id: "login", label: "Sign In" },
            { id: "signup", label: "Sign Up" },
            { id: "authkey", label: "Auth Key" },
        ];
        let formHtml = "";
        if (mode === "login") {
            formHtml = `
        <form id="login-form">
          <p class="hc-sub">Sign in to your control panel.</p>
          <label>Username</label>
          <input id="f-user" placeholder="Enter username" autocomplete="username" required />
          <label>Password</label>
          <input type="password" id="f-pass" placeholder="Enter password" autocomplete="current-password" required />
          <p class="hc-error" id="login-error" style="display:none"></p>
          <button type="submit" class="hc-primary" id="login-btn">Sign in</button>
        </form>`;
        } else if (mode === "signup") {
            formHtml = `
        <form id="signup-form">
          <p class="hc-sub">Create a new account. You will receive an auth key for recovery.</p>
          <label>Username</label>
          <input id="f-user" placeholder="Choose username" autocomplete="username" required />
          <label>Password</label>
          <input type="password" id="f-pass" placeholder="Choose password (min 6 chars)" autocomplete="new-password" required />
          <label>Confirm Password</label>
          <input type="password" id="f-pass2" placeholder="Confirm password" autocomplete="new-password" required />
          <p class="hc-error" id="login-error" style="display:none"></p>
          <button type="submit" class="hc-primary" id="signup-btn">Create Account</button>
        </form>`;
        } else {
            formHtml = `
        <form id="authkey-form">
          <p class="hc-sub">Login using your recovery auth key.</p>
          <label>Auth Key</label>
          <input id="f-authkey" placeholder="HC-XXXXXXXXXXXX..." autocomplete="off" required style="font-family:'SF Mono',Menlo,monospace;font-size:12px" />
          <p class="hc-error" id="login-error" style="display:none"></p>
          <button type="submit" class="hc-primary" id="authkey-btn">Login with Auth Key</button>
        </form>`;
        }
        root.innerHTML = `
      <div class="hc-login-wrap">
        <div class="hc-login-card">
          <div class="hc-brand"><span class="hc-dot"></span> Veltrix</div>
          <p class="hc-version">v3.0.0</p>
          <div class="hc-login-tabs">
            ${tabs.map(t => `<button class="hc-login-tab ${mode === t.id ? "active" : ""}" data-mode="${t.id}">${t.label}</button>`).join("")}
          </div>
          ${formHtml}
          <p class="hc-footer">Press Ctrl+K after login for command palette</p>
        </div>
      </div>`;
        root.querySelectorAll(".hc-login-tab").forEach(btn => {
            btn.addEventListener("click", () => { mode = btn.dataset["mode"]; render(); });
        });
        const errEl = root.querySelector("#login-error");
        if (mode === "login") {
            root.querySelector("#login-form").addEventListener("submit", async (e) => {
                e.preventDefault();
                const user = root.querySelector("#f-user").value;
                const pass = root.querySelector("#f-pass").value;
                const btn = root.querySelector("#login-btn");
                btn.disabled = true; btn.textContent = "Signing in..."; errEl.style.display = "none";
                try { await api.login(user, pass); onSuccess(); }
                catch (err) { errEl.textContent = err instanceof Error ? err.message : "Login failed"; errEl.style.display = "block"; btn.disabled = false; btn.textContent = "Sign in"; }
            });
        } else if (mode === "signup") {
            root.querySelector("#signup-form").addEventListener("submit", async (e) => {
                e.preventDefault();
                const user = root.querySelector("#f-user").value;
                const pass = root.querySelector("#f-pass").value;
                const pass2 = root.querySelector("#f-pass2").value;
                if (pass !== pass2) { errEl.textContent = "Passwords do not match"; errEl.style.display = "block"; return; }
                const btn = root.querySelector("#signup-btn");
                btn.disabled = true; btn.textContent = "Creating account..."; errEl.style.display = "none";
                try { const res = await api.signup(user, pass); signupKey = res.authKey; render(); }
                catch (err) { errEl.textContent = err instanceof Error ? err.message : "Signup failed"; errEl.style.display = "block"; btn.disabled = false; btn.textContent = "Create Account"; }
            });
        } else {
            root.querySelector("#authkey-form").addEventListener("submit", async (e) => {
                e.preventDefault();
                const key = root.querySelector("#f-authkey").value;
                const btn = root.querySelector("#authkey-btn");
                btn.disabled = true; btn.textContent = "Verifying..."; errEl.style.display = "none";
                try { await api.loginAuthKey(key); onSuccess(); }
                catch (err) { errEl.textContent = err instanceof Error ? err.message : "Invalid auth key"; errEl.style.display = "block"; btn.disabled = false; btn.textContent = "Login with Auth Key"; }
            });
        }
    }
    render();
}
