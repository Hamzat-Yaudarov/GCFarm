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

    // Ensure clans and competition schema
    try {
      await ensureAllSchemas();
    } catch (e) {
      console.warn('ensureAllSchemas failed', e);
    }
  } finally {
    client.release();
  }
}

async function setReferrer(tgid, referrer) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    if (Number(tgid) === Number(referrer)) { await client.query('ROLLBACK'); return { ok:false, message: 'Нельзя быть своим р��фералом' }; }
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
async function claimReward(tgid, amount, source) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const res = await client.query('SELECT scube, last_reward_at, referrer_tgid FROM users WHERE tgid = $1 FOR UPDATE', [tgid]);
    if (!res.rows.length) { await client.query('ROLLBACK'); throw new Error('User not found'); }
    const last = res.rows[0].last_reward_at;
    const now = new Date();
    if (last) {
      const diff = now - new Date(last);
      // prevent abuse: require at least 10 seconds between reward claims
      if (diff < 10000) {
        await client.query('ROLLBACK');
        return { ok:false, message: 'Слишком частые запросы награды' };
      }
    }
    let scube = Number(res.rows[0].scube);
    scube += amount;

    // If the source is a completed task, increment tasks_completed
    if (source === 'task') {
      await client.query('UPDATE users SET scube=$1, last_reward_at = $2, tasks_completed = tasks_completed + 1 WHERE tgid=$3', [scube, now, tgid]);
    } else {
      await client.query('UPDATE users SET scube=$1, last_reward_at = $2 WHERE tgid=$3', [scube, now, tgid]);
    }

    // if user has referrer, credit 10% of amount (rounded down)
    const referrer = res.rows[0].referrer_tgid;
    if (referrer) {
      const bonus = Math.floor(amount * 0.1);
      if (bonus > 0) {
        await client.query('UPDATE users SET scube = scube + $1 WHERE tgid = $2', [bonus, referrer]);
      }
    }

    await client.query('COMMIT');
    return { ok:true, scube };
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

// === Clan & Competition schema and functions ===
async function ensureClanSchema(client) {
  await client.query(`
    CREATE TABLE IF NOT EXISTS clans (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      tag TEXT,
      description TEXT,
      leader_tgid BIGINT,
      members_count INTEGER DEFAULT 0,
      rating INTEGER DEFAULT 0,
      created_at TIMESTAMPTZ DEFAULT now()
    );
  `);

  await client.query(`
    CREATE TABLE IF NOT EXISTS clan_members (
      clan_id INTEGER REFERENCES clans(id) ON DELETE CASCADE,
      tgid BIGINT NOT NULL,
      role TEXT NOT NULL DEFAULT 'member',
      joined_at TIMESTAMPTZ DEFAULT now(),
      contribution_today BIGINT DEFAULT 0,
      total_contribution BIGINT DEFAULT 0,
      PRIMARY KEY (clan_id, tgid)
    );
  `);

  await client.query(`
    CREATE TABLE IF NOT EXISTS competitions (
      id SERIAL PRIMARY KEY,
      clan_a INTEGER REFERENCES clans(id),
      clan_b INTEGER REFERENCES clans(id),
      status TEXT DEFAULT 'pending',
      start_at TIMESTAMPTZ,
      end_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ DEFAULT now()
    );
  `);

  await client.query(`
    CREATE TABLE IF NOT EXISTS competition_contributions (
      id SERIAL PRIMARY KEY,
      competition_id INTEGER REFERENCES competitions(id) ON DELETE CASCADE,
      tgid BIGINT NOT NULL,
      scube_amount BIGINT NOT NULL,
      coins_amount BIGINT NOT NULL,
      created_at TIMESTAMPTZ DEFAULT now()
    );
  `);

  await client.query(`
    CREATE TABLE IF NOT EXISTS building_types (
      id SERIAL PRIMARY KEY,
      name TEXT,
      base_price_scube BIGINT DEFAULT 0,
      coin_yield_per_30min BIGINT DEFAULT 0,
      is_unique BOOLEAN DEFAULT false,
      is_strong BOOLEAN DEFAULT false
    );
  `);

  await client.query(`
    CREATE TABLE IF NOT EXISTS competition_buildings (
      id SERIAL PRIMARY KEY,
      competition_id INTEGER REFERENCES competitions(id) ON DELETE CASCADE,
      building_type_id INTEGER REFERENCES building_types(id),
      created_at TIMESTAMPTZ DEFAULT now()
    );
  `);

  await client.query(`
    CREATE TABLE IF NOT EXISTS competition_building_history (
      id SERIAL PRIMARY KEY,
      competition_building_id INTEGER REFERENCES competition_buildings(id) ON DELETE CASCADE,
      owner_clan_id INTEGER REFERENCES clans(id),
      start_at TIMESTAMPTZ NOT NULL,
      end_at TIMESTAMPTZ
    );
  `);

  await client.query(`
    CREATE TABLE IF NOT EXISTS building_purchases (
      id SERIAL PRIMARY KEY,
      competition_building_id INTEGER REFERENCES competition_buildings(id) ON DELETE CASCADE,
      clan_id INTEGER REFERENCES clans(id),
      price_paid_scube BIGINT NOT NULL,
      purchased_at TIMESTAMPTZ DEFAULT now()
    );
  `);

  await client.query(`
    CREATE TABLE IF NOT EXISTS building_payouts (
      id SERIAL PRIMARY KEY,
      competition_building_id INTEGER REFERENCES competition_buildings(id) ON DELETE CASCADE,
      paid_to_clan INTEGER REFERENCES clans(id),
      payout_time TIMESTAMPTZ NOT NULL,
      coins_paid BIGINT NOT NULL
    );
  `);

  await client.query(`
    CREATE TABLE IF NOT EXISTS transactions (
      id SERIAL PRIMARY KEY,
      tgid BIGINT,
      clan_id INTEGER,
      type TEXT,
      amount_scube BIGINT,
      meta JSONB,
      created_at TIMESTAMPTZ DEFAULT now()
    );
  `);

  await client.query(`
    CREATE TABLE IF NOT EXISTS competition_logs (
      id SERIAL PRIMARY KEY,
      competition_id INTEGER REFERENCES competitions(id),
      event_type TEXT,
      data JSONB,
      created_at TIMESTAMPTZ DEFAULT now()
    );
  `);
}

async function ensureAllSchemas() {
  const client = await pool.connect();
  try {
    await ensureClanSchema(client);
    const res = await client.query('SELECT count(*) as c FROM building_types');
    if (res.rows.length && Number(res.rows[0].c) === 0) {
      for (let i=0;i<15;i++) await client.query('INSERT INTO building_types (name, base_price_scube, coin_yield_per_30min, is_unique, is_strong) VALUES ($1,$2,$3,false,false)', [`House ${i+1}`, 10, 100]);
      for (let i=0;i<7;i++) await client.query('INSERT INTO building_types (name, base_price_scube, coin_yield_per_30min, is_unique, is_strong) VALUES ($1,$2,$3,true,false)', [`Unique ${i+1}`, 100, 1200]);
      await client.query('INSERT INTO building_types (name, base_price_scube, coin_yield_per_30min, is_unique, is_strong) VALUES ($1,$2,$3,true,true)', ['Stronghold', 500, 10000]);
    }
  } finally { client.release(); }
}

async function createClan(tgid, name, tag, description) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const res = await client.query('INSERT INTO clans (name, tag, description, leader_tgid, members_count) VALUES ($1,$2,$3,$4,1) RETURNING *', [name, tag || null, description || null, tgid]);
    const clan = res.rows[0];
    await client.query('INSERT INTO clan_members (clan_id, tgid, role) VALUES ($1,$2,$3)', [clan.id, tgid, 'leader']);
    await client.query('COMMIT');
    return { ok:true, clan };
  } catch (err) { await client.query('ROLLBACK'); throw err; } finally { client.release(); }
}

async function addMemberToClan(clan_id, tgid, role='member') {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const exists = await client.query('SELECT 1 FROM clan_members WHERE clan_id = $1 AND tgid = $2', [clan_id, tgid]);
    if (exists.rows.length) { await client.query('ROLLBACK'); return { ok:false, message: 'Already in clan' }; }
    await client.query('INSERT INTO clan_members (clan_id, tgid, role) VALUES ($1,$2,$3)', [clan_id, tgid, role]);
    await client.query('UPDATE clans SET members_count = members_count + 1 WHERE id = $1', [clan_id]);
    await client.query('COMMIT');
    return { ok:true };
  } catch (err) { await client.query('ROLLBACK'); throw err; } finally { client.release(); }
}

async function removeMemberFromClan(clan_id, tgid) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('DELETE FROM clan_members WHERE clan_id = $1 AND tgid = $2', [clan_id, tgid]);
    await client.query('UPDATE clans SET members_count = GREATEST(members_count - 1, 0) WHERE id = $1', [clan_id]);
    await client.query('COMMIT');
    return { ok:true };
  } catch (err) { await client.query('ROLLBACK'); throw err; } finally { client.release(); }
}

async function startCompetitionSearch(clan_id) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const c = await client.query("SELECT 1 FROM competitions WHERE status IN ('pending','active') AND (clan_a=$1 OR clan_b=$1)", [clan_id]);
    if (c.rows.length) { await client.query('ROLLBACK'); return { ok:false, message:'Clan already in competition or searching' }; }
    const res = await client.query('INSERT INTO competitions (clan_a, status) VALUES ($1, $2) RETURNING *', [clan_id, 'pending']);
    await client.query('COMMIT');
    return { ok:true, competition: res.rows[0] };
  } catch (err) { await client.query('ROLLBACK'); throw err; } finally { client.release(); }
}

async function joinCompetitionSearch(clan_id) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const c = await client.query("SELECT 1 FROM competitions WHERE status IN ('pending','active') AND (clan_a=$1 OR clan_b=$1)", [clan_id]);
    if (c.rows.length) { await client.query('ROLLBACK'); return { ok:false, message:'Clan already in competition or searching' }; }
    const pending = await client.query('SELECT * FROM competitions WHERE status = $1 AND clan_a IS NOT NULL AND clan_a <> $2 ORDER BY created_at ASC LIMIT 1', ['pending', clan_id]);
    if (!pending.rows.length) { await client.query('ROLLBACK'); return { ok:false, message:'No pending competitions found' }; }
    const comp = pending.rows[0];
    const now = new Date();
    const endAt = new Date(now.getTime() + 4*24*60*60*1000);
    await client.query('UPDATE competitions SET clan_b=$1, status=$2, start_at=$3, end_at=$4 WHERE id=$5', [clan_id, 'active', now, endAt, comp.id]);
    const types = await client.query('SELECT * FROM building_types ORDER BY is_unique ASC, is_strong ASC, id ASC');
    const rows = types.rows;
    const normals = rows.filter(r=>!r.is_unique).slice(0,15);
    const uniques = rows.filter(r=>r.is_unique && !r.is_strong).slice(0,7);
    const strongs = rows.filter(r=>r.is_strong).slice(0,1);
    const selected = normals.concat(uniques).concat(strongs);
    for (const t of selected) {
      const res = await client.query('INSERT INTO competition_buildings (competition_id, building_type_id) VALUES ($1,$2) RETURNING id', [comp.id, t.id]);
      const bId = res.rows[0].id;
      await client.query('INSERT INTO competition_building_history (competition_building_id, owner_clan_id, start_at) VALUES ($1, NULL, $2)', [bId, now]);
    }
    await client.query('COMMIT');
    return { ok:true, competition_id: comp.id };
  } catch (err) { await client.query('ROLLBACK'); throw err; } finally { client.release(); }
}

async function contributeToCompetition(competition_id, tgid, scubeAmount) {
  const client = await pool.connect();
  try {
    scubeAmount = Math.max(0, parseInt(scubeAmount || 0, 10));
    if (!scubeAmount) return { ok:false, message:'Invalid amount' };
    await client.query('BEGIN');
    const compRes = await client.query('SELECT * FROM competitions WHERE id = $1 FOR UPDATE', [competition_id]);
    if (!compRes.rows.length) { await client.query('ROLLBACK'); return { ok:false, message:'Competition not found' }; }
    const comp = compRes.rows[0];
    if (comp.status !== 'active') { await client.query('ROLLBACK'); return { ok:false, message:'Competition not active' }; }
    const inClan = await client.query('SELECT clan_id, role FROM clan_members WHERE tgid=$1 AND clan_id IN ($2,$3)', [tgid, comp.clan_a, comp.clan_b]);
    if (!inClan.rows.length) { await client.query('ROLLBACK'); return { ok:false, message:'User not in participating clan' }; }
    const todayStart = new Date(); todayStart.setUTCHours(0,0,0,0);
    const todayEnd = new Date(todayStart.getTime() + 24*60*60*1000);
    const sumRes = await client.query('SELECT COALESCE(SUM(scube_amount),0) as s FROM competition_contributions WHERE tgid=$1 AND created_at >= $2 AND created_at < $3', [tgid, todayStart, todayEnd]);
    const already = Number(sumRes.rows[0].s || 0);
    if (already + scubeAmount > 200) { await client.query('ROLLBACK'); return { ok:false, message:'Daily contribution limit exceeded (200 SCube/day)' }; }
    const userRes = await client.query('SELECT scube FROM users WHERE tgid = $1 FOR UPDATE', [tgid]);
    if (!userRes.rows.length) { await client.query('ROLLBACK'); return { ok:false, message:'User not found' }; }
    const userScube = Number(userRes.rows[0].scube || 0);
    if (userScube < scubeAmount) { await client.query('ROLLBACK'); return { ok:false, message:'Insufficient SCube' }; }
    const newUserScube = userScube - scubeAmount;
    await client.query('UPDATE users SET scube=$1 WHERE tgid=$2', [newUserScube, tgid]);
    const coins = scubeAmount * 10;
    await client.query('INSERT INTO competition_contributions (competition_id, tgid, scube_amount, coins_amount) VALUES ($1,$2,$3,$4)', [competition_id, tgid, scubeAmount, coins]);
    await client.query('INSERT INTO transactions (tgid, clan_id, type, amount_scube, meta) VALUES ($1,null,$2,$3,$4)', [tgid, 'contribution', scubeAmount, JSON.stringify({ competition_id })]);
    await client.query('COMMIT');
    return { ok:true, scube_remaining: newUserScube, coins_contributed: coins };
  } catch (err) { await client.query('ROLLBACK'); throw err; } finally { client.release(); }
}

async function purchaseBuilding(competition_id, building_id, clan_id, tgid) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const roleRes = await client.query('SELECT role FROM clan_members WHERE clan_id=$1 AND tgid=$2 FOR UPDATE', [clan_id, tgid]);
    if (!roleRes.rows.length) { await client.query('ROLLBACK'); return { ok:false, message:'User not clan member' }; }
    const role = roleRes.rows[0].role;
    if (!['leader','co_leader'].includes(role)) { await client.query('ROLLBACK'); return { ok:false, message:'Permission denied' }; }
    const compRes = await client.query('SELECT * FROM competitions WHERE id = $1 FOR UPDATE', [competition_id]);
    if (!compRes.rows.length) { await client.query('ROLLBACK'); return { ok:false, message:'Competition not found' }; }
    const comp = compRes.rows[0];
    if (comp.status !== 'active') { await client.query('ROLLBACK'); return { ok:false, message:'Competition not active' }; }
    const bRes = await client.query('SELECT cb.*, bt.base_price_scube, bt.coin_yield_per_30min FROM competition_buildings cb JOIN building_types bt ON cb.building_type_id = bt.id WHERE cb.id=$1', [building_id]);
    if (!bRes.rows.length) { await client.query('ROLLBACK'); return { ok:false, message:'Building not found' }; }
    const b = bRes.rows[0];
    const hist = await client.query('SELECT * FROM competition_building_history WHERE competition_building_id=$1 ORDER BY start_at DESC LIMIT 1 FOR UPDATE', [building_id]);
    const currentOwner = hist.rows.length ? hist.rows[0].owner_clan_id : null;
    let price_scube = Number(b.base_price_scube || 0);
    if (currentOwner && currentOwner !== clan_id) price_scube = price_scube * 3;
    const price_coins = price_scube * 10;
    const avail = await client.query('SELECT COALESCE(SUM(coins_amount),0) as coins FROM competition_contributions WHERE competition_id=$1 AND tgid IN (SELECT tgid FROM clan_members WHERE clan_id=$2)', [competition_id, clan_id]);
    const spent = await client.query('SELECT COALESCE(SUM(price_paid_scube)*10,0) as spent_coins FROM building_purchases bp JOIN competition_buildings cb ON bp.competition_building_id = cb.id WHERE cb.competition_id=$1 AND bp.clan_id=$2', [competition_id, clan_id]);
    const coinsAvailable = Number(avail.rows[0].coins || 0) - Number(spent.rows[0].spent_coins || 0);
    if (coinsAvailable < price_coins) { await client.query('ROLLBACK'); return { ok:false, message:'Not enough clan coins' }; }
    await client.query('INSERT INTO building_purchases (competition_building_id, clan_id, price_paid_scube, purchased_at) VALUES ($1,$2,$3,$4)', [building_id, clan_id, price_scube, new Date()]);
    if (hist.rows.length) await client.query('UPDATE competition_building_history SET end_at=$1 WHERE id=$2', [new Date(), hist.rows[0].id]);
    await client.query('INSERT INTO competition_building_history (competition_building_id, owner_clan_id, start_at) VALUES ($1,$2,$3)', [building_id, clan_id, new Date()]);
    await client.query('INSERT INTO transactions (tgid, clan_id, type, amount_scube, meta) VALUES ($1,$2,$3,$4,$5)', [tgid, clan_id, 'building_purchase', price_scube, JSON.stringify({ competition_id, building_id })]);
    await client.query('COMMIT');
    return { ok:true, price_scube, price_coins };
  } catch (err) { await client.query('ROLLBACK'); throw err; } finally { client.release(); }
}

async function computeCompetitionCoins(competition_id) {
  const client = await pool.connect();
  try {
    const compRes = await client.query('SELECT * FROM competitions WHERE id=$1', [competition_id]);
    if (!compRes.rows.length) return null;
    const comp = compRes.rows[0];
    const compStart = comp.start_at;
    const compEnd = comp.end_at;
    const results = {};
    const histRes = await client.query(`
      SELECT h.*, bt.coin_yield_per_30min
      FROM competition_building_history h
      JOIN competition_buildings cb ON cb.id = h.competition_building_id
      JOIN building_types bt ON bt.id = cb.building_type_id
      WHERE cb.competition_id = $1
      ORDER BY h.start_at ASC
    `, [competition_id]);
    for (const row of histRes.rows) {
      const owner = row.owner_clan_id;
      if (!owner) continue;
      const start = new Date(row.start_at) < new Date(compStart) ? new Date(compStart) : new Date(row.start_at);
      const end = row.end_at ? new Date(row.end_at) : new Date(compEnd);
      if (end <= start) continue;
      const seconds = Math.floor((end.getTime() - start.getTime())/1000);
      const intervals = Math.floor(seconds / (30*60));
      const coins = intervals * Number(row.coin_yield_per_30min || 0);
      if (!results[owner]) results[owner] = 0;
      results[owner] += coins;
    }
    return results;
  } finally { client.release(); }
}

// get competition by id
async function getCompetition(competition_id) {
  const client = await pool.connect();
  try {
    const res = await client.query('SELECT * FROM competitions WHERE id=$1', [competition_id]);
    return res.rows[0] || null;
  } finally { client.release(); }
}

// get clan member by tgid (return clan_id and role)
async function getClanMemberByTgid(tgid) {
  const client = await pool.connect();
  try {
    const res = await client.query('SELECT clan_id, role, joined_at FROM clan_members WHERE tgid=$1', [tgid]);
    return res.rows || [];
  } finally { client.release(); }
}

// get competition buildings list with current owner info
async function getCompetitionBuildings(competition_id) {
  const client = await pool.connect();
  try {
    const rows = await client.query(`
      SELECT cb.id, bt.name, bt.base_price_scube, bt.coin_yield_per_30min,
        (SELECT owner_clan_id FROM competition_building_history h WHERE h.competition_building_id = cb.id ORDER BY h.start_at DESC LIMIT 1) as owner_clan_id
      FROM competition_buildings cb
      JOIN building_types bt ON bt.id = cb.building_type_id
      WHERE cb.competition_id = $1
      ORDER BY cb.id
    `, [competition_id]);
    return rows.rows;
  } finally { client.release(); }
}

// get available clan coins (sum contributions minus spent) - exported helper
async function getClanAvailableCoins(competition_id, clan_id) {
  const client = await pool.connect();
  try {
    const contribs = await client.query('SELECT COALESCE(SUM(coins_amount),0) as coins FROM competition_contributions WHERE competition_id=$1 AND tgid IN (SELECT tgid FROM clan_members WHERE clan_id=$2)', [competition_id, clan_id]);
    const spent = await client.query('SELECT COALESCE(SUM(price_paid_scube)*10,0) as spent_coins FROM building_purchases bp JOIN competition_buildings cb ON bp.competition_building_id = cb.id WHERE cb.competition_id=$1 AND bp.clan_id=$2', [competition_id, clan_id]);
    const coins = Number(contribs.rows[0].coins || 0) - Number(spent.rows[0].spent_coins || 0);
    return coins;
  } finally { client.release(); }
}

async function finishCompetition(competition_id) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const compRes = await client.query('SELECT * FROM competitions WHERE id=$1 FOR UPDATE', [competition_id]);
    if (!compRes.rows.length) { await client.query('ROLLBACK'); return { ok:false, message:'Competition not found' }; }
    const comp = compRes.rows[0];
    if (comp.status !== 'active') { await client.query('ROLLBACK'); return { ok:false, message:'Competition not active' }; }
    const coinsMap = await computeCompetitionCoins(competition_id);
    const clanA = comp.clan_a; const clanB = comp.clan_b;
    const coinsA = Number(coinsMap[clanA] || 0);
    const coinsB = Number(coinsMap[clanB] || 0);
    let winnerClan = null;
    if (coinsA > coinsB) winnerClan = clanA; else if (coinsB > coinsA) winnerClan = clanB; else winnerClan = null;
    const poolRes = await client.query('SELECT COALESCE(SUM(scube_amount),0) as total_scube FROM competition_contributions WHERE competition_id=$1', [competition_id]);
    const total_scube = Number(poolRes.rows[0].total_scube || 0);
    const platform_fee_percent = 30;
    const platform_fee = Math.floor(total_scube * (platform_fee_percent/100.0));
    const winners_pool_scube = total_scube - platform_fee;
    const payouts = [];
    if (winnerClan) {
      const contribRes = await client.query('SELECT tgid, COALESCE(SUM(scube_amount),0) as s FROM competition_contributions WHERE competition_id=$1 AND tgid IN (SELECT tgid FROM clan_members WHERE clan_id=$2) GROUP BY tgid', [competition_id, winnerClan]);
      const total_by_members = contribRes.rows.reduce((acc,r)=>acc+Number(r.s||0),0);
      if (total_by_members <= 0) {
        const leaderRes = await client.query('SELECT leader_tgid FROM clans WHERE id=$1', [winnerClan]);
        const leaderTgid = leaderRes.rows.length ? leaderRes.rows[0].leader_tgid : null;
        if (leaderTgid) {
          await client.query('UPDATE users SET scube = scube + $1 WHERE tgid = $2', [winners_pool_scube, leaderTgid]);
          await client.query('INSERT INTO transactions (tgid, clan_id, type, amount_scube, meta) VALUES ($1,$2,$3,$4,$5)', [leaderTgid, winnerClan, 'competition_win', winners_pool_scube, JSON.stringify({ competition_id })]);
          payouts.push({ tgid: leaderTgid, amount: winners_pool_scube });
        }
      } else {
        for (const row of contribRes.rows) {
          const tgid = row.tgid;
          const scube_contrib = Number(row.s || 0);
          const share = Math.floor((scube_contrib / total_by_members) * winners_pool_scube);
          if (share > 0) {
            await client.query('UPDATE users SET scube = scube + $1 WHERE tgid = $2', [share, tgid]);
            await client.query('INSERT INTO transactions (tgid, clan_id, type, amount_scube, meta) VALUES ($1,$2,$3,$4,$5)', [tgid, winnerClan, 'competition_win', share, JSON.stringify({ competition_id })]);
            payouts.push({ tgid, amount: share });
          }
        }
      }
    }
    if (platform_fee > 0) {
      await client.query('INSERT INTO transactions (tgid, clan_id, type, amount_scube, meta) VALUES (NULL,$1,$2,$3,$4)', [null, 'platform_fee', platform_fee, JSON.stringify({ competition_id })]);
    }
    await client.query('UPDATE competitions SET status=$1 WHERE id=$2', ['finished', competition_id]);
    await client.query('COMMIT');
    return { ok:true, winner: winnerClan, coins: { [clanA]: coinsA, [clanB]: coinsB }, payouts, platform_fee, total_scube };
  } catch (err) { await client.query('ROLLBACK'); throw err; } finally { client.release(); }
}

module.exports = { init, ensureUser, getOrCreateUser, handleClick, exchange, buyUpgrade, claimReward, refillToFull, autoTick, setReferrer, getLeaderboard, tryReserveScube, creditScube, ensureAllSchemas, createClan, addMemberToClan, removeMemberFromClan, startCompetitionSearch, joinCompetitionSearch, contributeToCompetition, purchaseBuilding, computeCompetitionCoins, finishCompetition, getCompetition, getClanMemberByTgid, getClanAvailableCoins };
