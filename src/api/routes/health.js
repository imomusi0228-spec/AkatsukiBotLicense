// filename: src/api/routes/health.js
const express = require('express');
const router = express.Router();

/**
 * サービス稼働監視用エンドポイント
 * GET /api/health
 */
router.get('/', (req, res) => {
    res.json({
        ok: true,
        service: 'akatsuki-license-server',
        timestamp: new Date().toISOString()
    });
});

module.exports = router;
