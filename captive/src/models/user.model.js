// Model utente: operazioni CRUD sul database
const { getDatabase } = require('../config/database');
const { v4: uuidv4 }  = require('uuid');

class UserModel {

    // Crea un nuovo utente con status pending_verification
    static create({ nome, cognome, email, telefono, gdprConsent, marketingConsent, lingua = 'it' }) {
        const db = getDatabase();
        const uuid = uuidv4();

        const stmt = db.prepare(`
            INSERT INTO users (uuid, nome, cognome, email, telefono, gdpr_consent, marketing_consent, lingua, status)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending_verification')
        `);

        const result = stmt.run(uuid, nome, cognome, email, telefono || null, gdprConsent ? 1 : 0, marketingConsent ? 1 : 0, lingua);
        return this.findById(result.lastInsertRowid);
    }

    static findById(id) {
        return getDatabase().prepare('SELECT * FROM users WHERE id = ?').get(id);
    }

    static findByEmail(email) {
        return getDatabase().prepare('SELECT * FROM users WHERE email = ? AND status != ?').get(email.toLowerCase(), 'deleted');
    }

    static findByUuid(uuid) {
        return getDatabase().prepare('SELECT * FROM users WHERE uuid = ?').get(uuid);
    }

    // Aggiorna lo status e registra il login
    static setVerified(id) {
        getDatabase().prepare(`
            UPDATE users SET status = 'verified', last_login = datetime('now'), login_count = login_count + 1
            WHERE id = ?
        `).run(id);
        return this.findById(id);
    }

    static recordLogin(id) {
        getDatabase().prepare(`
            UPDATE users SET last_login = datetime('now'), login_count = login_count + 1
            WHERE id = ?
        `).run(id);
    }

    static updateStatus(id, status) {
        getDatabase().prepare('UPDATE users SET status = ? WHERE id = ?').run(status, id);
    }

    static emailExists(email) {
        const row = getDatabase().prepare('SELECT id FROM users WHERE email = ? AND status != ?').get(email.toLowerCase(), 'deleted');
        return !!row;
    }

    // Statistiche per dashboard admin
    static getStats() {
        const db = getDatabase();
        return {
            total:    db.prepare("SELECT COUNT(*) as c FROM users WHERE status != 'deleted'").get().c,
            verified: db.prepare("SELECT COUNT(*) as c FROM users WHERE status = 'verified'").get().c,
            pending:  db.prepare("SELECT COUNT(*) as c FROM users WHERE status = 'pending_verification'").get().c,
            blocked:  db.prepare("SELECT COUNT(*) as c FROM users WHERE status = 'blocked'").get().c,
        };
    }
}

module.exports = UserModel;
