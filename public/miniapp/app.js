(function(){
  const tg = window.Telegram?.WebApp;
  if (tg) {
    tg.expand();
    tg.setHeaderColor('#0b0c10');
    tg.setBackgroundColor('#0b0c10');
  }

  const els = {
    avatar: document.getElementById('avatar'),
    scube: document.getElementById('scube'),
    gcube: document.getElementById('gcube'),
    energy: document.getElementById('energy'),
    capacity: document.getElementById('capacity'),
    energyFill: document.getElementById('energyFill'),
    dailyUsed: document.getElementById('dailyUsed'),
    dailyLimit: document.getElementById('dailyLimit'),
    silverCube: document.getElementById('silverCube'),
  };

  const initUser = tg?.initDataUnsafe?.user || null;
  if (initUser && initUser.photo_url) {
    els.avatar.src = initUser.photo_url;
  } else {
    els.avatar.src = 'data:image/svg+xml;utf8,' + encodeURIComponent(`<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 100 100\"><rect width=\"100\" height=\"100\" fill=\"#2b2d42\"/><text x=\"50\" y=\"55\" font-size=\"42\" text-anchor=\"middle\" fill=\"#edf2f4\" font-family=\"Arial, sans-serif\">${(initUser?.first_name||'?')[0]||'?'}<\/text><\/svg>`);
  }

  async function fetchState(){
    const params = new URLSearchParams({ initData: tg?.initData || '' });
    const res = await fetch(`/api/state?${params.toString()}`, { credentials: 'same-origin' });
    if (!res.ok) throw new Error('auth');
    const data = await res.json();
    applyState(data.state);
  }

  function applyState(state){
    els.scube.textContent = state.balances.scube;
    els.gcube.textContent = state.balances.gcube;
    els.energy.textContent = state.energy.current;
    els.capacity.textContent = state.energy.capacity;
    els.dailyUsed.textContent = state.daily.used;
    els.dailyLimit.textContent = state.daily.limit;
    const pct = state.energy.capacity > 0 ? (state.energy.current / state.energy.capacity) * 100 : 0;
    els.energyFill.style.width = `${Math.max(0, Math.min(100, pct))}%`;
  }

  async function tap(){
    const res = await fetch('/api/tap', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ initData: tg?.initData || '' })
    });
    const data = await res.json();
    applyState(data.state);
  }

  els.silverCube.addEventListener('click', tap);

  fetchState().catch(() => {
    alert('Ошибка авторизации в MiniApp. Откройте игру через сообщение бота.');
  });

  setInterval(() => fetchState().catch(()=>{}), 4000);
})();
