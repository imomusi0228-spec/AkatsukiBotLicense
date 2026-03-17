// filename: src/api/routes/auth.js
const express = require('express');
const router = express.Router();
const { z } = require('zod');
const { validateBody } = require('../middleware/validate');
const { verifyLicense, deactivateMachine } = require('../../services/licenseService');

// バリデーションスキーマ
const verifySchema = z.object({
    licenseKey: z.string().min(1),
    machineId: z.string().min(1),
    deviceName: z.string().optional(),
});

const deactivateSchema = z.object({
    licenseKey: z.string().min(1),
    machineId: z.string().min(1),
});

/**
 * ライセンス認証エンドポイント
 * POST /api/auth/verify
 */
router.post('/verify', validateBody(verifySchema), async (req, res, next) => {
    try {
        const { licenseKey, machineId, deviceName } = req.body;
        const ipAddress = req.ip || req.headers['x-forwarded-for'];

        const result = await verifyLicense({
            licenseKey,
            machineId,
            deviceName,
            ipAddress
        });

        if (result.success) {
            res.json(result);
        } else {
            res.status(403).json(result);
        }
    } catch (err) {
        next(err);
    }
});

/**
 * アクティベーション解除エンドポイント
 * POST /api/auth/deactivate
 */
router.post('/deactivate', validateBody(deactivateSchema), async (req, res, next) => {
    try {
        const { licenseKey, machineId } = req.body;
        const success = await deactivateMachine({ licenseKey, machineId });

        res.json({ success });
    } catch (err) {
        next(err);
    }
});

module.exports = router;
