function attachCustomTaskRoutes(app, { db, auth, telegraf }){
  const { getAuthTgid } = auth;
  const bot = telegraf && telegraf.bot;

  async function isSubscribed(tgid, link){
    if (!bot || !link) return false;
    try {
      let chatIdOrUsername = null;
      const s = String(link).trim();
      if (/^@/.test(s)) chatIdOrUsername = s;
      else if (/t\.me\//i.test(s)) {
        const u = new URL(s.startsWith('http')?s:`https://${s.replace(/^\/*/,'')}`);
        const parts = u.pathname.split('/').filter(Boolean);
        if (parts.length>=1) chatIdOrUsername = '@' + parts[0];
      } else {
        chatIdOrUsername = s;
      }
      if (!chatIdOrUsername) return false;
      const res = await bot.telegram.getChatMember(chatIdOrUsername, tgid);
      if (!res || !res.status) return false;
      return ['member','administrator','creator','owner'].includes(String(res.status));
    } catch (e){ return false; }
  }

  app.get('/api/tasks/custom', async (req,res)=>{
    const tgid = getAuthTgid(req);
    try {
      const tasks = (await db.listTasks(false)).filter(t=> t.type !== 'invite_referrals');
      const enriched = [];
      for (const t of tasks){ const completed = tgid ? await db.isTaskCompleted(t.id, tgid) : false; enriched.push({ ...t, completed }); }
      res.json({ ok:true, tasks: enriched });
    } catch(e){ res.status(500).json({ ok:false, message:'Internal error' }); }
  });

  app.get('/api/tasks/progress', async (req,res)=>{
    const tgid = getAuthTgid(req);
    if (!tgid) return res.status(401).json({ ok:false, message:'Auth required' });
    try { const earned = await db.getEffectiveEarned(Number(tgid)); res.json({ ok:true, earned_scube: Number(earned||0) }); } catch(e){ res.status(500).json({ ok:false, message:'Internal error' }); }
  });

  app.post('/api/tasks/:id/verify', async (req,res)=>{
    const id = parseInt(req.params.id,10);
    const tgid = getAuthTgid(req) || (req.body && req.body.tgid);
    if (!id || !tgid) return res.status(400).json({ ok:false, message:'Invalid params' });
    try {
      const list = await db.listTasks(true);
      const task = list.find(it=> Number(it.id)===Number(id) && it.active);
      if (!task) return res.status(404).json({ ok:false, message:'Task not found' });
      if (task.type === 'invite_referrals') return res.status(400).json({ ok:false, message:'Задачи на приглашения отключены' });
      const already = await db.isTaskCompleted(task.id, tgid);
      if (already) return res.json({ ok:true, already: true });
      let ok = false;
      if (task.type === 'subscribe') {
        ok = await isSubscribed(tgid, task.link);
      } else if (task.type === 'earn_scube') {
        const earned = await db.getEffectiveEarned(Number(tgid)); ok = Number(earned) >= Number(task.required_count || 0);
      }
      if (!ok) return res.status(400).json({ ok:false, message:'Условия задачи ещё не выполнены' });
      await db.markTaskCompleted(task.id, tgid);
      const credit = await db.creditRewardGeneric(Number(tgid), task.reward_type, Number(task.reward_amount), 'task');
      return res.json({ ok:true, credited: task.reward_amount, reward_type: task.reward_type, balances: credit && credit.balances ? credit.balances : undefined });
    } catch(e){ res.status(500).json({ ok:false, message:'Internal error' }); }
  });
}

module.exports = { attachCustomTaskRoutes };
