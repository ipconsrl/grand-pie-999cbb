// Middleware di autenticazione JWT
const { verifyToken, sendError } = require('../utils/helpers');
const UserModel = require('../models/user.model');
const logger    = require('../config/logger');

// Verifica il JWT nell'header Authorization o nel cookie
function requireAuth(req, res, next) {
    let token;

    // Prima cerca nell'header Authorization: Bearer <token>
    const authHeader = req.headers['authorization'];
    if (authHeader && authHeader.startsWith('Bearer ')) {
        token = authHeader.slice(7);
    }

    // Poi nel cookie (alternativa per browser)
    if (!token && req.cookies && req.cookies.captive_token) {
        token = req.cookies.captive_token;
    }

    if (!token) {
        return sendError(res, 'Autenticazione richiesta', 401, 'NO_TOKEN');
    }

    try {
        const decoded = verifyToken(token);
        req.user = decoded;
        next();
    } catch (err) {
        if (err.name === 'TokenExpiredError') {
            return sendError(res, 'Sessione scaduta. Effettua nuovamente il login.', 401, 'TOKEN_EXPIRED');
        }
        return sendError(res, 'Token non valido', 401, 'INVALID_TOKEN');
    }
}

// Middleware opzionale: aggiunge req.user se il token è presente, ma non blocca
function optionalAuth(req, res, next) {
    const authHeader = req.headers['authorization'];
    const token = (authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null)
               || req.cookies?.captive_token;

    if (token) {
        try {
            req.user = verifyToken(token);
        } catch { /* token non valido, prosegui senza utente */ }
    }
    next();
}

// Controlla che l'utente abbia status "verified"
function requireVerified(req, res, next) {
    if (!req.user) return sendError(res, 'Autenticazione richiesta', 401);
    if (req.user.status !== 'verified') {
        return sendError(res, 'Account non verificato', 403, 'NOT_VERIFIED');
    }
    next();
}

module.exports = { requireAuth, optionalAuth, requireVerified };
