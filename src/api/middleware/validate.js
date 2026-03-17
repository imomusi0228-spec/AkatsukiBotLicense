// filename: src/api/middleware/validate.js
const { z } = require('zod');

/**
 * リクエストボディのバリデーション用ミドルウェア
 * @param {z.ZodSchema} schema 
 */
const validateBody = (schema) => (req, res, next) => {
    try {
        req.body = schema.parse(req.body);
        next();
    } catch (err) {
        return res.status(400).json({
            success: false,
            message: 'Validation failed',
            errors: err.errors
        });
    }
};

module.exports = {
    validateBody
};
