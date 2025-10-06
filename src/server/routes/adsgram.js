const crypto = require('crypto');
const { verifyAdsgramSignature, resolveAdsgramReward, extractAdsgramContextId } = require('../lib/adsgram');

function attachAdsgramRoutes(app, { db, ADSGRAM_SECRET, ADSGRAM_INTERSTITIAL_ID }){
  app.get('/reward', (req, res) => {
    const tgid = req.query.tgid || req.query.userId || '';
    res.send(`<!doctype html><html><head><meta charset="utf-8"><title>Reward</title></head><body><h2>Reward landing (placeholder)</h2><p>После просмотра рекламы нажмите кнопку, чтобы получить награду.</p><form method="post" action="/api/user/${tgid}/claim-reward"><input type="hidden" name="amount" value="5"><button type="submit">Забрать 5 SCube</button></form></body></html>`);
  });
  app.post('/adsgram/callback', async (req, res) => {
    try {
      const signatureHeader = req.headers['x-adsgram-signature'] || req.headers['x-signature'] || req.headers['signature'];
      const raw = req.rawBody || '';
      if (!signatureHeader) { return res.status(400).json({ ok:false, message: 'Missing signature' }); }
      const hmac = crypto.createHmac('sha256', ADSGRAM_SECRET);
      hmac.update(raw);
      const expected = hmac.digest('hex');
      if (!verifyAdsgramSignature(signatureHeader, expected)) { return res.status(403).json({ ok:false, message: 'Invalid signature' }); }
      const payload = req.body || {};
      const userId = payload.userId || payload.tgid || req.query.userId || req.query.tgid;
      if (!userId) return res.status(400).json({ ok:false, message: 'Missing userId' });
      const tgid = parseInt(userId, 10);
      if (!tgid) return res.status(400).json({ ok:false, message: 'Invalid userId' });
      const adUnit = payload.adUnit || payload.ad_unit || payload.adId || payload.ad_id || '';
      if (adUnit && ADSGRAM_INTERSTITIAL_ID && adUnit !== ADSGRAM_INTERSTITIAL_ID) { /* log only */ }
      const rewardInfo = resolveAdsgramReward(payload);
      const contextId = extractAdsgramContextId(payload);
      const result = await db.claimReward(tgid, rewardInfo.amount, rewardInfo.source, { force: true, contextId });
      if (!result.ok) { const status = result.message === 'Слишком частые запросы награды' ? 429 : 400; return res.status(status).json({ ok:false, message: result.message || 'Reward not credited' }); }
      return res.json({ ok:true, credited: typeof result.credited === 'number' ? result.credited : rewardInfo.amount, scube: result.scube, source: result.source || rewardInfo.source, duplicate: Boolean(result.duplicate) });
    } catch (err) { return res.status(500).json({ ok:false, message: 'Server error' }); }
  });
}

module.exports = { attachAdsgramRoutes };
