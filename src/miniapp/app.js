import { initAuth, getTgid } from './modules/state.js';
import { initRippleEffects } from './modules/utils.js';
import { showInitialLoading, hideInitialLoading, initOnboarding, maybeShowOnboarding, initTabs } from './modules/ui.js';
import { initLeaderboard } from './modules/ratings.js';
import { loadDailyStreak, initDailyClaim, loadSponsorTasks, loadSubgramStatus, initSubgramControls } from './modules/tasks.js';
import { initHome } from './modules/home.js';
import { initUpgrades, initWithdrawals } from './modules/store.js';
import { initGames } from './modules/games.js';
import { initReferrals } from './modules/referrals.js';
import { loadUser } from './modules/user.js';
import { initAdmin } from './modules/admin.js';
import { loadCustomTasks } from './modules/customTasks.js';

showInitialLoading();
const __initialHideTimeout = setTimeout(()=>{ try{ hideInitialLoading(); }catch(e){} }, 8000);
await initAuth();

const tabsApi = initTabs(async (tab)=>{
  if (tab === 'leaderboard') leaderboard.load(leaderboard.mode);
  if (tab === 'tasks') { try { await loadDailyStreak(getTgid); } catch(e){} try { await loadCustomTasks(getTgid); } catch(e){} }
  if (tab === 'referrals') { try { referrals.load(); } catch(e){} }
  if (tab === 'admin') { try { await admin.loadStats(); } catch(e){} }
});
// expose for store back button
window.__appTabs = tabsApi;

initRippleEffects();

const leaderboard = initLeaderboard(getTgid);

initDailyClaim(getTgid);
initSubgramControls(getTgid);

const home = initHome(getTgid, ()=>loadUser(getTgid), (mode)=> leaderboard.load(mode, true));
initUpgrades(getTgid, ()=> loadUser(getTgid));
initWithdrawals(getTgid, ()=> loadUser(getTgid));
initGames(getTgid, ()=> loadUser(getTgid));

const referrals = initReferrals(getTgid);

const admin = initAdmin(getTgid);
admin.checkAdmin();
admin.setupForm();

try { await loadDailyStreak(getTgid); } catch(e){}
try { await loadSubgramStatus(getTgid); } catch(e){}
try { await loadCustomTasks(getTgid); } catch(e){}

await loadUser(getTgid, { onInitialReady: ()=>{ clearTimeout(__initialHideTimeout); hideInitialLoading(); initOnboarding(); maybeShowOnboarding(); setTimeout(()=>{ try { home.triggerInitialInterstitial(); } catch(e){} }, 4000); } });

setInterval(()=> loadUser(getTgid), 5000);
