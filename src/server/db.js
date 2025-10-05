const { Pool } = require('pg');

const DATABASE_URL = process.env.NEON_DATABASE_URL;

if (!DATABASE_URL) {
  console.error('NEON_DATABASE_URL is not set');
}

const pool = new Pool({ connectionString: DATABASE_URL, ssl: { rejectUnauthorized: false } });

const WITHDRAWAL_METHODS = {
  stars: {
    label: 'Telegram-звёзды',
    options: {
      'stars-15': { payoutLabel: '15 Stars', baseCost: 900, commission: 45 },
      'stars-25': { payoutLabel: '25 Stars', baseCost: 1500, commission: 75 },
      'stars-50': { payoutLabel: '50 Stars', baseCost: 3000, commission: 150 },
      'stars-100': { payoutLabel: '100 Stars', baseCost: 6000, commission: 300 }
    },
    fields: []
  },
  gcubes: {
    label: 'GCubes',
    options: {
      'gcubes-60': { payoutLabel: '60 GCubes', baseCost: 3000, commission: 50 },
      'gcubes-300': { payoutLabel: '300 GCubes', baseCost: 15000, commission: 50 },
      'gcubes-600': { payoutLabel: '600 GCubes', baseCost: 30000, commission: 50 }
    },
    fields: [
      { id: 'blockmanId', label: 'ID в Blockman Go', required: true, minLength: 3, maxLength: 64 },
      { id: 'blockmanNickname', label: 'Ник в Blockman Go', required: true, minLength: 3, maxLength: 64 }
    ]
  },
  rub: {
    label: 'Перевод ₽',
    options: {
      'rub-200': { payoutLabel: '200 ₽', baseCost: 7600, commission: 100 },
      'rub-500': { payoutLabel: '500 ₽', baseCost: 19000, commission: 250 },
      'rub-750': { payoutLabel: '750 ₽', baseCost: 28500, commission: 375 },
      'rub-1000': { payoutLabel: '1000 ₽', baseCost: 38000, commission: 500 },
      'rub-1500': { payoutLabel: '1500 ₽', baseCost: 57000, commission: 750 },
      'rub-2000': { payoutLabel: '2000 ₽', baseCost: 76000, commission: 1000 }
    },
    fields: [
      { id: 'payoutPhone', label: 'Номер для перевода', required: true, minLength: 7, maxLength: 32 }
    ]
  }
};

function sanitizeText(value, maxLength = 255) {
  if (value === undefined || value === null) return '';
  const str = String(value).trim();
  if (!str) return '';
  return str.slice(0, maxLength);
}

function normalizeUsername(value) {
  if (!value) return null;
  const str = String(value).trim();
  if (!str) return null;
  return str.startsWith('@') ? str.slice(1) : str;
}

function getWithdrawalOption(methodKey, optionId) {
  const method = WITHDRAWAL_METHODS[methodKey];
  if (!method) return null;
  const option = method.options[optionId];
  if (!option) return null;
  const baseCost = Number(option.baseCost || 0);
  const commission = Number(option.commission || 0);
  return {
    methodKey,
    methodLabel: method.label,
    optionId,
    payoutLabel: option.payoutLabel,
    baseCost,
    commission,
    totalCost: baseCost + commission
  };
}

function normalizeWithdrawalDetails(methodKey, rawDetails = {}) {
  const method = WITHDRAWAL_METHODS[methodKey];
  if (!method) {
    return { details: {}, missing: ['method'] };
  }
  const output = {};
  const missing = [];
  const fields = Array.isArray(method.fields) ? method.fields : [];
  fields.forEach((field) => {
    const original = rawDetails[field.id];
    const sanitized = sanitizeText(original, field.maxLength || 255);
    if (field.required && !sanitized) {
      missing.push(field.id);
    }
    if (sanitized) {
      output[field.id] = sanitized;
    }
  });
  return { details: output, missing };
}

function mapWithdrawalRow(row) {
  if (!row) return null;
  return {
    id: Number(row.id),
    tgid: Number(row.tgid),
    method: row.method,
    optionId: row.option_id,
    payoutLabel: row.payout_label,
    baseCost: Number(row.base_cost),
    commission: Number(row.commission),
    totalCost: Number(row.total_cost),
    status: row.status,
    details: row.details || {},
    note: row.note || '',
    adminComment: row.admin_comment || '',
    adminTgid: row.admin_tgid ? Number(row.admin_tgid) : null,
    adminUsername: row.admin_username || null,
    adminFullname: row.admin_fullname || null,
    successIndex: row.success_index !== null && row.success_index !== undefined ? Number(row.success_index) : null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    userSnapshot: row.user_snapshot || null
  };
}

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

const DAILY_BASE = 400;
const DAILY_INCREMENT = 50;
const ENERGY_REFILL_COOLDOWN_MS = 60 * 1000;

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
      // energy capacity upgrade removed, do not allow
      await client.query('ROLLBACK');
      return { ok:false, message: 'Улучшение вместимости энергии было удалено' };
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
    const lastAdAt = user.last_reward_ad_at ? new Date(user.last_reward_ad_at) : null;
    const credit = Math.max(0, Math.round(Number(amount) || 0));
    if (!credit) {
      await client.query('ROLLBACK');
      return { ok:false, message: 'Invalid reward amount', scube: previousScube };
    }

    if (source === 'task' && !contextId && !force) {
      await client.query('ROLLBACK');
      return { ok:false, message: 'Отсутствует подтверждение задачи', scube: previousScube };
    }

    if (!force && source === 'ad' && lastAdAt) {
      const diff = now - lastAdAt;
      const COOLDOWN = 90 * 1000;
      if (diff < COOLDOWN) {
        const waitMs = COOLDOWN - diff;
        const waitSec = Math.max(1, Math.ceil(waitMs / 1000));
        await client.query('ROLLBACK');
        return { ok:false, message: `Смотреть рекламу можно через ${waitSec} сек.`, scube: previousScube };
      }
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
    } else if (source === 'ad') {
      await client.query('UPDATE users SET scube=$1, last_reward_at=$2, last_reward_ad_at=$2 WHERE tgid=$3', [scube, now, tgid]);
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
    const res = await client.query('SELECT energy_capacity, energy, last_energy_refill_at FROM users WHERE tgid = $1 FOR UPDATE', [tgid]);
    if (!res.rows.length) { await client.query('ROLLBACK'); throw new Error('User not found'); }
    const capacity = Number(res.rows[0].energy_capacity);
    const lastEnergyRefillAt = res.rows[0].last_energy_refill_at ? new Date(res.rows[0].last_energy_refill_at) : null;
    const now = new Date();
    if (lastEnergyRefillAt && (now - lastEnergyRefillAt) < ENERGY_REFILL_COOLDOWN_MS) {
      const waitMs = ENERGY_REFILL_COOLDOWN_MS - (now - lastEnergyRefillAt);
      const waitSeconds = Math.max(1, Math.ceil(waitMs / 1000));
      await client.query('ROLLBACK');
      return { ok:false, message: `Энергию можно восполнить через ${waitSeconds} сек.` };
    }
    await client.query('UPDATE users SET energy=$1, last_energy_refill_at=$2 WHERE tgid=$3', [capacity, now, tgid]);
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

async function createWithdrawalRequest(tgid, methodKey, optionId, rawDetails = {}, note = '', metadata = {}) {
  const option = getWithdrawalOption(methodKey, optionId);
  if (!option) {
    return { ok:false, message: 'Неверный вариант вывода' };
  }
  const normalized = normalizeWithdrawalDetails(methodKey, rawDetails || {});
  if (normalized.missing.length) {
    return { ok:false, message: 'Заполните обязательные поля', missing: normalized.missing };
  }

  const cleanedNote = sanitizeText(note, 1000);
  const metaUsername = metadata && metadata.username ? sanitizeText(metadata.username, 64) : null;
  const metaFullName = metadata && metadata.fullName ? sanitizeText(metadata.fullName, 128) : null;
  const metaDisplayName = metadata && metadata.displayName ? sanitizeText(metadata.displayName, 128) : null;

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const userRes = await client.query('SELECT name, scube, gcube, stars FROM users WHERE tgid = $1 FOR UPDATE', [tgid]);
    if (!userRes.rows.length) {
      await client.query('ROLLBACK');
      return { ok:false, message: 'Пользователь не найден' };
    }
    const user = userRes.rows[0];
    const scubeBefore = Number(user.scube || 0);
    if (scubeBefore < option.totalCost) {
      await client.query('ROLLBACK');
      return { ok:false, message: 'Недостаточно SCube', scube: scubeBefore };
    }
    const scubeAfter = scubeBefore - option.totalCost;
    await client.query('UPDATE users SET scube = $1 WHERE tgid = $2', [scubeAfter, tgid]);

    const userSnapshot = {
      name: user.name || null,
      displayName: metaDisplayName || null,
      username: metaUsername || null,
      fullName: metaFullName || null,
      scubeBefore,
      scubeAfter,
      gcube: Number(user.gcube || 0),
      stars: Number(user.stars || 0)
    };
    Object.keys(userSnapshot).forEach((key) => {
      if (userSnapshot[key] === null || userSnapshot[key] === undefined) {
        delete userSnapshot[key];
      }
    });

    const insertRes = await client.query(
      `INSERT INTO withdrawals (
        tgid, method, option_id, payout_label, base_cost, commission, total_cost, status, details, note, user_snapshot
      ) VALUES (
        $1,$2,$3,$4,$5,$6,$7,'pending',$8,$9,$10
      ) RETURNING *`,
      [
        tgid,
        methodKey,
        optionId,
        option.payoutLabel,
        option.baseCost,
        option.commission,
        option.totalCost,
        Object.keys(normalized.details).length ? normalized.details : null,
        cleanedNote || null,
        userSnapshot
      ]
    );

    await client.query('COMMIT');
    return { ok:true, withdrawal: mapWithdrawalRow(insertRes.rows[0]), scube: scubeAfter };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

async function getWithdrawalById(id) {
  const client = await pool.connect();
  try {
    const res = await client.query('SELECT * FROM withdrawals WHERE id = $1', [id]);
    if (!res.rows.length) return null;
    return mapWithdrawalRow(res.rows[0]);
  } finally {
    client.release();
  }
}

async function completeWithdrawal(id, adminData = {}) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const res = await client.query('SELECT * FROM withdrawals WHERE id = $1 FOR UPDATE', [id]);
    if (!res.rows.length) {
      await client.query('ROLLBACK');
      return { ok:false, reason: 'not_found' };
    }
    const row = res.rows[0];
    if (row.status !== 'pending') {
      await client.query('ROLLBACK');
      return { ok:false, reason: 'already_processed', status: row.status, withdrawal: mapWithdrawalRow(row) };
    }

    let successIndex = row.success_index;
    if (successIndex === null || successIndex === undefined) {
      const seqRes = await client.query("SELECT nextval('withdrawal_success_seq') AS seq");
      successIndex = Number(seqRes.rows[0].seq);
    }

    const adminUsername = adminData && adminData.username ? sanitizeText(adminData.username, 64) : null;
    const adminFullName = adminData && adminData.fullName ? sanitizeText(adminData.fullName, 128) : null;
    const adminComment = adminData && adminData.comment ? sanitizeText(adminData.comment, 500) : null;
    const adminTgid = adminData && adminData.tgid ? Number(adminData.tgid) : null;

    const updateRes = await client.query(
      `UPDATE withdrawals
         SET status = 'completed',
             admin_comment = $2,
             admin_tgid = $3,
             admin_username = $4,
             admin_fullname = $5,
             success_index = $6,
             user_snapshot = COALESCE(user_snapshot, '{}'::jsonb) || jsonb_build_object('completedAt', now()),
             updated_at = now()
       WHERE id = $1
       RETURNING *`,
      [id, adminComment || null, adminTgid, adminUsername, adminFullName, successIndex]
    );

    await client.query('COMMIT');
    return { ok:true, withdrawal: mapWithdrawalRow(updateRes.rows[0]) };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

async function declineWithdrawal(id, adminData = {}) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const res = await client.query('SELECT * FROM withdrawals WHERE id = $1 FOR UPDATE', [id]);
    if (!res.rows.length) {
      await client.query('ROLLBACK');
      return { ok:false, reason: 'not_found' };
    }
    const row = res.rows[0];
    if (row.status !== 'pending') {
      await client.query('ROLLBACK');
      return { ok:false, reason: 'already_processed', status: row.status, withdrawal: mapWithdrawalRow(row) };
    }

    const adminUsername = adminData && adminData.username ? sanitizeText(adminData.username, 64) : null;
    const adminFullName = adminData && adminData.fullName ? sanitizeText(adminData.fullName, 128) : null;
    const adminComment = adminData && adminData.comment ? sanitizeText(adminData.comment, 500) : null;
    const adminTgid = adminData && adminData.tgid ? Number(adminData.tgid) : null;

    const userRes = await client.query('SELECT scube FROM users WHERE tgid = $1 FOR UPDATE', [row.tgid]);
    if (!userRes.rows.length) {
      await client.query('ROLLBACK');
      return { ok:false, reason: 'user_not_found' };
    }
    const scubeBefore = Number(userRes.rows[0].scube || 0);
    const refund = Number(row.total_cost || 0);
    const scubeAfter = scubeBefore + refund;
    await client.query('UPDATE users SET scube = $1 WHERE tgid = $2', [scubeAfter, row.tgid]);

    const updateRes = await client.query(
      `UPDATE withdrawals
         SET status = 'declined',
             admin_comment = $2,
             admin_tgid = $3,
             admin_username = $4,
             admin_fullname = $5,
             user_snapshot = COALESCE(user_snapshot, '{}'::jsonb) || jsonb_build_object('refundedAt', now(), 'scubeAfterRefund', $6),
             updated_at = now()
       WHERE id = $1
       RETURNING *`,
      [id, adminComment || null, adminTgid, adminUsername, adminFullName, scubeAfter]
    );

    await client.query('COMMIT');
    return { ok:true, withdrawal: mapWithdrawalRow(updateRes.rows[0]), scube: scubeAfter };
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

// Daily streak helpers
function isSameDate(a, b){ return a && b && a.toISOString().slice(0,10) === b.toISOString().slice(0,10); }
function isYesterday(date){ if (!date) return false; const d = new Date(); d.setDate(d.getDate()-1); return date && date.toISOString().slice(0,10) === d.toISOString().slice(0,10); }

async function getDailyStreak(tgid){
  const client = await pool.connect();
  try {
    const res = await client.query('SELECT login_streak, last_login_reward FROM users WHERE tgid = $1', [tgid]);
    if (!res.rows.length) return { dayIndex: 0, claimedToday: false };
    const row = res.rows[0];
    const streak = Number(row.login_streak || 0);
    const last = row.last_login_reward ? new Date(row.last_login_reward) : null;
    const today = new Date();
    const claimedToday = last && isSameDate(last, today);
    let dayIndex;
    if (claimedToday) {
      dayIndex = ((streak - 1) % 7 + 7) % 7;
    } else if (isYesterday(last)) {
      dayIndex = (streak % 7);
    } else {
      dayIndex = 0;
    }
    return { dayIndex, claimedToday };
  } finally { client.release(); }
}

async function claimDailyReward(tgid){
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const res = await client.query('SELECT scube, login_streak, last_login_reward FROM users WHERE tgid = $1 FOR UPDATE', [tgid]);
    if (!res.rows.length) { await client.query('ROLLBACK'); throw new Error('User not found'); }
    let scube = Number(res.rows[0].scube || 0);
    const last = res.rows[0].last_login_reward ? new Date(res.rows[0].last_login_reward) : null;
    let streak = Number(res.rows[0].login_streak || 0);
    const today = new Date();
    if (last && isSameDate(last, today)) {
      await client.query('ROLLBACK');
      return { ok:false, message:'Награда за сегодня уже получена', scube };
    }
    if (!isYesterday(last)) {
      streak = 0;
    }
    streak += 1;
    const rewards = [10,50,100,125,150,175,200];
    const credited = rewards[((streak - 1) % 7 + 7) % 7];
    scube += credited;
    await client.query('UPDATE users SET scube=$1, login_streak=$2, last_login_reward=current_date WHERE tgid=$3', [scube, streak, tgid]);
    await client.query('COMMIT');
    return { ok:true, scube, credited, streak };
  } catch (err){ await client.query('ROLLBACK'); throw err; } finally { client.release(); }
}

module.exports = {
  init,
  ensureUser,
  getOrCreateUser,
  handleClick,
  exchange,
  buyUpgrade,
  claimReward,
  refillToFull,
  autoTick,
  setReferrer,
  getLeaderboard,
  tryReserveScube,
  creditScube,
  WITHDRAWAL_METHODS,
  getWithdrawalOption,
  createWithdrawalRequest,
  getWithdrawalById,
  completeWithdrawal,
  declineWithdrawal,
  getDailyStreak,
  claimDailyReward
};
