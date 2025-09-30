(function(){
  function qs(name){
    const url = new URL(window.location.href);
    return url.searchParams.get(name);
  }
  let tgid = qs('tgid');
  const apiBase = '/api';
  const APP_CONFIG = window.APP_CONFIG || {};
  const BOT_USERNAME = APP_CONFIG.BOT_USERNAME || '';
  const BOT_WEBAPP_PATH = APP_CONFIG.BOT_WEBAPP_PATH || '';
  const BASE_URL = APP_CONFIG.BASE_URL || window.location.origin;

  // If tgid not provided via query, try to get from Telegram WebApp init data
  if (!tgid && window.Telegram && window.Telegram.WebApp && window.Telegram.WebApp.initDataUnsafe && window.Telegram.WebApp.initDataUnsafe.user) {
    tgid = window.Telegram.WebApp.initDataUnsafe.user.id;
  }

  const appMessage = document.getElementById('app-message');

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

  // Referrals elements
  const referralsSection = document.getElementById('referrals');
  const referralInfoEl = document.getElementById('referral-info');
  const referralCodeEl = document.getElementById('referral-code');
  const referralStatsEl = document.getElementById('referral-stats');
  const copyReferralBtn = document.getElementById('copy-referral');

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

  // Track Telegram MiniApp expansion state
  let isExpanded = false;
  function computeExpanded(){
    try { return !!(window.Telegram && window.Telegram.WebApp && window.Telegram.WebApp.isExpanded); } catch(e){ return false; }
  }
  isExpanded = computeExpanded();
  try {
    if (window.Telegram && window.Telegram.WebApp && typeof window.Telegram.WebApp.onEvent === 'function') {
      window.Telegram.WebApp.onEvent('viewportChanged', ()=>{ isExpanded = computeExpanded(); });
    }
  } catch(e) {}

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
    });
  });

  // Interstitial scheduler: count only while MiniApp is fully expanded
  let interstitialTicker = null;
  let interstitialElapsed = 0; // ms accumulated only when expanded
  async function showInterstitialWithCountdownIfExpanded() {
    try {
      if (!isExpanded) return;
      if (!AdController || typeof AdController.show !== 'function') return;
      const overlay = document.getElementById('ad-countdown-overlay');
      if (overlay) {
        overlay.classList.remove('hidden');
        let count = 3;
        const badge = document.getElementById('ad-countdown-badge');
        while (count > 0 && isExpanded) {
          if (badge) badge.textContent = `Реклама через ${count}`;
          await new Promise(r=>setTimeout(r,1000));
          count -= 1;
        }
        overlay.classList.add('hidden');
      }
      if (!isExpanded) return;
      const result = await AdController.show();
      console.log('Scheduled interstitial shown', result);
    } catch (e) { console.warn('Scheduled interstitial failed', e); }
  }
  function startInterstitialScheduler() {
    if (interstitialTicker) return;
    interstitialTicker = setInterval(()=>{
      if (!isExpanded) return;
      interstitialElapsed += 1000;
      const TEN_MIN = 10 * 60 * 1000;
      if (interstitialElapsed >= TEN_MIN) {
        interstitialElapsed = 0;
        showInterstitialWithCountdownIfExpanded();
      }
    }, 1000);
  }
  function stopInterstitialScheduler(){ if (interstitialTicker) { clearInterval(interstitialTicker); interstitialTicker = null; } }

  // start scheduler if AdsGram initialized
  if (AdController) startInterstitialScheduler();

  // Helpers: cooldowns and animations for better UX
  function addAdCooldown(button, duration = 10000) {
    if (!button) return;
    if (button.disabled) return;
    button.disabled = true;
    button.classList.add('btn-disabled');
    const orig = button.dataset.origText || button.textContent;
    button.dataset.origText = orig;
    let seconds = Math.ceil(duration / 1000);
    button.textContent = `${orig} (${seconds}s)`;
    const iv = setInterval(() => {
      seconds -= 1;
      if (seconds > 0) button.textContent = `${orig} (${seconds}s)`;
      else {
        clearInterval(iv);
        button.disabled = false;
        button.classList.remove('btn-disabled');
        // restore original text
        button.textContent = button.dataset.origText || orig;
      }
    }, 1000);
  }

  function animateScube() {
    if (!scubeEl) return;
    scubeEl.classList.add('scube-pop');
    setTimeout(() => scubeEl.classList.remove('scube-pop'), 700);
  }
  function animateGolden() {
    // Subtle shrink via :active CSS only
  }

  // Insert task block if available
  try {
    const cfg = window.ADSGRAM_CONFIG || {};
    const taskId = cfg.taskBlockId;
    const wrapper = document.getElementById('ads-task-wrap');
    const taskFeedback = document.getElementById('task-feedback');
    if (wrapper) wrapper.textContent = '';
    if (taskFeedback) taskFeedback.textContent = '';
    if (taskId && window.Adsgram) {
      const taskEl = document.createElement('adsgram-task');
      taskEl.setAttribute('data-block-id', taskId);
      const onNotFound = () => {
        if (wrapper) wrapper.textContent = 'Пока заданий нет';
        if (taskFeedback) taskFeedback.textContent = '';
      };
      taskEl.addEventListener('onBannerNotFound', onNotFound);
      taskEl.addEventListener('onError', onNotFound);
      taskEl.addEventListener('reward', async (event) => {
        const detail = event && event.detail;
        const amount = (detail && (detail.reward || detail.amount)) || 5;
        try {
          const claimRes = await fetch(`${apiBase}/user/${tgid}/claim-reward`, { method: 'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ amount }) });
          const claimJson = await claimRes.json();
          if (claimJson.ok) {
            await loadUser();
            setTimeout(()=> animateScube(), 200);
          }
        } catch (e) { console.warn('Failed to claim task reward', e); }
      });
      if (wrapper) {
        wrapper.innerHTML = '';
        wrapper.appendChild(taskEl);
      }
    } else {
      if (wrapper) wrapper.textContent = 'Пока заданий нет';
    }
  } catch (e) { console.warn('Failed to setup task block', e); }

  async function loadUser(){
    if (!tgid) {
      if (appMessage) appMessage.textContent = 'Откройте игру через кнопку в боте (нажмите /start и затем "Открыть игру").';
      return;
    }
    try {
      const res = await fetch(`${apiBase}/user/${tgid}`);
      if (!res.ok) {
        let body = null;
        try { body = await res.json(); } catch(e){}
        const msg = (body && (body.error || body.message)) || `Server returned ${res.status}`;
        if (appMessage) appMessage.textContent = 'Не удалось загрузить данные пользователя: ' + msg;
        return;
      }
      const user = await res.json();
      if (appMessage) appMessage.textContent = '';
      scubeEl.textContent = user.scube;
      gcubeEl.textContent = user.gcube;
      energyEl.textContent = user.energy;
      energyCapEl.textContent = user.energy_capacity;
      dailyEl.textContent = user.daily_count;
      dailyLevelEl.textContent = user.daily_limit_level;
      dailyLimitEl.textContent = (250 + user.daily_limit_level * 50);
      dailyCostEl.textContent = (90 + user.daily_limit_level * 10);
      avatarEl.textContent = (user.name && user.name[0]) || 'A';

      // start auto-tick if enabled
    if (user.auto_energy) startAutoTick(); else stopAutoTick();

    // set referrer if present in start_param or URL param (only once)
    try {
      const startParam = (window.Telegram && window.Telegram.WebApp && window.Telegram.WebApp.initDataUnsafe && window.Telegram.WebApp.initDataUnsafe.start_param) || '';
      const urlRef = qs('ref');
      const payload = startParam || urlRef || '';
      const m = String(payload).match(/ref[_-]?(\d+)/i) || String(payload).match(/^(\d+)$/);
      const ref = m && m[1] ? Number(m[1]) : null;
      const refSetKey = `ref_set_${tgid}`;
      if (ref && Number(ref) !== Number(tgid) && !localStorage.getItem(refSetKey)) {
        await fetch(`${apiBase}/user/${tgid}/set-referrer`, { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify({ referrer: Number(ref) }) });
        localStorage.setItem(refSetKey, '1');
      }
    } catch (e) { console.warn('set-referrer failed', e); }

    // update referrals panel (if present)
    try {
      if (referralInfoEl) referralInfoEl.textContent = user.referrer_tgid ? `Вас пригласил: ${user.referrer_tgid}` : 'Вас никто не приглашал';
      if (referralCodeEl) {
        const deepLink = BOT_USERNAME ? (BOT_WEBAPP_PATH ? `https://t.me/${BOT_USERNAME}/${BOT_WEBAPP_PATH}?startapp=ref_${user.tgid}` : `https://t.me/${BOT_USERNAME}?startapp=ref_${user.tgid}`) : `${BASE_URL}/miniapp?ref=${user.tgid}&tgid=${user.tgid}`;
        referralCodeEl.innerHTML = `<div class="referral-code-line">Ваш код: <strong>${user.tgid}</strong></div><div class="referral-link-line"><input id="referral-link-input" readonly value="${deepLink}" class="referral-link-input" /><button id="copy-referral" class="copy-referral small-btn">Копировать</button></div>`;
        const copyBtn = document.getElementById('copy-referral');
        if (copyBtn) copyBtn.addEventListener('click', ()=>{
          const input = document.getElementById('referral-link-input');
          if (input) {
            try { navigator.clipboard.writeText(input.value); showStoreFeedback('Ссылка скопирована'); } catch(e){ input.select(); document.execCommand('copy'); showStoreFeedback('Ссылка скопирована'); }
          }
        });
        const inviteBtn = document.getElementById('invite-btn');
        if (inviteBtn) inviteBtn.onclick = ()=>{
          const shareText = encodeURIComponent('Залетай в GC Farm! Мой инвайт:');
          const shareUrl = encodeURIComponent(deepLink);
          const tgLink = `https://t.me/share/url?url=${shareUrl}&text=${shareText}`;
          try {
            if (window.Telegram && window.Telegram.WebApp && typeof window.Telegram.WebApp.openTelegramLink === 'function') {
              window.Telegram.WebApp.openTelegramLink(tgLink);
            } else {
              window.open(tgLink, '_blank');
            }
          } catch (e) { window.open(tgLink, '_blank'); }
        };
      }
      if (referralStatsEl) referralStatsEl.innerHTML = `Приглашено: ${user.referrals_count || 0} | Бонусы получено: ${user.referrer_bonus || 0} SCube`;
    } catch(e){ console.warn('referral ui update failed', e); }
    } catch (err) {
      console.error('loadUser error', err);
      if (appMessage) appMessage.textContent = 'Ошибка связи с сервером. Попробуйте позже.';
    }
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
    animateScube();
    animateGolden();
  });

  // helper to poll server for changes
  async function pollForChange(getter, initialValue, timeout = 30000, interval = 2000) {
    const start = Date.now();
    while (Date.now() - start < timeout) {
      try {
        const res = await fetch(`${apiBase}/user/${tgid}`);
        if (res.ok) {
          const user = await res.json();
          const value = getter(user);
          if (value !== initialValue) return user;
        }
      } catch (e) { console.warn('poll error', e); }
      await new Promise(r => setTimeout(r, interval));
    }
    return null;
  }

  let adBusy = false;
  watchAdBtn.addEventListener('click', async ()=>{
    if (adBusy) return;
    // require full expansion before proceeding
    if (!isExpanded) {
      try { if (window.Telegram && window.Telegram.WebApp && window.Telegram.WebApp.expand) window.Telegram.WebApp.expand(); } catch(e){}
      return showStoreFeedback('Разверните MiniApp полностью и повторите');
    }
    adBusy = true;
    try {
      if (!tgid) { adBusy = false; return alert('tgid is required'); }
      // prevent rapid re-click by adding a 10s cooldown
      addAdCooldown(watchAdBtn, 10000);
    const cfg = window.ADSGRAM_CONFIG || {};
    const rewardBlock = cfg.rewardBlockId || cfg.interstitialBlockId;
    if (window.Adsgram && rewardBlock) {
      try {
        const controller = window.Adsgram.init({ blockId: rewardBlock });
        const beforeRes = await fetch(`${apiBase}/user/${tgid}`);
        const before = beforeRes.ok ? await beforeRes.json() : null;
        const beforeScube = before ? Number(before.scube) : null;

        const result = await controller.show();
        console.log('reward show', result);
        if (result && result.done && !result.error) {
          // Directly claim reward because AdsGram does not provide server postbacks in your panel
          const claimRes = await fetch(`${apiBase}/user/${tgid}/claim-reward`, { method: 'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ amount: 5 }) });
          const claimJson = await claimRes.json();
          if (claimJson.ok) {
            scubeEl.textContent = claimJson.scube;
            animateScube();
            showStoreFeedback('Награда зачислена');
          } else {
            showStoreFeedback(claimJson.message || 'Невозможно зачислить награду');
          }
        } else {
          showStoreFeedback('Реклама не была просмотрена полностью');
        }
      } catch (err) {
        console.warn('Ads show error', err);
        const url = `/reward?userId=${tgid}`;
        window.open(url, '_blank');
      }
    } else {
      const url = `/reward?userId=${tgid}`;
      window.open(url, '_blank');
    }
    } finally { adBusy = false; }
  });


  // refill button handler: show energy ad if block exists, otherwise do direct refill
  const refillBtn = document.getElementById('refill-btn');
  if (refillBtn) {
    let refillBusy = false;
    refillBtn.addEventListener('click', async ()=>{
      if (refillBusy) return;
      // require full expansion before proceeding
      if (!isExpanded) {
        try { if (window.Telegram && window.Telegram.WebApp && window.Telegram.WebApp.expand) window.Telegram.WebApp.expand(); } catch(e){}
        return showStoreFeedback('Разверните MiniApp полностью и повторите');
      }
      refillBusy = true;
      try {
        if (!tgid) { refillBusy = false; return alert('tgid is required'); }
        // add cooldown to avoid rapid ad openings
        addAdCooldown(refillBtn, 10000);
      const cfg = window.ADSGRAM_CONFIG || {};
      const energyBlock = cfg.energyAdBlockId || cfg.rewardBlockId || cfg.interstitialBlockId;
      if (window.Adsgram && cfg.energyAdBlockId) {
        try {
          const beforeRes = await fetch(`${apiBase}/user/${tgid}`);
          const before = beforeRes.ok ? await beforeRes.json() : null;
          const beforeEnergy = before ? Number(before.energy) : null;

          const controller = window.Adsgram.init({ blockId: cfg.energyAdBlockId });
          const result = await controller.show();
          if (result && result.done && !result.error) {
            // Immediately request server to refill energy after confirmed ad view
            const resRefill = await fetch(`${apiBase}/user/${tgid}/refill`, { method: 'POST' });
            if (resRefill.ok) {
              const jsonRefill = await resRefill.json();
              if (jsonRefill.ok) {
                energyEl.textContent = jsonRefill.energy;
                showStoreFeedback('Энергия восполнена');
              } else {
                showStoreFeedback(jsonRefill.message || 'Ошибка восполнения энергии');
              }
            } else {
              showStoreFeedback('Сервер не отвечает при попытке восполнить энергию');
            }
          } else {
            showStoreFeedback('Реклама не была просмотрена полностью');
          }
        } catch (e) {
          console.warn('Energy ad show error', e);
          showStoreFeedback('Ошибка при показе рекламы');
        }
      } else {
        // fallback: direct refill (only for testing) — in production prefer ad-based refill
        const res = await fetch(`${apiBase}/user/${tgid}/refill`, { method: 'POST' });
        const json = await res.json();
        if (!json.ok) return showStoreFeedback(json.message || 'Ошибка восполнения');
        energyEl.textContent = json.energy;
        showStoreFeedback('Энергия восполнена до максимума (без рекламы)');
      }
      } finally {
        refillBusy = false;
      }
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
    const confirmed = await showConfirm('Поменять 50 SCube на 1 GCube?');
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
