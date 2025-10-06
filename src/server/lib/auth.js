const crypto = require('crypto');

function createAuth(TG_BOT_TOKEN){
  const SESSION_TTL = 24 * 60 * 60; // 24h
  function parseCookies(header){
    const out = {};
    String(header||'').split(';').forEach((p)=>{
      const idx = p.indexOf('=');
      if (idx > -1){
        const k = p.slice(0, idx).trim();
        const v = decodeURIComponent(p.slice(idx+1).trim());
        out[k] = v;
      }
    });
    return out;
  }
  function signSession(id, ts){
    const h = crypto.createHmac('sha256', TG_BOT_TOKEN);
    h.update(`${id}.${ts}`);
    return `${id}.${ts}.${h.digest('hex')}`;
  }
  function verifySession(token){
    try{
      const [id, ts, sig] = String(token||'').split('.');
      if (!id || !ts || !sig) return null;
      const now = Math.floor(Date.now()/1000);
      if (now - Number(ts) > SESSION_TTL) return null;
      const expected = crypto.createHmac('sha256', TG_BOT_TOKEN).update(`${id}.${ts}`).digest('hex');
      if (!crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(sig))) return null;
      return Number(id);
    } catch(e){ return null; }
  }
  function getAuthTgid(req){
    try{
      const cookies = parseCookies(req.headers.cookie || '');
      const id = verifySession(cookies.session || '');
      return Number.isFinite(id) ? id : null;
    } catch(e){ return null; }
  }
  function verifyTelegramInitData(initData){
    try{
      const params = new URLSearchParams(initData);
      const hash = params.get('hash');
      params.delete('hash');
      const data = [];
      for (const [key, value] of params.entries()) data.push(`${key}=${value}`);
      data.sort();
      const dataCheckString = data.join('\n');
      const secret = crypto.createHmac('sha256', 'WebAppData').update(TG_BOT_TOKEN).digest();
      const hmac = crypto.createHmac('sha256', secret).update(dataCheckString).digest('hex');
      if (!hash || !crypto.timingSafeEqual(Buffer.from(hmac), Buffer.from(hash))) return null;
      const auth_date = Number(params.get('auth_date') || 0);
      const now = Math.floor(Date.now()/1000);
      if (auth_date && now - auth_date > 3600) return null;
      const userRaw = params.get('user');
      const user = userRaw ? JSON.parse(userRaw) : null;
      return user && user.id ? Number(user.id) : null;
    } catch(e){ return null; }
  }
  return { SESSION_TTL, parseCookies, signSession, verifySession, getAuthTgid, verifyTelegramInitData };
}

module.exports = createAuth;
