// Configurazione logger Winston con rotazione giornaliera dei file
const winston = require('winston');
const DailyRotateFile = require('winston-daily-rotate-file');
const path = require('path');

const logDir = path.join(process.cwd(), 'logs');

const { combine, timestamp, printf, colorize, errors } = winston.format;

// Formato personalizzato per i log
const logFormat = printf(({ level, message, timestamp, stack }) => {
    return `${timestamp} [${level}]: ${stack || message}`;
});

const transports = [
    // Console con colori in sviluppo
    new winston.transports.Console({
        level: process.env.NODE_ENV === 'production' ? 'warn' : 'debug',
        format: combine(
            colorize(),
            timestamp({ format: 'HH:mm:ss' }),
            errors({ stack: true }),
            logFormat
        )
    }),
    // File rotante per tutti i log
    new DailyRotateFile({
        filename: path.join(logDir, 'app-%DATE%.log'),
        datePattern: 'YYYY-MM-DD',
        maxFiles: '30d',
        maxSize: '20m',
        level: 'info',
        format: combine(timestamp(), errors({ stack: true }), logFormat)
    }),
    // File separato solo per errori
    new DailyRotateFile({
        filename: path.join(logDir, 'error-%DATE%.log'),
        datePattern: 'YYYY-MM-DD',
        maxFiles: '30d',
        maxSize: '20m',
        level: 'error',
        format: combine(timestamp(), errors({ stack: true }), logFormat)
    })
];

const logger = winston.createLogger({
    level: 'debug',
    format: combine(timestamp(), errors({ stack: true })),
    transports,
    // Non far crashare il processo su errori di logging
    exitOnError: false
});

module.exports = logger;
