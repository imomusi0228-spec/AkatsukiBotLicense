// filename: src/index.js
const { client, loadCommands } = require('./bot/client');
const { startApiServer } = require('./api/server');
const { startMailPolling } = require('./services/mailService');
const { DISCORD_TOKEN } = require('./config/env');
const logger = require('./utils/logger');

/**
 * システムの起動
 */
async function bootstrap() {
    logger.info('=== Akatsuki License System Bootstrap Start ===');

    try {
        // 1. Botコマンドの読み込みとログイン
        loadCommands();
        await client.login(DISCORD_TOKEN);
        logger.info('[Bot] Discord Bot status: ONLINE');

        // 2. APIサーバーの起動
        await startApiServer();
        logger.info('[API] API Server status: ONLINE');

        // 3. メール監視の開始
        startMailPolling();
        logger.info('[Mail] Mail Polling status: ACTIVE');

        logger.info('=== Akatsuki License System Bootstrap Complete ===');

    } catch (err) {
        logger.error('[Main] CRITICAL ERROR during bootstrap:', err);
        process.exit(1);
    }
}

// 未処理の例外・拒否のハンドル
process.on('unhandledRejection', (reason, promise) => {
    logger.error('[Main] Unhandled Rejection at:', { promise, reason });
});

process.on('uncaughtException', (err) => {
    logger.error('[Main] Uncaught Exception thrown:', err);
    // 致命的な場合は再起動等を検討
});

// 起動実行
bootstrap();
