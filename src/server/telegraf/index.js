const { Telegraf } = require('telegraf');

function isAuthorizedAdmin(tgid, ADMIN_IDS){ if (!tgid) return false; if (!ADMIN_IDS.length) return true; return ADMIN_IDS.includes(String(tgid)); }
function resolveAdminLabel(adminData){ if (!adminData) return 'Администратор'; if (adminData.fullName) return adminData.fullName; if (adminData.username) return `@${adminData.username}`; if (adminData.tgid) return `ID ${adminData.tgid}`; return 'Администратор'; }
function resolveMethodLabel(methodKey, db){ const method = db.WITHDRAWAL_METHODS && db.WITHDRAWAL_METHODS[methodKey]; if (method && method.label) return method.label; return methodKey; }

async function fetchTelegramProfile(bot, tgid){
  try {
    if (!tgid) return null;
    const chat = await bot.telegram.getChat(tgid);
    if (!chat) return null;
    const first = chat.first_name || '';
    const last = chat.last_name || '';
    const fullName = `${first} ${last}`.trim();
    const displayName = fullName || chat.username || null;
    return { username: chat.username || null, fullName: fullName || null, displayName };
  } catch (err) { return null; }
}

async function notifyAdminWithdrawal(bot, chats, db, withdrawal, user, profileMeta){
  if (!withdrawal) return;
  try {
    const methodConfig = db.WITHDRAWAL_METHODS && db.WITHDRAWAL_METHODS[withdrawal.method];
    const fields = methodConfig && Array.isArray(methodConfig.fields) ? methodConfig.fields : [];
    const fieldLabelMap = new Map(fields.map((field) => [field.id, field.label]));
    const displayName = (profileMeta && profileMeta.displayName) || user.name || `Игрок ${withdrawal.tgid}`;
    const usernamePart = profileMeta && profileMeta.username ? `, @${profileMeta.username}` : '';
    const lines = [
      `Заявка #${withdrawal.id} на вывод средств`,
      '',
      `Игрок: ${displayName} (ID: ${withdrawal.tgid}${usernamePart})`
    ];
    if (profileMeta && profileMeta.fullName && profileMeta.fullName !== displayName) lines.push(`Имя в Telegram: ${profileMeta.fullName}`);
    lines.push(`Остаток после списания: ${user.scube} SCube`);
    lines.push(`GCube: ${user.gcube} • Stars: ${user.stars}`);
    lines.push('');
    lines.push(`Способ: ${methodConfig ? methodConfig.label : withdrawal.method}`);
    lines.push(`Вариант: ${withdrawal.payoutLabel}`);
    lines.push(`Стоимость: ${withdrawal.baseCost} SCube`);
    lines.push(`Комиссия: ${withdrawal.commission} SCube`);
    lines.push(`Списано всего: ${withdrawal.totalCost} SCube`);
    if (withdrawal.details && Object.keys(withdrawal.details).length) {
      lines.push('');
      lines.push('Детали:');
      Object.entries(withdrawal.details).forEach(([key, value]) => { const label = fieldLabelMap.get(key) || key; lines.push(`• ${label}: ${value}`); });
    }
    if (withdrawal.note) { lines.push(''); lines.push('Дополнительно:'); lines.push(withdrawal.note); }
    const text = lines.join('\n').trim();
    if (!text) return;
    await bot.telegram.sendMessage(chats.admin, text, { reply_markup: { inline_keyboard: [ [ { text: '✅ Выполнено', callback_data: `wd:done:${withdrawal.id}` }, { text: '🚫 Отклонено', callback_data: `wd:reject:${withdrawal.id}` } ] ] } });
  } catch (err) { /* ignore */ }
}

async function clearWithdrawalKeyboard(ctx){ const cq = ctx.callbackQuery; if (!cq) return; try { if (cq.inline_message_id) { await ctx.telegram.editMessageReplyMarkup(undefined, undefined, cq.inline_message_id, null); return; } const message = cq.message; if (message && message.chat && message.message_id) { await ctx.telegram.editMessageReplyMarkup(message.chat.id, message.message_id, undefined, null); } } catch (err) { /* ignore */ } }
async function updateAdminWithdrawalMessage(ctx, statusLine){ const cq = ctx.callbackQuery; if (!cq) return; const message = cq.message; const base = message && (message.text || message.caption); if (!base) { await clearWithdrawalKeyboard(ctx); return; } const appended = base.includes(statusLine) ? base : `${base}\n\n${statusLine}`; try { if (message.text) { await ctx.telegram.editMessageText(message.chat.id, message.message_id, undefined, appended, { disable_web_page_preview: true, reply_markup: null }); } else { await ctx.telegram.editMessageCaption(message.chat.id, message.message_id, undefined, appended, { reply_markup: null }); } } catch (err) { try { await clearWithdrawalKeyboard(ctx); const targetChat = ctx.chat && ctx.chat.id ? ctx.chat.id : chats.admin; await ctx.telegram.sendMessage(targetChat, statusLine, { reply_to_message_id: message && message.message_id ? message.message_id : undefined }); } catch(e){} }
}

function setupCallbacks(bot, db, ADMIN_IDS, chats){
  bot.on('callback_query', async (ctx) => {
    const data = ctx.callbackQuery && ctx.callbackQuery.data;
    if (!data || !data.startsWith('wd:')) { try { await ctx.answerCbQuery(); } catch (err) {} return; }
    const parts = data.split(':'); const action = parts[1]; const idRaw = parts[2]; const withdrawalId = Number(idRaw);
    if (!withdrawalId) { try { await ctx.answerCbQuery('Некорректная заявка', { show_alert: true }); } catch (err) {} return; }
    const actorId = ctx.from && ctx.from.id; if (!isAuthorizedAdmin(actorId, ADMIN_IDS)) { try { await ctx.answerCbQuery('У вас нет прав для этого действия', { show_alert: true }); } catch (err) {} return; }
    const adminData = { tgid: actorId || null, username: ctx.from && ctx.from.username ? ctx.from.username : null, fullName: [ctx.from && ctx.from.first_name, ctx.from && ctx.from.last_name].filter(Boolean).join(' ') || null };
    try {
      if (action === 'done') {
        const result = await db.completeWithdrawal(withdrawalId, adminData);
        if (!result || !result.ok) { if (result && result.reason === 'already_processed') { await updateAdminWithdrawalMessage(ctx, 'Заявка уже обработана ранее.'); await ctx.answerCbQuery('Заявка уже обработана', { show_alert: true }); return; } await ctx.answerCbQuery('Не удалось завершить заявку', { show_alert: true }); return; }
        const withdrawal = result.withdrawal; const adminLabel = resolveAdminLabel(adminData); const statusBanner = `✅ Заявка #${withdrawal.id} выполнена администратором ${adminLabel}`; await updateAdminWithdrawalMessage(ctx, statusBanner); await ctx.answerCbQuery('Заявка выполнена');
        try { await bot.telegram.sendMessage(withdrawal.tgid, [`Ваша заявка #${withdrawal.id} выполнена.`,`Способ: ${resolveMethodLabel(withdrawal.method, db)}`,`Вариант: ${withdrawal.payoutLabel}`].join('\n')); } catch(e){}
        if (chats.success) { try { const successLines = ['🎉 Выплата подтверждена!', `Заявка #${withdrawal.id}`, `Получатель: ${withdrawal.tgid}`, `Способ: ${resolveMethodLabel(withdrawal.method, db)} • ${withdrawal.payoutLabel}` ]; await bot.telegram.sendMessage(chats.success, successLines.join('\n')); } catch(e){} }
        return;
      }
      if (action === 'reject') {
        const result = await db.declineWithdrawal(withdrawalId, adminData);
        if (!result || !result.ok) { if (result && result.reason === 'already_processed') { await updateAdminWithdrawalMessage(ctx, 'Заявка уже обработана ранее.'); await ctx.answerCbQuery('Заявка уже обработана', { show_alert: true }); return; } await ctx.answerCbQuery('Не удалось отклонить заявку', { show_alert: true }); return; }
        const withdrawal = result.withdrawal; const adminLabel = resolveAdminLabel(adminData); const statusBanner = `🚫 Заявка #${withdrawal.id} отклонена администратором ${adminLabel}`; await updateAdminWithdrawalMessage(ctx, statusBanner); await ctx.answerCbQuery('Заявка отклонена');
        try { const scubeMeta = result.scube !== undefined ? { scube: result.scube } : undefined; const lines = [ `Заявка #${withdrawal.id} отклонена.`, `Способ: ${resolveMethodLabel(withdrawal.method, db)}`, `Вариант: ${withdrawal.payoutLabel}` ]; if (scubeMeta && scubeMeta.scube !== undefined) lines.push(`SCube после возврата: ${scubeMeta.scube}`); await bot.telegram.sendMessage(withdrawal.tgid, lines.join('\n')); } catch(e){}
        return;
      }
      await ctx.answerCbQuery('Неизвестное действие', { show_alert: true });
    } catch (err) {
      try { await ctx.answerCbQuery('Ошибка обработки', { show_alert: true }); } catch (answerErr) {}
    }
  });
}

function setupStartCommand(bot, db, BASE_URL){
  bot.start(async (ctx) => {
    const user = ctx.from || {}; const first = user.first_name || ''; const last = user.last_name || ''; const uname = user.username ? `@${user.username}` : ''; const displayName = String((first + ' ' + last).trim() || uname || 'Игрок'); const tgid = user.id;
    let wasInserted = false; try { if (tgid) { const ensured = await db.ensureUser(tgid, displayName); wasInserted = ensured && ensured.inserted === true; } } catch (dbErr) { /* best effort, ignore */ }
    // Referral binding via start payload
    try { const payload = (ctx.startPayload && String(ctx.startPayload).trim()) || ''; const referrer = parseInt(payload, 10); if (referrer && Number(referrer)!==Number(tgid)) { try { await db.setReferrer(tgid, referrer); } catch(e){} } } catch(e){}
    const webAppUrl = `${BASE_URL}/miniapp?tgid=${tgid || ''}`;
    try { await ctx.reply(`Привет, ${first || displayName}! Добро пожаловать в игру. Нажми кнопку, чтобы открыть MiniApp.`, { reply_markup: { inline_keyboard: [[{ text: 'Play', web_app: { url: webAppUrl } }]] } }); } catch (err) { try { await ctx.reply('Добро пожаловать!'); } catch (e) {} }
  });
}

function createBot(token, db, config){
  const bot = new Telegraf(token);
  const ADMIN_IDS = String(config.ADMIN_ID || '').split(',').map(s=>s.trim()).filter(Boolean);
  const chats = { admin: config.WITHDRAW_ADMIN_CHAT, success: config.WITHDRAW_SUCCESS_CHAT };
  setupCallbacks(bot, db, ADMIN_IDS, chats);
  setupStartCommand(bot, db, config.BASE_URL);
  return { bot, fetchTelegramProfile: (tgid)=> fetchTelegramProfile(bot, tgid), notifyAdminWithdrawal: (withdrawal, user, profileMeta)=> notifyAdminWithdrawal(bot, chats, db, withdrawal, user, profileMeta) };
}

module.exports = { createBot };
