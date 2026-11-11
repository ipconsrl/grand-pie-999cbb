// Servizio OTP: generazione, invio e validazione dei codici one-time-password
const crypto      = require('crypto');
const OtpModel    = require('../models/otp.model');
const UserModel   = require('../models/user.model');
const emailService = require('./email.service');
const logger      = require('../config/logger');

const OTP_LENGTH    = parseInt(process.env.OTP_LENGTH || '6');
const MAX_ATTEMPTS  = parseInt(process.env.OTP_MAX_ATTEMPTS || '3');

// Genera un OTP numerico crittograficamente sicuro
function generateOtp() {
    const max   = Math.pow(10, OTP_LENGTH);
    const min   = Math.pow(10, OTP_LENGTH - 1);
    // Usa crypto per sicurezza crittografica (non Math.random)
    const range = max - min;
    const bytes = crypto.randomBytes(4);
    const num   = (bytes.readUInt32BE(0) % range) + min;
    return String(num).padStart(OTP_LENGTH, '0');
}

// Invia un nuovo OTP all'utente (per registrazione o login)
async function sendOtp({ user, purpose, ipAddress, userAgent }) {
    // Controlla cooldown reinvio
    if (OtpModel.isResendCooldownActive(user.id, purpose)) {
        const remaining = OtpModel.getResendCooldownRemaining(user.id, purpose);
        throw Object.assign(new Error(`Attendere ${remaining} secondi prima di richiedere un nuovo codice.`), {
            code:      'COOLDOWN_ACTIVE',
            remaining: remaining
        });
    }

    const otp = generateOtp();

    // Salva nel DB (invalida automaticamente i precedenti)
    await OtpModel.create({
        userId:    user.id,
        otpPlaintext: otp,
        purpose,
        ipAddress,
        userAgent
    });

    // Invia via Brevo
    await emailService.sendOtpEmail({
        toEmail: user.email,
        toName:  `${user.nome} ${user.cognome}`,
        otp,
        purpose
    });

    logger.info(`OTP inviato a userId=${user.id} (purpose=${purpose})`);

    // In sviluppo logga l'OTP per facilitare i test — MAI in produzione
    if (process.env.NODE_ENV !== 'production') {
        logger.debug(`[DEV] OTP per ${user.email}: ${otp}`);
    }

    return true;
}

// Verifica l'OTP inserito dall'utente
// Restituisce { valid, user, error, attemptsLeft }
async function verifyOtp({ userId, otpInput, purpose }) {
    const otpRecord = OtpModel.getActiveForUser(userId, purpose);

    if (!otpRecord) {
        return { valid: false, error: 'Nessun codice attivo. Richiedine uno nuovo.' };
    }

    // Controlla se i tentativi massimi sono stati raggiunti
    if (otpRecord.attempts >= MAX_ATTEMPTS) {
        OtpModel.markUsed(otpRecord.id);
        return { valid: false, error: 'Troppi tentativi errati. Richiedi un nuovo codice.', maxAttemptsReached: true };
    }

    const isValid = await OtpModel.verify(otpRecord, otpInput);

    if (!isValid) {
        OtpModel.incrementAttempts(otpRecord.id);
        const attemptsLeft = MAX_ATTEMPTS - (otpRecord.attempts + 1);
        return {
            valid: false,
            error: `Codice non valido. Tentativi rimasti: ${attemptsLeft}`,
            attemptsLeft
        };
    }

    // OTP corretto: marcalo come usato
    OtpModel.markUsed(otpRecord.id);

    // Aggiorna lo stato dell'utente
    let user;
    if (purpose === 'registration') {
        user = UserModel.setVerified(userId);
    } else {
        UserModel.recordLogin(userId);
        user = UserModel.findById(userId);
    }

    logger.info(`OTP verificato correttamente per userId=${userId} (purpose=${purpose})`);
    return { valid: true, user };
}

module.exports = { sendOtp, verifyOtp, generateOtp };
