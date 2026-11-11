// Entry point del captive portal
// Avvia Express, esegue le migrazioni DB e inizializza i servizi di rete
require('dotenv').config();

const path      = require('path');
const fs        = require('fs');
const logger    = require('./src/config/logger');
const { createApp } = require('./src/config/app');

// Crea la directory logs se non esiste
const logsDir = path.join(process.cwd(), 'logs');
if (!fs.existsSync(logsDir)) fs.mkdirSync(logsDir);

async function start() {
    // ── 1. Esegui migrazioni database ─────────────────────────────
    const Database = require('better-sqlite3');
    const dbPath   = process.env.DB_PATH || './data/captive_portal.db';
    const dataDir  = path.dirname(path.resolve(dbPath));
    if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

    // Applica lo schema SQL se non ancora applicato
    const db = new Database(path.resolve(dbPath));
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');

    const migrationFile = path.join(__dirname, 'migrations', '001_initial.sql');
    if (fs.existsSync(migrationFile)) {
        db.exec(`CREATE TABLE IF NOT EXISTS _migrations (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            filename TEXT NOT NULL UNIQUE,
            applied_at TEXT NOT NULL DEFAULT (datetime('now'))
        )`);
        const already = db.prepare('SELECT id FROM _migrations WHERE filename = ?').get('001_initial.sql');
        if (!already) {
            db.exec(fs.readFileSync(migrationFile, 'utf8'));
            db.prepare('INSERT INTO _migrations (filename) VALUES (?)').run('001_initial.sql');
            logger.info('Migrazione 001_initial.sql applicata');
        }
    }
    db.close();

    // ── 2. Verifica connessione SMTP ──────────────────────────────
    const emailService = require('./src/services/email.service');
    await emailService.verifyConnection();

    // ── 3. Avvia server RADIUS (solo per pfSense in modalità radius) ─
    const networkMode  = (process.env.NETWORK_MODE || 'demo').toLowerCase();
    const pfsenseMode  = (process.env.PFSENSE_MODE || 'radius').toLowerCase();

    if (networkMode === 'pfsense' && pfsenseMode === 'radius') {
        const pfsenseService = require('./src/services/pfsense.service');
        pfsenseService.startRadiusServer();
    }

    // ── 4. Avvia Express ──────────────────────────────────────────
    const app  = createApp();
    const port = parseInt(process.env.PORT || '3000');

    const server = app.listen(port, () => {
        logger.info(`Captive Portal avviato su http://localhost:${port}`);
        logger.info(`Modalità rete: ${networkMode.toUpperCase()}`);
        logger.info(`Ambiente: ${process.env.NODE_ENV || 'development'}`);
    });

    // ── 5. Graceful shutdown ──────────────────────────────────────
    const shutdown = (signal) => {
        logger.info(`Ricevuto ${signal}, chiusura in corso...`);
        server.close(() => {
            logger.info('Server HTTP chiuso.');
            process.exit(0);
        });
        // Forza la chiusura dopo 10 secondi se non termina
        setTimeout(() => process.exit(1), 10000);
    };

    process.on('SIGTERM', () => shutdown('SIGTERM'));
    process.on('SIGINT',  () => shutdown('SIGINT'));

    // Gestisce eccezioni non catturate senza crashare
    process.on('uncaughtException',  (err) => logger.error('Eccezione non catturata:', err));
    process.on('unhandledRejection', (err) => logger.error('Promise rifiutata non gestita:', err));

    return server;
}

start().catch((err) => {
    console.error('Avvio fallito:', err);
    process.exit(1);
});
