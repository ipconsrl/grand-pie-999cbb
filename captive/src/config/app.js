// Configurazione Express: middleware globali, sicurezza, routing
const express     = require('express');
const helmet      = require('helmet');
const cors        = require('cors');
const compression = require('compression');
const morgan      = require('morgan');
const cookieParser = require('cookie-parser');
const path        = require('path');
const logger      = require('./logger');
const { errorHandler, notFoundHandler } = require('../middleware/error.middleware');
const { globalRateLimit } = require('../middleware/rateLimit.middleware');
const routes      = require('../routes');

function createApp() {
    const app = express();

    // ── Security headers ──────────────────────────────────────────
    app.use(helmet({
        contentSecurityPolicy: {
            directives: {
                defaultSrc: ["'self'"],
                scriptSrc:  ["'self'", "'unsafe-inline'"],  // inline JS nei template
                styleSrc:   ["'self'", "'unsafe-inline'", 'fonts.googleapis.com'],
                fontSrc:    ["'self'", 'fonts.gstatic.com'],
                imgSrc:     ["'self'", 'data:'],
                connectSrc: ["'self'"]
            }
        }
    }));

    // ── CORS ──────────────────────────────────────────────────────
    const allowedOrigins = (process.env.ALLOWED_ORIGINS || 'http://localhost:3000').split(',');
    app.use(cors({
        origin: (origin, callback) => {
            // Permetti richieste senza origin (es. app mobile, curl)
            if (!origin || allowedOrigins.includes(origin)) return callback(null, true);
            callback(new Error('CORS: origin non permessa'));
        },
        credentials: true,
        methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS']
    }));

    // ── Parsing corpo richiesta ───────────────────────────────────
    app.use(express.json({ limit: '10kb' }));
    app.use(express.urlencoded({ extended: true, limit: '10kb' }));
    app.use(cookieParser());
    app.use(compression());

    // ── Logging HTTP ──────────────────────────────────────────────
    app.use(morgan('combined', {
        stream: { write: (msg) => logger.http(msg.trim()) },
        skip: (req) => req.url === '/health'
    }));

    // ── Rate limiting globale ─────────────────────────────────────
    app.use(globalRateLimit);

    // ── File statici ──────────────────────────────────────────────
    app.use(express.static(path.join(process.cwd(), 'public')));

    // ── View engine (HTML semplice) ───────────────────────────────
    app.set('views', path.join(process.cwd(), 'views'));

    // ── Route principale ──────────────────────────────────────────
    app.use('/', routes);

    // ── Health check ──────────────────────────────────────────────
    app.get('/health', (req, res) => {
        res.json({ status: 'ok', timestamp: new Date().toISOString() });
    });

    // ── 404 e gestione errori ─────────────────────────────────────
    app.use(notFoundHandler);
    app.use(errorHandler);

    return app;
}

module.exports = { createApp };
