// filename: src/utils/boothParser.js
const { ORDER_NUMBER, PRODUCT_NAME, BUYER_EMAIL, BOOTH_IDENTIFIERS } = require('../constants/mailPatterns');
const { PRODUCT_MATCH_RULES, PLANS } = require('../constants/plans');
const { normalizeOrderNumber, normalizeEmail } = require('./normalize');
const logger = require('./logger');

/**
 * テキストから正規表現パターンを用いて情報を抽出する
 */
const extractByPattern = (text, patterns) => {
    for (const pattern of patterns) {
        const match = text.match(pattern);
        if (match && match[1]) {
            return match[1].trim();
        }
    }
    return null;
};

/**
 * 商品名からプランを判定する
 */
const detectPlanType = (productName) => {
    if (!productName) return PLANS.FREE.id;
    for (const rule of PRODUCT_MATCH_RULES) {
        if (rule.pattern.test(productName)) {
            return rule.planType;
        }
    }
    return PLANS.FREE.id; // デフォルトはFREE
};

/**
 * BOOTHメールを解析し、構造化データを返す
 */
const parseBoothMail = ({ subject, text, from, messageId, date }) => {
    // BOOTHメールかどうかの初期判定
    const isBooth = BOOTH_IDENTIFIERS.some(id => 
        subject.includes(id) || text.includes(id) || (from && from.includes(id))
    );

    if (!isBooth) {
        return { isBoothMail: false };
    }

    const orderNumberRaw = extractByPattern(text, ORDER_NUMBER);
    const productNameRaw = extractByPattern(text, PRODUCT_NAME);
    const buyerEmailRaw = extractByPattern(text, BUYER_EMAIL);
    const buyerNameRaw = extractByPattern(text, require('../constants/mailPatterns').BUYER_NAME);
    const giftRecipientRaw = extractByPattern(text, require('../constants/mailPatterns').GIFT_RECIPIENT);

    const orderNumber = normalizeOrderNumber(orderNumberRaw);
    const buyerEmail = normalizeEmail(buyerEmailRaw);
    const planType = detectPlanType(productNameRaw);

    if (!orderNumber || !productNameRaw) {
        logger.warn('[Parser] Failed to extract core info from BOOTH mail:', {
            orderNumber,
            productName: productNameRaw,
            subject,
            messageId
        });
    }

    return {
        isBoothMail: true,
        orderNumber,
        productName: productNameRaw,
        buyerName: buyerNameRaw,
        giftRecipient: giftRecipientRaw,
        buyerEmail,
        planType,
        raw: {
            subject,
            text,
            from,
            messageId,
            date
        }
    };
};

module.exports = {
    parseBoothMail,
    detectPlanType
};
