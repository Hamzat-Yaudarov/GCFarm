import pg from 'pg';

const { Pool } = pg;

const connectionString = process.env.NEON_DATABASE_URL;
export const pool = new Pool({ connectionString, ssl: { rejectUnauthorized: false } });

export async function initDb() {
  await pool.query(`
    create table if not exists users (
      tg_id bigint primary key,
      username text,
      first_name text,
      last_name text,
      photo_url text,
      scube integer not null default 0,
      gcube integer not null default 0,
      energy_capacity integer not null default 50,
      energy_current integer not null default 50,
      energy_last_ts bigint not null default (extract(epoch from now()) * 1000)::bigint,
      daily_limit integer not null default 250,
      daily_collected integer not null default 0,
      daily_reset_date date not null default (now() at time zone 'utc')::date,
      limit_level integer not null default 0
    );
  `);
}

export function regenEnergy(state) {
  const now = Date.now();
  const elapsedMs = Math.max(0, now - Number(state.energy_last_ts || 0));
  const gained = Math.floor(elapsedMs / 4000);
  let energy = Number(state.energy_current);
  const capacity = Number(state.energy_capacity);
  if (gained > 0 && energy < capacity) {
    energy = Math.min(capacity, energy + gained);
    state.energy_current = energy;
    state.energy_last_ts = now - (elapsedMs % 4000);
  }
  return state;
}

async function maybeUpdatePhoto(tgId) {
  try {
    const token = process.env.TG_BOT_TOKEN;
    if (!token) return;
    const photosRes = await fetch(`https://api.telegram.org/bot${token}/getUserProfilePhotos?user_id=${tgId}&limit=1`);
    const photos = await photosRes.json();
    if (!photos.ok || !photos.result || photos.result.total_count === 0) return;
    const sizes = photos.result.photos[0];
    const best = sizes[sizes.length - 1];
    const fileId = best.file_id;
    const fileRes = await fetch(`https://api.telegram.org/bot${token}/getFile?file_id=${fileId}`);
    const file = await fileRes.json();
    if (!file.ok || !file.result || !file.result.file_path) return;
    const url = `https://api.telegram.org/file/bot${token}/${file.result.file_path}`;
    await pool.query('update users set photo_url=$2 where tg_id=$1', [tgId, url]);
  } catch {}
}

export async function ensureUser(tgUser) {
  const id = BigInt(tgUser.id).toString();
  const { rows } = await pool.query('select * from users where tg_id=$1', [id]);
  let user = rows[0];
  if (!user) {
    await pool.query(
      `insert into users (tg_id, username, first_name, last_name, photo_url)
       values ($1,$2,$3,$4,$5)
       on conflict (tg_id) do nothing`,
      [id, tgUser.username || null, tgUser.first_name || null, tgUser.last_name || null, tgUser.photo_url || null]
    );
    const res = await pool.query('select * from users where tg_id=$1', [id]);
    user = res.rows[0];
  } else {
    await pool.query(
      `update users set username=$2, first_name=$3, last_name=$4, photo_url=$5 where tg_id=$1`,
      [id, tgUser.username || null, tgUser.first_name || null, tgUser.last_name || null, tgUser.photo_url || null]
    );
    const res = await pool.query('select * from users where tg_id=$1', [id]);
    user = res.rows[0];
  }
  user = await resetDailyIfNeeded(user);
  if (!user.photo_url) { maybeUpdatePhoto(id).catch(() => {}); }
  return user;
}

export async function resetDailyIfNeeded(user) {
  const today = new Date();
  const todayUtc = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()));
  const last = user.daily_reset_date ? new Date(user.daily_reset_date + 'T00:00:00Z') : todayUtc;
  if (last.getTime() !== todayUtc.getTime()) {
    await pool.query(
      `update users set daily_collected=0, daily_reset_date=$2 where tg_id=$1`,
      [user.tg_id, todayUtc.toISOString().slice(0,10)]
    );
    const res = await pool.query('select * from users where tg_id=$1', [user.tg_id]);
    return res.rows[0];
  }
  return user;
}

export async function saveEnergyState(user) {
  await pool.query(
    `update users set energy_current=$2, energy_last_ts=$3 where tg_id=$1`,
    [user.tg_id, user.energy_current, user.energy_last_ts]
  );
}

export function toClient(user) {
  return {
    tg_id: user.tg_id,
    username: user.username,
    first_name: user.first_name,
    last_name: user.last_name,
    photo_url: user.photo_url,
    scube: Number(user.scube),
    gcube: Number(user.gcube),
    energy_capacity: Number(user.energy_capacity),
    energy_current: Number(user.energy_current),
    energy_last_ts: Number(user.energy_last_ts),
    daily_limit: Number(user.daily_limit),
    daily_collected: Number(user.daily_collected),
    limit_level: Number(user.limit_level)
  };
}

export async function initAdsSchema() {
  await pool.query(`
    create table if not exists ad_rewards (
      slug text primary key,
      reward_type text not null default 'energy',
      reward_amount integer not null default 0,
      created_at timestamptz not null default now()
    );
    create table if not exists tasks (
      slug text primary key,
      url text,
      reward_type text not null default 'energy',
      reward_amount integer not null default 0,
      active boolean not null default true,
      created_at timestamptz not null default now()
    );
  `);
}
