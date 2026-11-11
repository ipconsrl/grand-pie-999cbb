// Server di test locale — flusso completo senza database
// Usa memoria RAM al posto di SQLite: perfetto per test con Ruijie gateway
// Avvio: node test-local.js
// Poi configura Auth Server URL su Ruijie Cloud = http://TUO_IP:3000

require('dotenv').config();
const express      = require('express');
const nodemailer   = require('nodemailer');
const path         = require('path');
const crypto       = require('crypto');
const dgram        = require('dgram');
const fs           = require('fs');
const adminDb      = require('./admin/db');
const adminRoutes  = require('./admin/routes');
const syslogBuf    = require('./admin/syslog-buffer');

const app  = express();
const PORT = process.env.PORT || 3000;

// ── Log su file giornaliero ───────────────────────────────────────────────────
const LOG_DIR      = path.join(__dirname, 'logs');
const LOG_KEEP     = parseInt(process.env.LOG_KEEP_DAYS || '7');
if (!fs.existsSync(LOG_DIR)) fs.mkdirSync(LOG_DIR, { recursive: true });

let _logStream = null;
let _logDay    = null;

function getLogStream() {
    const today = new Date().toISOString().slice(0, 10);
    if (_logDay !== today) {
        if (_logStream) _logStream.end();
        const file = path.join(LOG_DIR, `server_${today}.log`);
        _logStream = fs.createWriteStream(file, { flags: 'a' });
        _logDay    = today;

        // Elimina log più vecchi di LOG_KEEP giorni
        fs.readdirSync(LOG_DIR)
            .filter(f => f.startsWith('server_') && f.endsWith('.log'))
            .sort()
            .slice(0, -LOG_KEEP)
            .forEach(f => { try { fs.unlinkSync(path.join(LOG_DIR, f)); } catch {} });
    }
    return _logStream;
}

// Intercetta console.log e console.error → stdout + file
['log', 'error', 'warn'].forEach(method => {
    const orig = console[method].bind(console);
    console[method] = (...args) => {
        orig(...args);
        try {
            const line = `[${new Date().toISOString()}] ${args.join(' ')}\n`;
            getLogStream().write(line);
        } catch {}
    };
});

// ── Backup automatico database ────────────────────────────────────────────────
const { execFile } = require('child_process');
const DB_PATH      = path.join(__dirname, 'data', 'captive_portal.db');
const BACKUP_DIR   = path.join(__dirname, 'data', 'backups');
const BACKUP_KEEP  = parseInt(process.env.BACKUP_KEEP_DAYS || '7');

// Backup su share SMB esterno (opzionale — configurare nel .env)
function backupToSmb(localFile, filename) {
    const host     = process.env.SMB_HOST;
    const share    = process.env.SMB_SHARE;
    const user     = process.env.SMB_USER;
    const password = process.env.SMB_PASSWORD;
    const domain   = process.env.SMB_DOMAIN  || 'WORKGROUP';
    const subdir   = (process.env.SMB_PATH   || '').replace(/\\/g, '/').replace(/^\/|\/$/g, '');

    if (!host || !share || !user || !password) return; // SMB non configurato

    // Senza dominio se SMB_DOMAIN non impostato, con SMB2 forzato
    const authStr  = domain && domain !== 'WORKGROUP' ? `${domain}\\${user}%${password}` : `${user}%${password}`;
    const target   = [`//${host}/${share}`, '-U', authStr, `--option=client min protocol=SMB2`];
    const remotePath = subdir ? `${subdir}/${filename}` : filename;
    const dest     = `//${host}/${share}/${remotePath}`;

    const doUpload = () => {
        execFile('smbclient', [...target, '-c', `put ${localFile} ${remotePath}`], (err, stdout, stderr) => {
            if (err) {
                const detail = stderr ? stderr.trim() : (stdout ? stdout.trim() : err.message);
                console.error(`[Backup SMB] Errore upload su ${dest}:\n  ${detail}`);
            } else {
                console.log(`[Backup SMB] Caricato su ${dest}`);
            }
        });
    };

    if (subdir) {
        execFile('smbclient', [...target, '-c', `mkdir ${subdir}`], () => doUpload());
    } else {
        doUpload();
    }
}

function runBackup() {
    try {
        if (!fs.existsSync(DB_PATH)) return;
        if (!fs.existsSync(BACKUP_DIR)) fs.mkdirSync(BACKUP_DIR, { recursive: true });

        const ts       = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
        const filename = `captive_portal_${ts}.db`;
        const dest     = path.join(BACKUP_DIR, filename);
        fs.copyFileSync(DB_PATH, dest);
        console.log(`[Backup] DB salvato: ${dest}`);

        // Upload DB su SMB se configurato
        backupToSmb(dest, filename);

        // Upload log del giorno su SMB
        const logFile = path.join(LOG_DIR, `server_${ts}.log`);
        if (fs.existsSync(logFile)) backupToSmb(logFile, `server_${ts}.log`);

        // Elimina backup locali più vecchi di BACKUP_KEEP giorni
        const files = fs.readdirSync(BACKUP_DIR)
            .filter(f => f.startsWith('captive_portal_') && f.endsWith('.db'))
            .sort();
        if (files.length > BACKUP_KEEP) {
            const toDelete = files.slice(0, files.length - BACKUP_KEEP);
            toDelete.forEach(f => {
                fs.unlinkSync(path.join(BACKUP_DIR, f));
                console.log(`[Backup] Eliminato vecchio backup locale: ${f}`);
            });
        }
    } catch (e) {
        console.error('[Backup] Errore:', e.message);
    }
}

// Backup subito all'avvio + ogni 24h
runBackup();
setInterval(runBackup, 24 * 60 * 60 * 1000);

// Pulizia automatica record oltre retention (Decreto Pisanu — 6 mesi default)
const RETENTION_MONTHS = parseInt(process.env.RETENTION_MONTHS || '6');
setInterval(() => {
    const d1 = adminDb.purgeOldLogs(RETENTION_MONTHS);
    const d2 = adminDb.purgeOldNavLogs(RETENTION_MONTHS);
    if (d1 || d2) console.log(`[Retention] Eliminati ${d1} accessi + ${d2} nav log oltre ${RETENTION_MONTHS} mesi`);
}, 24 * 60 * 60 * 1000); // ogni 24h

// ── Syslog UDP receiver (log navigazione dal gateway Ruijie) ──────────────────
const SYSLOG_PORT = parseInt(process.env.SYSLOG_PORT || '514');

function parseSyslog(raw) {
    const r = { client_ip: null, mac: null, domain: null, url: null };

    // Estrai MAC — supporta MAC-ADDRESS=, mac=, SrcMac= e formato bare XX:XX:XX:XX:XX:XX
    const macMatch = raw.match(/(?:mac[\-_]?address|SrcMac|srcmac|client_mac|mac)=?([0-9a-fA-F]{2}[:\-][0-9a-fA-F]{2}[:\-][0-9a-fA-F]{2}[:\-][0-9a-fA-F]{2}[:\-][0-9a-fA-F]{2}[:\-][0-9a-fA-F]{2})/i)
                  || raw.match(/([0-9a-fA-F]{2}:[0-9a-fA-F]{2}:[0-9a-fA-F]{2}:[0-9a-fA-F]{2}:[0-9a-fA-F]{2}:[0-9a-fA-F]{2})/);
    if (macMatch) r.mac = macMatch[1].toLowerCase().replace(/-/g, ':');

    // Estrai IP sorgente — supporta SOURCE-IP=, SrcIp=, client_ip= e IP all'inizio del messaggio
    const ipMatch = raw.match(/(?:SOURCE[\-_]IP|SrcIp|src_ip|client_ip|user_ip|ClientIP)=(\d{1,3}(?:\.\d{1,3}){3})/i)
                 || raw.match(/^(\d{1,3}(?:\.\d{1,3}){3})[,\s]/m)
                 || raw.match(/(?:^|\s)(\d{1,3}(?:\.\d{1,3}){3})(?:[,\s]|$)/m);
    if (ipMatch) r.client_ip = ipMatch[1];

    // Estrai URL
    const urlMatch = raw.match(/(?:URL|Url|url)=([^\s,]+)/i);
    if (urlMatch) r.url = urlMatch[1];

    // Estrai dominio (da campo esplicito o da URL)
    const nameMatch = raw.match(/(?:Name|domain|Host|hostname)=([^\s,]+)/i);
    if (nameMatch) {
        r.domain = nameMatch[1].replace(/\.$/, '');
    } else if (r.url) {
        try { r.domain = new URL(r.url.includes('://') ? r.url : 'http://' + r.url).hostname; } catch {}
    }
    return r;
}

const syslogServer = dgram.createSocket('udp4');
syslogServer.on('message', (msg, rinfo) => {
    const raw = msg.toString().trim();

    // Salva nel buffer debug condiviso con admin routes
    syslogBuf.push({ ts: new Date().toISOString(), from: rinfo.address, raw });

    const parsed = parseSyslog(raw);
    if (!parsed.client_ip && !parsed.domain && !parsed.mac) return;

    // Risolvi utente: prima per MAC (più affidabile), poi per IP
    let user = {};
    if (parsed.mac) user = adminDb.resolveUserByMac(parsed.mac);
    if (!user.email && parsed.client_ip) user = adminDb.resolveUserByIp(parsed.client_ip);

    console.log(`[Syslog] ${parsed.client_ip||'?'} mac=${parsed.mac||'?'} → ${parsed.domain||parsed.url||'?'} email=${user.email||'—'}`);

    try {
        adminDb.logNav({ ...parsed, mac: parsed.mac || user.mac, email: user.email, raw });
    } catch (e) {
        console.error('[Syslog] DB error:', e.message);
    }
});
syslogServer.on('error', (err) => {
    console.error(`[Syslog] Errore porta ${SYSLOG_PORT}: ${err.message}`);
    if (SYSLOG_PORT === 514) console.warn('[Syslog] Su Windows porta 514 richiede admin. Imposta SYSLOG_PORT=5514 nel .env e sul gateway.');
});
syslogServer.bind(SYSLOG_PORT, '0.0.0.0', () => {
    console.log(`  Syslog:  UDP :${SYSLOG_PORT}  (log navigazione dal gateway)`);
});

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// No-cache per tutto — iOS CNA ignora i version tag
app.use((req, res, next) => {
    res.set('Cache-Control', 'no-store, no-cache, must-revalidate');
    res.set('Pragma', 'no-cache');
    next();
});

// Logging dettagliato di OGNI richiesta
app.use((req, res, next) => {
    const ip = req.ip || req.connection.remoteAddress;
    console.log(`[REQ] ${new Date().toISOString().slice(11,19)} ${req.method} ${req.originalUrl} ← ${ip}`);
    if (Object.keys(req.query).length) console.log('       query:', JSON.stringify(req.query));
    if (req.method === 'POST' && req.body && Object.keys(req.body).length) {
        const safe = { ...req.body };
        if (safe.otp) safe.otp = '***';
        console.log('       body :', JSON.stringify(safe));
    }
    next();
});

app.use(express.static(path.join(__dirname, 'public'), { etag: false, lastModified: false }));

// ── Storage in memoria ────────────────────────────────────────────────────────
const users    = new Map();  // email → { nome, cognome, email, verified }
const otps     = new Map();  // email → { code, expiresAt, attempts }
const tokens   = new Map();  // mac   → wifidogToken (cache in-memory, fonte = DB)
const sessions = new Map();  // mac   → { email, step } — per recovery iOS

// Carica sessioni attive dal DB all'avvio (sopravvivono ai riavvii del server)
for (const { mac, token } of adminDb.loadActiveSessions()) {
    tokens.set(mac, token);
}
console.log(`  Sessioni: ${tokens.size} sessioni WiFi attive ripristinate dal DB`);

// Pulizia sessioni scadute ogni ora
setInterval(() => {
    const n = adminDb.cleanExpiredSessions();
    if (n) console.log(`[Sessions] Eliminate ${n} sessioni scadute`);
}, 60 * 60 * 1000);

// ── Mailer Brevo ──────────────────────────────────────────────────────────────
function getMailer() {
    return nodemailer.createTransport({
        host:   process.env.BREVO_SMTP_HOST || 'smtp-relay.brevo.com',
        port:   parseInt(process.env.BREVO_SMTP_PORT || '587'),
        secure: false,
        auth: { user: process.env.BREVO_SMTP_USER, pass: process.env.BREVO_SMTP_PASSWORD }
    });
}

async function sendOtp(email, nome, otp) {
    if (!process.env.BREVO_SMTP_USER) {
        console.log(`[DEV] OTP per ${email}: ${otp}`);
        return;
    }
    await getMailer().sendMail({
        from:    `"${process.env.BREVO_SENDER_NAME || 'WiFi Guest'}" <${process.env.BREVO_SENDER_EMAIL}>`,
        to:      `"${nome}" <${email}>`,
        subject: 'Il tuo codice di accesso WiFi',
        html:    `<div style="font-family:sans-serif;max-width:480px;margin:auto;padding:24px">
                    <h2 style="color:#2563eb">Codice di accesso WiFi</h2>
                    <p>Ciao <strong>${nome}</strong>,</p>
                    <div style="background:#eff6ff;border:2px solid #2563eb;border-radius:8px;text-align:center;padding:24px;margin:20px 0">
                        <div style="font-size:42px;font-weight:700;letter-spacing:12px;color:#1d4ed8">${otp}</div>
                    </div>
                    <p style="color:#6b7280;font-size:14px">Valido per 10 minuti. Non condividerlo con nessuno.</p>
                  </div>`
    });
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function genOtp() {
    return String(crypto.randomInt(100000, 999999));
}

function normalizeMac(mac) {
    if (!mac) return null;
    return mac.toLowerCase().replace(/[^a-f0-9]/g, '').replace(/(.{2})(?=.)/g, '$1:');
}

// ── WiFiDog endpoints ─────────────────────────────────────────────────────────

// Handler login condiviso (standard + Ruijie path)
function handleWifidogLogin(req, res) {
    const { gw_address, gw_port, mac, url } = req.query;
    const normalMac = normalizeMac(mac);

    // Ruijie usa CHAP invece di token — usiamo chap_challenge come token
    let token = req.query.token || req.query.chap_challenge;
    if (!token && normalMac) {
        token = crypto.randomBytes(16).toString('hex');
    }

    console.log(`[WiFiDog] Login — mac=${mac} token=${token} path=${req.path}`);

    if (normalMac && token) tokens.set(normalMac, token);

    const params = new URLSearchParams({
        mac:       mac        || '',
        token:     token      || '',
        gwAddress: gw_address || '',
        gwPort:    gw_port    || '',
        linkOrig:  url        || ''
    });

    // Recovery sessione iOS: se c'è già un OTP in sospeso per questo MAC,
    // rimanda direttamente alla pagina di verifica con email pre-compilata
    const sess = normalMac && sessions.get(normalMac);
    if (sess && sess.step === 'verify' && otps.has(sess.email)) {
        console.log(`[iOS Recovery] MAC ${mac} → ripristino sessione per ${sess.email}`);
        params.set('email', sess.email);
        return res.redirect(`/verify?${params.toString()}`);
    }

    // Serve la index direttamente (elimina un hop di redirect per iOS CNA)
    const fs = require('fs');
    const indexPath = path.join(__dirname, 'views', 'index.html');
    let html = fs.readFileSync(indexPath, 'utf8');
    // Inietta i parametri portale come script inline per capturePortalParams()
    const inlineScript = `<script>
(function(){
  var d={mac:${JSON.stringify(mac||'')},token:${JSON.stringify(token||'')},gwAddress:${JSON.stringify(gw_address||'')},gwPort:${JSON.stringify(gw_port||'')},linkOrig:${JSON.stringify(url||'')}};
  if(Object.values(d).some(function(v){return v;})) sessionStorage.setItem('portalData',JSON.stringify(d));
})();
</script>`;
    html = html.replace(/<script src="\/js\/main\.js[^"]*"><\/script>/, inlineScript + '\n  <script src="/js/main.js?v=3"></script>');
    res.set('Content-Type', 'text/html');
    res.send(html);
}

// Handler auth condiviso (standard + Ruijie path)
function handleWifidogAuth(req, res) {
    const { mac, token, stage } = req.query;
    const normalMac = normalizeMac(mac);

    // Logout esplicito dal gateway
    if (stage === 'logout') {
        tokens.delete(normalMac);
        if (normalMac) adminDb.deleteSession(normalMac);
        console.log(`[WiFiDog] Logout — mac=${mac}`);
        res.set('Content-Type', 'text/plain');
        return res.send('Auth: 0');
    }

    // Controlla prima la cache in memoria, poi il DB (per query dopo riavvio)
    let saved = tokens.get(normalMac);
    if (!saved) {
        const sess = adminDb.getSession(normalMac);
        if (sess) { saved = sess.token; tokens.set(normalMac, saved); }
    }
    const valid = saved && saved === token;

    console.log(`[WiFiDog] Auth — mac=${mac} stage=${stage} → ${valid ? 'ALLOW' : 'DENY'}`);
    res.set('Content-Type', 'text/plain');
    res.send(valid ? 'Auth: 1' : 'Auth: 0');
}

// Heartbeat gateway (ogni 30s) — path standard e Ruijie
app.get('/ping',                      (req, res) => { res.set('Content-Type','text/plain'); res.send('Pong'); });
app.get('/auth/wifidogAuth/ping/',    (req, res) => { res.set('Content-Type','text/plain'); res.send('Pong'); });
app.get('/auth/wifidogAuth/ping',     (req, res) => { res.set('Content-Type','text/plain'); res.send('Pong'); });

// Redirect client al portale — path standard e Ruijie
app.get('/wifidog/login',             handleWifidogLogin);
app.get('/auth/wifidogAuth/login/',   handleWifidogLogin);
app.get('/auth/wifidogAuth/login',    handleWifidogLogin);

// Validazione token dal gateway — path standard e Ruijie
app.get('/wifidog/auth',              handleWifidogAuth);
app.get('/auth/wifidogAuth/auth/',    handleWifidogAuth);
app.get('/auth/wifidogAuth/auth',     handleWifidogAuth);

// Pagina post-autenticazione (Ruijie): il gateway redirige qui dopo Auth:1
// Serve HTML con JS redirect per forzare apertura nel browser reale (escape CNA iOS/Android)
const PORTAL_REDIRECT_URL = process.env.PORTAL_REDIRECT_URL || '/success';

function sendPortalEscapePage(res) {
    const url = PORTAL_REDIRECT_URL;
    res.set('Content-Type', 'text/html; charset=utf-8');
    res.send(`<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <meta http-equiv="refresh" content="0; url=${url}">
  <title>Connesso</title>
  <style>
    body { margin:0; display:flex; flex-direction:column; align-items:center;
           justify-content:center; min-height:100vh; font-family:sans-serif;
           background:#f0fdf4; color:#166534; text-align:center; padding:24px; }
    .icon { font-size:56px; margin-bottom:16px; }
    h2 { margin:0 0 8px; font-size:22px; }
    p  { margin:0 0 24px; color:#6b7280; font-size:15px; }
    a  { display:inline-block; background:#16a34a; color:#fff; padding:14px 32px;
         border-radius:10px; text-decoration:none; font-weight:700; font-size:16px; }
  </style>
</head>
<body>
  <div class="icon">✅</div>
  <h2>WiFi attivo!</h2>
  <p>Stai per essere reindirizzato…</p>
  <a href="${url}">Apri nel browser</a>
  <script>
    // Forza apertura nel browser reale (escape dal popup CNA di iOS/Android)
    setTimeout(function(){ window.location.href = ${JSON.stringify(url)}; }, 100);
  </script>
</body>
</html>`);
}

app.get('/auth/wifidogAuth/portal/', (req, res) => {
    console.log(`[WiFiDog] Portal callback — mac=${req.query.mac} → ${PORTAL_REDIRECT_URL}`);
    sendPortalEscapePage(res);
});
app.get('/auth/wifidogAuth/portal',  (req, res) => sendPortalEscapePage(res));

// Alias /login per browser diretti
app.get('/login', (req, res) => {
    if (req.query.token || req.query.gw_address) {
        return res.redirect(`/wifidog/login?${new URLSearchParams(req.query)}`);
    }
    res.sendFile(path.join(__dirname, 'views', 'login.html'));
});

// ── API Auth ──────────────────────────────────────────────────────────────────

// Registrazione
app.post('/api/auth/register', async (req, res) => {
    const { nome, cognome, email, telefono, gdprConsent } = req.body;
    if (!nome || !cognome || !email || !gdprConsent) {
        return res.status(422).json({ success: false, error: 'Dati mancanti' });
    }

    const otp = genOtp();
    const emailLow = email.toLowerCase();

    users.set(emailLow, { nome, cognome, email: emailLow, telefono, marketingConsent: !!req.body.marketingConsent, verified: false });
    otps.set(emailLow,  { code: otp, expiresAt: Date.now() + 600000, attempts: 0 });

    try {
        await sendOtp(emailLow, nome, otp);
    } catch (e) {
        console.error('Email error:', e.message);
    }

    // Salva sessione per recovery iOS
    const mac = req.body.mac || req.body.userMac;
    if (mac) sessions.set(normalizeMac(mac), { email: emailLow, step: 'verify' });

    console.log(`[OTP] Inviato a ${emailLow}: ${otp}`);
    res.json({ success: true, data: { userId: emailLow, purpose: 'registration', message: 'Controlla la tua email.' } });
});

// Login
app.post('/api/auth/login', async (req, res) => {
    const email = req.body.email?.toLowerCase();
    if (!email) return res.status(422).json({ success: false, error: 'Email mancante' });

    let user = users.get(email);
    if (!user) {
        // In test mode crea l'utente al volo
        user = { nome: email.split('@')[0], cognome: '', email, verified: false };
        users.set(email, user);
    }

    const otp = genOtp();
    otps.set(email, { code: otp, expiresAt: Date.now() + 600000, attempts: 0 });

    try { await sendOtp(email, user.nome, otp); } catch {}
    console.log(`[OTP] Login per ${email}: ${otp}`);

    // Salva sessione per recovery iOS
    const mac = req.body.mac || req.body.userMac;
    if (mac) sessions.set(normalizeMac(mac), { email, step: 'verify' });

    res.json({ success: true, data: { userId: email, purpose: 'login', message: 'Codice inviato.' } });
});

// Verifica OTP
app.post('/api/auth/verify-otp', (req, res) => {
    const { userId: email, otp, purpose } = req.body;
    const record = otps.get(email);

    if (!record) return res.status(400).json({ success: false, error: 'Nessun codice attivo.', code: 'NO_OTP' });
    if (Date.now() > record.expiresAt) return res.status(400).json({ success: false, error: 'Codice scaduto.', code: 'OTP_EXPIRED' });
    if (record.attempts >= 3) return res.status(429).json({ success: false, error: 'Troppi tentativi.', code: 'MAX_ATTEMPTS' });

    if (record.code !== String(otp)) {
        record.attempts++;
        return res.status(400).json({ success: false, error: `Codice errato. Tentativi rimasti: ${3 - record.attempts}` });
    }

    otps.delete(email);
    const user = users.get(email) || { nome: email, cognome: '', email };
    user.verified = true;
    users.set(email, user);

    // Rimuovi sessione recovery iOS
    const mac = req.body.mac || req.body.userMac;
    const normalMac = normalizeMac(mac);
    if (normalMac) sessions.delete(normalMac);

    // Log accesso nel DB (Decreto Pisanu + GDPR)
    try {
        // IP reale client: il Ruijie fa da proxy, usa X-Forwarded-For se disponibile
        const clientIp = (req.headers['x-forwarded-for'] || req.ip || '').split(',')[0].trim()
                      || req.connection.remoteAddress;
        adminDb.logAccess({
            email,
            nome:              user.nome,
            cognome:           user.cognome,
            telefono:          user.telefono,
            mac:               normalizeMac(mac) || '',
            ip:                clientIp,
            ssid:              req.body.ssid || null,
            user_agent:        req.headers['user-agent'] || null,
            gdpr_consent:      true, // OTP verificato implica consenso esplicito
            marketing_consent: !!user.marketingConsent,
            consent_version:   'v1.0',
            consent_ip:        clientIp
        });
    } catch (e) {
        console.error('[DB] Errore log accesso:', e.message);
    }

    console.log(`[AUTH] Utente verificato: ${email}`);
    res.json({ success: true, data: {
        token: 'local-test-token',
        user:  { nome: user.nome, cognome: user.cognome, email, status: 'verified' },
        purpose,
        message: 'Accesso effettuato!'
    }});
});

// Reinvio OTP
app.post('/api/auth/resend-otp', async (req, res) => {
    const email = req.body.userId;
    const user  = users.get(email);
    if (!user) return res.status(404).json({ success: false, error: 'Utente non trovato' });

    const otp = genOtp();
    otps.set(email, { code: otp, expiresAt: Date.now() + 600000, attempts: 0 });
    try { await sendOtp(email, user.nome, otp); } catch {}
    console.log(`[OTP] Reinviato a ${email}: ${otp}`);

    res.json({ success: true, data: { message: 'Nuovo codice inviato.' } });
});

app.post('/api/auth/logout', (req, res) => {
    res.clearCookie('captive_token');
    res.json({ success: true, data: { message: 'Logout effettuato.' } });
});

// ── API Network ───────────────────────────────────────────────────────────────

// Autorizzazione rete — segna il token WiFiDog come valido e persiste nel DB
app.post('/api/network/authorize', (req, res) => {
    const mac   = req.body.mac || req.body.userMac;
    const token = req.body.token;
    const email = req.body.userId || null;

    if (mac && token) {
        const normalMac = normalizeMac(mac);
        tokens.set(normalMac, token);
        // Persiste nel DB con TTL 24h (sopravvive ai riavvii)
        try { adminDb.saveSession({ mac: normalMac, token, email }); } catch {}
        console.log(`[WiFiDog] MAC autorizzato: ${mac} email=${email||'—'} (sessione 24h)`);
    }

    res.json({ success: true, data: { authorized: true, mode: 'ruijie-wifidog' } });
});

app.post('/api/network/logout', (req, res) => {
    res.json({ success: true, data: { message: 'Disconnesso.' } });
});

app.get('/api/network/status', (req, res) => {
    res.json({ success: true, data: { active: true } });
});

// ── Pagine HTML ───────────────────────────────────────────────────────────────
const views = path.join(__dirname, 'views');
app.get('/',         (req, res) => res.sendFile(path.join(views, 'index.html')));
app.get('/register', (req, res) => res.sendFile(path.join(views, 'register.html')));
app.get('/verify',   (req, res) => res.sendFile(path.join(views, 'verify.html')));
app.get('/success',  (req, res) => res.sendFile(path.join(views, 'success.html')));
app.get('/privacy',  (req, res) => res.sendFile(path.join(views, 'privacy.html')));
app.get('/terms',    (req, res) => res.sendFile(path.join(views, 'terms.html')));
app.get('/health',       (req, res) => res.json({ status: 'ok', mode: 'test-local' }));
app.get('/api/config',   (req, res) => res.json({ redirectUrl: PORTAL_REDIRECT_URL }));

// ── Admin Portal ──────────────────────────────────────────────────────────────
app.use('/admin', adminRoutes.router);

// ── Avvio ─────────────────────────────────────────────────────────────────────
app.listen(PORT, '0.0.0.0', () => {
    const os = require('os');
    const ip = Object.values(os.networkInterfaces())
        .flat().find(i => i.family === 'IPv4' && !i.internal)?.address || 'localhost';

    console.log(`\n✓ Captive Portal (test locale) avviato`);
    console.log(`  Locale:  http://localhost:${PORT}`);
    console.log(`  Rete:    http://${ip}:${PORT}`);
    console.log(`\n  Configura su Ruijie Cloud:`);
    console.log(`  Auth Server URL = http://${ip}:${PORT}`);
    console.log(`  Auth Protocol   = WiFiDog\n`);
});
