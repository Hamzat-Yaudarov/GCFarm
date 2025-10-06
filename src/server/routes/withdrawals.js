function attachWithdrawalRoutes(app, { db, auth, telegraf }){
  const { getAuthTgid } = auth;
  app.post('/api/withdrawals', async (req, res) => {
    try {
      const body = req.body || {};
      const methodRaw = body.method;
      const optionRaw = body.optionId;
      const noteRaw = typeof body.note === 'string' ? body.note : '';
      const detailsRaw = (body && typeof body.details === 'object' && body.details) || {};
      const authTgid = getAuthTgid(req);
      const bodyTgid = body && body.tgid !== undefined ? parseInt(body.tgid, 10) : null;
      if (authTgid && bodyTgid && Number(authTgid)!==Number(bodyTgid)) { return res.status(403).json({ ok:false, message:'Auth mismatch' }); }
      const resolvedTgid = (authTgid !== null && authTgid !== undefined) ? Number(authTgid) : bodyTgid;
      if (!resolvedTgid || !Number.isFinite(resolvedTgid)) { return res.status(401).json({ ok:false, message:'Авторизуйтесь через Telegram MiniApp.' }); }
      if (!methodRaw || !optionRaw) { return res.status(400).json({ ok:false, message:'Укажите способ вывода' }); }
      const methodKey = String(methodRaw).toLowerCase();
      const optionId = String(optionRaw);
      const option = db.getWithdrawalOption(methodKey, optionId);
      if (!option) { return res.status(400).json({ ok:false, message:'Неверный вариант вывода' }); }
      const profile = await telegraf.fetchTelegramProfile(resolvedTgid);
      const metadata = { username: profile && profile.username ? profile.username : null, fullName: profile && profile.fullName ? profile.fullName : null, displayName: profile && profile.displayName ? profile.displayName : null };
      const creation = await db.createWithdrawalRequest(resolvedTgid, methodKey, optionId, detailsRaw, noteRaw, metadata);
      if (!creation.ok) { return res.status(400).json(creation); }
      const withdrawal = creation.withdrawal; const userSnapshot = await db.getOrCreateUser(resolvedTgid);
      try { await telegraf.notifyAdminWithdrawal(withdrawal, userSnapshot, metadata); } catch(e){}
      const responsePayload = { ok:true, message:'Заявка на вывод отправлена. Ожидайте ответа.', scube: creation.scube, withdrawalId: withdrawal.id };
      if (userSnapshot && Number(userSnapshot.complaints || 0) > 0) {
        responsePayload.warning = `У вас есть ${userSnapshot.complaints} жалоб(а) за отписки от спонсоров. Если вы продолжите отписываться — ваши заявки на вывод могут быть отклонены без возврата средств.`;
      }
      res.json(responsePayload);
    } catch (err) { res.status(500).json({ ok:false, message:'Не удалось отправить заявку. Попробуйте позже.' }); }
  });
}

module.exports = { attachWithdrawalRoutes };
