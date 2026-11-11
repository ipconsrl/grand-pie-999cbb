// Middleware rate limiting per proteggere gli endpoint sensibili
const rateLimit = require('express-rate-limit');
const logger    = require('../config/logger');

// Handler condiviso quando il limite viene superato
const onLimitReached = (req, res) => {
    logger.warn(`Rate limit superato — IP: ${req.ip} — URL: ${req.originalUrl}`);
    res.status(429).json({
        success: false,
        error:   'Troppe richieste. Attendi qualche minuto prima di riprovare.',
        code:    'RATE_LIMIT_EXCEEDED'
    });
};

// Limite globale: 100 richieste per 15 minuti
const globalRateLimit = rateLimit({
    windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS || '900000'),
    max:      parseInt(process.env.RATE_LIMIT_MAX_REQUESTS || '100'),
    standardHeaders: true,
    legacyHeaders:   false,
    handler: onLimitReached
});

// Limite stretto per endpoint OTP: max 5 richieste per 15 minuti per IP
const otpRateLimit = rateLimit({
    windowMs: 900000,
    max:      parseInt(process.env.OTP_RATE_LIMIT_MAX || '5'),
    keyGenerator: (req) => `${req.ip}-otp`,
    standardHeaders: true,
    legacyHeaders:   false,
    handler: onLimitReached
});

// Limite per registrazione: max 3 registrazioni per ora per IP
const registerRateLimit = rateLimit({
    windowMs: 3600000,
    max:      3,
    keyGenerator: (req) => `${req.ip}-register`,
    standardHeaders: true,
    legacyHeaders:   false,
    handler: onLimitReached
});

module.exports = { globalRateLimit, otpRateLimit, registerRateLimit };
