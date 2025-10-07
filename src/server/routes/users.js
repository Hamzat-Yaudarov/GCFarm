function attachUserRoutes(app, { db, auth }){
  // Ensure user API responses are not cached by proxies or the browser.
  // Some reverse proxies may respond with 304 Not Modified when the client
  // sends conditional requests; force dynamic responses to always be fresh.
  app.use('/api/user', (req, res, next) => {
    res.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    res.set('Pragma', 'no-cache');
    res.set('Expires', '0');
    next();
  });
  const { getAuthTgid } = auth;
  app.get('/api/user/:tgid', async (req, res) => {
    const tgid = parseInt(req.params.tgid, 10);
    if (!tgid) return res.status(400).json({ error: 'Invalid tgid' });
    const authTgid = getAuthTgid(req);
    if (authTgid && Number(authTgid)!==Number(tgid)) return res.status(403).json({ error: 'Auth mismatch' });
    try { const user = await db.getOrCreateUser(tgid); res.json(user); } catch (err) { res.status(500).json({ error: 'Internal error' }); }
  });
  app.post('/api/user/:tgid/click', async (req, res) => {
    const tgid = parseInt(req.params.tgid, 10);
    if (!tgid) return res.status(400).json({ error: 'Invalid tgid' });
    const authTgid = getAuthTgid(req);
    if (authTgid && Number(authTgid)!==Number(tgid)) return res.status(403).json({ error: 'Auth mismatch' });
    try { const result = await db.handleClick(tgid); res.json(result); } catch (err) { res.status(500).json({ error: 'Internal error' }); }
  });
  app.post('/api/user/:tgid/exchange', async (req, res) => {
    const tgid = parseInt(req.params.tgid, 10);
    const { direction, units, from, to, amount } = req.body || {};
    const authTgid = getAuthTgid(req);
    if (authTgid && Number(authTgid)!==Number(tgid)) return res.status(403).json({ error: 'Auth mismatch' });
    if (!tgid) return res.status(400).json({ error: 'Invalid params' });
    try { let result; if (from && to) result = await db.exchange(tgid, String(from).toLowerCase(), String(to).toLowerCase(), Math.max(0, parseInt(amount || 0, 10))); else if (direction) result = await db.exchange(tgid, direction, Math.max(1, parseInt(units || 1, 10))); else return res.status(400).json({ error: 'Invalid params' }); res.json(result); } catch (err) { res.status(500).json({ error: 'Internal error' }); }
  });
  app.post('/api/user/:tgid/buy-upgrade', async (req, res) => {
    const tgid = parseInt(req.params.tgid, 10);
    const { type } = req.body || {};
    const authTgid = getAuthTgid(req);
    if (authTgid && Number(authTgid)!==Number(tgid)) return res.status(403).json({ error: 'Auth mismatch' });
    if (!tgid || !type) return res.status(400).json({ error: 'Invalid params' });
    try { const result = await db.buyUpgrade(tgid, type); res.json(result); } catch (err) { res.status(500).json({ error: 'Internal error' }); }
  });
  app.get('/api/user/:tgid/daily-streak', async (req, res) => {
    const tgid = parseInt(req.params.tgid, 10);
    if (!tgid) return res.status(400).json({ ok:false, message:'Invalid tgid' });
    try { const info = await db.getDailyStreak(tgid); res.json(info); } catch (err){ res.status(500).json({ ok:false, message:'Internal error' }); }
  });
  app.post('/api/user/:tgid/claim-daily', async (req, res) => {
    const tgid = parseInt(req.params.tgid, 10);
    const authTgid = getAuthTgid(req);
    if (authTgid && Number(authTgid)!==Number(tgid)) return res.status(403).json({ ok:false, message:'Auth mismatch' });
    if (!tgid) return res.status(400).json({ ok:false, message:'Invalid tgid' });
    try { const result = await db.claimDailyReward(tgid); res.json(result); } catch (err){ res.status(500).json({ ok:false, message:'Internal error' }); }
  });
  app.post('/api/user/:tgid/refill', async (req, res) => {
    const tgid = parseInt(req.params.tgid, 10);
    const authTgid = getAuthTgid(req);
    if (authTgid && Number(authTgid)!==Number(tgid)) return res.status(403).json({ error: 'Auth mismatch' });
    if (!tgid) return res.status(400).json({ error: 'Invalid params' });
    try { const result = await db.refillToFull(tgid); res.json(result); } catch (err) { res.status(500).json({ error: 'Internal error' }); }
  });
  app.post('/api/user/:tgid/auto-tick', async (req, res) => {
    const tgid = parseInt(req.params.tgid, 10);
    const authTgid = getAuthTgid(req);
    if (authTgid && Number(authTgid)!==Number(tgid)) return res.status(403).json({ error: 'Auth mismatch' });
    if (!tgid) return res.status(400).json({ error: 'Invalid params' });
    try { const result = await db.autoTick(tgid); res.json(result); } catch (err) { res.status(500).json({ error: 'Internal error' }); }
  });
  app.post('/api/user/:tgid/claim-reward', async (req, res) => {
    const tgid = parseInt(req.params.tgid, 10);
    const amount = parseInt(req.body.amount || 5, 10);
    const source = req.body.source || undefined;
    const contextId = req.body.contextId ? String(req.body.contextId).slice(0, 256) : null;
    const authTgid = getAuthTgid(req);
    if (authTgid && Number(authTgid)!==Number(tgid)) return res.status(403).json({ error: 'Auth mismatch' });
    if (!tgid) return res.status(400).json({ error: 'Invalid params' });
    try { const result = await db.claimReward(tgid, amount, source, { contextId }); if (!result.ok) return res.status(429).json(result); res.json(result); } catch (err) { res.status(500).json({ error: 'Internal error' }); }
  });
  app.get('/api/leaderboard', async (req, res) => {
    try { const by = (req.query.by === 'tasks') ? 'tasks' : 'clicks'; const viewerRaw = req.query.viewer; const viewerTgid = viewerRaw ? parseInt(viewerRaw, 10) : undefined; const leaderboard = await db.getLeaderboard(by, Number.isFinite(viewerTgid) ? viewerTgid : undefined); res.json({ ok: true, by, entries: leaderboard.entries, viewer: leaderboard.viewer || null }); } catch (err) { res.status(500).json({ ok:false, message: 'Internal error' }); }
  });

  // Referrals stats
  app.get('/api/user/:tgid/referrals', async (req, res) => {
    const tgid = parseInt(req.params.tgid, 10);
    if (!tgid) return res.status(400).json({ ok:false, message:'Invalid tgid' });
    try {
      const stats = await db.getReferralStats(tgid);
      res.json(Object.assign({ ok:true }, stats || { invited:0, earned:0 }));
    } catch(e){ res.status(500).json({ ok:false, message:'Internal error' }); }
  });
}

module.exports = { attachUserRoutes };
