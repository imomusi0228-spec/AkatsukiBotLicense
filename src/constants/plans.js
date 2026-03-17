// filename: src/constants/plans.js

/**
 * ライセンスプランの定数定義
 * 商品名からの判定ルールや、プランごとの権限・期間を管理します。
 */
const PLANS = {
    FREE: {
        id: 'FREE',
        displayName: "FREE",
        maxServers: 1,
        durationDays: 30,
        roleEnvKey: "ROLE_FREE_ID",
        priority: 1
    },
    PRO: {
        id: 'PRO',
        displayName: "PRO",
        maxServers: 1,
        durationDays: 30,
        roleEnvKey: "ROLE_PRO_ID",
        priority: 2
    },
    PRO_PLUS: {
        id: 'PRO_PLUS',
        displayName: "PRO_PLUS",
        maxServers: 3,
        durationDays: 30,
        roleEnvKey: "ROLE_PROPLUS_ID",
        priority: 3
    },
    ULTIMATE: {
        id: 'ULTIMATE',
        displayName: "ULTIMATEプラン (永久)",
        maxServers: -1, // 無制限
        durationDays: null, // 無期限
        roleEnvKey: "ROLE_ULTIMATE_ID",
        priority: 4
    }
};

/**
 * 商品名からプランを特定するためのキーワードルール
 * 優先順位が高い順（文字列が長い/具体的なもの順）に並べています。
 */
const PRODUCT_MATCH_RULES = [
    { pattern: /Ultimate/i, planType: PLANS.ULTIMATE.id },
    { pattern: /Pro\+/i, planType: PLANS.PRO_PLUS.id },
    { pattern: /PRO\+/i, planType: PLANS.PRO_PLUS.id },
    { pattern: /Pro/i, planType: PLANS.PRO.id },
    { pattern: /Free/i, planType: PLANS.FREE.id }
];

module.exports = {
    PLANS,
    PRODUCT_MATCH_RULES
};
