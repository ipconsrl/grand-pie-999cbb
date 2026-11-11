#!/usr/bin/env node
// Script di migrazione: esegue tutti i file .sql in ordine numerico

require('dotenv').config();
const fs   = require('fs');
const path = require('path');
const Database = require('better-sqlite3');

const dbPath = process.env.DB_PATH || './data/captive_portal.db';

// Crea la directory data se non esiste
const dir = path.dirname(dbPath);
if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
    console.log(`Creata directory: ${dir}`);
}

const db = new Database(dbPath);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

// Tabella di tracciamento migrazioni eseguite
db.exec(`
    CREATE TABLE IF NOT EXISTS _migrations (
        id         INTEGER PRIMARY KEY AUTOINCREMENT,
        filename   TEXT NOT NULL UNIQUE,
        applied_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
`);

const migrationsDir = path.join(__dirname);
const sqlFiles = fs.readdirSync(migrationsDir)
    .filter(f => f.endsWith('.sql'))
    .sort();

let appliedCount = 0;

for (const file of sqlFiles) {
    const already = db.prepare('SELECT id FROM _migrations WHERE filename = ?').get(file);
    if (already) {
        console.log(`  [già applicata] ${file}`);
        continue;
    }

    const sql = fs.readFileSync(path.join(migrationsDir, file), 'utf8');
    try {
        db.exec(sql);
        db.prepare('INSERT INTO _migrations (filename) VALUES (?)').run(file);
        console.log(`  [OK] ${file}`);
        appliedCount++;
    } catch (err) {
        console.error(`  [ERRORE] ${file}:`, err.message);
        process.exit(1);
    }
}

console.log(`\nMigrazioni completate: ${appliedCount} applicate, ${sqlFiles.length - appliedCount} già presenti.`);
db.close();
