const { Pool } = require('pg');

const connectionString = process.env.NEON_DATABASE_URL;
if (!connectionString) {
  console.error('NEON_DATABASE_URL is required');
}

const pool = new Pool({
  connectionString,
  ssl: { rejectUnauthorized: false },
  max: 5,
  idleTimeoutMillis: 30000,
});

async function query(text, params) {
  const client = await pool.connect();
  try {
    return await client.query(text, params);
  } finally {
    client.release();
  }
}

async function initSchema() {
  await query(`
    create table if not exists users (
      id bigint primary key,
      first_name text,
      last_name text,
      username text,
      photo_url text,
      scube integer not null default 0,
      gcube integer not null default 0,
      energy integer not null default 50,
      energy_capacity integer not null default 50,
      daily_limit integer not null default 250,
      daily_used integer not null default 0,
      last_energy_at timestamptz not null default now(),
      last_daily_reset date not null default current_date,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now()
    );

    alter table users add column if not exists last_reward_at timestamptz;

    create or replace function set_updated_at()
    returns trigger as $$
    begin
      new.updated_at = now();
      return new;
    end;
    $$ language plpgsql;

    drop trigger if exists trg_set_updated_at on users;
    create trigger trg_set_updated_at
    before update on users
    for each row execute function set_updated_at();
  `);
}

module.exports = { query, initSchema };
