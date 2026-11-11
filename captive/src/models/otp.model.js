// Model OTP: creazione, verifica e gestione dei token one-time-password
const { getDatabase } = require('../config/database');
const bcrypt = require('bcryptjs');

const SALT_ROUNDS = 10;

class OtpModel {

    // Crea un nuovo record OTP, invalidando quelli precedenti dello stesso utente+scopo
    static async create({ userId, otpPlaintext, purpose, ipAddress, userAgent }) {
        const db = getDatabase();
        const expiresMinutes = parseInt(process.env.OTP_EXPIRES_MINUTES || '10');
        const expiresAt = new Date(Date.now() + expiresMinutes * 60 * 1000).toISOString();

        // Invalida tutti gli OTP precedenti non ancora usati per questo utente+scopo
        db.prepare(`
            UPDATE otp_tokens SET used = 1
            WHERE user_id = ? AND purpose = ? AND used = 0
        `).run(userId, purpose);

        // Hash dell'OTP prima di salvarlo (sicurezza: non vogliamo testo in chiaro nel DB)
        const otpHash = await bcrypt.hash(otpPlaintext, SALT_ROUNDS);

        const result = db.prepare(`
            INSERT INTO otp_tokens (user_id, otp_hash, purpose, expires_at, ip_address, user_agent)
            VALUES (?, ?, ?, ?, ?, ?)
        `).run(userId, otpHash, purpose, expiresAt, ipAddress || null, userAgent || null);

        return result.lastInsertRowid;
    }

    // Recupera l'OTP attivo più recente per un utente
    static getActiveForUser(userId, purpose) {
        return getDatabase().prepare(`
            SELECT * FROM otp_tokens
            WHERE user_id = ? AND purpose = ? AND used = 0 AND expires_at > datetime('now')
            ORDER BY created_at DESC
            LIMIT 1
        `).get(userId, purpose);
    }

    // Verifica se l'OTP fornito è corretto
    static async verify(otpRecord, otpPlaintext) {
        return bcrypt.compare(String(otpPlaintext), otpRecord.otp_hash);
    }

    // Incrementa i tentativi falliti
    static incrementAttempts(id) {
        getDatabase().prepare('UPDATE otp_tokens SET attempts = attempts + 1 WHERE id = ?').run(id);
    }

    // Marca l'OTP come usato
    static markUsed(id) {
        getDatabase().prepare('UPDATE otp_tokens SET used = 1 WHERE id = ?').run(id);
    }

    // Conta i tentativi falliti recenti per un utente (protezione brute-force)
    static countRecentFailedAttempts(userId, windowMinutes = 30) {
        const result = getDatabase().prepare(`
            SELECT SUM(attempts) as total FROM otp_tokens
            WHERE user_id = ?
              AND created_at > datetime('now', ?)
        `).get(userId, `-${windowMinutes} minutes`);
        return result?.total || 0;
    }

    // Verifica se il cooldown per il reinvio è ancora attivo
    static isResendCooldownActive(userId, purpose) {
        const cooldownSeconds = parseInt(process.env.OTP_RESEND_COOLDOWN_SECONDS || '60');
        const row = getDatabase().prepare(`
            SELECT created_at FROM otp_tokens
            WHERE user_id = ? AND purpose = ?
            ORDER BY created_at DESC
            LIMIT 1
        `).get(userId, purpose);

        if (!row) return false;
        const elapsed = (Date.now() - new Date(row.created_at).getTime()) / 1000;
        return elapsed < cooldownSeconds;
    }

    // Secondi rimasti al cooldown reinvio
    static getResendCooldownRemaining(userId, purpose) {
        const cooldownSeconds = parseInt(process.env.OTP_RESEND_COOLDOWN_SECONDS || '60');
        const row = getDatabase().prepare(`
            SELECT created_at FROM otp_tokens
            WHERE user_id = ? AND purpose = ?
            ORDER BY created_at DESC
            LIMIT 1
        `).get(userId, purpose);

        if (!row) return 0;
        const elapsed = (Date.now() - new Date(row.created_at).getTime()) / 1000;
        return Math.max(0, Math.ceil(cooldownSeconds - elapsed));
    }
}

module.exports = OtpModel;
