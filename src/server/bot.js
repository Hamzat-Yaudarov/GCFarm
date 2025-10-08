const express = require('express');
const bodyParser = require('body-parser');
const path = require('path');
const db = require('./db');
const subgram = require('./subgram');

// ENV
const TG_BOT_TOKEN = process.env.TG_BOT_TOKEN;
const BASE_URL = process.env.BASE_URL || 'http://localhost:3000';
const BOT_USERNAME = process.env.BOT_USERNAME || '';
const BOT_WEBAPP_PATH = process.env.BOT_WEBAPP_PATH || '';
const PORT = process.env.PORT || 3000;
const ADSGRAM_SECRET = process.env.ADSGRAM_SECRET || 'c6a7a8b7cd30418d9844aebc37b6aaf2';
const ADSGRAM_INTERSTITIAL_ID = process.env.ADSGRAM_INTERSTITIAL_ID || 'int-15539';
const WITHDRAW_ADMIN_CHAT = process.env.WITHDRAW_ADMIN_CHAT || '@zazarara2';
const WITHDRAW_SUCCESS_CHAT = process.env.WITHDRAW_SUCCESS_CHAT || '@zazarara3';
const ADMIN_ID = process.env.ADMIN_ID || '';

if (!TG_BOT_TOKEN) { console.error('TG_BOT_TOKEN is not set'); }

// App
const app = express();
app.use(bodyParser.json({ verify: (req, res, buf) => { req.rawBody = buf ? buf.toString() : ''; } }));

// Store db in app locals for route helpers that may need it
app.locals.db = db;

// Auth helpers
const createAuth = require('./lib/auth');
const auth = createAuth(TG_BOT_TOKEN);

// Telegraf bot
const { createBot } = require('./telegraf');
const { bot, fetchTelegramProfile, notifyAdminWithdrawal } = createBot(TG_BOT_TOKEN, db, { BASE_URL, ADMIN_ID, WITHDRAW_ADMIN_CHAT, WITHDRAW_SUCCESS_CHAT });

// Routes
const { attachMiniappRoutes } = require('./routes/miniapp');
const { attachAuthRoutes } = require('./routes/auth');
const { attachUserRoutes } = require('./routes/users');
const { attachGameRoutes } = require('./routes/games');
const { attachWithdrawalRoutes } = require('./routes/withdrawals');
const { attachSubgramRoutes } = require('./routes/subgram');
const { attachAdsgramRoutes } = require('./routes/adsgram');
const { attachAdminRoutes } = require('./routes/admin');
const { attachCustomTaskRoutes } = require('./routes/tasks');
const { attachReferralRoutes } = require('./routes/referrals');

attachMiniappRoutes(app, { BASE_URL, BOT_USERNAME, BOT_WEBAPP_PATH });
attachAuthRoutes(app, { auth });
attachUserRoutes(app, { db, auth });
attachReferralRoutes(app, { db, auth, BOT_USERNAME, BASE_URL });
attachGameRoutes(app, { db, auth });
attachWithdrawalRoutes(app, { db, auth, telegraf: { fetchTelegramProfile, notifyAdminWithdrawal } });
attachSubgramRoutes(app, { subgram, auth });
attachAdsgramRoutes(app, { db, ADSGRAM_SECRET, ADSGRAM_INTERSTITIAL_ID });
attachAdminRoutes(app, { db, auth });
attachCustomTaskRoutes(app, { db, auth, telegraf: { bot } });

// Start
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
        bot.launch();
      }
    });
  } catch (err) { console.error('Failed to start server', err); }
})();

process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
