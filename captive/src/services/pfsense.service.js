// Servizio pfSense: autorizzazione via voucher o server RADIUS integrato
// Supporta entrambe le modalità configurabili via PFSENSE_MODE

const https   = require('https');
const http    = require('http');
const dgram   = require('dgram');
const logger  = require('../config/logger');

// ── MODALITÀ VOUCHER ─────────────────────────────────────────────────────────

// Chiama l'API REST pfSense per ottenere un voucher disponibile
// Richiede il pacchetto pfSense-pkg-API installato su pfSense
async function getAvailableVoucher() {
    const { getDatabase } = require('../config/database');
    const db = getDatabase();

    // Prima cerca un voucher locale non ancora usato
    const local = db.prepare(`
        SELECT * FROM pfsense_vouchers WHERE used = 0 ORDER BY id LIMIT 1
    `).get();

    if (local) {
        return local.voucher;
    }

    // Se non ci sono voucher locali, li recupera da pfSense via API
    return fetchVouchersFromPfsense();
}

async function fetchVouchersFromPfsense() {
    const host    = process.env.PFSENSE_HOST;
    const apiKey  = process.env.PFSENSE_API_KEY;
    const apiSec  = process.env.PFSENSE_API_SECRET;
    const zoneId  = process.env.PFSENSE_ZONE_ID || 'captiveportal';

    if (!host || !apiKey) {
        throw new Error('pfSense: PFSENSE_HOST e PFSENSE_API_KEY non configurati');
    }

    const url = `${host}/api/v1/services/captiveportal/voucher?zone=${zoneId}`;

    return new Promise((resolve, reject) => {
        const parsedUrl = new URL(url);
        const options = {
            hostname: parsedUrl.hostname,
            port:     parsedUrl.port || 443,
            path:     parsedUrl.pathname + parsedUrl.search,
            method:   'GET',
            headers:  {
                'Authorization': `Basic ${Buffer.from(`${apiKey}:${apiSec}`).toString('base64')}`,
                'Content-Type':  'application/json'
            },
            // In sviluppo accetta certificati auto-firmati
            rejectUnauthorized: process.env.NODE_ENV === 'production'
        };

        const req = https.request(options, (res) => {
            let data = '';
            res.on('data', (chunk) => data += chunk);
            res.on('end', () => {
                try {
                    const json = JSON.parse(data);
                    if (json.data && json.data.length > 0) {
                        resolve(json.data[0].voucher);
                    } else {
                        reject(new Error('Nessun voucher disponibile su pfSense'));
                    }
                } catch (e) {
                    reject(e);
                }
            });
        });
        req.on('error', reject);
        req.end();
    });
}

// Marca il voucher come usato localmente
function markVoucherUsed(voucher, userId) {
    const { getDatabase } = require('../config/database');
    getDatabase().prepare(`
        UPDATE pfsense_vouchers SET used = 1, used_at = datetime('now'), user_id = ?
        WHERE voucher = ?
    `).run(userId, voucher);
}

// ── MODALITÀ RADIUS ──────────────────────────────────────────────────────────

// Dizionario RADIUS minimo (Access-Accept con attributi Vendor-Specific)
const RADIUS_CODE = { REQUEST: 1, ACCEPT: 2, REJECT: 3, CHALLENGE: 11, ACCOUNTING_REQUEST: 4 };

// Il server RADIUS viene avviato separatamente da server.js
// Qui gestiamo solo la logica di autorizzazione lato applicazione

const authorizedUsers = new Map(); // MAC -> { email, authorizedAt }

// Autorizza un MAC address nel registro interno (usato dal server RADIUS)
function authorizeUser(email, macAddress) {
    const key = normalizeMac(macAddress);
    authorizedUsers.set(key, { email, authorizedAt: Date.now() });
    logger.info(`pfSense RADIUS: utente autorizzato — ${email} (mac: ${key})`);
}

// Controlla se un MAC è autorizzato (chiamato dal server RADIUS)
function isAuthorized(macAddress) {
    const key = normalizeMac(macAddress);
    return authorizedUsers.has(key);
}

function normalizeMac(mac) {
    if (!mac) return '';
    return mac.toLowerCase().replace(/[^a-f0-9]/g, '').replace(/(.{2})(?=.)/g, '$1:');
}

// Avvia il server RADIUS UDP integrato
function startRadiusServer() {
    const port   = parseInt(process.env.RADIUS_PORT || '1812');
    const secret = process.env.RADIUS_SECRET || 'radius_secret';
    const server = dgram.createSocket('udp4');

    server.on('message', (msg, rinfo) => {
        handleRadiusPacket(msg, rinfo, server, secret);
    });

    server.on('error', (err) => {
        logger.error(`Errore server RADIUS: ${err.message}`);
    });

    server.bind(port, process.env.RADIUS_HOST || '0.0.0.0', () => {
        logger.info(`Server RADIUS in ascolto su porta UDP ${port}`);
    });

    return server;
}

// Gestisce un pacchetto RADIUS in arrivo
function handleRadiusPacket(msg, rinfo, server, secret) {
    // Il pacchetto RADIUS ha: code(1), identifier(1), length(2), authenticator(16), attributes(var)
    if (msg.length < 20) return;

    const code       = msg[0];
    const identifier = msg[1];

    if (code !== RADIUS_CODE.REQUEST) return;

    // Estrae gli attributi RADIUS per trovare il MAC address (Calling-Station-Id = attr 31)
    const mac = extractRadiusAttr(msg, 31);
    const user = extractRadiusAttr(msg, 1);  // User-Name = attr 1

    logger.debug(`RADIUS Access-Request da ${rinfo.address} — user=${user} mac=${mac}`);

    // Decide se accettare o rifiutare
    const accept = isAuthorized(mac) || isAuthorized(user);
    const responseCode = accept ? RADIUS_CODE.ACCEPT : RADIUS_CODE.REJECT;

    const response = buildRadiusResponse(responseCode, identifier, msg.slice(4, 20), secret);
    server.send(response, rinfo.port, rinfo.address);

    logger.debug(`RADIUS risposta ${accept ? 'ACCEPT' : 'REJECT'} inviata a ${rinfo.address}`);
}

// Costruisce un pacchetto RADIUS di risposta minimo
function buildRadiusResponse(code, identifier, requestAuth, secret) {
    const crypto = require('crypto');
    const response = Buffer.alloc(20);
    response[0] = code;
    response[1] = identifier;
    response.writeUInt16BE(20, 2);

    // Response Authenticator = MD5(Code+ID+Length+RequestAuth+Attributes+Secret)
    const md5 = crypto.createHash('md5');
    md5.update(response.slice(0, 4));
    md5.update(requestAuth);
    md5.update(Buffer.from(secret));
    const auth = md5.digest();
    auth.copy(response, 4);

    return response;
}

// Estrae il valore di un attributo RADIUS dal pacchetto
function extractRadiusAttr(msg, type) {
    let offset = 20;
    while (offset < msg.length) {
        const attrType = msg[offset];
        const attrLen  = msg[offset + 1];
        if (attrLen < 2 || offset + attrLen > msg.length) break;

        if (attrType === type) {
            return msg.slice(offset + 2, offset + attrLen).toString('utf8');
        }
        offset += attrLen;
    }
    return null;
}

// Punto di ingresso unificato: autorizza l'utente nella modalità configurata
async function authorizeClient({ email, macAddress, userId }) {
    const mode = process.env.PFSENSE_MODE || 'radius';

    if (mode === 'voucher') {
        const voucher = await getAvailableVoucher();
        markVoucherUsed(voucher, userId);
        return { success: true, mode: 'voucher', voucher };
    }

    // Modalità RADIUS: registra nel map degli autorizzati
    authorizeUser(email, macAddress);
    return { success: true, mode: 'radius' };
}

module.exports = { authorizeClient, authorizeUser, isAuthorized, startRadiusServer, getAvailableVoucher };
