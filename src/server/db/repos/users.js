const { pool } = require('../pool');

const DAILY_BASE = 400;
const DAILY_INCREMENT = 50;
const ENERGY_REFILL_COOLDOWN_MS = 60 * 1000;

function sanitizeText(value, maxLength = 255) {
  if (value === undefined || value === null) return '';
  const str = String(value).trim();
  if (!str) return '';
  return str.slice(0, maxLength);
}

function mapUser(row) {
  if (!row) return null;
  return {
    tgid: Number(row.tgid),
    name: row.name,
    scube: Number(row.scube),
    gcube: Number(row.gcube),
    stars: Number(row.stars || 0),
    vp: Number(row.vp || 0),
    tickets: Number(row.tickets || 0),
    energy: Number(row.energy),
    energy_capacity: Number(row.energy_capacity),
    daily_count: Number(row.daily_count),
    daily_limit_level: Number(row.daily_limit_level),
    last_reset: row.last_reset,
    last_refill: row.last_refill,
    auto_energy: Boolean(row.auto_energy),
    complaints: Number(row.complaints || 0)
  };
}

async function setReferrer(tgid, referrer) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    if (!tgid || !referrer || Number(tgid) === Number(referrer)) {
      await client.query('ROLLBACK');
      return { ok:false, message: 'Некорректный реферер' };
    }
    const curRes = await client.query('SELECT referror FROM users WHERE tgid=$1 FOR UPDATE', [tgid]);
    if (!curRes.rows.length) { await client.query('ROLLBACK'); return { ok:false, message:'User not found' }; }
    const already = curRes.rows[0].referror ? Number(curRes.rows[0].referror) : null;
    if (already) { await client.query('ROLLBACK'); return { ok:false, message:'Реферер уже установлен' }; }
    // Ensure referrer exists
    const refRes = await client.query('SELECT tgid FROM users WHERE tgid=$1 FOR UPDATE', [referrer]);
    if (!refRes.rows.length) { await client.query('ROLLBACK'); return { ok:false, message:'Реферер не найден' }; }
    // Store referrer id correctly
    await client.query('UPDATE users SET referror=$1, referral_tgid=$1 WHERE tgid=$2', [referrer, tgid]);
    await client.query('UPDATE users SET referral_count = COALESCE(referral_count,0) + 1 WHERE tgid=$1', [referrer]);
    await client.query('COMMIT');
    return { ok:true };
  } catch (err){ await client.query('ROLLBACK'); throw err; } finally { client.release(); }
}

async function ensureUser(tgid, name) {
  const client = await pool.connect();
  try {
    // Try to insert a fresh user and detect if it is a brand new account
    const insertRes = await client.query(
      `INSERT INTO users (tgid, name, scube, gcube, stars, energy, energy_capacity, daily_count, daily_limit_level, last_reset, last_refill, auto_energy)
       VALUES ($1,$2,0,0,0,50,50,0,0,current_date,current_date,false)
       ON CONFLICT (tgid) DO NOTHING
       RETURNING tgid`,
      [tgid, name]
    );
    if (insertRes.rows.length) {
      return { inserted: true };
    }
    // Existing user: update name only
    await client.query('UPDATE users SET name = $2 WHERE tgid = $1', [tgid, name]);
    return { inserted: false };
  } finally {
    client.release();
  }
}

async function getOrCreateUser(tgid) {
  const client = await pool.connect();
  try {
    const res = await client.query('SELECT * FROM users WHERE tgid = $1', [tgid]);
    const today = new Date().toISOString().slice(0,10);

    async function buildUser(row) {
      if (!row) return null;
      const mapped = mapUser(row);
      if (!mapped) return null;
      return mapped;
    }

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
        return await buildUser(updated.rows[0]);
      }
      return await buildUser(user);
    }

    await client.query('INSERT INTO users (tgid, name, scube, gcube, stars, energy, energy_capacity, daily_count, daily_limit_level, last_reset, last_refill, auto_energy) VALUES ($1,$2,0,0,0,50,50,0,0,current_date,current_date,false)', [tgid, `Player ${tgid}`]);
    return await getOrCreateUser(tgid);
  } finally {
    client.release();
  }
}

async function handleClick(tgid) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const res = await client.query('SELECT scube, energy, daily_count, daily_limit_level, energy_capacity, referror, referral_bonus FROM users WHERE tgid = $1 FOR UPDATE', [tgid]);
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

    // Apply own updates
    await client.query('UPDATE users SET scube = $1, energy = $2, daily_count = $3, clicks_total = clicks_total + 1 WHERE tgid = $4', [newScube, newEnergy, newDaily, tgid]);

    // Referral 10% accumulation to referrer. referral_bonus stores leftover hundredths (0..99)
    const parentId = user.referror ? Number(user.referror) : null;
    if (parentId) {
      const PERCENT = 10; // 10%
      let carry = Number(user.referral_bonus || 0); // hundredths
      // compute fractional units to add (in hundredths)
      const deltaHundredths = Math.round((1 * PERCENT)); // for 1 SCube click, 10 hundredths
      // since click grants 1 SCube, add deltaHundredths
      carry += deltaHundredths;
      const toGrant = Math.floor(carry / 100);
      const leftover = carry % 100;
      if (toGrant > 0) {
        await client.query('UPDATE users SET scube = scube + $1, referral_earned = COALESCE(referral_earned,0) + $1 WHERE tgid = $2', [toGrant, parentId]);
      }
      await client.query('UPDATE users SET referral_bonus = $1 WHERE tgid = $2', [leftover, tgid]);
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
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    // determine mode
    let from, to, amount;
    if (typeof arg2 === 'string' && (arg2 === 'scube_to_gcube' || arg2 === 'gcube_to_scube')) {
      const directionLegacy = arg2;
      const units = arg3 || 1;
      if (directionLegacy === 'scube_to_gcube') { from = 'scube'; to = 'gcube'; amount = Number(units); }
      else { from = 'gcube'; to = 'scube'; amount = Number(units); }
    }
    if (typeof arg1 === 'string' && typeof arg2 === 'string') {
      from = String(arg1).toLowerCase();
      to = String(arg2).toLowerCase();
      amount = Math.max(0, parseInt(arg3 || 0, 10));
    }
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
      energy_capacity += 25;
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
    const res = await client.query('SELECT scube, last_reward_at, last_reward_ad_at, referror, referral_bonus FROM users WHERE tgid = $1 FOR UPDATE', [tgid]);
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

    // Referral: credit 10% only for clicks and tasks (exclude ads)
    if (source !== 'ad') {
      const parentId = user.referror ? Number(user.referror) : null;
      if (parentId) {
        const PERCENT = 10; // 10%
        // referral_bonus stored as hundredths
        let carry = Number(user.referral_bonus || 0);
        // add credit * percent (in hundredths)
        const delta = Math.round(credit * PERCENT);
        carry += delta;
        const toGrant = Math.floor(carry / 100);
        const leftover = carry % 100;
        if (toGrant > 0) {
          await client.query('UPDATE users SET scube = scube + $1, referral_earned = COALESCE(referral_earned,0) + $1 WHERE tgid = $2', [toGrant, parentId]);
        }
        await client.query('UPDATE users SET referral_bonus = $1 WHERE tgid = $2', [leftover, tgid]);
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

async function creditRewardGeneric(tgid, rewardType, amount, source = 'task', options = {}) {
  const client = await pool.connect();
  const col = String(rewardType || '').toLowerCase();
  const valid = ['scube','vp','tickets','stars','gcube'];
  if (!valid.includes(col)) return { ok:false, message:'Invalid reward type' };
  const add = Math.max(0, Math.round(Number(amount) || 0));
  try {
    await client.query('BEGIN');
    const userRes = await client.query('SELECT scube, vp, tickets, stars, gcube, tasks_completed FROM users WHERE tgid=$1 FOR UPDATE', [tgid]);
    if (!userRes.rows.length) { await client.query('ROLLBACK'); throw new Error('User not found'); }
    const row = userRes.rows[0];
    const now = new Date();
    const next = {
      scube: Number(row.scube || 0),
      vp: Number(row.vp || 0),
      tickets: Number(row.tickets || 0),
      stars: Number(row.stars || 0),
      gcube: Number(row.gcube || 0)
    };
    next[col] += add;
    const sets = ['scube','vp','tickets','stars','gcube'].map((k,i)=> `${k}=$${i+1}`).join(', ');
    const args = [next.scube, next.vp, next.tickets, next.stars, next.gcube, tgid];
    // tasks_completed only for task source
    if (source === 'task') {
      await client.query(`UPDATE users SET ${sets}, last_reward_at=$7, tasks_completed = tasks_completed + 1 WHERE tgid=$6`, [...args, now]);
    } else {
      await client.query(`UPDATE users SET ${sets}, last_reward_at=$7 WHERE tgid=$6`, [...args, now]);
    }
    await client.query('COMMIT');
    return { ok:true, balances: next };
  } catch (err) { await client.query('ROLLBACK'); throw err; } finally { client.release(); }
}

async function getEffectiveEarned(tgid){
  const client = await pool.connect();
  try {
    const u = await client.query('SELECT clicks_total FROM users WHERE tgid=$1', [tgid]);
    const clicks = u.rows.length ? Number(u.rows[0].clicks_total || 0) : 0;
    const ev = await client.query('SELECT COALESCE(SUM(amount),0) AS s FROM reward_events WHERE tgid=$1', [tgid]);
    const ads = ev.rows.length ? Number(ev.rows[0].s || 0) : 0;
    return clicks + ads;
  } finally { client.release(); }
}

async function getAdminStats(){
  const client = await pool.connect();
  try {
    const usersRow = await client.query('SELECT COUNT(*)::bigint AS c, COALESCE(SUM(scube),0) AS scube, COALESCE(SUM(vp),0) AS vp, COALESCE(SUM(tickets),0) AS tickets, COALESCE(SUM(gcube),0) AS gcube, COALESCE(SUM(stars),0) AS stars, COALESCE(SUM(clicks_total),0) AS clicks, COALESCE(SUM(tasks_completed),0) AS tasks FROM users');
    const wd = await client.query('SELECT status, COUNT(*)::bigint AS c FROM withdrawals GROUP BY status');
    const byStatus = {}; wd.rows.forEach(r=> byStatus[r.status||'unknown']= Number(r.c||0));
    return {
      users: Number(usersRow.rows[0].c||0),
      totals: {
        scube: Number(usersRow.rows[0].scube||0),
        vp: Number(usersRow.rows[0].vp||0),
        tickets: Number(usersRow.rows[0].tickets||0),
        gcube: Number(usersRow.rows[0].gcube||0),
        stars: Number(usersRow.rows[0].stars||0)
      },
      activity: {
        clicks: Number(usersRow.rows[0].clicks||0),
        tasks: Number(usersRow.rows[0].tasks||0)
      },
      withdrawals: byStatus
    };
  } finally { client.release(); }
}

async function getReferralInfo(tgid){
  const client = await pool.connect();
  try {
    const res = await client.query('SELECT referral_count, referral_earned FROM users WHERE tgid=$1', [tgid]);
    if (!res.rows.length) return { count: 0, earned: 0 };
    const row = res.rows[0];
    return { count: Number(row.referral_count || 0), earned: Number(row.referral_earned || 0) };
  } finally { client.release(); }
}

module.exports = {
  sanitizeText,
  mapUser,
  ensureUser,
  getOrCreateUser,
  handleClick,
  exchange,
  buyUpgrade,
  claimReward,
  refillToFull,
  autoTick,
  tryReserveScube,
  creditScube,
  getDailyStreak,
  claimDailyReward,
  getLeaderboard,
  creditRewardGeneric,
  getEffectiveEarned,
  getAdminStats,
  setReferrer,
  getReferralInfo
};
