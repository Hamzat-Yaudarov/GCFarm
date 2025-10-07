import { initAuth, getTgid } from './modules/state.js';
import { initRippleEffects } from './modules/utils.js';
import { showInitialLoading, hideInitialLoading, initOnboarding, maybeShowOnboarding, initTabs } from './modules/ui.js';
import { initLeaderboard } from './modules/ratings.js';
import { setupAdsgramTask, loadDailyStreak, initDailyClaim, loadSponsorTasks, loadSubgramStatus, initSubgramControls } from './modules/tasks.js';
import { initHome } from './modules/home.js';
import { initUpgrades, initWithdrawals } from './modules/store.js';
import { initGames } from './modules/games.js';
import { loadUser } from './modules/user.js';
import { initAdmin } from './modules/admin.js';

// Show initial loading and ensure we always hide it on error or timeout
showInitialLoading();

(async ()=>{
  // Fallback: if initialization doesn't complete within this time, hide loader and show an error
  const FALLBACK_MS = 12000;
  const fallbackTimer = setTimeout(()=>{
    try {
      const loadingMessage = document.getElementById('loading-message');
      if (loadingMessage) loadingMessage.textContent = 'Ошибка загрузки — попробуйте перезагрузить страницу';
    } catch(e){}
    try { hideInitialLoading(); } catch(e){}
  }, FALLBACK_MS);

  try {
    await initAuth();

    const tabsApi = initTabs(async (tab)=>{
      if (tab === 'leaderboard') leaderboard.load(leaderboard.mode);
      if (tab === 'tasks') { setupAdsgramTask(0, true, getTgid, (mode)=>{ if (mode==='tasks') leaderboard.load('tasks', true); }); try { await loadDailyStreak(getTgid); } catch(e){} }
    });
    // expose for store back button
    window.__appTabs = tabsApi;

    initRippleEffects();

    const leaderboard = initLeaderboard(getTgid);

    initDailyClaim(getTgid);
    initSubgramControls(getTgid);

    // Init admin UI (will show only for whitelisted admin IDs)
    initAdmin(getTgid);

    const home = initHome(getTgid, ()=>loadUser(getTgid), (mode)=> leaderboard.load(mode, true));
    initUpgrades(getTgid, ()=> loadUser(getTgid));
    initWithdrawals(getTgid, ()=> loadUser(getTgid));
    initGames(getTgid, ()=> loadUser(getTgid));

    setupAdsgramTask(0, false, getTgid, (mode)=>{ if (mode==='tasks') leaderboard.load('tasks', true); });
    try { await loadDailyStreak(getTgid); } catch(e){}
    try { await loadSubgramStatus(getTgid); } catch(e){}
    try { await loadSponsorTasks(getTgid); } catch(e){}

    await loadUser(getTgid, { onInitialReady: ()=>{
      clearTimeout(fallbackTimer);
      try { hideInitialLoading(); } catch(e){}
      try { initOnboarding(); maybeShowOnboarding(); } catch(e){}
      setTimeout(()=>{ try { home.triggerInitialInterstitial(); } catch(e){} }, 4000);
    } });

    // Ensure loader is hidden even if loadUser returned without calling onInitialReady
    try { hideInitialLoading(); } catch(e){}

    setInterval(()=> loadUser(getTgid), 5000);
  } catch (err) {
    console.error('App initialization error', err);
    try { hideInitialLoading(); } catch(e){}
  }
})();
