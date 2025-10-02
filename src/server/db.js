const { Pool } = require('pg');

const DATABASE_URL = process.env.NEON_DATABASE_URL;

if (!DATABASE_URL) {
  console.error('NEON_DATABASE_URL is not set');
}

const pool = new Pool({ connectionString: DATABASE_URL, ssl: { rejectUnauthorized: false } });

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
    await client.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS referrer_tgid BIGINT`);
    // Add "stars" currency
    await client.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS stars BIGINT DEFAULT 0`);
    // For rating system
    await client.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS clicks_total BIGINT DEFAULT 0`);
    await client.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS tasks_completed BIGINT DEFAULT 0`);

    // Helpful indexes
    await client.query(`CREATE INDEX IF NOT EXISTS idx_users_clicks_total ON users (clicks_total)`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_users_tasks_completed ON users (tasks_completed)`);

    // referral stats per pair (referrer, referred)
    await client.query(`CREATE TABLE IF NOT EXISTS referral_stats (
      referrer BIGINT,
      referred BIGINT,
      click_count INTEGER DEFAULT 0,
      PRIMARY KEY (referrer, referred)
    );`);

    await client.query(`CREATE TABLE IF NOT EXISTS reward_events (
      context_id TEXT PRIMARY KEY,
      tgid BIGINT NOT NULL,
      amount BIGINT NOT NULL,
      source TEXT,
      created_at TIMESTAMPTZ DEFAULT now()
    );`);
  } finally {
    client.release();
  }
}

async function setReferrer(tgid, referrer) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    if (Number(tgid) === Number(referrer)) { await client.query('ROLLBACK'); return { ok:false, message: 'Нельзя быть своим рефералом' }; }
    // ensure users exist
    await client.query('INSERT INTO users (tgid, name, energy, energy_capacity, daily_count, daily_limit_level, last_reset, last_refill, auto_energy) VALUES ($1,$2,50,50,0,0,current_date,current_date,false) ON CONFLICT (tgid) DO NOTHING', [tgid, `Player ${tgid}`]);
    await client.query('INSERT INTO users (tgid, name, energy, energy_capacity, daily_count, daily_limit_level, last_reset, last_refill, auto_energy) VALUES ($1,$2,50,50,0,0,current_date,current_date,false) ON CONFLICT (tgid) DO NOTHING', [referrer, `Player ${referrer}`]);

    // set only if not set
    const res = await client.query('SELECT referrer_tgid FROM users WHERE tgid = $1 FOR UPDATE', [tgid]);
    if (!res.rows.length) { await client.query('ROLLBACK'); return { ok:false, message:'User not found' }; }
    if (res.rows[0].referrer_tgid) { await client.query('ROLLBACK'); return { ok:false, message:'Реферал уже установлен' }; }
    await client.query('UPDATE users SET referrer_tgid = $1 WHERE tgid = $2', [referrer, tgid]);
    await client.query('COMMIT');
    return { ok:true };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

async function ensureUser(tgid, name) {
  const client = await pool.connect();
  try {
    await client.query(
      `INSERT INTO users (tgid, name, scube, gcube, stars, energy, energy_capacity, daily_count, daily_limit_level, last_reset, last_refill, auto_energy) VALUES ($1,$2,0,0,0,50,50,0,0,current_date,current_date,false)
       ON CONFLICT (tgid) DO UPDATE SET name = EXCLUDED.name`,
      [tgid, name]
    );
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
    stars: Number(row.stars || 0),
    energy: Number(row.energy),
    energy_capacity: Number(row.energy_capacity),
    daily_count: Number(row.daily_count),
    daily_limit_level: Number(row.daily_limit_level),
    last_reset: row.last_reset,
    last_refill: row.last_refill,
    auto_energy: Boolean(row.auto_energy)
  };
}

const DAILY_BASE = 250;
const DAILY_INCREMENT = 50;

async function getOrCreateUser(tgid) {
  const client = await pool.connect();
  try {
    const res = await client.query('SELECT * FROM users WHERE tgid = $1', [tgid]);
    const today = new Date().toISOString().slice(0,10);
    if (res.rows.length) {
      const user = res.rows[0];
      // reset daily_count if day changed
      if (!user.last_reset || user.last_reset.toISOString().slice(0,10) !== today) {
        await client.query('UPDATE users SET daily_count = 0, last_reset = current_date WHERE tgid = $1', [tgid]);
        user.daily_count = 0;
      }
      // daily full refill once per day
      if (!user.last_refill || user.last_refill.toISOString().slice(0,10) !== today) {
        await client.query('UPDATE users SET energy = energy_capacity, last_refill = current_date WHERE tgid = $1', [tgid]);
        user.energy = user.energy_capacity;
        user.last_refill = new Date();
        const updated = await client.query('SELECT * FROM users WHERE tgid = $1', [tgid]);
        return mapUser(updated.rows[0]);
      }
      return mapUser(user);
    } else {
      await client.query('INSERT INTO users (tgid, name, scube, gcube, stars, energy, energy_capacity, daily_count, daily_limit_level, last_reset, last_refill, auto_energy) VALUES ($1,$2,0,0,0,50,50,0,0,current_date,current_date,false)', [tgid, `Player ${tgid}`]);
      return await getOrCreateUser(tgid);
    }
  } finally {
    client.release();
  }
}

async function handleClick(tgid) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const res = await client.query('SELECT scube, energy, daily_count, daily_limit_level, energy_capacity FROM users WHERE tgid = $1 FOR UPDATE', [tgid]);
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
      return { ok: false, message: 'Достигнут дневной лимит' };
    }

    const newScube = Number(user.scube) + 1;
    const newEnergy = energy - 1;
    const newDaily = daily_count + 1;

    await client.query('UPDATE users SET scube = $1, energy = $2, daily_count = $3, clicks_total = clicks_total + 1 WHERE tgid = $4', [newScube, newEnergy, newDaily, tgid]);

    // handle referral click counting and reward: if this user was referred, increment counter for referrer
    const refRes = await client.query('SELECT referrer_tgid FROM users WHERE tgid = $1 FOR UPDATE', [tgid]);
    if (refRes.rows.length && refRes.rows[0].referrer_tgid) {
      const referrer = refRes.rows[0].referrer_tgid;
      const upsert = await client.query(`INSERT INTO referral_stats (referrer, referred, click_count) VALUES ($1, $2, 1)
        ON CONFLICT (referrer, referred) DO UPDATE SET click_count = referral_stats.click_count + 1
        RETURNING click_count`, [referrer, tgid]);
      const clickCount = upsert.rows[0].click_count;
      if (clickCount >= 10) {
        await client.query('UPDATE referral_stats SET click_count = click_count - 10 WHERE referrer = $1 AND referred = $2', [referrer, tgid]);
        await client.query('UPDATE users SET scube = scube + 1 WHERE tgid = $1', [referrer]);
      }
    }

    await client.query('COMMIT');
    return { ok: true, scube: newScube, energy: newEnergy, daily_count: newDaily, daily_limit };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

// Exchange: flexible converter between scube/gcube/stars using SCube as base unit
async function exchange(tgid, arg1, arg2, arg3) {
  // support legacy signature: (tgid, direction, units)
  // or new signature: (tgid, from, to, amount)
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    // determine mode
    let from, to, amount;
    if (typeof arg2 === 'string' && (arg2 === 'scube_to_gcube' || arg2 === 'gcube_to_scube')) {
      // legacy
      const direction = arg1 === undefined ? arg1 : arg2; // unused
      const directionLegacy = arg2;
      const units = arg3 || 1;
      if (directionLegacy === 'scube_to_gcube') { from = 'scube'; to = 'gcube'; amount = Number(units); }
      else { from = 'gcube'; to = 'scube'; amount = Number(units); }
    }
    // detect new signature: arg1 is from (string) if arg2 is string and arg3 number
    if (typeof arg1 === 'string' && typeof arg2 === 'string') {
      from = String(arg1).toLowerCase();
      to = String(arg2).toLowerCase();
      amount = Math.max(0, parseInt(arg3 || 0, 10));
    }

    // Fallback when function called as exchange(tgid, direction, units)
    if (!from && typeof arg2 === 'string' && typeof arg3 === 'number') {
      const dir = String(arg2);
      const units = arg3;
      if (dir === 'scube_to_gcube') { from = 'scube'; to = 'gcube'; amount = Number(units); }
      else if (dir === 'gcube_to_scube') { from = 'gcube'; to = 'scube'; amount = Number(units); }
    }

    // Final validation
    const valid = ['scube','gcube','stars'];
    if (!from || !to || !valid.includes(from) || !valid.includes(to) || from === to) {
      await client.query('ROLLBACK');
      return { ok:false, message: 'Invalid currencies' };
    }
    amount = Math.max(0, parseInt(amount || 0, 10));
    if (!amount || amount <= 0) { await client.query('ROLLBACK'); return { ok:false, message: 'Invalid amount' }; }

    // lock user balances
    const res = await client.query('SELECT scube, gcube, stars FROM users WHERE tgid = $1 FOR UPDATE', [tgid]);
    if (!res.rows.length) { await client.query('ROLLBACK'); throw new Error('User not found'); }
    const user = res.rows[0];
    let scube = Number(user.scube || 0);
    let gcube = Number(user.gcube || 0);
    let stars = Number(user.stars || 0);

    const RATES = { scube: 1, gcube: 50, stars: 60 };
    const fromRate = RATES[from];
    const toRate = RATES[to];

    // check availability of source units
    if (from === 'scube' && scube < amount) { await client.query('ROLLBACK'); return { ok:false, message: 'Недостаточно SCube' }; }
    if (from === 'gcube' && gcube < amount) { await client.query('ROLLBACK'); return { ok:false, message: 'Недостаточно GCube' }; }
    if (from === 'stars' && stars < amount) { await client.query('ROLLBACK'); return { ok:false, message: 'Недостаточно Stars' }; }

    const scubeValue = amount * fromRate; // how many scube units provided
    const targetUnits = Math.floor(scubeValue / toRate);
    if (targetUnits < 1) { await client.query('ROLLBACK'); return { ok:false, message: 'Сумма слишком мала для обмена' }; }

    // compute how many scube we will consume (equal to targetUnits * toRate)
    const scubeToConsume = targetUnits * toRate;
    // compute how many source units to deduct
    const sourceDeduct = Math.ceil(scubeToConsume / fromRate);

    // perform deduction and addition
    if (from === 'scube') scube -= sourceDeduct; else if (from === 'gcube') gcube -= sourceDeduct; else if (from === 'stars') stars -= sourceDeduct;
    if (to === 'scube') scube += targetUnits; else if (to === 'gcube') gcube += targetUnits; else if (to === 'stars') stars += targetUnits;

    await client.query('UPDATE users SET scube=$1, gcube=$2, stars=$3 WHERE tgid=$4', [scube, gcube, stars, tgid]);
    await client.query('COMMIT');
    return { ok:true, scube, gcube, stars, exchanged: { from, to, amount: sourceDeduct, received: targetUnits } };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

// Buy upgrades
// type: 'energy_capacity' or 'daily_limit' or 'auto_energy'
async function buyUpgrade(tgid, type) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const res = await client.query('SELECT scube, energy_capacity, daily_limit_level, auto_energy FROM users WHERE tgid = $1 FOR UPDATE', [tgid]);
    if (!res.rows.length) { await client.query('ROLLBACK'); throw new Error('User not found'); }
    let { scube, energy_capacity, daily_limit_level, auto_energy } = res.rows[0];
    scube = Number(scube); energy_capacity = Number(energy_capacity); daily_limit_level = Number(daily_limit_level); auto_energy = Boolean(auto_energy);

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
    } else if (type === 'auto_energy') {
      const cost = 2000;
      if (scube < cost) { await client.query('ROLLBACK'); return { ok:false, message: 'Недостаточно SCube' }; }
      if (auto_energy) { await client.query('ROLLBACK'); return { ok:false, message: 'Уже куплено автоэнергия' }; }
      scube -= cost;
      auto_energy = true;
      await client.query('UPDATE users SET scube=$1, auto_energy=$2 WHERE tgid=$3', [scube, auto_energy, tgid]);
      await client.query('COMMIT');
      return { ok:true, scube, auto_energy };
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
async function claimReward(tgid, amount, source, options = {}) {
  const client = await pool.connect();
  const { force = false, contextId = null } = options || {};
  try {
    await client.query('BEGIN');
    const res = await client.query('SELECT scube, last_reward_at, referrer_tgid FROM users WHERE tgid = $1 FOR UPDATE', [tgid]);
    if (!res.rows.length) { await client.query('ROLLBACK'); throw new Error('User not found'); }
    const user = res.rows[0];
    const now = new Date();
    const previousScube = Number(user.scube || 0);
    const credit = Math.max(0, Math.round(Number(amount) || 0));
    if (!credit) {
      await client.query('ROLLBACK');
      return { ok:false, message: 'Invalid reward amount', scube: previousScube };
    }

    if (!force && user.last_reward_at) {
      const diff = now - new Date(user.last_reward_at);
      if (diff < 10000) {
        await client.query('ROLLBACK');
        return { ok:false, message: 'Слишком частые запросы награды', scube: previousScube };
      }
    }

    if (contextId) {
      const inserted = await client.query(
        `INSERT INTO reward_events (context_id, tgid, amount, source) VALUES ($1,$2,$3,$4)
         ON CONFLICT (context_id) DO NOTHING
         RETURNING context_id`,
        [contextId, tgid, credit, source || null]
      );
      if (!inserted.rows.length) {
        await client.query('COMMIT');
        return { ok:true, scube: previousScube, duplicate: true, credited: 0, source: source || null };
      }
    }

    let scube = previousScube + credit;

    if (source === 'task') {
      await client.query('UPDATE users SET scube=$1, last_reward_at=$2, tasks_completed = tasks_completed + 1 WHERE tgid=$3', [scube, now, tgid]);
    } else {
      await client.query('UPDATE users SET scube=$1, last_reward_at=$2 WHERE tgid=$3', [scube, now, tgid]);
    }

    const referrer = user.referrer_tgid;
    if (referrer) {
      const bonus = Math.floor(credit * 0.1);
      if (bonus > 0) {
        await client.query('UPDATE users SET scube = scube + $1 WHERE tgid = $2', [bonus, referrer]);
      }
    }

    await client.query('COMMIT');
    return { ok:true, scube, credited: credit, duplicate: false, source: source || null };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

// Manual refill to full capacity
async function refillToFull(tgid) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const res = await client.query('SELECT energy_capacity, energy FROM users WHERE tgid = $1 FOR UPDATE', [tgid]);
    if (!res.rows.length) { await client.query('ROLLBACK'); throw new Error('User not found'); }
    const capacity = Number(res.rows[0].energy_capacity);
    await client.query('UPDATE users SET energy=$1 WHERE tgid=$2', [capacity, tgid]);
    await client.query('COMMIT');
    return { ok:true, energy: capacity };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

// Auto energy tick: called every 10s from client if auto_energy enabled; increments energy by 1 up to capacity
async function autoTick(tgid) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const res = await client.query('SELECT auto_energy, energy, energy_capacity FROM users WHERE tgid = $1 FOR UPDATE', [tgid]);
    if (!res.rows.length) { await client.query('ROLLBACK'); throw new Error('User not found'); }
    const { auto_energy, energy, energy_capacity } = res.rows[0];
    if (!auto_energy) { await client.query('ROLLBACK'); return { ok:false, message: 'Auto energy not enabled' }; }
    let e = Number(energy);
    const cap = Number(energy_capacity);
    if (e >= cap) { await client.query('COMMIT'); return { ok:true, energy: e }; }
    e = Math.min(cap, e + 1);
    await client.query('UPDATE users SET energy=$1 WHERE tgid=$2', [e, tgid]);
    await client.query('COMMIT');
    return { ok:true, energy: e };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

// Leaderboard
async function getLeaderboard(by = 'clicks', viewerTgid) {
  const client = await pool.connect();
  try {
    const column = by === 'tasks' ? 'tasks_completed' : 'clicks_total';
    const res = await client.query(
      `SELECT tgid, COALESCE(name, 'Player ' || tgid::text) AS name, COALESCE(${column}, 0) AS value
       FROM users
       ORDER BY COALESCE(${column}, 0) DESC, tgid ASC
       LIMIT 100`
    );
    const entries = res.rows.map((r, idx) => ({
      rank: idx + 1,
      tgid: Number(r.tgid),
      name: r.name,
      value: Number(r.value || 0)
    }));

    let viewer = null;
    if (typeof viewerTgid === 'number' && Number.isFinite(viewerTgid)) {
      const viewerRes = await client.query(
        `WITH ranked AS (
           SELECT tgid,
                  COALESCE(name, 'Player ' || tgid::text) AS name,
                  COALESCE(${column}, 0) AS value,
                  RANK() OVER (ORDER BY COALESCE(${column}, 0) DESC, tgid ASC) AS rank
           FROM users
         )
         SELECT rank, tgid, name, value FROM ranked WHERE tgid = $1`,
        [viewerTgid]
      );
      if (viewerRes.rows.length) {
        const row = viewerRes.rows[0];
        viewer = {
          rank: Number(row.rank),
          tgid: Number(row.tgid),
          name: row.name,
          value: Number(row.value || 0)
        };
      }
    }

    return { entries, viewer };
  } finally {
    client.release();
  }
}

async function tryReserveScube(tgid, amount) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const res = await client.query('SELECT scube FROM users WHERE tgid = $1 FOR UPDATE', [tgid]);
    if (!res.rows.length) { await client.query('ROLLBACK'); return { ok:false, message:'User not found' }; }
    let scube = Number(res.rows[0].scube);
    if (scube < amount) { await client.query('ROLLBACK'); return { ok:false, message:'Недостаточно SCube' }; }
    scube -= amount;
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

async function creditScube(tgid, amount) {
  const client = await pool.connect();
  try {
    await client.query('UPDATE users SET scube = scube + $1 WHERE tgid = $2', [amount, tgid]);
    return { ok:true };
  } finally {
    client.release();
  }
}

module.exports = { init, ensureUser, getOrCreateUser, handleClick, exchange, buyUpgrade, claimReward, refillToFull, autoTick, setReferrer, getLeaderboard, tryReserveScube, creditScube };
