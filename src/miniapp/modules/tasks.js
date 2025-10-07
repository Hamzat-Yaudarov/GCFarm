import { animateScube, rewardBurstNear, SoundManager } from './utils.js';

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
function scheduleTaskReload(delay=1200){ const wrapper = getTasksWrapper(); if (wrapper) delete wrapper.dataset.taskReady; setTimeout(()=> renderTaskEmptyState('Задачи от AdsGram отключены'), delay); }

// Minimal reward resolver - keeps API compatibility but does not rely on AdsGram SDK
export function resolveAdsgramReward(detail, fallback = DEFAULT_AD_REWARD) {
  const data = detail || {}; const numericKeys = ['reward','amount','value','payout','reward_amount','rewardAmount','bonus','coins']; let amount;
  for (const key of numericKeys) { if (!Object.prototype.hasOwnProperty.call(data, key)) continue; const parsed = Number(data[key]); if (Number.isFinite(parsed) && parsed > 0) { amount = parsed; break; } }
  const resolved = amount && amount > 0 ? amount : fallback; return { amount: Math.min(1000000, Math.max(1, Math.round(resolved))), isTask: false };
}
export function extractAdsgramContextId(detail){ return null; }

// No-op: AdsGram task element integration removed
export function setupAdsgramTask(){ renderTaskEmptyState('Задачи от AdsGram отключены'); }

export async function loadDailyStreak(getTgid){ const tgid = getTgid && getTgid(); const dailyStreakCard = document.getElementById('daily-streak-card'); if (!dailyStreakCard || !tgid) return; const dailyStreakProgress = document.getElementById('daily-streak-progress'); const dailyClaimBtn = document.getElementById('daily-claim-btn'); const dailyNote = document.getElementById('daily-note'); const DAILY_REWARDS = [10,50,100,125,150,175,200]; function renderDailyProgress(activeIndex = 0, claimedToday = false){ if (!dailyStreakProgress) return; dailyStreakProgress.innerHTML=''; DAILY_REWARDS.forEach((val, idx)=>{ const cell = document.createElement('div'); cell.className = 'streak-cell' + (idx === activeIndex ? ' active' : '') + (claimedToday ? ' completed' : ''); const d = document.createElement('span'); d.className='streak-day'; d.textContent = `${idx+1} день`; const r = document.createElement('span'); r.className='streak-reward'; r.textContent = `+${val} SCube`; cell.append(d,r); dailyStreakProgress.appendChild(cell); }); }
  try { const res = await fetch(`/api/user/${tgid}/daily-streak`); if (!res.ok) throw new Error('daily fetch failed'); const js = await res.json(); const idx = Math.max(0, Math.min(6, Number(js.dayIndex || 0))); const claimed = Boolean(js.claimedToday); renderDailyProgress(idx, claimed); if (dailyClaimBtn) dailyClaimBtn.disabled = claimed; if (dailyNote) dailyNote.textContent = claimed ? 'Награда за сегодня получена' : `Сегодняшняя награда: +${DAILY_REWARDS[idx]} SCube`; } catch(e){ console.warn('daily streak load failed', e); }
}

export function initDailyClaim(getTgid){ const dailyClaimBtn = document.getElementById('daily-claim-btn'); const scubeEl = document.getElementById('scube'); if (!dailyClaimBtn) return; dailyClaimBtn.addEventListener('click', async ()=>{ try { SoundManager.click(); } catch(e){} const tgid = getTgid(); if (!tgid) return alert('tgid is required'); try { const res = await fetch(`/api/user/${tgid}/claim-daily`, { method:'POST' }); const js = await res.json(); if (js && js.ok){ scubeEl.textContent = js.scube; try { SoundManager.reward(); } catch(e){} animateScube(); rewardBurstNear(scubeEl); setTaskFeedback(`Ежедневная награда получена (+${js.credited} SCube)`); await loadDailyStreak(getTgid); } else { setTaskFeedback(js && js.message ? js.message : 'Не удалось получить награду'); } } catch (err){ console.warn('daily claim failed', err); } }); }

export async function loadSponsorTasks(getTgid){ const wrap = document.getElementById('sponsor-tasks-wrap'); if (!wrap) return; wrap.innerHTML=''; try { const res = await fetch('/api/tasks/sponsors'); if (!res.ok) throw new Error('Failed to load tasks'); const js = await res.json(); const tasks = Array.isArray(js.tasks) ? js.tasks : []; if (!tasks.length) { const empty = document.createElement('div'); empty.className = 'tasks-empty-message'; empty.textContent = 'Пока заданий от спонсоров нет.'; wrap.appendChild(empty); return; } tasks.forEach(task=>{ const card = document.createElement('article'); card.className = 'adsgram-task-card sponsor-task-card'; const header = document.createElement('div'); header.className = 'adsgram-task-header'; const icon = document.createElement('div'); icon.className = 'adsgram-task-icon'; icon.textContent = '📣'; const text = document.createElement('div'); text.className = 'adsgram-task-text'; const title = document.createElement('h4'); title.className = 'adsgram-task-title'; title.textContent = task.title || 'Задание'; const subtitle = document.createElement('p'); subtitle.className = 'adsgram-task-subtitle'; subtitle.textContent = 'Подпишитесь и заберите награду.'; text.append(title, subtitle); header.append(icon, text); const rewardBanner = document.createElement('div'); rewardBanner.className = 'task-slot-reward'; const amount = document.createElement('span'); amount.className = 'task-slot-reward-amount'; amount.textContent = `+${task.reward || task.reward_amount || 0} SCube`; rewardBanner.appendChild(amount); card.append(header, rewardBanner); wrap.appendChild(card); }); } catch(e){ console.warn('Failed to load sponsor tasks', e); const empty = document.createElement('div'); empty.className = 'tasks-empty-message'; empty.textContent = 'Не удалось загрузить задания.'; wrap.appendChild(empty); } }

export async function loadSubgramStatus(getTgid){ try { const tgid = getTgid && getTgid(); if (!tgid) return; const res = await fetch(`/api/subgram/status?tgid=${encodeURIComponent(tgid)}`); if (!res.ok) throw new Error(`status ${res.status}`); const js = await res.json(); subgramLocked = Boolean(js.enabled) && js.enabled === true && js.subscribed === false; subgramBotUrl = js.botUrl || null; subgramRecheckSec = Number(js.recheckAfterSeconds || subgramRecheckSec);
  let links = Array.isArray(js.requiredLinks) ? js.requiredLinks.slice() : []; const sponsors = Array.isArray(js.sponsors) ? js.sponsors : []; if (!links.length && sponsors.length) links = sponsors.map(s=> s && s.link).filter(Boolean);
  function renderLinks(listEl){ if (!listEl) return; listEl.innerHTML=''; if (links.length) { links.forEach((link)=>{ const li = document.createElement('li'); li.className = 'subgram-link-item'; const a = document.createElement('a'); a.href = link; a.target = '_blank'; a.rel = 'noopener noreferrer'; a.textContent = link; li.appendChild(a); const meta = sponsors.find(s=>s && s.link === link); if (meta && meta.name) { const name = document.createElement('span'); name.style.marginLeft = '8px'; name.textContent = `— ${meta.name}`; li.appendChild(name); } listEl.appendChild(li); }); } }
  if (subgramGateEl) { if (subgramLocked) { subgramGateEl.classList.remove('hidden'); renderLinks(subgramLinksEl); } else { subgramGateEl.classList.add('hidden'); } }
  if (subgramBlockerEl) { if (subgramLocked) { subgramBlockerEl.classList.remove('hidden'); renderLinks(subgramBlockerLinksEl); document.body.classList.add('subgram-locked'); } else { subgramBlockerEl.classList.add('hidden'); document.body.classList.remove('subgram-locked'); } }
} catch(e){ console.warn('SubGram status failed', e); if (subgramGateEl) subgramGateEl.classList.add('hidden'); if (subgramBlockerEl) subgramBlockerEl.classList.add('hidden'); subgramLocked=false; } }

export function initSubgramControls(getTgid){ if (subgramOpenBtn) subgramOpenBtn.addEventListener('click', openSubgramBot); if (subgramRecheckBtn) subgramRecheckBtn.addEventListener('click', ()=> loadSubgramStatus(getTgid)); if (subgramBlockerOpenBtn) subgramBlockerOpenBtn.addEventListener('click', openSubgramBot); if (subgramBlockerRecheckBtn) subgramBlockerRecheckBtn.addEventListener('click', ()=> loadSubgramStatus(getTgid)); }
