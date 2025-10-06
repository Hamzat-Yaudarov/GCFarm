import { apiBase } from './state.js';
import { ensureCustomElementReady, animateScube, rewardBurstNear, SoundManager } from './utils.js';

const DEFAULT_AD_REWARD = 5; const DEFAULT_TASK_REWARD = 15;

const subgramGateEl = document.getElementById('subgram-gate');
const subgramLinksEl = document.getElementById('subgram-links');
const subgramOpenBtn = document.getElementById('subgram-open');
const subgramRecheckBtn = document.getElementById('subgram-recheck');
const subgramBlockerEl = document.getElementById('subgram-blocker');
const subgramBlockerLinksEl = document.getElementById('subgram-blocker-links');
const subgramBlockerOpenBtn = document.getElementById('subgram-blocker-open');
const subgramBlockerRecheckBtn = document.getElementById('subgram-blocker-recheck');
let subgramLocked = false; let subgramBotUrl = null; let subgramRecheckSec = 90;

function setTaskFeedback(message, tone = 'info'){
  const taskFeedback = document.getElementById('task-feedback'); if (!taskFeedback) return;
  const tones = ['info','success','warning','error']; tones.forEach((t)=> taskFeedback.classList.remove(`task-feedback--${t}`));
  if (message) { taskFeedback.textContent = message; taskFeedback.classList.add(`task-feedback--${tone}`); } else { taskFeedback.textContent=''; }
}
function getTasksWrapper() { return document.getElementById('ads-task-wrap'); }
function renderTaskEmptyState(message){ const wrapper = getTasksWrapper(); if (!wrapper) return; wrapper.innerHTML=''; const text = message && message.trim() ? message : 'Пока заданий нет, приходите позже'; const empty = document.createElement('div'); empty.className='tasks-empty-message'; empty.textContent=text; wrapper.appendChild(empty); wrapper.dataset.taskReady='empty'; }
function scheduleTaskReload(delay=1200){ const wrapper = getTasksWrapper(); if (wrapper) delete wrapper.dataset.taskReady; setTimeout(()=> setupAdsgramTask(0,true), delay); }

function resolveAdsgramReward(detail, fallback = DEFAULT_AD_REWARD) {
  const data = detail || {}; const numericKeys = ['reward','amount','value','payout','reward_amount','rewardAmount','bonus','coins']; let amount;
  for (const key of numericKeys) { if (!Object.prototype.hasOwnProperty.call(data, key)) continue; const parsed = Number(data[key]); if (Number.isFinite(parsed) && parsed > 0) { amount = parsed; break; } }
  const typeCandidates = [data.type, data.event, data.category, data.kind, data.mode, data.source, data.reward_type].filter(Boolean).map(v=>String(v).toLowerCase());
  const tagCandidates = Array.isArray(data.tags) ? data.tags.map(tag=>String(tag).toLowerCase()) : [];
  const taskMarkers = ['task','mission','quest']; const isTask = typeCandidates.concat(tagCandidates).some(entry=> taskMarkers.some(marker=> entry.includes(marker))) || Boolean(data.taskId || data.task_id || data.task);
  const fallbackAmount = isTask ? DEFAULT_TASK_REWARD : fallback; const resolved = amount && amount > 0 ? amount : fallbackAmount; return { amount: Math.min(1000000, Math.max(1, Math.round(resolved))), isTask };
}
function extractAdsgramContextId(detail){ const data = detail || {}; const candidates = [data.eventId,data.event_id,data.transactionId,data.transaction_id,data.rewardId,data.reward_id,data.taskId,data.task_id,data.clickId,data.click_id,data.orderId,data.order_id,data.id,data.requestId,data.request_id]; for (const c of candidates){ if (c===undefined||c===null) continue; const trimmed = String(c).trim(); if (trimmed) return trimmed; } const user = data.userId || data.tgid || data.user_id; const adUnit = data.adUnit || data.ad_unit; const stamp = data.timestamp || data.time || data.createdAt || data.created_at || data.ts; if (user && stamp) return `${user}:${stamp}`; if (user && adUnit) return `${user}:${adUnit}`; return null; }

function attachTaskEventHandlers(taskEl, cardRef, getTgid, onRewarded){
  if (!taskEl) return;
  const markState = (state)=>{ if (!cardRef) return; const states = ['idle','empty','error','reward']; states.forEach((s)=> cardRef.classList.remove(`adsgram-task-card--${s}`)); if (state) cardRef.classList.add(`adsgram-task-card--${state}`); };
  const handleUnavailable = ()=>{ markState('empty'); setTaskFeedback('Пока заданий нет. Загляните позже.', 'warning'); renderTaskEmptyState('Пока заданий нет, приходите позже'); };
  const handleError = ()=>{ markState('error'); setTaskFeedback('Не удалось загрузить рекламное задание. Повторите попытку позже.', 'error'); scheduleTaskReload(1400); };
  const handleTooLong = ()=>{ markState('error'); setTaskFeedback('Сессия рекламы длится слишком долго. Перезапустите мини‑приложение и попробуйте снова.', 'warning'); scheduleTaskReload(1400); };
  const scubeEl = document.getElementById('scube');
  const leaderboardSection = document.getElementById('leaderboard');
  const rewardHandler = async (event)=>{
    const detail = event && event.detail; const rewardMeta = resolveAdsgramReward(detail, DEFAULT_TASK_REWARD); const expectedReward = rewardMeta.amount; const contextId = extractAdsgramContextId(detail); const tgid = getTgid();
    try {
      if (!tgid) { console.warn('No tgid for reward confirmation'); setTaskFeedback('Невозможно подтвердить награду без идентификатора пользователя.', 'error'); return; }
      markState('reward'); setTaskFeedback(`Награда подтверждается (+${expectedReward} SCube)…`, 'info');
      const applyRewardSuccess = (amountCredited, latestScube, duplicate=false)=>{
        const rounded = Math.max(0, Math.round(amountCredited)); if (Number.isFinite(latestScube)) scubeEl.textContent = latestScube;
        if (leaderboardSection && !leaderboardSection.classList.contains('hidden')) { /* leaderboard reload is handled by app */ }
        if (duplicate) setTaskFeedback('Награда за это задание уже была зачислена ранее.', 'warning');
        else if (rounded >= expectedReward) setTaskFeedback(`Задание выполнено — вы получили +${rounded} SCube`, 'success');
        else if (rounded > 0) setTaskFeedback(`Награда зачислена (+${rounded} SCube). Сумма меньше ожидаемой.`, 'warning');
        else setTaskFeedback('Задание подтверждено.', 'info');
        if (!duplicate && rounded > 0) { const banner = document.createElement('div'); banner.className = 'task-reward-banner success'; banner.textContent = `+${rounded} SCube — награда за задание!`; document.body.appendChild(banner); setTimeout(()=>{ if (banner && banner.parentNode) banner.parentNode.removeChild(banner); }, 3500); setTimeout(()=> animateScube(), 200); }
      };
      let beforeScube = null;
      try { const beforeRes = await fetch(`${apiBase}/user/${tgid}`); if (beforeRes.ok) { const beforeJson = await beforeRes.json(); beforeScube = Number(beforeJson.scube || 0); } } catch(e){ console.warn('Failed to fetch baseline before reward', e); }
      let claimSucceeded = false;
      try {
        const claimRes = await fetch(`${apiBase}/user/${tgid}/claim-reward`, { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ amount: expectedReward, source: 'task', contextId }) });
        if (claimRes.ok) { const claimJson = await claimRes.json(); if (claimJson && claimJson.ok) { claimSucceeded = true; applyRewardSuccess(Number(claimJson.credited || expectedReward), Number(claimJson.scube), Boolean(claimJson.duplicate)); onRewarded && onRewarded('tasks'); } }
      } catch(e){ console.warn('Task reward claim request failed', e); }
      if (claimSucceeded) return;
      const timeout = 20000; const interval = 2000; const start = Date.now(); let credited = false;
      while (Date.now() - start < timeout) {
        await new Promise(r=>setTimeout(r, interval));
        try {
          const check = await fetch(`${apiBase}/user/${tgid}`); if (!check.ok) continue; const js = await check.json(); const nowScube = Number(js.scube || 0);
          if (beforeScube !== null) { const delta = nowScube - beforeScube; if (delta > 0) { applyRewardSuccess(delta, nowScube); credited = true; break; } }
          else { applyRewardSuccess(expectedReward, nowScube); credited = true; break; }
        } catch(e){ console.warn('poll error', e); }
      }
      if (!credited) setTaskFeedback(`Награда не подтверждена — попробуйте позже (ожидали +${expectedReward} SCube).`, 'warning');
    } catch(e){ console.warn('Failed to process task reward event', e); setTaskFeedback('Ошибка при подтверждении награды', 'error'); }
  };
  ['reward'].forEach(name=> taskEl.addEventListener(name, rewardHandler));
  ['onError','error'].forEach(name=> taskEl.addEventListener(name, handleError));
  ['onBannerNotFound','bannerNotFound'].forEach(name=> taskEl.addEventListener(name, handleUnavailable));
  ['onTooLongSession','tooLongSession'].forEach(name=> taskEl.addEventListener(name, handleTooLong));
  markState('idle');
}

function createAdsgramTaskCard(cfg, getTgid, onRewarded){
  const wrapper = document.getElementById('ads-task-wrap'); if (!wrapper) return null;
  const card = document.createElement('div'); card.className = 'adsgram-task-card adsgram-task-card--idle';
  const header = document.createElement('div'); header.className = 'adsgram-task-header';
  const icon = document.createElement('div'); icon.className = 'adsgram-task-icon'; icon.textContent = '🎯';
  const text = document.createElement('div'); text.className = 'adsgram-task-text';
  const title = document.createElement('h4'); title.className = 'adsgram-task-title'; title.textContent = 'Задание AdsGram';
  const subtitle = document.createElement('p'); subtitle.className = 'adsgram-task-subtitle'; subtitle.textContent = 'Выполните условия предложения и заберите награду.';
  text.append(title, subtitle); header.append(icon, text);
  const hint = document.createElement('p'); hint.className = 'adsgram-task-hint'; hint.textContent = 'Нажмите «GO», выполните шаги рекламодателя, затем заберите награду.';
  const taskEl = document.createElement('adsgram-task'); taskEl.className = 'adsgram-task-element'; taskEl.setAttribute('slot', 'root'); taskEl.setAttribute('data-block-id', cfg.taskBlockId);
  if (cfg.taskDebug === true) taskEl.setAttribute('data-debug','true'); else if (cfg.taskDebug === false) taskEl.setAttribute('data-debug','false');
  if (cfg.taskDebugConsole === true || cfg.taskDebugConsole === false) taskEl.setAttribute('data-debug-console', String(cfg.taskDebugConsole));
  const rewardSource = document.getElementById('task-reward-amount'); let rewardLabel = rewardSource ? rewardSource.textContent.trim() : `${DEFAULT_TASK_REWARD} SCube`; if (!rewardLabel) rewardLabel = `${DEFAULT_TASK_REWARD} SCube`; if (!/^\+/.test(rewardLabel)) rewardLabel = `+${rewardLabel}`;
  const rewardSlot = document.createElement('div'); rewardSlot.className = 'task-slot-reward'; rewardSlot.setAttribute('slot','reward');
  const rewardAmount = document.createElement('span'); rewardAmount.className='task-slot-reward-amount'; rewardAmount.textContent = rewardLabel;
  const rewardHint = document.createElement('span'); rewardHint.className='task-slot-reward-hint'; rewardHint.textContent = 'за выполнение';
  rewardSlot.append(rewardAmount, rewardHint);
  const startButton = document.createElement('button'); startButton.type='button'; startButton.className='task-slot-button task-slot-button--start'; startButton.setAttribute('slot','button'); startButton.textContent='GO';
  const claimButton = document.createElement('button'); claimButton.type='button'; claimButton.className='task-slot-button task-slot-button--claim'; claimButton.setAttribute('slot','claim'); claimButton.textContent='CLAIM';
  const doneState = document.createElement('div'); doneState.className='task-slot-done'; doneState.setAttribute('slot','done'); doneState.textContent='DONE';
  taskEl.append(rewardSlot, startButton, claimButton, doneState);
  card.append(header, hint, taskEl); attachTaskEventHandlers(taskEl, card, getTgid, onRewarded); return card;
}

export function setupAdsgramTask(attempt=0, force=false, getTgid=()=>null, onRewarded){
  const cfg = window.ADSGRAM_CONFIG || {}; const wrapper = document.getElementById('ads-task-wrap'); if (!wrapper) return; if (!force && wrapper.dataset.taskReady === 'true') return;
  if (subgramLocked) { renderTaskEmptyState('Подпишитесь на спонсоров в SubGram, затем нажмите «Проверить».'); return; }
  const taskId = cfg.taskBlockId; if (!taskId) { renderTaskEmptyState('Пока заданий нет, приходите позже'); return; }
  if (!window.Adsgram) { if (attempt >= 20) { console.warn('AdsGram SDK was not ready for tasks'); renderTaskEmptyState('Не удалось загрузить задания. Попробуйте позже.'); return; } setTimeout(()=> setupAdsgramTask(attempt + 1, force, getTgid, onRewarded), 250); return; }
  ensureCustomElementReady('adsgram-task').then(()=>{ const card = createAdsgramTaskCard(cfg, getTgid, onRewarded); if (!card) return; wrapper.innerHTML=''; wrapper.appendChild(card); wrapper.dataset.taskReady='true'; setTaskFeedback('', 'info'); }).catch((err)=>{ console.warn('Failed to init AdsGram task element', err); renderTaskEmptyState('Не удалось загрузить задания. Попробуйте позже.'); });
}

export async function loadDailyStreak(getTgid){ const tgid = getTgid && getTgid(); const dailyStreakCard = document.getElementById('daily-streak-card'); if (!dailyStreakCard || !tgid) return; const dailyStreakProgress = document.getElementById('daily-streak-progress'); const dailyClaimBtn = document.getElementById('daily-claim-btn'); const dailyNote = document.getElementById('daily-note'); const DAILY_REWARDS = [10,50,100,125,150,175,200]; function renderDailyProgress(activeIndex = 0, claimedToday = false){ if (!dailyStreakProgress) return; dailyStreakProgress.innerHTML=''; DAILY_REWARDS.forEach((val, idx)=>{ const cell = document.createElement('div'); cell.className = 'streak-cell' + (idx === activeIndex ? ' active' : '') + (claimedToday ? ' completed' : ''); const d = document.createElement('span'); d.className='streak-day'; d.textContent = `${idx+1} день`; const r = document.createElement('span'); r.className='streak-reward'; r.textContent = `+${val} SCube`; cell.append(d,r); dailyStreakProgress.appendChild(cell); }); }
  try { const res = await fetch(`${apiBase}/user/${tgid}/daily-streak`); if (!res.ok) throw new Error('daily fetch failed'); const js = await res.json(); const idx = Math.max(0, Math.min(6, Number(js.dayIndex || 0))); const claimed = Boolean(js.claimedToday); renderDailyProgress(idx, claimed); if (dailyClaimBtn) dailyClaimBtn.disabled = claimed; if (dailyNote) dailyNote.textContent = claimed ? 'Награда за сегодня получена' : `Сегодняшняя награда: +${DAILY_REWARDS[idx]} SCube`; } catch(e){ console.warn('daily streak load failed', e); }
}

export function initDailyClaim(getTgid){ const dailyClaimBtn = document.getElementById('daily-claim-btn'); const scubeEl = document.getElementById('scube'); if (!dailyClaimBtn) return; dailyClaimBtn.addEventListener('click', async ()=>{ try { SoundManager.click(); } catch(e){} const tgid = getTgid(); if (!tgid) return alert('tgid is required'); const cfg = window.ADSGRAM_CONFIG || {}; const blockId = cfg.dailyRewardBlockId; try { if (window.Adsgram && blockId){ const controller = window.Adsgram.init({ blockId }); const result = await controller.show(); if (!result || result.error) { setTaskFeedback('Реклама не была просмотрена полностью'); return; } } } catch (e) { console.warn('daily ad error', e); }
  try { const res = await fetch(`${apiBase}/user/${tgid}/claim-daily`, { method:'POST' }); const js = await res.json(); if (js && js.ok){ scubeEl.textContent = js.scube; try { SoundManager.reward(); } catch(e){} animateScube(); rewardBurstNear(scubeEl); setTaskFeedback(`Ежедневная награда получена (+${js.credited} SCube)`); await loadDailyStreak(getTgid); } else { setTaskFeedback(js && js.message ? js.message : 'Не удалось получить награду'); } } catch (err){ console.warn('daily claim failed', err); } }); }

export async function loadSponsorTasks(getTgid){ const wrap = document.getElementById('sponsor-tasks-wrap'); if (!wrap) return; wrap.innerHTML=''; try { const res = await fetch('/api/tasks/sponsors'); if (!res.ok) throw new Error('Failed to load tasks'); const js = await res.json(); const tasks = Array.isArray(js.tasks) ? js.tasks : []; if (!tasks.length) { const empty = document.createElement('div'); empty.className = 'tasks-empty-message'; empty.textContent = 'Пока заданий от спонсоров нет.'; wrap.appendChild(empty); return; } tasks.forEach(task=>{ const card = document.createElement('article'); card.className = 'adsgram-task-card sponsor-task-card'; const header = document.createElement('div'); header.className = 'adsgram-task-header'; const icon = document.createElement('div'); icon.className = 'adsgram-task-icon'; icon.textContent = '📣'; const text = document.createElement('div'); text.className = 'adsgram-task-text'; const title = document.createElement('h4'); title.className = 'adsgram-task-title'; title.textContent = task.title || 'Задание'; const subtitle = document.createElement('p'); subtitle.className = 'adsgram-task-subtitle'; subtitle.textContent = 'Подпишитесь и заберите награду.'; text.append(title, subtitle); header.append(icon, text); const rewardBanner = document.createElement('div'); rewardBanner.className = 'task-slot-reward'; const amount = document.createElement('span'); amount.className = 'task-slot-reward-amount'; amount.textContent = `+${task.reward} SCube`; const hint = document.createElement('span'); hint.className = 'task-slot-reward-hint'; hint.textContent = 'за подписку'; rewardBanner.append(amount, hint); const actions = document.createElement('div'); const openBtn = document.createElement('a'); openBtn.className = 'task-slot-button task-slot-button--start'; openBtn.textContent = 'Открыть'; openBtn.href = task.url; openBtn.target = '_blank'; openBtn.rel = 'noopener noreferrer'; const claimBtn = document.createElement('button'); claimBtn.type='button'; claimBtn.className='task-slot-button task-slot-button--claim'; claimBtn.textContent = 'Получить награду'; let pending=false, completed=false, busy=false; function updateState(){ claimBtn.disabled = pending || completed || busy; claimBtn.textContent = completed ? 'DONE' : (pending ? 'На проверке' : 'Получить награду'); } updateState(); claimBtn.addEventListener('click', async ()=>{ const tgid = getTgid && getTgid(); if (!tgid) { setTaskFeedback('Откройте игру через бота', 'warning'); return; } busy=true; updateState(); try { const r = await fetch(`/api/tasks/sponsors/${task.id}/claim`, { method:'POST', headers:{ 'Content-Type':'application/json' }, body: JSON.stringify({ tgid }) }); const body = await r.json().catch(()=>({})); if (!r.ok || !body.ok){ setTaskFeedback((body && (body.message||body.error)) || 'Ошибка', 'error'); } else if (body.pending){ pending = true; setTaskFeedback('Заявка отправлена на проверку', 'info'); } else { completed = true; setTaskFeedback('Награда за задание начислена', 'success'); } } catch (e) { setTaskFeedback('Ошибка сети', 'error'); } finally { busy=false; updateState(); } }); actions.append(openBtn, claimBtn); card.append(header, rewardBanner, actions); wrap.appendChild(card); }); } catch(e){ const err = document.createElement('div'); err.className='task-feedback task-feedback--error'; err.textContent = 'Не удалось загрузить задания'; wrap.appendChild(err); }
}

export async function loadSubgramStatus(getTgid){ try { const tgid = getTgid && getTgid(); if (!tgid) return; const res = await fetch(`/api/subgram/status?tgid=${encodeURIComponent(tgid)}`); if (!res.ok) throw new Error(`status ${res.status}`); const js = await res.json(); subgramLocked = Boolean(js.enabled) && js.enabled === true && js.subscribed === false; subgramBotUrl = js.botUrl || null; subgramRecheckSec = Number(js.recheckAfterSeconds || subgramRecheckSec);
  let links = Array.isArray(js.requiredLinks) ? js.requiredLinks.slice() : []; const sponsors = Array.isArray(js.sponsors) ? js.sponsors : []; if (!links.length && sponsors.length) links = sponsors.map(s=> s && s.link).filter(Boolean);
  function renderLinks(listEl){ if (!listEl) return; listEl.innerHTML=''; if (links.length) { links.forEach((link)=>{ const li = document.createElement('li'); li.className = 'subgram-link-item'; const a = document.createElement('a'); a.href = link; a.target = '_blank'; a.rel = 'noopener noreferrer'; a.textContent = link; li.appendChild(a); const meta = sponsors.find(s=>s && s.link === link); if (meta && meta.name) { const name = document.createElement('span'); name.style.marginLeft = '8px'; name.textContent = `— ${meta.name}`; li.appendChild(name); } listEl.appendChild(li); }); } }
  if (subgramGateEl) { if (subgramLocked) { subgramGateEl.classList.remove('hidden'); renderLinks(subgramLinksEl); } else { subgramGateEl.classList.add('hidden'); } }
  if (subgramBlockerEl) { if (subgramLocked) { subgramBlockerEl.classList.remove('hidden'); renderLinks(subgramBlockerLinksEl); } else { subgramBlockerEl.classList.add('hidden'); } }
} catch(e){ console.warn('SubGram status failed', e); if (subgramGateEl) subgramGateEl.classList.add('hidden'); if (subgramBlockerEl) subgramBlockerEl.classList.add('hidden'); subgramLocked=false; } finally { setupAdsgramTask(0,true,getTgid); }
}

function openSubgramBot(){ try { const url = subgramBotUrl || 'https://t.me/SubGramAppBot'; if (window.Telegram && window.Telegram.WebApp && typeof window.Telegram.WebApp.openTelegramLink === 'function') { window.Telegram.WebApp.openTelegramLink(url); } else { window.open(url, '_blank'); } } catch (e) { window.open(subgramBotUrl || 'https://t.me/SubGramAppBot', '_blank'); } }

export function initSubgramControls(getTgid){ if (subgramOpenBtn) subgramOpenBtn.addEventListener('click', openSubgramBot); if (subgramRecheckBtn) subgramRecheckBtn.addEventListener('click', ()=> loadSubgramStatus(getTgid)); if (subgramBlockerOpenBtn) subgramBlockerOpenBtn.addEventListener('click', openSubgramBot); if (subgramBlockerRecheckBtn) subgramBlockerRecheckBtn.addEventListener('click', ()=> loadSubgramStatus(getTgid)); }
