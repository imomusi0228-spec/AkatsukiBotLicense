// filename: src/utils/logger.js
const { createLogger, format, transports } = require('winston');
const { NODE_ENV } = require('../config/env');
require('winston-daily-rotate-file');

// ログの整形フォーマット
const logFormat = format.combine(
    format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
    format.errors({ stack: true }),
    format.splat(),
    format.json()
);

const logger = createLogger({
    level: NODE_ENV === 'production' ? 'info' : 'debug',
    format: logFormat,
    defaultMeta: { service: 'akatsuki-license-system' },
    transports: [
        // エラーログ用ファイル（日付ローテーション）
        new transports.DailyRotateFile({
            filename: 'logs/error-%DATE%.log',
            datePattern: 'YYYY-MM-DD',
            level: 'error',
            maxFiles: '14d'
        }),
        // 全ログ用ファイル（日付ローテーション）
        new transports.DailyRotateFile({
            filename: 'logs/combined-%DATE%.log',
            datePattern: 'YYYY-MM-DD',
            maxFiles: '14d'
        })
    ]
});

// 開発環境の場合はコンソールにも出力（色付き）
if (NODE_ENV !== 'production') {
    logger.add(new transports.Console({
        format: format.combine(
            format.colorize(),
            format.simple(),
            format.printf(({ level, message, timestamp, stack }) => {
                return `${timestamp} ${level}: ${stack || message}`;
            })
        )
    }));
}

module.exports = logger;
