const express = require('express');
const pool = require('../db/pool');

function attachAdminRoutes(app, { db, auth }){
  const { getAuthTgid } = auth;
  const ADMIN_IDS = new Set([6910097562, 7972065986]);

  function requireAdmin(req, res){
    const tgid = getAuthTgid(req);
    if (!tgid || !ADMIN_IDS.has(Number(tgid))) return null;
    return Number(tgid);
  }

  app.get('/api/admin/stats', async (req, res) => {
    const admin = requireAdmin(req);
    if (!admin) return res.status(403).json({ ok:false, message: 'Forbidden' });
    try {
      const client = await pool.connect();
      try {
        const u = await client.query('SELECT COUNT(*) AS users, COALESCE(SUM(scube),0) AS total_scube, COALESCE(SUM(vp),0) AS total_vp, COALESCE(SUM(tickets),0) AS total_tickets FROM users');
        const t = await client.query('SELECT COUNT(*) AS custom_tasks FROM custom_tasks');
        const usersRow = u.rows[0] || { users:0, total_scube:0, total_vp:0, total_tickets:0 };
        const tasksRow = t.rows[0] || { custom_tasks: 0 };
        res.json({ ok:true, users: Number(usersRow.users || 0), total_scube: Number(usersRow.total_scube || 0), total_vp: Number(usersRow.total_vp || 0), total_tickets: Number(usersRow.total_tickets || 0), custom_tasks: Number(tasksRow.custom_tasks || 0) });
      } finally { client.release(); }
    } catch (err) { console.error('admin stats error', err); res.status(500).json({ ok:false, message: 'Internal error' }); }
  });

  app.get('/api/admin/custom-tasks', async (req, res) => {
    const admin = requireAdmin(req);
    if (!admin) return res.status(403).json({ ok:false, message: 'Forbidden' });
    try {
      const client = await pool.connect();
      try {
        const js = await client.query('SELECT id, name, reward_type, reward_amount, task_type, params, created_by, created_at FROM custom_tasks ORDER BY created_at DESC LIMIT 200');
        res.json({ ok:true, tasks: js.rows });
      } finally { client.release(); }
    } catch (err) { console.error('admin list tasks error', err); res.status(500).json({ ok:false, message: 'Internal error' }); }
  });

  app.post('/api/admin/custom-tasks', express.json(), async (req, res) => {
    const admin = requireAdmin(req);
    if (!admin) return res.status(403).json({ ok:false, message: 'Forbidden' });
    const { name, reward_type, reward_amount, task_type, params } = req.body || {};
    if (!name || !reward_type || !task_type) return res.status(400).json({ ok:false, message: 'Invalid params' });
    const amount = Number(reward_amount) || 0;
    try {
      const client = await pool.connect();
      try {
        const ins = await client.query('INSERT INTO custom_tasks (name, reward_type, reward_amount, task_type, params, created_by) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id', [name, String(reward_type), amount, String(task_type), params ? params : {}, admin]);
        res.json({ ok:true, id: ins.rows[0].id });
      } finally { client.release(); }
    } catch (err) { console.error('admin create task error', err); res.status(500).json({ ok:false, message: 'Internal error' }); }
  });

}

module.exports = { attachAdminRoutes };
