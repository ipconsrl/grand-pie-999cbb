// Route autenticazione: registrazione, login, OTP
const express    = require('express');
const router     = express.Router();
const ctrl       = require('../controllers/auth.controller');
const { registerRules, loginRules, verifyOtpRules, validate } = require('../middleware/validation.middleware');
const { otpRateLimit, registerRateLimit } = require('../middleware/rateLimit.middleware');
const { body }   = require('express-validator');

// Registrazione nuovo utente
router.post('/register', registerRateLimit, registerRules, validate, ctrl.register);

// Login utente esistente (passwordless)
router.post('/login', loginRules, validate, ctrl.login);

// Verifica OTP
router.post('/verify-otp', otpRateLimit, verifyOtpRules, validate, ctrl.verifyOtp);

// Reinvio OTP
router.post('/resend-otp', otpRateLimit, [
    body('userId').notEmpty().isInt({ min: 1 }).toInt(),
    body('purpose').isIn(['registration', 'login'])
], validate, ctrl.resendOtp);

// Logout
router.post('/logout', ctrl.logout);

module.exports = router;
