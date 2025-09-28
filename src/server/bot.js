const express = require('express');
const { Telegraf } = require('telegraf');
const bodyParser = require('body-parser');
const path = require('path');
const db = require('./db');

const TG_BOT_TOKEN = process.env.TG_BOT_TOKEN;
const BASE_URL = process.env.BASE_URL || 'http://localhost:3000';
const PORT = process.env.PORT || 3000;

if (!TG_BOT_TOKEN) {
  console.error('TG_BOT_TOKEN is not set');
}

const bot = new Telegraf(TG_BOT_TOKEN);

bot.start(async (ctx) => {
  try {
    const user = ctx.from;
    // Create or ensure user exists in DB
    await db.ensureUser(user.id, user.first_name || 'Player');

    const webAppUrl = `${BASE_URL}/miniapp?tgid=${user.id}`;

    await ctx.reply(`Привет, ${user.first_name || 'игрок'}! Добро пожаловать в игру. Нажми кнопку, чтобы открыть MiniApp.`, {
      reply_markup: {
        inline_keyboard: [[{ text: 'Открыть игру', web_app: { url: webAppUrl } }]]
      }
    });
  } catch (err) {
    console.error('Error in /start handler', err);
    ctx.reply('Произошла ошибка, попробуйте позже.');
  }
});

const app = express();
app.use(bodyParser.json());

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

app.get('/reward', (req, res) => {
  res.send(`<!doctype html><html><head><meta charset="utf-8"><title>Reward</title></head><body><h2>Reward landing (placeholder)</h2><p>Этот URL используется для интеграции с AdsGram и возврата наград.</p></body></html>`);
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
