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
  await query(
    `update users set scube = scube + 1, energy = $2, last_energy_at=$3, daily_used=$4, last_daily_reset=$5 where id=$1`,
    [userId, row.energy - 1, row.last_energy_at, row.daily_used + 1, row.last_daily_reset]
  );
  const after = await query('select * from users where id=$1', [userId]);
  return { ok: true, state: serializeState(after.rows[0]) };
}

module.exports = { verifyAndParseUser, ensureUser, getState, tap };
