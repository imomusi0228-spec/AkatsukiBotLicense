// filename: src/utils/normalize.js

/**
 * 注文番号の正規化
 * - 前後空白削除
 * - 全角英数字を半角へ
 * - 大文字化
 * - 不要な記号やスペースの除去
 * @param {string} value 
 * @returns {string} 
 */
const normalizeOrderNumber = (value) => {
    if (!value) return '';
    return value
        .toString()
        .trim()
        .replace(/[！-～]/g, (s) => String.fromCharCode(s.charCodeAt(0) - 0xFEE0)) // 全角英数 -> 半角
        .replace(/[\s\u3000]/g, '') // 全角・半角スペース除去
        .toUpperCase();
};

/**
 * メールアドレスの正規化
 * - 前後空白削除
 * - 小文字化
 * @param {string} value 
 * @returns {string} 
 */
const normalizeEmail = (value) => {
    if (!value) return '';
    return value
        .toString()
        .trim()
        .toLowerCase();
};

/**
 * マシンID（デバイス識別子）の正規化
 * - 前後空白削除
 * - 小文字化
 * @param {string} value 
 * @returns {string} 
 */
const normalizeMachineId = (value) => {
    if (!value) return '';
    return value
        .toString()
        .trim()
        .toLowerCase();
};

module.exports = {
    normalizeOrderNumber,
    normalizeEmail,
    normalizeMachineId
};
