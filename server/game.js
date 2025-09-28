const { query } = require('./db');

function verifyAndParseUser(initDataUnsafe) {
  if (!initDataUnsafe || !initDataUnsafe.user || !initDataUnsafe.user.id) return null;
  const u = initDataUnsafe.user;
  return {
    id: Number(u.id),
    first_name: u.first_name || null,
    last_name: u.last_name || null,
    username: u.username || null,
    photo_url: u.photo_url || null,
  };
}

async function ensureUser(user) {
  await query(
    `insert into users (id, first_name, last_name, username, photo_url)
     values ($1,$2,$3,$4,$5)
     on conflict (id) do update set
       first_name = excluded.first_name,
       last_name = excluded.last_name,
       username = excluded.username,
       photo_url = excluded.photo_url`,
    [user.id, user.first_name, user.last_name, user.username, user.photo_url]
  );
}

function regenEnergyRow(row, now = new Date()) {
  const capacity = Number(row.energy_capacity);
  const lastEnergyAt = new Date(row.last_energy_at);
  const diffSec = Math.floor((now.getTime() - lastEnergyAt.getTime()) / 1000);
  const perSec = 1 / 4; // 1 energy per 4 seconds
  let gained = Math.floor(diffSec * perSec);
  if (gained < 0) gained = 0;
  let energy = Number(row.energy);
  const newEnergy = Math.min(capacity, energy + gained);
  let nextLast = lastEnergyAt;
  if (newEnergy !== energy) {
    const usedGainedSec = (newEnergy - energy) * 4;
    nextLast = new Date(lastEnergyAt.getTime() + usedGainedSec * 1000);
  }
  const lastReset = row.last_daily_reset ? new Date(row.last_daily_reset) : new Date();
  const todayStr = new Date(now.toDateString());
  const shouldResetDaily = lastReset.toDateString() !== todayStr.toDateString();
  return {
    energy: newEnergy,
    last_energy_at: nextLast,
    daily_used: shouldResetDaily ? 0 : Number(row.daily_used),
    last_daily_reset: shouldResetDaily ? todayStr : lastReset,
  };
}

async function applyRegenAndPersist(userId) {
  const q = await query('select * from users where id = $1', [userId]);
  if (q.rowCount === 0) return null;
  const row = q.rows[0];
  const upd = regenEnergyRow(row);
  if (
    upd.energy !== row.energy ||
    upd.daily_used !== row.daily_used ||
    upd.last_energy_at.toISOString() !== new Date(row.last_energy_at).toISOString() ||
    upd.last_daily_reset.toDateString() !== new Date(row.last_daily_reset).toDateString()
  ) {
    await query(
      `update users set energy=$2, last_energy_at=$3, daily_used=$4, last_daily_reset=$5 where id=$1`,
      [userId, upd.energy, upd.last_energy_at, upd.daily_used, upd.last_daily_reset]
    );
  }
  const refreshed = await query('select * from users where id = $1', [userId]);
  return refreshed.rows[0];
}

async function getState(userId) {
  const row = await applyRegenAndPersist(userId);
  if (!row) return null;
  return serializeState(row);
}

function serializeState(row) {
  return {
    balances: {
      scube: Number(row.scube),
      gcube: Number(row.gcube),
    },
    energy: {
      current: Number(row.energy),
      capacity: Number(row.energy_capacity),
      regenIntervalSec: 4,
    },
    daily: {
      used: Number(row.daily_used),
      limit: Number(row.daily_limit),
    },
  };
}

async function tap(userId) {
  const q = await query('select * from users where id = $1', [userId]);
  if (q.rowCount === 0) return null;
  const row0 = q.rows[0];
  const row = regenEnergyRow(row0);
  const can = row.energy > 0 && row.daily_used < row0.daily_limit;
  if (!can) {
    // persist regen-only changes if any
    if (
      row.energy !== row0.energy ||
      row.daily_used !== row0.daily_used ||
      row.last_energy_at.toISOString() !== new Date(row0.last_energy_at).toISOString() ||
      row.last_daily_reset.toDateString() !== new Date(row0.last_daily_reset).toDateString()
    ) {
      await query(
        `update users set energy=$2, last_energy_at=$3, daily_used=$4, last_daily_reset=$5 where id=$1`,
        [userId, row.energy, row.last_energy_at, row.daily_used, row.last_daily_reset]
      );
    }
    const after = await query('select * from users where id=$1', [userId]);
    return { ok: false, state: serializeState(after.rows[0]) };
  }
  const now = new Date();
  await query(
    `update users set scube = scube + 1, energy = $2, last_energy_at=$3, daily_used=$4, last_daily_reset=$5 where id=$1`,
    [userId, row.energy - 1, now, row.daily_used + 1, row.last_daily_reset]
  );
  const after = await query('select * from users where id=$1', [userId]);
  return { ok: true, state: serializeState(after.rows[0]) };
}

async function exchange(userId, direction, count = 1) {
  const c = Math.max(1, Number(count) || 1);
  if (direction === 'scube_to_gcube') {
    const cost = 50 * c;
    const res = await query(
      `update users set scube = scube - $2, gcube = gcube + $3 where id=$1 and scube >= $2 returning *`,
      [userId, cost, c]
    );
    if (res.rowCount === 0) return null;
    return serializeState(res.rows[0]);
  }
  if (direction === 'gcube_to_scube') {
    const gain = 50 * c;
    const res = await query(
      `update users set gcube = gcube - $2, scube = scube + $3 where id=$1 and gcube >= $2 returning *`,
      [userId, c, gain]
    );
    if (res.rowCount === 0) return null;
    return serializeState(res.rows[0]);
  }
  return null;
}

async function upgradeCapacity(userId) {
  const cost = 100;
  const res = await query(
    `update users set scube = scube - $2, energy_capacity = energy_capacity + 50 where id=$1 and scube >= $2 returning *`,
    [userId, cost]
  );
  if (res.rowCount === 0) return null;
  return serializeState(res.rows[0]);
}

async function upgradeDaily(userId) {
  // cost = 90 + level*10, level derived from (daily_limit - 250)/50
  const cur = await query('select daily_limit, scube from users where id=$1', [userId]);
  if (cur.rowCount === 0) return null;
  const row = cur.rows[0];
  const level = Math.max(0, Math.floor((Number(row.daily_limit) - 250) / 50));
  const cost = 90 + level * 10;
  if (Number(row.scube) < cost) return null;
  const res = await query(
    `update users set scube = scube - $2, daily_limit = daily_limit + 50 where id=$1 returning *`,
    [userId, cost]
  );
  if (res.rowCount === 0) return null;
  return serializeState(res.rows[0]);
}

async function rewardScube(userId) {
  const now = new Date();
  // minimal cooldown 10s to prevent accidental double credit
  const cur = await query('select last_reward_at from users where id=$1', [userId]);
  if (cur.rowCount === 0) return null;
  const last = cur.rows[0].last_reward_at ? new Date(cur.rows[0].last_reward_at) : null;
  if (last && now.getTime() - last.getTime() < 5000) {
    const st = await getState(userId);
    return st;
  }
  const res = await query(
    `update users set scube = scube + 20, last_reward_at = $2 where id=$1 returning *`,
    [userId, now]
  );
  if (res.rowCount === 0) return null;
  return serializeState(res.rows[0]);
}

module.exports = { verifyAndParseUser, ensureUser, getState, tap, exchange, upgradeCapacity, upgradeDaily, rewardScube };
