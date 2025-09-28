const { Telegraf, Markup } = require('telegraf');

async function initTelegram(app) {
  const token = process.env.TG_BOT_TOKEN;
  if (!token) {
    console.error('TG_BOT_TOKEN is required');
    return null;
  }
  const bot = new Telegraf(token);

  bot.start(async (ctx) => {
    const name = ctx.from?.first_name ? `, ${ctx.from.first_name}` : '';
    const url = `${process.env.BASE_URL || ''}/miniapp/`;
    await ctx.reply(
      `Добро пожаловать${name}! Жми кнопку ниже, чтобы открыть игру.`,
      Markup.inlineKeyboard([
        Markup.button.webApp('Открыть игру', url)
      ])
    );
  });

  try {
    if (process.env.BASE_URL) {
      const path = '/tg/webhook';
      await bot.telegram.setWebhook(`${process.env.BASE_URL}${path}`);
      app.use(path, bot.webhookCallback(path));
      console.log('Telegram webhook set');
    } else {
      await bot.launch();
      console.log('Telegram bot launched with long polling');
    }
  } catch (e) {
    console.error('Failed to set webhook, fallback to polling', e);
    await bot.launch();
  }

  process.once('SIGINT', () => bot.stop('SIGINT'));
  process.once('SIGTERM', () => bot.stop('SIGTERM'));

  return bot;
}

module.exports = { initTelegram };
