import { api } from "./api.js";

const PLANS = [
    { id: "30d", name: "30 Days", price: "$18", priceCents: 1800, detail: "30 days of full access" },
    { id: "3mo", name: "3 Months", price: "$30", priceCents: 3000, detail: "90 days of full access" },
    { id: "lifetime", name: "Lifetime", price: "$50", priceCents: 5000, detail: "Unlimited access forever" },
];

const CRYPTOS = [
    { id: "btc", name: "Bitcoin", symbol: "BTC" },
    { id: "eth", name: "Ethereum", symbol: "ETH" },
    { id: "ltc", name: "Litecoin", symbol: "LTC" },
];

export function renderSubscription() {
    return `
    <h1>Subscription</h1>
    <p class="hc-sub">Manage your subscription and purchase access time.</p>
    <div id="sub-status"></div>
    <div id="sub-purchase"></div>
    <div id="sub-orders"></div>`;
}

export function bindSubscription(view, opts) {
    const statusEl = view.querySelector("#sub-status");
    const purchaseEl = view.querySelector("#sub-purchase");
    const ordersEl = view.querySelector("#sub-orders");

    let selectedPlan = null;
    let selectedCrypto = null;
    let currentOrder = null;
    let step = "plan"; // plan -> crypto -> pay -> done

    function renderStatus() {
        if (opts.isAdmin) {
            statusEl.innerHTML = `<div class="hc-card" style="max-width:520px"><div class="hc-info-row"><span>Status</span><span class="hc-badge active-sub">ADMIN — Unlimited</span></div></div>`;
            return;
        }
        let statusText, badge;
        if (opts.subExpires === -1) {
            statusText = "Lifetime";
            badge = "active-sub";
        } else if (opts.subExpires && opts.subExpires > Date.now()) {
            const days = Math.ceil((opts.subExpires - Date.now()) / (1000 * 60 * 60 * 24));
            statusText = `${days} days remaining`;
            badge = "active-sub";
        } else {
            statusText = "No active subscription";
            badge = "expired-sub";
        }
        statusEl.innerHTML = `<div class="hc-card" style="max-width:520px"><div class="hc-info-row"><span>Status</span><span class="hc-badge ${badge}">${statusText}</span></div></div>`;
    }

    function renderPurchase() {
        if (step === "plan") {
            purchaseEl.innerHTML = `
            <h2>Choose a plan</h2>
            <div class="hc-plan-grid">
              ${PLANS.map(p => `
                <div class="hc-plan-card ${selectedPlan === p.id ? "selected" : ""}" data-plan="${p.id}">
                  <div class="plan-name">${p.name}</div>
                  <div class="plan-price">${p.price}</div>
                  <div class="plan-detail">${p.detail}</div>
                </div>`).join("")}
            </div>
            <button class="hc-primary" id="sub-next-crypto" style="max-width:520px" ${!selectedPlan ? "disabled" : ""}>Next — Select Crypto</button>`;
            purchaseEl.querySelectorAll(".hc-plan-card").forEach(card => {
                card.addEventListener("click", () => {
                    selectedPlan = card.dataset["plan"];
                    renderPurchase();
                });
            });
            const nextBtn = purchaseEl.querySelector("#sub-next-crypto");
            if (nextBtn) nextBtn.addEventListener("click", () => {
                if (opts.subExpires === -1 && selectedPlan !== "lifetime") {
                    // They have lifetime already
                }
                if (opts.subExpires === -1) {
                    purchaseEl.innerHTML = `
                    <div class="hc-card" style="max-width:520px;text-align:center;padding:24px">
                      <div style="font-size:16px;font-weight:600;margin-bottom:8px">You already have lifetime access</div>
                      <div class="hc-muted">You're set forever. But hey, donations are always welcome!</div>
                    </div>`;
                    return;
                }
                step = "crypto";
                renderPurchase();
            });
            return;
        }

        if (step === "crypto") {
            const plan = PLANS.find(p => p.id === selectedPlan);
            purchaseEl.innerHTML = `
            <h2>Select cryptocurrency</h2>
            <p class="hc-muted" style="margin-bottom:16px">Plan: <strong>${plan.name}</strong> — ${plan.price}</p>
            <div class="hc-crypto-grid">
              ${CRYPTOS.map(c => `
                <button class="hc-crypto-btn ${selectedCrypto === c.id ? "selected" : ""}" data-crypto="${c.id}">
                  <div>${c.name}</div>
                  <div class="crypto-symbol">${c.symbol}</div>
                </button>`).join("")}
            </div>
            <div style="display:flex;gap:8px;max-width:520px">
              <button class="hc-secondary" id="sub-back-plan" style="flex:1">Back</button>
              <button class="hc-primary" id="sub-next-pay" style="flex:1" ${!selectedCrypto ? "disabled" : ""}>Next — Payment Details</button>
            </div>`;
            purchaseEl.querySelectorAll(".hc-crypto-btn").forEach(btn => {
                btn.addEventListener("click", () => {
                    selectedCrypto = btn.dataset["crypto"];
                    renderPurchase();
                });
            });
            purchaseEl.querySelector("#sub-back-plan").addEventListener("click", () => { step = "plan"; renderPurchase(); });
            const nextBtn = purchaseEl.querySelector("#sub-next-pay");
            if (nextBtn) nextBtn.addEventListener("click", async () => {
                nextBtn.disabled = true; nextBtn.textContent = "Creating order...";
                try {
                    const res = await api.createOrder(selectedPlan, selectedCrypto);
                    currentOrder = res;
                    step = "pay";
                    renderPurchase();
                } catch (err) {
                    nextBtn.disabled = false; nextBtn.textContent = "Next — Payment Details";
                    alert(err instanceof Error ? err.message : "Failed to create order");
                }
            });
            return;
        }

        if (step === "pay") {
            const crypto = CRYPTOS.find(c => c.id === selectedCrypto);
            purchaseEl.innerHTML = `
            <h2>Complete Payment</h2>
            <div class="hc-payment-box" style="max-width:520px">
              <div class="hc-muted" style="margin-bottom:8px">Send exactly:</div>
              <div class="hc-payment-amount">${currentOrder.amount} ${crypto.symbol}</div>
              <div class="hc-muted" style="margin-bottom:8px">to this ${crypto.name} address:</div>
              <div class="hc-payment-address" id="pay-address" title="Click to copy">${currentOrder.address}</div>
              <button class="hc-connect-btn" id="copy-address" style="margin-bottom:16px">Copy Address</button>
              <div style="margin-top:16px">
                <button class="hc-primary" id="sub-mark-paid" style="max-width:320px">I have paid</button>
              </div>
              <div class="hc-muted" style="margin-top:12px;font-size:11px">Order ID: ${currentOrder.orderId}</div>
            </div>
            <div style="max-width:520px">
              <button class="hc-secondary" id="sub-back-crypto" style="width:100%">Back</button>
            </div>`;
            purchaseEl.querySelector("#copy-address").addEventListener("click", () => {
                navigator.clipboard.writeText(currentOrder.address);
            });
            purchaseEl.querySelector("#sub-back-crypto").addEventListener("click", () => { step = "crypto"; renderPurchase(); });
            purchaseEl.querySelector("#sub-mark-paid").addEventListener("click", async () => {
                const btn = purchaseEl.querySelector("#sub-mark-paid");
                btn.disabled = true; btn.textContent = "Verifying...";
                try {
                    const res = await api.markPaid(currentOrder.orderId);
                    step = "done";
                    currentOrder = { ...currentOrder, ...res };
                    renderPurchase();
                    loadOrders();
                } catch (err) {
                    btn.disabled = false; btn.textContent = "I have paid";
                    alert(err instanceof Error ? err.message : "Verification failed");
                }
            });
            return;
        }

        if (step === "done") {
            const status = currentOrder.status === "verified" ? "Verified — access granted" : "Pending verification";
            const badgeClass = currentOrder.status === "verified" ? "active-sub" : "idle";
            purchaseEl.innerHTML = `
            <div class="hc-card" style="max-width:520px;text-align:center;padding:24px">
              <div style="font-size:16px;font-weight:600;margin-bottom:8px">${status}</div>
              <div class="hc-muted" style="margin-bottom:12px">Order ID: <span class="hc-mono">${currentOrder.orderId}</span></div>
              <span class="hc-badge ${badgeClass}">${currentOrder.status?.toUpperCase() || "PENDING"}</span>
              <div style="margin-top:16px">
                <button class="hc-primary" id="sub-new-order" style="max-width:320px">New Purchase</button>
              </div>
            </div>`;
            purchaseEl.querySelector("#sub-new-order").addEventListener("click", () => {
                step = "plan"; selectedPlan = null; selectedCrypto = null; currentOrder = null;
                renderPurchase();
            });
            return;
        }
    }

    async function loadOrders() {
        try {
            const res = await api.orders();
            const orders = res.orders || [];
            if (orders.length === 0) { ordersEl.innerHTML = ""; return; }
            ordersEl.innerHTML = `
            <h2>Order History</h2>
            <div class="hc-card" style="max-width:720px">
              ${orders.map(o => `
                <div class="hc-order-row">
                  <div>
                    <div style="font-weight:500">${o.planName}</div>
                    <div class="hc-muted" style="font-size:11px">${o.crypto.toUpperCase()} — ${new Date(o.createdAt).toLocaleDateString()}</div>
                  </div>
                  <div style="text-align:right">
                    <span class="hc-badge ${o.status === "verified" ? "active-sub" : o.status === "pending" ? "idle" : "expired-sub"}">${o.status.toUpperCase()}</span>
                    <div class="hc-mono hc-muted" style="font-size:10px;margin-top:2px">${o.orderId}</div>
                  </div>
                </div>`).join("")}
            </div>`;
        } catch { ordersEl.innerHTML = ""; }
    }

    renderStatus();
    renderPurchase();
    loadOrders();
}
