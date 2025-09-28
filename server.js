const express = require('express');
const path = require('path');
const crypto = require('crypto');
const { Telegraf } = require('telegraf');
const { Pool } = require('pg');

const PORT = process.env.PORT || 3001;
const TG_BOT_TOKEN = process.env.TG_BOT_TOKEN;
const BASE_URL = process.env.BASE_URL || '';
const BOT_USERNAME = process.env.BOT_USERNAME || '';
const ADMIN_ID = process.env.ADMIN_ID || '';
const NODE_ENV = process.env.NODE_ENV || 'development';
const NEON_DATABASE_URL = process.env.NEON_DATABASE_URL;
const EXCHANGE_RATE = Number(process.env.EXCHANGE_RATE || '0.02');

if (!TG_BOT_TOKEN) {
  console.warn('TG_BOT_TOKEN is not set. Bot will not start.');
}

const app = express();
app.use(express.json());
app.use('/public', express.static(path.join(__dirname, 'public')));

// Serve MiniApp at /app
app.get('/app', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'app.html'));
});

// Healthcheck
app.get('/health', (req, res) => {
  res.json({ ok: true, env: NODE_ENV });
});

// Database setup
const pool = new Pool({ connectionString: NEON_DATABASE_URL });

async function ensureTables() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id BIGSERIAL PRIMARY KEY,
      telegram_id BIGINT UNIQUE NOT NULL,
      username TEXT,
      first_name TEXT,
      last_name TEXT,
      photo_url TEXT,
      scube BIGINT NOT NULL DEFAULT 0,
      gcube BIGINT NOT NULL DEFAULT 0,
      energy_capacity INT NOT NULL DEFAULT 50,
      energy_current INT NOT NULL DEFAULT 50,
      daily_limit_level INT NOT NULL DEFAULT 0,
      daily_limit_capacity INT NOT NULL DEFAULT 250,
      daily_earned_scube INT NOT NULL DEFAULT 0,
      energy_updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      daily_reset_at DATE NOT NULL DEFAULT CURRENT_DATE,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    );
  `);
}

function nowUtc() {
  return new Date();
}

function computeEnergyUpdate(u) {
  const capacity = Number(u.energy_capacity);
  const current = Number(u.energy_current);
  const last = new Date(u.energy_updated_at);
  const now = nowUtc();
  const elapsedSec = Math.floor((now - last) / 1000);
  const regenPerSec = 1 / 4; // 1 energy per 4s
  let regen = Math.floor(elapsedSec * regenPerSec);
  let newCurrent = current;
  if (regen > 0) {
    newCurrent = Math.min(capacity, current + regen);
  }
  const changed = newCurrent !== current;
  return { newCurrent, changed };
}

function needsDailyReset(u) {
  const lastReset = new Date(u.daily_reset_at);
  const today = new Date();
  // Reset if stored date is before today (UTC date)
  const last = new Date(Date.UTC(lastReset.getUTCFullYear(), lastReset.getUTCMonth(), lastReset.getUTCDate()));
  const cur = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()));
  return last.getTime() < cur.getTime();
}

async function upsertUserFromInitData(client, user) {
  const telegram_id = BigInt(user.id);
  const username = user.username || null;
  const first_name = user.first_name || null;
  const last_name = user.last_name || null;
  const photo_url = user.photo_url || null;
  const { rows } = await client.query('SELECT * FROM users WHERE telegram_id = $1', [telegram_id]);
  if (rows.length === 0) {
    const ins = await client.query(
      `INSERT INTO users (telegram_id, username, first_name, last_name, photo_url)
       VALUES ($1,$2,$3,$4,$5)
       RETURNING *`,
      [telegram_id, username, first_name, last_name, photo_url]
    );
    return ins.rows[0];
  } else {
    const upd = await client.query(
      `UPDATE users SET username=$2, first_name=$3, last_name=$4, photo_url=$5, updated_at=NOW() WHERE telegram_id=$1 RETURNING *`,
      [telegram_id, username, first_name, last_name, photo_url]
    );
    return upd.rows[0];
  }
}

function getTelegramSecretKey(token) {
  return crypto.createHash('sha256').update(token).digest();
}

function parseAndValidateInitData(initData) {
  if (!initData || !TG_BOT_TOKEN) return null;
  const url = new URLSearchParams(initData);
  const hash = url.get('hash');
  url.delete('hash');
  const pairs = [];
  url.forEach((v, k) => pairs.push(`${k}=${v}`));
  pairs.sort();
  const dataCheckString = pairs.join('\n');
  const secretKey = getTelegramSecretKey(TG_BOT_TOKEN);
  const hmac = crypto.createHmac('sha256', secretKey).update(dataCheckString).digest('hex');
  if (hmac !== hash) return null;
  const userStr = url.get('user');
  let user = null;
  try { user = userStr ? JSON.parse(userStr) : null; } catch(e) { user = null; }
  return { user };
}

async function withUser(req, res, next) {
  const initData = req.headers['x-telegram-init-data'] || req.query.initData || (req.body && req.body.initData);
  const parsed = parseAndValidateInitData(initData);
  if (!parsed || !parsed.user) return res.status(401).json({ error: 'unauthorized' });
  req.tgUser = parsed.user;
  next();
}

async function touchUser(client, tgUser) {
  // Upsert and apply regen/daily reset; return fresh row
  await upsertUserFromInitData(client, tgUser);
  const { rows } = await client.query('SELECT * FROM users WHERE telegram_id=$1 FOR UPDATE', [BigInt(tgUser.id)]);
  let u = rows[0];
  let didChange = false;
  if (needsDailyReset(u)) {
    u.daily_earned_scube = 0;
    await client.query('UPDATE users SET daily_earned_scube=0, daily_reset_at=CURRENT_DATE, updated_at=NOW() WHERE telegram_id=$1', [BigInt(tgUser.id)]);
    didChange = true;
  }
  const { newCurrent, changed } = computeEnergyUpdate(u);
  if (changed) {
    await client.query('UPDATE users SET energy_current=$2, energy_updated_at=NOW(), updated_at=NOW() WHERE telegram_id=$1', [BigInt(tgUser.id), newCurrent]);
    didChange = true;
  }
  if (didChange) {
    const r2 = await client.query('SELECT * FROM users WHERE telegram_id=$1', [BigInt(tgUser.id)]);
    u = r2.rows[0];
  }
  return u;
}

function packUser(u) {
  return {
    scube: Number(u.scube),
    gcube: Number(u.gcube),
    energy: { current: Number(u.energy_current), capacity: Number(u.energy_capacity) },
    dailyLimit: { level: Number(u.daily_limit_level), capacity: Number(u.daily_limit_capacity), earned: Number(u.daily_earned_scube) }
  };
}

// APIs
app.get('/api/me', withUser, async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const u = await touchUser(client, req.tgUser);
    await client.query('COMMIT');
    res.json({ ok: true, user: packUser(u) });
  } catch (e) {
    await client.query('ROLLBACK');
    console.error(e);
    res.status(500).json({ ok: false });
  } finally {
    client.release();
  }
});

app.post('/api/tap', withUser, async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    let u = await touchUser(client, req.tgUser);
    if (u.energy_current <= 0) {
      await client.query('ROLLBACK');
      return res.status(400).json({ ok: false, error: 'no_energy' });
    }
    if (u.daily_earned_scube >= u.daily_limit_capacity) {
      await client.query('ROLLBACK');
      return res.status(400).json({ ok: false, error: 'daily_limit' });
    }
    const r = await client.query(
      `UPDATE users SET scube = scube + 1, daily_earned_scube = daily_earned_scube + 1, energy_current = energy_current - 1, energy_updated_at = NOW(), updated_at = NOW() WHERE telegram_id=$1 RETURNING *`,
      [BigInt(req.tgUser.id)]
    );
    await client.query('COMMIT');
    u = r.rows[0];
    res.json({ ok: true, user: packUser(u) });
  } catch (e) {
    await client.query('ROLLBACK');
    console.error(e);
    res.status(500).json({ ok: false });
  } finally {
    client.release();
  }
});

app.post('/api/upgrade/energy', withUser, async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    let u = await touchUser(client, req.tgUser);
    const cost = 100; // 100 SCube for +50 capacity
    if (u.scube < cost) {
      await client.query('ROLLBACK');
      return res.status(400).json({ ok: false, error: 'insufficient_scube' });
    }
    const r = await client.query(
      `UPDATE users SET scube = scube - $2, energy_capacity = energy_capacity + 50, updated_at = NOW() WHERE telegram_id=$1 RETURNING *`,
      [BigInt(req.tgUser.id), cost]
    );
    await client.query('COMMIT');
    u = r.rows[0];
    res.json({ ok: true, user: packUser(u) });
  } catch (e) {
    await client.query('ROLLBACK');
    console.error(e);
    res.status(500).json({ ok: false });
  } finally { client.release(); }
});

app.post('/api/upgrade/daily-limit', withUser, async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    let u = await touchUser(client, req.tgUser);
    const level = Number(u.daily_limit_level);
    const cost = 90 + level * 10; // per spec
    if (u.scube < cost) {
      await client.query('ROLLBACK');
      return res.status(400).json({ ok: false, error: 'insufficient_scube' });
    }
    const r = await client.query(
      `UPDATE users SET scube = scube - $2, daily_limit_level = daily_limit_level + 1, daily_limit_capacity = daily_limit_capacity + 50, updated_at = NOW() WHERE telegram_id=$1 RETURNING *`,
      [BigInt(req.tgUser.id), cost]
    );
    await client.query('COMMIT');
    u = r.rows[0];
    res.json({ ok: true, user: packUser(u) });
  } catch (e) {
    await client.query('ROLLBACK');
    console.error(e);
    res.status(500).json({ ok: false });
  } finally { client.release(); }
});

app.post('/api/exchange', withUser, async (req, res) => {
  const { amount } = req.body || {};
  const amt = Math.max(0, Math.floor(Number(amount || 0)));
  if (!Number.isFinite(amt) || amt <= 0) return res.status(400).json({ ok: false, error: 'invalid_amount' });
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    let u = await touchUser(client, req.tgUser);
    if (u.scube < amt) {
      await client.query('ROLLBACK');
      return res.status(400).json({ ok: false, error: 'insufficient_scube' });
    }
    const gcAdd = Math.floor(amt * EXCHANGE_RATE);
    const r = await client.query(
      `UPDATE users SET scube = scube - $2, gcube = gcube + $3, updated_at = NOW() WHERE telegram_id=$1 RETURNING *`,
      [BigInt(req.tgUser.id), amt, gcAdd]
    );
    await client.query('COMMIT');
    u = r.rows[0];
    res.json({ ok: true, user: packUser(u) });
  } catch (e) {
    await client.query('ROLLBACK');
    console.error(e);
    res.status(500).json({ ok: false });
  } finally { client.release(); }
});

// Debug webhook info (admin-only via query)
app.get('/debug/webhook', async (req, res) => {
  try {
    if (!ADMIN_ID || String(req.query.admin) !== String(ADMIN_ID)) return res.status(403).json({ ok: false });
    if (!bot) return res.json({ ok: false, error: 'bot_not_initialized' });
    const info = await bot.telegram.getWebhookInfo();
    const me = await bot.telegram.getMe();
    res.json({ ok: true, info, me, expected: `${BASE_URL || ''}/bot/webhook` });
  } catch (e) {
    res.status(500).json({ ok: false });
  }
});

// Telegram bot
let bot = null;
if (TG_BOT_TOKEN) {
  bot = new Telegraf(TG_BOT_TOKEN);
  bot.start(async (ctx) => {
    const name = ctx.from?.first_name ? `, ${ctx.from.first_name}` : '';
    await ctx.reply(
      `Привет${name}! Добро пожаловать в GC Farm. Нажми кнопку ниже, чтобы открыть игру.`,
      {
        reply_markup: {
          inline_keyboard: [[
            { text: 'Открыть игру', web_app: { url: `${BASE_URL}/app` } }
          ]]
        }
      }
    );
  });

  const webhookPath = '/bot/webhook';
  app.use(webhookPath, bot.webhookCallback(webhookPath));

  (async () => {
    await ensureTables();
    app.listen(PORT, async () => {
      console.log(`Server listening on ${PORT}`);
      if (NODE_ENV === 'production' && BASE_URL) {
        try {
          const set = await bot.telegram.setWebhook(`${BASE_URL}${webhookPath}`);
          console.log('Webhook set:', set);
        } catch (e) {
          console.error('Failed to set webhook', e);
        }
      } else {
        try {
          await bot.telegram.deleteWebhook();
          bot.launch().then(() => console.log('Bot launched (polling)'));
        } catch (e) {
          console.error('Failed to launch bot', e);
        }
      }
    });
  })();
} else {
  (async () => {
    await ensureTables();
    app.listen(PORT, () => console.log(`Server listening on ${PORT}`));
  })();
}

process.once('SIGINT', () => bot && bot.stop('SIGINT'));
process.once('SIGTERM', () => bot && bot.stop('SIGTERM'));
