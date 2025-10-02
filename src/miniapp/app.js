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
        window.Telegram.WebApp.onEvent('viewportChanged', ()=>{ isExpanded = computeExpanded(); });
      }
      if (typeof window.Telegram.WebApp.expand === 'function') {
        window.Telegram.WebApp.expand();
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
      leaderSelfNote.textContent = isTasks ? 'Закрывай задания AdsGram, и ты быстро поднимешься!' : 'Нажимай на золотой куб, чт��бы добыть больше SCube.';
      if (leaderPersonal) leaderPersonal.classList.add('leader-personal-empty');
      return;
    }

    if (leaderPersonal) leaderPersonal.classList.remove('leader-personal-empty');
    leaderSelfRank.textContent = viewer.rank ? `#${viewer.rank}` : '—';
    leaderSelfValue.textContent = formatViewerValue(mode, viewer.value);
    if (viewer.rank <= 3) {
      leaderSelfNote.textContent = 'Ты на ��ьедестале! Держи темп. 🌟';
    } else if (viewer.rank <= 10) {
      leaderSelfNote.textContent = 'До медалей рукой подать — продолжай в том же духе!';
    } else {
      leaderSelfNote.textContent = isTasks ? 'Выполняй задания и заб��рай награды, чтобы расти.' : 'Добывай ещё SCube — каждый клик приближает к топу!';
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
      nameSpan.textContent = entry.name || `Иг��ок ${entry.tgid}`;

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
        showLeaderboardMessage('Не удалось загр��зить рейтинг');
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
      if (interstitialShownCount >= INTERSTITIAL_MAX_PER_SESSION) return;
      const now = Date.now();
      if (lastInterstitialAt && now - lastInterstitialAt < INTERSTITIAL_INTERVAL) return;
      const ready = await preloadInterstitial();
      if (!ready) return;
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
      interstitialReady = false;
      lastInterstitialAt = Date.now();
      interstitialShownCount += 1;
      console.log('Scheduled interstitial shown', result);
      preloadInterstitial().catch((err)=>console.warn('AdsGram interstitial reload failed', err));
    } catch (e) { console.warn('Scheduled interstitial failed', e); }
  }
  function startInterstitialScheduler() {
    if (interstitialTicker) return;
    interstitialTicker = setInterval(()=>{
      if (!isExpanded) return;
      if (interstitialShownCount >= INTERSTITIAL_MAX_PER_SESSION) return;
      interstitialElapsed += 1000;
      if (interstitialElapsed >= INTERSTITIAL_INTERVAL) {
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
    if (!golden) return;
    golden.classList.remove('shake');
    void golden.offsetWidth; // restart animation
    golden.classList.add('shake');
    setTimeout(()=> golden.classList.remove('shake'), 450);
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
    };

    const handleError = () => {
      markState('error');
      setTaskFeedback('Не удалось загрузить рекламное задание. Повторите попытку позже.', 'error');
    };

    const handleTooLong = () => {
      markState('error');
      setTaskFeedback('Сессия рекламы длится слишком долго. Перезапустите мини‑приложение и попробуйте снова.', 'warning');
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
          setTaskFeedback(`Награда не подтвержд��на — попробуйте позже (ожидали +${expectedReward} SCube).`, 'warning');
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

  function setupAdsgramTask(attempt = 0) {
    const cfg = window.ADSGRAM_CONFIG || {};
    const wrapper = document.getElementById('ads-task-wrap');
    if (!wrapper) return;
    if (wrapper.dataset.taskReady === 'true') return;

    const taskId = cfg.taskBlockId;
    if (!taskId) {
      wrapper.textContent = 'Пока заданий нет';
      return;
    }

    if (!window.Adsgram) {
      if (attempt >= 20) {
        console.warn('AdsGram SDK was not ready for tasks');
        return;
      }
      setTimeout(()=> setupAdsgramTask(attempt + 1), 250);
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
      });
  }

  setupAdsgramTask();

  async function loadUser(){
    if (!initialDataLoaded) showInitialLoading();
    if (!tgid) {
      if (appMessage) appMessage.textContent = 'Откройте игру через кнопку в боте (нажмите /start и затем "Открыть игру").';
      if (!initialDataLoaded) showInitialLoading('Откройте игру через бота, чтобы загрузить данные.');
      return;
    }
    try {
      const res = await fetch(`${apiBase}/user/${tgid}`);
      if (!res.ok) {
        let body = null;
        try { body = await res.json(); } catch(e){}
        const msg = (body && (body.error || body.message)) || `Server returned ${res.status}`;
        if (appMessage) appMessage.textContent = 'Не удалось загрузить данные пользователя: ' + msg;
        if (!initialDataLoaded) showInitialLoading('Не у��алось загрузить данные. Повторяем попытку…');
        return;
      }
      const user = await res.json();
      if (appMessage) appMessage.textContent = '';
      scubeEl.textContent = user.scube;
      gcubeEl.textContent = user.gcube;
      if (starsEl) starsEl.textContent = (user.stars || 0);
      energyEl.textContent = user.energy;
      energyCapEl.textContent = user.energy_capacity;
      dailyEl.textContent = user.daily_count;
      dailyLevelEl.textContent = user.daily_limit_level;
      dailyLimitEl.textContent = (250 + user.daily_limit_level * 50);
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
      }

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
      } catch (e) { console.warn('referral ui update failed', e); }
    } catch (err) {
      console.error('loadUser error', err);
      if (appMessage) appMessage.textContent = 'Ошибка связи с сервером. По��робуйте позже.';
      if (!initialDataLoaded) showInitialLoading('Ошибка связи с сервером. Повторяем…');
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
          // Ad watched successfully ��� request server to credit reward.
          // Try immediate claim; if server prefers callback-based crediting, poll until confirmed.
          const EXPECTED_REWARD = 5;
          try {
            const claimRes = await fetch(`${apiBase}/user/${tgid}/claim-reward`, { method: 'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ amount: EXPECTED_REWARD, source: 'ad' }) });
            const claimJson = await claimRes.json();
            if (claimJson && claimJson.ok) {
              scubeEl.textContent = claimJson.scube;
              if (!claimJson.duplicate && Number(claimJson.credited || 0) > 0) animateScube();
              const rewardText = Number(claimJson.credited || 0) > 0 ? `Награда зачислена (+${claimJson.credited} SCube)` : 'Награда уже была зачислена ранее';
              showStoreFeedback(rewardText);
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
                    animateScube();
                    showStoreFeedback('Награда зачислена');
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
                showStoreFeedback(jsonRefill.message || 'Ошибка восполнения эне��гии');
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
        if (!json.ok) return showStoreFeedback(json.message || 'Ош��бка восполнения');
        energyEl.textContent = json.energy;
        showStoreFeedback('Энергия восполнена до максимума (��ез рекламы)');
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
      const confirmed = await showConfirm('Подтвердите покупку: ' + (type === 'energy_capacity' ? 'Увеличение вместимости энергии (+50) за 100 SCube' : 'Увеличение дневного лимита (+50) за р��ссчитанную стоимость'));
      if (!confirmed) return showStoreFeedback('Покупка отменена');
      const res = await fetch(`${apiBase}/user/${tgid}/buy-upgrade`, { method: 'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ type }) });
      const json = await res.json();
      if (!json.ok) return showStoreFeedback(json.message || 'Ошибка покупки');
      await loadUser();
      showStoreFeedback('Покупка успешна');
      if (type === 'auto_energy') startAutoTick();
    });
  });

  // Exchange modal UI and logic
  const openExchangeBtn = document.getElementById('open-exchange');
  const exchangeModal = document.getElementById('exchange-modal');
  const exchangeFrom = document.getElementById('exchange-from');
  const exchangeTo = document.getElementById('exchange-to');
  const exchangeAmount = document.getElementById('exchange-amount');
  const exchangePreview = document.getElementById('exchange-preview');
  const exchangeConfirm = document.getElementById('exchange-confirm');
  const exchangeClose = document.getElementById('exchange-close');

  const RATES = { scube:1, gcube:50, stars:60 };

  function formatCurrencyLabel(cur, v){
    if (cur === 'scube') return `${v} SCube`;
    if (cur === 'gcube') return `${v} GCube`;
    return `${v} Stars`;
  }

  function updateExchangePreview(){
    if (!exchangeFrom || !exchangeTo || !exchangeAmount || !exchangePreview) return;
    const from = String(exchangeFrom.value || 'scube').toLowerCase();
    const to = String(exchangeTo.value || 'gcube').toLowerCase();
    let amt = parseInt(exchangeAmount.value || '0', 10) || 0;
    if (from === to){ exchangePreview.textContent = 'Нельзя обменять одну и ту же валюту'; return; }
    if (amt <= 0){ exchangePreview.textContent = 'Введите сумму для обмена'; return; }
    const scubeValue = amt * (RATES[from] || 1);
    const targetUnits = Math.floor(scubeValue / (RATES[to] || 1));
    if (targetUnits < 1) { exchangePreview.textContent = 'Сумма слишком мала для обмена'; return; }
    exchangePreview.textContent = `Вы отдадите ${formatCurrencyLabel(from, amt)} и получите ≈ ${formatCurrencyLabel(to, targetUnits)}`;
  }

  if (openExchangeBtn) openExchangeBtn.addEventListener('click', ()=>{
    if (!exchangeModal) return;
    exchangeModal.classList.remove('hidden');
    exchangeModal.setAttribute('aria-hidden','false');
    updateExchangePreview();
  });
  if (exchangeClose) exchangeClose.addEventListener('click', ()=>{ if (exchangeModal) { exchangeModal.classList.add('hidden'); exchangeModal.setAttribute('aria-hidden','true'); } });
  [exchangeFrom, exchangeTo, exchangeAmount].forEach(el=>{ if (el) el.addEventListener('input', updateExchangePreview); });

  if (exchangeConfirm) exchangeConfirm.addEventListener('click', async ()=>{
    if (!tgid) return alert('tgid is required');
    const from = String(exchangeFrom.value || '').toLowerCase();
    const to = String(exchangeTo.value || '').toLowerCase();
    const amountVal = Math.max(0, parseInt(exchangeAmount.value || '0', 10));
    if (!from || !to || from === to || amountVal <= 0) return showStoreFeedback('Неверные параметры обмена');
    const confirmMsg = `Обменять ${amountVal} ${from.toUpperCase()} → ${to.toUpperCase()}?`;
    const ok = await showConfirm(confirmMsg);
    if (!ok) return showStoreFeedback('Обмен отменён');
    try {
      const res = await fetch(`${apiBase}/user/${tgid}/exchange`, { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ from, to, amount: amountVal }) });
      const json = await res.json();
      if (!json.ok) return showStoreFeedback(json.error || json.message || 'Ошибка обмена');
      // update balances
      if (json.scube !== undefined) scubeEl.textContent = json.scube;
      if (json.gcube !== undefined) gcubeEl.textContent = json.gcube;
      if (json.stars !== undefined && starsEl) starsEl.textContent = json.stars;
      showStoreFeedback('Обмен выполнен');
      if (exchangeModal) { exchangeModal.classList.add('hidden'); exchangeModal.setAttribute('aria-hidden','true'); }
    } catch (e) {
      console.warn('exchange error', e);
      showStoreFeedback('Ошибка обмена, попробуйте позже');
    }
  });

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
    const notice = document.createElement('div'); notice.className='room-sub'; notice.textContent = 'На ход даётся 30 секунд. Превышение ��� поражение.';
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
