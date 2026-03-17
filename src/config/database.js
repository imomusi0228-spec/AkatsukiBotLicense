// filename: src/config/database.js
const { Pool } = require('pg');
const { DATABASE_URL, NODE_ENV } = require('./env');

const pool = new Pool({
    connectionString: DATABASE_URL,
    ssl: NODE_ENV === 'production' ? { rejectUnauthorized: false } : { rejectUnauthorized: false }, // VPS環境等に合わせて調整
    max: 20,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 5000,
});

/**
 * DBクエリ実行のラップ関数
 * @param {string} text SQL
 * @param {Array} params パラメータ
 * @returns {Promise<Object>} 結果オブジェクト
 */
const query = async (text, params) => {
    const start = Date.now();
    try {
        const res = await pool.query(text, params);
        const duration = Date.now() - start;
        // console.log('[DB] Executed query:', { text, duration, rows: res.rowCount });
        return res;
    } catch (err) {
        console.error('[DB] Query Error:', { text, error: err.message });
        throw err;
    }
};

/**
 * トランザクション実行のヘルパー
 * @param {Function} callback (client) => Promise<any>
 */
const transaction = async (callback) => {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const result = await callback(client);
        await client.query('COMMIT');
        return result;
    } catch (err) {
        await client.query('ROLLBACK');
        throw err;
    } finally {
        client.release();
    }
};

module.exports = {
    query,
    transaction,
    pool
};
