// Model sessioni di rete: traccia gli accessi WiFi autorizzati
const { getDatabase } = require('../config/database');
const { v4: uuidv4 }  = require('uuid');

class SessionModel {

    static create({ userId, macAddress, ipAddress, networkMode, ssid, apMac, gatewayIp, gatewayPort, externalSessionId }) {
        const db   = getDatabase();
        const uuid = uuidv4();

        const sessionHours = 24;
        const expiresAt = new Date(Date.now() + sessionHours * 3600 * 1000).toISOString();

        const result = db.prepare(`
            INSERT INTO network_sessions
                (uuid, user_id, mac_address, ip_address, network_mode, ssid, ap_mac, gateway_ip, gateway_port, external_session_id, expires_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(uuid, userId, macAddress || null, ipAddress || null, networkMode, ssid || null, apMac || null, gatewayIp || null, gatewayPort || null, externalSessionId || null, expiresAt);

        return this.findById(result.lastInsertRowid);
    }

    static findById(id) {
        return getDatabase().prepare('SELECT * FROM network_sessions WHERE id = ?').get(id);
    }

    static findByUuid(uuid) {
        return getDatabase().prepare('SELECT * FROM network_sessions WHERE uuid = ?').get(uuid);
    }

    static findActiveByMac(macAddress) {
        return getDatabase().prepare(`
            SELECT * FROM network_sessions
            WHERE mac_address = ? AND status = 'active' AND (expires_at IS NULL OR expires_at > datetime('now'))
            ORDER BY started_at DESC LIMIT 1
        `).get(macAddress);
    }

    static findActiveByUser(userId) {
        return getDatabase().prepare(`
            SELECT * FROM network_sessions
            WHERE user_id = ? AND status = 'active'
            ORDER BY started_at DESC LIMIT 1
        `).get(userId);
    }

    static updateStatus(id, status) {
        const endedAt = ['expired','disconnected','revoked'].includes(status) ? new Date().toISOString() : null;
        getDatabase().prepare(`
            UPDATE network_sessions SET status = ?, ended_at = COALESCE(?, ended_at) WHERE id = ?
        `).run(status, endedAt, id);
    }

    static updateExternalId(id, externalSessionId) {
        getDatabase().prepare('UPDATE network_sessions SET external_session_id = ? WHERE id = ?').run(externalSessionId, id);
    }

    // Termina tutte le sessioni attive di un utente
    static revokeAllForUser(userId) {
        getDatabase().prepare(`
            UPDATE network_sessions
            SET status = 'revoked', ended_at = datetime('now')
            WHERE user_id = ? AND status = 'active'
        `).run(userId);
    }
}

module.exports = SessionModel;
