// filename: src/api/server.js
const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const { API_PORT } = require('../config/env');
const logger = require('../utils/logger');
const errorHandler = require('./middleware/errorHandler');

const authRoutes = require('./routes/auth');
const healthRoutes = require('./routes/health');

const app = express();

// セキュリティ・ミドルウェア
app.use(helmet());
app.use(cors());
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true }));

// ログミドルウェア (簡易)
app.use((req, res, next) => {
    logger.debug(`[API] ${req.method} ${req.path}`);
    next();
});

// ルート登録
app.use('/api/auth', authRoutes);
app.use('/api/health', healthRoutes);

// エラーハンドリング (最後に登録)
app.use(errorHandler);

/**
 * サーバー起動関数
 */
const startApiServer = () => {
    return new Promise((resolve) => {
        app.listen(API_PORT, () => {
            logger.info(`[API] Server is running on port ${API_PORT}`);
            resolve(app);
        });
    });
};

module.exports = {
    app,
    startApiServer
};
