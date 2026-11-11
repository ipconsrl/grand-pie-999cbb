// Controller integrazione rete: gestisce l'autorizzazione su MikroTik, pfSense, Ruijie
const SessionModel = require('../models/session.model');
const AccessLog    = require('../models/accessLog.model');
const { extractMacFromQuery, getClientIp, sendSuccess, sendError } = require('../utils/helpers');
const logger       = require('../config/logger');

// Mappa dei service in base al NETWORK_MODE
function getNetworkService() {
    const mode = (process.env.NETWORK_MODE || 'demo').toLowerCase();
    switch (mode) {
        case 'mikrotik': return require('../services/mikrotik.service');
        case 'pfsense':  return require('../services/pfsense.service');
        case 'ruijie':   return require('../services/ruijie.service');
        default:         return null;  // modalità demo: non chiama nessun apparato
    }
}

// POST /api/network/authorize
// Chiamato dopo la verifica OTP per autorizzare l'accesso alla rete
async function authorizeAccess(req, res) {
    if (!req.user) return sendError(res, 'Autenticazione richiesta', 401);

    const mode = (process.env.NETWORK_MODE || 'demo').toLowerCase();
    const ip   = getClientIp(req);

    // Parametri passati dalla pagina di redirect del captive portal
    const macAddress = extractMacFromQuery(req.body) || extractMacFromQuery(req.query);
    const { gwAddress, gwPort, ssid, apMac, linkLogin, linkOrig } = req.body;

    // Crea il record di sessione nel DB
    const session = SessionModel.create({
        userId:       req.user.id,
        macAddress,
        ipAddress:    ip,
        networkMode:  mode,
        ssid,
        apMac,
        gatewayIp:    gwAddress,
        gatewayPort:  gwPort
    });

    AccessLog.log({
        userId:     req.user.id,
        eventType:  AccessLog.EVENTS.SESSION_START,
        ipAddress:  ip,
        macAddress,
        details:    { mode, ssid, sessionId: session.uuid }
    });

    // Modalità demo: nessuna chiamata ad apparati reali
    if (mode === 'demo') {
        logger.info(`[DEMO] Accesso autorizzato — userId=${req.user.id} mac=${macAddress}`);
        return sendSuccess(res, {
            authorized:  true,
            sessionUuid: session.uuid,
            mode:        'demo',
            redirectUrl: linkOrig || process.env.BASE_URL || 'http://captive.apple.com'
        });
    }

    const service = getNetworkService();
    if (!service) {
        return sendError(res, `NETWORK_MODE "${mode}" non supportato`, 500);
    }

    try {
        const result = await service.authorizeClient({
            email:      req.user.email,
            userId:     req.user.id,
            macAddress,
            ipAddress:  ip,
            gwAddress,
            gwPort,
            ssid,
            apMac,
            linkLogin,
            sessionId:  session.uuid
        });

        // Salva l'ID sessione restituito dall'apparato
        if (result.externalSessionId) {
            SessionModel.updateExternalId(session.id, result.externalSessionId);
        }

        AccessLog.log({
            userId:    req.user.id,
            eventType: AccessLog.EVENTS.NETWORK_AUTH,
            ipAddress: ip,
            macAddress,
            details:   result
        });

        logger.info(`Accesso autorizzato su ${mode} — userId=${req.user.id} mac=${macAddress}`);

        return sendSuccess(res, {
            authorized:  true,
            sessionUuid: session.uuid,
            mode,
            data:        result,
            redirectUrl: linkOrig || process.env.BASE_URL
        });

    } catch (err) {
        logger.error(`Errore autorizzazione ${mode}: ${err.message}`);
        SessionModel.updateStatus(session.id, 'revoked');
        return sendError(res, `Errore durante l'autorizzazione: ${err.message}`, 500, 'NETWORK_AUTH_ERROR');
    }
}

// POST /api/network/logout
// Disconnette il client dalla rete
async function revokeAccess(req, res) {
    if (!req.user) return sendError(res, 'Autenticazione richiesta', 401);

    const mode    = (process.env.NETWORK_MODE || 'demo').toLowerCase();
    const ip      = getClientIp(req);
    const macAddress = extractMacFromQuery(req.body) || extractMacFromQuery(req.query);

    SessionModel.revokeAllForUser(req.user.id);

    if (mode !== 'demo') {
        try {
            const service = getNetworkService();
            if (service?.deauthorizeClient) {
                await service.deauthorizeClient({ email: req.user.email, macAddress });
            }
        } catch (err) {
            logger.warn(`Errore revoca accesso ${mode}: ${err.message}`);
        }
    }

    AccessLog.log({ userId: req.user.id, eventType: AccessLog.EVENTS.SESSION_END, ipAddress: ip, macAddress });
    logger.info(`Accesso revocato — userId=${req.user.id}`);

    res.clearCookie('captive_token');
    return sendSuccess(res, { message: 'Disconnesso dalla rete.' });
}

// GET /api/network/status
// Stato della sessione corrente
async function getStatus(req, res) {
    if (!req.user) return sendError(res, 'Autenticazione richiesta', 401);

    const session = SessionModel.findActiveByUser(req.user.id);
    return sendSuccess(res, {
        active:  !!session,
        session: session ? {
            uuid:      session.uuid,
            startedAt: session.started_at,
            expiresAt: session.expires_at,
            mode:      session.network_mode
        } : null
    });
}

// GET /api/network/portal-params
// Riceve e salva i parametri del captive portal redirect (usato da MikroTik/Ruijie)
function receivePortalParams(req, res) {
    const params = { ...req.query, ...req.body };
    const mac    = extractMacFromQuery(params);

    // Salva i parametri nella sessione HTTP per il flusso auth successivo
    const portalData = {
        mac:        mac,
        ip:         params.ip || params.userip || getClientIp(req),
        gwAddress:  params.gwAddress || params['gw-address'],
        gwPort:     params.gwPort    || params['gw-port'],
        ssid:       params.ssid,
        apMac:      normalizeMacParam(params.apMac || params['ap-mac']),
        linkLogin:  params['link-login-only'] || params.linkLogin,
        linkOrig:   params['link-orig']       || params.linkOrig,
        mode:       process.env.NETWORK_MODE || 'demo'
    };

    return sendSuccess(res, { portalData });
}

function normalizeMacParam(mac) {
    if (!mac) return null;
    return mac.toLowerCase().replace(/[^a-f0-9]/g, '').replace(/(.{2})(?=.)/g, '$1:');
}

module.exports = { authorizeAccess, revokeAccess, getStatus, receivePortalParams };
