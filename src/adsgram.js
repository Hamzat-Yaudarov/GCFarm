import crypto from 'crypto';
import express from 'express';
import { pool } from './db.js';

export const adsGramRouter = express.Router();

function verifySignature(payload, signature, secret) {
  if (!secret) return true;
  const hmac = crypto.createHmac('sha256', secret);
  hmac.update(payload);
  const expected = hmac.digest('hex');
  try {
    return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(signature || '', 'hex'));
  } catch {
    return false;
  }
}

function parseInitData(initData) {
  try {
    const params = new URLSearchParams(initData);
    const userStr = params.get('user');
    const hash = params.get('hash');
    const botToken = process.env.TG_BOT_TOKEN || '';
    const secret = crypto.createHash('sha256').update(botToken).digest();
    const check = [];
    for (const [key, value] of params.entries()) if (key !== 'hash') check.push(`${key}=${value}`);
    check.sort();
    const dataCheckString = check.join('\n');
    const hmac = crypto.createHmac('sha256', secret).update(dataCheckString).digest('hex');
    if (hmac !== hash) return null;
    const user = JSON.parse(userStr);
    return user?.id ? String(user.id) : null;
  } catch {
    return null;
  }
}

async function applyReward(userId, slug) {
  if (!userId) return false;
  const { rows } = await pool.query('select * from users where tg_id=$1', [userId]);
  if (!rows.length) return false;
  const u = rows[0];
  let type = 'energy';
  let amount = 0;
  if (slug) {
    const r = await pool.query('select reward_type, reward_amount from ad_rewards where slug=$1', [slug]);
    if (r.rows.length) { type = r.rows[0].reward_type; amount = Number(r.rows[0].reward_amount) || 0; }
  }
  if (type === 'energy') {
    const capacity = Number(u.energy_capacity);
    await pool.query('update users set energy_current=$2 where tg_id=$1', [userId, capacity]);
  } else if (type === 'scube') {
    await pool.query('update users set scube=scube+$2 where tg_id=$1', [userId, Math.max(0, amount)]);
  } else if (type === 'gcube') {
    await pool.query('update users set gcube=gcube+$2 where tg_id=$1', [userId, Math.max(0, amount)]);
  }
  return true;
}

adsGramRouter.post('/reward', express.urlencoded({ extended: false }), async (req, res) => {
  try {
    const secret = process.env.ADSGRAM_SECRET;
    const raw = new URLSearchParams(req.body).toString();
    const signature = req.headers['x-signature'] || req.body.signature || '';
    if (!verifySignature(raw, signature, secret)) return res.status(401).send('invalid signature');

    let userId = req.body.user_id;
    if (!userId) userId = parseInitData(req.headers['x-init-data']);
    if (!userId) return res.status(400).send('missing user_id');

    const slug = req.body.slug || null;
    await applyReward(userId, slug);
    return res.json({ ok: true });
  } catch (e) {
    console.error('AdsGram reward error', e);
    return res.status(500).send('server error');
  }
});

adsGramRouter.get('/reward', async (req, res) => {
  try {
    const secret = process.env.ADSGRAM_SECRET;
    const raw = new URLSearchParams(req.query).toString();
    const signature = req.headers['x-signature'] || req.query.signature || '';
    if (!verifySignature(raw, signature, secret)) return res.status(401).send('invalid signature');

    let userId = req.query.user_id;
    if (!userId) userId = parseInitData(req.headers['x-init-data']);
    if (!userId) return res.status(400).send('missing user_id');

    const slug = req.query.slug || null;
    await applyReward(userId, slug);
    return res.json({ ok: true });
  } catch (e) {
    console.error('AdsGram reward error', e);
    return res.status(500).send('server error');
  }
});

adsGramRouter.all('/reward/:slug', express.urlencoded({ extended: false }), async (req, res) => {
  try {
    const slug = req.params.slug;
    const secret = process.env.ADSGRAM_SECRET;
    const raw = req.method === 'GET' ? new URLSearchParams(req.query).toString() : new URLSearchParams(req.body).toString();
    const signature = req.headers['x-signature'] || (req.method === 'GET' ? req.query.signature : req.body.signature) || '';
    if (!verifySignature(raw, signature, secret)) return res.status(401).send('invalid signature');

    let userId = req.method === 'GET' ? (req.query.user_id || null) : (req.body.user_id || null);
    if (!userId) userId = parseInitData(req.headers['x-init-data']);
    if (!userId) return res.status(400).send('missing user_id');

    await applyReward(String(userId), slug);
    return res.json({ ok: true });
  } catch (e) {
    console.error('AdsGram slug reward error', e);
    return res.status(500).send('server error');
  }
});
