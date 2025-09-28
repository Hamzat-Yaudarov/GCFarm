(function(){
  const tg = window.Telegram && window.Telegram.WebApp ? window.Telegram.WebApp : null;
  if (tg) { tg.expand(); }

  const avatarEl = document.getElementById('player-avatar');
  const scubeEl = document.getElementById('scube-balance');
  const gcubeEl = document.getElementById('gcube-balance');
  const energyFill = document.getElementById('energy-fill');
  const energyText = document.getElementById('energy-text');
  const goldenCube = document.getElementById('golden-cube');
  const notice = document.getElementById('home-notice');

  const tabHome = document.getElementById('tab-home');
  const tabShop = document.getElementById('tab-shop');
  const navHome = document.getElementById('nav-home');
  const navShop = document.getElementById('nav-shop');

  const btnExchange = document.getElementById('btn-exchange');
  const inputExchange = document.getElementById('exchange-amount');
  const btnUpgEnergy = document.getElementById('btn-upg-energy');
  const btnUpgLimit = document.getElementById('btn-upg-limit');

  function setActiveTab(tab){
    if (tab==='home') { tabHome.classList.add('tab-active'); tabShop.classList.remove('tab-active'); navHome.classList.add('tab-btn-active'); navShop.classList.remove('tab-btn-active'); }
    else { tabShop.classList.add('tab-active'); tabHome.classList.remove('tab-active'); navShop.classList.add('tab-btn-active'); navHome.classList.remove('tab-btn-active'); }
  }

  navHome.addEventListener('click', () => setActiveTab('home'));
  navShop.addEventListener('click', () => setActiveTab('shop'));

  const initData = tg ? tg.initData : '';
  const initDataUnsafe = (tg && tg.initDataUnsafe) ? tg.initDataUnsafe : {};

  if (initDataUnsafe && initDataUnsafe.user && initDataUnsafe.user.photo_url) {
    avatarEl.src = initDataUnsafe.user.photo_url;
  } else {
    avatarEl.src = 'https://i.pravatar.cc/100?img=12';
  }

  let state = {
    scube: 0,
    gcube: 0,
    energy: { current: 0, capacity: 0 },
    dailyLimit: { level: 0, capacity: 250, earned: 0 }
  };

  function render(){
    scubeEl.textContent = String(state.scube);
    gcubeEl.textContent = String(state.gcube);
    const pct = state.energy.capacity > 0 ? (state.energy.current / state.energy.capacity) : 0;
    energyFill.style.height = `${Math.max(0, Math.min(1, pct)) * 100}%`;
    energyText.textContent = `${state.energy.current} / ${state.energy.capacity}`;
  }

  async function api(path, opts){
    const headers = { 'Content-Type': 'application/json', 'x-telegram-init-data': initData };
    const resp = await fetch(path, { method: (opts && opts.method) || 'GET', headers, body: opts && opts.body ? JSON.stringify(opts.body) : undefined });
    if (!resp.ok) throw new Error('API error');
    return resp.json();
  }

  async function refresh(){
    try {
      const data = await api('/api/me');
      if (data && data.ok && data.user) {
        state = data.user;
        render();
      }
    } catch(e) {
      console.error(e);
    }
  }

  goldenCube.addEventListener('click', async () => {
    try {
      const data = await api('/api/tap', { method: 'POST' });
      if (data.ok) {
        state = data.user; render(); notice.textContent = '+1 SCube'; setTimeout(()=> notice.textContent='', 800);
      } else if (data.error === 'no_energy') {
        notice.textContent = 'Нет энергии';
      } else if (data.error === 'daily_limit') {
        notice.textContent = 'Дневной лимит достигнут';
      }
    } catch(e) {
      notice.textContent = 'Ошибка';
      console.error(e);
    }
  });

  btnExchange.addEventListener('click', async () => {
    const amt = Number(inputExchange.value || '0');
    if (!Number.isFinite(amt) || amt <= 0) return;
    try {
      const data = await api('/api/exchange', { method: 'POST', body: { amount: amt } });
      if (data.ok) { state = data.user; render(); inputExchange.value=''; }
    } catch(e) { console.error(e); }
  });

  btnUpgEnergy.addEventListener('click', async () => {
    try {
      const data = await api('/api/upgrade/energy', { method: 'POST' });
      if (data.ok) { state = data.user; render(); }
    } catch(e) { console.error(e); }
  });

  btnUpgLimit.addEventListener('click', async () => {
    try {
      const data = await api('/api/upgrade/daily-limit', { method: 'POST' });
      if (data.ok) { state = data.user; render(); }
    } catch(e) { console.error(e); }
  });

  setInterval(refresh, 5000);
  refresh();

  // Ensure Onclicka loader present and trigger re-scan while the page is alive
  async function loadOnclicka() {
    if (document.querySelector('script[src*="onclckmn.com/static/onclicka.js"]')) return true;
    return await new Promise((resolve) => {
      const s = document.createElement('script');
      s.async = true;
      s.src = 'https://js.onclckmn.com/static/onclicka.js';
      s.onload = () => resolve(true);
      s.onerror = () => resolve(false);
      document.head.appendChild(s);
    });
  }

  (async function initBanner() {
    await loadOnclicka();
    const host = document.getElementById('ad-banner') || document.body;
    let tries = 0;
    const timer = setInterval(() => {
      tries++;
      const slot = host.querySelector('[data-banner-id]');
      if (!slot) return;
      // Nudge layout and retrigger observers used by some ad SDKs
      slot.style.minHeight = '90px';
      const clone = slot.cloneNode(false);
      slot.parentElement && slot.parentElement.replaceChild(clone, slot);
      // Stop when an iframe gets injected or after several attempts
      if (host.querySelector('iframe')) { clearInterval(timer); }
      if (tries >= 10) { clearInterval(timer); }
    }, 1500);
  })();
})();
