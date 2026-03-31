// filename: src/api/server.js
const express = require('express');
const path = require('path');
const cookieParser = require('cookie-parser');
const helmet = require('helmet');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
const { API_PORT } = require('../config/env');
const logger = require('../utils/logger');
const errorHandler = require('./middleware/errorHandler');

const app = express();

// --- Unification: Trust Proxy for scaled environments ---
app.set('trust proxy', 1);

// --- Unification: Security Headers (Enhanced) ---
app.use(helmet({
    contentSecurityPolicy: {
        directives: {
            defaultSrc: ["'self'"],
            scriptSrc: ["'self'", "'unsafe-inline'", "'unsafe-eval'", "cdn.jsdelivr.net", "unpkg.com", "cdnjs.cloudflare.com"],
            styleSrc: ["'self'", "'unsafe-inline'", "cdn.jsdelivr.net", "fonts.googleapis.com", "cdnjs.cloudflare.com"],
            fontSrc: ["'self'", "fonts.gstatic.com", "cdnjs.cloudflare.com"],
            imgSrc: ["'self'", "data:", "cdn.discordapp.com", "images-ext-1.discordapp.net"],
            connectSrc: ["'self'"],
            upgradeInsecureRequests: null
        }
    },
    hsts: false
}));

app.use(cors());
app.use(cookieParser());
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true }));

// --- Unification: Global Rate Limiter ---
const limiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 1000,
    standardHeaders: true,
    legacyHeaders: false,
});
app.use('/api/', limiter);

// --- Unification: Request Logger ---
app.use((req, res, next) => {
    if (!req.path.startsWith('/css') && !req.path.startsWith('/js') && !req.path.includes('.png')) {
        const start = Date.now();
        res.on('finish', () => {
            const duration = Date.now() - start;
            if (req.path.startsWith('/api/') || res.statusCode >= 400) {
                logger.debug(`[API] ${req.method} ${req.originalUrl} - IP: ${req.ip} - Status: ${res.statusCode} - ${duration}ms`);
            }
        });
    }
    next();
});

// --- Unification: Static Files & Root Route ---
app.get('/', (req, res) => {
    res.set('Cache-Control', 'no-store, no-cache, must-revalidate, private');
    res.sendFile(path.join(__dirname, '../../public', 'index.html'));
});
app.use(express.static(path.join(__dirname, '../../public')));

// Health Check
app.get('/health', (req, res) => res.sendStatus(200));

// --- Unification: Routes (Consolidated from Root Server) ---
const routesToMount = [
    { path: '/api/auth', module: '../../routes/auth' },
    { path: '/api/subscriptions', module: '../../routes/subscriptions' },
    { path: '/api/applications', module: '../../routes/applications' },
    { path: '/api/settings', module: '../../routes/settings' },
    { path: '/api/logs', module: '../../routes/logs' },
    { path: '/api/blacklist', module: '../../routes/blacklist' },
    { path: '/api/automations', module: '../../routes/automations' },
    { path: '/api/portal', module: '../../routes/portal' },
    { path: '/api/system', module: '../../routes/system' },
    { path: '/api', module: '../../routes/misc' }
];

routesToMount.forEach(route => {
    try {
        const handler = require(route.module);
        if (typeof handler === 'function') {
            app.use(route.path, handler);
        }
    } catch (err) {
        logger.error(`[Router Fatal] Failed to load module "${route.module}":`, err.message);
    }
});

// エラーハンドリング (最後に登録)
app.use(errorHandler);

/**
 * サーバー起動関数
 */
const startApiServer = (discordClient) => {
    app.discordClient = discordClient;
    return new Promise((resolve) => {
        app.listen(API_PORT, '0.0.0.0', () => {
            logger.info(`[API] Unified Server is running on port ${API_PORT}`);
            resolve(app);
        });
    });
};

module.exports = {
    app,
    startApiServer
};
