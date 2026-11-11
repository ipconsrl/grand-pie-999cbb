// Admin routes — login, dashboard, lista, export, anonimizzazione
const express    = require('express');
const path       = require('path');
const crypto     = require('crypto');
const db         = require('./db');
const syslogBuf  = require('./syslog-buffer');

const router = express.Router();

// ── Auth ────────────────────────────────────────────────────────────────────
// Credenziali da .env. Sessione semplice via cookie firmato (HMAC) — no JWT lib

const ADMIN_USER   = process.env.ADMIN_USER     || 'admin';
const ADMIN_PASS   = process.env.ADMIN_PASSWORD || 'admin';
const ADMIN_SECRET = process.env.ADMIN_SECRET   || crypto.randomBytes(32).toString('hex');
const COOKIE_NAME  = 'admin_session';
const SESSION_TTL  = 8 * 60 * 60 * 1000; // 8 ore

// IP whitelist per /admin (vuota = nessuna restrizione)
const ADMIN_ALLOWED_IPS = (process.env.ADMIN_ALLOWED_IPS || '')
    .split(',').map(s => s.trim()).filter(Boolean);

function requireAllowedIp(req, res, next) {
    if (!ADMIN_ALLOWED_IPS.length) return next(); // nessuna restrizione
    const ip = (req.headers['x-forwarded-for'] || req.ip || '').split(',')[0].trim();
    const clean = ip.replace(/^::ffff:/, ''); // normalizza IPv4-mapped
    if (ADMIN_ALLOWED_IPS.includes(clean)) return next();
    console.warn(`[Admin] Accesso negato da IP: ${clean}`);
    res.status(403).send('Accesso non autorizzato.');
}

function sign(payload) {
    const data = Buffer.from(JSON.stringify(payload)).toString('base64url');
    const sig  = crypto.createHmac('sha256', ADMIN_SECRET).update(data).digest('base64url');
    return `${data}.${sig}`;
}

function verify(token) {
    if (!token || !token.includes('.')) return null;
    const [data, sig] = token.split('.');
    const expected = crypto.createHmac('sha256', ADMIN_SECRET).update(data).digest('base64url');
    if (sig !== expected) return null;
    try {
        const payload = JSON.parse(Buffer.from(data, 'base64url').toString());
        if (payload.exp < Date.now()) return null;
        return payload;
    } catch { return null; }
}

function parseCookies(req) {
    const out = {};
    const h = req.headers.cookie || '';
    h.split(';').forEach(c => {
        const [k, ...v] = c.trim().split('=');
        if (k) out[k] = decodeURIComponent(v.join('='));
    });
    return out;
}

function requireAuth(req, res, next) {
    const cookies = parseCookies(req);
    const session = verify(cookies[COOKIE_NAME]);
    if (!session) {
        if (req.path.startsWith('/api/')) return res.status(401).json({ error: 'Non autenticato' });
        return res.redirect('/admin/login');
    }
    req.admin = session;
    next();
}

// Applica IP whitelist a tutte le route /admin
router.use(requireAllowedIp);

// ── Login ───────────────────────────────────────────────────────────────────
router.get('/login', (req, res) => {
    res.sendFile(path.join(__dirname, '..', 'views', 'admin', 'login.html'));
});

router.post('/login', express.urlencoded({ extended: true }), (req, res) => {
    const { username, password } = req.body || {};
    if (username !== ADMIN_USER || password !== ADMIN_PASS) {
        return res.redirect('/admin/login?err=1');
    }
    const token = sign({ user: username, exp: Date.now() + SESSION_TTL });
    res.set('Set-Cookie', `${COOKIE_NAME}=${encodeURIComponent(token)}; Path=/admin; HttpOnly; SameSite=Strict; Max-Age=${SESSION_TTL/1000}`);
    res.redirect('/admin');
});

router.post('/logout', (req, res) => {
    res.set('Set-Cookie', `${COOKIE_NAME}=; Path=/admin; HttpOnly; Max-Age=0`);
    res.redirect('/admin/login');
});

// ── Dashboard ───────────────────────────────────────────────────────────────
router.get('/', requireAuth, (req, res) => {
    res.sendFile(path.join(__dirname, '..', 'views', 'admin', 'dashboard.html'));
});

// ── API ─────────────────────────────────────────────────────────────────────
router.get('/api/stats', requireAuth, (req, res) => {
    res.json(db.getStats());
});

router.get('/api/list', requireAuth, (req, res) => {
    const { from, to, search, page = '1', limit = '50' } = req.query;
    const lim = Math.min(parseInt(limit) || 50, 500);
    const off = (Math.max(parseInt(page) || 1, 1) - 1) * lim;
    res.json(db.listAccesses({ from, to, search, limit: lim, offset: off }));
});

router.get('/api/export', requireAuth, (req, res) => {
    const from = req.query.from || '1970-01-01';
    const to   = req.query.to   || '9999-12-31';
    const rows = db.exportAllForRange(from, to);

    const headers = ['ID','Email','Nome','Cognome','Telefono','MAC','IP','SSID','GDPR','Marketing','Versione','IP consenso','Autenticato','Disconnesso','Anonimizzato'];
    const csv = [
        headers.join(';'),
        ...rows.map(r => [
            r.id, r.email, r.nome, r.cognome, r.telefono, r.mac, r.ip, r.ssid,
            r.gdpr_consent, r.marketing_consent, r.consent_version, r.consent_ip,
            r.authenticated_at, r.disconnected_at, r.anonymized
        ].map(v => v == null ? '' : String(v).replace(/[;\n\r]/g,' ')).join(';'))
    ].join('\n');

    res.set('Content-Type', 'text/csv; charset=utf-8');
    res.set('Content-Disposition', `attachment; filename="accessi_${from}_${to}.csv"`);
    res.send('﻿' + csv); // BOM per Excel
});

router.post('/api/anonymize', requireAuth, express.json(), (req, res) => {
    const { email } = req.body || {};
    if (!email) return res.status(400).json({ error: 'Email obbligatoria' });
    const changes = db.anonymizeUser(email);
    res.json({ success: true, anonymizedRecords: changes });
});

// ── Nav Logs API ─────────────────────────────────────────────────────────────
router.get('/api/navlogs', requireAuth, (req, res) => {
    const { from, to, search, page = '1', limit = '100' } = req.query;
    const lim = Math.min(parseInt(limit) || 100, 1000);
    const off = (Math.max(parseInt(page) || 1, 1) - 1) * lim;
    res.json(db.listNavLogs({ from, to, search, limit: lim, offset: off }));
});

router.get('/api/navlogs/export', requireAuth, (req, res) => {
    const from = req.query.from || '1970-01-01';
    const to   = req.query.to   || '9999-12-31';
    const rows = db.listNavLogs({ from, to, limit: 100000 }).rows;
    const headers = ['ID','Data','IP','MAC','Email','Dominio','URL'];
    const csv = [
        headers.join(';'),
        ...rows.map(r => [r.id, r.logged_at, r.client_ip, r.mac, r.email, r.domain, r.url]
            .map(v => v == null ? '' : String(v).replace(/[;\n\r]/g,' ')).join(';'))
    ].join('\n');
    res.set('Content-Type', 'text/csv; charset=utf-8');
    res.set('Content-Disposition', `attachment; filename="navigazione_${from}_${to}.csv"`);
    res.send('﻿' + csv);
});

// ── Syslog debug (ultimi messaggi raw ricevuti) ──────────────────────────────
router.get('/api/navlogs/debug', requireAuth, (req, res) => {
    res.json({
        count: syslogBuf.buffer.length,
        messages: [...syslogBuf.buffer].reverse() // più recenti prima
    });
});

module.exports = { router, requireAuth };
