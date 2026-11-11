// SQLite locale per admin portal — usa node:sqlite (built-in Node 22.5+)
// Conformità: Decreto Pisanu (logs 6 mesi) + GDPR (consenso + diritto oblio)

const { DatabaseSync } = require('node:sqlite');
const path = require('path');
const fs   = require('fs');

const DB_DIR  = path.join(__dirname, '..', 'data');
const DB_PATH = path.join(DB_DIR, 'captive_portal.db');

if (!fs.existsSync(DB_DIR)) fs.mkdirSync(DB_DIR, { recursive: true });

const db = new DatabaseSync(DB_PATH);
db.exec('PRAGMA journal_mode = WAL');
db.exec('PRAGMA foreign_keys = ON');

// Schema
db.exec(`
  CREATE TABLE IF NOT EXISTS access_logs (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    email           TEXT    NOT NULL,
    nome            TEXT,
    cognome         TEXT,
    telefono        TEXT,
    mac             TEXT    NOT NULL,
    ip              TEXT,
    ssid            TEXT,
    user_agent      TEXT,
    gdpr_consent    INTEGER NOT NULL DEFAULT 1,
    marketing_consent INTEGER NOT NULL DEFAULT 0,
    consent_version TEXT,
    consent_ip      TEXT,
    authenticated_at TEXT   NOT NULL DEFAULT (datetime('now')),
    disconnected_at TEXT,
    anonymized      INTEGER NOT NULL DEFAULT 0
  );

  CREATE INDEX IF NOT EXISTS idx_access_email      ON access_logs(email);
  CREATE INDEX IF NOT EXISTS idx_access_mac        ON access_logs(mac);
  CREATE INDEX IF NOT EXISTS idx_access_auth_at    ON access_logs(authenticated_at);
  CREATE INDEX IF NOT EXISTS idx_access_anonymized ON access_logs(anonymized);
`);

// ── API ─────────────────────────────────────────────────────────────────────

function logAccess(data) {
    const stmt = db.prepare(`
        INSERT INTO access_logs
        (email, nome, cognome, telefono, mac, ip, ssid, user_agent,
         gdpr_consent, marketing_consent, consent_version, consent_ip)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const r = stmt.run(
        data.email,
        data.nome || null,
        data.cognome || null,
        data.telefono || null,
        data.mac,
        data.ip || null,
        data.ssid || null,
        data.user_agent || null,
        data.gdpr_consent ? 1 : 0,
        data.marketing_consent ? 1 : 0,
        data.consent_version || 'v1.0',
        data.consent_ip || null
    );
    return Number(r.lastInsertRowid);
}

function markDisconnected(mac) {
    db.prepare(`
        UPDATE access_logs SET disconnected_at = datetime('now')
        WHERE mac = ? AND disconnected_at IS NULL
    `).run(mac);
}

function listAccesses({ from, to, search, limit = 100, offset = 0 } = {}) {
    const where = [];
    const params = [];
    if (from)   { where.push("authenticated_at >= ?");                  params.push(from); }
    if (to)     { where.push("authenticated_at <= ?");                  params.push(to); }
    if (search) {
        where.push("(email LIKE ? OR nome LIKE ? OR cognome LIKE ? OR mac LIKE ?)");
        const s = `%${search}%`;
        params.push(s, s, s, s);
    }
    const whereSql = where.length ? 'WHERE ' + where.join(' AND ') : '';

    const rows = db.prepare(`
        SELECT * FROM access_logs ${whereSql}
        ORDER BY authenticated_at DESC LIMIT ? OFFSET ?
    `).all(...params, limit, offset);

    const total = db.prepare(`SELECT COUNT(*) AS n FROM access_logs ${whereSql}`).get(...params).n;
    return { rows, total };
}

function getStats() {
    const total       = db.prepare(`SELECT COUNT(*) AS n FROM access_logs`).get().n;
    const today       = db.prepare(`SELECT COUNT(*) AS n FROM access_logs WHERE date(authenticated_at) = date('now')`).get().n;
    const last7days   = db.prepare(`SELECT COUNT(*) AS n FROM access_logs WHERE authenticated_at >= datetime('now','-7 days')`).get().n;
    const last30days  = db.prepare(`SELECT COUNT(*) AS n FROM access_logs WHERE authenticated_at >= datetime('now','-30 days')`).get().n;
    const uniqueUsers = db.prepare(`SELECT COUNT(DISTINCT email) AS n FROM access_logs WHERE anonymized = 0`).get().n;
    const marketing   = db.prepare(`SELECT COUNT(*) AS n FROM access_logs WHERE marketing_consent = 1 AND anonymized = 0`).get().n;

    const byDay = db.prepare(`
        SELECT date(authenticated_at) AS day, COUNT(*) AS n
        FROM access_logs
        WHERE authenticated_at >= datetime('now','-30 days')
        GROUP BY day ORDER BY day
    `).all();

    return { total, today, last7days, last30days, uniqueUsers, marketing, byDay };
}

// Anonimizzazione GDPR (diritto all'oblio) — mantiene log tecnico per Pisanu
function anonymizeUser(email) {
    const stmt = db.prepare(`
        UPDATE access_logs SET
            email = 'deleted_' || id || '@anonymized.local',
            nome = '[DELETED]',
            cognome = '[DELETED]',
            telefono = NULL,
            marketing_consent = 0,
            anonymized = 1
        WHERE email = ? AND anonymized = 0
    `);
    const r = stmt.run(email);
    return r.changes;
}

// Pulizia retention — cancella record oltre Decreto Pisanu (6 mesi default)
function purgeOldLogs(monthsToKeep = 6) {
    const r = db.prepare(`
        DELETE FROM access_logs
        WHERE authenticated_at < datetime('now', '-${parseInt(monthsToKeep)} months')
    `).run();
    return r.changes;
}

function exportAllForRange(from, to) {
    return db.prepare(`
        SELECT * FROM access_logs
        WHERE authenticated_at BETWEEN ? AND ?
        ORDER BY authenticated_at DESC
    `).all(from, to);
}

// ── Tabella sessioni WiFi (token persistenti — sopravvivono ai riavvii) ───────
db.exec(`
  CREATE TABLE IF NOT EXISTS wifi_sessions (
    mac        TEXT    PRIMARY KEY,
    token      TEXT    NOT NULL,
    email      TEXT,
    expires_at TEXT    NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_sessions_token     ON wifi_sessions(token);
  CREATE INDEX IF NOT EXISTS idx_sessions_expires   ON wifi_sessions(expires_at);
`);

const SESSION_HOURS = parseInt(process.env.SESSION_HOURS || '24');

function saveSession({ mac, token, email }) {
    const expires = new Date(Date.now() + SESSION_HOURS * 3600 * 1000)
        .toISOString().replace('T', ' ').slice(0, 19);
    db.prepare(`
        INSERT INTO wifi_sessions (mac, token, email, expires_at)
        VALUES (?, ?, ?, ?)
        ON CONFLICT(mac) DO UPDATE SET token=excluded.token, email=excluded.email, expires_at=excluded.expires_at
    `).run(mac, token, email || null, expires);
}

function getSession(mac) {
    return db.prepare(`
        SELECT * FROM wifi_sessions
        WHERE mac = ? AND expires_at > datetime('now')
    `).get(mac) || null;
}

function getSessionByToken(token) {
    return db.prepare(`
        SELECT * FROM wifi_sessions
        WHERE token = ? AND expires_at > datetime('now')
    `).get(token) || null;
}

function deleteSession(mac) {
    db.prepare(`DELETE FROM wifi_sessions WHERE mac = ?`).run(mac);
}

function cleanExpiredSessions() {
    return db.prepare(`DELETE FROM wifi_sessions WHERE expires_at <= datetime('now')`).run().changes;
}

function loadActiveSessions() {
    return db.prepare(`SELECT mac, token FROM wifi_sessions WHERE expires_at > datetime('now')`).all();
}

// ── Tabella nav_logs (Syslog dal gateway — Decreto Pisanu) ───────────────────
db.exec(`
  CREATE TABLE IF NOT EXISTS nav_logs (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    logged_at  TEXT    NOT NULL DEFAULT (datetime('now')),
    client_ip  TEXT,
    mac        TEXT,
    email      TEXT,
    domain     TEXT,
    url        TEXT,
    raw        TEXT
  );
  CREATE INDEX IF NOT EXISTS idx_nav_logged_at ON nav_logs(logged_at);
  CREATE INDEX IF NOT EXISTS idx_nav_mac       ON nav_logs(mac);
  CREATE INDEX IF NOT EXISTS idx_nav_email     ON nav_logs(email);
`);

function logNav({ client_ip, mac, email, domain, url, raw }) {
    db.prepare(`
        INSERT INTO nav_logs (client_ip, mac, email, domain, url, raw)
        VALUES (?, ?, ?, ?, ?, ?)
    `).run(client_ip || null, mac || null, email || null, domain || null, url || null, raw || null);
}

// Risolve MAC/email a partire dall'IP (accesso più recente)
function resolveUserByIp(ip) {
    return db.prepare(`
        SELECT mac, email FROM access_logs
        WHERE ip = ? AND anonymized = 0
        ORDER BY authenticated_at DESC LIMIT 1
    `).get(ip) || {};
}

// Risolve email a partire dal MAC
function resolveUserByMac(mac) {
    if (!mac) return {};
    return db.prepare(`
        SELECT email FROM access_logs
        WHERE mac = ? AND anonymized = 0
        ORDER BY authenticated_at DESC LIMIT 1
    `).get(mac) || {};
}

// Aggiorna email/mac nei nav_logs dove mancano (retroattivo)
function resolveNavLogsMissingEmail() {
    // Per IP
    const byIp = db.prepare(`
        SELECT DISTINCT client_ip FROM nav_logs
        WHERE email IS NULL AND client_ip IS NOT NULL
    `).all();
    for (const { client_ip } of byIp) {
        const { mac, email } = resolveUserByIp(client_ip);
        if (email) {
            db.prepare(`UPDATE nav_logs SET email=?, mac=COALESCE(mac,?) WHERE client_ip=? AND email IS NULL`)
              .run(email, mac || null, client_ip);
        }
    }
    // Per MAC (se IP non bastava)
    const byMac = db.prepare(`
        SELECT DISTINCT mac FROM nav_logs
        WHERE email IS NULL AND mac IS NOT NULL
    `).all();
    for (const { mac } of byMac) {
        const { email } = resolveUserByMac(mac);
        if (email) {
            db.prepare(`UPDATE nav_logs SET email=? WHERE mac=? AND email IS NULL`)
              .run(email, mac);
        }
    }
}

function listNavLogs({ from, to, search, limit = 100, offset = 0 } = {}) {
    // Prova a risolvere email mancanti prima di restituire
    resolveNavLogsMissingEmail();

    const where = [];
    const params = [];
    if (from)   { where.push("n.logged_at >= ?"); params.push(from); }
    if (to)     { where.push("n.logged_at <= ?"); params.push(to); }
    if (search) {
        where.push("(COALESCE(n.email, a.email) LIKE ? OR n.mac LIKE ? OR n.domain LIKE ? OR n.url LIKE ?)");
        const s = `%${search}%`;
        params.push(s, s, s, s);
    }
    const whereSql = where.length ? 'WHERE ' + where.join(' AND ') : '';

    // JOIN con access_logs per recuperare email/nome anche se non salvati al momento
    const rows = db.prepare(`
        SELECT
            n.id, n.logged_at, n.client_ip,
            COALESCE(n.mac, a.mac)      AS mac,
            COALESCE(n.email, a.email)  AS email,
            COALESCE(TRIM(a.nome || ' ' || COALESCE(a.cognome,'')), '') AS nome,
            n.domain, n.url
        FROM nav_logs n
        LEFT JOIN access_logs a ON (
            (n.mac IS NOT NULL AND a.mac = n.mac) OR
            (n.client_ip IS NOT NULL AND a.ip = n.client_ip)
        )
        AND a.anonymized = 0
        ${whereSql}
        GROUP BY n.id
        ORDER BY n.logged_at DESC
        LIMIT ? OFFSET ?
    `).all(...params, limit, offset);

    const total = db.prepare(`
        SELECT COUNT(DISTINCT n.id) AS n FROM nav_logs n
        LEFT JOIN access_logs a ON (
            (n.mac IS NOT NULL AND a.mac = n.mac) OR
            (n.client_ip IS NOT NULL AND a.ip = n.client_ip)
        )
        AND a.anonymized = 0
        ${whereSql}
    `).get(...params).n;

    return { rows, total };
}

function purgeOldNavLogs(monthsToKeep = 6) {
    return db.prepare(`DELETE FROM nav_logs WHERE logged_at < datetime('now', '-${parseInt(monthsToKeep)} months')`).run().changes;
}

module.exports = {
    db,
    logAccess,
    markDisconnected,
    listAccesses,
    getStats,
    anonymizeUser,
    purgeOldLogs,
    exportAllForRange,
    logNav,
    resolveUserByIp,
    resolveUserByMac,
    listNavLogs,
    purgeOldNavLogs,
    saveSession,
    getSession,
    getSessionByToken,
    deleteSession,
    cleanExpiredSessions,
    loadActiveSessions
};
