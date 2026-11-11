// Servizio MikroTik: gestione accesso tramite RouterOS API
// Crea utenti hotspot e autorizza client via MAC/IP dopo verifica OTP

const logger = require('../config/logger');

// Connessione lazy: viene inizializzata alla prima chiamata
let RouterOSAPI = null;

function getRouterOSLib() {
    if (!RouterOSAPI) {
        // node-routeros supporta sia API (8728) che API-SSL (8729)
        RouterOSAPI = require('node-routeros').RouterOSAPI;
    }
    return RouterOSAPI;
}

// Crea una connessione all'API RouterOS e la chiude dopo l'uso
async function withConnection(callback) {
    const API = getRouterOSLib();
    const conn = new API({
        host:     process.env.MIKROTIK_HOST,
        user:     process.env.MIKROTIK_USER,
        password: process.env.MIKROTIK_PASSWORD,
        port:     parseInt(process.env.MIKROTIK_PORT || '8728'),
        tls:      process.env.MIKROTIK_USE_SSL === 'true'
    });

    try {
        await conn.connect();
        const result = await callback(conn);
        return result;
    } finally {
        // Chiusura garantita anche in caso di errore
        try { conn.close(); } catch { /* ignora errori di chiusura */ }
    }
}

// Autorizza un client nel hotspot MikroTik
// Crea l'utente hotspot se non esiste, poi lo autentica
async function authorizeClient({ email, macAddress, ipAddress, sessionId }) {
    const profile     = process.env.MIKROTIK_HOTSPOT_PROFILE   || 'default';
    const timeout     = process.env.MIKROTIK_SESSION_TIMEOUT    || '24h';
    const rateLimit   = process.env.MIKROTIK_RATE_LIMIT         || '10M/10M';
    // Usa email come username (sostituisce @ e . per compatibilità RouterOS)
    const username    = email.replace(/@/g, '_at_').replace(/\./g, '_');
    const password    = process.env.MIKROTIK_DEFAULT_PASSWORD || 'GuestWiFi!';

    return withConnection(async (conn) => {
        // Controlla se l'utente esiste già
        const existing = await conn.write('/ip/hotspot/user/print', [
            `?name=${username}`
        ]);

        if (existing.length === 0) {
            // Crea nuovo utente hotspot
            await conn.write('/ip/hotspot/user/add', [
                `=name=${username}`,
                `=password=${password}`,
                `=profile=${profile}`,
                `=limit-uptime=${timeout}`,
                `=rate-limit=${rateLimit}`,
                `=comment=Captive Portal - ${email}`
            ]);
            logger.info(`MikroTik: utente hotspot creato per ${email}`);
        }

        // Autentica il client attivo (login diretto senza pagina web)
        // Questo equivale a fare POST su /login con username+password
        await conn.write('/ip/hotspot/active/login', [
            `=user=${username}`,
            `=password=${password}`,
            `=mac-address=${macAddress || ''}`,
            `=ip=${ipAddress || ''}`,
        ]);

        logger.info(`MikroTik: client autorizzato — email=${email} mac=${macAddress}`);
        return { success: true, username };
    });
}

// Disconnette un client dal hotspot
async function deauthorizeClient({ macAddress, email }) {
    const username = email
        ? email.replace(/@/g, '_at_').replace(/\./g, '_')
        : null;

    return withConnection(async (conn) => {
        // Cerca la sessione attiva per MAC o username
        const query = macAddress
            ? `/ip/hotspot/active/print\n?mac-address=${macAddress}`
            : `/ip/hotspot/active/print\n?user=${username}`;

        const active = await conn.write(query.split('\n')[0], [
            query.split('\n')[1]
        ]);

        for (const session of active) {
            await conn.write('/ip/hotspot/active/remove', [`=.id=${session['.id']}`]);
        }

        logger.info(`MikroTik: client disconnesso — mac=${macAddress}`);
        return { success: true, removed: active.length };
    });
}

// Recupera le informazioni di un client attivo
async function getActiveClient(macAddress) {
    return withConnection(async (conn) => {
        const result = await conn.write('/ip/hotspot/active/print', [
            `?mac-address=${macAddress}`
        ]);
        return result[0] || null;
    });
}

// Verifica che la connessione all'apparato funzioni
async function testConnection() {
    try {
        return withConnection(async (conn) => {
            const identity = await conn.write('/system/identity/print');
            return { success: true, identity: identity[0]?.name };
        });
    } catch (err) {
        logger.error(`Test connessione MikroTik fallito: ${err.message}`);
        return { success: false, error: err.message };
    }
}

module.exports = { authorizeClient, deauthorizeClient, getActiveClient, testConnection };
