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

  const leaderList = document.getElementById('leader-list');
  const leaderEmpty = document.getElementById('leader-empty');
  const leaderButtons = document.querySelectorAll('.leader-btn');
  const leaderboardSection = document.getElementById('leaderboard');
  const leaderSelfRank = document.getElementById('leader-self-rank');
  const leaderSelfValue = document.getElementById('leader-self-value');
  const leaderSelfNote = document.getElementById('leader-self-note');
  const leaderPersonal = document.getElementById('leader-personal');

  const leaderboardCache = { clicks: null, tasks: null };
  const leaderboardCacheTime = { clicks: 0, tasks: 0 };
  const LEADERBOARD_CACHE_TTL = 60 * 1000;
  let leaderboardMode = 'clicks';
  let leaderboardRequestId = 0;

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

  const storeFab = document.getElementById('store-fab');
  const gamesSection = document.getElementById('games');
  const gameCards = document.getElementById('game-cards');
  const betSelector = document.getElementById('bet-selector');
  const roomsList = document.getElementById('rooms-list');
  const createRoomBtn = document.getElementById('create-room');
  const gameStage = document.getElementById('game-stage');

  function setStoreFabVisibility(activeTab){
    if (!storeFab) return;
    if (activeTab === 'home') storeFab.classList.remove('hidden'); else storeFab.classList.add('hidden');
  }

  function showTab(tab){
    contents.forEach(c=>{ if (c.id===tab) c.classList.remove('hidden'); else c.classList.add('hidden'); });
    tabs.forEach(b=>{
      if (b.dataset.tab === tab) b.classList.add('active'); else b.classList.remove('active');
    });
    if (tab === 'leaderboard') loadLeaderboard(leaderboardMode);
    setStoreFabVisibility(tab);
  }

  if (storeFab) storeFab.addEventListener('click', ()=>{ showTab('store'); });

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
      const tab = btn.dataset.tab;
      showTab(tab);
    });
  });

  function showLeaderboardMessage(message) {
    if (!leaderEmpty) return;
    leaderEmpty.textContent = message;
    leaderEmpty.classList.remove('hidden');
  }

  function hideLeaderboardMessage() {
    if (!leaderEmpty) return;
    leaderEmpty.classList.add('hidden');
  }

  function pluralizeRu(value, forms) {
    const abs = Math.abs(Number(value) || 0) % 100;
    const last = abs % 10;
    if (abs > 10 && abs < 20) return forms[2];
    if (last === 1) return forms[0];
    if (last >= 2 && last <= 4) return forms[1];
    return forms[2];
  }

  function formatViewerValue(mode, value) {
    const safe = Number(value) || 0;
    if (mode === 'tasks') {
      const label = pluralizeRu(safe, ['задача', 'задачи', 'задач']);
      return `${safe} ${label}`;
    }
    return `${safe} SCube`;
  }

  function updateLeaderboardInsights(viewer, mode, state = 'ready') {
    if (!leaderSelfRank || !leaderSelfValue || !leaderSelfNote) return;
    const isTasks = mode === 'tasks';
    if (state === 'loading') {
      leaderSelfRank.textContent = '…';
      leaderSelfValue.textContent = '…';
      leaderSelfNote.textContent = isTasks ? 'Загружаем рейтинг по заданиям…' : 'Загружаем рейтинг по SCube…';
      if (leaderPersonal) leaderPersonal.classList.add('leader-personal-empty');
      return;
    }

    if (!tgid) {
      leaderSelfRank.textContent = '—';
      leaderSelfValue.textContent = formatViewerValue(mode, 0);
      leaderSelfNote.textContent = 'Открой игру через бота, чтобы участвовать в рейтинге.';
      if (leaderPersonal) leaderPersonal.classList.add('leader-personal-empty');
      return;
    }

    if (!viewer) {
      leaderSelfRank.textContent = '—';
      leaderSelfValue.textContent = formatViewerValue(mode, 0);
      leaderSelfNote.textContent = isTasks ? 'Закрывай задания AdsGram, и ты быстро поднимешься!' : 'Нажимай на золотой куб, чтобы добыть больше SCube.';
      if (leaderPersonal) leaderPersonal.classList.add('leader-personal-empty');
      return;
    }

    if (leaderPersonal) leaderPersonal.classList.remove('leader-personal-empty');
    leaderSelfRank.textContent = viewer.rank ? `#${viewer.rank}` : '—';
    leaderSelfValue.textContent = formatViewerValue(mode, viewer.value);
    if (viewer.rank <= 3) {
      leaderSelfNote.textContent = 'Ты на пьедестале! Держи темп. 🌟';
    } else if (viewer.rank <= 10) {
      leaderSelfNote.textContent = 'До медалей рукой подать — продолжай в том же духе!';
    } else {
      leaderSelfNote.textContent = isTasks ? 'Выполняй задания и ��абирай награды, чтобы расти.' : 'Добывай ещё SCube — каждый клик приближает к топу!';
    }
  }

  function renderLeaderboard(entries, mode, viewer) {
    if (!leaderList) return;
    leaderList.innerHTML = '';
    const hasEntries = Array.isArray(entries) && entries.length > 0;
    if (!hasEntries) {
      updateLeaderboardInsights(viewer, mode);
      showLeaderboardMessage('Пока нет данных');
      return;
    }

    hideLeaderboardMessage();
    const podiumIcons = ['🥇', '🥈', '🥉'];
    let viewerPlaced = false;

    entries.forEach((entry)=>{
      const item = document.createElement('li');
      item.className = 'leader-item';
      if (entry.rank <= 3) {
        item.classList.add('leader-item-top');
      }

      const rankSpan = document.createElement('span');
      rankSpan.className = 'leader-rank';
      rankSpan.textContent = entry.rank <= 3 ? (podiumIcons[entry.rank - 1] || `#${entry.rank}`) : `#${entry.rank}`;

      const nameSpan = document.createElement('span');
      nameSpan.className = 'leader-name';
      nameSpan.textContent = entry.name || `Игрок ${entry.tgid}`;

      const valueSpan = document.createElement('span');
      valueSpan.className = 'leader-value';
      valueSpan.textContent = formatViewerValue(mode, entry.value);

      if (viewer && Number(entry.tgid) === Number(viewer.tgid)) {
        item.classList.add('leader-item-self');
        viewerPlaced = true;
      }

      item.append(rankSpan, nameSpan, valueSpan);
      leaderList.appendChild(item);
    });

    if (viewer && !viewerPlaced) {
      const viewerItem = document.createElement('li');
      viewerItem.className = 'leader-item leader-item-self leader-item-outside';
      const rankSpan = document.createElement('span');
      rankSpan.className = 'leader-rank';
      rankSpan.textContent = viewer.rank ? `#${viewer.rank}` : '—';

      const nameSpan = document.createElement('span');
      nameSpan.className = 'leader-name';
      nameSpan.textContent = viewer.name || `Игрок ${viewer.tgid}`;

      const valueSpan = document.createElement('span');
      valueSpan.className = 'leader-value';
      valueSpan.textContent = formatViewerValue(mode, viewer.value);

      viewerItem.append(rankSpan, nameSpan, valueSpan);
      leaderList.appendChild(viewerItem);
    }

    updateLeaderboardInsights(viewer, mode);
  }

  async function loadLeaderboard(by, forceReload = false) {
    if (!leaderList || !leaderEmpty) return;
    const mode = by === 'tasks' ? 'tasks' : 'clicks';
    const now = Date.now();
    const cached = leaderboardCache[mode];
    if (!forceReload && cached && now - leaderboardCacheTime[mode] < LEADERBOARD_CACHE_TTL) {
      renderLeaderboard(cached.entries, mode, cached.viewer);
      return;
    }

    updateLeaderboardInsights(null, mode, 'loading');
    const requestId = ++leaderboardRequestId;
    leaderList.innerHTML = '';
    showLeaderboardMessage('Загружаем рейтинг...');

    try {
      const viewerQuery = tgid ? `&viewer=${tgid}` : '';
      const res = await fetch(`${apiBase}/leaderboard?by=${mode}${viewerQuery}`);
      if (!res.ok) throw new Error(`Failed with status ${res.status}`);
      const json = await res.json();
      if (!json.ok) throw new Error(json.message || 'Bad response');
      const payload = {
        entries: Array.isArray(json.entries) ? json.entries : [],
        viewer: json.viewer || null
      };
      leaderboardCache[mode] = payload;
      leaderboardCacheTime[mode] = Date.now();
      if (leaderboardRequestId === requestId) {
        renderLeaderboard(payload.entries, mode, payload.viewer);
      }
    } catch (err) {
      if (leaderboardRequestId === requestId) {
        showLeaderboardMessage('Не удалось загрузить рейтинг');
        updateLeaderboardInsights(null, mode);
      }
      console.warn('leaderboard fetch failed', err);
    }
  }

  if (leaderButtons && leaderButtons.length) {
    leaderButtons.forEach((btn)=>{
      btn.addEventListener('click', ()=>{
        const mode = btn.id === 'leader-by-tasks' ? 'tasks' : 'clicks';
        if (leaderboardMode === mode) return;
        leaderboardMode = mode;
        leaderButtons.forEach((b)=>b.classList.remove('active'));
        btn.classList.add('active');
        loadLeaderboard(mode);
      });
    });
  }

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
          const claimRes = await fetch(`${apiBase}/user/${tgid}/claim-reward`, { method: 'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ amount, source: 'task' }) });
          const claimJson = await claimRes.json();
          if (claimJson.ok) {
            await loadUser();
            leaderboardCache.tasks = null;
            leaderboardCacheTime.tasks = 0;
            if (leaderboardSection && !leaderboardSection.classList.contains('hidden') && leaderboardMode === 'tasks') {
              loadLeaderboard('tasks', true);
            }
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
      if (appMessage) appMessage.textContent = 'Откройте игру через кнопку в ��оте (нажмите /start и затем "Открыть игру").';
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
      if (appMessage) appMessage.textContent = 'Ошибка связи с сервером. Поп��обуйте по��же.';
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
    leaderboardCache.clicks = null;
    leaderboardCacheTime.clicks = 0;
    if (leaderboardSection && !leaderboardSection.classList.contains('hidden') && leaderboardMode === 'clicks') {
      loadLeaderboard('clicks', true);
    }
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
  async function executeExchange(direction, successMessage){
    if (!tgid) {
      alert('tgid is required');
      return;
    }
    try {
      const res = await fetch(`${apiBase}/user/${tgid}/exchange`, {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({ direction, units: 1 })
      });
      const json = await res.json();
      if (!json.ok) {
        showStoreFeedback(json.message || 'Ошибка');
        return;
      }
      scubeEl.textContent = json.scube;
      gcubeEl.textContent = json.gcube;
      showStoreFeedback(successMessage);
    } catch (err) {
      console.warn('exchange failed', err);
      showStoreFeedback('Не удалось выполнить обмен');
    }
  }

  if (scubeToGBtn) {
    scubeToGBtn.addEventListener('click', async ()=>{
      const confirmed = await showConfirm('Поменять 50 SCube на 1 GCube?');
      if (!confirmed) {
        showStoreFeedback('Обмен отменён');
        return;
      }
      await executeExchange('scube_to_gcube', 'Обмен выполнен');
    });
  }

  if (gcubeToSBtn) {
    gcubeToSBtn.addEventListener('click', async ()=>{
      const confirmed = await showConfirm('Поменять 1 GCube на 50 SCube?');
      if (!confirmed) {
        showStoreFeedback('Обмен отменён');
        return;
      }
      await executeExchange('gcube_to_scube', 'Обмен выполнен');
    });
  }

  function showStoreFeedback(msg){
    if (!storeFeedback) return;
    storeFeedback.textContent = msg;
    setTimeout(()=>{ if (storeFeedback) storeFeedback.textContent = ''; }, 3000);
  }

  // Games state and handlers
  let selectedGame = 'rps';
  let selectedBet = 50;
  let currentRoomId = null;
  let roomPollIv = null;

  function renderRooms(rooms){
    if (!roomsList) return;
    roomsList.innerHTML = '';
    if (!rooms || !rooms.length){
      const empty = document.createElement('div');
      empty.className = 'store-empty';
      empty.textContent = 'Нет доступных комнат. Создайте свою!';
      roomsList.appendChild(empty);
      return;
    }
    rooms.forEach(r=>{
      const card = document.createElement('div');
      card.className = 'room-card';
      const meta = document.createElement('div'); meta.className = 'room-meta';
      const title = document.createElement('div'); title.className = 'room-title'; title.textContent = `${r.game === 'rps' ? 'КНБ' : 'Крестики-нолики'} • Ставка ${r.bet}`;
      const sub = document.createElement('div'); sub.className = 'room-sub'; sub.textContent = `Создатель: ${r.creator}`;
      meta.append(title, sub);
      const join = document.createElement('button'); join.className = 'join-btn'; join.textContent = 'Вступить';
      join.addEventListener('click', ()=> joinRoom(r.id));
      card.append(meta, join);
      roomsList.appendChild(card);
    });
  }

  async function loadRooms(){
    try{
      const res = await fetch(`${apiBase}/games/rooms?game=${selectedGame}&bet=${selectedBet}`);
      const json = await res.json();
      if (json.ok) renderRooms(json.rooms);
    } catch(e){ console.warn('rooms load failed', e); }
  }

  async function createRoom(){
    if (!tgid) return alert('tgid is required');
    try{
      const res = await fetch(`${apiBase}/games/rooms`, { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ tgid, game: selectedGame, bet: selectedBet }) });
      const json = await res.json();
      if (!json.ok) return alert(json.message || 'Не удалось создать комнату');
      currentRoomId = json.room.id;
      openRoom(json.room);
      await loadUser();
    } catch(e){ console.warn('create room failed', e); }
  }

  async function joinRoom(id){
    if (!tgid) return alert('tgid is required');
    try{
      const res = await fetch(`${apiBase}/games/rooms/${id}/join`, { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ tgid }) });
      const json = await res.json();
      if (!json.ok) return alert(json.message || 'Не удалось войти в комнату');
      currentRoomId = json.room.id;
      openRoom(json.room);
      await loadUser();
    } catch(e){ console.warn('join room failed', e); }
  }

  async function leaveRoom(){
    if (!currentRoomId) return;
    try{
      await fetch(`${apiBase}/games/rooms/${currentRoomId}/leave`, { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ tgid }) });
    } catch(e){}
    clearInterval(roomPollIv); roomPollIv=null;
    currentRoomId = null;
    gameStage.innerHTML = '';
    gameStage.classList.add('hidden');
    loadRooms();
    await loadUser();
  }

  function startRoomPolling(){
    if (roomPollIv) clearInterval(roomPollIv);
    roomPollIv = setInterval(async ()=>{
      if (!currentRoomId) return;
      try{
        const res = await fetch(`${apiBase}/games/rooms/${currentRoomId}`);
        const json = await res.json();
        if (json.ok) openRoom(json.room);
      } catch(e){}
    }, 1500);
  }

  function setInMatch(on){
    const root = document.querySelector('.game-root');
    if (!root) return;
    if (on) root.classList.add('in-match'); else root.classList.remove('in-match');
  }

  function openRoom(room){
    if (!gameStage) return;
    const active = room.status !== 'finished';
    setInMatch(active);
    showTab('games');
    gameStage.classList.remove('hidden');
    if (room.game === 'rps') renderRps(room); else renderTtt(room);
    if (active && !roomPollIv) startRoomPolling();
    if (!active && roomPollIv) { clearInterval(roomPollIv); roomPollIv=null; }
  }

  function renderRps(room){
    const me = String(tgid);
    const opp = me === String(room.creator) ? String(room.opponent||'') : String(room.creator);
    const moves = room.state && room.state.moves || {};
    const myMove = moves[me];
    const oppMove = moves[opp];
    const finished = room.status === 'finished';

    const wrap = document.createElement('div');
    const title = document.createElement('div'); title.className='room-title'; title.textContent = `КНБ • Ставка ${room.bet}`;
    const notice = document.createElement('div'); notice.className='room-sub'; notice.textContent = 'Сделайте ход за 30 секунд, иначе поражение.';
    const controls = document.createElement('div'); controls.className='rps-controls';
    ['rock','paper','scissors'].forEach(m=>{
      const btn = document.createElement('button'); btn.className='rps-btn'; btn.textContent = m==='rock'?'✊':(m==='paper'?'✋':'✌️');
      btn.disabled = !!myMove || finished || !room.opponent;
      btn.addEventListener('click', ()=> submitMove(room.id, { move: m }));
      controls.appendChild(btn);
    });
    const result = document.createElement('div'); result.className='rps-result';
    if (!room.opponent) result.textContent = 'Ожидание соперника...';
    else if (!myMove) result.textContent = 'Сделайте ход';
    else if (!oppMove) result.textContent = 'Ожидаем ход соперника';
    if (finished){
      if (room.state && room.state.result){
        const r = room.state.result;
        const banner = document.createElement('div');
        if (r.type==='draw') { banner.className = 'result-banner draw'; banner.textContent = 'Ничья. Ставки возвращены'; }
        else if (String(r.winner)===me) { banner.className = 'result-banner win'; banner.textContent = 'Победа! Вы получили банк'; }
        else { banner.className = 'result-banner lose'; banner.textContent = 'Поражение'; }
        wrap.appendChild(banner);
      }
    }
    const leave = document.createElement('button'); leave.className='join-btn'; leave.textContent = finished ? 'Выйти' : 'Сдаться';
    leave.addEventListener('click', leaveRoom);

    wrap.append(title, notice, controls, result, leave);
    gameStage.innerHTML='';
    gameStage.appendChild(wrap);
  }

  function renderTtt(room){
    const me = String(tgid);
    const board = room.state && room.state.board || Array(9).fill(null);
    const turn = room.state && room.state.turn;
    const symbols = room.state && room.state.symbols || {};
    const mySym = symbols[me];
    const finished = room.status === 'finished';

    const wrap = document.createElement('div');
    const title = document.createElement('div'); title.className='room-title'; title.textContent = `Крестики-нолики • Ставка ${room.bet}`;
    const notice = document.createElement('div'); notice.className='room-sub'; notice.textContent = 'На ход даётся 30 секунд. Превышение — поражение.';
    const grid = document.createElement('div'); grid.className='ttt-board';
    board.forEach((cell, idx)=>{
      const c = document.createElement('div'); c.className='ttt-cell'; c.textContent = cell || '';
      const canClick = !finished && mySym && String(turn)===me && !cell;
      if (canClick) c.addEventListener('click', ()=> submitMove(room.id, { idx }));
      grid.appendChild(c);
    });
    const status = document.createElement('div'); status.className='ttt-status';
    if (!room.opponent) status.textContent = 'Ожидание соперника...';
    else if (finished){
      let banner;
      if (room.state && room.state.winner){
        const win = String(room.state.winner)===me;
        banner = document.createElement('div');
        banner.className = 'result-banner ' + (win ? 'win' : 'lose');
        banner.textContent = win ? 'Победа!' : 'Поражение';
      } else {
        banner = document.createElement('div');
        banner.className = 'result-banner draw';
        banner.textContent = 'Ничья';
      }
      wrap.appendChild(banner);
    } else if (String(turn)===me) status.textContent = 'Ваш ход'; else status.textContent = 'Ход соперника';
    const leave = document.createElement('button'); leave.className='join-btn'; leave.textContent = finished ? 'Выйти' : 'Сдаться';
    leave.addEventListener('click', leaveRoom);

    wrap.append(title, notice, grid, status, leave);
    gameStage.innerHTML='';
    gameStage.appendChild(wrap);
  }

  async function submitMove(roomId, payload){
    try{
      const res = await fetch(`${apiBase}/games/rooms/${roomId}/move`, { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ tgid, ...payload }) });
      const json = await res.json();
      if (!json.ok) return;
      openRoom(json.room);
      if (json.room.status==='finished') { clearInterval(roomPollIv); roomPollIv=null; await loadUser(); }
    } catch(e){}
  }

  // UI bindings for games
  if (gameCards){
    gameCards.addEventListener('click', (e)=>{
      const btn = e.target.closest('.game-card');
      if (!btn) return;
      selectedGame = btn.dataset.game || 'rps';
      loadRooms();
    });
  }
  if (betSelector){
    betSelector.addEventListener('click', (e)=>{
      const chip = e.target.closest('.bet-chip');
      if (!chip) return;
      const v = parseInt(chip.dataset.bet,10);
      if (!v) return;
      selectedBet = v;
      betSelector.querySelectorAll('.bet-chip').forEach(c=>c.classList.remove('active'));
      chip.classList.add('active');
      loadRooms();
    });
    // set default active
    const def = betSelector.querySelector('[data-bet="50"]'); if (def) def.classList.add('active');
  }
  if (createRoomBtn){ createRoomBtn.addEventListener('click', createRoom); }

  // when entering games tab, load rooms
  const gamesTabBtn = Array.from(tabs).find(b=>b.dataset.tab==='games');
  if (gamesTabBtn){ gamesTabBtn.addEventListener('click', ()=>{ if (!currentRoomId) loadRooms(); }); }

  // Periodically refresh user data
  setInterval(loadUser, 5000);
  loadUser();
  // initial tab effects
  const activeBtn = document.querySelector('.tab-button.active');
  setStoreFabVisibility(activeBtn ? activeBtn.dataset.tab : 'home');
})();
