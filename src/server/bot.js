const express = require('express');
const bodyParser = require('body-parser');
const path = require('path');
const createAuth = require('./lib/auth');
const db = require('./db');
const { createBot } = require('./telegraf');
const { attachAuthRoutes } = require('./routes/auth');
const { attachUserRoutes } = require('./routes/users');
const { attachGameRoutes } = require('./routes/games');
const { attachMiniappRoutes } = require('./routes/miniapp');
const { attachAdminRoutes } = require('./routes/admin');
const { attachWithdrawalRoutes } = require('./routes/withdrawals');
const { attachAdsgramRoutes } = require('./routes/adsgram');
const { attachSubgramRoutes } = require('./routes/subgram');
const { attachCustomTaskRoutes } = require('./routes/tasks');

const TG_BOT_TOKEN = process.env.TG_BOT_TOKEN || '';
const PORT = process.env.PORT || 3000;
const BASE_URL = process.env.BASE_URL || '';
const BOT_USERNAME = process.env.BOT_USERNAME || '';
const BOT_WEBAPP_PATH = process.env.BOT_WEBAPP_PATH || '';
const ADSGRAM_SECRET = process.env.ADSGRAM_SECRET || '';

const app = express();
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

// attach DB to app locals for routes that may use it
app.locals.db = db;

// create auth
const auth = createAuth(TG_BOT_TOKEN);

// create telegraf bot integration
let telegraf = null;
if (TG_BOT_TOKEN) {
  try {
    telegraf = createBot(TG_BOT_TOKEN, db, { ADMIN_ID: process.env.ADMIN_ID || '', BASE_URL, WITHDRAW_ADMIN_CHAT: process.env.WITHDRAW_ADMIN_CHAT || '', WITHDRAW_SUCCESS_CHAT: process.env.WITHDRAW_SUCCESS_CHAT || '' });
    // expose bot instance for other routes
  } catch (e) {
    console.error('Failed to create telegraf bot', e);
  }
}

// Run DB migrations on startup (best-effort)
(async ()=>{
  try { await db.init(); console.log('DB migrations applied'); } catch(e){ console.error('Migrations failed', e); }
})();

// Attach routes
attachAuthRoutes(app, { auth });
attachUserRoutes(app, { db, auth });
attachGameRoutes(app, { db, auth });
attachMiniappRoutes(app, { BASE_URL, BOT_USERNAME, BOT_WEBAPP_PATH });
attachAdminRoutes(app, { db, auth });
attachWithdrawalRoutes(app, { db, auth, telegraf });
attachAdsgramRoutes(app, { db, ADSGRAM_SECRET, ADSGRAM_INTERSTITIAL_ID: process.env.ADSGRAM_INTERSTITIAL_ID });
attachSubgramRoutes(app, { subgram: null, auth });
attachCustomTaskRoutes(app, { db, auth, telegraf });

// static assets root
app.use('/static', express.static(path.join(__dirname, '..', 'public')));

app.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
});

module.exports = app;
