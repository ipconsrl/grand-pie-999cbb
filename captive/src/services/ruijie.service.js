// Servizio Ruijie Reyee: autorizzazione via External Portal API
// Supporta sia Ruijie Cloud (EWS) che gateway locale (SAC Portal)

const https   = require('https');
const http    = require('http');
const crypto  = require('crypto');
const logger  = require('../config/logger');

// Genera la firma HMAC-SHA256 per le richieste API Ruijie Cloud
function buildSignature(params, secret) {
    // Ordina i parametri per chiave e concatena key=value
    const sorted = Object.keys(params).sort().map(k => `${k}=${params[k]}`).join('&');
    return crypto.createHmac('sha256', secret).update(sorted).digest('hex').toUpperCase();
}

// Chiamata HTTP/HTTPS generica verso l'API Ruijie
async function ruijieRequest({ method, url, body, headers = {} }) {
    return new Promise((resolve, reject) => {
        const parsed  = new URL(url);
        const isHttps = parsed.protocol === 'https:';
        const lib     = isHttps ? https : http;

        const bodyStr = body ? JSON.stringify(body) : '';
        const options = {
            hostname: parsed.hostname,
            port:     parsed.port || (isHttps ? 443 : 80),
            path:     parsed.pathname + parsed.search,
            method,
            headers: {
                'Content-Type':   'application/json',
                'Content-Length': Buffer.byteLength(bodyStr),
                ...headers
            },
            rejectUnauthorized: process.env.NODE_ENV === 'production'
        };

        const req = lib.request(options, (res) => {
            let data = '';
            res.on('data', (c) => data += c);
            res.on('end', () => {
                try {
                    resolve({ status: res.statusCode, data: JSON.parse(data) });
                } catch {
                    resolve({ status: res.statusCode, data });
                }
            });
        });
        req.on('error', reject);
        if (bodyStr) req.write(bodyStr);
        req.end();
    });
}

// Autorizza un client tramite Ruijie Cloud EWS API
async function authorizeViaCloud({ userMac, apMac, ssid, gwAddress, gwPort, email }) {
    const apiUrl    = process.env.RUIJIE_CLOUD_API_URL;
    const apiKey    = process.env.RUIJIE_API_KEY;
    const apiSecret = process.env.RUIJIE_API_SECRET;
    const tenantId  = process.env.RUIJIE_TENANT_ID;
    const networkId = process.env.RUIJIE_NETWORK_ID;
    const duration  = parseInt(process.env.RUIJIE_AUTH_DURATION || '86400');
    const timestamp = Math.floor(Date.now() / 1000);

    if (!apiUrl || !apiKey || !apiSecret) {
        throw new Error('Ruijie Cloud: API URL, key e secret non configurati');
    }

    const params = {
        apiKey,
        tenantId,
        networkId,
        timestamp: String(timestamp),
        userMac:   normalizeMac(userMac),
        apMac:     normalizeMac(apMac),
        ssid:      ssid || '',
        duration:  String(duration)
    };

    params.sign = buildSignature(params, apiSecret);

    const url = `${apiUrl}/v1/portal/auth`;
    logger.debug(`Ruijie Cloud: autorizzazione per MAC ${params.userMac}`);

    try {
        const resp = await ruijieRequest({ method: 'POST', url, body: params });

        if (resp.status === 200 && resp.data?.code === 0) {
            logger.info(`Ruijie Cloud: client autorizzato — mac=${params.userMac} email=${email}`);
            return { success: true, data: resp.data };
        }

        logger.warn(`Ruijie Cloud: risposta inattesa — status=${resp.status} code=${resp.data?.code}`);
        throw new Error(resp.data?.message || `Errore Ruijie API: status ${resp.status}`);

    } catch (err) {
        logger.error(`Errore autorizzazione Ruijie: ${err.message}`);
        throw err;
    }
}

// Autorizzazione tramite gateway locale Ruijie (SAC Portal Protocol)
// Usato quando non si usa il cloud ma il gateway on-premise
async function authorizeViaGateway({ userMac, gwAddress, gwPort, redirectUrl }) {
    const duration = parseInt(process.env.RUIJIE_AUTH_DURATION || '86400');

    // Il gateway locale Ruijie accetta una GET con i parametri di autorizzazione
    const params = new URLSearchParams({
        wlanuserip:  '',
        wlanusermac: normalizeMac(userMac),
        wlanacip:    gwAddress || '',
        wlanacname:  '',
        ssid:        '',
        userurl:     redirectUrl || '',
        t:           String(Math.floor(Date.now() / 1000))
    });

    const url = `http://${gwAddress}:${gwPort || '8080'}/portal/auth?${params.toString()}`;

    try {
        const resp = await ruijieRequest({ method: 'GET', url });
        return { success: resp.status === 200, redirectUrl: resp.data };
    } catch (err) {
        logger.error(`Errore gateway Ruijie locale: ${err.message}`);
        throw err;
    }
}

function normalizeMac(mac) {
    if (!mac) return '';
    // Normalizza al formato AA:BB:CC:DD:EE:FF maiuscolo
    return mac.toUpperCase().replace(/[^A-F0-9]/g, '').replace(/(.{2})(?=.)/g, '$1:');
}

// Punto di ingresso: sceglie cloud o gateway locale in base alla configurazione
async function authorizeClient(params) {
    const { gwAddress, gwPort, userMac, apMac, ssid, email } = params;

    const useCloud = !!(process.env.RUIJIE_API_KEY && process.env.RUIJIE_CLOUD_API_URL);

    if (useCloud) {
        return authorizeViaCloud({ userMac, apMac, ssid, gwAddress, gwPort, email });
    }

    return authorizeViaGateway({ userMac, gwAddress, gwPort });
}

module.exports = { authorizeClient, normalizeMac };
