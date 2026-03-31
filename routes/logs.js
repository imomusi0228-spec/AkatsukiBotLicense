const express = require('express');
const router = express.Router();
const db = require('../db');
const { authMiddleware } = require('./middleware');

// Get paginated and searchable logs
router.get('/', authMiddleware, async (req, res) => {
    let { limit = 50, page = 1, search = '', action_type = '', operator_id = '', start_date = '', end_date = '' } = req.query;
    limit = parseInt(limit);
    const offset = (parseInt(page) - 1) * limit;

    try {
        let queryText = 'SELECT * FROM operation_logs';
        let params = [];
        let whereClause = [];

        // Tier-based retention limiting
        // Skip check if it's Admin (via Authorization header check in middleware usually sets req.user to null but passes)
        // If req.user exists, apply tier limits
        if (req.user) {
            const tier = req.user.tier;
            if (tier === 'Pro' || tier === '1') {
                whereClause.push("created_at >= NOW() - INTERVAL '7 days'");
            } else if (tier === 'Pro+' || tier === '3') {
                whereClause.push("created_at >= NOW() - INTERVAL '30 days'");
            }
            // Pro+ above or specific admin allowed to see all/more would go here
        }

        if (search) {
            params.push(`%${search}%`);
            whereClause.push(`(target_id ILIKE $${params.length} OR target_name ILIKE $${params.length} OR details ILIKE $${params.length} OR operator_name ILIKE $${params.length} OR ip_address ILIKE $${params.length})`);
        }
        if (action_type) {
            params.push(action_type);
            whereClause.push(`action_type = $${params.length}`);
        }
        if (operator_id) {
            params.push(operator_id);
            whereClause.push(`operator_id = $${params.length}`);
        }
        if (start_date) {
            params.push(start_date);
            whereClause.push(`created_at >= $${params.length}`);
        }
        if (end_date) {
            params.push(end_date);
            whereClause.push(`created_at <= $${params.length}`);
        }

        if (whereClause.length > 0) {
            queryText += ' WHERE ' + whereClause.join(' AND ');
        }

        // Count total for pagination
        const countRes = await db.query(queryText.replace('SELECT *', 'SELECT COUNT(*)'), params);
        const totalCount = parseInt(countRes.rows[0].count);

        queryText += ` ORDER BY created_at DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`;
        params.push(limit, offset);

        const result = await db.query(queryText, params);

        res.json({
            logs: result.rows,
            pagination: {
                total: totalCount,
                page: parseInt(page),
                limit: limit,
                pages: Math.ceil(totalCount / limit)
            }
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

module.exports = router;
