// Funzioni di utilità condivise tra controller e middleware

const jwt = require('jsonwebtoken');

// Genera un JWT con i dati dell'utente e della sessione di rete
function generateToken(payload) {
    return jwt.sign(payload, process.env.JWT_SECRET, {
        expiresIn: process.env.JWT_EXPIRES_IN || '24h'
    });
}

function verifyToken(token) {
    return jwt.verify(token, process.env.JWT_SECRET);
}

// Normalizza e valida il MAC address
function normalizeMac(mac) {
    if (!mac) return null;
    const clean = mac.replace(/[^a-fA-F0-9]/g, '');
    if (clean.length !== 12) return null;
    return clean.toLowerCase().replace(/(.{2})(?=.)/g, '$1:');
}

// Estrae il MAC address dalla query string in diversi formati (MikroTik, Ruijie)
function extractMacFromQuery(query) {
    return normalizeMac(
        query.mac || query.userMac || query['wlanusermac'] || query['client-mac'] || null
    );
}

// Estrae l'IP reale del client (considerando reverse proxy)
function getClientIp(req) {
    return (req.headers['x-forwarded-for'] || '').split(',')[0].trim()
        || req.headers['x-real-ip']
        || req.socket.remoteAddress
        || '0.0.0.0';
}

// Sanitizza una stringa per uso sicuro (rimuove tag HTML e caratteri pericolosi)
function sanitizeString(str, maxLen = 255) {
    if (typeof str !== 'string') return '';
    return str.replace(/<[^>]*>/g, '').replace(/['"`;\\]/g, '').trim().slice(0, maxLen);
}

// Formatta la data nel locale italiano
function formatDate(isoString) {
    if (!isoString) return '';
    return new Date(isoString).toLocaleString('it-IT', {
        day: '2-digit', month: '2-digit', year: 'numeric',
        hour: '2-digit', minute: '2-digit'
    });
}

// Risposta JSON standardizzata
function sendSuccess(res, data, statusCode = 200) {
    res.status(statusCode).json({ success: true, data });
}

function sendError(res, message, statusCode = 400, code = null) {
    res.status(statusCode).json({ success: false, error: message, code });
}

module.exports = { generateToken, verifyToken, normalizeMac, extractMacFromQuery, getClientIp, sanitizeString, formatDate, sendSuccess, sendError };
