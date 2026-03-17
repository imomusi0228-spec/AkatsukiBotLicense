// filename: src/api/middleware/errorHandler.js
const logger = require('../../utils/logger');

module.exports = (err, req, res, next) => {
    logger.error('[API] Unhandled Error:', {
        message: err.message,
        stack: err.stack,
        path: req.path,
        method: req.method
    });

    res.status(err.status || 500).json({
        success: false,
        message: err.message || 'Internal Server Error'
    });
};
