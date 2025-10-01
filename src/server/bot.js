const express = require('express');
const { Telegraf } = require('telegraf');
const bodyParser = require('body-parser');
const path = require('path');
const crypto = require('crypto');
const db = require('./db');

const TG_BOT_TOKEN = process.env.TG_BOT_TOKEN;
const BASE_URL = process.env.BASE_URL || 'http://localhost:3000';
const BOT_USERNAME = process.env.BOT_USERNAME || '';
const BOT_WEBAPP_PATH = process.env.BOT_WEBAPP_PATH || '';
const PORT = process.env.PORT || 3000;
const ADSGRAM_SECRET = process.env.ADSGRAM_SECRET || 'c6a7a8b7cd30418d9844aebc37b6aaf2';
const ADSGRAM_INTERSTITIAL_ID = process.env.ADSGRAM_INTERSTITIAL_ID || 'int-15441';

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

const bot = new Telegraf(TG_BOT_TOKEN);

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
    await ctx.reply(`Привет, ${firstName}! Добро пожаловать в игру. Нажми кнопку, чтобы открыть MiniApp.`, {
      reply_markup: {
        inline_keyboard: [[{ text: 'Открыть игру', web_app: { url: webAppUrl } }]]
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
  const authTgid = getAuthTgid(req);
  if (authTgid && Number(authTgid)!==Number(tgid)) return res.status(403).json({ error: 'Auth mismatch' });
  if (!tgid) return res.status(400).json({ error: 'Invalid params' });
  try {
    const result = await db.claimReward(tgid, amount, source);
    res.json(result);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Internal error' });
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

// Clan and Competition endpoints

// Create clan
app.post('/api/clans', async (req, res) => {
  const authTgid = getAuthTgid(req);
  const tgid = authTgid || (req.body && req.body.tgid);
  const { name, tag, description } = req.body || {};
  if (!tgid || !name) return res.status(400).json({ ok:false, message:'Invalid params' });
  try {
    const result = await db.createClan(tgid, name, tag, description);
    res.json(result);
  } catch (err) { console.error(err); res.status(500).json({ ok:false, message:'Internal error' }); }
});

// Join clan (simple open join)
app.post('/api/clans/:id/join', async (req, res) => {
  const authTgid = getAuthTgid(req);
  const tgid = authTgid || (req.body && req.body.tgid);
  const clanId = parseInt(req.params.id, 10);
  if (!tgid || !clanId) return res.status(400).json({ ok:false, message:'Invalid params' });
  try {
    const result = await db.addMemberToClan(clanId, tgid, 'member');
    res.json(result);
  } catch (err) { console.error(err); res.status(500).json({ ok:false, message:'Internal error' }); }
});

// Leave clan
app.post('/api/clans/:id/leave', async (req, res) => {
  const authTgid = getAuthTgid(req);
  const tgid = authTgid || (req.body && req.body.tgid);
  const clanId = parseInt(req.params.id, 10);
  if (!tgid || !clanId) return res.status(400).json({ ok:false, message:'Invalid params' });
  try {
    const result = await db.removeMemberFromClan(clanId, tgid);
    res.json(result);
  } catch (err) { console.error(err); res.status(500).json({ ok:false, message:'Internal error' }); }
});

// Start matchmaking search for clan competition
app.post('/api/competitions/start-search', async (req, res) => {
  const authTgid = getAuthTgid(req);
  const tgid = authTgid || (req.body && req.body.tgid);
  const clanId = req.body && req.body.clan_id;
  if (!tgid || !clanId) return res.status(400).json({ ok:false, message:'Invalid params' });
  try {
    const result = await db.startCompetitionSearch(clanId);
    res.json(result);
  } catch (err) { console.error(err); res.status(500).json({ ok:false, message:'Internal error' }); }
});

// Join an existing pending competition (matchmake)
app.post('/api/competitions/join-search', async (req, res) => {
  const authTgid = getAuthTgid(req);
  const tgid = authTgid || (req.body && req.body.tgid);
  const clanId = req.body && req.body.clan_id;
  if (!tgid || !clanId) return res.status(400).json({ ok:false, message:'Invalid params' });
  try {
    const result = await db.joinCompetitionSearch(clanId);
    res.json(result);
  } catch (err) { console.error(err); res.status(500).json({ ok:false, message:'Internal error' }); }
});

// Contribute to competition (convert SCube to coins)
app.post('/api/competitions/:id/contribute', async (req, res) => {
  const authTgid = getAuthTgid(req);
  const tgid = authTgid || (req.body && req.body.tgid);
  const competitionId = parseInt(req.params.id, 10);
  const scube = Math.max(0, parseInt(req.body && req.body.scube || 0, 10));
  if (!tgid || !competitionId || scube <= 0) return res.status(400).json({ ok:false, message:'Invalid params' });
  try {
    const result = await db.contributeToCompetition(competitionId, tgid, scube);
    res.json(result);
  } catch (err) { console.error(err); res.status(500).json({ ok:false, message:'Internal error' }); }
});

// Get clans of current user
app.get('/api/clans/me', async (req, res) => {
  const authTgid = getAuthTgid(req);
  const tgid = authTgid || (req.query && req.query.tgid);
  if (!tgid) return res.status(400).json({ ok:false, message:'Invalid params' });
  try {
    // fetch clan memberships
    const client = await (async ()=>{ const pool = require('./db')._pool || null; return null; })().catch(()=>null);
    // fallback: use db.getClanMemberByTgid
    const rows = await db.getClanMemberByTgid(Number(tgid));
    // fetch clan details for each
    const clans = [];
    for (const r of rows) {
      const clan = await (async ()=>{ try { return await db.getClan(r.clan_id); } catch(e){ return null; } })();
      if (clan) clans.push(Object.assign({}, clan, { role: r.role }));
    }
    res.json({ ok:true, clans });
  } catch (err) { console.error(err); res.status(500).json({ ok:false, message:'Internal error' }); }
});

// Purchase building (leader/co_leader)
app.post('/api/competitions/:id/buildings/:buildingId/purchase', async (req, res) => {
  const authTgid = getAuthTgid(req);
  const tgid = authTgid || (req.body && req.body.tgid);
  const competitionId = parseInt(req.params.id, 10);
  const buildingId = parseInt(req.params.buildingId, 10);
  if (!tgid || !competitionId || !buildingId) return res.status(400).json({ ok:false, message:'Invalid params' });
  try {
    // determine which clan user belongs to for this competition
    const comp = await db.getCompetition(competitionId).catch(()=>null);
    let clanId = null;
    if (comp) {
      // find clan of user
      const member = await db.getClanMemberByTgid(tgid).catch(()=>null);
    }
    // instead of complicated logic here, require clan_id in body
    const clan_id = req.body && req.body.clan_id;
    if (!clan_id) return res.status(400).json({ ok:false, message:'clan_id required in body' });
    const result = await db.purchaseBuilding(competitionId, buildingId, clan_id, tgid);
    res.json(result);
  } catch (err) { console.error(err); res.status(500).json({ ok:false, message:'Internal error' }); }
});

// Finish competition (admin or scheduled job)
app.post('/api/competitions/:id/finish', async (req, res) => {
  const authTgid = getAuthTgid(req);
  // restrict to ADMIN_ID or server cron
  const adminId = process.env.ADMIN_ID;
  if (adminId && String(authTgid) !== String(adminId)) return res.status(403).json({ ok:false, message:'Forbidden' });
  const competitionId = parseInt(req.params.id, 10);
  if (!competitionId) return res.status(400).json({ ok:false, message:'Invalid params' });
  try {
    const result = await db.finishCompetition(competitionId);
    res.json(result);
  } catch (err) { console.error(err); res.status(500).json({ ok:false, message:'Internal error' }); }
});

// Get competition map (buildings + owners)
app.get('/api/competitions/:id/map', async (req, res) => {
  const competitionId = parseInt(req.params.id, 10);
  if (!competitionId) return res.status(400).json({ ok:false, message:'Invalid params' });
  try {
    const map = await db.getCompetitionMap(competitionId);
    res.json({ ok:true, map });
  } catch (err) { console.error(err); res.status(500).json({ ok:false, message:'Internal error' }); }
});

// Get competition status (coins totals and contributions summary)
app.get('/api/competitions/:id/status', async (req, res) => {
  const competitionId = parseInt(req.params.id, 10);
  if (!competitionId) return res.status(400).json({ ok:false, message:'Invalid params' });
  try {
    const comp = await db.getCompetition(competitionId);
    if (!comp) return res.status(404).json({ ok:false, message:'Not found' });
    const coinsMap = await db.computeCompetitionCoins(competitionId);
    // also include payouts so far
    const payouts = await (async ()=>{
      const client = await db._getClient ? db._getClient() : null; // fallback: not exposed
      try {
        // reuse db query directly
        const q = await (async ()=>{ const pg = require('pg'); return null; })();
        return [];
      } catch(e){ return []; }
    })();
    res.json({ ok:true, competition: comp, coins: coinsMap || {}, payouts: [] });
  } catch (err) { console.error(err); res.status(500).json({ ok:false, message:'Internal error' }); }
});

// admin endpoint to trigger payout tick manually
app.post('/api/admin/payout-tick', async (req, res) => {
  const authTgid = getAuthTgid(req);
  const adminId = process.env.ADMIN_ID;
  if (!adminId || String(authTgid) !== String(adminId)) return res.status(403).json({ ok:false, message:'Forbidden' });
  try {
    const result = await db.runPayoutTick();
    res.json({ ok:true, result });
  } catch (err) { console.error(err); res.status(500).json({ ok:false, message:'Internal error' }); }
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
    // compute HMAC-SHA256
    const hmac = crypto.createHmac('sha256', ADSGRAM_SECRET);
    hmac.update(raw);
    const expected = hmac.digest('hex');
    try {
      if (!crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(signatureHeader))) {
        console.warn('Signature mismatch on AdsGram callback');
        console.warn('Received signature header:', signatureHeader);
        console.warn('Raw body (truncated):', raw && raw.substring(0,1000));
        return res.status(403).json({ ok:false, message: 'Invalid signature' });
      }
    } catch (e) {
      console.warn('Signature comparison error', e);
      console.warn('Received signature header:', signatureHeader);
      console.warn('Raw body (truncated):', raw && raw.substring(0,1000));
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

    const result = await db.claimReward(tgid, amount, 'ad');
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
      // start payout tick scheduler (30 minutes)
      try {
        const intervalMs = 30 * 60 * 1000; // 30 minutes
        if (!global.__payoutTickInterval) {
          global.__payoutTickInterval = setInterval(async ()=>{
            try {
              console.log('Running scheduled payout tick');
              await db.runPayoutTick();
            } catch (e) { console.warn('Scheduled payout tick error', e); }
          }, intervalMs);
        }
      } catch(e){ console.warn('Failed to start payout scheduler', e); }

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
