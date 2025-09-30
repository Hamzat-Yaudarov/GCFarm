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
    state: room.state
  };
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
    state: game === 'rps' ? { moves: {} } : { board: Array(9).fill(null), turn: null, symbols: {}, winner: null }
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
    const { tgid, game, bet } = req.body || {};
    const G = (game === 'ttt') ? 'ttt' : 'rps';
    const B = Math.max(1, parseInt(bet,10)||0);
    if (!tgid || !B) return res.status(400).json({ ok:false, message:'Invalid params' });
    if (userActiveRoom.get(String(tgid))) return res.json({ ok:false, message:'У вас уже есть активная комната' });
    const reserve = await db.tryReserveScube(tgid, B);
    if (!reserve.ok) return res.json(reserve);
    const room = createRoom(tgid, G, B);
    if (G==='ttt') { room.state.turn = Math.random()<0.5 ? String(room.creator) : null; }
    res.json({ ok:true, room: serializeRoom(room) });
  } catch (err){ console.error(err); res.status(500).json({ ok:false, message:'Server error' }); }
});

// Join room
app.post('/api/games/rooms/:id/join', async (req, res)=>{
  try{
    const id = req.params.id;
    const { tgid } = req.body || {};
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
    const { tgid } = req.body || {};
    if (!tgid) return res.status(400).json({ ok:false, message:'Invalid player' });
    if (room.status!=='active' && room.status!=='waiting') return res.json({ ok:false, message:'Игра завершена' });
    if (room.game==='rps'){
      const move = String(req.body.move||'').toLowerCase();
      if (!['rock','paper','scissors'].includes(move)) return res.status(400).json({ ok:false, message:'Invalid move' });
      room.state.moves[String(tgid)] = move;
      if (room.opponent && room.state.moves[String(room.creator)] && room.state.moves[String(room.opponent)]){
        const a = room.state.moves[String(room.creator)];
        const b = room.state.moves[String(room.opponent)];
        const out = rpsOutcome(a,b);
        if (out===0){ // draw
          await db.creditScube(room.creator, room.bet);
          await db.creditScube(room.opponent, room.bet);
          room.status = 'finished';
          room.state.result = { type:'draw', a, b };
        } else if (out===1){
          const win = room.bet*2;
          await db.creditScube(room.creator, win);
          room.status = 'finished';
          room.state.result = { type:'win', winner: String(room.creator), a, b };
        } else {
          const win = room.bet*2;
          await db.creditScube(room.opponent, win);
          room.status = 'finished';
          room.state.result = { type:'win', winner: String(room.opponent), a, b };
        }
      }
      return res.json({ ok:true, room: serializeRoom(room) });
    } else if (room.game==='ttt'){
      const idx = parseInt(req.body.idx,10);
      if (!(idx>=0 && idx<9)) return res.status(400).json({ ok:false, message:'Invalid cell' });
      const sym = room.state.symbols[String(tgid)];
      if (!sym) return res.status(403).json({ ok:false, message:'Not a player' });
      if (room.state.turn !== String(tgid)) return res.json({ ok:false, message:'Хо�� соперника' });
      if (room.state.board[idx]) return res.json({ ok:false, message:'Клетка занята' });
      room.state.board[idx] = sym;
      const w = tttCheckWinner(room.state.board);
      if (w==='draw'){
        await db.creditScube(room.creator, room.bet);
        await db.creditScube(room.opponent, room.bet);
        room.status='finished';
        room.state.winner = null;
      } else if (w){
        const winnerTgid = Object.entries(room.state.symbols).find(([,s])=>s===w)[0];
        await db.creditScube(Number(winnerTgid), room.bet*2);
        room.status='finished';
        room.state.winner = winnerTgid;
      } else {
        const next = (String(tgid)===String(room.creator)) ? String(room.opponent) : String(room.creator);
        room.state.turn = next;
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
    const { tgid } = req.body || {};
    if (!room) return res.status(404).json({ ok:false, message:'Room not found' });
    const isCreator = String(room.creator)===String(tgid);
    const isOpponent = String(room.opponent||'')===String(tgid);
    if (!isCreator && !isOpponent) return res.status(403).json({ ok:false, message:'Not a participant' });

    if (room.status==='waiting'){
      // refund creator and close
      await db.creditScube(room.creator, room.bet);
      room.status='finished';
    } else if (room.status==='active'){
      // forfeit: pay full pot to the other
      const winner = isCreator ? room.opponent : room.creator;
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

// Refill endpoint
app.post('/api/user/:tgid/refill', async (req, res) => {
  const tgid = parseInt(req.params.tgid, 10);
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
