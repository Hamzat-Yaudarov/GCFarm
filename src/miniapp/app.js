(function(){
  function qs(name){
    const url = new URL(window.location.href);
    return url.searchParams.get(name);
  }
  const tgid = qs('tgid');
  const apiBase = '/api';

  const scubeEl = document.getElementById('scube');
  const gcubeEl = document.getElementById('gcube');
  const energyEl = document.getElementById('energy');
  const energyCapEl = document.getElementById('energy-capacity');
  const dailyEl = document.getElementById('daily');
  const dailyLimitEl = document.getElementById('daily-limit');
  const dailyLevelEl = document.getElementById('daily-level');
  const dailyCostEl = document.getElementById('daily-cost');
  const avatarEl = document.getElementById('avatar');
  const golden = document.getElementById('golden-cube');

  const watchAdBtn = document.getElementById('watch-ad');
  const scubeToGBtn = document.getElementById('scube-to-gcube');
  const gcubeToSBtn = document.getElementById('gcube-to-scube');
  const upgradeBtns = document.querySelectorAll('.upgrade-btn');
  const storeFeedback = document.getElementById('store-feedback');

  const tabs = document.querySelectorAll('.tab-button');
  const contents = document.querySelectorAll('.tab-content');

  // Initialize AdsGram controllers if available
  let AdController = null;
  let RewardController = null;
  let TaskBlockId = null;
  try {
    const cfg = window.ADSGRAM_CONFIG || {};
    TaskBlockId = cfg.taskBlockId;
    if (window.Adsgram && cfg && cfg.interstitialBlockId) {
      AdController = window.Adsgram.init({ blockId: cfg.interstitialBlockId });
      console.log('AdsGram interstitial initialized with', cfg.interstitialBlockId);
    }
    if (window.Adsgram && cfg && cfg.rewardBlockId) {
      RewardController = window.Adsgram.init({ blockId: cfg.rewardBlockId });
      console.log('AdsGram reward initialized with', cfg.rewardBlockId);
    }
  } catch (e) { console.warn('AdsGram init failed', e); }

  // throttle interstitials to avoid repeated errors/messages
  let lastInterstitialAt = 0;
  let interstitialShownCount = 0;
  const INTERSTITIAL_MIN_INTERVAL = 5 * 60 * 1000; // 5 minutes
  const INTERSTITIAL_MAX_PER_SESSION = 3;

  tabs.forEach(btn=>{
    btn.addEventListener('click', async ()=>{
      tabs.forEach(b=>b.classList.remove('active'));
      btn.classList.add('active');
      const tab = btn.dataset.tab;
      contents.forEach(c=>{
        if (c.id===tab) c.classList.remove('hidden'); else c.classList.add('hidden');
      });

      // show interstitial on tab switch if available and throttled
      try {
        const now = Date.now();
        if (AdController && typeof AdController.show === 'function' && now - lastInterstitialAt > INTERSTITIAL_MIN_INTERVAL && interstitialShownCount < INTERSTITIAL_MAX_PER_SESSION) {
          lastInterstitialAt = now;
          try {
            const result = await AdController.show();
            interstitialShownCount++;
            console.log('AdController.show result', result);
          } catch (err) {
            // AdsGram may return descriptive errors; suppress repetitive 'block not active' messages
            const msg = (err && (err.description || err.message || '')) + '';
            if (msg.toLowerCase().includes('not active') || msg.toLowerCase().includes('inactive') || msg.toLowerCase().includes('moderation')) {
              console.warn('AdController show suppressed non-active/moderation message');
            } else {
              console.warn('Ad show error', err);
            }
          }
        }
      } catch (err) {
        console.warn('Ad show error outer', err);
      }
    });
  });

  // Insert task block if available
  try {
    const cfg = window.ADSGRAM_CONFIG || {};
    const taskId = cfg.taskBlockId;
    if (taskId && typeof customElements !== 'undefined' && customElements.get && window.Adsgram) {
      // create adsgram-task element
      const wrapper = document.getElementById('ads-task-wrap');
      if (wrapper) {
        const taskEl = document.createElement('adsgram-task');
        taskEl.setAttribute('data-block-id', taskId);
        taskEl.setAttribute('data-debug', 'true');
        taskEl.className = 'task';
        wrapper.appendChild(taskEl);

        const taskFeedback = document.getElementById('task-feedback');
        const handler = (event) => {
          // event.detail may contain reward amount
          const detail = event && event.detail;
          console.log('adsgram task event', event.type, detail);
          if (event.type === 'reward') {
            const amount = (detail && detail.reward) || (detail && detail.amount) || 5;
            // call server to credit reward
            fetch(`${apiBase}/user/${tgid}/claim-reward`, { method: 'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ amount }) })
              .then(()=> loadUser())
              .then(()=> { if (taskFeedback) taskFeedback.textContent = 'Награда за задание получена'; setTimeout(()=> taskFeedback.textContent = '', 3000); })
              .catch((e)=>{ console.warn('Failed to claim task reward', e); if (taskFeedback) taskFeedback.textContent = 'Ошибка при получении н��грады'; });
          }
        };
        taskEl.addEventListener('reward', handler);
        taskEl.addEventListener('onError', (e) => { console.warn('task onError', e); if (taskFeedback) taskFeedback.textContent = 'Ошибка загрузки задания'; setTimeout(()=> taskFeedback.textContent = '',3000); });
        taskEl.addEventListener('onBannerNotFound', (e) => { console.log('task not found', e); if (taskFeedback) taskFeedback.textContent = 'Задания пока недоступны'; setTimeout(()=> taskFeedback.textContent = '',3000); });
      }
    }
  } catch (e) { console.warn('Failed to setup task block', e); }

  async function loadUser(){
    if (!tgid) return alert('tgid is required');
    const res = await fetch(`${apiBase}/user/${tgid}`);
    if (!res.ok) return alert('Failed to load user');
    const user = await res.json();
    scubeEl.textContent = user.scube;
    gcubeEl.textContent = user.gcube;
    energyEl.textContent = user.energy;
    energyCapEl.textContent = user.energy_capacity;
    dailyEl.textContent = user.daily_count;
    dailyLevelEl.textContent = user.daily_limit_level;
    dailyLimitEl.textContent = (250 + user.daily_limit_level * 50);
    dailyCostEl.textContent = (90 + user.daily_limit_level * 10);
    avatarEl.textContent = (user.name && user.name[0]) || 'A';

    // if server just did a daily refill, inform player
    if (user.last_refill) {
      const last = new Date(user.last_refill).toISOString().slice(0,10);
      const today = new Date().toISOString().slice(0,10);
      if (last === today) {
        showStoreFeedback('Энергия автоматически восстановлена сегодня (1 раз в день)');
      }
    }

    // start auto-tick if enabled
    if (user.auto_energy) startAutoTick(); else stopAutoTick();
  }

  golden.addEventListener('click', async ()=>{
    if (!tgid) return alert('tgid is required');
    const res = await fetch(`${apiBase}/user/${tgid}/click`, { method: 'POST' });
    const json = await res.json();
    if (!json.ok) return alert(json.message || 'Action failed');
    scubeEl.textContent = json.scube;
    energyEl.textContent = json.energy;
    dailyEl.textContent = json.daily_count;
    dailyLimitEl.textContent = json.daily_limit || dailyLimitEl.textContent;
  });

  watchAdBtn.addEventListener('click', async ()=>{
    if (!tgid) return alert('tgid is required');
    const cfg = window.ADSGRAM_CONFIG || {};
    const rewardBlock = cfg.rewardBlockId || cfg.interstitialBlockId;
    if (window.Adsgram && rewardBlock) {
      try {
        const controller = window.Adsgram.init({ blockId: rewardBlock });
        const result = await controller.show();
        console.log('reward show', result);
        // if watched till end or closed (per AdsGram), reward
        if (result && (result.done || result.state === 'destroy' || result.state === 'playing')) {
          // call server to credit reward
          await fetch(`${apiBase}/user/${tgid}/claim-reward`, { method: 'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ amount: 5 }) });
          await loadUser();
          showStoreFeedback('Награда начислена');
        } else {
          showStoreFeedback('Реклама не была просмотрена полностью');
        }
      } catch (err) {
        console.warn('Ads show error', err);
        // fallback to opening reward landing
        const url = `/reward?userId=${tgid}`;
        window.open(url, '_blank');
      }
    } else {
      // fallback: open /reward landing (AdsGram will redirect with userId)
      const url = `/reward?userId=${tgid}`;
      window.open(url, '_blank');
    }
  });

  // refill button handler
  const refillBtn = document.getElementById('refill-btn');
  if (refillBtn) {
    refillBtn.addEventListener('click', async ()=>{
      if (!tgid) return alert('tgid is required');
      const res = await fetch(`${apiBase}/user/${tgid}/refill`, { method: 'POST' });
      const json = await res.json();
      if (!json.ok) return showStoreFeedback(json.message || 'Ошибка восполнения');
      energyEl.textContent = json.energy;
      showStoreFeedback('Энергия восполнена до максимума');
    });
  }

  // auto-energy tick: if user has auto_energy, call endpoint every 10 seconds
  let autoTickInterval = null;
  async function startAutoTick(){
    if (autoTickInterval) return;
    autoTickInterval = setInterval(async ()=>{
      try {
        const res = await fetch(`${apiBase}/user/${tgid}/auto-tick`, { method: 'POST' });
        if (res.ok) {
          const json = await res.json();
          if (json.ok) energyEl.textContent = json.energy;
        }
      } catch (e) { console.warn('auto tick failed', e); }
    }, 10000);
  }
  function stopAutoTick(){ if (autoTickInterval) { clearInterval(autoTickInterval); autoTickInterval = null; } }


  scubeToGBtn.addEventListener('click', async ()=>{
    if (!tgid) return alert('tgid is required');
    const res = await fetch(`${apiBase}/user/${tgid}/exchange`, { method: 'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ direction: 'scube_to_gcube', units: 1 }) });
    const json = await res.json();
    if (!json.ok) return showStoreFeedback(json.message || 'Ошибка');
    scubeEl.textContent = json.scube;
    gcubeEl.textContent = json.gcube;
    showStoreFeedback('Обмен выполнен');
  });

  gcubeToSBtn.addEventListener('click', async ()=>{
    if (!tgid) return alert('tgid is required');
    const res = await fetch(`${apiBase}/user/${tgid}/exchange`, { method: 'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ direction: 'gcube_to_scube', units: 1 }) });
    const json = await res.json();
    if (!json.ok) return showStoreFeedback(json.message || 'Ошибка');
    scubeEl.textContent = json.scube;
    gcubeEl.textContent = json.gcube;
    showStoreFeedback('Обмен выполнен');
  });

  // Confirm modal helpers
  const confirmModal = document.getElementById('confirm-modal');
  const confirmMessage = document.getElementById('confirm-message');
  const confirmOk = document.getElementById('confirm-ok');
  const confirmCancel = document.getElementById('confirm-cancel');

  function showConfirm(message){
    return new Promise((resolve) => {
      confirmMessage.textContent = message;
      confirmModal.classList.remove('hidden');
      function cleanup() {
        confirmModal.classList.add('hidden');
        confirmOk.removeEventListener('click', onOk);
        confirmCancel.removeEventListener('click', onCancel);
      }
      function onOk(){ cleanup(); resolve(true); }
      function onCancel(){ cleanup(); resolve(false); }
      confirmOk.addEventListener('click', onOk);
      confirmCancel.addEventListener('click', onCancel);
    });
  }

  upgradeBtns.forEach(btn=>{
    btn.addEventListener('click', async ()=>{
      const type = btn.dataset.type;
      if (!tgid) return alert('tgid is required');
      const confirmed = await showConfirm('Подтвердите покупку: ' + (type === 'energy_capacity' ? 'Увеличение вместимости энергии (+50) за 100 SCube' : 'Увеличение дневного лимита (+50) за рассчитанную стоимость'));
      if (!confirmed) return showStoreFeedback('Покупка отменена');
      const res = await fetch(`${apiBase}/user/${tgid}/buy-upgrade`, { method: 'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ type }) });
      const json = await res.json();
      if (!json.ok) return showStoreFeedback(json.message || 'Ошибка покупки');
      await loadUser();
      showStoreFeedback('Покупка успешна');
      if (type === 'auto_energy') startAutoTick();
    });
  });

  // Confirm on exchange
  scubeToGBtn.addEventListener('click', async ()=>{
    if (!tgid) return alert('tgid is required');
    const confirmed = await showConfirm('Поме��ять 50 SCube на 1 GCube?');
    if (!confirmed) return showStoreFeedback('Обмен отменён');
    const res = await fetch(`${apiBase}/user/${tgid}/exchange`, { method: 'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ direction: 'scube_to_gcube', units: 1 }) });
    const json = await res.json();
    if (!json.ok) return showStoreFeedback(json.message || 'Ошибка');
    scubeEl.textContent = json.scube;
    gcubeEl.textContent = json.gcube;
    showStoreFeedback('Обмен выполнен');
  });

  gcubeToSBtn.addEventListener('click', async ()=>{
    if (!tgid) return alert('tgid is required');
    const confirmed = await showConfirm('Поменять 1 GCube на 50 SCube?');
    if (!confirmed) return showStoreFeedback('Обмен отменён');
    const res = await fetch(`${apiBase}/user/${tgid}/exchange`, { method: 'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ direction: 'gcube_to_scube', units: 1 }) });
    const json = await res.json();
    if (!json.ok) return showStoreFeedback(json.message || 'Ошибка');
    scubeEl.textContent = json.scube;
    gcubeEl.textContent = json.gcube;
    showStoreFeedback('Обмен выполнен');
  });

  function showStoreFeedback(msg){
    storeFeedback.textContent = msg;
    setTimeout(()=>{ storeFeedback.textContent = ''; }, 3000);
  }

  // Periodically refresh user data
  setInterval(loadUser, 5000);
  loadUser();
})();
