// filename: src/config/env.js
require('dotenv').config();

const requiredEnvVars = [
    'DISCORD_TOKEN',
    'CLIENT_ID',
    'GUILD_ID',
    'DATABASE_URL',
    'GMAIL_USER',
    'GMAIL_APP_PASSWORD'
];

// 必須環境変数のチェック
for (const envVar of requiredEnvVars) {
    if (!process.env[envVar]) {
        console.error(`[Config] CRITICAL ERROR: Missing required environment variable: ${envVar}`);
        process.exit(1);
    }
}

module.exports = {
    // Discord
    DISCORD_TOKEN: process.env.DISCORD_TOKEN,
    CLIENT_ID: process.env.CLIENT_ID,
    GUILD_ID: process.env.GUILD_ID,
    
    // Database
    DATABASE_URL: process.env.DATABASE_URL,
    
    // Gmail / IMAP
    GMAIL_USER: process.env.GMAIL_USER,
    GMAIL_APP_PASSWORD: process.env.GMAIL_APP_PASSWORD,
    IMAP_HOST: process.env.IMAP_HOST || 'imap.gmail.com',
    IMAP_PORT: parseInt(process.env.IMAP_PORT || '993'),
    MAIL_POLL_CRON: process.env.MAIL_POLL_CRON || '*/1 * * * *',
    
    // Security & API
    LICENSE_SECRET: process.env.LICENSE_SECRET || 'default-secret-change-me',
    API_PORT: parseInt(process.env.API_PORT || '3000'),
    NODE_ENV: process.env.NODE_ENV || 'development',
    
    // Roles
    ROLE_FREE_ID: process.env.ROLE_FREE_ID,
    ROLE_PRO_ID: process.env.ROLE_PRO_ID,
    ROLE_PROPLUS_ID: process.env.ROLE_PROPLUS_ID,
    ROLE_ULTIMATE_ID: process.env.ROLE_ULTIMATE_ID,
    
    // Auth / Admins
    ADMIN_DISCORD_IDS: (process.env.ADMIN_DISCORD_IDS || '')
        .split(',')
        .map(id => id.trim())
        .filter(id => id),
        
    // Settings
    ALLOW_DUPLICATE_BUYER_EMAILS: process.env.ALLOW_DUPLICATE_BUYER_EMAILS === 'true',
    MAX_LICENSE_GENERATION_RETRIES: parseInt(process.env.MAX_LICENSE_GENERATION_RETRIES || '10')
};
