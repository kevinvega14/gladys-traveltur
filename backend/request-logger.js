const morgan = require('morgan');
const logger = require('./logger');

// Cada request queda como: "POST /admin/nuevo-viaje 200 45 - 87.234 ms"
const requestLogger = morgan(
    ':method :url :status :res[content-length] - :response-time ms',
    { stream: { write: (message) => logger.http(message.trim()) } }
);

module.exports = requestLogger;