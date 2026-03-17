// filename: src/constants/roles.js
const { 
    ROLE_FREE_ID, 
    ROLE_PRO_ID, 
    ROLE_PROPLUS_ID, 
    ROLE_ULTIMATE_ID 
} = require('../config/env');
const { PLANS } = require('./plans');

/**
 * プランIDと環境変数上のロールIDを紐付けます。
 */
const PLAN_ROLE_MAP = {
    [PLANS.FREE.id]: ROLE_FREE_ID,
    [PLANS.PRO.id]: ROLE_PRO_ID,
    [PLANS.PRO_PLUS.id]: ROLE_PROPLUS_ID,
    [PLANS.ULTIMATE.id]: ROLE_ULTIMATE_ID,
};

module.exports = {
    PLAN_ROLE_MAP
};
