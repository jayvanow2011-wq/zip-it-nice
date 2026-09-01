function getCsrf() {
    const m = document.cookie.match(/(?:^|;\s*)hc_csrf=([^;]+)/);
    return m ? decodeURIComponent(m[1] ?? "") : "";
}
async function post(url, body) {
    const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-CSRF-Token": getCsrf() },
        body: JSON.stringify(body ?? {}),
    });
    const data = (await res.json());
    if (!res.ok)
        throw new Error(data.error || "Request failed");
    return data;
}
async function del(url) {
    const res = await fetch(url, {
        method: "DELETE",
        headers: { "X-CSRF-Token": getCsrf() },
    });
    const data = (await res.json());
    if (!res.ok)
        throw new Error(data.error || "Request failed");
    return data;
}
export const api = {
    async me() {
        const res = await fetch("/api/me");
        if (!res.ok)
            return { ok: false };
        return res.json();
    },
    login(username, password) {
        return post("/api/login", { username, password });
    },
    signup(username, password) {
        return post("/api/signup", { username, password });
    },
    loginAuthKey(authKey) {
        return post("/api/login-authkey", { authKey });
    },
    logout() {
        return post("/api/logout");
    },
    async stats() {
        const res = await fetch("/api/stats");
        if (!res.ok)
            throw new Error("Not authorized");
        return (await res.json());
    },
    async client(id) {
        const res = await fetch(`/api/client/${encodeURIComponent(id)}`);
        if (!res.ok)
            throw new Error("Client not found");
        return (await res.json());
    },
    async logs() {
        const res = await fetch("/api/logs");
        if (!res.ok)
            throw new Error("Not authorized");
        const data = (await res.json());
        return data.logs;
    },
    clearLogs() {
        return post("/api/logs");
    },
    sendCommand(clientId, action, shell) {
        return post(`/api/command/${encodeURIComponent(clientId)}`, { action, shell });
    },
    build(cfg) {
        return post("/api/build", cfg);
    },
    deleteBuild(id) {
        return del(`/api/build/${encodeURIComponent(id)}`);
    },
    async builds() {
        const res = await fetch("/api/builds");
        if (!res.ok)
            throw new Error("Not authorized");
        const data = (await res.json());
        return data.builds;
    },
    async settings() {
        const res = await fetch("/api/settings");
        if (!res.ok)
            throw new Error("Not authorized");
        return res.json();
    },
    saveSettings(data) {
        return post("/api/settings", data);
    },
    testWebhook() {
        return post("/api/settings/test-webhook");
    },
    // Subscription
    async subscription() {
        const res = await fetch("/api/subscription");
        if (!res.ok) throw new Error("Not authorized");
        return res.json();
    },
    createOrder(planId, crypto) {
        return post("/api/subscription/order", { planId, crypto });
    },
    markPaid(orderId) {
        return post("/api/subscription/paid", { orderId });
    },
    async orders() {
        const res = await fetch("/api/subscription/orders");
        if (!res.ok) throw new Error("Not authorized");
        return res.json();
    },
};
