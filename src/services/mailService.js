// filename: src/services/mailService.js
const Imap = require('imap');
const { simpleParser } = require('mailparser');
const cron = require('node-cron');
const { 
    GMAIL_USER, 
    GMAIL_APP_PASSWORD, 
    IMAP_HOST, 
    IMAP_PORT, 
    MAIL_POLL_CRON 
} = require('../config/env');
const { parseBoothMail } = require('../utils/boothParser');
const { createOrderIfNotExists } = require('./orderService');
const logger = require('../utils/logger');

const imapConfig = {
    user: GMAIL_USER,
    password: GMAIL_APP_PASSWORD,
    host: IMAP_HOST,
    port: IMAP_PORT,
    tls: true,
    tlsOptions: { rejectUnauthorized: false }
};

/**
 * 新着メールを取得して処理する
 */
const processMailbox = () => {
    return new Promise((resolve, reject) => {
        const imap = new Imap(imapConfig);

        imap.once('ready', () => {
            imap.openBox('INBOX', false, (err, box) => {
                if (err) {
                    imap.end();
                    return reject(err);
                }

                // 未読メール、または最近のメールを検索
                // ここではシンプルに直近10件をチェック（短縮ポーリング前提）
                imap.search(['UNSEEN', ['SINCE', new Date()]], (err, results) => {
                    if (err || !results || results.length === 0) {
                        imap.end();
                        return resolve(0);
                    }

                    const f = imap.fetch(results, { bodies: '', markSeen: true });
                    let processedCount = 0;

                    f.on('message', (msg, seqno) => {
                        msg.on('body', (stream, info) => {
                            simpleParser(stream, async (err, parsed) => {
                                if (err) {
                                    logger.error('[MailService] Error parsing mail:', err);
                                    return;
                                }

                                try {
                                    const boothData = parseBoothMail({
                                        subject: parsed.subject,
                                        text: parsed.text || parsed.textAsHtml,
                                        from: parsed.from.text,
                                        messageId: parsed.messageId,
                                        date: parsed.date
                                    });

                                    if (boothData.isBoothMail && boothData.orderNumber) {
                                        const newOrder = await createOrderIfNotExists(boothData);
                                        if (newOrder) {
                                            processedCount++;
                                        }
                                    }
                                } catch (e) {
                                    logger.error('[MailService] Error processing BOOTH data:', e);
                                }
                            });
                        });
                    });

                    f.once('error', (err) => {
                        logger.error('[MailService] Fetch error:', err);
                    });

                    f.once('end', () => {
                        imap.end();
                        resolve(processedCount);
                    });
                });
            });
        });

        imap.once('error', (err) => {
            logger.error('[MailService] IMAP error:', err);
            reject(err);
        });

        imap.once('end', () => {
            // logger.debug('[MailService] IMAP connection ended');
        });

        imap.connect();
    });
};

/**
 * 定期監視を開始する
 */
const startMailPolling = () => {
    logger.info('[MailService] Mail polling started with cron:', MAIL_POLL_CRON);
    
    // 即時実行
    processMailbox().catch(err => logger.error('[MailService] Initial poll failed:', err));

    // cronスケジュール
    cron.schedule(MAIL_POLL_CRON, async () => {
        try {
            const count = await processMailbox();
            if (count > 0) {
                logger.info(`[MailService] Processed ${count} new BOOTH order(s)`);
            }
        } catch (err) {
            logger.error('[MailService] Scheduled poll failed:', err);
        }
    });
};

module.exports = {
    processMailbox,
    startMailPolling
};
