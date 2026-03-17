// filename: src/utils/date.js
const dayjs = require('dayjs');

/**
 * 有効期限の表示用フォーマット
 * @param {Date|string|null} date 
 * @returns {string}
 */
const formatExpiry = (date) => {
    if (!date) return '無期限';
    return dayjs(date).format('YYYY-MM-DD');
};

/**
 * 期限切れチェック
 * @param {Date|string|null} date 
 * @returns {boolean} true=期限切れ
 */
const isExpired = (date) => {
    if (!date) return false; // 永久ライセンス
    return dayjs().isAfter(dayjs(date));
};

module.exports = {
    formatExpiry,
    isExpired
};
