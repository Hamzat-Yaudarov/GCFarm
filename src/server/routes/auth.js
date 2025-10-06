function attachAuthRoutes(app, { auth }){
  const { verifyTelegramInitData, signSession, SESSION_TTL } = auth;
  app.post('/auth/telegram', async (req, res) => {
    try {
      const initData = (req.body && req.body.initData) || '';
      const params = new URLSearchParams(initData);
      const userRaw = params.get('user');
      const parsedUser = userRaw ? JSON.parse(userRaw) : null;
      const uid = verifyTelegramInitData(initData);
      if (!uid) return res.status(401).json({ ok:false, message:'Invalid init data' });
      try {
        if (parsedUser && app.locals.db) {
          const first = parsedUser.first_name || '';
          const last = parsedUser.last_name || '';
          const uname = parsedUser.username ? `@${parsedUser.username}` : '';
          const displayName = String((first + ' ' + last).trim() || uname || 'Игрок');
          await app.locals.db.ensureUser(uid, displayName);
        }
      } catch (e) {}
      const ts = Math.floor(Date.now()/1000);
      const token = signSession(uid, ts);
      const isProd = String(process.env.NODE_ENV||'').toLowerCase() === 'production';
      const cookie = `session=${encodeURIComponent(token)}; Max-Age=${SESSION_TTL}; Path=/; SameSite=Strict${isProd?'; Secure':''}; HttpOnly`;
      res.setHeader('Set-Cookie', cookie);
      return res.json({ ok:true, tgid: uid });
    } catch (e) { return res.status(500).json({ ok:false, message:'Server error' }); }
  });
}

module.exports = { attachAuthRoutes };
