const { pool } = require('./pool');

async function init() {
  const client = await pool.connect();
  try {
    // Ensure base table exists
    await client.query(`
      CREATE TABLE IF NOT EXISTS users (
        tgid BIGINT PRIMARY KEY,
        name TEXT,
        scube BIGINT DEFAULT 0,
        gcube BIGINT DEFAULT 0,
        energy INTEGER DEFAULT 50,
        energy_capacity INTEGER DEFAULT 50,
        daily_count INTEGER DEFAULT 0,
        daily_limit_level INTEGER DEFAULT 0,
        last_reset DATE
      );
    `);

    // Add new columns if they don't exist (for migrations)
    await client.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS last_refill DATE`);
    await client.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS auto_energy BOOLEAN DEFAULT false`);
    await client.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS energy_capacity INTEGER DEFAULT 50`);
    await client.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS last_reward_at TIMESTAMPTZ`);
    await client.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS last_reward_ad_at TIMESTAMPTZ`);
    await client.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS login_streak INTEGER DEFAULT 0`);
    await client.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS last_login_reward DATE`);
    await client.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS last_energy_refill_at TIMESTAMPTZ`);
    // Add "stars" currency
    await client.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS stars BIGINT DEFAULT 0`);
    await client.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS vp BIGINT DEFAULT 0`);
    await client.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS tickets BIGINT DEFAULT 0`);
    // For rating system
    await client.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS clicks_total BIGINT DEFAULT 0`);
    await client.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS tasks_completed BIGINT DEFAULT 0`);
    // Complaints counter for SubGram unsubscribes
    await client.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS complaints INTEGER DEFAULT 0`);

    // Helpful indexes
    await client.query(`CREATE INDEX IF NOT EXISTS idx_users_clicks_total ON users (clicks_total)`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_users_tasks_completed ON users (tasks_completed)`);

    await client.query(`CREATE TABLE IF NOT EXISTS reward_events (
      context_id TEXT PRIMARY KEY,
      tgid BIGINT NOT NULL,
      amount BIGINT NOT NULL,
      source TEXT,
      created_at TIMESTAMPTZ DEFAULT now()
    );`);

    // Store SubGram webhook events for auditing and optional processing
    await client.query(`CREATE TABLE IF NOT EXISTS subgram_events (
      webhook_id BIGINT PRIMARY KEY,
      link TEXT,
      user_id BIGINT,
      bot_id BIGINT,
      status TEXT,
      subscribe_date DATE,
      payload JSONB,
      created_at TIMESTAMPTZ DEFAULT now()
    );`);

    await client.query(`
      CREATE TABLE IF NOT EXISTS withdrawals (
        id BIGSERIAL PRIMARY KEY,
        tgid BIGINT NOT NULL,
        method TEXT NOT NULL,
        option_id TEXT NOT NULL,
        payout_label TEXT NOT NULL,
        base_cost BIGINT NOT NULL,
        commission BIGINT NOT NULL,
        total_cost BIGINT NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending',
        details JSONB,
        note TEXT,
        admin_comment TEXT,
        admin_tgid BIGINT,
        admin_username TEXT,
        admin_fullname TEXT,
        success_index BIGINT,
        user_snapshot JSONB,
        created_at TIMESTAMPTZ DEFAULT now(),
        updated_at TIMESTAMPTZ DEFAULT now()
      );
    `);

    await client.query(`CREATE INDEX IF NOT EXISTS idx_withdrawals_status ON withdrawals (status);`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_withdrawals_created_at ON withdrawals (created_at DESC);`);
    await client.query(`CREATE SEQUENCE IF NOT EXISTS withdrawal_success_seq START 1;`);

    // Admin custom tasks
    await client.query(`
      CREATE TABLE IF NOT EXISTS custom_tasks (
        id BIGSERIAL PRIMARY KEY,
        name TEXT NOT NULL,
        type TEXT NOT NULL,
        reward_type TEXT NOT NULL,
        reward_amount BIGINT NOT NULL,
        link TEXT,
        required_count BIGINT,
        created_by BIGINT,
        active BOOLEAN DEFAULT true,
        created_at TIMESTAMPTZ DEFAULT now()
      );
    `);
    // Ensure columns exist for legacy tables before creating index
    await client.query(`ALTER TABLE custom_tasks ADD COLUMN IF NOT EXISTS type TEXT`);
    await client.query(`ALTER TABLE custom_tasks ADD COLUMN IF NOT EXISTS reward_type TEXT`);
    await client.query(`ALTER TABLE custom_tasks ADD COLUMN IF NOT EXISTS reward_amount BIGINT DEFAULT 0`);
    await client.query(`ALTER TABLE custom_tasks ADD COLUMN IF NOT EXISTS link TEXT`);
    await client.query(`ALTER TABLE custom_tasks ADD COLUMN IF NOT EXISTS required_count BIGINT`);
    await client.query(`ALTER TABLE custom_tasks ADD COLUMN IF NOT EXISTS created_by BIGINT`);
    await client.query(`ALTER TABLE custom_tasks ADD COLUMN IF NOT EXISTS active BOOLEAN DEFAULT true`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_custom_tasks_active ON custom_tasks (active)`);

    await client.query(`
      CREATE TABLE IF NOT EXISTS task_completions (
        task_id BIGINT NOT NULL REFERENCES custom_tasks(id) ON DELETE CASCADE,
        tgid BIGINT NOT NULL,
        completed_at TIMESTAMPTZ DEFAULT now(),
        credited_at TIMESTAMPTZ,
        PRIMARY KEY (task_id, tgid)
      );
    `);

    // Referrals: ensure columns exist
    await client.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS referror BIGINT`);
    await client.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS referral_count BIGINT DEFAULT 0`);
    await client.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS referral_earned BIGINT DEFAULT 0`);
    await client.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS referral_bonus BIGINT DEFAULT 0`);
    await client.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS referral_tgid BIGINT`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_users_referror ON users (referror)`);
  } finally {
    client.release();
  }
}

module.exports = { init };
