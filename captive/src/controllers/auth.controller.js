// Controller autenticazione: registrazione, login e verifica OTP
const UserModel    = require('../models/user.model');
const otpService   = require('../services/otp.service');
const AccessLog    = require('../models/accessLog.model');
const { generateToken, getClientIp, sendSuccess, sendError } = require('../utils/helpers');
const logger       = require('../config/logger');

// POST /api/auth/register
// Crea l'utente e invia l'OTP via email
async function register(req, res) {
    const { nome, cognome, email, telefono, gdprConsent, marketingConsent, lingua } = req.body;
    const ip        = getClientIp(req);
    const userAgent = req.headers['user-agent'];
    const emailLow  = email.toLowerCase();

    // Controlla se l'email è già registrata con status verified
    const existing = UserModel.findByEmail(emailLow);
    if (existing && existing.status === 'verified') {
        // Invia comunque un OTP di login (utente già esistente)
        await otpService.sendOtp({ user: existing, purpose: 'login', ipAddress: ip, userAgent });
        return sendSuccess(res, {
            userId:    existing.id,
            purpose:   'login',
            message:   'Email già registrata. Ti abbiamo inviato un codice di accesso.',
            alreadyRegistered: true
        });
    }

    // Utente pending: aggiorna o reinvia l'OTP
    if (existing && existing.status === 'pending_verification') {
        try {
            await otpService.sendOtp({ user: existing, purpose: 'registration', ipAddress: ip, userAgent });
        } catch (err) {
            if (err.code === 'COOLDOWN_ACTIVE') {
                return sendError(res, err.message, 429, 'COOLDOWN_ACTIVE');
            }
            throw err;
        }
        return sendSuccess(res, {
            userId:  existing.id,
            purpose: 'registration',
            message: 'Codice OTP reinviato alla tua email.'
        });
    }

    // Nuovo utente
    const user = UserModel.create({ nome, cognome, email: emailLow, telefono, gdprConsent, marketingConsent, lingua });

    AccessLog.log({ userId: user.id, eventType: AccessLog.EVENTS.REGISTER_START, ipAddress: ip, userAgent });

    await otpService.sendOtp({ user, purpose: 'registration', ipAddress: ip, userAgent });

    AccessLog.log({ userId: user.id, eventType: AccessLog.EVENTS.OTP_SENT, ipAddress: ip });

    logger.info(`Nuova registrazione: ${emailLow} (userId=${user.id})`);

    return sendSuccess(res, {
        userId:  user.id,
        purpose: 'registration',
        message: 'Controlla la tua email per il codice di verifica.'
    }, 201);
}

// POST /api/auth/login
// Login passwordless: cerca l'email e invia OTP
async function login(req, res) {
    const { email } = req.body;
    const ip        = getClientIp(req);
    const userAgent = req.headers['user-agent'];
    const emailLow  = email.toLowerCase();

    const user = UserModel.findByEmail(emailLow);

    // Per sicurezza risponde sempre allo stesso modo (evita enumerazione utenti)
    if (!user) {
        // Risposta generica: non rivela se l'email esiste o meno
        return sendSuccess(res, {
            userId:  null,
            purpose: 'login',
            message: 'Se questa email è registrata, riceverai un codice di accesso.'
        });
    }

    if (user.status === 'blocked') {
        return sendError(res, 'Account bloccato. Contatta l\'assistenza.', 403, 'ACCOUNT_BLOCKED');
    }

    try {
        await otpService.sendOtp({ user, purpose: 'login', ipAddress: ip, userAgent });
    } catch (err) {
        if (err.code === 'COOLDOWN_ACTIVE') {
            return sendError(res, err.message, 429, 'COOLDOWN_ACTIVE', { remaining: err.remaining });
        }
        throw err;
    }

    AccessLog.log({ userId: user.id, eventType: AccessLog.EVENTS.LOGIN_START, ipAddress: ip, userAgent });

    return sendSuccess(res, {
        userId:  user.id,
        purpose: 'login',
        message: 'Se questa email è registrata, riceverai un codice di accesso.'
    });
}

// POST /api/auth/verify-otp
// Verifica il codice OTP inserito dall'utente
async function verifyOtp(req, res) {
    const { userId, otp, purpose } = req.body;
    const ip        = getClientIp(req);
    const userAgent = req.headers['user-agent'];

    const result = await otpService.verifyOtp({ userId, otpInput: otp, purpose });

    if (!result.valid) {
        AccessLog.log({
            userId,
            eventType: AccessLog.EVENTS.OTP_FAILED,
            ipAddress: ip,
            details: { error: result.error }
        });

        const statusCode = result.maxAttemptsReached ? 429 : 400;
        return sendError(res, result.error, statusCode, result.maxAttemptsReached ? 'MAX_ATTEMPTS' : 'OTP_INVALID');
    }

    const user = result.user;
    AccessLog.log({ userId: user.id, eventType: AccessLog.EVENTS.OTP_VERIFIED, ipAddress: ip });

    // Genera JWT con info utente e sessione
    const token = generateToken({
        id:     user.id,
        uuid:   user.uuid,
        email:  user.email,
        nome:   user.nome,
        status: user.status
    });

    // Imposta cookie HttpOnly per browser
    res.cookie('captive_token', token, {
        httpOnly: true,
        secure:   process.env.NODE_ENV === 'production',
        sameSite: 'lax',
        maxAge:   24 * 60 * 60 * 1000  // 24 ore
    });

    return sendSuccess(res, {
        token,
        user: {
            id:     user.id,
            nome:   user.nome,
            cognome: user.cognome,
            email:  user.email,
            status: user.status
        },
        purpose,
        message: purpose === 'registration' ? 'Registrazione completata!' : 'Accesso effettuato!'
    });
}

// POST /api/auth/resend-otp
async function resendOtp(req, res) {
    const { userId, purpose } = req.body;
    const ip        = getClientIp(req);
    const userAgent = req.headers['user-agent'];

    const user = UserModel.findById(userId);
    if (!user) return sendError(res, 'Utente non trovato', 404);

    try {
        await otpService.sendOtp({ user, purpose, ipAddress: ip, userAgent });
        AccessLog.log({ userId, eventType: AccessLog.EVENTS.OTP_SENT, ipAddress: ip });
        return sendSuccess(res, { message: 'Nuovo codice inviato alla tua email.' });
    } catch (err) {
        if (err.code === 'COOLDOWN_ACTIVE') {
            return sendError(res, err.message, 429, 'COOLDOWN_ACTIVE', { remaining: err.remaining });
        }
        throw err;
    }
}

// POST /api/auth/logout
async function logout(req, res) {
    res.clearCookie('captive_token');
    return sendSuccess(res, { message: 'Logout effettuato.' });
}

module.exports = { register, login, verifyOtp, resendOtp, logout };
