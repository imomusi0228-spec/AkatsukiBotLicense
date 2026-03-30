const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: {
    rejectUnauthorized: false
  },
  max: 20, // Increased max connections
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 10000, // Increased from 2000 to 10000ms
});

async function initDB() {
  let client;
  let retries = 5;
  let delay = 3000;

  while (retries > 0) {
    try {
      client = await pool.connect();
      break; // Success
    } catch (err) {
      retries--;
      if (retries === 0) {
        console.error('[DB] Final connection attempt failed. No retries left.');
        throw err;
      }
      console.warn(`[DB] Connection failed. Retrying in ${delay / 1000}s... (${retries} retries left)`);
      await new Promise(resolve => setTimeout(resolve, delay));
      delay *= 1.5; // Exponential backoff
    }
  }

  try {
    // 4. Performance: Indexes (Optimized for 10k+ guilds)
    const indexes = [
      'idx_subscriptions_user_id ON subscriptions(user_id)',
      'idx_subscriptions_is_active ON subscriptions(is_active)',
      'idx_subscriptions_expiry_date ON subscriptions(expiry_date)',
      'idx_subscriptions_created_at ON subscriptions(created_at)',
      'idx_applications_status ON applications(status)',
      'idx_applications_user_id ON applications(author_id)',
      'idx_applications_created_at ON applications(created_at DESC)',
      'idx_operation_logs_created_at ON operation_logs(created_at DESC)',
      'idx_operation_logs_action ON operation_logs(action_type)'
    ];
    for (const idx of indexes) {
      await client.query(`CREATE INDEX IF NOT EXISTS ${idx}`);
    }

    // 5. ULTIMATE Synchronization (Ensure ALL servers of an ULTIMATE user are upgraded)
    // This implements the "User-based license" requirement where a user's tier affects all their servers.
    const ultimateSyncRes = await client.query(`
      WITH ultimate_users AS (
        SELECT DISTINCT user_id FROM subscriptions WHERE tier = 'ULTIMATE' AND is_active = TRUE
      )
      UPDATE subscriptions 
      SET tier = 'ULTIMATE', expiry_date = NULL, is_active = TRUE 
      WHERE user_id IN (SELECT user_id FROM ultimate_users)
        AND (tier != 'ULTIMATE' OR expiry_date IS NOT NULL OR is_active = FALSE)
      RETURNING guild_id, user_id
    `);
    if (ultimateSyncRes.rows.length > 0) {
      console.log(`[DB] ULTIMATE Sync: Upgraded ${ultimateSyncRes.rows.length} server(s) for ULTIMATE users.`);
    }

    // 6. Data Integrity: Set default expiry for paid tiers with NULL expiry_date
    // ULTIMATE and Free tiers are excluded (they are intentionally unlimited or no expiry needed)
    const fixedExpiryRes = await client.query(`
      UPDATE subscriptions
      SET expiry_date = NOW() + INTERVAL '1 month'
      WHERE expiry_date IS NULL
        AND tier NOT IN ('Free', '0', 'ULTIMATE')
        AND is_active = TRUE
      RETURNING guild_id, tier
    `);
    if (fixedExpiryRes.rows.length > 0) {
      console.log(`[DB] Data Integrity Fix: Set default 1-month expiry for ${fixedExpiryRes.rows.length} paid subscription(s) that had NULL expiry_date.`);
      fixedExpiryRes.rows.forEach(row => console.log(`  -> Guild: ${row.guild_id}, Tier: ${row.tier}`));
    }

    console.log('[DB] Initialization and consolidation complete.');
  } catch (err) {
    console.error('[DB Error]', err);
  } finally {
    client.release();
  }
}

async function query(text, params) {
  return pool.query(text, params);
}

module.exports = {
  query,
  initDB,
  pool
};
