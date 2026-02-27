const { Client } = require('discord.js');
const db = require('./db');

const SUPPORT_GUILD_ID = process.env.SUPPORT_GUILD_ID;
const ENV_ROLES = {
    'ProMonthly': (process.env.ROLE_PRO_MONTHLY || '').trim(),
    'ProYearly': (process.env.ROLE_PRO_YEARLY || '').trim(),
    'ProPlusMonthly': (process.env.ROLE_PRO_PLUS_MONTHLY || '').trim(),
    'ProPlusYearly': (process.env.ROLE_PRO_PLUS_YEARLY || '').trim()
};

async function getDynamicRoles() {
    try {
        const res = await db.query('SELECT tier, role_id FROM tier_role_mappings');
        if (res.rows.length === 0) return ENV_ROLES;

        const mappings = {};
        res.rows.forEach(row => {
            mappings[row.tier] = row.role_id;
        });
        return { ...ENV_ROLES, ...mappings };
    } catch (e) {
        console.error('[Sync] Failed to fetch dynamic roles:', e.message);
        return ENV_ROLES;
    }
}

/**
 * Updates member roles based on the given tier.
 * @param {import('discord.js').Guild} guild 
 * @param {string} userId 
 * @param {string} tier 
 */
async function updateMemberRoles(guild, userId, tier) {
    try {
        const member = await guild.members.fetch(userId).catch(() => null);
        if (!member) {
            console.warn(`User ${userId} not found in guild ${guild.id}.`);
            return false;
        }

        const ROLES = await getDynamicRoles();
        const rolesToRemove = [
            ROLES['ProMonthly'], ROLES['ProYearly'],
            ROLES['ProPlusMonthly'], ROLES['ProPlusYearly'],
            ROLES['Pro'], ROLES['Pro+']
        ].filter(id => id); // Remove empty/null strings

        let rolesToAdd = [];
        if (tier === 'ULTIMATE' || tier === 'Pro+' || tier === 'Trial Pro+') {
            // Favor Yearly/Specific from DB if both might exist
            rolesToAdd = [ROLES['Pro+'], ROLES['ProPlusMonthly'], ROLES['ProPlusYearly']].filter(id => id);
        } else if (tier === 'Pro' || tier === 'Trial Pro') {
            rolesToAdd = [ROLES['Pro'], ROLES['ProMonthly'], ROLES['ProYearly']].filter(id => id);
        }

        // To be safe, we only add the roles the user *actually* should have based on current roles if we wanted to be precise,
        // but typically we just add what corresponds to the tier.
        // Actually, if we are sync-ing TIERS, we should probably know WHICH exact role they have.
        // But for updateMemberRoles(web), let's just make sure they have at least one of the tier roles.

        await member.roles.remove(rolesToRemove);
        if (rolesToAdd.length > 0) {
            // Add the first valid role for that tier
            await member.roles.add(rolesToAdd[0]);
        }

        console.log(`Updated roles for ${member.user.tag} to ${tier}`);
        return true;
    } catch (err) {
        console.error(`Failed to update roles for ${userId}:`, err);
        return false;
    }
}

/**
 * Syncs subscriptions based on roles in the support server.
 * @param {Client} client 
 * @param {string} [targetUserId] - Optional user ID to sync only one member
 */
async function syncSubscriptions(client, targetUserId = null) {
    if (targetUserId) {
        console.log(`Starting individual subscription sync for user ${targetUserId}...`);
    } else {
        console.log('Starting global subscription sync...');
    }
    const ROLES = await getDynamicRoles();

    const guild = await client.guilds.fetch(SUPPORT_GUILD_ID).catch(console.error);
    if (!guild) {
        console.error(`Support guild ${SUPPORT_GUILD_ID} not found.`);
        return { success: false, message: 'Support guild not found.' };
    }

    // Fetch members with relevant roles only to stay lightweight
    let members;
    try {
        const roleIds = Object.values(ROLES).filter(id => id);
        if (targetUserId) {
            // Individual sync: only fetch and check the target user
            const member = await guild.members.fetch({ user: targetUserId, force: true }).catch(() => null);
            members = new Map();
            if (member && roleIds.some(rId => member.roles.cache.has(rId))) {
                members.set(member.id, member);
            }
        } else {
            // Global sync: fetch only users who have at least one subscription role
            // guild.members.fetch() with no options fetches all. Instead, we use query if possible or filter results.
            // Discord API doesn't allow multi-role filter in fetch easily, so we fetch all but use a lighter method if possible.
            // However, to be safe and thorough, we'll keep the filter but ensure we don't 'force: true' unless necessary.
            members = await guild.members.fetch({ withPresences: false });
            members = members.filter(m => roleIds.some(rId => m.roles.cache.has(rId)));
        }
        console.log(`Fetched ${members.size} subscribed members for sync.`);
    } catch (fetchError) {
        console.error('Failed to fetch members for sync:', fetchError);
        return { success: false, message: 'Failed to fetch members.', error: fetchError };
    }

    let updatedCount = 0;
    let errors = [];

    for (const [memberId, member] of members) {
        let tier = 'Free';
        if (member.roles.cache.has(ROLES['Pro+']) || member.roles.cache.has(ROLES['ProPlusYearly']) || member.roles.cache.has(ROLES['ProPlusMonthly'])) {
            tier = 'Pro+';
        } else if (member.roles.cache.has(ROLES['Pro']) || member.roles.cache.has(ROLES['ProYearly']) || member.roles.cache.has(ROLES['ProMonthly'])) {
            tier = 'Pro';
        }

        if (tier !== 'Free') {
            try {
                const res = await db.query('SELECT guild_id, tier, is_active, cached_username FROM subscriptions WHERE user_id = $1', [memberId]);

                if (res.rows.length > 0) {
                    const userName = member.user.globalName || member.user.username;
                    for (const row of res.rows) {
                        const currentTier = String(row.tier || '');
                        // Don't downgrade Trial or ULTIMATE
                        const isMatch = (currentTier === tier) || (currentTier === `Trial ${tier}`) || (currentTier === 'ULTIMATE') ||
                            (tier === 'Pro' && (currentTier === '1' || currentTier === '2')) ||
                            (tier === 'Pro+' && (currentTier === '3' || currentTier === '4'));

                        const needsNameUpdate = row.cached_username !== userName;

                        if (!isMatch || !row.is_active || needsNameUpdate) {
                            try {
                                const sId = row.guild_id;

                                await db.query(
                                    `UPDATE subscriptions SET 
                                    tier = $1,
                                    is_active = TRUE,
                                    cached_username = $2 
                                 WHERE guild_id = $3`,
                                    [tier, userName, sId]
                                ).catch((err) => {
                                    console.error(`[Sync] Update failed for ${sId}:`, err.message);
                                });
                                console.log(`[Sync] Updated ${userName} (${sId}): Tier ${currentTier} -> ${tier}${needsNameUpdate ? ' (Name Updated)' : ''}`);
                                updatedCount++;
                            } catch (err) {
                                console.error(`[Sync] Failed to update row for user ${member.id}:`, err.message);
                            }
                        }
                    }
                }
            } catch (err) {
                console.error(`[Sync] Error syncing user ${memberId}:`, err);
                errors.push(`Error syncing ${member.user.tag}`);
            }
        } else {
            // [Safety] We NO LONGER automatically deactivate subscriptions if role is not found.
            // This prevents accidental deactivation due to cache issues or bot permission problems.
            // If you want to handle "Unsub" logic, it should be done based on Expiry Date or explicit cancel.
        }
    }

    console.log(`Sync completed. Updated members: ${updatedCount}`);
    return { success: true, updated: updatedCount, errors };
}

module.exports = { syncSubscriptions, updateMemberRoles };

