const express = require('express');
const cookieParser = require('cookie-parser');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');



const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.set('trust proxy', 1);
app.use(cookieParser());

// DEBUG: Request Logger (Only for specific or error cases to keep logs clean)
app.use((req, res, next) => {
    if (!req.path.startsWith('/css') && !req.path.startsWith('/js') && !req.path.includes('.png')) {
        const start = Date.now();
        res.on('finish', () => {
            const duration = Date.now() - start;
            // Only log if it's an API call or an error
            if (req.path.startsWith('/api/') || res.statusCode >= 400) {
                const authHeader = req.headers['authorization'] ? 'AuthSet' : 'NoAuth';
                console.log(`[REQ] ${req.method} ${req.originalUrl} - Status: ${res.statusCode} - ${authHeader} - ${duration}ms`);
            }
        });
    }
    next();
});

// Security Headers
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

// Global Rate Limiting
const limiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 200, // Increased from 100 to be safer for dashboard usage
    standardHeaders: true,
    legacyHeaders: false,
});
app.use('/api/', limiter);

// Serve index.html without caching so UI updates show immediately
app.get('/', (req, res) => {
    // We can use the 'path' require from below by just requiring it inline or moving the require up.
    // Given the structure, let's just use require('path') inline to fix it quickly avoiding duplicate const.
    res.set('Cache-Control', 'no-store, no-cache, must-revalidate, private');
    res.sendFile(require('path').join(__dirname, 'public', 'index.html'));
});

app.use(express.static('public'));

// Health Check Endpoint (Keep-Alive)
app.get('/health', (req, res) => res.sendStatus(200));

const path = require('path');

// Mount Routes with Safety Check
const routes = [
    { path: '/api/auth', module: 'auth' },
    { path: '/api/subscriptions', module: 'subscriptions' },
    { path: '/api/applications', module: 'applications' },
    { path: '/api/settings', module: 'settings' },
    { path: '/api/logs', module: 'logs' },
    { path: '/api/blacklist', module: 'blacklist' },

    { path: '/api/automations', module: 'automations' },
    { path: '/api/portal', module: 'portal' },
    { path: '/api/system', module: 'system' },
    { path: '/api', module: 'misc' }
];

routes.forEach(route => {
    try {
        const routePath = path.join(__dirname, 'routes', route.module);
        const handler = require(routePath);
        if (typeof handler === 'function') {
            app.use(route.path, handler);
        } else {
            console.error(`[Router Error] Module "${route.module}" did not export a function (exported: ${typeof handler}). Path: ${routePath}`);
            // Fallback to empty router if possible, or just skip if it's already broken
        }
    } catch (err) {
        console.error(`[Router Fatal] Failed to load module "${route.module}":`, err.message);
    }
});

function startServer(client) {
    app.discordClient = client;

    // syncOnBoot は index.js の ClientReady で実行するように変更 (重複回避)

    app.listen(PORT, '0.0.0.0', () => {
        console.log(`Web Server running on port ${PORT}`);
    });
}

module.exports = { startServer };
