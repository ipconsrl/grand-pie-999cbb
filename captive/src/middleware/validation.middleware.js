// Middleware di validazione input con express-validator
const { body, validationResult } = require('express-validator');
const { sendError } = require('../utils/helpers');

// Esegue i validator e blocca la richiesta se ci sono errori
function validate(req, res, next) {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
        const messages = errors.array().map(e => e.msg).join('; ');
        return sendError(res, messages, 422, 'VALIDATION_ERROR');
    }
    next();
}

// Regole validazione per registrazione
const registerRules = [
    body('nome')
        .trim().notEmpty().withMessage('Il nome è obbligatorio')
        .isLength({ max: 50 }).withMessage('Nome troppo lungo')
        .matches(/^[a-zA-ZÀ-ÿ\s'-]+$/).withMessage('Nome non valido'),
    body('cognome')
        .trim().notEmpty().withMessage('Il cognome è obbligatorio')
        .isLength({ max: 50 }).withMessage('Cognome troppo lungo')
        .matches(/^[a-zA-ZÀ-ÿ\s'-]+$/).withMessage('Cognome non valido'),
    body('email')
        .trim().normalizeEmail().isEmail().withMessage('Inserisci un indirizzo email valido')
        .isLength({ max: 255 }),
    body('telefono')
        .optional({ checkFalsy: true })
        .trim()
        .matches(/^[\d\s\+\-\(\)]{7,20}$/).withMessage('Numero di telefono non valido'),
    body('gdprConsent')
        .isBoolean().toBoolean()
        .equals('true').withMessage('Devi accettare i termini e la privacy policy'),
    body('marketingConsent')
        .optional().isBoolean().toBoolean()
];

// Regole validazione per login (solo email)
const loginRules = [
    body('email')
        .trim().normalizeEmail().isEmail().withMessage('Inserisci un indirizzo email valido')
];

// Regole validazione per verifica OTP
const verifyOtpRules = [
    body('otp')
        .trim().notEmpty().withMessage('Inserisci il codice OTP')
        .isNumeric().withMessage('Il codice OTP deve essere numerico')
        .isLength({ min: 6, max: 6 }).withMessage('Il codice OTP deve essere di 6 cifre'),
    body('userId')
        .notEmpty().withMessage('userId mancante')
        .isInt({ min: 1 }).toInt(),
    body('purpose')
        .isIn(['registration', 'login']).withMessage('Scopo non valido')
];

module.exports = { validate, registerRules, loginRules, verifyOtpRules };
