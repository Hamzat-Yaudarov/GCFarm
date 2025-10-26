import { apiBase } from './state.js';
import { addAdCooldown, animateScube, animateGolden, sparkleAtElement, SoundManager } from './utils.js';

export function initHome(getTgid, onUserChange, onLeaderboardChange){
  const scubeEl = document.getElementById('scube');
  const energyEl = document.getElementById('energy');
  const dailyEl = document.getElementById('daily');
  const dailyLimitEl = document.getElementById('daily-limit');
  const golden = document.getElementById('golden-cube');
  const watchAdBtn = document.getElementById('watch-ad');
  const refillBtn = document.getElementById('refill-btn');
  const leaderboardSection = document.getElementById('leaderboard');

  // viewport/expanded
  let isExpanded = false;
  function computeExpanded(){
    try { return !!(window.Telegram && window.Telegram.WebApp && window.Telegram.WebApp.isExpanded); } catch(e){ return false; }
  }
  isExpanded = computeExpanded();
  try {
    if (window.Telegram && window.Telegram.WebApp) {
      if (typeof window.Telegram.WebApp.onEvent === 'function') {
        window.Telegram.WebApp.onEvent('viewportChanged', ()=>{
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

  // AdsGram interstitials
  let AdController = null;
  let interstitialInstance = null;
  let interstitialReady = false;
  let interstitialLoadingPromise = null;
  let interstitialShowing = false;
  let lastInterstitialAt = 0;
  let interstitialShownCount = 0;
  let interstitialTicker = null;
  let interstitialElapsed = 0;
  let interstitialInitialShown = false;
  const INTERSTITIAL_INTERVAL = 3 * 60 * 1000;
  const INTERSTITIAL_MAX_PER_SESSION = 3;

  try {
    const cfg = window.ADSGRAM_CONFIG || {};
    if (window.Adsgram && cfg && cfg.interstitialBlockId) {
      AdController = window.Adsgram.init({ blockId: cfg.interstitialBlockId });
      preloadInterstitial().catch(()=>{});
    }
  } catch (e) { console.warn('AdsGram init failed', e); }

  async function preloadInterstitial(force = false) {
    if (!AdController) return false;
    if (typeof AdController.load !== 'function') {
      if (typeof AdController.show === 'function') {
        interstitialReady = true;
        interstitialInstance = null;
        return true;
      }
      return false;
    }
    if (interstitialReady && !force) return true;
    if (interstitialLoadingPromise && !force) return interstitialLoadingPromise;
    interstitialLoadingPromise = AdController.load()
      .then((maybeInstance) => {
        if (maybeInstance && typeof maybeInstance.show === 'function') {
          interstitialInstance = maybeInstance;
        } else {
          interstitialInstance = null;
        }
        interstitialReady = true;
        return true;
      })
      .catch(() => {
        interstitialReady = false;
        interstitialInstance = null;
        return false;
      })
      .finally(() => {
        interstitialLoadingPromise = null;
      });
    return interstitialLoadingPromise;
  }

  async function showInterstitialWithCountdownIfExpanded() {
    if (interstitialShowing) return false;
    interstitialShowing = true;
    try {
      // Do not show interstitials while SubGram blocker is active
      if (document && document.body && document.body.classList && document.body.classList.contains('subgram-locked')) return false;
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
          // eslint-disable-next-line no-await-in-loop
          await new Promise(r=>setTimeout(r,1000));
          count -= 1;
        }
        overlay.classList.add('hidden');
      }
      if (!isExpanded) return false;
      let result = null;
      try {
        if (interstitialInstance && typeof interstitialInstance.show === 'function') {
          result = await interstitialInstance.show();
        } else if (AdController && typeof AdController.show === 'function') {
          result = await AdController.show();
        } else if (AdController && typeof AdController.load === 'function') {
          const inst = await AdController.load();
          if (inst && typeof inst.show === 'function') result = await inst.show();
        }
      } catch (err) {
        result = null;
      }
      if (result && !result.error) {
        interstitialReady = false;
        lastInterstitialAt = Date.now();
        interstitialShownCount += 1;
        preloadInterstitial().catch(()=>{});
        return true;
      }
      return false;
    } catch (e) {
      return false;
    } finally {
      interstitialShowing = false;
    }
  }
  function startInterstitialScheduler(){
    if (interstitialTicker) return;
    interstitialTicker = setInterval(()=>{
      if (interstitialShownCount >= INTERSTITIAL_MAX_PER_SESSION) return;
      interstitialElapsed += 1000;
      if (interstitialElapsed >= INTERSTITIAL_INTERVAL) {
        showInterstitialWithCountdownIfExpanded().then((shown)=>{ if (shown) interstitialElapsed = 0; }).catch(()=>{});
      }
    }, 1000);
  }
  if (AdController) startInterstitialScheduler();

  // feedback helper
  function showStoreFeedback(msg){ const el = document.getElementById('store-feedback'); if (!el) return; el.textContent = msg; setTimeout(()=>{ if (el) el.textContent=''; }, 3000); }

  // golden cube click
  let adBusy = false; let energyEmptyShown = false;
  if (golden){
    golden.addEventListener('click', async ()=>{
      const tgid = getTgid();
      if (!tgid) { showStoreFeedback('tgid is required'); return; }
      try {
        try { SoundManager.gold(); } catch(e){}
        const res = await fetch(`${apiBase}/user/${tgid}/click`, { method:'POST' });
        const json = await res.json();
        if (!json.ok) {
          const msg = String(json.message || '').toLowerCase();
          if (msg.includes('нет энер') || msg.includes('нет энергии')) {
            if (!energyEmptyShown) {
              energyEmptyShown = true;
              const ok = window.confirm('У вас закончилась энергия. Хотите восполнить?');
              if (ok) {
                try { if (window.Telegram && window.Telegram.WebApp && window.Telegram.WebApp.expand) window.Telegram.WebApp.expand(); } catch(e){}
                const cfg = window.ADSGRAM_CONFIG || {};
                if (window.Adsgram && cfg.energyAdBlockId) {
                  try {
                    const controller = window.Adsgram.init({ blockId: cfg.energyAdBlockId });
                    const result = await controller.show();
                    if (result && result.done && !result.error) {
                      const refillRes = await fetch(`${apiBase}/user/${tgid}/refill`, { method: 'POST' });
                      if (refillRes.ok) {
                        const jr = await refillRes.json();
                        energyEl.textContent = jr.energy;
                        showStoreFeedback('Энергия восполнена');
                        try{ SoundManager.output(); }catch(e){}
                      }
                    } else {
                      showStoreFeedback('Реклама не была просмотрена полностью');
                    }
                  } catch (e) {
                    console.warn('Energy ad failed', e);
                    showStoreFeedback('Ошибка восполнения энергии');
                  }
                } else {
                  try {
                    const refillRes = await fetch(`${apiBase}/user/${tgid}/refill`, { method: 'POST' });
                    if (refillRes.ok) {
                      const jr = await refillRes.json();
                      energyEl.textContent = jr.energy;
                      showStoreFeedback('Энергия восполнена');
                      try{ SoundManager.output(); }catch(e){}
                    }
                  } catch (e) {
                    showStoreFeedback('Ошибка восполнения энергии');
                  }
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
        if (leaderboardSection && !leaderboardSection.classList.contains('hidden') && typeof onLeaderboardChange === 'function') {
          onLeaderboardChange('clicks');
        }
      } catch (e) {
        console.warn('golden click failed', e);
      }
    });
  }

  // reward ad
  if (watchAdBtn){
    watchAdBtn.addEventListener('click', async ()=>{
      if (adBusy) return;
      try { SoundManager.click(); } catch(e){}
      if (!isExpanded) {
        try { if (window.Telegram && window.Telegram.WebApp && window.Telegram.WebApp.expand) window.Telegram.WebApp.expand(); } catch(e){}
        showStoreFeedback('Разверните MiniApp полностью и повторите');
        return;
      }
      adBusy = true;
      try {
        const tgid = getTgid();
        if (!tgid) { adBusy = false; window.alert('tgid is required'); return; }
        addAdCooldown(watchAdBtn, 135000);
        const cfg = window.ADSGRAM_CONFIG || {};
        const rewardBlock = cfg.rewardBlockId || cfg.interstitialBlockId;
        if (window.Adsgram && rewardBlock) {
          try {
            const controller = window.Adsgram.init({ blockId: rewardBlock });
            const beforeRes = await fetch(`${apiBase}/user/${tgid}`);
            const before = beforeRes.ok ? await beforeRes.json() : null;
            const beforeScube = before ? Number(before.scube) : null;
            const result = await controller.show();
            if (result && result.done && !result.error) {
              try { SoundManager.reward(); } catch(e){}
              const EXPECTED_REWARD = 20;
              try {
                const claimRes = await fetch(`${apiBase}/user/${tgid}/claim-reward`, { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ amount: EXPECTED_REWARD, source: 'ad' }) });
                const claimJson = await claimRes.json();
                if (claimJson && claimJson.ok) {
                  scubeEl.textContent = claimJson.scube;
                  if (!claimJson.duplicate && Number(claimJson.credited || 0) > 0) animateScube();
                  const rewardText = Number(claimJson.credited || 0) > 0 ? `Награда зачислена (+${claimJson.credited} SCube)` : 'Награда уже была зачислена ранее';
                  showStoreFeedback(rewardText);
                } else {
                  let credited = false;
                  const start = Date.now();
                  const TIMEOUT = 15000; const INT = 2000;
                  while (Date.now() - start < TIMEOUT) {
                    // eslint-disable-next-line no-await-in-loop
                    await new Promise(r=>setTimeout(r, INT));
                    try {
                      const check = await fetch(`${apiBase}/user/${tgid}`);
                      if (!check.ok) continue; // eslint-disable-line no-continue
                      const js = await check.json();
                      const nowScube = Number(js.scube || 0);
                      if (beforeScube !== null) {
                        const delta = nowScube - beforeScube;
                        if (delta > 0) {
                          credited = true;
                          scubeEl.textContent = nowScube;
                          animateScube();
                          showStoreFeedback('Награда зачислена');
                          break;
                        }
                      }
                    } catch (e) {}
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
      } finally {
        adBusy = false;
      }
    });
  }

  // refill energy
  if (refillBtn){
    let refillBusy = false;
    refillBtn.addEventListener('click', async ()=>{
      if (refillBusy) return;
      try { SoundManager.click(); } catch(e){}
      if (!isExpanded) {
        try { if (window.Telegram && window.Telegram.WebApp && window.Telegram.WebApp.expand) window.Telegram.WebApp.expand(); } catch(e){}
        showStoreFeedback('Разверните MiniApp полностью и повторите');
        return;
      }
      refillBusy = true;
      try {
        const tgid = getTgid();
        if (!tgid) { refillBusy = false; window.alert('tgid is required'); return; }
        addAdCooldown(refillBtn, 200000);
        const cfg = window.ADSGRAM_CONFIG || {};
        if (window.Adsgram && cfg.energyAdBlockId) {
          try {
            const controller = window.Adsgram.init({ blockId: cfg.energyAdBlockId });
            const result = await controller.show();
            if (result && result.done && !result.error) {
              try { SoundManager.reward(); } catch(e){}
              const resRefill = await fetch(`${apiBase}/user/${tgid}/refill`, { method: 'POST' });
              if (resRefill.ok) {
                const jsonRefill = await resRefill.json();
                if (jsonRefill.ok) {
                  energyEl.textContent = jsonRefill.energy;
                  showStoreFeedback('Энергия восполнена');
                  try { SoundManager.output(); } catch(e){}
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
          const res = await fetch(`${apiBase}/user/${tgid}/refill`, { method:'POST' });
          const json = await res.json();
          if (!json.ok) { showStoreFeedback(json.message || 'Ошибка восполнения'); }
          else {
            energyEl.textContent = json.energy;
            try { SoundManager.output(); } catch(e){}
            showStoreFeedback('Энергия восполнена до максимума (без рекламы)');
          }
        }
      } finally {
        refillBusy = false;
      }
    });
  }

  return {
    triggerInitialInterstitial: ()=>{
      if (!interstitialInitialShown) {
        interstitialInitialShown = true;
        showInterstitialWithCountdownIfExpanded();
      }
    }
  };
}
