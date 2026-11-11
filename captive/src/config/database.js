// Configurazione e inizializzazione database SQLite
const path    = require('path');
const fs      = require('fs');
const Database = require('better-sqlite3');
const logger  = require('./logger');

let db = null;

function getDatabase() {
    if (db) return db;

    const dbPath = process.env.DB_PATH || './data/captive_portal.db';
    const dir = path.dirname(path.resolve(dbPath));

    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
    }

    db = new Database(path.resolve(dbPath));

    // Ottimizzazioni SQLite
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');
    db.pragma('synchronous = NORMAL');
    db.pragma('cache_size = 10000');
    db.pragma('temp_store = MEMORY');

    logger.info(`Database SQLite aperto: ${path.resolve(dbPath)}`);
    return db;
}

// Chiusura pulita alla terminazione del processo
process.on('exit', () => { if (db) db.close(); });
process.on('SIGINT', () => { if (db) { db.close(); process.exit(0); } });
process.on('SIGTERM', () => { if (db) { db.close(); process.exit(0); } });

module.exports = { getDatabase };
