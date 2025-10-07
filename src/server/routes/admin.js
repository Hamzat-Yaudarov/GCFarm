const express = require('express');
const pool = require('../db/pool');

function attachAdminRoutes(app, { db, auth }){
  const { getAuthTgid } = auth;
  const ADMIN_IDS = new Set([6910097562, 7972065986]);

  function requireAdmin(req, res){
    const tgid = getAuthTgid(req);
    if (!tgid) return { ok:false, code:401, message: 'Not authenticated' };
    if (!ADMIN_IDS.has(Number(tgid))) return { ok:false, code:403, message: 'Forbidden' };
    return { ok:true, tgid: Number(tgid) };
  }

  app.get('/api/admin/stats', async (req, res) => {
    const authRes = requireAdmin(req);
    if (!authRes.ok) return res.status(authRes.code).json({ ok:false, message: authRes.message });
    try {
      const client = await pool.connect();
      try {
        // Total players
        const usersRes = await client.query("SELECT COUNT(*) AS total_players, COALESCE(SUM(scube),0) AS total_scube_on_users, COALESCE(SUM(vp),0) AS total_vp, COALESCE(SUM(tickets),0) AS total_tickets FROM users");
        const usersRow = usersRes.rows[0] || { total_players:0, total_scube_on_users:0 };
        // New players today
        const newTodayRes = await client.query("SELECT COUNT(*) AS new_today FROM users WHERE DATE(first_seen_at) = CURRENT_DATE");
        const newToday = Number((newTodayRes.rows[0] || {}).new_today || 0);
        // SCube earned total and today from reward_events
        const earnedTotalRes = await client.query("SELECT COALESCE(SUM(amount),0) AS earned_total FROM reward_events");
        const earnedTodayRes = await client.query("SELECT COALESCE(SUM(amount),0) AS earned_today FROM reward_events WHERE DATE(created_at) = CURRENT_DATE");
        const earnedTotal = Number((earnedTotalRes.rows[0] || {}).earned_total || 0);
        const earnedToday = Number((earnedTodayRes.rows[0] || {}).earned_today || 0);
        // SCube spent on upgrades total and today
        const spentTotalRes = await client.query("SELECT COALESCE(SUM(cost),0) AS spent_total FROM upgrade_events");
        const spentTodayRes = await client.query("SELECT COALESCE(SUM(cost),0) AS spent_today FROM upgrade_events WHERE DATE(created_at) = CURRENT_DATE");
        const spentTotal = Number((spentTotalRes.rows[0] || {}).spent_total || 0);
        const spentToday = Number((spentTodayRes.rows[0] || {}).spent_today || 0);
        // custom tasks count
        const tasksRes = await client.query('SELECT COUNT(*) AS custom_tasks FROM custom_tasks');

        res.json({ ok:true,
          total_players: Number(usersRow.total_players || 0),
          new_players_today: newToday,
          scube_on_users: Number(usersRow.total_scube_on_users || 0),
          vp_total: Number((usersRow.total_vp || 0)),
          tickets_total: Number((usersRow.total_tickets || 0)),
          scube_earned_total: earnedTotal,
          scube_earned_today: earnedToday,
          scube_spent_upgrades_total: spentTotal,
          scube_spent_upgrades_today: spentToday,
          custom_tasks: Number((tasksRes.rows[0] || {}).custom_tasks || 0)
        });
      } finally { client.release(); }
    } catch (err) { console.error('admin stats error', err); res.status(500).json({ ok:false, message: err && err.message ? err.message : 'Internal error' }); }
  });

  app.get('/api/admin/custom-tasks', async (req, res) => {
    const authRes = requireAdmin(req);
    if (!authRes.ok) return res.status(authRes.code).json({ ok:false, message: authRes.message });
    try {
      const client = await pool.connect();
      try {
        const js = await client.query('SELECT id, name, reward_type, reward_amount, task_type, params, created_by, created_at FROM custom_tasks ORDER BY created_at DESC LIMIT 200');
        res.json({ ok:true, tasks: js.rows });
      } finally { client.release(); }
    } catch (err) { console.error('admin list tasks error', err); res.status(500).json({ ok:false, message: err && err.message ? err.message : 'Internal error' }); }
  });

  app.post('/api/admin/custom-tasks', express.json(), async (req, res) => {
    const authRes = requireAdmin(req);
    if (!authRes.ok) return res.status(authRes.code).json({ ok:false, message: authRes.message });
    const adminTgid = authRes.tgid;
    let { name, reward_type, reward_amount, task_type, params } = req.body || {};
    if (!name || !reward_type || !task_type) return res.status(400).json({ ok:false, message: 'Invalid params' });
    const amount = Number(reward_amount) || 0;
    try {
      // normalize and validate params for subscribe/referrals/earn_scube
      if (task_type === 'subscribe') {
        if (typeof params === 'string') {
          params = { link: params.trim() };
        } else if (typeof params === 'object' && params !== null) {
          const hasLink = params.link && String(params.link).trim();
          const hasUsername = params.username && String(params.username).trim();
          if (!(hasLink || hasUsername)) return res.status(400).json({ ok:false, message: 'Для подписки укажите link или username' });
          // ensure only one provided
          if (hasLink && hasUsername) return res.status(400).json({ ok:false, message: 'Укажите либо link, либо username, не оба' });
          // keep as-is
        } else {
          return res.status(400).json({ ok:false, message: 'Invalid params for subscribe task' });
        }
      } else if (task_type === 'referrals') {
        if (typeof params === 'object' && params !== null && Number.isFinite(Number(params.count))) {
          params = { count: Number(params.count) };
        } else if (typeof params === 'string' && String(params).trim()) {
          const n = parseInt(String(params).trim(), 10);
          if (!Number.isFinite(n) || n <= 0) return res.status(400).json({ ok:false, message: 'Invalid referrals count' });
          params = { count: n };
        } else {
          return res.status(400).json({ ok:false, message: 'Invalid params for referrals task' });
        }
      } else if (task_type === 'earn_scube') {
        if (typeof params === 'object' && params !== null && Number.isFinite(Number(params.amount))) {
          params = { amount: Number(params.amount) };
        } else if (typeof params === 'string' && String(params).trim()) {
          const n = parseInt(String(params).trim(), 10);
          if (!Number.isFinite(n) || n <= 0) return res.status(400).json({ ok:false, message: 'Invalid amount for earn_scube' });
          params = { amount: n };
        } else {
          return res.status(400).json({ ok:false, message: 'Invalid params for earn_scube task' });
        }
      } else {
        params = params && typeof params === 'object' ? params : {};
      }

      const client = await pool.connect();
      try {
        const ins = await client.query('INSERT INTO custom_tasks (name, reward_type, reward_amount, task_type, params, created_by) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id', [name, String(reward_type), amount, String(task_type), params ? params : {}, adminTgid]);
        res.json({ ok:true, id: ins.rows[0].id });
      } finally { client.release(); }
    } catch (err) { console.error('admin create task error', err); res.status(500).json({ ok:false, message: err && err.message ? err.message : 'Internal error' }); }
  });

}

module.exports = { attachAdminRoutes };
