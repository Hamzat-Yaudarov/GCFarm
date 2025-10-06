function attachSubgramRoutes(app, { subgram, auth }){
  const { getAuthTgid } = auth;
  app.get('/api/subgram/status', async (req, res) => {
    try {
      const config = subgram.getConfig();
      const authTgid = getAuthTgid(req);
      const queryTgidRaw = req.query && req.query.tgid;
      const queryTgid = queryTgidRaw !== undefined ? parseInt(queryTgidRaw, 10) : null;
      const hasAuth = typeof authTgid === 'number' && Number.isFinite(authTgid);
      const hasQuery = typeof queryTgid === 'number' && Number.isFinite(queryTgid);
      if (hasAuth && hasQuery && Number(authTgid) !== Number(queryTgid)) {
        return res.status(403).json({ ok: false, message: 'Auth mismatch', enabled: config.enabled, botUrl: config.botUrl, requiredLinks: config.links });
      }
      const resolvedTgid = hasAuth ? Number(authTgid) : (hasQuery ? Number(queryTgid) : null);
      if (!resolvedTgid) { return res.status(400).json({ ok: false, message: 'tgid is required', enabled: config.enabled, botUrl: config.botUrl, requiredLinks: config.links, recheckAfterSeconds: config.recheckAfterSeconds }); }
      const status = await subgram.checkUserSubscriptions(resolvedTgid);
      return res.json({ ok: true, tgid: resolvedTgid, enabled: status.enabled, subscribed: status.subscribed, sponsors: status.sponsors, error: status.error, temporaryBypass: Boolean(status.temporaryBypass), botUrl: config.botUrl, requiredLinks: config.links, recheckAfterSeconds: status.recheckAfterSeconds || config.recheckAfterSeconds });
    } catch (err) {
      const config = subgram.getConfig();
      return res.status(500).json({ ok: false, message: 'SubGram status check failed', enabled: config.enabled, botUrl: config.botUrl, requiredLinks: config.links });
    }
  });

  // Webhook endpoint for SubGram events
  app.post('/webhook/subgram', async (req, res) => {
    try {
      const apiKey = (req.headers['api-key'] || req.headers['Api-Key'] || req.headers['Api-Key'.toLowerCase()]);
      const expected = String(process.env.SUBGRAM_API_TOKEN || '').trim();
      if (!expected || String(apiKey || '').trim() !== expected) {
        return res.status(401).send('Unauthorized');
      }
      const payload = req.body || {};
      const events = Array.isArray(payload.webhooks) ? payload.webhooks : [];
      // respond early
      res.status(200).send('OK');

      if (!events.length) return;
      const client = app.locals.db && app.locals.db.pool ? app.locals.db.pool : null;
      // use db pool if available
      let pool = null;
      try {
        const dbModule = require('../db');
        pool = require('../db/pool').pool;
      } catch (e) { pool = null; }

      for (const ev of events) {
        try {
          const webhookId = ev.webhook_id ? Number(ev.webhook_id) : null;
          const link = ev.link || null;
          const userId = ev.user_id ? Number(ev.user_id) : null;
          const botId = ev.bot_id ? Number(ev.bot_id) : null;
          const status = ev.status || null;
          const subscribeDate = ev.subscribe_date ? String(ev.subscribe_date) : null;

          if (pool && webhookId) {
            try {
              await pool.query(`INSERT INTO subgram_events (webhook_id, link, user_id, bot_id, status, subscribe_date, payload) VALUES ($1,$2,$3,$4,$5,$6,$7) ON CONFLICT (webhook_id) DO NOTHING`, [webhookId, link, userId, botId, status, subscribeDate, ev]);
            } catch (e) { /* ignore insert errors */ }
          }

          // Optional penalty: if enabled via env SUBGRAM_PENALIZE_UNSUBSCRIPTION=1 and status is 'unsubscribed' and subscribe_date within X days
          const penalize = String(process.env.SUBGRAM_PENALIZE_UNSUBSCRIPTION || '').trim() === '1';
          const days = parseInt(process.env.SUBGRAM_PENALIZE_DAYS || '7', 10) || 7;
          if (penalize && status === 'unsubscribed' && userId && subscribeDate && pool) {
            try {
              const subDate = new Date(subscribeDate + 'T00:00:00Z');
              const now = new Date();
              const diffDays = Math.floor((now - subDate) / (1000*60*60*24));
              if (diffDays < days) {
                // increment complaints counter for recent unsubscribes
                try {
                  await pool.query('UPDATE users SET complaints = COALESCE(complaints,0) + 1 WHERE tgid = $1', [userId]);
                } catch (e) { /* ignore update errors */ }
              }
            } catch (e) { /* ignore */ }
          }
        } catch (e) { /* ignore per-event errors */ }
      }
    } catch (err) {
      try { res.status(500).send('error'); } catch(e){}
    }
  });
}

module.exports = { attachSubgramRoutes };
