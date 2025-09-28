import express from 'express';
import crypto from 'crypto';
import { ensureUser, pool, resetDailyIfNeeded, saveEnergyState, toClient } from './db.js';

export const api = express.Router();

function parseInitData(initData) {
  const params = new URLSearchParams(initData);
  const userStr = params.get('user');
  const authDate = params.get('auth_date');
  const hash = params.get('hash');
  return { params, userStr, authDate, hash };
}

function verifyTelegramInitData(initData) {
  try {
    const { params, hash } = parseInitData(initData);
    const botToken = process.env.TG_BOT_TOKEN || '';
    const secret = crypto.createHash('sha256').update(botToken).digest();
    const check = [];
    for (const [key, value] of params.entries()) {
      if (key === 'hash') continue;
      check.push(`${key}=${value}`);
    }
    check.sort();
    const dataCheckString = check.join('\n');
    const hmac = crypto.createHmac('sha256', secret).update(dataCheckString).digest('hex');
    const ok = hmac === hash;
    try { console.log('[initData] hash=', String(hash).slice(0,8), 'user=', params.get('user') ? params.get('user').slice(0,40) : null, 'verify=', ok); } catch (e) {}
    return ok;
  } catch (err) {
    console.log('[initData] verification error', err && err.message);
    return false;
  }
}

async function authMiddleware(req, res, next) {
  const initData = req.method === 'GET' ? (req.query.initData || req.headers['x-init-data']) : (req.body.initData || req.headers['x-init-data']);
  if (!initData || typeof initData !== 'string' || !verifyTelegramInitData(initData)) {
    return res.status(401).json({ error: 'unauthorized' });
  }
  const { userStr } = parseInitData(initData);
  const tgUser = JSON.parse(userStr);
  req.tgUser = tgUser;
  next();
}

api.get('/state', authMiddleware, async (req, res) => {
  const user = await ensureUser(req.tgUser);
  return res.json({ ok: true, user: toClient(user) });
});

api.post('/tap', express.json(), authMiddleware, async (req, res) => {
  const id = BigInt(req.tgUser.id).toString();
  const { rows } = await pool.query('select * from users where tg_id=$1', [id]);
  let user = rows[0];
  user = await resetDailyIfNeeded(user);
  if (Number(user.energy_current) <= 0) {
    await saveEnergyState(user);
    return res.json({ ok: false, reason: 'no_energy', user: toClient(user) });
  }
  if (Number(user.daily_collected) >= Number(user.daily_limit)) {
    await saveEnergyState(user);
    return res.json({ ok: false, reason: 'daily_limit', user: toClient(user) });
  }
  const newEnergy = Number(user.energy_current) - 1;
  await pool.query(
    `update users set scube=scube+1, energy_current=$2, daily_collected=daily_collected+1 where tg_id=$1`,
    [id, newEnergy]
  );
  const after = await pool.query('select * from users where tg_id=$1', [id]);
  return res.json({ ok: true, user: toClient(after.rows[0]) });
});

api.post('/exchange', express.json(), authMiddleware, async (req, res) => {
  const amount = Math.max(0, Math.floor(Number(req.body.amount || 0)));
  if (!amount) return res.status(400).json({ ok: false, error: 'invalid_amount' });
  const id = BigInt(req.tgUser.id).toString();
  const { rows } = await pool.query('select scube, gcube from users where tg_id=$1', [id]);
  const u = rows[0];
  if (Number(u.scube) < amount) return res.status(400).json({ ok: false, error: 'not_enough_scube' });
  await pool.query('update users set scube=scube-$2, gcube=gcube+$2 where tg_id=$1', [id, amount]);
  const after = await pool.query('select * from users where tg_id=$1', [id]);
  return res.json({ ok: true, user: toClient(after.rows[0]) });
});

api.post('/upgrade/capacity', express.json(), authMiddleware, async (req, res) => {
  const id = BigInt(req.tgUser.id).toString();
  const { rows } = await pool.query('select scube, energy_capacity from users where tg_id=$1', [id]);
  const u = rows[0];
  if (Number(u.scube) < 100) return res.status(400).json({ ok: false, error: 'not_enough_scube' });
  await pool.query('update users set scube=scube-100, energy_capacity=energy_capacity+50 where tg_id=$1', [id]);
  const after = await pool.query('select * from users where tg_id=$1', [id]);
  return res.json({ ok: true, user: toClient(after.rows[0]) });
});

api.post('/upgrade/daily_limit', express.json(), authMiddleware, async (req, res) => {
  const id = BigInt(req.tgUser.id).toString();
  const { rows } = await pool.query('select scube, daily_limit, limit_level from users where tg_id=$1', [id]);
  const u = rows[0];
  const level = Number(u.limit_level) || 0;
  const cost = 90 + level * 10;
  if (Number(u.scube) < cost) return res.status(400).json({ ok: false, error: 'not_enough_scube', cost });
  await pool.query('update users set scube=scube-$2, daily_limit=daily_limit+50, limit_level=limit_level+1 where tg_id=$1', [id, cost]);
  const after = await pool.query('select * from users where tg_id=$1', [id]);
  return res.json({ ok: true, cost, user: toClient(after.rows[0]) });
});

function adminAuth(req, res, next) {
  const admin = process.env.ADMIN_ID;
  const provided = req.headers['x-admin-id'];
  if (!admin || provided !== admin) return res.status(401).json({ ok: false, error: 'admin_only' });
  next();
}

api.post('/admin/rewards', express.json(), adminAuth, async (req, res) => {
  const { slug, reward_type = 'energy', reward_amount = 0 } = req.body || {};
  if (!slug) return res.status(400).json({ ok: false, error: 'missing_slug' });
  await pool.query(
    `insert into ad_rewards(slug, reward_type, reward_amount)
     values ($1,$2,$3)
     on conflict (slug) do update set reward_type=excluded.reward_type, reward_amount=excluded.reward_amount`,
    [slug, reward_type, Math.max(0, Number(reward_amount))]
  );
  res.json({ ok: true });
});

api.post('/admin/tasks', express.json(), adminAuth, async (req, res) => {
  const { slug, url = null, reward_type = 'energy', reward_amount = 0, active = true } = req.body || {};
  if (!slug) return res.status(400).json({ ok: false, error: 'missing_slug' });
  await pool.query(
    `insert into tasks(slug, url, reward_type, reward_amount, active)
     values ($1,$2,$3,$4,$5)
     on conflict (slug) do update set url=excluded.url, reward_type=excluded.reward_type, reward_amount=excluded.reward_amount, active=excluded.active`,
    [slug, url, reward_type, Math.max(0, Number(reward_amount)), !!active]
  );
  res.json({ ok: true });
});
