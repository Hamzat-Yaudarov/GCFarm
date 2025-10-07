const express = require('express');

function attachAdminRoutes(app, { db, auth }){
  const { getAuthTgid } = auth;
  const ADMINS = new Set([6910097562, 7972065986]);

  function ensureAdmin(req, res){
    const tgid = getAuthTgid(req);
    if (!tgid || !ADMINS.has(Number(tgid))) return res.status(403).json({ ok:false, message: 'Forbidden' });
    return Number(tgid);
  }

  const { pool } = require('../db/pool');
  app.get('/api/admin/stats', async (req, res) => {
    try {
      const admin = ensureAdmin(req, res);
      if (!admin) return;
      const client = await pool.connect();
      try {
        const usersRes = await client.query('SELECT COUNT(*) AS total, COALESCE(SUM(scube),0) AS total_scube, COALESCE(SUM(vp),0) AS total_vp, COALESCE(SUM(tickets),0) AS total_tickets FROM users');
        const tasksRes = await client.query('SELECT COUNT(*) AS tasks FROM tasks');
        const rows = usersRes.rows[0] || {};
        res.json({ ok:true, users: { total: Number(rows.total || 0), scube: Number(rows.total_scube || 0), vp: Number(rows.total_vp || 0), tickets: Number(rows.total_tickets || 0) }, tasks: Number(tasksRes.rows[0] && tasksRes.rows[0].tasks || 0) });
      } finally { client.release(); }
    } catch (err) { console.error('admin stats error', err); res.status(500).json({ ok:false, message: 'Internal error' }); }
  });

  app.get('/api/admin/tasks', async (req, res) => {
    try {
      const admin = ensureAdmin(req, res);
      if (!admin) return;
      const { pool } = require('../db/pool');
      const client = await pool.connect();
      try {
        const q = await client.query('SELECT id, name, task_type, params, reward_type, reward_amount, active, created_at FROM tasks ORDER BY created_at DESC LIMIT 200');
        res.json({ ok:true, tasks: q.rows });
      } finally { client.release(); }
    } catch (err) { console.error('admin tasks list error', err); res.status(500).json({ ok:false, message: 'Internal error' }); }
  });

  app.post('/api/admin/tasks', async (req, res) => {
    try {
      const admin = ensureAdmin(req, res);
      if (!admin) return;
      const body = req.body || {};
      const name = String(body.name || '').slice(0, 200);
      const task_type = String(body.task_type || '').slice(0, 50);
      const reward_type = String(body.reward_type || '').slice(0, 50);
      const reward_amount = Math.max(0, parseInt(body.reward_amount || 0, 10));
      const params = body.params && typeof body.params === 'object' ? body.params : {};
      if (!name || !task_type || !reward_type) return res.status(400).json({ ok:false, message:'Invalid params' });
      const { pool } = require('../db/pool');
      const client = await pool.connect();
      try {
        const insert = await client.query('INSERT INTO tasks (name, task_type, params, reward_type, reward_amount) VALUES ($1,$2,$3,$4,$5) RETURNING id, created_at', [name, task_type, params, reward_type, reward_amount]);
        res.json({ ok:true, id: insert.rows[0].id, created_at: insert.rows[0].created_at });
      } finally { client.release(); }
    } catch (err) { console.error('admin create task error', err); res.status(500).json({ ok:false, message: 'Internal error' }); }
  });

}

module.exports = { attachAdminRoutes };
