// Servizio email via Brevo (ex Sendinblue) con nodemailer
// Gestisce l'invio dell'OTP e altre notifiche transazionali

const nodemailer = require('nodemailer');
const fs         = require('fs');
const path       = require('path');
const logger     = require('../config/logger');

let transporter = null;

// Crea il transporter nodemailer con le credenziali Brevo
function getTransporter() {
    if (transporter) return transporter;

    transporter = nodemailer.createTransport({
        host:   process.env.BREVO_SMTP_HOST || 'smtp-relay.brevo.com',
        port:   parseInt(process.env.BREVO_SMTP_PORT || '587'),
        secure: false,  // STARTTLS su porta 587
        auth: {
            user: process.env.BREVO_SMTP_USER,
            pass: process.env.BREVO_SMTP_PASSWORD
        },
        tls: {
            rejectUnauthorized: process.env.NODE_ENV === 'production'
        }
    });

    return transporter;
}

// Carica e popola il template HTML dell'email OTP
function buildOtpEmailHtml(otp, userName, expiresMinutes) {
    const templatePath = path.join(process.cwd(), 'templates', 'email-otp.html');

    let html;
    try {
        html = fs.readFileSync(templatePath, 'utf8');
    } catch {
        // Fallback inline se il template non è trovato
        html = `
        <div style="font-family:Arial,sans-serif;max-width:480px;margin:auto;padding:24px;background:#f9fafb;border-radius:8px">
            <h2 style="color:#1e40af">Il tuo codice di accesso WiFi</h2>
            <p>Ciao <strong>${userName}</strong>,</p>
            <p>Usa questo codice per accedere alla rete WiFi:</p>
            <div style="background:#fff;border:2px solid #2563eb;border-radius:8px;text-align:center;padding:24px;margin:24px 0">
                <span style="font-size:40px;font-weight:bold;letter-spacing:12px;color:#1e40af">{{OTP}}</span>
            </div>
            <p style="color:#6b7280;font-size:14px">Questo codice è valido per <strong>${expiresMinutes} minuti</strong>.</p>
            <p style="color:#6b7280;font-size:14px">Se non hai effettuato questa richiesta, ignora questa email.</p>
        </div>`;
    }

    // Sostituisce tutti i placeholder nel template
    const portalName    = process.env.PORTAL_NAME || 'Guest WiFi';
    const companyName   = process.env.PORTAL_COMPANY_NAME || '';
    const baseUrl       = process.env.BASE_URL || 'http://localhost:3000';
    const privacyUrl    = `${baseUrl}${process.env.PORTAL_PRIVACY_URL || '/privacy'}`;

    return html
        .replace(/{{OTP}}/g,             otp)
        .replace(/{{USER_NAME}}/g,        userName)
        .replace(/{{EXPIRES_MINUTES}}/g,  String(expiresMinutes))
        .replace(/{{PORTAL_NAME}}/g,      portalName)
        .replace(/{{COMPANY_NAME}}/g,     companyName)
        .replace(/{{PRIVACY_URL}}/g,      privacyUrl)
        .replace(/{{YEAR}}/g,             String(new Date().getFullYear()));
}

// Invia email con OTP all'utente
async function sendOtpEmail({ toEmail, toName, otp, purpose }) {
    const expiresMinutes = parseInt(process.env.OTP_EXPIRES_MINUTES || '10');
    const senderEmail    = process.env.BREVO_SENDER_EMAIL;
    const senderName     = process.env.BREVO_SENDER_NAME || 'Guest WiFi';
    const portalName     = process.env.PORTAL_NAME || 'Guest WiFi';

    const subject = purpose === 'registration'
        ? `Conferma la tua registrazione — ${portalName}`
        : `Il tuo codice di accesso — ${portalName}`;

    const html = buildOtpEmailHtml(otp, toName, expiresMinutes);

    // Versione testo puro per client che non supportano HTML
    const text = `Ciao ${toName},\n\nIl tuo codice OTP è: ${otp}\n\nValido per ${expiresMinutes} minuti.\n\n${portalName}`;

    try {
        const info = await getTransporter().sendMail({
            from:    `"${senderName}" <${senderEmail}>`,
            to:      `"${toName}" <${toEmail}>`,
            subject,
            html,
            text
        });

        logger.info(`Email OTP inviata a ${toEmail} (messageId: ${info.messageId})`);
        return { success: true, messageId: info.messageId };

    } catch (err) {
        logger.error(`Errore invio email OTP a ${toEmail}: ${err.message}`);
        throw new Error('Impossibile inviare il codice via email. Riprovare tra qualche minuto.');
    }
}

// Verifica la connessione SMTP (usata all'avvio)
async function verifyConnection() {
    if (!process.env.BREVO_SMTP_USER) {
        logger.warn('BREVO_SMTP_USER non configurato — email in modalità test');
        return false;
    }
    try {
        await getTransporter().verify();
        logger.info('Connessione SMTP Brevo verificata con successo');
        return true;
    } catch (err) {
        logger.error(`Verifica SMTP Brevo fallita: ${err.message}`);
        return false;
    }
}

module.exports = { sendOtpEmail, verifyConnection };
