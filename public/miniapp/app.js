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
    tabButtons: Array.from(document.querySelectorAll('.tab-btn')),
    tabs: Array.from(document.querySelectorAll('.tab-view')),
    toG: document.getElementById('toG'),
    toS: document.getElementById('toS'),
    upgradeCapacity: document.getElementById('upgradeCapacity'),
    upgradeDaily: document.getElementById('upgradeDaily'),
    rewardedBtn: document.getElementById('rewarded-btn'),
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

    // Update dynamic price text for daily upgrade
    const level = Math.max(0, Math.floor((state.daily.limit - 250) / 50));
    const price = 90 + level * 10;
    const btn = els.upgradeDaily;
    if (btn) btn.textContent = `Лимит +50 (${price} SCube)`;
  }

  async function tap(){
    els.silverCube.classList.remove('cube-anim');
    // reflow to restart animation
    void els.silverCube.offsetWidth;
    els.silverCube.classList.add('cube-anim');
    const res = await fetch('/api/tap', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ initData: tg?.initData || '' })
    });
    const data = await res.json();
    applyState(data.state);
  }

  els.silverCube.addEventListener('click', tap);

  // Tabs
  els.tabButtons.forEach(btn => {
    btn.addEventListener('click', () => {
      els.tabButtons.forEach(b => b.classList.remove('is-active'));
      btn.classList.add('is-active');
      const tab = btn.getAttribute('data-tab');
      els.tabs.forEach(view => view.classList.toggle('is-active', view.id === `tab-${tab}`));
    });
  });

  // Exchange
  if (els.toG) els.toG.addEventListener('click', async () => {
    const res = await fetch('/api/exchange', {
      method: 'POST', headers: {'Content-Type':'application/json'},
      body: JSON.stringify({ initData: tg?.initData || '', direction: 'scube_to_gcube', count: 1 })
    });
    const data = await res.json();
    if (data.state) applyState(data.state);
  });
  if (els.toS) els.toS.addEventListener('click', async () => {
    const res = await fetch('/api/exchange', {
      method: 'POST', headers: {'Content-Type':'application/json'},
      body: JSON.stringify({ initData: tg?.initData || '', direction: 'gcube_to_scube', count: 1 })
    });
    const data = await res.json();
    if (data.state) applyState(data.state);
  });

  // Upgrades
  if (els.upgradeCapacity) els.upgradeCapacity.addEventListener('click', async () => {
    const res = await fetch('/api/upgrade', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ initData: tg?.initData || '', type: 'capacity' }) });
    const data = await res.json();
    if (data.state) applyState(data.state);
  });
  if (els.upgradeDaily) els.upgradeDaily.addEventListener('click', async () => {
    const res = await fetch('/api/upgrade', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ initData: tg?.initData || '', type: 'daily' }) });
    const data = await res.json();
    if (data.state) applyState(data.state);
  });

  // Rewarded ad: overlay is configured in OnClickA cabinet with selector #rewarded-btn
  let awaitingAd = false;
  let hiddenAt = 0;
  if (els.rewardedBtn) {
    els.rewardedBtn.addEventListener('click', () => {
      // Keep stable selector for OnClickA Overlay (#rewarded-btn)
      awaitingAd = true;
      hiddenAt = 0;
    });

    document.addEventListener('visibilitychange', async () => {
      if (!awaitingAd) return;
      if (document.hidden) {
        hiddenAt = Date.now();
      } else {
        const hiddenTime = Date.now() - hiddenAt;
        if (hiddenAt && hiddenTime > 2000) {
          awaitingAd = false;
          const res = await fetch('/api/reward', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ initData: tg?.initData || '' }) });
          const data = await res.json();
          if (data.state) applyState(data.state);
        }
      }
    });
  }

  fetchState().catch(() => {
    alert('Ошибка авторизации в MiniApp. Откройте игру через сообщение бота.');
  });

  setInterval(() => fetchState().catch(()=>{}), 4000);

  // Popunder every 3 minutes
  const adEls = {
    root: document.getElementById('ad-popunder'),
    close: document.getElementById('ad-close')
  };
  function showAd(){ if (!adEls.root) return; adEls.root.classList.add('is-visible'); adEls.root.setAttribute('aria-hidden','false'); }
  function hideAd(){ if (!adEls.root) return; adEls.root.classList.remove('is-visible'); adEls.root.setAttribute('aria-hidden','true'); }
  if (adEls.close) adEls.close.addEventListener('click', hideAd);
  if (adEls.root) adEls.root.addEventListener('click', (e)=>{ if (e.target.classList.contains('ad-popunder-backdrop')) hideAd(); });
  let lastAdAt = Date.now();
  function schedulePop(){
    const elapsed = Date.now() - lastAdAt;
    const wait = Math.max(0, 180000 - elapsed);
    setTimeout(()=>{
      if (!document.hidden) { lastAdAt = Date.now(); showAd(); }
      schedulePop();
    }, wait || 180000);
  }
  document.addEventListener('visibilitychange', ()=>{
    if (!document.hidden && Date.now() - lastAdAt >= 180000) { lastAdAt = Date.now(); showAd(); }
  });
  schedulePop();
})();
