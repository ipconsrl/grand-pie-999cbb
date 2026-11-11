-- ============================================================
-- MIGRAZIONE 001 — Schema iniziale captive portal
-- ============================================================

-- Tabella utenti
CREATE TABLE IF NOT EXISTS users (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    uuid        TEXT    NOT NULL UNIQUE,
    nome        TEXT    NOT NULL,
    cognome     TEXT    NOT NULL,
    email       TEXT    NOT NULL UNIQUE,
    telefono    TEXT,
    status      TEXT    NOT NULL DEFAULT 'pending_verification'
                        CHECK(status IN ('pending_verification','verified','blocked','deleted')),
    gdpr_consent    INTEGER NOT NULL DEFAULT 0,
    marketing_consent INTEGER NOT NULL DEFAULT 0,
    lingua      TEXT    NOT NULL DEFAULT 'it',
    created_at  TEXT    NOT NULL DEFAULT (datetime('now')),
    updated_at  TEXT    NOT NULL DEFAULT (datetime('now')),
    last_login  TEXT,
    login_count INTEGER NOT NULL DEFAULT 0
);

-- Tabella OTP (ogni tentativo di login/registrazione genera un record)
CREATE TABLE IF NOT EXISTS otp_tokens (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    otp_hash    TEXT    NOT NULL,
    purpose     TEXT    NOT NULL CHECK(purpose IN ('registration','login')),
    attempts    INTEGER NOT NULL DEFAULT 0,
    used        INTEGER NOT NULL DEFAULT 0,
    expires_at  TEXT    NOT NULL,
    created_at  TEXT    NOT NULL DEFAULT (datetime('now')),
    ip_address  TEXT,
    user_agent  TEXT
);

-- Tabella sessioni di rete (accessi WiFi autorizzati)
CREATE TABLE IF NOT EXISTS network_sessions (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    uuid            TEXT    NOT NULL UNIQUE,
    user_id         INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    mac_address     TEXT,
    ip_address      TEXT,
    network_mode    TEXT    NOT NULL CHECK(network_mode IN ('mikrotik','pfsense','ruijie','demo')),
    external_session_id TEXT,
    status          TEXT    NOT NULL DEFAULT 'active'
                            CHECK(status IN ('active','expired','disconnected','revoked')),
    ssid            TEXT,
    ap_mac          TEXT,
    gateway_ip      TEXT,
    gateway_port    TEXT,
    started_at      TEXT    NOT NULL DEFAULT (datetime('now')),
    expires_at      TEXT,
    ended_at        TEXT,
    bytes_up        INTEGER DEFAULT 0,
    bytes_down      INTEGER DEFAULT 0
);

-- Tabella log accessi (audit trail per GDPR)
CREATE TABLE IF NOT EXISTS access_logs (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id     INTEGER REFERENCES users(id) ON DELETE SET NULL,
    event_type  TEXT    NOT NULL,
    ip_address  TEXT,
    mac_address TEXT,
    user_agent  TEXT,
    details     TEXT,  -- JSON
    created_at  TEXT   NOT NULL DEFAULT (datetime('now'))
);

-- Tabella voucher pfSense (solo per PFSENSE_MODE=voucher)
CREATE TABLE IF NOT EXISTS pfsense_vouchers (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    voucher     TEXT    NOT NULL UNIQUE,
    user_id     INTEGER REFERENCES users(id) ON DELETE SET NULL,
    roll        INTEGER,
    duration_minutes INTEGER,
    used        INTEGER NOT NULL DEFAULT 0,
    used_at     TEXT,
    created_at  TEXT    NOT NULL DEFAULT (datetime('now'))
);

-- Indici per performance
CREATE INDEX IF NOT EXISTS idx_users_email     ON users(email);
CREATE INDEX IF NOT EXISTS idx_users_status    ON users(status);
CREATE INDEX IF NOT EXISTS idx_otp_user        ON otp_tokens(user_id);
CREATE INDEX IF NOT EXISTS idx_otp_expires     ON otp_tokens(expires_at);
CREATE INDEX IF NOT EXISTS idx_sessions_user   ON network_sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_sessions_mac    ON network_sessions(mac_address);
CREATE INDEX IF NOT EXISTS idx_sessions_status ON network_sessions(status);
CREATE INDEX IF NOT EXISTS idx_logs_user       ON access_logs(user_id);
CREATE INDEX IF NOT EXISTS idx_logs_created    ON access_logs(created_at);

-- Trigger aggiornamento updated_at sugli utenti
CREATE TRIGGER IF NOT EXISTS users_updated_at
    AFTER UPDATE ON users
    BEGIN
        UPDATE users SET updated_at = datetime('now') WHERE id = NEW.id;
    END;
