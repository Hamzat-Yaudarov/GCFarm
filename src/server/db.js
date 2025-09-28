const { Pool } = require('pg');

const DATABASE_URL = process.env.NEON_DATABASE_URL;

if (!DATABASE_URL) {
  console.error('NEON_DATABASE_URL is not set');
}

const pool = new Pool({ connectionString: DATABASE_URL, ssl: { rejectUnauthorized: false } });

async function init() {
  const client = await pool.connect();
  try {
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
  } finally {
    client.release();
  }
}

async function ensureUser(tgid, name) {
  const client = await pool.connect();
  try {
    await client.query(
      `INSERT INTO users (tgid, name, energy, energy_capacity, daily_count, daily_limit_level, last_reset) VALUES ($1,$2,50,50,0,0,current_date)
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
      const today = new Date().toISOString().slice(0,10);
      if (!user.last_reset || user.last_reset.toISOString().slice(0,10) !== today) {
        await client.query('UPDATE users SET daily_count = 0, last_reset = current_date WHERE tgid = $1', [tgid]);
        user.daily_count = 0;
      }
      return mapUser(user);
    } else {
      await client.query('INSERT INTO users (tgid, name, energy, energy_capacity, daily_count, daily_limit_level, last_reset) VALUES ($1,$2,50,50,0,0,current_date)', [tgid, `Player ${tgid}`]);
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
    energy_capacity: Number(row.energy_capacity),
    daily_count: Number(row.daily_count),
    daily_limit_level: Number(row.daily_limit_level),
    last_reset: row.last_reset
  };
}

const DAILY_BASE = 250;
const DAILY_INCREMENT = 50;

async function handleClick(tgid) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const res = await client.query('SELECT scube, energy, daily_count, daily_limit_level FROM users WHERE tgid = $1 FOR UPDATE', [tgid]);
    if (!res.rows.length) {
      await client.query('ROLLBACK');
      throw new Error('User not found');
    }
    const user = res.rows[0];
    let energy = Number(user.energy);
    let daily_count = Number(user.daily_count);
    const daily_limit = DAILY_BASE + Number(user.daily_limit_level) * DAILY_INCREMENT;

    if (energy <= 0) {
      await client.query('COMMIT');
      return { ok: false, message: 'Нет энергии' };
    }
    if (daily_count >= daily_limit) {
      await client.query('COMMIT');
      return { ok: false, message: 'Достигнут дневной лими��' };
    }

    const newScube = Number(user.scube) + 1;
    const newEnergy = energy - 1;
    const newDaily = daily_count + 1;

    await client.query('UPDATE users SET scube = $1, energy = $2, daily_count = $3 WHERE tgid = $4', [newScube, newEnergy, newDaily, tgid]);
    await client.query('COMMIT');
    return { ok: true, scube: newScube, energy: newEnergy, daily_count: newDaily, daily_limit };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

// Exchange: 50 SCube -> 1 GCube, or 1 GCube -> 50 SCube
async function exchange(tgid, direction, units) {
  // units is integer number of GCube or SCube packs depending on direction
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const res = await client.query('SELECT scube, gcube FROM users WHERE tgid = $1 FOR UPDATE', [tgid]);
    if (!res.rows.length) { await client.query('ROLLBACK'); throw new Error('User not found'); }
    const user = res.rows[0];
    let scube = Number(user.scube);
    let gcube = Number(user.gcube);
    if (direction === 'scube_to_gcube') {
      const costPer = 50; // 50 SCube -> 1 GCube
      const totalCost = costPer * units;
      if (scube < totalCost) { await client.query('ROLLBACK'); return { ok:false, message: 'Недостаточно SCube' }; }
      scube -= totalCost;
      gcube += units;
    } else if (direction === 'gcube_to_scube') {
      const gainPer = 50; // 1 GCube -> 50 SCube
      if (gcube < units) { await client.query('ROLLBACK'); return { ok:false, message: 'Недостаточно GCube' }; }
      gcube -= units;
      scube += units * gainPer;
    } else {
      await client.query('ROLLBACK');
      return { ok:false, message: 'Invalid direction' };
    }
    await client.query('UPDATE users SET scube=$1, gcube=$2 WHERE tgid=$3', [scube, gcube, tgid]);
    await client.query('COMMIT');
    return { ok:true, scube, gcube };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

// Buy upgrades
// type: 'energy_capacity' or 'daily_limit'
async function buyUpgrade(tgid, type) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const res = await client.query('SELECT scube, energy_capacity, daily_limit_level FROM users WHERE tgid = $1 FOR UPDATE', [tgid]);
    if (!res.rows.length) { await client.query('ROLLBACK'); throw new Error('User not found'); }
    let { scube, energy_capacity, daily_limit_level } = res.rows[0];
    scube = Number(scube); energy_capacity = Number(energy_capacity); daily_limit_level = Number(daily_limit_level);

    if (type === 'energy_capacity') {
      const cost = 100;
      if (scube < cost) { await client.query('ROLLBACK'); return { ok:false, message: 'Недостаточно SCube' }; }
      scube -= cost;
      energy_capacity += 50;
      await client.query('UPDATE users SET scube=$1, energy_capacity=$2 WHERE tgid=$3', [scube, energy_capacity, tgid]);
      await client.query('COMMIT');
      return { ok:true, scube, energy_capacity };
    } else if (type === 'daily_limit') {
      const cost = 90 + daily_limit_level * 10;
      if (scube < cost) { await client.query('ROLLBACK'); return { ok:false, message: 'Недостаточно SCube' }; }
      scube -= cost;
      daily_limit_level += 1;
      await client.query('UPDATE users SET scube=$1, daily_limit_level=$2 WHERE tgid=$3', [scube, daily_limit_level, tgid]);
      await client.query('COMMIT');
      const new_daily_limit = DAILY_BASE + daily_limit_level * DAILY_INCREMENT;
      return { ok:true, scube, daily_limit_level, new_daily_limit };
    } else {
      await client.query('ROLLBACK');
      return { ok:false, message: 'Invalid upgrade type' };
    }
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

// Reward claim (from AdsGram callback or client)
async function claimReward(tgid, amount) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const res = await client.query('SELECT scube FROM users WHERE tgid = $1 FOR UPDATE', [tgid]);
    if (!res.rows.length) { await client.query('ROLLBACK'); throw new Error('User not found'); }
    let scube = Number(res.rows[0].scube);
    scube += amount;
    await client.query('UPDATE users SET scube=$1 WHERE tgid=$2', [scube, tgid]);
    await client.query('COMMIT');
    return { ok:true, scube };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

module.exports = { init, ensureUser, getOrCreateUser, handleClick, exchange, buyUpgrade, claimReward };
