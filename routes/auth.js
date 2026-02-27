const express = require('express');
const router = express.Router();
const axios = require('axios');
const crypto = require('crypto');
const db = require('../db');
require('dotenv').config();

const ADMIN_TOKEN = process.env.ADMIN_TOKEN;
const DISCORD_CLIENT_ID = process.env.CLIENT_ID || process.env.DISCORD_CLIENT_ID;
const DISCORD_CLIENT_SECRET = process.env.DISCORD_CLIENT_SECRET;
const PORT = process.env.PORT || 3000;
const PUBLIC_URL = (process.env.PUBLIC_URL || `http://localhost:${PORT}`).replace(/\/$/, '');
const REDIRECT_URI = `${PUBLIC_URL}/api/auth/callback`;

console.log(`[OAuth] Configured REDIRECT_URI: ${REDIRECT_URI}`);

// Cache for used codes to prevent replay attacks and rate limits
const usedCodes = new Set();
// Cleanup used codes every 10 minutes
setInterval(() => {
    usedCodes.clear();
}, 1000 * 60 * 10);

// Circuit Breaker for Rate Limiting (Cloudflare Error 1015)
let rateLimitUntil = 0;

// CSRF Token Endpoint (for SPA/Frontend to ensure they have a token)
router.get('/csrf', (req, res) => {
    // If cookie exists, return it (or just status OK since it's in cookie)
    let csrfToken = req.cookies['csrf_token'];
    if (!csrfToken) {
        csrfToken = crypto.randomBytes(32).toString('hex');
        res.cookie('csrf_token', csrfToken, {
            httpOnly: false,
            secure: process.env.NODE_ENV === 'production',
            maxAge: 1000 * 60 * 60 * 24 * 7,
            sameSite: 'Lax'
        });
    }
    res.json({ csrfToken });
});



// Login Route
router.get('/login', (req, res) => {
    if (Date.now() < rateLimitUntil) {
        console.warn('[Circuit Breaker] Blocking request due to active rate limit.');
        return res.redirect('/error.html');
    }

    const state = crypto.randomUUID();
    const isSecure = req.secure || req.headers['x-forwarded-proto'] === 'https';
    const redirectTarget = req.query.redirect || 'dashboard';

    res.cookie('oauth_state', state, {
        httpOnly: true,
        secure: isSecure,
        maxAge: 1000 * 60 * 5, // 5 minutes
        path: '/',
        sameSite: 'Lax'
    });

    res.cookie('redirect_target', redirectTarget, {
        httpOnly: true,
        secure: isSecure,
        maxAge: 1000 * 60 * 5,
        path: '/',
        sameSite: 'Lax'
    });

    const params = new URLSearchParams({
        client_id: DISCORD_CLIENT_ID,
        redirect_uri: REDIRECT_URI,
        response_type: 'code',
        scope: 'identify guilds',
        state: state
    });
    console.log('[OAuth] Login initiated. Redirect URI:', REDIRECT_URI, 'Target:', redirectTarget);
    res.redirect(`https://discord.com/api/oauth2/authorize?${params.toString()}`);
});

// Callback Route
router.get('/callback', async (req, res) => {
    if (Date.now() < rateLimitUntil) {
        console.warn('[Circuit Breaker] Blocking callback due to active rate limit.');
        return res.redirect('/error.html');
    }

    const { code, state } = req.query;
    const storedState = req.cookies['oauth_state'];

    if (!state || !storedState || state !== storedState) {
        console.warn('OAuth State Mismatch');
        return res.redirect('/error.html');
    }
    res.clearCookie('oauth_state');

    if (!code) return res.redirect('/error.html');

    // Check if code has been used recently
    if (usedCodes.has(code)) {
        console.warn('[OAuth] Code replay detected. Blocking request.');
        return res.redirect('/error.html');
    }
    usedCodes.add(code);

    const USER_AGENT = 'DiscordBot (https://github.com/imomusi0228-spec/AkatsukiBot-, 1.0.0)';

    const fetchWithRetry = async (url, options, retries = 3, delay = 2000) => {
        for (let i = 0; i < retries; i++) {
            try {
                return await axios(url, options);
            } catch (err) {
                const isRateLimit = err.response?.status === 429 ||
                    (err.response?.status === 403 && typeof err.response?.data === 'string' && err.response?.data.includes('1015'));
                if (isRateLimit && i < retries - 1) {
                    console.warn(`[OAuth] Rate limit hit. Retrying in ${delay}ms... (Attempt ${i + 1}/${retries})`);
                    await new Promise(resolve => setTimeout(resolve, delay));
                    delay *= 2; // Exponential backoff
                    continue;
                }
                throw err;
            }
        }
    };

    try {
        const tokenResponse = await fetchWithRetry('https://discord.com/api/oauth2/token', {
            method: 'POST',
            data: new URLSearchParams({
                client_id: DISCORD_CLIENT_ID,
                client_secret: DISCORD_CLIENT_SECRET,
                code,
                grant_type: 'authorization_code',
                redirect_uri: REDIRECT_URI,
                scope: 'identify guilds'
            }),
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded',
                'User-Agent': USER_AGENT
            }
        });

        const { access_token } = tokenResponse.data;
        const userResponse = await fetchWithRetry('https://discord.com/api/users/@me', {
            headers: {
                Authorization: `Bearer ${access_token}`,
                'User-Agent': USER_AGENT
            }
        });

        const user = userResponse.data;

        const redirectTarget = req.cookies['redirect_target'] || 'dashboard';
        res.clearCookie('redirect_target');

        // --- Whitelist Check ---
        const allowedIds = (process.env.ADMIN_DISCORD_IDS || '').split(',').map(id => id.trim());
        const isExplicitAdmin = allowedIds.length > 0 && allowedIds.includes(user.id);

        let isDbAllowed = false;
        if (!isExplicitAdmin) {
            const staffCheck = await db.query('SELECT 1 FROM staff_permissions WHERE user_id = $1', [user.id]);
            isDbAllowed = staffCheck.rows.length > 0;
        }

        const isStaff = isExplicitAdmin || isDbAllowed;

        // If target is dashboard, check permissions. If portal, allow everyone (license check happens in portal.js)
        if (redirectTarget === 'dashboard' && !isStaff) {
            console.warn(`[OAuth] Access denied for user ID: ${user.id} (${user.username}). Not in staff list.`);
            return res.status(403).send('<h1>403 Forbidden</h1><p>You are not authorized to access the staff dashboard.</p><a href="/">Return to Home</a>');
        }
        // -----------------------

        const sessionId = crypto.randomUUID();
        const expiry = new Date(Date.now() + 1000 * 60 * 60 * 24 * 7); // 7 days

        await db.query(
            'INSERT INTO user_sessions (session_id, user_id, username, avatar, discriminator, expiry) VALUES ($1, $2, $3, $4, $5, $6)',
            [sessionId, user.id, user.username, user.avatar, user.discriminator, expiry]
        );

        const isProduction = process.env.NODE_ENV === 'production';
        const isSecure = (isProduction && (req.secure || req.headers['x-forwarded-proto'] === 'https' || PUBLIC_URL.startsWith('https')));

        console.log(`[OAuth] Setting cookies for user ${user.id}. isSecure: ${isSecure} (FORCED)`);

        res.cookie('session_id', sessionId, {
            httpOnly: true,
            secure: isSecure,
            maxAge: 1000 * 60 * 60 * 24 * 7,
            path: '/',
            sameSite: 'Lax'
        });

        const csrfToken = crypto.randomBytes(32).toString('hex');
        res.cookie('csrf_token', csrfToken, {
            httpOnly: false,
            secure: isSecure,
            maxAge: 1000 * 60 * 60 * 24 * 7,
            path: '/',
            sameSite: 'Lax'
        });

        console.log(`[OAuth] Successful login for user ${user.id}. Session set in DB and cookies. Target: ${redirectTarget}`);
        if (redirectTarget === 'portal') {
            res.redirect('/portal.html');
        } else {
            res.redirect('/');
        }

    } catch (error) {
        const status = error.response?.status;
        const data = error.response?.data;
        const message = error.message || '';

        console.error('OAuth Error:', data || message);

        // Check for Cloudflare Rate Limit (Status 403/429 with HTML body often containing "1015" or "Cloudflare")
        // Or if the error message itself mentions 1015
        if (
            status === 429 ||
            (status === 403 && typeof data === 'string' && (data.includes('1015') || data.includes('Cloudflare'))) ||
            message.includes('1015')
        ) {
            console.error('!!! RATE LIMIT DETECTED !!! Triggering Circuit Breaker for 30 minutes.');
            rateLimitUntil = Date.now() + (30 * 60 * 1000); // 30 minutes cooldown
        }

        // Do not return 500 JSON, redirect to error page to prevent reload loops
        res.redirect('/error.html');
    }
});

// Status Route
router.get('/status', async (req, res) => {
    const sessionId = req.cookies['session_id'];
    const hasCookies = Object.keys(req.cookies || {}).length > 0;

    if (sessionId) {
        try {
            const result = await db.query('SELECT * FROM user_sessions WHERE session_id = $1', [sessionId]);
            console.log(`[Status] Session ${sessionId} found: ${result.rows.length > 0}`);
            if (result.rows.length > 0) {
                const session = result.rows[0];
                const now = new Date();
                const expiry = new Date(session.expiry);
                console.log(`[Status] User: ${session.user_id}, Expiry: ${expiry.toISOString()}, Now: ${now.toISOString()}`);
                if (expiry > now) {
                    // Determine Role
                    const allowedIds = (process.env.ADMIN_DISCORD_IDS || '').split(',').map(id => id.trim());
                    const isExplicitAdmin = allowedIds.includes(session.user_id);
                    const staffRes = await db.query('SELECT role FROM staff_permissions WHERE user_id = $1', [session.user_id]);
                    const staffRole = staffRes.rows.length > 0 ? staffRes.rows[0].role : null;

                    // Get user's subscription tier
                    const subRes = await db.query('SELECT tier, is_active FROM subscriptions WHERE user_id = $1', [session.user_id]);
                    const userTier = subRes.rows.length > 0 ? subRes.rows[0].tier : 'Free';
                    const isActive = subRes.rows.length > 0 ? subRes.rows[0].is_active : false;

                    const role = staffRole || (isExplicitAdmin ? 'admin' : 'user');

                    // Normalized Auth Check
                    if (!isExplicitAdmin && !staffRole && (userTier === 'Free' || userTier === '0' || !isActive)) {
                        console.warn(`[Status] User ${session.user_id} NOT AUTHORIZED (Tier: ${userTier}, Active: ${isActive})`);
                        return res.json({ authenticated: false, error: 'unauthorized' });
                    }

                    console.log(`[Status Success] User: ${session.user_id}, Role: ${role}`);
                    return res.json({
                        authenticated: true,
                        user: {
                            id: session.user_id,
                            username: session.username,
                            avatar: session.avatar,
                            role: role
                        }
                    });
                } else {
                    console.warn(`[Auth Status] Session ${sessionId} found but EXPIRED.`);
                }
            } else {
                console.warn(`[Auth Status] Session ${sessionId} NOT found in database.`);
            }
        } catch (err) {
            console.error('[Auth Status] Database error:', err);
        }
    } else {
        console.warn(`[Auth Status] session_id cookie missing. Browser cookies: ${JSON.stringify(req.cookies)}`);
    }
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    res.json({ authenticated: false });
});

// Logout Route
router.post('/logout', async (req, res) => {
    const sessionId = req.cookies['session_id'];
    if (sessionId) {
        try {
            await db.query('DELETE FROM user_sessions WHERE session_id = $1', [sessionId]);
        } catch (err) {
            console.error('Logout error:', err);
        }
        res.clearCookie('session_id');
    }
    res.json({ success: true });
});

const { authMiddleware } = require('./middleware');
module.exports = router;
module.exports.authMiddleware = authMiddleware;
