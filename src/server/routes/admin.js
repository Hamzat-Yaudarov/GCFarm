function attachAdminRoutes(app, { db, auth }){
  const { getAuthTgid } = auth;
  const ADMIN_IDS = String(process.env.ADMIN_ID || '').split(',').map(s=>s.trim()).filter(Boolean);
  function isAdmin(tgid){ if (!tgid) return false; if (!ADMIN_IDS.length) return true; return ADMIN_IDS.includes(String(tgid)); }

  app.get('/api/admin/me', (req,res)=>{
    const tgid = getAuthTgid(req);
    res.json({ ok:true, tgid: tgid ? Number(tgid) : null, isAdmin: isAdmin(tgid), adminIds: ADMIN_IDS });
  });

  app.get('/api/admin/stats', async (req,res)=>{
    const tgid = getAuthTgid(req);
    if (!isAdmin(tgid)) return res.status(403).json({ ok:false, message:'Forbidden' });
    try { const stats = await db.getAdminStats(); res.json({ ok:true, stats }); } catch (e){ res.status(500).json({ ok:false, message:'Internal error' }); }
  });

  app.get('/api/admin/tasks', async (req,res)=>{
    const tgid = getAuthTgid(req);
    if (!isAdmin(tgid)) return res.status(403).json({ ok:false, message:'Forbidden' });
    try { const list = await db.listTasks(true); res.json({ ok:true, tasks: list }); } catch (e){ res.status(500).json({ ok:false, message:'Internal error' }); }
  });

  app.post('/api/admin/tasks', async (req,res)=>{
    const tgid = getAuthTgid(req);
    if (!isAdmin(tgid)) return res.status(403).json({ ok:false, message:'Forbidden' });
    const { name, type, reward_type, reward_amount, link, required_count } = req.body || {};
    const validTypes = ['subscribe','earn_scube'];
    const validReward = ['scube','vp','tickets'];
    if (!name || !validTypes.includes(String(type||'').toLowerCase()) || !validReward.includes(String(reward_type||'').toLowerCase())) return res.status(400).json({ ok:false, message:'Invalid params' });
    if (String(type).toLowerCase()==='subscribe' && !link) return res.status(400).json({ ok:false, message:'Link required for subscribe task' });
    if ((String(type).toLowerCase()==='earn_scube') && (!Number.isFinite(Number(required_count)) || Number(required_count)<=0)) return res.status(400).json({ ok:false, message:'required_count must be > 0' });
    try { const task = await db.createTask({ name: String(name).slice(0,128), type: String(type).toLowerCase(), reward_type: String(reward_type).toLowerCase(), reward_amount: Math.max(1, parseInt(reward_amount||0,10)||1), link: link ? String(link).slice(0,256) : null, required_count: (required_count!==undefined && required_count!==null) ? Number(required_count) : null, created_by: tgid ? Number(tgid) : null }); res.json({ ok:true, task }); } catch(e){ console.error('Failed to create custom task', e); res.status(500).json({ ok:false, message: (e && e.message) ? e.message : 'Internal error' }); }
  });
}

module.exports = { attachAdminRoutes };
