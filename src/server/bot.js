const express = require('express');
const { Telegraf } = require('telegraf');
const bodyParser = require('body-parser');
const path = require('path');
const crypto = require('crypto');
const db = require('./db');

const TG_BOT_TOKEN = process.env.TG_BOT_TOKEN;
const BASE_URL = process.env.BASE_URL || 'http://localhost:3000';
const PORT = process.env.PORT || 3000;
const ADSGRAM_SECRET = process.env.ADSGRAM_SECRET || 'c6a7a8b7cd30418d9844aebc37b6aaf2';
const ADSGRAM_INTERSTITIAL_ID = process.env.ADSGRAM_INTERSTITIAL_ID || 'int-15441';

if (!TG_BOT_TOKEN) {
  console.error('TG_BOT_TOKEN is not set');
}

const bot = new Telegraf(TG_BOT_TOKEN);

bot.start(async (ctx) => {
  const user = ctx.from || {};
  const firstName = user.first_name || 'игрок';
  const tgid = user.id;

  // Try to ensure user in DB, but do not block reply on DB errors
  try {
    if (tgid) await db.ensureUser(tgid, firstName || 'Player');
  } catch (dbErr) {
    console.error('DB ensureUser failed on /start', dbErr);
    // notify admin about DB issue (best effort)
    const adminId = process.env.ADMIN_ID;
    if (adminId) {
      try {
        await bot.telegram.sendMessage(adminId, `DB error on /start for ${tgid}: ${dbErr.message}`);
      } catch (notifyErr) {
        console.warn('Failed to notify admin about DB error', notifyErr);
      }
    }
  }

  const webAppUrl = `${BASE_URL}/miniapp?tgid=${tgid || ''}`;

  try {
    await ctx.reply(`Привет, ${firstName}! Добро пожаловать в игру. Нажми кнопку, чтобы открыть MiniApp.`, {
      reply_markup: {
        inline_keyboard: [[{ text: 'Открыть игру', web_app: { url: webAppUrl } }]]
      }
    });
  } catch (err) {
    console.error('Failed to send welcome message in /start', err);
    // fallback: try a simpler reply
    try { await ctx.reply('Добро пожаловать!'); } catch (e) { console.error('Fallback reply failed', e); }
  }
});

const app = express();
// capture raw body for signature verification
app.use(bodyParser.json({ verify: (req, res, buf) => { req.rawBody = buf ? buf.toString() : ''; } }));

// Serve miniapp static files
app.use('/miniapp/static', express.static(path.join(__dirname, '..', 'miniapp')));

// Serve miniapp page
app.get('/miniapp', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'miniapp', 'index.html'));
});

// API endpoints
app.get('/api/user/:tgid', async (req, res) => {
  const tgid = parseInt(req.params.tgid, 10);
  if (!tgid) return res.status(400).json({ error: 'Invalid tgid' });
  try {
    const user = await db.getOrCreateUser(tgid);
    res.json(user);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Internal error' });
  }
});

app.post('/api/user/:tgid/click', async (req, res) => {
  const tgid = parseInt(req.params.tgid, 10);
  if (!tgid) return res.status(400).json({ error: 'Invalid tgid' });
  try {
    const result = await db.handleClick(tgid);
    res.json(result);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Internal error' });
  }
});

// Exchange endpoint
app.post('/api/user/:tgid/exchange', async (req, res) => {
  const tgid = parseInt(req.params.tgid, 10);
  const { direction, units } = req.body || {};
  if (!tgid || !direction) return res.status(400).json({ error: 'Invalid params' });
  try {
    const result = await db.exchange(tgid, direction, Math.max(1, parseInt(units || 1, 10)));
    res.json(result);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Internal error' });
  }
});

// Buy upgrade
app.post('/api/user/:tgid/buy-upgrade', async (req, res) => {
  const tgid = parseInt(req.params.tgid, 10);
  const { type } = req.body || {};
  if (!tgid || !type) return res.status(400).json({ error: 'Invalid params' });
  try {
    const result = await db.buyUpgrade(tgid, type);
    res.json(result);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Internal error' });
  }
});

// Reward claim (manual button) or landing page
app.post('/api/user/:tgid/claim-reward', async (req, res) => {
  const tgid = parseInt(req.params.tgid, 10);
  const amount = parseInt(req.body.amount || 5, 10); // default 5 SCube
  if (!tgid) return res.status(400).json({ error: 'Invalid params' });
  try {
    const result = await db.claimReward(tgid, amount);
    res.json(result);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Internal error' });
  }
});

// Generic reward landing - accepts either tgid or userId as query
app.get('/reward', (req, res) => {
  const tgid = req.query.tgid || req.query.userId || '';
  res.send(`<!doctype html><html><head><meta charset="utf-8"><title>Reward</title></head><body><h2>Reward landing (placeholder)</h2><p>После просмотра рекламы нажмите кнопку, чтобы получить награду.</p><form method="post" action="/api/user/${tgid}/claim-reward"><input type="hidden" name="amount" value="5"><button type="submit">Забрать 5 SCube</button></form></body></html>`);
});

// AdsGram callback endpoint - verify signature and credit reward automatically
app.post('/adsgram/callback', async (req, res) => {
  try {
    const signatureHeader = req.headers['x-adsgram-signature'] || req.headers['x-signature'] || req.headers['signature'];
    const raw = req.rawBody || '';
    if (!signatureHeader) {
      console.warn('No signature header provided');
      return res.status(400).json({ ok:false, message: 'Missing signature' });
    }
    // compute HMAC-SHA256
    const hmac = crypto.createHmac('sha256', ADSGRAM_SECRET);
    hmac.update(raw);
    const expected = hmac.digest('hex');
    if (!crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(signatureHeader))) {
      console.warn('Signature mismatch', { expected, received: signatureHeader });
      return res.status(403).json({ ok:false, message: 'Invalid signature' });
    }

    // parse payload
    const payload = req.body || {};
    const userId = payload.userId || payload.tgid || req.query.userId || req.query.tgid;
    const amount = parseInt(payload.amount || payload.reward || 5, 10);
    const adUnit = payload.adUnit || payload.ad_unit || payload.adId || payload.adId || '';

    if (!userId) return res.status(400).json({ ok:false, message: 'Missing userId' });
    const tgid = parseInt(userId, 10);
    if (!tgid) return res.status(400).json({ ok:false, message: 'Invalid userId' });

    // Optionally verify adUnit matches expected interstitial id
    if (adUnit && ADSGRAM_INTERSTITIAL_ID && adUnit !== ADSGRAM_INTERSTITIAL_ID) {
      console.warn('Ad unit mismatch', { adUnit, expected: ADSGRAM_INTERSTITIAL_ID });
      // continue but note discrepancy
    }

    const result = await db.claimReward(tgid, amount);
    return res.json({ ok:true, credited: amount, scube: result.scube });
  } catch (err) {
    console.error('Error processing AdsGram callback', err);
    return res.status(500).json({ ok:false, message: 'Server error' });
  }
});

// Start express and set webhook for Telegraf if running in production environment with BASE_URL
(async () => {
  try {
    await db.init();

    app.listen(PORT, async () => {
      console.log(`Server listening on ${PORT}`);
      if (process.env.NODE_ENV === 'production') {
        try {
          await bot.telegram.setWebhook(`${BASE_URL}/telegram-webhook`);
          app.use(bot.webhookCallback('/telegram-webhook'));
          console.log('Webhook set for bot');
        } catch (err) {
          console.error('Failed to set webhook, falling back to polling', err);
          bot.launch();
        }
      } else {
        // Local/dev - polling
        bot.launch();
      }
    });
  } catch (err) {
    console.error('Failed to start server', err);
  }
})();

// Graceful shutdown
process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
