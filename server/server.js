const express = require('express');
const crypto = require('crypto');
const path = require('path');
const { initSchema, query } = require('./db');
const { verifyAndParseUser, ensureUser, getState, tap, exchange, upgradeCapacity, upgradeDaily, rewardScube } = require('./game');
const { initTelegram } = require('./telegram');

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.get('/health', (_req, res) => res.json({ ok: true }));

app.use('/miniapp', express.static(path.join(__dirname, '..', 'public', 'miniapp')));

function parseInitDataString(str) {
  const params = new URLSearchParams(str);
  const out = {};
  for (const [k, v] of params.entries()) out[k] = v;
  return out;
}

function verifyTelegramInitData(rawInitData) {
  if (!rawInitData) return null;
  const BOT_TOKEN = process.env.TG_BOT_TOKEN;
  try {
    const data = parseInitDataString(rawInitData);
    const hash = data.hash;
    delete data.hash;
    const sorted = Object.keys(data)
      .sort()
      .map((k) => `${k}=${data[k]}`)
      .join('\n');
    const secret = crypto
      .createHmac('sha256', 'WebAppData')
      .update(BOT_TOKEN)
      .digest();
    const check = crypto.createHmac('sha256', secret).update(sorted).digest('hex');
    if (check !== hash) return null;
    const user = data.user ? JSON.parse(data.user) : null;
    const auth_date = data.auth_date ? Number(data.auth_date) : 0;
    if (!user || !auth_date) return null;
    return { user, auth_date };
  } catch (e) {
    return null;
  }
}

async function authMiddleware(req, res, next) {
  const initData = req.query.initData || req.headers['x-telegram-init-data'] || req.body.initData;
  const verified = verifyTelegramInitData(String(initData || ''));
  if (!verified) return res.status(401).json({ error: 'invalid_init_data' });
  req.initDataUnsafe = { user: verified.user };
  const basic = verifyAndParseUser(req.initDataUnsafe);
  if (!basic) return res.status(401).json({ error: 'invalid_user' });
  req.userBasic = basic;
  await ensureUser(basic);
  next();
}

app.get('/api/state', authMiddleware, async (req, res) => {
  const state = await getState(req.userBasic.id);
  res.json({
    user: req.userBasic,
    state,
  });
});

app.post('/api/tap', authMiddleware, async (req, res) => {
  const result = await tap(req.userBasic.id);
  res.json(result);
});

app.post('/api/exchange', authMiddleware, async (req, res) => {
  const { direction, count } = req.body || {};
  const state = await exchange(req.userBasic.id, direction, count);
  if (!state) return res.status(400).json({ error: 'exchange_failed' });
  res.json({ state });
});

app.post('/api/upgrade', authMiddleware, async (req, res) => {
  const { type } = req.body || {};
  let state = null;
  if (type === 'capacity') state = await upgradeCapacity(req.userBasic.id);
  else if (type === 'daily') state = await upgradeDaily(req.userBasic.id);
  if (!state) return res.status(400).json({ error: 'upgrade_failed' });
  res.json({ state });
});

app.post('/api/reward', authMiddleware, async (req, res) => {
  const state = await rewardScube(req.userBasic.id);
  if (!state) return res.status(400).json({ error: 'reward_failed' });
  res.json({ state });
});

(async () => {
  await initSchema();
  await initTelegram(app);
  const PORT = process.env.PORT || 3000;
  app.listen(PORT, () => console.log(`Server on :${PORT}`));
})();
