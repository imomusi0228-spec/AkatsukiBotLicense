// filename: src/services/roleService.js
const { PLAN_ROLE_MAP } = require('../constants/roles');
const { PLANS } = require('../constants/plans');
const logger = require('../utils/logger');

/**
 * ユーザーにプランに応じたロールを付与し、下位プランのロールを剥がす
 */
const assignPlanRole = async (member, planType) => {
    if (!member) return;
    
    const targetRoleId = PLAN_ROLE_MAP[planType];
    if (!targetRoleId) {
        logger.warn('[RoleService] No role ID defined for plan:', planType);
        return;
    }

    try {
        const targetPlan = PLANS[planType];
        
        // 付与・剥奪のための全プランロールID
        const allPlanRoleIds = Object.values(PLAN_ROLE_MAP).filter(id => id);
        
        // 現在持っている他のプランロールを特定
        const rolesToRemove = allPlanRoleIds.filter(id => 
            id !== targetRoleId && member.roles.cache.has(id)
        );

        // ロールの追加
        if (!member.roles.cache.has(targetRoleId)) {
            await member.roles.add(targetRoleId, `License activated: ${planType}`);
            logger.info('[RoleService] Role added:', { userId: member.id, roleId: targetRoleId });
        }

        // 下位（または他）のロールを剥がす（オプション：仕様に応じて）
        // 仕様書では「必要に応じて剥がす」「最上位プランだけ残す」を推奨
        for (const roleId of rolesToRemove) {
            await member.roles.remove(roleId, `Higher plan activated or cleanup`);
            logger.info('[RoleService] Legacy role removed:', { userId: member.id, roleId });
        }

    } catch (err) {
        // 権限不足などのエラーをキャッチするが、プロセスは止めない
        logger.error('[RoleService] Failed to update roles:', { 
            userId: member.id, 
            error: err.message 
        });
        // ユーザーへの案内が必要な場合は、呼び出し元で処理する
    }
};

module.exports = {
    assignPlanRole
};
