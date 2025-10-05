(function(){
  function qs(name){
    const url = new URL(window.location.href);
    return url.searchParams.get(name);
  }
  let tgid = qs('tgid');
  try {
    if (!tgid && window.Telegram && window.Telegram.WebApp && window.Telegram.WebApp.initDataUnsafe && window.Telegram.WebApp.initDataUnsafe.user) {
      tgid = window.Telegram.WebApp.initDataUnsafe.user.id;
    }
  } catch(e) {}
const apiBase = '/api';
const APP_CONFIG = window.APP_CONFIG || {};
const BOT_USERNAME = APP_CONFIG.BOT_USERNAME || '';
const BOT_WEBAPP_PATH = APP_CONFIG.BOT_WEBAPP_PATH || '';
const BASE_URL = APP_CONFIG.BASE_URL || window.location.origin;

const DEFAULT_AD_REWARD = 5;
const DEFAULT_TASK_REWARD = 15;

function resolveAdsgramReward(detail, fallback = DEFAULT_AD_REWARD) {
  const data = detail || {};
  const numericKeys = ['reward','amount','value','payout','reward_amount','rewardAmount','bonus','coins'];
  let amount;
  for (const key of numericKeys) {
    if (!Object.prototype.hasOwnProperty.call(data, key)) continue;
    const parsed = Number(data[key]);
    if (Number.isFinite(parsed) && parsed > 0) {
      amount = parsed;
      break;
    }
  }
  const typeCandidates = [
    data.type,
    data.event,
    data.category,
    data.kind,
    data.mode,
    data.source,
    data.reward_type
  ].filter(Boolean).map(value => String(value).toLowerCase());
  const tagCandidates = Array.isArray(data.tags) ? data.tags.map(tag => String(tag).toLowerCase()) : [];
  const taskMarkers = ['task','mission','quest'];
  const hasTaskMarker = typeCandidates.concat(tagCandidates).some(entry => taskMarkers.some(marker => entry.includes(marker)));
  const hasTaskId = Boolean(data.taskId || data.task_id || data.task);
  const isTask = hasTaskMarker || hasTaskId;
  const fallbackAmount = isTask ? DEFAULT_TASK_REWARD : fallback;
  const resolved = amount && amount > 0 ? amount : fallbackAmount;
  return { amount: Math.min(1000000, Math.max(1, Math.round(resolved))), isTask };
}

function extractAdsgramContextId(detail) {
  const data = detail || {};
  const candidates = [
    data.eventId,
    data.event_id,
    data.transactionId,
    data.transaction_id,
    data.rewardId,
    data.reward_id,
    data.taskId,
    data.task_id,
    data.clickId,
    data.click_id,
    data.orderId,
    data.order_id,
    data.id,
    data.requestId,
    data.request_id
  ];
  for (const candidate of candidates) {
    if (candidate === undefined || candidate === null) continue;
    const trimmed = String(candidate).trim();
    if (trimmed) return trimmed;
  }
  const user = data.userId || data.tgid || data.user_id;
  const adUnit = data.adUnit || data.ad_unit;
  const stamp = data.timestamp || data.time || data.createdAt || data.created_at || data.ts;
  if (user && stamp) return `${user}:${stamp}`;
  if (user && adUnit) return `${user}:${adUnit}`;
  return null;
}

// If tgid not provided via query, try to get from Telegram WebApp init data
if (!tgid && window.Telegram && window.Telegram.WebApp && window.Telegram.WebApp.initDataUnsafe && window.Telegram.WebApp.initDataUnsafe.user) {
  tgid = window.Telegram.WebApp.initDataUnsafe.user.id;
}

  // Exchange Telegram initData for a secure HttpOnly session (anti-cheat)
  (async function tryAuth(){
    try {
      if (window.Telegram && window.Telegram.WebApp && window.Telegram.WebApp.initData) {
        const initData = window.Telegram.WebApp.initData;
        if (initData && initData.length > 0) {
          const res = await fetch('/auth/telegram', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ initData }) });
          if (res.ok) {
            const json = await res.json();
            if (json && json.ok && json.tgid) {
              tgid = json.tgid;
            }
          }
        }
      }
    } catch (e) { console.warn('Auth exchange failed', e); }
  })();

  const appMessage = document.getElementById('app-message');
  const loadingOverlay = document.getElementById('loading-screen');
  const loadingMessageEl = document.getElementById('loading-message');
  let initialDataLoaded = false;
  const INITIAL_LOADING_TEXT = 'Загружаем вашу базу…';

  // Onboarding controls
  const ONB_KEY = 'onboarding_shown_v1';
  const onbEl = document.getElementById('onboarding');
  const onbSlides = document.getElementById('onb-slides');
  const onbDots = document.getElementById('onb-dots');
  const onbSkip = document.getElementById('onb-skip');
  const onbNext = document.getElementById('onb-next');
  let onbIndex = 0;
  function initOnboarding(){
    if (!onbEl || !onbSlides || !onbDots) return;
    const total = onbSlides.querySelectorAll('.onb-slide').length;
    onbDots.innerHTML = '';
    for (let i=0; i<total; i++){
      const dot = document.createElement('span');
      dot.className = 'onb-dot' + (i===0 ? ' active' : '');
      onbDots.appendChild(dot);
    }
    function render(){
      const slides = onbSlides.querySelectorAll('.onb-slide');
      slides.forEach((s, idx)=>{ if (idx===onbIndex){ s.classList.add('onb-slide-active'); } else { s.classList.remove('onb-slide-active'); } });
      const dots = onbDots.querySelectorAll('.onb-dot');
      dots.forEach((d, idx)=>{ if (idx===onbIndex){ d.classList.add('active'); } else { d.classList.remove('active'); } });
      onbNext.textContent = (onbIndex === total - 1) ? 'Начать' : 'Далее';
    }
    if (onbSkip) onbSkip.addEventListener('click', ()=>{ try{ localStorage.setItem(ONB_KEY, '1'); }catch(e){} onbEl.classList.add('hidden'); });
    if (onbNext) onbNext.addEventListener('click', ()=>{ if (onbIndex < total - 1){ onbIndex += 1; render(); } else { try{ localStorage.setItem(ONB_KEY, '1'); }catch(e){} onbEl.classList.add('hidden'); } });
    render();
  }
  function maybeShowOnboarding(){
    try {
      if (localStorage.getItem(ONB_KEY) === '1') return;
      if (onbEl) onbEl.classList.remove('hidden');
    } catch(e){}
  }

  function showInitialLoading(message = INITIAL_LOADING_TEXT) {
    if (!loadingOverlay) return;
    if (loadingMessageEl && message) loadingMessageEl.textContent = message;
    loadingOverlay.classList.remove('loading-overlay--hidden');
  }

  function hideInitialLoading() {
    if (!loadingOverlay) return;
    loadingOverlay.classList.add('loading-overlay--hidden');
  }

  showInitialLoading();

  const scubeEl = document.getElementById('scube');
  const gcubeEl = document.getElementById('gcube');
  const starsEl = document.getElementById('stars');
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

  const mainEl = document.querySelector('.game-main');

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

  // in-room countdown interval
  let roomCountdownIv = null;

  function setStoreFabVisibility(activeTab){
    if (!storeFab) return;
    if (activeTab === 'home') storeFab.classList.remove('hidden'); else storeFab.classList.add('hidden');
  }

  function setMainCompact(activeTab){
    if (!mainEl) return;
    if (activeTab === 'home') mainEl.classList.add('game-main--homeCompact');
    else mainEl.classList.remove('game-main--homeCompact');
  }

  function showTab(tab){
    contents.forEach(c=>{ if (c.id===tab) c.classList.remove('hidden'); else c.classList.add('hidden'); });
    tabs.forEach(b=>{
      if (b.dataset.tab === tab) b.classList.add('active'); else b.classList.remove('active');
    });
    if (tab === 'leaderboard') loadLeaderboard(leaderboardMode);
    if (tab === 'tasks') setupAdsgramTask(0);
    setStoreFabVisibility(tab);
    setMainCompact(tab);
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
      preloadInterstitial().catch((err)=>console.warn('AdsGram interstitial initial load failed', err));
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
    if (window.Telegram && window.Telegram.WebApp) {
      if (typeof window.Telegram.WebApp.onEvent === 'function') {
        window.Telegram.WebApp.onEvent('viewportChanged', ()=>{
          const prev = isExpanded;
          isExpanded = computeExpanded();
          if (isExpanded && interstitialElapsed >= INTERSTITIAL_INTERVAL) {
            showInterstitialWithCountdownIfExpanded().then((shown)=>{ if (shown) interstitialElapsed = 0; }).catch(()=>{});
          }
        });
      }
      if (typeof window.Telegram.WebApp.expand === 'function') {
        try { window.Telegram.WebApp.expand(); } catch(e){}
        isExpanded = computeExpanded();
      }
    }
  } catch(e) {}

  // throttle interstitials to avoid repeated errors/messages
  let lastInterstitialAt = 0;
  let interstitialShownCount = 0;
  let interstitialReady = false;
  let interstitialLoadingPromise = null;
  const INTERSTITIAL_INTERVAL = 3 * 60 * 1000;
  const INTERSTITIAL_MAX_PER_SESSION = 3;

  tabs.forEach(btn=>{
    btn.addEventListener('click', async ()=>{
      const tab = btn.dataset.tab;
      showTab(tab);
      if (tab === 'tasks') { try { await loadDailyStreak(); } catch(e){} }
    });
  });

  async function preloadInterstitial(force = false) {
    if (!AdController || typeof AdController.load !== 'function') return false;
    if (interstitialReady && !force) return true;
    if (interstitialLoadingPromise && !force) return interstitialLoadingPromise;
    interstitialLoadingPromise = AdController.load()
      .then(() => {
        interstitialReady = true;
        console.log('AdsGram interstitial ready');
        return true;
      })
      .catch((err) => {
        interstitialReady = false;
        console.warn('AdsGram interstitial load failed', err);
        return false;
      })
      .finally(() => {
        interstitialLoadingPromise = null;
      });
    return interstitialLoadingPromise;
  }

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
      leaderSelfNote.textContent = 'Ты на пье��естале! Держи темп. 🌟';
    } else if (viewer.rank <= 10) {
      leaderSelfNote.textContent = 'До медалей рукой подать — продолжай в том же духе!';
    } else {
      leaderSelfNote.textContent = isTasks ? 'Выполняй задания и забирай награды, чтобы расти.' : 'Добывай ещё SCube — каждый клик приближает к топу!';
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
  let interstitialInitialShown = false;
  async function showInterstitialWithCountdownIfExpanded() {
    try {
      if (!isExpanded) return false;
      if (!AdController || typeof AdController.show !== 'function') return false;
      if (interstitialShownCount >= INTERSTITIAL_MAX_PER_SESSION) return false;
      const now = Date.now();
      if (lastInterstitialAt && now - lastInterstitialAt < INTERSTITIAL_INTERVAL) return false;
      const ready = await preloadInterstitial();
      if (!ready) return false;
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
      if (!isExpanded) return false;
      const result = await AdController.show();
      if (result && !result.error) {
        interstitialReady = false;
        lastInterstitialAt = Date.now();
        interstitialShownCount += 1;
        console.log('Scheduled interstitial shown', result);
        preloadInterstitial().catch((err)=>console.warn('AdsGram interstitial reload failed', err));
        return true;
      }
      return false;
    } catch (e) { console.warn('Scheduled interstitial failed', e); return false; }
  }
  function startInterstitialScheduler() {
    if (interstitialTicker) return;
    interstitialTicker = setInterval(()=>{
      if (interstitialShownCount >= INTERSTITIAL_MAX_PER_SESSION) return;
      interstitialElapsed += 1000;
      if (interstitialElapsed >= INTERSTITIAL_INTERVAL) {
        // attempt to show; only reset elapsed if ad actually shown
        showInterstitialWithCountdownIfExpanded().then((shown)=>{ if (shown) interstitialElapsed = 0; }).catch(()=>{});
      }
    }, 1000);
  }
  function stopInterstitialScheduler(){ if (interstitialTicker) { clearInterval(interstitialTicker); interstitialTicker = null; } }

  // start scheduler if AdsGram initialized
  if (AdController) startInterstitialScheduler();

  // Daily streak UI
  const dailyStreakCard = document.getElementById('daily-streak-card');
  const dailyStreakProgress = document.getElementById('daily-streak-progress');
  const dailyClaimBtn = document.getElementById('daily-claim-btn');
  const dailyNote = document.getElementById('daily-note');
  const DAILY_REWARDS = [10,50,100,125,150,175,200];

  function renderDailyProgress(activeIndex = 0, claimedToday = false){
    if (!dailyStreakProgress) return;
    dailyStreakProgress.innerHTML = '';
    DAILY_REWARDS.forEach((val, idx)=>{
      const cell = document.createElement('div');
      cell.className = 'streak-cell' + (idx === activeIndex ? ' active' : '') + (claimedToday ? ' completed' : '');
      const d = document.createElement('span'); d.className='streak-day'; d.textContent = `${idx+1} день`;
      const r = document.createElement('span'); r.className='streak-reward'; r.textContent = `+${val} SCube`;
      cell.append(d,r);
      dailyStreakProgress.appendChild(cell);
    });
  }

  async function loadDailyStreak(){
    if (!dailyStreakCard || !tgid) return;
    try {
      const res = await fetch(`${apiBase}/user/${tgid}/daily-streak`);
      if (!res.ok) throw new Error('daily fetch failed');
      const js = await res.json();
      const idx = Math.max(0, Math.min(6, Number(js.dayIndex || 0)));
      const claimed = Boolean(js.claimedToday);
      renderDailyProgress(idx, claimed);
      if (dailyClaimBtn) dailyClaimBtn.disabled = claimed;
      if (dailyNote) dailyNote.textContent = claimed ? 'Награда за сегодня получена' : `Сегодняшняя награда: +${DAILY_REWARDS[idx]} SCube`;
    } catch(e){ console.warn('daily streak load failed', e); }
  }

  if (dailyClaimBtn) {
    dailyClaimBtn.addEventListener('click', async ()=>{
      try { SoundManager.click(); } catch(e){}
      if (!tgid) return alert('tgid is required');
      const cfg = window.ADSGRAM_CONFIG || {};
      const blockId = cfg.dailyRewardBlockId;
      try {
        if (window.Adsgram && blockId){
          const controller = window.Adsgram.init({ blockId });
          const result = await controller.show();
          if (!result || result.error) { showStoreFeedback('Реклама не была просмотрена полностью'); return; }
        }
      } catch (e) { console.warn('daily ad error', e); }
      try {
        const res = await fetch(`${apiBase}/user/${tgid}/claim-daily`, { method:'POST' });
        const js = await res.json();
        if (js && js.ok){
          scubeEl.textContent = js.scube;
          try { SoundManager.reward(); } catch(e){}
          animateScube(); rewardBurstNear(scubeEl);
          showStoreFeedback(`Ежедневная награда получена (+${js.credited} SCube)`);
          await loadDailyStreak();
        } else {
          showStoreFeedback(js && js.message ? js.message : 'Не удалось получить награду');
        }
      } catch (err){ console.warn('daily claim failed', err); }
    });
  }

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

  // small animation for golden cube
  function animateGolden() {
    if (!golden) return;
    golden.classList.remove('shake');
    void golden.offsetWidth; // restart animation
    golden.classList.add('shake');
    setTimeout(()=> golden.classList.remove('shake'), 450);
  }

  // Sound manager using WebAudio (no external assets required)
  const SoundManager = (function(){
    let ctx = null;
    function ensure() {
      try {
        if (!ctx) ctx = new (window.AudioContext || window.webkitAudioContext)();
      } catch(e) { ctx = null; }
      return ctx;
    }
    function playTone(freq, type = 'sine', duration = 0.08, gain = 0.12) {
      const c = ensure();
      if (!c) return;
      const o = c.createOscillator();
      const g = c.createGain();
      o.type = type;
      o.frequency.value = freq;
      g.gain.value = gain;
      o.connect(g);
      g.connect(c.destination);
      o.start();
      g.gain.exponentialRampToValueAtTime(0.0001, c.currentTime + duration);
      setTimeout(()=>{ try{ o.stop(); }catch(e){} }, duration * 1000 + 20);
    }
    return {
      click() { playTone(900, 'sine', 0.06, 0.08); },
      purchase() { playTone(1150, 'triangle', 0.12, 0.14); playTone(880, 'sine', 0.09, 0.08); },
      output() { playTone(720, 'sine', 0.10, 0.12); },
      gold() { playTone(1400, 'sine', 0.09, 0.14); playTone(1000, 'sine', 0.06, 0.1); },
      reward() { playTone(1600, 'sine', 0.12, 0.16); playTone(1200, 'sine', 0.08, 0.12); },
      error() { playTone(240, 'sawtooth', 0.12, 0.14); }
    };
  })();

  // Microinteractions with ripple + sound
  function initRippleEffects(){
    const candidates = document.querySelectorAll('button, .upgrade-btn, .withdraw-method-button, .withdraw-trigger-btn, .leader-btn, .watch-ad, .create-room-btn, .share-invite-btn, .bet-chip');
    candidates.forEach((btn)=>{
      if (btn.classList.contains('with-ripple')) return;
      btn.classList.add('with-ripple');
      btn.addEventListener('click', (e)=>{
        try { SoundManager.click(); } catch(e){}
        const rect = btn.getBoundingClientRect();
        const ripple = document.createElement('span');
        ripple.className = 'btn-ripple';
        const size = Math.max(rect.width, rect.height);
        ripple.style.width = ripple.style.height = size + 'px';
        ripple.style.left = (e.clientX - rect.left - size/2) + 'px';
        ripple.style.top = (e.clientY - rect.top - size/2) + 'px';
        btn.appendChild(ripple);
        setTimeout(()=>{ if (ripple && ripple.parentNode) ripple.parentNode.removeChild(ripple); }, 650);
      });
    });
  }

  function sparkleAtElement(el, particles = 10){
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const cx = rect.left + rect.width/2;
    const cy = rect.top + rect.height/2;
    for (let i=0;i<particles;i++){
      const s = document.createElement('div');
      s.className = 'sparkle';
      const angle = (Math.PI*2) * (i/particles) + Math.random()*0.5;
      const dist = 24 + Math.random()*36;
      s.style.left = cx + 'px';
      s.style.top = cy + 'px';
      s.style.setProperty('--dx', Math.cos(angle)*dist + 'px');
      s.style.setProperty('--dy', Math.sin(angle)*dist + 'px');
      document.body.appendChild(s);
      setTimeout(()=>{ if (s && s.parentNode) s.parentNode.removeChild(s); }, 750);
    }
  }

  function rewardBurstNear(el){
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const cx = rect.left + rect.width/2;
    const cy = rect.top + 8;
    const container = document.createElement('div');
    container.className = 'burst';
    container.style.left = cx + 'px';
    container.style.top = cy + 'px';
    for (let i=0;i<8;i++){
      const dot = document.createElement('span');
      dot.className = 'burst-dot';
      const angle = (Math.PI*2) * (i/8);
      const dist = 36;
      dot.style.setProperty('--bx', Math.cos(angle)*dist + 'px');
      dot.style.setProperty('--by', Math.sin(angle)*dist + 'px');
      container.appendChild(dot);
    }
    document.body.appendChild(container);
    setTimeout(()=>{ if (container && container.parentNode) container.parentNode.removeChild(container); }, 820);
  }

  function ensureCustomElementReady(name) {
    if (!window.customElements || typeof window.customElements.whenDefined !== 'function') {
      return Promise.resolve();
    }
    if (window.customElements.get(name)) return Promise.resolve();
    try {
      return window.customElements.whenDefined(name);
    } catch (err) {
      console.warn(`Failed to observe custom element ${name}`, err);
      return Promise.resolve();
    }
  }

  function setTaskFeedback(message, tone = 'info') {
    const taskFeedback = document.getElementById('task-feedback');
    if (!taskFeedback) return;
    const tones = ['info', 'success', 'warning', 'error'];
    tones.forEach((t)=> taskFeedback.classList.remove(`task-feedback--${t}`));
    if (message) {
      taskFeedback.textContent = message;
      taskFeedback.classList.add(`task-feedback--${tone}`);
    } else {
      taskFeedback.textContent = '';
    }
  }

  function getTasksWrapper() {
    return document.getElementById('ads-task-wrap');
  }

  function renderTaskEmptyState(message) {
    const wrapper = getTasksWrapper();
    if (!wrapper) return;
    wrapper.innerHTML = '';
    const text = message && message.trim() ? message : 'Пока задан��й нет, приходите позже';
    const empty = document.createElement('div');
    empty.className = 'tasks-empty-message';
    empty.textContent = text;
    wrapper.appendChild(empty);
    wrapper.dataset.taskReady = 'empty';
  }

  function scheduleTaskReload(delay = 1200) {
    const wrapper = getTasksWrapper();
    if (wrapper) delete wrapper.dataset.taskReady;
    setTimeout(() => setupAdsgramTask(0, true), delay);
  }

  function attachTaskEventHandlers(taskEl, cardRef) {
    if (!taskEl) return;
    const markState = (state) => {
      if (!cardRef) return;
      const states = ['idle', 'empty', 'error', 'reward'];
      states.forEach((s)=> cardRef.classList.remove(`adsgram-task-card--${s}`));
      if (state) cardRef.classList.add(`adsgram-task-card--${state}`);
    };

    const handleUnavailable = () => {
      markState('empty');
      setTaskFeedback('Пока заданий нет. Загляните позже.', 'warning');
      renderTaskEmptyState('Пока заданий нет, приходите позже');
    };

    const handleError = () => {
      markState('error');
      setTaskFeedback('Не удалось загрузить рекламное задание. Повторите попытку позже.', 'error');
      scheduleTaskReload(1400);
    };

    const handleTooLong = () => {
      markState('error');
      setTaskFeedback('Сессия рекламы длится слишком долго. Перезапустите мини‑приложение и попробуйте снова.', 'warning');
      scheduleTaskReload(1400);
    };

    const handleReward = async (event) => {
      const detail = event && event.detail;
      const rewardMeta = resolveAdsgramReward(detail, DEFAULT_TASK_REWARD);
      const expectedReward = rewardMeta.amount;
      const contextId = extractAdsgramContextId(detail);
      try {
        if (!tgid) {
          console.warn('No tgid for reward confirmation');
          setTaskFeedback('Невозможно подтвердить награду без идентификатора пользователя.', 'error');
          return;
        }
        markState('reward');
        setTaskFeedback(`Награда подтверждается (+${expectedReward} SCube)…`, 'info');

        const applyRewardSuccess = (amountCredited, latestScube, duplicate = false) => {
          const rounded = Math.max(0, Math.round(amountCredited));
          if (Number.isFinite(latestScube)) scubeEl.textContent = latestScube;
          if (leaderboardSection && !leaderboardSection.classList.contains('hidden') && leaderboardMode === 'tasks') {
            leaderboardCache.tasks = null;
            leaderboardCacheTime.tasks = 0;
            loadLeaderboard('tasks', true);
          }
          if (duplicate) {
            setTaskFeedback('Награда за это задание уже была зачислена ранее.', 'warning');
          } else if (rounded >= expectedReward) {
            setTaskFeedback(`Задание выполнено — вы получили +${rounded} SCube`, 'success');
          } else if (rounded > 0) {
            setTaskFeedback(`Награда зачислена (+${rounded} SCube). Сумма меньше ожидаемой.`, 'warning');
          } else {
            setTaskFeedback('Задание подтверждено.', 'info');
          }
          if (!duplicate && rounded > 0) {
            const banner = document.createElement('div');
            banner.className = 'task-reward-banner success';
            banner.textContent = `+${rounded} SCube — награда за задание!`;
            document.body.appendChild(banner);
            setTimeout(()=>{ if (banner && banner.parentNode) banner.parentNode.removeChild(banner); }, 3500);
            setTimeout(()=> animateScube(), 200);
          }
        };

        let beforeScube = null;
        try {
          const beforeRes = await fetch(`${apiBase}/user/${tgid}`);
          if (beforeRes.ok) {
            const beforeJson = await beforeRes.json();
            beforeScube = Number(beforeJson.scube || 0);
          }
        } catch (fetchErr) {
          console.warn('Failed to fetch baseline before reward', fetchErr);
        }

        let claimSucceeded = false;
        try {
          const claimRes = await fetch(`${apiBase}/user/${tgid}/claim-reward`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ amount: expectedReward, source: 'task', contextId })
          });
          if (claimRes.ok) {
            const claimJson = await claimRes.json();
            if (claimJson && claimJson.ok) {
              claimSucceeded = true;
              applyRewardSuccess(Number(claimJson.credited || expectedReward), Number(claimJson.scube), Boolean(claimJson.duplicate));
            } else {
              console.warn('Task reward claim returned error payload', claimJson);
            }
          } else {
            console.warn('Task reward claim failed with status', claimRes.status);
          }
        } catch (claimErr) {
          console.warn('Task reward claim request failed', claimErr);
        }

        if (claimSucceeded) return;

        const timeout = 20000;
        const interval = 2000;
        const start = Date.now();
        let credited = false;

        while (Date.now() - start < timeout) {
          await new Promise(r=>setTimeout(r, interval));
          try {
            const check = await fetch(`${apiBase}/user/${tgid}`);
            if (!check.ok) continue;
            const js = await check.json();
            const nowScube = Number(js.scube || 0);
            if (beforeScube !== null) {
              const delta = nowScube - beforeScube;
              if (delta >= expectedReward) {
                applyRewardSuccess(delta, nowScube);
                credited = true;
                break;
              }
              if (delta > 0) {
                applyRewardSuccess(delta, nowScube);
                credited = true;
                break;
              }
            } else {
              applyRewardSuccess(expectedReward, nowScube);
              credited = true;
              break;
            }
          } catch (e) {
            console.warn('poll error', e);
          }
        }
        if (!credited) {
          setTaskFeedback(`Награда не подтверждена — попробуйте позже (ожидали +${expectedReward} SCube).`, 'warning');
          console.warn('Task reward not confirmed within timeout');
        }
      } catch (e) {
        console.warn('Failed to process task reward event', e);
        setTaskFeedback('Ошибка при подтверждении награды', 'error');
      }
    };

    const register = (names, handler) => names.forEach((name)=> taskEl.addEventListener(name, handler));
    register(['reward'], handleReward);
    register(['onError', 'error'], handleError);
    register(['onBannerNotFound', 'bannerNotFound'], handleUnavailable);
    register(['onTooLongSession', 'tooLongSession'], handleTooLong);
    markState('idle');
  }

  function createAdsgramTaskCard(cfg) {
    const wrapper = document.getElementById('ads-task-wrap');
    if (!wrapper) return null;
    const card = document.createElement('div');
    card.className = 'adsgram-task-card adsgram-task-card--idle';

    const header = document.createElement('div');
    header.className = 'adsgram-task-header';
    const icon = document.createElement('div');
    icon.className = 'adsgram-task-icon';
    icon.textContent = '🎯';
    const text = document.createElement('div');
    text.className = 'adsgram-task-text';
    const title = document.createElement('h4');
    title.className = 'adsgram-task-title';
    title.textContent = 'Задание AdsGram';
    const subtitle = document.createElement('p');
    subtitle.className = 'adsgram-task-subtitle';
    subtitle.textContent = 'Выполните условия предложения и заберите награду.';
    text.append(title, subtitle);
    header.append(icon, text);

    const hint = document.createElement('p');
    hint.className = 'adsgram-task-hint';
    hint.textContent = 'Нажмите «GO», выполните шаги рекламодателя, затем заберите награду.';

    const taskEl = document.createElement('adsgram-task');
    taskEl.className = 'adsgram-task-element';
    taskEl.setAttribute('data-block-id', cfg.taskBlockId);

    if (cfg.taskDebug === true) {
      taskEl.setAttribute('data-debug', 'true');
    } else if (cfg.taskDebug === false) {
      taskEl.setAttribute('data-debug', 'false');
    }
    if (cfg.taskDebugConsole === true || cfg.taskDebugConsole === false) {
      taskEl.setAttribute('data-debug-console', String(cfg.taskDebugConsole));
    }

    const rewardSource = document.getElementById('task-reward-amount');
    let rewardLabel = rewardSource ? rewardSource.textContent.trim() : `${DEFAULT_TASK_REWARD} SCube`;
    if (!rewardLabel) rewardLabel = `${DEFAULT_TASK_REWARD} SCube`;
    if (!/^\+/.test(rewardLabel)) {
      rewardLabel = `+${rewardLabel}`;
    }

    const rewardSlot = document.createElement('div');
    rewardSlot.className = 'task-slot-reward';
    rewardSlot.setAttribute('slot', 'reward');
    const rewardAmount = document.createElement('span');
    rewardAmount.className = 'task-slot-reward-amount';
    rewardAmount.textContent = rewardLabel;
    const rewardHint = document.createElement('span');
    rewardHint.className = 'task-slot-reward-hint';
    rewardHint.textContent = 'за выполнение';
    rewardSlot.append(rewardAmount, rewardHint);

    const startButton = document.createElement('button');
    startButton.type = 'button';
    startButton.className = 'task-slot-button task-slot-button--start';
    startButton.setAttribute('slot', 'button');
    startButton.textContent = 'GO';

    const claimButton = document.createElement('button');
    claimButton.type = 'button';
    claimButton.className = 'task-slot-button task-slot-button--claim';
    claimButton.setAttribute('slot', 'claim');
    claimButton.textContent = 'CLAIM';

    const doneState = document.createElement('div');
    doneState.className = 'task-slot-done';
    doneState.setAttribute('slot', 'done');
    doneState.textContent = 'DONE';

    taskEl.append(rewardSlot, startButton, claimButton, doneState);

    card.append(header, hint, taskEl);
    attachTaskEventHandlers(taskEl, card);
    return card;
  }

  function setupAdsgramTask(attempt = 0, force = false) {
    const cfg = window.ADSGRAM_CONFIG || {};
    const wrapper = document.getElementById('ads-task-wrap');
    if (!wrapper) return;
    if (!force && wrapper.dataset.taskReady === 'true') return;

    const taskId = cfg.taskBlockId;
    if (!taskId) {
      renderTaskEmptyState('Пока заданий нет, приходите позже');
      return;
    }

    if (!window.Adsgram) {
      if (attempt >= 20) {
        console.warn('AdsGram SDK was not ready for tasks');
        renderTaskEmptyState('Не удалось загрузить задания. Попробуйте позже.');
        return;
      }
      setTimeout(()=> setupAdsgramTask(attempt + 1, force), 250);
      return;
    }

    ensureCustomElementReady('adsgram-task')
      .then(() => {
        const card = createAdsgramTaskCard(cfg);
        if (!card) return;
        wrapper.innerHTML = '';
        wrapper.appendChild(card);
        wrapper.dataset.taskReady = 'true';
        setTaskFeedback('', 'info');
      })
      .catch((err) => {
        console.warn('Failed to init AdsGram task element', err);
        renderTaskEmptyState('Не удалось загрузить задания. Попробуйте позже.');
      });
  }

  setupAdsgramTask();
  try { loadDailyStreak(); } catch(e){}

  async function loadUser(){
    if (!initialDataLoaded) showInitialLoading();
    if (!tgid) {
      if (appMessage) appMessage.textContent = 'Откройте игру через кнопку в боте (нажмите /start и затем "Открыть игру").';
      if (!initialDataLoaded) showInitialLoading('Откройте игру через бота, чтобы загрузить данные.');
      return;
    }
    try {
      const res = await fetch(`${apiBase}/user/${tgid}`);
      if (res.status === 304) {
        // Not Modified: treat as success to clear initial loading overlay (server likely sent caching headers)
        if (!initialDataLoaded) {
          initialDataLoaded = true;
          hideInitialLoading();
          initOnboarding();
          maybeShowOnboarding();
        }
        return;
      }
      if (!res.ok) {
        let body = null;
        try { body = await res.json(); } catch(e){}
        const msg = (body && (body.error || body.message)) || `Server returned ${res.status}`;
        if (appMessage) appMessage.textContent = 'Не удалось загрузить данные пользователя: ' + msg;
        if (!initialDataLoaded) showInitialLoading('Не удалось загрузить дан��ые. Повторяем попытку…');
        return;
      }
      const user = await res.json();
      if (appMessage) appMessage.textContent = '';
      scubeEl.textContent = user.scube;
      gcubeEl.textContent = user.gcube;
      if (starsEl) starsEl.textContent = (user.stars || 0);
      energyEl.textContent = user.energy;
      if (Number(user.energy) > 0) energyEmptyShown = false;
      energyCapEl.textContent = user.energy_capacity;
      dailyEl.textContent = user.daily_count;
      dailyLevelEl.textContent = user.daily_limit_level;
      dailyLimitEl.textContent = (400 + user.daily_limit_level * 50);
      dailyCostEl.textContent = (90 + user.daily_limit_level * 10);
      // attempt to use Telegram avatar if available
      try {
        const tgUser = (window.Telegram && window.Telegram.WebApp && window.Telegram.WebApp.initDataUnsafe && window.Telegram.WebApp.initDataUnsafe.user) || null;
        const photo = tgUser && tgUser.photo_url ? tgUser.photo_url : null;
        if (photo) {
          avatarEl.textContent = '';
          avatarEl.style.backgroundImage = `url(${photo})`;
          avatarEl.style.backgroundSize = 'cover';
          avatarEl.style.backgroundPosition = 'center';
        } else {
          avatarEl.style.backgroundImage = '';
          avatarEl.textContent = (user.name && user.name[0]) || 'A';
        }
      } catch (e) {
        avatarEl.style.backgroundImage = '';
        avatarEl.textContent = (user.name && user.name[0]) || 'A';
      }

      if (!initialDataLoaded) {
        initialDataLoaded = true;
        hideInitialLoading();
        initOnboarding();
        maybeShowOnboarding();
        setTimeout(()=>{ if (typeof showInterstitialWithCountdownIfExpanded === 'function' && !interstitialInitialShown) { interstitialInitialShown = true; showInterstitialWithCountdownIfExpanded(); } }, 4000);
      }

      // start auto-tick if enabled
      if (user.auto_energy) startAutoTick(); else stopAutoTick();

      // set referrer if present in start_param or URL param (only once)
      try {
        const startParam = (window.Telegram && window.Telegram.WebApp && window.Telegram.WebApp.initDataUnsafe && window.Telegram.WebApp.initDataUnsafe.start_param) || '';
        const urlRef = qs('ref');
        const payload = startParam || urlRef || '';
        // support start_param, startapp query and ?ref=...
        const startParamRaw = (window.Telegram && window.Telegram.WebApp && window.Telegram.WebApp.initDataUnsafe && (window.Telegram.WebApp.initDataUnsafe.start_param || window.Telegram.WebApp.initDataUnsafe.startapp)) || '';
        const urlRef = qs('ref') || qs('startapp') || qs('start_param') || qs('startapp');
        const payload = startParamRaw || urlRef || '';
        const m = String(payload).match(/ref[_-]?(\d+)/i) || String(payload).match(/^(\d+)$/);
        const ref = m && m[1] ? Number(m[1]) : null;
        const refSetKey = `ref_set_${tgid}`;
        // ensure we have a tgid value (try to read from Telegram init data if missing)
        let resolvedTgid = tgid;
        try {
          if (!resolvedTgid && window.Telegram && window.Telegram.WebApp && window.Telegram.WebApp.initDataUnsafe && window.Telegram.WebApp.initDataUnsafe.user) {
            resolvedTgid = window.Telegram.WebApp.initDataUnsafe.user.id;
            tgid = resolvedTgid; // update global
          }
        } catch(e){}
        if (ref && resolvedTgid && Number(ref) !== Number(resolvedTgid) && !localStorage.getItem(refSetKey)) {
          try {
            const resp = await fetch(`${apiBase}/user/${resolvedTgid}/set-referrer`, { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify({ referrer: Number(ref) }) });
            if (resp && resp.ok) {
              try { localStorage.setItem(refSetKey, '1'); } catch(e){}
              console.log('set-referrer success', ref, resolvedTgid);
            } else {
              console.warn('set-referrer failed', resp && resp.status);
            }
          } catch (e) { console.warn('set-referrer error', e); }
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
      } catch (e) { console.warn('referral ui update failed', e); }
    } catch (err) {
      console.error('loadUser error', err);
      if (appMessage) appMessage.textContent = 'Ошибка связи с сервером. Попробуйте позже.';
      if (!initialDataLoaded) showInitialLoading('Ошибка связи с сервером. Повтор��ем…');
    }
  }

  golden.addEventListener('click', async ()=>{
    if (!tgid) return showStoreFeedback('tgid is required');
    if (goldenBusy) return; // debounce rapid clicks
    goldenBusy = true;
    try {
      try { SoundManager.gold(); } catch(e){}
      const res = await fetch(`${apiBase}/user/${tgid}/click`, { method: 'POST' });
      const json = await res.json();
      if (!json.ok) {
        const msg = String(json.message || '').toLowerCase();
        if (msg.includes('нет энер') || msg.includes('нет энергии')) {
          if (!energyEmptyShown) {
            energyEmptyShown = true;
            const ok = await showConfirm('У вас закончилась энергия. Хотите восполнить?');
            if (ok) {
              try { if (window.Telegram && window.Telegram.WebApp && window.Telegram.WebApp.expand) window.Telegram.WebApp.expand(); } catch(e){}
              const cfg = window.ADSGRAM_CONFIG || {};
              if (window.Adsgram && cfg.energyAdBlockId) {
                try {
                  const controller = window.Adsgram.init({ blockId: cfg.energyAdBlockId });
                  const result = await controller.show();
                  if (result && result.done && !result.error) {
                    const refillRes = await fetch(`${apiBase}/user/${tgid}/refill`, { method: 'POST' });
                    if (refillRes.ok) { await loadUser(); showStoreFeedback('Энергия восполнена'); try{ SoundManager.output(); }catch(e){} }
                  } else {
                    showStoreFeedback('Реклама не была просмотрена полностью');
                  }
                } catch (e) { console.warn('Energy ad failed', e); showStoreFeedback('Ошибка восполнения энергии'); }
              } else {
                try {
                  const refillRes = await fetch(`${apiBase}/user/${tgid}/refill`, { method: 'POST' });
                  if (refillRes.ok) { await loadUser(); showStoreFeedback('Энергия восполнена'); try{ SoundManager.output(); }catch(e){} }
                } catch(e){ showStoreFeedback('Ошибка восполнения энергии'); }
              }
            }
          }
          try { SoundManager.error(); } catch(e){}
          return;
        }
        showStoreFeedback(json.message || 'Action failed');
        try { SoundManager.error(); } catch(e){}
        return;
      }
      scubeEl.textContent = json.scube;
      energyEl.textContent = json.energy;
      if (Number(json.energy) > 0) energyEmptyShown = false;
      dailyEl.textContent = json.daily_count;
      dailyLimitEl.textContent = json.daily_limit || dailyLimitEl.textContent;
      animateScube();
      animateGolden();
      sparkleAtElement(golden, 4);
      leaderboardCache.clicks = null;
      leaderboardCacheTime.clicks = 0;
      if (leaderboardSection && !leaderboardSection.classList.contains('hidden') && leaderboardMode === 'clicks') {
        loadLeaderboard('clicks', true);
      }
    } catch (e) { console.warn('golden click failed', e); }
    finally { goldenBusy = false; }
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

  let adBusy = false; let energyEmptyShown = false; let confirmOpen = false; let goldenBusy = false;
  watchAdBtn.addEventListener('click', async ()=>{
    if (adBusy) return;
    try { SoundManager.click(); } catch(e){}
    // require full expansion before proceeding
    if (!isExpanded) {
      try { if (window.Telegram && window.Telegram.WebApp && window.Telegram.WebApp.expand) window.Telegram.WebApp.expand(); } catch(e){}
      return showStoreFeedback('Разверните MiniApp полностью и повторите');
    }
    adBusy = true;
    try {
      if (!tgid) { adBusy = false; return alert('tgid is required'); }
      // Enforce 90s cooldown between reward ads
      addAdCooldown(watchAdBtn, 90000);
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
          try { SoundManager.reward(); } catch(e){}
          // Ad watched successfully  request server to credit reward.
          // Try immediate claim; if server prefers callback-based crediting, poll until confirmed.
          const EXPECTED_REWARD = 20;
          try {
            const claimRes = await fetch(`${apiBase}/user/${tgid}/claim-reward`, { method: 'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ amount: EXPECTED_REWARD, source: 'ad' }) });
            const claimJson = await claimRes.json();
            if (claimJson && claimJson.ok) {
              scubeEl.textContent = claimJson.scube;
              if (!claimJson.duplicate && Number(claimJson.credited || 0) > 0) { animateScube(); rewardBurstNear(scubeEl); }
              const rewardText = Number(claimJson.credited || 0) > 0 ? `Награда зачислена (+${claimJson.credited} SCube)` : 'Награда уже была зачислена ранее';
              showStoreFeedback(rewardText);
              try { SoundManager.purchase(); } catch(e){}
            } else {
              // fallback: poll server for up to 15s to detect server-side callback credit
              let beforeScubeVal = beforeScube || 0;
              let credited = false;
              const start = Date.now();
              const TIMEOUT = 15000;
              const INT = 2000;
              while (Date.now() - start < TIMEOUT) {
                await new Promise(r=>setTimeout(r, INT));
                try {
                  const check = await fetch(`${apiBase}/user/${tgid}`);
                  if (!check.ok) continue;
                  const js = await check.json();
                  const nowScube = Number(js.scube || 0);
                  if (nowScube >= (beforeScubeVal + EXPECTED_REWARD)) {
                    credited = true;
                    scubeEl.textContent = nowScube;
                    animateScube(); rewardBurstNear(scubeEl);
                    showStoreFeedback('Награда зачислена');
                    try { SoundManager.purchase(); } catch(e){}
                    break;
                  }
                } catch (e) { console.warn('poll error', e); }
              }
              if (!credited) showStoreFeedback('Награда не подтверждена — попробуйте позже');
            }
          } catch (e) {
            console.warn('Claim reward error', e);
            showStoreFeedback('Ошибка при зачислении награды');
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


  // init microinteractions
  initRippleEffects();

  // refill button handler: show energy ad if block exists, otherwise do direct refill
  const refillBtn = document.getElementById('refill-btn');
  if (refillBtn) {
    let refillBusy = false;
    refillBtn.addEventListener('click', async ()=>{
      if (refillBusy) return;
      try { SoundManager.click(); } catch(e){}
      // require full expansion before proceeding
      if (!isExpanded) {
        try { if (window.Telegram && window.Telegram.WebApp && window.Telegram.WebApp.expand) window.Telegram.WebApp.expand(); } catch(e){}
        return showStoreFeedback('Разверните MiniApp полностью и повторите');
      }
      refillBusy = true;
      try {
        if (!tgid) { refillBusy = false; return alert('tgid is required'); }
        // add cooldown to avoid rapid ad openings
        addAdCooldown(refillBtn, 60000);
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
            try { SoundManager.reward(); } catch(e){}
            // Immediately request server to refill energy after confirmed ad view
            const resRefill = await fetch(`${apiBase}/user/${tgid}/refill`, { method: 'POST' });
            if (resRefill.ok) {
              const jsonRefill = await resRefill.json();
              if (jsonRefill.ok) {
                energyEl.textContent = jsonRefill.energy;
                showStoreFeedback('Энергия восполнена');
                try { SoundManager.output(); } catch(e){}
                if (Number(jsonRefill.energy) > 0) energyEmptyShown = false;
              } else {
                showStoreFeedback(jsonRefill.message || 'Ошибка восполнения энергии');
              }
            } else {
              showStoreFeedback('Сервер не отвечает при попытке восполнить энергию');
            }
          } else {
            showStoreFeedback('Реклам�� не была просмотрена полностью');
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
        try { SoundManager.output(); } catch(e){}
        if (Number(json.energy) > 0) energyEmptyShown = false;
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
    // prevent multiple confirm dialogs stacking
    if (confirmOpen) return Promise.resolve(false);
    confirmOpen = true;
    return new Promise((resolve) => {
      confirmMessage.textContent = message;
      confirmModal.classList.remove('hidden');
      function cleanup() {
        confirmModal.classList.add('hidden');
        confirmOk.removeEventListener('click', onOk);
        confirmCancel.removeEventListener('click', onCancel);
        confirmOpen = false;
      }
      function onOk(){ cleanup(); resolve(true); }
      function onCancel(){ cleanup(); resolve(false); }
      confirmOk.addEventListener('click', onOk);
      confirmCancel.addEventListener('click', onCancel);
    });
  }

  upgradeBtns.forEach(btn=>{
    btn.addEventListener('click', async ()=>{
      try { SoundManager.click(); } catch(e){}
      const type = btn.dataset.type;
      if (!tgid) return alert('tgid is required');
      const confirmed = await showConfirm('Подтвердите покупку: ' + (type === 'energy_capacity' ? 'Увеличение вместимости энергии (+25) за 100 SCube' : 'Увеличение дневного лимита (+50) за рассчитанную стоимость'));
      if (!confirmed) return showStoreFeedback('Покупка отменена');
      const res = await fetch(`${apiBase}/user/${tgid}/buy-upgrade`, { method: 'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ type }) });
      const json = await res.json();
      if (!json.ok) { try { SoundManager.error(); } catch(e){}; return showStoreFeedback(json.message || 'Ошибка покупки'); }
      await loadUser();
      try { SoundManager.purchase(); } catch(e){}
      showStoreFeedback('Покупка успешна');
      if (type === 'auto_energy') startAutoTick();
    });
  });

  // Withdrawals UI and logic
  const openWithdrawalsBtn = document.getElementById('open-withdrawals');
  const withdrawBackBtn = document.getElementById('withdraw-back-to-store');
  const withdrawMethodsContainer = document.getElementById('withdraw-methods');
  const withdrawFeedbackEl = document.getElementById('withdraw-feedback');
  const withdrawModal = document.getElementById('withdraw-modal');
  const withdrawModalTitle = document.getElementById('withdraw-modal-title');
  const withdrawModalHint = document.getElementById('withdraw-modal-hint');
  const withdrawOptionsEl = document.getElementById('withdraw-options');
  const withdrawInputsEl = document.getElementById('withdraw-inputs');
  const withdrawNotesEl = document.getElementById('withdraw-notes');
  const withdrawModalFeedback = document.getElementById('withdraw-modal-feedback');
  const withdrawModalClose = document.getElementById('withdraw-modal-close');
  const withdrawForm = document.getElementById('withdraw-form');

  const buildWithdrawOption = (id, payoutLabel, baseCost, commission, extraNote) => ({
    id,
    payoutLabel,
    baseCost,
    commission,
    totalCost: baseCost + commission,
    extraNote: extraNote || null
  });

  const WITHDRAW_METHODS = {
    stars: {
      key: 'stars',
      title: 'Вывод как Telegram-звёзды',
      hint: 'Выберите нужный набор звёзд. Комиссия — 5 SCube на каждые 100 SCube.',
      options: [
        buildWithdrawOption('stars-15', '15 Stars', 900, 45, 'Выплата: 15 Stars'),
        buildWithdrawOption('stars-25', '25 Stars', 1500, 75, 'Выплата: 25 Stars'),
        buildWithdrawOption('stars-50', '50 Stars', 3000, 150, 'Выплата: 50 Stars'),
        buildWithdrawOption('stars-100', '100 Stars', 6000, 300, 'Выплата: 100 Stars')
      ],
      fields: []
    },
    gcubes: {
      key: 'gcubes',
      title: 'Вывод как GCubes',
      hint: 'Укажите ID и ник из Blockman Go. Комиссия фиксированная — 50 SCube.',
      options: [
        buildWithdrawOption('gcubes-60', '60 GCubes', 3000, 50, 'Выплата: 60 GCubes'),
        buildWithdrawOption('gcubes-300', '300 GCubes', 15000, 50, 'Выплата: 300 GCubes'),
        buildWithdrawOption('gcubes-600', '600 GCubes', 30000, 50, 'Выплата: 600 GCubes')
      ],
      fields: [
        { id: 'blockmanId', label: 'ID в Blockman Go', type: 'text', placeholder: 'Например, 123456789', required: true, minLength: 3 },
        { id: 'blockmanNickname', label: 'Ник в Blockman Go', type: 'text', placeholder: 'Введите ник', required: true, minLength: 3 }
      ]
    },
    rub: {
      key: 'rub',
      title: 'Вывод в рублях',
      hint: 'Перевод на номер телефона. Комиссия — 50 SCube на каждые 100 ₽.',
      options: [
        buildWithdrawOption('rub-200', '200 ₽', 7600, 100, 'Перевод: 200 ₽'),
        buildWithdrawOption('rub-500', '500 ₽', 19000, 250, 'Перевод: 500 ₽'),
        buildWithdrawOption('rub-750', '750 ₽', 28500, 375, 'Перевод: 750 ₽'),
        buildWithdrawOption('rub-1000', '1000 ₽', 38000, 500, 'Перевод: 1000 ₽'),
        buildWithdrawOption('rub-1500', '1500 ₽', 57000, 750, 'Перевод: 1500 ₽'),
        buildWithdrawOption('rub-2000', '2000 ₽', 76000, 1000, 'Перевод: 2000 ₽')
      ],
      fields: [
        { id: 'payoutPhone', label: 'Номер для перевода', type: 'tel', placeholder: '+7XXXXXXXXXX', required: true, minLength: 7 }
      ]
    }
  };

  let currentWithdrawMethod = null;
  let withdrawFeedbackTimer = null;
  let withdrawSubmitting = false;

  function setWithdrawFeedback(message, tone = 'info') {
    if (!withdrawFeedbackEl) return;
    ['success', 'error', 'warning'].forEach(t => withdrawFeedbackEl.classList.remove(`withdraw-feedback--${t}`));
    withdrawFeedbackEl.textContent = message || '';
    if (message && tone && tone !== 'info') {
      withdrawFeedbackEl.classList.add(`withdraw-feedback--${tone}`);
    }
    if (withdrawFeedbackTimer) clearTimeout(withdrawFeedbackTimer);
    if (message) {
      withdrawFeedbackTimer = setTimeout(() => {
        ['success', 'error', 'warning'].forEach(t => withdrawFeedbackEl.classList.remove(`withdraw-feedback--${t}`));
        withdrawFeedbackEl.textContent = '';
        withdrawFeedbackTimer = null;
      }, 4000);
    }
  }

  function setWithdrawModalFeedback(message, tone = 'error') {
    if (!withdrawModalFeedback) return;
    ['success', 'warning'].forEach(t => withdrawModalFeedback.classList.remove(`withdraw-modal-feedback--${t}`));
    withdrawModalFeedback.textContent = message || '';
    if (message && tone === 'success') withdrawModalFeedback.classList.add('withdraw-modal-feedback--success');
    if (message && tone === 'warning') withdrawModalFeedback.classList.add('withdraw-modal-feedback--warning');
  }

  function highlightWithdrawOption(selectedId) {
    if (!withdrawOptionsEl) return;
    const cards = withdrawOptionsEl.querySelectorAll('.withdraw-option-card');
    cards.forEach(card => {
      const input = card.querySelector('.withdraw-option-input');
      if (input && input.value === selectedId && input.checked) card.classList.add('selected');
      else card.classList.remove('selected');
    });
  }

  function renderWithdrawOptions(method) {
    if (!withdrawOptionsEl) return null;
    withdrawOptionsEl.innerHTML = '';
    let defaultId = null;
    method.options.forEach((option, index) => {
      const label = document.createElement('label');
      label.className = 'withdraw-option-card';

      const input = document.createElement('input');
      input.type = 'radio';
      input.name = 'withdraw-option';
      input.value = option.id;
      input.className = 'withdraw-option-input';
      if (index === 0) {
        input.checked = true;
        defaultId = option.id;
      }

      const body = document.createElement('div');
      body.className = 'withdraw-option-body';

      const header = document.createElement('div');
      header.className = 'withdraw-option-header';

      const title = document.createElement('span');
      title.className = 'withdraw-option-title';
      title.textContent = option.payoutLabel;

      const total = document.createElement('span');
      total.className = 'withdraw-option-total';
      total.textContent = `Списываем: ${option.totalCost} SCube`;

      header.append(title, total);

      const breakdown = document.createElement('p');
      breakdown.className = 'withdraw-option-note';
      breakdown.textContent = `Стоимость: ${option.baseCost} SCube • Комиссия: ${option.commission} SCube`;

      body.append(header, breakdown);

      if (option.extraNote) {
        const extra = document.createElement('p');
        extra.className = 'withdraw-option-footnote';
        extra.textContent = option.extraNote;
        body.appendChild(extra);
      }

      label.append(input, body);
      withdrawOptionsEl.appendChild(label);
    });
    highlightWithdrawOption(defaultId);
    return defaultId;
  }

  function renderWithdrawInputs(method) {
    if (!withdrawInputsEl) return;
    withdrawInputsEl.innerHTML = '';
    (method.fields || []).forEach(field => {
      const group = document.createElement('label');
      group.className = 'withdraw-input-group';

      const caption = document.createElement('span');
      caption.className = 'withdraw-input-label';
      caption.textContent = field.label;

      const input = field.type === 'textarea' ? document.createElement('textarea') : document.createElement('input');
      input.className = field.type === 'textarea' ? 'withdraw-textarea' : 'withdraw-input';
      if (field.type && field.type !== 'textarea') input.type = field.type;
      input.name = field.id;
      if (field.placeholder) input.placeholder = field.placeholder;
      if (field.maxLength) input.maxLength = field.maxLength;

      group.append(caption, input);
      withdrawInputsEl.appendChild(group);
    });
  }

  function openWithdrawModal(methodKey) {
    if (!withdrawModal || !WITHDRAW_METHODS[methodKey]) return;
    const method = WITHDRAW_METHODS[methodKey];
    currentWithdrawMethod = methodKey;
    if (withdrawForm) withdrawForm.reset();
    renderWithdrawOptions(method);
    renderWithdrawInputs(method);
    if (withdrawNotesEl) withdrawNotesEl.value = '';
    if (withdrawModalTitle) withdrawModalTitle.textContent = method.title;
    if (withdrawModalHint) withdrawModalHint.textContent = method.hint;
    if (withdrawForm) withdrawForm.dataset.method = methodKey;
    setWithdrawModalFeedback('');
    withdrawModal.classList.remove('hidden');
    withdrawModal.setAttribute('aria-hidden', 'false');
  }

  function closeWithdrawModal() {
    if (!withdrawModal) return;
    withdrawModal.classList.add('hidden');
    withdrawModal.setAttribute('aria-hidden', 'true');
    if (withdrawForm) {
      withdrawForm.dataset.method = '';
      withdrawForm.reset();
    }
    if (withdrawOptionsEl) withdrawOptionsEl.innerHTML = '';
    if (withdrawInputsEl) withdrawInputsEl.innerHTML = '';
    if (withdrawNotesEl) withdrawNotesEl.value = '';
    setWithdrawModalFeedback('');
    currentWithdrawMethod = null;
  }

  if (openWithdrawalsBtn) {
    openWithdrawalsBtn.addEventListener('click', () => {
      showTab('withdrawals');
      setWithdrawFeedback('', 'info');
    });
  }

  if (withdrawBackBtn) {
    withdrawBackBtn.addEventListener('click', () => {
      showTab('store');
    });
  }

  if (withdrawModalClose) {
    withdrawModalClose.addEventListener('click', closeWithdrawModal);
  }

  if (withdrawModal) {
    withdrawModal.addEventListener('click', (event) => {
      if (event.target === withdrawModal) closeWithdrawModal();
    });
  }

  if (withdrawMethodsContainer) {
    withdrawMethodsContainer.addEventListener('click', (event) => {
      const trigger = event.target.closest('.withdraw-method-button');
      if (!trigger) return;
      const methodKey = trigger.dataset.method;
      if (!WITHDRAW_METHODS[methodKey]) return;
      openWithdrawModal(methodKey);
    });
  }

  if (withdrawOptionsEl) {
    withdrawOptionsEl.addEventListener('change', (event) => {
      if (event.target && event.target.classList.contains('withdraw-option-input')) {
        highlightWithdrawOption(event.target.value);
      }
    });
  }

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && withdrawModal && !withdrawModal.classList.contains('hidden')) {
      event.preventDefault();
      closeWithdrawModal();
    }
  });

  if (withdrawForm) {
    withdrawForm.addEventListener('submit', async (event) => {
      event.preventDefault();
      if (withdrawSubmitting) return;
      if (!tgid) {
        setWithdrawModalFeedback('Перезапустите игру через бота, чтобы авторизоваться.', 'error');
        return;
      }
      const methodKey = withdrawForm.dataset.method;
      const method = WITHDRAW_METHODS[methodKey];
      if (!method) {
        setWithdrawModalFeedback('Выберите способ вывода.', 'error');
        return;
      }
      const selected = withdrawOptionsEl ? withdrawOptionsEl.querySelector('.withdraw-option-input:checked') : null;
      if (!selected) {
        setWithdrawModalFeedback('Выберите вариант вывода.', 'error');
        return;
      }
      const optionId = selected.value;
      const details = {};
      let validationFailed = false;
      if (Array.isArray(method.fields)) {
        method.fields.forEach(field => {
          if (validationFailed) return;
          const input = withdrawInputsEl ? withdrawInputsEl.querySelector(`[name="${field.id}"]`) : null;
          const value = (input && input.value ? String(input.value) : '').trim();
          if (field.required && !value) {
            setWithdrawModalFeedback(`Заполните поле «${field.label}».`, 'error');
            if (input) input.focus();
            validationFailed = true;
            return;
          }
          if (field.minLength && value.length < field.minLength) {
            setWithdrawModalFeedback(`Поле «${field.label}» должно содержать не менее ${field.minLength} символов.`, 'error');
            if (input) input.focus();
            validationFailed = true;
            return;
          }
          details[field.id] = value;
        });
      }
      if (validationFailed) return;
      const note = withdrawNotesEl ? withdrawNotesEl.value.trim() : '';

      withdrawSubmitting = true;
      setWithdrawModalFeedback('Отправляем заявку...', 'warning');
      const submitBtn = withdrawForm.querySelector('.withdraw-submit-btn');
      if (submitBtn) submitBtn.disabled = true;

      try {
        const res = await fetch(`${apiBase}/withdrawals`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ method: methodKey, optionId, note, details })
        });
        const json = await res.json().catch(() => ({}));
        if (!res.ok || (json && json.ok === false)) {
          const message = (json && (json.message || json.error)) || 'Не удалось отправить за��вку. Попробуйте позже.';
          setWithdrawModalFeedback(message, 'error');
        } else {
          closeWithdrawModal();
          if (json && json.scube !== undefined) scubeEl.textContent = json.scube;
          const message = (json && json.message) || 'Заявка на вывод отправлена. Ожидайте подтверждения.';
          setWithdrawFeedback(message, 'success');
          await loadUser();
        }
      } catch (err) {
        console.warn('withdraw submit failed', err);
        setWithdrawModalFeedback('Ошибка соединения. Попробуйте позже.', 'error');
      } finally {
        withdrawSubmitting = false;
        if (submitBtn) submitBtn.disabled = false;
      }
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
    if (roomCountdownIv) { clearInterval(roomCountdownIv); roomCountdownIv = null; }
    currentRoomId = null;
    setInMatch(false);
    gameStage.innerHTML = '';
    gameStage.classList.add('hidden');
    showTab('games');
    await loadRooms();
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
    if (!active && currentRoomId) { leaveRoom(); return; }
    showTab('games');
    gameStage.classList.remove('hidden');
    if (roomCountdownIv) { clearInterval(roomCountdownIv); roomCountdownIv = null; }
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
    const timer = document.createElement('div'); timer.className = 'turn-timer-badge';
    if (room.deadlineAt && room.status === 'active') {
      const update = ()=>{
        const remain = Math.max(0, Math.ceil((room.deadlineAt - Date.now())/1000));
        timer.textContent = `⏳ Осталось: ${remain}с`;
      };
      update();
      roomCountdownIv = setInterval(update, 500);
    }
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
        else if (String(r.winner)===me) { banner.className = 'result-banner win'; banner.textContent = 'Победа! Вы получили банс'; }
        else { banner.className = 'result-banner lose'; banner.textContent = 'Поражение'; }
        wrap.appendChild(banner);
      }
    }
    const isCreatorWaiting = !finished && !room.opponent && String(room.creator)===me;
    const leave = document.createElement('button'); leave.className='join-btn'; leave.textContent = finished ? 'Выйти' : (isCreatorWaiting ? 'Отменить' : 'Сдаться');
    leave.addEventListener('click', leaveRoom);

    wrap.append(title, notice, timer, controls, result, leave);
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
    const notice = document.createElement('div'); notice.className='room-sub'; notice.textContent = 'На ход даётся 30 секунд. Превышение - поражение.';
    const timer = document.createElement('div'); timer.className = 'turn-timer-badge';
    if (room.deadlineAt && room.status === 'active') {
      const update = ()=>{
        const remain = Math.max(0, Math.ceil((room.deadlineAt - Date.now())/1000));
        const who = String(turn)===me ? 'Ваш ход' : 'Ход соперника';
        timer.textContent = `⏳ ${who}: ${remain}с`;
      };
      update();
      roomCountdownIv = setInterval(update, 500);
    }
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
    const isCreatorWaiting = !finished && !room.opponent && String(room.creator)===me;
    const leave = document.createElement('button'); leave.className='join-btn'; leave.textContent = finished ? 'Выйти' : (isCreatorWaiting ? 'Отменить' : 'Сдаться');
    leave.addEventListener('click', leaveRoom);

    wrap.append(title, notice, timer, grid, status, leave);
    gameStage.innerHTML='';
    gameStage.appendChild(wrap);
  }

  async function submitMove(roomId, payload){
    try{
      const res = await fetch(`${apiBase}/games/rooms/${roomId}/move`, { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ tgid, ...payload }) });
      const json = await res.json();
      if (!json.ok) return;
      openRoom(json.room);
      if (json.room.status==='finished') { if (roomCountdownIv) { clearInterval(roomCountdownIv); roomCountdownIv=null; } clearInterval(roomPollIv); roomPollIv=null; await loadUser(); }
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
  setMainCompact(activeBtn ? activeBtn.dataset.tab : 'home');
})();
