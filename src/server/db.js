const { Pool } = require('pg');

const DATABASE_URL = process.env.NEON_DATABASE_URL;

if (!DATABASE_URL) {
  console.error('NEON_DATABASE_URL is not set');
}

const pool = new Pool({ connectionString: DATABASE_URL, ssl: { rejectUnauthorized: false } });

async function init() {
  // Create users table if not exists
  const client = await pool.connect();
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS users (
        tgid BIGINT PRIMARY KEY,
        name TEXT,
        scube BIGINT DEFAULT 0,
        gcube BIGINT DEFAULT 0,
        energy INTEGER DEFAULT 50,
        daily_count INTEGER DEFAULT 0,
        last_reset DATE
      );
    `);
  } finally {
    client.release();
  }
}

async function ensureUser(tgid, name) {
  const client = await pool.connect();
  try {
    await client.query(
      `INSERT INTO users (tgid, name, energy, daily_count, last_reset) VALUES ($1,$2,50,0,current_date)
       ON CONFLICT (tgid) DO UPDATE SET name = EXCLUDED.name`,
      [tgid, name]
    );
  } finally {
    client.release();
  }
}

async function getOrCreateUser(tgid) {
  const client = await pool.connect();
  try {
    const res = await client.query('SELECT * FROM users WHERE tgid = $1', [tgid]);
    if (res.rows.length) {
      const user = res.rows[0];
      // Reset daily_count and energy if last_reset is not today
      const today = new Date().toISOString().slice(0,10);
      if (!user.last_reset || user.last_reset.toISOString().slice(0,10) !== today) {
        await client.query('UPDATE users SET daily_count = 0, last_reset = current_date WHERE tgid = $1', [tgid]);
        user.daily_count = 0;
      }
      return mapUser(user);
    } else {
      await client.query('INSERT INTO users (tgid, name, energy, daily_count, last_reset) VALUES ($1,$2,50,0,current_date)', [tgid, `Player ${tgid}`]);
      return await getOrCreateUser(tgid);
    }
  } finally {
    client.release();
  }
}

function mapUser(row) {
  return {
    tgid: row.tgid,
    name: row.name,
    scube: Number(row.scube),
    gcube: Number(row.gcube),
    energy: Number(row.energy),
    daily_count: Number(row.daily_count),
    last_reset: row.last_reset
  };
}

const DAILY_LIMIT = 250;

async function handleClick(tgid) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const res = await client.query('SELECT scube, energy, daily_count, last_reset FROM users WHERE tgid = $1 FOR UPDATE', [tgid]);
    if (!res.rows.length) {
      await client.query('ROLLBACK');
      throw new Error('User not found');
    }
    const user = res.rows[0];
    const today = new Date().toISOString().slice(0,10);
    let energy = user.energy;
    let daily_count = user.daily_count;
    if (!user.last_reset || user.last_reset.toISOString().slice(0,10) !== today) {
      daily_count = 0;
    }
    if (energy <= 0) {
      await client.query('COMMIT');
      return { ok: false, message: 'Нет энергии' };
    }
    if (daily_count >= DAILY_LIMIT) {
      await client.query('COMMIT');
      return { ok: false, message: 'Достигнут дневной лимит' };
    }

    const newScube = Number(user.scube) + 1;
    const newEnergy = energy - 1;
    const newDaily = daily_count + 1;

    await client.query('UPDATE users SET scube = $1, energy = $2, daily_count = $3, last_reset = current_date WHERE tgid = $4', [newScube, newEnergy, newDaily, tgid]);
    await client.query('COMMIT');
    return { ok: true, scube: newScube, energy: newEnergy, daily_count: newDaily };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

module.exports = { init, ensureUser, getOrCreateUser, handleClick };
