// Model audit log: registra tutti gli eventi per compliance GDPR
const { getDatabase } = require('../config/database');

const EVENTS = {
    REGISTER_START:     'register_start',
    REGISTER_COMPLETE:  'register_complete',
    LOGIN_START:        'login_start',
    LOGIN_SUCCESS:      'login_success',
    OTP_SENT:           'otp_sent',
    OTP_VERIFIED:       'otp_verified',
    OTP_FAILED:         'otp_failed',
    OTP_EXPIRED:        'otp_expired',
    SESSION_START:      'session_start',
    SESSION_END:        'session_end',
    NETWORK_AUTH:       'network_auth',
    NETWORK_DEAUTH:     'network_deauth',
    BLOCKED:            'blocked',
};

class AccessLogModel {

    static log({ userId, eventType, ipAddress, macAddress, userAgent, details }) {
        getDatabase().prepare(`
            INSERT INTO access_logs (user_id, event_type, ip_address, mac_address, user_agent, details)
            VALUES (?, ?, ?, ?, ?, ?)
        `).run(
            userId    || null,
            eventType,
            ipAddress  || null,
            macAddress || null,
            userAgent  || null,
            details ? JSON.stringify(details) : null
        );
    }

    static getForUser(userId, limit = 50) {
        return getDatabase().prepare(`
            SELECT * FROM access_logs WHERE user_id = ? ORDER BY created_at DESC LIMIT ?
        `).all(userId, limit);
    }
}

AccessLogModel.EVENTS = EVENTS;
module.exports = AccessLogModel;
