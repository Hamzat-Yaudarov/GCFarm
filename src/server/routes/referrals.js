function attachReferralRoutes(app, { db, auth, BOT_USERNAME, BASE_URL }){
  const { getAuthTgid } = auth;

  app.get('/api/referrals/:tgid', async (req, res)=>{
    const tgid = parseInt(req.params.tgid, 10);
    if (!tgid) return res.status(400).json({ ok:false, message:'Invalid tgid' });
    try {
      const { count, earned } = await db.getReferralInfo(tgid);
      const bot = String(BOT_USERNAME || '').trim();
      const link = bot ? `https://t.me/${bot}?start=${tgid}` : `${String(BASE_URL||'').replace(/\/$/,'')}/miniapp?ref=${tgid}`;
      return res.json({ ok:true, tgid, count, earned, link });
    } catch (err){ return res.status(500).json({ ok:false, message:'Internal error' }); }
  });

  app.post('/api/user/:tgid/set-referrer', async (req, res)=>{
    const tgid = parseInt(req.params.tgid, 10);
    const referrer = req.body && req.body.referrer ? parseInt(req.body.referrer, 10) : 0;
    const authTgid = getAuthTgid(req);
    if (authTgid && Number(authTgid)!==Number(tgid)) return res.status(403).json({ ok:false, message:'Auth mismatch' });
    if (!tgid || !referrer) return res.status(400).json({ ok:false, message:'Invalid params' });
    try {
      const result = await db.setReferrer(tgid, referrer);
      if (!result || result.ok === false) return res.status(400).json(result || { ok:false, message:'Failed' });
      return res.json({ ok:true });
    } catch (err){ return res.status(500).json({ ok:false, message:'Internal error' }); }
  });
}

module.exports = { attachReferralRoutes };
