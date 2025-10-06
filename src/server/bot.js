const express = require('express');
const { Telegraf } = require('telegraf');
const bodyParser = require('body-parser');
const path = require('path');
const crypto = require('crypto');
const db = require('./db');
const subgram = require('./subgram');

const TG_BOT_TOKEN = process.env.TG_BOT_TOKEN;
const BASE_URL = process.env.BASE_URL || 'http://localhost:3000';
const BOT_USERNAME = process.env.BOT_USERNAME || '';
const BOT_WEBAPP_PATH = process.env.BOT_WEBAPP_PATH || '';
const PORT = process.env.PORT || 3000;
const ADSGRAM_SECRET = process.env.ADSGRAM_SECRET || 'c6a7a8b7cd30418d9844aebc37b6aaf2';
const ADSGRAM_INTERSTITIAL_ID = process.env.ADSGRAM_INTERSTITIAL_ID || 'int-15539';
const WITHDRAW_ADMIN_CHAT = process.env.WITHDRAW_ADMIN_CHAT || '@zazarara2';
const WITHDRAW_SUCCESS_CHAT = process.env.WITHDRAW_SUCCESS_CHAT || '@zazarara3';
const ADMIN_IDS = String(process.env.ADMIN_ID || '7910097562')
  .split(',')
  .map((value) => value.trim())
  .filter(Boolean);


if (!TG_BOT_TOKEN) {
  console.error('TG_BOT_TOKEN is not set');
}

const SESSION_TTL = 24 * 60 * 60; // 24h
function parseCookies(header){
  const out = {};
  String(header||'').split(';').forEach((p)=>{
    const idx = p.indexOf('=');
    if (idx > -1){
      const k = p.slice(0, idx).trim();
      const v = decodeURIComponent(p.slice(idx+1).trim());
      out[k] = v;
    }
  });
  return out;
}
function signSession(id, ts){
  const h = crypto.createHmac('sha256', TG_BOT_TOKEN);
  h.update(`${id}.${ts}`);
  return `${id}.${ts}.${h.digest('hex')}`;
}
function verifySession(token){
  try{
    const [id, ts, sig] = String(token||'').split('.');
    if (!id || !ts || !sig) return null;
    const now = Math.floor(Date.now()/1000);
    if (now - Number(ts) > SESSION_TTL) return null;
    const expected = crypto.createHmac('sha256', TG_BOT_TOKEN).update(`${id}.${ts}`).digest('hex');
    if (!crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(sig))) return null;
    return Number(id);
  } catch(e){ return null; }
}
function getAuthTgid(req){
  try{
    const cookies = parseCookies(req.headers.cookie || '');
    const id = verifySession(cookies.session || '');
    return Number.isFinite(id) ? id : null;
  } catch(e){ return null; }
}
function verifyTelegramInitData(initData){
  try{
    const params = new URLSearchParams(initData);
    const hash = params.get('hash');
    params.delete('hash');
    const data = [];
    for (const [key, value] of params.entries()) data.push(`${key}=${value}`);
    data.sort();
    const dataCheckString = data.join('\n');
    const secret = crypto.createHmac('sha256', 'WebAppData').update(TG_BOT_TOKEN).digest();
    const hmac = crypto.createHmac('sha256', secret).update(dataCheckString).digest('hex');
    if (!hash || !crypto.timingSafeEqual(Buffer.from(hmac), Buffer.from(hash))) return null;
    const auth_date = Number(params.get('auth_date') || 0);
    const now = Math.floor(Date.now()/1000);
    if (auth_date && now - auth_date > 3600) return null;
    const userRaw = params.get('user');
    const user = userRaw ? JSON.parse(userRaw) : null;
    return user && user.id ? Number(user.id) : null;
  } catch(e){ return null; }
}

const DEFAULT_AD_REWARD = 5;
const DEFAULT_TASK_REWARD = 15;

function base64UrlFromBuffer(buf){
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/,'');
}

function collectSignatureCandidates(header){
  const trimmed = String(header || '').trim();
  if (!trimmed) return [];
  const candidates = new Set([trimmed]);
  trimmed.split(',').forEach(part=>{
    const piece = part.trim();
    if (!piece) return;
    const eqIdx = piece.indexOf('=');
    if (eqIdx === -1) {
      candidates.add(piece);
    } else {
      const val = piece.slice(eqIdx + 1).trim();
      if (val) candidates.add(val);
    }
  });
  return Array.from(candidates);
}

function timingSafeEqualString(a, b){
  const bufA = Buffer.from(String(a));
  const bufB = Buffer.from(String(b));
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

function verifyAdsgramSignature(signatureHeader, expectedHex){
  try {
    const expectedBuf = Buffer.from(expectedHex, 'hex');
    const variants = [
      expectedHex,
      expectedHex.toLowerCase(),
      expectedHex.toUpperCase(),
      expectedBuf.toString('base64'),
      base64UrlFromBuffer(expectedBuf)
    ].filter(Boolean);
    const candidates = collectSignatureCandidates(signatureHeader);
    for (const candidateRaw of candidates){
      const candidate = candidateRaw.trim();
      if (!candidate) continue;
      for (const variant of variants){
        if (timingSafeEqualString(candidate, variant)) return true;
      }
      if (/^[0-9a-fA-F]+$/.test(candidate) && candidate.length === expectedHex.length) {
        const providedBuf = Buffer.from(candidate, 'hex');
        if (providedBuf.length === expectedBuf.length && crypto.timingSafeEqual(expectedBuf, providedBuf)) return true;
      }
      try {
        const providedBuf = Buffer.from(candidate, 'base64');
        if (providedBuf.length === expectedBuf.length && crypto.timingSafeEqual(expectedBuf, providedBuf)) return true;
      } catch(e){}
      try {
        const normalized = candidate.replace(/-/g, '+').replace(/_/g, '/');
        const padding = normalized.length % 4 ? '='.repeat(4 - (normalized.length % 4)) : '';
        const providedBuf = Buffer.from(normalized + padding, 'base64');
        if (providedBuf.length === expectedBuf.length && crypto.timingSafeEqual(expectedBuf, providedBuf)) return true;
      } catch(e){}
    }
    return false;
  } catch (e) {
    console.warn('Failed to verify AdsGram signature', e);
    return false;
  }
}

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function resolveAdsgramReward(payload){
  const data = payload || {};
  const rawTags = Array.isArray(data.tags) ? data.tags.map(tag => String(tag).toLowerCase()) : [];
  const rawTypeCandidates = [
    data.type,
    data.event,
    data.category,
    data.kind,
    data.mode,
    data.source,
    data.reward_type
  ].filter(Boolean).map(value => String(value).toLowerCase());
  const taskMarkers = ['task', 'mission', 'quest'];
  let isTask = rawTags.some(tag => taskMarkers.some(marker => tag.includes(marker)));
  if (!isTask) {
    isTask = rawTypeCandidates.some(type => taskMarkers.some(marker => type.includes(marker)));
  }
  if (!isTask) {
    isTask = Boolean(data.taskId || data.task_id || data.task);
  }

  const numericFields = ['amount','reward','value','payout','reward_amount','rewardAmount','bonus','coins'];
  let numericReward;
  for (const field of numericFields){
    if (Object.prototype.hasOwnProperty.call(data, field)) {
      const parsed = Number(data[field]);
      if (Number.isFinite(parsed) && parsed > 0) {
        numericReward = parsed;
        break;
      }
    }
  }

  const fallback = isTask ? DEFAULT_TASK_REWARD : DEFAULT_AD_REWARD;
  const resolved = numericReward && numericReward > 0 ? numericReward : fallback;
  const safeAmount = Math.min(1000000, Math.max(1, Math.round(resolved)));
  return { amount: safeAmount, source: isTask ? 'task' : 'ad' };
}

function extractAdsgramContextId(payload){
  const data = payload || {};
  const candidates = [
    data.eventId,
    data.event_id,
    data.transactionId,
    data.transaction_id,
    data.rewardId,
    data.reward_id,
    data.taskId,
    data.task_id,
    data.clickId,
    data.click_id,
    data.orderId,
    data.order_id,
    data.id,
    data.requestId,
    data.request_id
  ];
  for (const candidate of candidates){
    if (candidate === undefined || candidate === null) continue;
    const trimmed = String(candidate).trim();
    if (trimmed) return trimmed;
  }
  const user = data.userId || data.tgid || data.user_id;
  const adUnit = data.adUnit || data.ad_unit;
  const stamp = data.timestamp || data.time || data.createdAt || data.created_at || data.ts;
  if (user && stamp) return `${user}:${stamp}`;
  if (user && adUnit) return `${user}:${adUnit}`;
  return null;
}

const bot = new Telegraf(TG_BOT_TOKEN);

async function fetchTelegramProfile(tgid){
  try {
    if (!tgid) return null;
    const chat = await bot.telegram.getChat(tgid);
    if (!chat) return null;
    const first = chat.first_name || '';
    const last = chat.last_name || '';
    const fullName = `${first} ${last}`.trim();
    const displayName = fullName || chat.username || null;
    return {
      username: chat.username || null,
      fullName: fullName || null,
      displayName
    };
  } catch (err) {
    console.warn('Failed to fetch Telegram profile', err);
    return null;
  }
}

async function notifyAdminWithdrawal(withdrawal, user, profileMeta){
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
    if (profileMeta && profileMeta.fullName && profileMeta.fullName !== displayName) {
      lines.push(`Имя в Telegram: ${profileMeta.fullName}`);
    }
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
      Object.entries(withdrawal.details).forEach(([key, value]) => {
        const label = fieldLabelMap.get(key) || key;
        lines.push(`• ${label}: ${value}`);
      });
    }
    if (withdrawal.note) {
      lines.push('');
      lines.push('Дополнительно:');
      lines.push(withdrawal.note);
    }
    const text = lines.join('\n').trim();
    if (!text) return;
    await bot.telegram.sendMessage(WITHDRAW_ADMIN_CHAT, text, {
      reply_markup: {
        inline_keyboard: [
          [
            { text: '✅ Выполнено', callback_data: `wd:done:${withdrawal.id}` },
            { text: '🚫 Отклонено', callback_data: `wd:reject:${withdrawal.id}` }
          ]
        ]
      }
    });
  } catch (err) {
    console.error('Failed to notify admin about withdrawal', err);
  }
}

function isAuthorizedAdmin(tgid){
  if (!tgid) return false;
  if (!ADMIN_IDS.length) return true;
  return ADMIN_IDS.includes(String(tgid));
}
function resolveAdminLabel(adminData){
  if (!adminData) return 'Администратор';
  if (adminData.fullName) return adminData.fullName;
  if (adminData.username) return `@${adminData.username}`;
  if (adminData.tgid) return `ID ${adminData.tgid}`;
  return 'Администратор';
}
function resolveMethodLabel(methodKey){
  const method = db.WITHDRAWAL_METHODS && db.WITHDRAWAL_METHODS[methodKey];
  if (method && method.label) return method.label;
  return methodKey;
}
async function clearWithdrawalKeyboard(ctx){
  const cq = ctx.callbackQuery;
  if (!cq) return;
  try {
    if (cq.inline_message_id) {
      await ctx.telegram.editMessageReplyMarkup(undefined, undefined, cq.inline_message_id, null);
      return;
    }
    const message = cq.message;
    if (message && message.chat && message.message_id) {
      await ctx.telegram.editMessageReplyMarkup(message.chat.id, message.message_id, undefined, null);
    }
  } catch (err) {
    console.warn('Failed to clear withdrawal keyboard', err);
  }
}
async function updateAdminWithdrawalMessage(ctx, statusLine){
  const cq = ctx.callbackQuery;
  if (!cq) return;
  const message = cq.message;
  const base = message && (message.text || message.caption);
  if (!base) {
    await clearWithdrawalKeyboard(ctx);
    return;
  }
  const appended = base.includes(statusLine) ? base : `${base}\n\n${statusLine}`;
  try {
    if (message.text) {
      await ctx.telegram.editMessageText(message.chat.id, message.message_id, undefined, appended, {
        disable_web_page_preview: true,
        reply_markup: null
      });
    } else {
      await ctx.telegram.editMessageCaption(message.chat.id, message.message_id, undefined, appended, {
        reply_markup: null
      });
    }
  } catch (err) {
    console.warn('Failed to update withdrawal message', err);
    await clearWithdrawalKeyboard(ctx);
    const targetChat = ctx.chat && ctx.chat.id ? ctx.chat.id : WITHDRAW_ADMIN_CHAT;
    try {
      await ctx.telegram.sendMessage(targetChat, statusLine, {
        reply_to_message_id: message && message.message_id ? message.message_id : undefined
      });
    } catch (sendErr) {
      console.warn('Failed to send withdrawal status fallback', sendErr);
    }
  }
}
async function notifyWithdrawalUser(withdrawal, status, meta){
  if (!withdrawal || !withdrawal.tgid) return;
  const methodLabel = resolveMethodLabel(withdrawal.method);
  const lines = [];
  if (status === 'completed') {
    lines.push(`Ваша заявка #${withdrawal.id} выполнена.`);
  } else if (status === 'declined') {
    lines.push(`Заявка #${withdrawal.id} отклонена.`);
  } else {
    return;
  }
  lines.push(`Способ: ${methodLabel}`);
  lines.push(`Вариант: ${withdrawal.payoutLabel}`);
  if (status === 'declined' && meta && meta.scube !== undefined) {
    lines.push(`SCube после возврата: ${meta.scube}`);
  }
  try {
    await bot.telegram.sendMessage(withdrawal.tgid, lines.join('\n'));
  } catch (err) {
    console.warn('Failed to notify user about withdrawal status', err);
  }
}

bot.on('callback_query', async (ctx) => {
  const data = ctx.callbackQuery && ctx.callbackQuery.data;
  if (!data) {
    try { await ctx.answerCbQuery(); } catch(e){}
    return;
  }

  // Sponsor task moderation
  if (data.startsWith('st:')) {
    const parts = data.split(':'); // st:approve:taskId:tgid or st:reject:taskId:tgid
    const action = parts[1];
    const taskId = Number(parts[2]);
    const userId = Number(parts[3]);
    const actorId = ctx.from && ctx.from.id;
    if (!isAuthorizedAdmin(actorId)) {
      try { await ctx.answerCbQuery('Нет прав', { show_alert:true }); } catch(e){}
      return;
    }
    try {
      if (action === 'approve') {
        const res = await db.approveSponsorTask(taskId, userId);
        if (!res || !res.ok) { await ctx.answerCbQuery(res && res.message ? res.message : 'Ошибка', { show_alert:true }); return; }
        await ctx.answerCbQuery('Одобрено');
      } else if (action === 'reject') {
        const res = await db.rejectSponsorTask(taskId, userId);
        if (!res || !res.ok) { await ctx.answerCbQuery('Ошибка', { show_alert:true }); return; }
        await ctx.answerCbQuery('Отклонено');
      } else {
        await ctx.answerCbQuery('Неизвестное действие', { show_alert:true });
      }
    } catch (err) {
      console.error('Sponsor task moderation failed', err);
      try { await ctx.answerCbQuery('Ошибка', { show_alert:true }); } catch(e){}
    }
    return;
  }

  // Withdrawals
  if (!data.startsWith('wd:')) {
    try { await ctx.answerCbQuery(); } catch(e){}
    return;
  }
  const parts = data.split(':');
  const action = parts[1];
  const idRaw = parts[2];
  const withdrawalId = Number(idRaw);
  if (!withdrawalId) {
    try { await ctx.answerCbQuery('Некорректная заявка', { show_alert: true }); } catch (err) {}
    return;
  }
  const actorId = ctx.from && ctx.from.id;
  if (!isAuthorizedAdmin(actorId)) {
    try { await ctx.answerCbQuery('У вас нет прав для этого действия', { show_alert: true }); } catch (err) {}
    return;
  }
  const adminData = {
    tgid: actorId || null,
    username: ctx.from && ctx.from.username ? ctx.from.username : null,
    fullName: [ctx.from && ctx.from.first_name, ctx.from && ctx.from.last_name].filter(Boolean).join(' ') || null
  };
  try {
    if (action === 'done') {
      const result = await db.completeWithdrawal(withdrawalId, adminData);
      if (!result || !result.ok) {
        if (result && result.reason === 'already_processed') {
          await updateAdminWithdrawalMessage(ctx, 'Заявка уже обработана ранее.');
          await ctx.answerCbQuery('Заявка уже обработана', { show_alert: true });
          return;
        }
        await ctx.answerCbQuery('Не удалось завершить заявку', { show_alert: true });
        return;
      }
      const withdrawal = result.withdrawal;
      const adminLabel = resolveAdminLabel(adminData);
      const statusBanner = `✅ Заявка #${withdrawal.id} выполнена администратором ${adminLabel}`;
      await updateAdminWithdrawalMessage(ctx, statusBanner);
      await ctx.answerCbQuery('Заявка выполнена');
      await notifyWithdrawalUser(withdrawal, 'completed');
      if (WITHDRAW_SUCCESS_CHAT) {
        try {
          const successLines = [
            '🎉 Выплата подтверждена!',
            `Заявка #${withdrawal.id}`,
            `Получатель: ${withdrawal.tgid}`,
            `Способ: ${resolveMethodLabel(withdrawal.method)} • ${withdrawal.payoutLabel}`
          ];
          await bot.telegram.sendMessage(WITHDRAW_SUCCESS_CHAT, successLines.join('\n'));
        } catch (err) {
          console.warn('Failed to notify success chat about withdrawal', err);
        }
      }
      return;
    }
    if (action === 'reject') {
      const result = await db.declineWithdrawal(withdrawalId, adminData);
      if (!result || !result.ok) {
        if (result && result.reason === 'already_processed') {
          await updateAdminWithdrawalMessage(ctx, 'Заявка уже обработана р��нее.');
          await ctx.answerCbQuery('Заявка уже обработана', { show_alert: true });
          return;
        }
        await ctx.answerCbQuery('Не удалось отклонить заявку', { show_alert: true });
        return;
      }
      const withdrawal = result.withdrawal;
      const adminLabel = resolveAdminLabel(adminData);
      const statusBanner = `🚫 Заявка #${withdrawal.id} отклонена администратором ${adminLabel}`;
      await updateAdminWithdrawalMessage(ctx, statusBanner);
      await ctx.answerCbQuery('Заявка отклонена');
      const scubeMeta = result.scube !== undefined ? { scube: result.scube } : undefined;
      await notifyWithdrawalUser(withdrawal, 'declined', scubeMeta);
      return;
    }
    await ctx.answerCbQuery('Неизвестное действие', { show_alert: true });
  } catch (err) {
    console.error('Failed to process withdrawal callback', err);
    try { await ctx.answerCbQuery('Ошибка обработки', { show_alert: true }); } catch (answerErr) {}
  }
});

bot.start(async (ctx) => {
  const user = ctx.from || {};
  const first = user.first_name || '';
  const last = user.last_name || '';
  const uname = user.username ? `@${user.username}` : '';
  const displayName = String((first + ' ' + last).trim() || uname || 'Игрок');
  const tgid = user.id;

  // Try to ensure user in DB, but do not block reply on DB errors
  try {
    if (tgid) await db.ensureUser(tgid, displayName);
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

  // Try to pass referral param via URL if present in /start payload
  let refQuery = '';
  try {
    const payload = ctx.startPayload;
    if (payload) {
      const m = String(payload).match(/ref[_-]?(\d+)/i) || String(payload).match(/^(\d+)$/);
      if (m && m[1]) refQuery = `&ref=${Number(m[1])}`;
    }
  } catch(e) { /* ignored */ }

  const webAppUrl = `${BASE_URL}/miniapp?tgid=${tgid || ''}${refQuery}`;

  try {
    await ctx.reply(`Привет, ${first || displayName}! Добро пожаловать в игру. Нажми ��нопку, чтобы открыть MiniApp.`, {
      reply_markup: {
        inline_keyboard: [[{ text: 'Play', web_app: { url: webAppUrl } }]]
      }
    });
  } catch (err) {
    console.error('Failed to send welcome message in /start', err);
    try { await ctx.reply('Добро пожаловать!'); } catch (e) { console.error('Fallback reply failed', e); }
  }
});

const app = express();
// capture raw body for signature verification
app.use(bodyParser.json({ verify: (req, res, buf) => { req.rawBody = buf ? buf.toString() : ''; } }));

// Serve miniapp static files
app.use('/miniapp/static', express.static(path.join(__dirname, '..', 'miniapp')));

// Expose minimal runtime config for MiniApp
app.get('/miniapp/config.js', (req, res) => {
  res.setHeader('Content-Type', 'application/javascript');
  const safe = {
    BASE_URL,
    BOT_USERNAME,
    BOT_WEBAPP_PATH
  };
  res.send(`window.APP_CONFIG = ${JSON.stringify(safe)};`);
});

// Serve miniapp page
app.get('/miniapp', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'miniapp', 'index.html'));
});

// Telegram WebApp auth exchange -> sets secure session cookie
app.post('/auth/telegram', async (req, res) => {
  try {
    const initData = (req.body && req.body.initData) || '';
    const params = new URLSearchParams(initData);
    const userRaw = params.get('user');
    const parsedUser = userRaw ? JSON.parse(userRaw) : null;
    const uid = verifyTelegramInitData(initData);
    if (!uid) return res.status(401).json({ ok:false, message:'Invalid init data' });

    // Update user's name from Telegram
    try {
      if (parsedUser) {
        const first = parsedUser.first_name || '';
        const last = parsedUser.last_name || '';
        const uname = parsedUser.username ? `@${parsedUser.username}` : '';
        const displayName = String((first + ' ' + last).trim() || uname || 'Игрок');
        await db.ensureUser(uid, displayName);
      }
    } catch (e) { console.warn('ensureUser from auth failed', e); }

    const ts = Math.floor(Date.now()/1000);
    const token = signSession(uid, ts);
    const isProd = String(process.env.NODE_ENV||'').toLowerCase() === 'production';
    const cookie = `session=${encodeURIComponent(token)}; Max-Age=${SESSION_TTL}; Path=/; SameSite=Strict${isProd?'; Secure':''}; HttpOnly`;
    res.setHeader('Set-Cookie', cookie);
    return res.json({ ok:true, tgid: uid });
  } catch (e) {
    console.error('Auth exchange failed', e);
    return res.status(500).json({ ok:false, message:'Server error' });
  }
});

// Root redirects to miniapp for convenience and external reviews
app.get('/', (req, res) => {
  res.redirect('/miniapp');
});

// In-memory game rooms (prototype). For production, persist to DB.
const gameRooms = new Map();
let nextRoomId = 1;
const userActiveRoom = new Map(); // tgid -> roomId

function serializeRoom(room){
  return {
    id: room.id,
    game: room.game,
    bet: room.bet,
    status: room.status,
    creator: room.creator,
    opponent: room.opponent,
    createdAt: room.createdAt,
    state: room.state,
    deadlineAt: room.deadlineAt || null
  };
}

function clearRoomTimer(room){
  try { if (room._timer) { clearTimeout(room._timer); room._timer = null; } } catch(e){}
}

async function finishRoomWithWinner(room, winnerTgid, reason){
  try{
    if (room.status === 'finished') return;
    clearRoomTimer(room);
    room.status = 'finished';
    if (winnerTgid) {
      await db.creditScube(Number(winnerTgid), room.bet * 2);
      if (room.game === 'rps') {
        room.state = room.state || {};
        room.state.result = Object.assign({}, room.state.result || {}, { type:'win', winner: String(winnerTgid), reason });
      } else if (room.game === 'ttt') {
        room.state = room.state || {};
        room.state.winner = String(winnerTgid);
        room.state.reason = reason;
      }
    } else {
      // draw case
      await db.creditScube(room.creator, room.bet);
      if (room.opponent) await db.creditScube(room.opponent, room.bet);
      if (room.game === 'rps') {
        room.state = room.state || {};
        room.state.result = Object.assign({}, room.state.result || {}, { type:'draw', reason });
      } else if (room.game === 'ttt') {
        room.state = room.state || {};
        room.state.winner = null;
        room.state.reason = reason || 'draw';
      }
    }
  } finally {
    userActiveRoom.delete(String(room.creator));
    if (room.opponent) userActiveRoom.delete(String(room.opponent));
  }
}

function startRpsTimer(room){
  clearRoomTimer(room);
  room.deadlineAt = Date.now() + 30000;
  room._timer = setTimeout(async ()=>{
    try{
      if (room.status !== 'active') return;
      const moves = room.state && room.state.moves || {};
      const a = moves[String(room.creator)];
      const b = moves[String(room.opponent)];
      if (a && b) return; // already resolved
      if (a && !b) { await finishRoomWithWinner(room, room.creator, 'timeout'); }
      else if (!a && b) { await finishRoomWithWinner(room, room.opponent, 'timeout'); }
      else { await finishRoomWithWinner(room, null, 'timeout'); }
    } catch(e){ console.warn('RPS timer error', e); }
  }, 30000);
}

function startTttTimer(room){
  clearRoomTimer(room);
  if (!room.state || !room.state.turn) return; // no turn yet
  const turnTgid = String(room.state.turn);
  room.deadlineAt = Date.now() + 30000;
  room._timer = setTimeout(async ()=>{
    try{
      if (room.status !== 'active') return;
      const loser = turnTgid;
      const winner = String(loser) === String(room.creator) ? room.opponent : room.creator;
      if (!winner) return; // cannot decide
      await finishRoomWithWinner(room, winner, 'timeout');
    } catch(e){ console.warn('TTT timer error', e); }
  }, 30000);
}

function createRoom(tgid, game, bet){
  const id = String(nextRoomId++);
  const room = {
    id,
    game,
    bet,
    creator: tgid,
    opponent: null,
    status: 'waiting',
    createdAt: Date.now(),
    state: game === 'rps' ? { moves: {}, notice: 'Сделайте ход за 30 секунд, иначе поражение.' } : { board: Array(9).fill(null), turn: null, symbols: {}, winner: null, notice: 'На ход даётся 30 секунд. Превышение — поражение.' },
    deadlineAt: null,
    _timer: null
  };
  gameRooms.set(id, room);
  userActiveRoom.set(String(tgid), id);
  return room;
}

function rpsOutcome(a,b){
  if (a===b) return 0; // draw
  if ((a==='rock'&&b==='scissors')||(a==='scissors'&&b==='paper')||(a==='paper'&&b==='rock')) return 1; // a wins
  return -1; // b wins
}

function tttCheckWinner(board){
  const lines = [ [0,1,2],[3,4,5],[6,7,8], [0,3,6],[1,4,7],[2,5,8], [0,4,8],[2,4,6] ];
  for (const [a,b,c] of lines){ if (board[a] && board[a]===board[b] && board[a]===board[c]) return board[a]; }
  if (board.every(v=>v)) return 'draw';
  return null;
}

// Games: list rooms
app.get('/api/games/rooms', (req, res)=>{
  const game = (req.query.game === 'ttt') ? 'ttt' : 'rps';
  const bet = parseInt(req.query.bet || '0', 10) || 0;
  const list = [];
  for (const room of gameRooms.values()){
    if (room.status==='waiting' && room.game===game && (!bet || Number(room.bet)===bet)) {
      list.push(serializeRoom(room));
    }
  }
  res.json({ ok:true, rooms:list.slice(0,50) });
});

// Create room
app.post('/api/games/rooms', async (req, res)=>{
  try{
    const { tgid: bodyTgid, game, bet } = req.body || {};
    const authTgid = getAuthTgid(req);
    const playerTgid = authTgid || bodyTgid;
    const G = (game === 'ttt') ? 'ttt' : 'rps';
    const B = Math.max(1, parseInt(bet,10)||0);
    if (authTgid && bodyTgid && String(authTgid)!==String(bodyTgid)) return res.json({ ok:false, message:'Auth mismatch' });
    if (!playerTgid || !B) return res.status(400).json({ ok:false, message:'Invalid params' });
    if (userActiveRoom.get(String(playerTgid))) return res.json({ ok:false, message:'У вас уже есть активная комната' });
    const reserve = await db.tryReserveScube(playerTgid, B);
    if (!reserve.ok) return res.json(reserve);
    const room = createRoom(playerTgid, G, B);
    if (G==='ttt') { room.state.turn = Math.random()<0.5 ? String(room.creator) : null; }
    res.json({ ok:true, room: serializeRoom(room) });
  } catch (err){ console.error(err); res.status(500).json({ ok:false, message:'Server error' }); }
});

// Join room
app.post('/api/games/rooms/:id/join', async (req, res)=>{
  try{
    const id = req.params.id;
    const authTgid = getAuthTgid(req);
    const bodyTgid = (req.body && req.body.tgid) || null;
    if (authTgid && bodyTgid && String(authTgid)!==String(bodyTgid)) return res.json({ ok:false, message:'Auth mismatch' });
    const tgid = authTgid || bodyTgid;
    const room = gameRooms.get(id);
    if (!room) return res.status(404).json({ ok:false, message:'Room not found' });
    if (room.status!=='waiting') return res.json({ ok:false, message:'Комната уже занята' });
    if (String(room.creator) === String(tgid)) return res.json({ ok:false, message:'Нельзя присоединиться к своей комнате' });
    if (userActiveRoom.get(String(tgid))) return res.json({ ok:false, message:'У вас уже есть активная комната' });
    const reserve = await db.tryReserveScube(tgid, room.bet);
    if (!reserve.ok) return res.json(reserve);
    room.opponent = tgid;
    room.status = 'active';
    if (room.game==='ttt'){
      room.state.symbols = { [String(room.creator)] : 'X', [String(tgid)] : 'O' };
      if (!room.state.turn) room.state.turn = String(room.creator);
      startTttTimer(room);
    } else if (room.game==='rps'){
      startRpsTimer(room);
    }
    userActiveRoom.set(String(tgid), id);
    res.json({ ok:true, room: serializeRoom(room) });
  } catch(err){ console.error(err); res.status(500).json({ ok:false, message:'Server error' }); }
});

// Get room
app.get('/api/games/rooms/:id', (req,res)=>{
  const room = gameRooms.get(req.params.id);
  if (!room) return res.status(404).json({ ok:false, message:'Room not found' });
  res.json({ ok:true, room: serializeRoom(room) });
});

// Make move
app.post('/api/games/rooms/:id/move', async (req,res)=>{
  try{
    const room = gameRooms.get(req.params.id);
    if (!room) return res.status(404).json({ ok:false, message:'Room not found' });
    const authTgid = getAuthTgid(req);
    const bodyTgid = (req.body && req.body.tgid) || null;
    if (authTgid && bodyTgid && String(authTgid)!==String(bodyTgid)) return res.json({ ok:false, message:'Auth mismatch' });
    const tgid = authTgid || bodyTgid;
    if (!tgid) return res.status(400).json({ ok:false, message:'Invalid player' });
    if (room.status!=='active' && room.status!=='waiting') return res.json({ ok:false, message:'Игра завершена' });
    if (room.game==='rps'){
      const move = String(req.body.move||'').toLowerCase();
      if (!['rock','paper','scissors'].includes(move)) return res.status(400).json({ ok:false, message:'Invalid move' });
      if (room.state.moves[String(tgid)]) return res.json({ ok:false, message:'Ход уже сделан' });
      room.state.moves[String(tgid)] = move;
      if (room.opponent && room.state.moves[String(room.creator)] && room.state.moves[String(room.opponent)]){
        const a = room.state.moves[String(room.creator)];
        const b = room.state.moves[String(room.opponent)];
        const out = rpsOutcome(a,b);
        clearRoomTimer(room);
        if (out===0){ // draw
          await finishRoomWithWinner(room, null, 'both_moved');
          room.state.result = Object.assign({}, room.state.result || {}, { a, b });
        } else if (out===1){
          await finishRoomWithWinner(room, room.creator, 'both_moved');
          room.state.result = Object.assign({}, room.state.result || {}, { a, b });
        } else {
          await finishRoomWithWinner(room, room.opponent, 'both_moved');
          room.state.result = Object.assign({}, room.state.result || {}, { a, b });
        }
      }
      return res.json({ ok:true, room: serializeRoom(room) });
    } else if (room.game==='ttt'){
      const idx = parseInt(req.body.idx,10);
      if (!(idx>=0 && idx<9)) return res.status(400).json({ ok:false, message:'Invalid cell' });
      const sym = room.state.symbols[String(tgid)];
      if (!sym) return res.status(403).json({ ok:false, message:'Not a player' });
      if (room.state.turn !== String(tgid)) return res.json({ ok:false, message:'Ход соперника' });
      if (room.state.board[idx]) return res.json({ ok:false, message:'Клетка занята' });
      room.state.board[idx] = sym;
      const w = tttCheckWinner(room.state.board);
      clearRoomTimer(room);
      if (w==='draw'){
        await finishRoomWithWinner(room, null, 'board_draw');
      } else if (w){
        const winnerTgid = Object.entries(room.state.symbols).find(([,s])=>s===w)[0];
        await finishRoomWithWinner(room, Number(winnerTgid), 'board_win');
      } else {
        const next = (String(tgid)===String(room.creator)) ? String(room.opponent) : String(room.creator);
        room.state.turn = next;
        startTttTimer(room);
      }
      return res.json({ ok:true, room: serializeRoom(room) });
    }
    return res.status(400).json({ ok:false, message:'Unknown game' });
  } catch(err){ console.error(err); res.status(500).json({ ok:false, message:'Server error' }); }
});

// Leave / cancel room
app.post('/api/games/rooms/:id/leave', async (req,res)=>{
  try{
    const room = gameRooms.get(req.params.id);
    const authTgid = getAuthTgid(req);
    const bodyTgid = (req.body && req.body.tgid) || null;
    if (authTgid && bodyTgid && String(authTgid)!==String(bodyTgid)) return res.json({ ok:false, message:'Auth mismatch' });
    const tgid = authTgid || bodyTgid;
    if (!room) return res.status(404).json({ ok:false, message:'Room not found' });
    const isCreator = String(room.creator)===String(tgid);
    const isOpponent = String(room.opponent||'')===String(tgid);
    if (!isCreator && !isOpponent) return res.status(403).json({ ok:false, message:'Not a participant' });

    if (room.status==='waiting'){
      // refund creator and close
      clearRoomTimer(room);
      await db.creditScube(room.creator, room.bet);
      room.status='finished';
    } else if (room.status==='active'){
      // forfeit: pay full pot to the other
      const winner = isCreator ? room.opponent : room.creator;
      clearRoomTimer(room);
      await db.creditScube(winner, room.bet*2);
      room.status='finished';
      room.state.forfeit = String(tgid);
    }

    userActiveRoom.delete(String(room.creator));
    if (room.opponent) userActiveRoom.delete(String(room.opponent));
    res.json({ ok:true, room: serializeRoom(room) });
  } catch(err){ console.error(err); res.status(500).json({ ok:false, message:'Server error' }); }
});

// SubGram subscription status
app.get('/api/subgram/status', async (req, res) => {
  try {
    // disable caching so UI always sees fresh status
    res.setHeader('Cache-Control', 'no-store');

    const config = subgram.getConfig();
    const authTgid = getAuthTgid(req);
    const queryTgidRaw = req.query && req.query.tgid;
    const queryTgid = queryTgidRaw !== undefined ? parseInt(queryTgidRaw, 10) : null;
    const hasAuth = typeof authTgid === 'number' && Number.isFinite(authTgid);
    const hasQuery = typeof queryTgid === 'number' && Number.isFinite(queryTgid);

    if (hasAuth && hasQuery && Number(authTgid) !== Number(queryTgid)) {
      return res.status(403).json({
        ok: false,
        message: 'Auth mismatch',
        enabled: config.enabled,
        botUrl: config.botUrl,
        requiredLinks: config.links
      });
    }

    const resolvedTgid = hasAuth ? Number(authTgid) : (hasQuery ? Number(queryTgid) : null);
    if (!resolvedTgid) {
      return res.status(400).json({
        ok: false,
        message: 'tgid is required',
        enabled: config.enabled,
        botUrl: config.botUrl,
        requiredLinks: config.links,
        recheckAfterSeconds: config.recheckAfterSeconds
      });
    }

    const status = await subgram.checkUserSubscriptions(resolvedTgid);
    const derivedLinks = Array.isArray(status.links) && status.links.length
      ? status.links
      : (Array.isArray(status.sponsors) ? status.sponsors.map(s => s && s.link).filter(Boolean) : []);

    return res.json({
      ok: true,
      tgid: resolvedTgid,
      enabled: status.enabled,
      subscribed: status.subscribed,
      sponsors: status.sponsors,
      error: status.error,
      temporaryBypass: Boolean(status.temporaryBypass),
      botUrl: config.botUrl,
      requiredLinks: derivedLinks,
      recheckAfterSeconds: status.recheckAfterSeconds || config.recheckAfterSeconds
    });
  } catch (err) {
    console.error('SubGram status check failed', err);
    const config = subgram.getConfig();
    return res.status(500).json({
      ok: false,
      message: 'SubGram status check failed',
      enabled: config.enabled,
      botUrl: config.botUrl,
      requiredLinks: config.links
    });
  }
});

// Sponsor tasks API
app.get('/api/tasks/sponsors', async (req, res) => {
  try {
    const tasks = await db.listSponsorTasks();
    res.json({ ok:true, tasks });
  } catch (err) {
    console.error('list sponsor tasks failed', err);
    res.status(500).json({ ok:false, message:'Internal error' });
  }
});

app.post('/api/tasks/sponsors/:id/claim', async (req, res) => {
  try {
    const taskId = Number(req.params.id);
    if (!taskId) return res.status(400).json({ ok:false, message:'Invalid task id' });
    const authTgid = getAuthTgid(req);
    const bodyTgid = req.body && req.body.tgid !== undefined ? Number(req.body.tgid) : null;
    if (authTgid && bodyTgid && Number(authTgid)!==Number(bodyTgid)) return res.status(403).json({ ok:false, message:'Auth mismatch' });
    const tgid = (authTgid !== null && authTgid !== undefined) ? Number(authTgid) : bodyTgid;
    if (!tgid) return res.status(401).json({ ok:false, message:'Auth required' });
    const result = await db.claimSponsorTask(tgid, taskId);
    if (!result.ok) return res.status(400).json(result);

    if (result.pending) {
      try {
        const task = await db.getSponsorTaskById(taskId);
        const profile = await fetchTelegramProfile(tgid);
        const displayName = (profile && profile.displayName) || `Игрок ${tgid}`;
        const uname = profile && profile.username ? `@${profile.username}` : '';
        const lines = [
          '📝 Новая заявка по спонсорскому заданию',
          `Игрок: ${displayName} ${uname} (ID: ${tgid})`,
          `Задание: ${task ? task.title : taskId}`,
          task && task.url ? `Ссылка: ${task.url}` : null,
          `Награда: ${task ? task.reward : ''} SCube`
        ].filter(Boolean);
        await bot.telegram.sendMessage(WITHDRAW_ADMIN_CHAT, lines.join('\n'), {
          reply_markup: { inline_keyboard: [[
            { text:'✅ Одобрить', callback_data: `st:approve:${taskId}:${tgid}` },
            { text:'🚫 Отклонить', callback_data: `st:reject:${taskId}:${tgid}` }
          ]]} }
        );
      } catch (e) { console.warn('notify admin sponsor claim failed', e); }
    }

    res.json(result);
  } catch (err) {
    console.error('claim sponsor task failed', err);
    res.status(500).json({ ok:false, message:'Internal error' });
  }
});

// Admin sponsor tasks management
app.post('/api/admin/sponsor-tasks', async (req, res) => {
  try {
    const authTgid = getAuthTgid(req);
    if (!isAuthorizedAdmin(authTgid)) return res.status(403).json({ ok:false, message:'Forbidden' });
    const { title, url, reward, verifyType } = req.body || {};
    if (!title || !url || !reward) return res.status(400).json({ ok:false, message:'Введите title, url, reward' });
    const result = await db.createSponsorTask(title, url, reward, verifyType);
    res.json(result);
  } catch (err) { console.error('create sponsor task failed', err); res.status(500).json({ ok:false, message:'Internal error' }); }
});

app.patch('/api/admin/sponsor-tasks/:id', async (req, res) => {
  try {
    const authTgid = getAuthTgid(req);
    if (!isAuthorizedAdmin(authTgid)) return res.status(403).json({ ok:false, message:'Forbidden' });
    const id = Number(req.params.id);
    if (!id) return res.status(400).json({ ok:false, message:'Invalid id' });
    const result = await db.updateSponsorTask(id, req.body || {});
    res.json(result);
  } catch (err) { console.error('update sponsor task failed', err); res.status(500).json({ ok:false, message:'Internal error' }); }
});

// API endpoints
app.get('/api/user/:tgid', async (req, res) => {
  const tgid = parseInt(req.params.tgid, 10);
  if (!tgid) return res.status(400).json({ error: 'Invalid tgid' });
  const authTgid = getAuthTgid(req);
  if (authTgid && Number(authTgid)!==Number(tgid)) return res.status(403).json({ error: 'Auth mismatch' });
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
  const authTgid = getAuthTgid(req);
  if (authTgid && Number(authTgid)!==Number(tgid)) return res.status(403).json({ error: 'Auth mismatch' });
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
  const { direction, units, from, to, amount } = req.body || {};
  const authTgid = getAuthTgid(req);
  if (authTgid && Number(authTgid)!==Number(tgid)) return res.status(403).json({ error: 'Auth mismatch' });
  if (!tgid) return res.status(400).json({ error: 'Invalid params' });
  try {
    let result;
    if (from && to) {
      result = await db.exchange(tgid, String(from).toLowerCase(), String(to).toLowerCase(), Math.max(0, parseInt(amount || 0, 10)));
    } else if (direction) {
      result = await db.exchange(tgid, direction, Math.max(1, parseInt(units || 1, 10)));
    } else {
      return res.status(400).json({ error: 'Invalid params' });
    }
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
  const authTgid = getAuthTgid(req);
  if (authTgid && Number(authTgid)!==Number(tgid)) return res.status(403).json({ error: 'Auth mismatch' });
  if (!tgid || !type) return res.status(400).json({ error: 'Invalid params' });
  try {
    const result = await db.buyUpgrade(tgid, type);
    res.json(result);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Internal error' });
  }
});

// Daily streak endpoints
app.get('/api/user/:tgid/daily-streak', async (req, res) => {
  const tgid = parseInt(req.params.tgid, 10);
  if (!tgid) return res.status(400).json({ ok:false, message:'Invalid tgid' });
  try {
    const info = await db.getDailyStreak(tgid);
    res.json(info);
  } catch (err){ console.error('daily-streak error', err); res.status(500).json({ ok:false, message:'Internal error' }); }
});

app.post('/api/user/:tgid/claim-daily', async (req, res) => {
  const tgid = parseInt(req.params.tgid, 10);
  const authTgid = getAuthTgid(req);
  if (authTgid && Number(authTgid)!==Number(tgid)) return res.status(403).json({ ok:false, message:'Auth mismatch' });
  if (!tgid) return res.status(400).json({ ok:false, message:'Invalid tgid' });
  try {
    const result = await db.claimDailyReward(tgid);
    res.json(result);
  } catch (err){ console.error('claim-daily error', err); res.status(500).json({ ok:false, message:'Internal error' }); }
});

// Refill endpoint
app.post('/api/user/:tgid/refill', async (req, res) => {
  const tgid = parseInt(req.params.tgid, 10);
  const authTgid = getAuthTgid(req);
  if (authTgid && Number(authTgid)!==Number(tgid)) return res.status(403).json({ error: 'Auth mismatch' });
  if (!tgid) return res.status(400).json({ error: 'Invalid params' });
  try {
    const result = await db.refillToFull(tgid);
    res.json(result);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Internal error' });
  }
});

// Set referrer for a user (only if not set and not self-referral)
app.post('/api/user/:tgid/set-referrer', async (req, res) => {
  const tgid = parseInt(req.params.tgid, 10);
  const { referrer } = req.body || {};
  const authTgid = getAuthTgid(req);
  if (authTgid && Number(authTgid)!==Number(tgid)) return res.status(403).json({ error: 'Auth mismatch' });
  if (!tgid || !referrer) return res.status(400).json({ error: 'Invalid params' });
  try {
    const result = await db.setReferrer(tgid, Number(referrer));
    res.json(result);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Internal error' });
  }
});

// Auto-tick endpoint
app.post('/api/user/:tgid/auto-tick', async (req, res) => {
  const tgid = parseInt(req.params.tgid, 10);
  const authTgid = getAuthTgid(req);
  if (authTgid && Number(authTgid)!==Number(tgid)) return res.status(403).json({ error: 'Auth mismatch' });
  if (!tgid) return res.status(400).json({ error: 'Invalid params' });
  try {
    const result = await db.autoTick(tgid);
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
  const source = req.body.source || undefined; // 'task' | 'ad' | undefined
  const contextId = req.body.contextId ? String(req.body.contextId).slice(0, 256) : null;
  const authTgid = getAuthTgid(req);
  if (authTgid && Number(authTgid)!==Number(tgid)) return res.status(403).json({ error: 'Auth mismatch' });
  if (!tgid) return res.status(400).json({ error: 'Invalid params' });
  try {
    const result = await db.claimReward(tgid, amount, source, { contextId });
    if (!result.ok) {
      return res.status(429).json(result);
    }
    res.json(result);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Internal error' });
  }
});

app.post('/api/withdrawals', async (req, res) => {
  try {
    const body = req.body || {};
    const methodRaw = body.method;
    const optionRaw = body.optionId;
    const noteRaw = typeof body.note === 'string' ? body.note : '';
    const detailsRaw = isPlainObject(body.details) ? body.details : {};
    const authTgid = getAuthTgid(req);
    const bodyTgid = body && body.tgid !== undefined ? parseInt(body.tgid, 10) : null;
    if (authTgid && bodyTgid && Number(authTgid)!==Number(bodyTgid)) {
      return res.status(403).json({ ok:false, message:'Auth mismatch' });
    }
    const resolvedTgid = (authTgid !== null && authTgid !== undefined) ? Number(authTgid) : bodyTgid;
    if (!resolvedTgid || !Number.isFinite(resolvedTgid)) {
      return res.status(401).json({ ok:false, message:'Авторизуйтесь через Telegram MiniApp.' });
    }
    if (!methodRaw || !optionRaw) {
      return res.status(400).json({ ok:false, message:'Укажите способ вывода' });
    }
    const methodKey = String(methodRaw).toLowerCase();
    const optionId = String(optionRaw);
    const option = db.getWithdrawalOption(methodKey, optionId);
    if (!option) {
      return res.status(400).json({ ok:false, message:'Неверный вариант вывода' });
    }

    const profile = await fetchTelegramProfile(resolvedTgid);
    const metadata = {
      username: profile && profile.username ? profile.username : null,
      fullName: profile && profile.fullName ? profile.fullName : null,
      displayName: profile && profile.displayName ? profile.displayName : null
    };

    const creation = await db.createWithdrawalRequest(resolvedTgid, methodKey, optionId, detailsRaw, noteRaw, metadata);
    if (!creation.ok) {
      return res.status(400).json(creation);
    }

    const withdrawal = creation.withdrawal;
    const userSnapshot = await db.getOrCreateUser(resolvedTgid);

    await notifyAdminWithdrawal(withdrawal, userSnapshot, metadata);

    res.json({
      ok:true,
      message:'Заявка на вывод отправлена. Ожидайте ответа администратора.',
      scube: creation.scube,
      withdrawalId: withdrawal.id
    });
  } catch (err) {
    console.error('Withdrawal creation failed', err);
    res.status(500).json({ ok:false, message:'Не удалось отправить заявку. Попробуйте позже.' });
  }
});

// Leaderboard endpoint
app.get('/api/leaderboard', async (req, res) => {
  try {
    const by = (req.query.by === 'tasks') ? 'tasks' : 'clicks';
    const viewerRaw = req.query.viewer;
    const viewerTgid = viewerRaw ? parseInt(viewerRaw, 10) : undefined;
    const leaderboard = await db.getLeaderboard(by, Number.isFinite(viewerTgid) ? viewerTgid : undefined);
    res.json({ ok: true, by, entries: leaderboard.entries, viewer: leaderboard.viewer || null });
  } catch (err) {
    console.error(err);
    res.status(500).json({ ok:false, message: 'Internal error' });
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
      console.warn('Raw body:', raw);
      return res.status(400).json({ ok:false, message: 'Missing signature' });
    }
    const hmac = crypto.createHmac('sha256', ADSGRAM_SECRET);
    hmac.update(raw);
    const expected = hmac.digest('hex');
    if (!verifyAdsgramSignature(signatureHeader, expected)) {
      console.warn('Signature mismatch on AdsGram callback');
      console.warn('Received signature header:', signatureHeader);
      console.warn('Raw body (truncated):', raw && raw.substring(0,1000));
      return res.status(403).json({ ok:false, message: 'Invalid signature' });
    }

    const payload = req.body || {};
    const userId = payload.userId || payload.tgid || req.query.userId || req.query.tgid;
    if (!userId) return res.status(400).json({ ok:false, message: 'Missing userId' });
    const tgid = parseInt(userId, 10);
    if (!tgid) return res.status(400).json({ ok:false, message: 'Invalid userId' });

    const adUnit = payload.adUnit || payload.ad_unit || payload.adId || payload.ad_id || '';

    if (adUnit && ADSGRAM_INTERSTITIAL_ID && adUnit !== ADSGRAM_INTERSTITIAL_ID) {
      console.warn('Ad unit mismatch', { adUnit, expected: ADSGRAM_INTERSTITIAL_ID });
    }

    const rewardInfo = resolveAdsgramReward(payload);
    const contextId = extractAdsgramContextId(payload);
    const result = await db.claimReward(tgid, rewardInfo.amount, rewardInfo.source, { force: true, contextId });
    if (!result.ok) {
      console.warn('Failed to credit AdsGram reward', { tgid, message: result.message, contextId });
      const status = result.message === 'Слишком частые запросы награды' ? 429 : 400;
      return res.status(status).json({ ok:false, message: result.message || 'Reward not credited' });
    }
    return res.json({
      ok:true,
      credited: typeof result.credited === 'number' ? result.credited : rewardInfo.amount,
      scube: result.scube,
      source: result.source || rewardInfo.source,
      duplicate: Boolean(result.duplicate)
    });
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
