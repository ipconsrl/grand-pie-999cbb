// Middleware centralizzato per la gestione degli errori Express
const logger = require('../config/logger');

// Handler per route non trovate
function notFoundHandler(req, res) {
    res.status(404).json({
        success: false,
        error: `Risorsa non trovata: ${req.method} ${req.originalUrl}`,
        code: 'NOT_FOUND'
    });
}

// Handler globale degli errori (deve avere 4 parametri per essere riconosciuto da Express)
function errorHandler(err, req, res, next) { // eslint-disable-line no-unused-vars
    // Errori CORS
    if (err.message && err.message.includes('CORS')) {
        return res.status(403).json({ success: false, error: 'Accesso non consentito (CORS)', code: 'CORS_ERROR' });
    }

    // Errori di parsing JSON malformato
    if (err.type === 'entity.parse.failed') {
        return res.status(400).json({ success: false, error: 'Formato JSON non valido', code: 'INVALID_JSON' });
    }

    // Payload troppo grande
    if (err.type === 'entity.too.large') {
        return res.status(413).json({ success: false, error: 'Richiesta troppo grande', code: 'PAYLOAD_TOO_LARGE' });
    }

    // Logga tutti gli errori 500 con stack trace
    const statusCode = err.statusCode || err.status || 500;
    if (statusCode >= 500) {
        logger.error(`Errore interno [${statusCode}]: ${err.message}`, { stack: err.stack, url: req.originalUrl });
    } else {
        logger.warn(`Errore client [${statusCode}]: ${err.message}`);
    }

    const message = process.env.NODE_ENV === 'production' && statusCode >= 500
        ? 'Errore interno del server. Riprova tra qualche minuto.'
        : err.message || 'Errore sconosciuto';

    res.status(statusCode).json({
        success: false,
        error:   message,
        code:    err.code || 'INTERNAL_ERROR'
    });
}

module.exports = { notFoundHandler, errorHandler };
