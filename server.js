const express = require('express');
const path = require('path');
const { Telegraf } = require('telegraf');
const { Pool } = require('pg');
const crypto = require('crypto');

const PORT = process.env.PORT || 3000;
const TG_BOT_TOKEN = process.env.TG_BOT_TOKEN || '';
const BASE_URL = process.env.BASE_URL || `http://localhost:${PORT}`;
const NEON_DATABASE_URL = process.env.NEON_DATABASE_URL || '';

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// --- Database ---
let pool = null;
if (NEON_DATABASE_URL) {
  pool = new Pool({ connectionString: NEON_DATABASE_URL });
}

async function ensureSchema() {
  if (!pool) return;
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      telegram_id BIGINT PRIMARY KEY,
      username TEXT,
      first_name TEXT,
      last_name TEXT,
      avatar_url TEXT,
      scube INTEGER NOT NULL DEFAULT 0,
      gcube INTEGER NOT NULL DEFAULT 0,
      energy INTEGER NOT NULL DEFAULT 50,
      energy_capacity INTEGER NOT NULL DEFAULT 50,
      energy_updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      daily_limit INTEGER NOT NULL DEFAULT 250,
      daily_used_today INTEGER NOT NULL DEFAULT 0,
      daily_updated_at DATE NOT NULL DEFAULT CURRENT_DATE,
      limit_level INTEGER NOT NULL DEFAULT 0,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
}

// --- Telegram WebApp initData validation ---
function validateInitDataHash(initData, botToken) {
  if (!initData || !botToken) return false;
  const parsed = new URLSearchParams(initData);
  const hash = parsed.get('hash');
  if (!hash) return false;
  const data = [];
  for (const [key, value] of parsed.entries()) {
    if (key === 'hash') continue;
    data.push(`${key}=${value}`);
  }
  data.sort();
  const dataCheckString = data.join('\n');
  const secretKey = crypto.createHmac('sha256', 'WebAppData').update(botToken).digest();
  const computedHash = crypto.createHmac('sha256', secretKey).update(dataCheckString).digest('hex');
  return computedHash === hash;
}

function getUserFromInitData(initData) {
  const parsed = new URLSearchParams(initData || '');
  const userStr = parsed.get('user');
  if (!userStr) return null;
  try {
    return JSON.parse(userStr);
  } catch (e) {
    return null;
  }
}

// --- Game mechanics helpers ---
const ENERGY_REGEN_MS = 4000; // 1 energy per 4s
const ENERGY_STEP = 1; // 1 SCube per tap
const START_ENERGY = 50;
const START_CAPACITY = 50;
const START_DAILY_LIMIT = 250;

async function withTransaction(fn) {
  if (!pool) throw new Error('Database not configured');
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}

function applyRegeneration(row) {
  const now = Date.now();
  const updatedAt = new Date(row.energy_updated_at).getTime();
  const elapsed = Math.max(0, now - updatedAt);
  const regen = Math.floor(elapsed / ENERGY_REGEN_MS);
  let energy = row.energy;
  if (regen > 0) {
    energy = Math.min(row.energy_capacity, energy + regen);
  }
  // daily reset
  const todayStr = new Date().toISOString().slice(0, 10);
  const isSameDay = row.daily_updated_at && todayStr === new Date(row.daily_updated_at).toISOString().slice(0, 10);
  const dailyUsedToday = isSameDay ? row.daily_used_today : 0;
  return {
    ...row,
    energy,
    energy_updated_at: new Date(now).toISOString(),
    daily_used_today: dailyUsedToday,
    daily_updated_at: isSameDay ? row.daily_updated_at : todayStr,
  };
}

function sanitizeUserResponse(row) {
  return {
    telegram_id: String(row.telegram_id),
    username: row.username || null,
    first_name: row.first_name || null,
    last_name: row.last_name || null,
    avatar_url: row.avatar_url || null,
    scube: row.scube,
    gcube: row.gcube,
    energy: row.energy,
    energy_capacity: row.energy_capacity,
    daily_limit: row.daily_limit,
    daily_used_today: row.daily_used_today,
    limit_level: row.limit_level,
  };
}

// --- API ---
app.post('/api/init', async (req, res) => {
  try {
    const { initData, avatar_url, username, first_name, last_name } = req.body || {};
    if (!validateInitDataHash(initData, TG_BOT_TOKEN)) {
      return res.status(401).json({ error: 'invalid_init_data' });
    }
    const userObj = getUserFromInitData(initData);
    if (!userObj || !userObj.id) return res.status(400).json({ error: 'no_user' });
    if (!pool) return res.status(503).json({ error: 'database_not_configured' });

    const userId = BigInt(userObj.id);

    const row = await withTransaction(async (client) => {
      const { rows } = await client.query('SELECT * FROM users WHERE telegram_id=$1', [userId.toString()]);
      if (rows.length === 0) {
        const insert = await client.query(
          `INSERT INTO users (
            telegram_id, username, first_name, last_name, avatar_url,
            scube, gcube, energy, energy_capacity, energy_updated_at,
            daily_limit, daily_used_today, daily_updated_at, limit_level
          ) VALUES ($1,$2,$3,$4,$5,0,0,$6,$7,NOW(),$8,0,CURRENT_DATE,0)
          RETURNING *`,
          [
            userId.toString(),
            username || userObj.username || null,
            first_name || userObj.first_name || null,
            last_name || userObj.last_name || null,
            avatar_url || userObj.photo_url || null,
            START_ENERGY,
            START_CAPACITY,
            START_DAILY_LIMIT,
          ]
        );
        return insert.rows[0];
      }
      // update profile fields if changed
      const current = rows[0];
      const newRow = applyRegeneration(current);
      const merged = {
        username: username || userObj.username || current.username,
        first_name: first_name || userObj.first_name || current.first_name,
        last_name: last_name || userObj.last_name || current.last_name,
        avatar_url: avatar_url || userObj.photo_url || current.avatar_url,
      };
      const update = await client.query(
        `UPDATE users SET 
          username=$2, first_name=$3, last_name=$4, avatar_url=$5,
          energy=$6, energy_updated_at=$7,
          daily_used_today=$8, daily_updated_at=$9, updated_at=NOW()
        WHERE telegram_id=$1 RETURNING *`,
        [
          userId.toString(),
          merged.username,
          merged.first_name,
          merged.last_name,
          merged.avatar_url,
          newRow.energy,
          newRow.energy_updated_at,
          newRow.daily_used_today,
          newRow.daily_updated_at,
        ]
      );
      return update.rows[0];
    });

    return res.json({ ok: true, user: sanitizeUserResponse(row) });
  } catch (e) {
    return res.status(500).json({ error: 'server_error' });
  }
});

app.get('/api/state', async (req, res) => {
  try {
    const initData = req.query.initData || '';
    if (!validateInitDataHash(initData, TG_BOT_TOKEN)) {
      return res.status(401).json({ error: 'invalid_init_data' });
    }
    if (!pool) return res.status(503).json({ error: 'database_not_configured' });
    const userObj = getUserFromInitData(initData);
    const userId = BigInt(userObj.id);

    const row = await withTransaction(async (client) => {
      const { rows } = await client.query('SELECT * FROM users WHERE telegram_id=$1', [userId.toString()]);
      if (rows.length === 0) throw new Error('user_not_found');
      const regen = applyRegeneration(rows[0]);
      const updated = await client.query(
        `UPDATE users SET energy=$2, energy_updated_at=$3, daily_used_today=$4, daily_updated_at=$5, updated_at=NOW()
         WHERE telegram_id=$1 RETURNING *`,
        [userId.toString(), regen.energy, regen.energy_updated_at, regen.daily_used_today, regen.daily_updated_at]
      );
      return updated.rows[0];
    });

    return res.json({ ok: true, user: sanitizeUserResponse(row) });
  } catch (e) {
    return res.status(500).json({ error: 'server_error' });
  }
});

app.post('/api/click', async (req, res) => {
  try {
    const { initData } = req.body || {};
    if (!validateInitDataHash(initData, TG_BOT_TOKEN)) return res.status(401).json({ error: 'invalid_init_data' });
    if (!pool) return res.status(503).json({ error: 'database_not_configured' });
    const userObj = getUserFromInitData(initData);
    const userId = BigInt(userObj.id);

    const row = await withTransaction(async (client) => {
      const { rows } = await client.query('SELECT * FROM users WHERE telegram_id=$1 FOR UPDATE', [userId.toString()]);
      if (rows.length === 0) throw new Error('user_not_found');
      let u = applyRegeneration(rows[0]);
      if (u.energy < ENERGY_STEP) throw new Error('not_enough_energy');
      if (u.daily_used_today >= u.daily_limit) throw new Error('daily_limit_reached');
      u.energy -= ENERGY_STEP;
      u.scube += 1;
      u.daily_used_today += 1;
      const update = await client.query(
        `UPDATE users SET scube=$2, energy=$3, energy_updated_at=$4, daily_used_today=$5, daily_updated_at=$6, updated_at=NOW()
         WHERE telegram_id=$1 RETURNING *`,
        [userId.toString(), u.scube, u.energy, new Date().toISOString(), u.daily_used_today, u.daily_updated_at]
      );
      return update.rows[0];
    });

    return res.json({ ok: true, user: sanitizeUserResponse(row) });
  } catch (e) {
    const code = e && e.message;
    if (code === 'not_enough_energy' || code === 'daily_limit_reached') {
      return res.status(400).json({ error: code });
    }
    return res.status(500).json({ error: 'server_error' });
  }
});

app.post('/api/exchange', async (req, res) => {
  try {
    const { initData, amount } = req.body || {};
    if (!validateInitDataHash(initData, TG_BOT_TOKEN)) return res.status(401).json({ error: 'invalid_init_data' });
    if (!pool) return res.status(503).json({ error: 'database_not_configured' });
    const qty = Math.max(0, Math.floor(Number(amount || 0)));
    if (qty <= 0) return res.status(400).json({ error: 'invalid_amount' });
    const userObj = getUserFromInitData(initData);
    const userId = BigInt(userObj.id);

    const row = await withTransaction(async (client) => {
      const { rows } = await client.query('SELECT * FROM users WHERE telegram_id=$1 FOR UPDATE', [userId.toString()]);
      if (rows.length === 0) throw new Error('user_not_found');
      const u = rows[0];
      if (u.scube < qty) throw new Error('not_enough_scube');
      const update = await client.query(
        `UPDATE users SET scube=$2, gcube=$3, updated_at=NOW() WHERE telegram_id=$1 RETURNING *`,
        [userId.toString(), u.scube - qty, u.gcube + qty]
      );
      return update.rows[0];
    });

    return res.json({ ok: true, user: sanitizeUserResponse(row) });
  } catch (e) {
    const code = e && e.message;
    if (code === 'not_enough_scube') return res.status(400).json({ error: code });
    return res.status(500).json({ error: 'server_error' });
  }
});

app.post('/api/upgrade/capacity', async (req, res) => {
  try {
    const { initData } = req.body || {};
    if (!validateInitDataHash(initData, TG_BOT_TOKEN)) return res.status(401).json({ error: 'invalid_init_data' });
    if (!pool) return res.status(503).json({ error: 'database_not_configured' });
    const userObj = getUserFromInitData(initData);
    const userId = BigInt(userObj.id);

    const COST = 100;
    const INC = 50;

    const row = await withTransaction(async (client) => {
      const { rows } = await client.query('SELECT * FROM users WHERE telegram_id=$1 FOR UPDATE', [userId.toString()]);
      if (rows.length === 0) throw new Error('user_not_found');
      let u = applyRegeneration(rows[0]);
      if (u.scube < COST) throw new Error('not_enough_scube');
      const newCapacity = u.energy_capacity + INC;
      const update = await client.query(
        `UPDATE users SET scube=$2, energy_capacity=$3, energy=$4, energy_updated_at=$5, updated_at=NOW() WHERE telegram_id=$1 RETURNING *`,
        [userId.toString(), u.scube - COST, newCapacity, Math.min(newCapacity, u.energy), new Date().toISOString()]
      );
      return update.rows[0];
    });

    return res.json({ ok: true, user: sanitizeUserResponse(row) });
  } catch (e) {
    const code = e && e.message;
    if (code === 'not_enough_scube') return res.status(400).json({ error: code });
    return res.status(500).json({ error: 'server_error' });
  }
});

app.post('/api/upgrade/daily', async (req, res) => {
  try {
    const { initData } = req.body || {};
    if (!validateInitDataHash(initData, TG_BOT_TOKEN)) return res.status(401).json({ error: 'invalid_init_data' });
    if (!pool) return res.status(503).json({ error: 'database_not_configured' });
    const userObj = getUserFromInitData(initData);
    const userId = BigInt(userObj.id);

    const row = await withTransaction(async (client) => {
      const { rows } = await client.query('SELECT * FROM users WHERE telegram_id=$1 FOR UPDATE', [userId.toString()]);
      if (rows.length === 0) throw new Error('user_not_found');
      const u = rows[0];
      const nextLevel = u.limit_level + 1;
      const cost = 90 + u.limit_level * 10;
      if (u.scube < cost) throw new Error('not_enough_scube');
      const newLimit = u.daily_limit + 50;
      const update = await client.query(
        `UPDATE users SET scube=$2, daily_limit=$3, limit_level=$4, updated_at=NOW() WHERE telegram_id=$1 RETURNING *`,
        [userId.toString(), u.scube - cost, newLimit, nextLevel]
      );
      return update.rows[0];
    });

    return res.json({ ok: true, user: sanitizeUserResponse(row) });
  } catch (e) {
    const code = e && e.message;
    if (code === 'not_enough_scube') return res.status(400).json({ error: code });
    return res.status(500).json({ error: 'server_error' });
  }
});

// Optional avatar endpoint via Bot API (best-effort)
app.get('/api/avatar', async (req, res) => {
  try {
    if (!TG_BOT_TOKEN) return res.status(503).json({ error: 'bot_not_configured' });
    const userId = req.query.user_id;
    if (!userId) return res.status(400).json({ error: 'no_user' });
    const tg = new Telegraf(TG_BOT_TOKEN);
    const photos = await tg.telegram.getUserProfilePhotos(userId, 0, 1);
    if (!photos.total_count) return res.json({ ok: true, url: null });
    const fileId = photos.photos[0][0].file_id;
    const file = await tg.telegram.getFile(fileId);
    const url = `https://api.telegram.org/file/bot${TG_BOT_TOKEN}/${file.file_path}`;
    return res.json({ ok: true, url });
  } catch (_e) {
    return res.json({ ok: true, url: null });
  }
});

// --- Static files (MiniApp) ---
app.use(express.static(path.join(__dirname, 'public')));
app.get('/app', (_req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// --- Telegram Bot ---
let bot = null;
if (TG_BOT_TOKEN) {
  bot = new Telegraf(TG_BOT_TOKEN);
  bot.start((ctx) => {
    const url = `${BASE_URL}/app`;
    return ctx.reply(
      'Добро пожаловать в GC Farm! Нажмите, чтобы открыть игру.',
      {
        reply_markup: {
          inline_keyboard: [[{ text: 'Открыть игру', web_app: { url } }]],
        },
      }
    );
  });
}

(async () => {
  try {
    await ensureSchema();

    const server = app.listen(PORT, () => {
      // server started
    });

    if (bot) {
      await bot.launch();
      const shutdown = async () => {
        try { await bot.stop('SIGTERM'); } catch (_) {}
        server.close(() => process.exit(0));
      };
      process.once('SIGINT', shutdown);
      process.once('SIGTERM', shutdown);
    }
  } catch (_e) {
    // fail silently to avoid crashing preview
  }
})();
