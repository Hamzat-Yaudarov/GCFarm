import { Telegraf, Markup } from 'telegraf';
import { ensureUser } from './db.js';

const token = process.env.TG_BOT_TOKEN;
export let bot = null;

export async function initBot(app) {
  if (!token) {
    console.warn('TG_BOT_TOKEN not set, bot disabled');
    return;
  }
  bot = new Telegraf(token);

  bot.start(async (ctx) => {
    try { await ensureUser(ctx.from); } catch {}
    const base = process.env.BASE_URL || 'https://example.com';
    const webAppUrl = `${base}/app`;
    const text = 'Добро пожаловать! Нажмите кнопку, чтобы открыть игру.';
    await ctx.reply(text, Markup.inlineKeyboard([
      [Markup.button.webApp('Открыть игру', webAppUrl)]
    ]));
  });

  bot.catch((err, ctx) => {
    console.error('Bot error', err, ctx.updateType);
  });

  const path = '/bot';
  app.use(bot.webhookCallback(path));
  app.get(path, (_req, res) => res.status(200).send('OK'));

  const base = process.env.BASE_URL;
  if (base) {
    const url = `${base}${path}`;
    try {
      await bot.telegram.setWebhook(url, { drop_pending_updates: true });
      console.log('Webhook set to', url);
    } catch (e) {
      console.error('Failed to set webhook', e);
    }
  } else {
    console.warn('BASE_URL not set, webhook not configured');
  }
}
