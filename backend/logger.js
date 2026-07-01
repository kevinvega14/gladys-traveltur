const winston = require('winston');
require('winston-daily-rotate-file');
const path = require('path');

const { combine, timestamp, printf, colorize, errors } = winston.format;

// Formato de cada línea de log: fecha [nivel]: mensaje
const logFormat = printf(({ level, message, timestamp, stack }) => {
    return `${timestamp} [${level.toUpperCase()}]: ${stack || message}`;
});

// Log general (todo lo que sea 'info' o más grave), rotado por día, se queda 14 días
const fileRotateTransport = new winston.transports.DailyRotateFile({
    filename: path.join(__dirname, 'logs', 'app-%DATE%.log'),
    datePattern: 'YYYY-MM-DD',
    maxFiles: '14d',
    zippedArchive: true
});

// Log SOLO de errores, separado, se queda 30 días (para auditar incidentes más atrás en el tiempo)
const errorFileRotateTransport = new winston.transports.DailyRotateFile({
    filename: path.join(__dirname, 'logs', 'error-%DATE%.log'),
    datePattern: 'YYYY-MM-DD',
    level: 'error',
    maxFiles: '30d',
    zippedArchive: true
});

const logger = winston.createLogger({
    levels: winston.config.npm.levels, // error, warn, info, http, verbose, debug, silly
    level: process.env.LOG_LEVEL || 'info',
    format: combine(
        errors({ stack: true }), // si le pasan un Error, guarda el stacktrace completo
        timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
        logFormat
    ),
    transports: [fileRotateTransport, errorFileRotateTransport],
    exitOnError: false
});

// En desarrollo, además mostramos todo en la terminal con colores
if (process.env.NODE_ENV !== 'production') {
    logger.add(new winston.transports.Console({
        format: combine(colorize(), timestamp({ format: 'HH:mm:ss' }), logFormat)
    }));
}

module.exports = logger;