// filename: src/utils/generator.js
const crypto = require('crypto');

/**
 * ライセンスキーの生成 (AKT-XXXX-XXXX-XXXX)
 * @returns {string} 
 */
const generateLicenseKey = () => {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    const segment = () => {
        let str = '';
        const bytes = crypto.randomBytes(4);
        for (let i = 0; i < 4; i++) {
            str += chars[bytes[i] % chars.length];
        }
        return str;
    };
    return `AKT-${segment()}-${segment()}-${segment()}`;
};

/**
 * 指定した日数を加算した日付を返す
 * @param {Date} date 基点となる日付
 * @param {number} days 加算する日数
 * @returns {Date}
 */
const addDays = (date, days) => {
    const result = new Date(date);
    result.setDate(result.getDate() + days);
    return result;
};

module.exports = {
    generateLicenseKey,
    addDays
};
