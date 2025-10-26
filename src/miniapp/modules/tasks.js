import { apiBase } from './state.js';
import { animateScube, rewardBurstNear, SoundManager } from './utils.js';

const subgramGateEl = document.getElementById('subgram-gate');
const subgramLinksEl = document.getElementById('subgram-links');
const subgramOpenBtn = document.getElementById('subgram-open');
const subgramRecheckBtn = document.getElementById('subgram-recheck');
const subgramBlockerEl = document.getElementById('subgram-blocker');
const subgramBlockerLinksEl = document.getElementById('subgram-blocker-links');
const subgramBlockerOpenBtn = document.getElementById('subgram-blocker-open');
const subgramBlockerRecheckBtn = document.getElementById('subgram-blocker-recheck');
let subgramLocked = false;
let subgramBotUrl = null;
let subgramRecheckSec = 90;

function setTaskFeedback(message, tone = 'info'){
  const taskFeedback = document.getElementById('task-feedback');
  if (!taskFeedback) return;
  const tones = ['info','success','warning','error'];
  tones.forEach((t)=> taskFeedback.classList.remove(`task-feedback--${t}`));
  if (message) {
    taskFeedback.textContent = message;
    taskFeedback.classList.add(`task-feedback--${tone}`);
  } else {
    taskFeedback.textContent='';
  }
}

export async function loadDailyStreak(getTgid){
  const tgid = getTgid && getTgid();
  const dailyStreakCard = document.getElementById('daily-streak-card');
  if (!dailyStreakCard || !tgid) return;
  const dailyStreakProgress = document.getElementById('daily-streak-progress');
  const dailyClaimBtn = document.getElementById('daily-claim-btn');
  const dailyNote = document.getElementById('daily-note');
  const DAILY_REWARDS = [10,50,100,125,150,175,200];
  function renderDailyProgress(activeIndex = 0, claimedToday = false){
    if (!dailyStreakProgress) return;
    dailyStreakProgress.innerHTML='';
    DAILY_REWARDS.forEach((val, idx)=>{
      const cell = document.createElement('div');
      cell.className = 'streak-cell' + (idx === activeIndex ? ' active' : '') + (claimedToday ? ' completed' : '');
      const d = document.createElement('span');
      d.className='streak-day';
      d.textContent = `${idx+1} день`;
      const r = document.createElement('span');
      r.className='streak-reward';
      r.textContent = `+${val} SCube`;
      cell.append(d,r);
      dailyStreakProgress.appendChild(cell);
    });
  }
  try {
    const res = await fetch(`${apiBase}/user/${tgid}/daily-streak`);
    if (!res.ok) throw new Error('daily fetch failed');
    const js = await res.json();
    const idx = Math.max(0, Math.min(6, Number(js.dayIndex || 0)));
    const claimed = Boolean(js.claimedToday);
    renderDailyProgress(idx, claimed);
    if (dailyClaimBtn) dailyClaimBtn.disabled = claimed;
    if (dailyNote) dailyNote.textContent = claimed ? 'Награда за сегодня получена' : `Сегодняшняя награда: +${DAILY_REWARDS[idx]} SCube`;
  } catch(e){
    console.warn('daily streak load failed', e);
  }
}

export function initDailyClaim(getTgid){
  const dailyClaimBtn = document.getElementById('daily-claim-btn');
  const scubeEl = document.getElementById('scube');
  if (!dailyClaimBtn) return;
  dailyClaimBtn.addEventListener('click', async ()=>{
    try { SoundManager.click(); } catch(e){}
    const tgid = getTgid();
    if (!tgid) return alert('tgid is required');
    const cfg = window.ADSGRAM_CONFIG || {};
    const blockId = cfg.dailyRewardBlockId;
    try {
      if (window.Adsgram && blockId){
        const controller = window.Adsgram.init({ blockId });
        const result = await controller.show();
        if (!result || result.error) {
          setTaskFeedback('Реклама не была просмотрена полностью');
          return;
        }
      }
    } catch (e) {
      console.warn('daily ad error', e);
    }
    try {
      const res = await fetch(`${apiBase}/user/${tgid}/claim-daily`, { method:'POST' });
      const js = await res.json();
      if (js && js.ok){
        scubeEl.textContent = js.scube;
        try { SoundManager.reward(); } catch(e){}
        animateScube();
        rewardBurstNear(scubeEl);
        setTaskFeedback(`Ежедневная награда получена (+${js.credited} SCube)`);
        await loadDailyStreak(getTgid);
      } else {
        setTaskFeedback(js && js.message ? js.message : 'Не удалось получить награду');
      }
    } catch (err){
      console.warn('daily claim failed', err);
    }
  });
}

export async function loadSubgramStatus(getTgid){
  try {
    const tgid = getTgid && getTgid();
    if (!tgid) return;
    const res = await fetch(`/api/subgram/status?tgid=${encodeURIComponent(tgid)}`);
    if (!res.ok) throw new Error(`status ${res.status}`);
    const js = await res.json();
    subgramLocked = Boolean(js.enabled) && js.enabled === true && js.subscribed === false;
    subgramBotUrl = js.botUrl || null;
    subgramRecheckSec = Number(js.recheckAfterSeconds || subgramRecheckSec);
    let links = Array.isArray(js.requiredLinks) ? js.requiredLinks.slice() : [];
    const sponsors = Array.isArray(js.sponsors) ? js.sponsors : [];
    if (!links.length && sponsors.length) links = sponsors.map(s=> s && s.link).filter(Boolean);
    function renderLinks(listEl){
      if (!listEl) return;
      listEl.innerHTML='';
      if (links.length) {
        links.forEach((link)=>{
          const li = document.createElement('li');
          li.className = 'subgram-link-item';
          const a = document.createElement('a');
          a.href = link;
          a.target = '_blank';
          a.rel = 'noopener noreferrer';
          a.textContent = link;
          li.appendChild(a);
          const meta = sponsors.find(s=>s && s.link === link);
          if (meta && meta.name) {
            const name = document.createElement('span');
            name.style.marginLeft = '8px';
            name.textContent = `— ${meta.name}`;
            li.appendChild(name);
          }
          listEl.appendChild(li);
        });
      }
    }
    if (subgramGateEl) {
      if (subgramLocked) {
        subgramGateEl.classList.remove('hidden');
        renderLinks(subgramLinksEl);
      } else {
        subgramGateEl.classList.add('hidden');
      }
    }
    if (subgramBlockerEl) {
      if (subgramLocked) {
        subgramBlockerEl.classList.remove('hidden');
        renderLinks(subgramBlockerLinksEl);
        document.body.classList.add('subgram-locked');
      } else {
        subgramBlockerEl.classList.add('hidden');
        document.body.classList.remove('subgram-locked');
      }
    }
  } catch(e){
    console.warn('SubGram status failed', e);
    if (subgramGateEl) subgramGateEl.classList.add('hidden');
    if (subgramBlockerEl) subgramBlockerEl.classList.add('hidden');
    subgramLocked=false;
  }
}

function openSubgramBot(){
  try {
    const url = subgramBotUrl || 'https://t.me/SubGramAppBot';
    if (window.Telegram && window.Telegram.WebApp && typeof window.Telegram.WebApp.openTelegramLink === 'function') {
      window.Telegram.WebApp.openTelegramLink(url);
    } else {
      window.open(url, '_blank');
    }
  } catch (e) {
    window.open(subgramBotUrl || 'https://t.me/SubGramAppBot', '_blank');
  }
}

export function initSubgramControls(getTgid){
  if (subgramOpenBtn) subgramOpenBtn.addEventListener('click', openSubgramBot);
  if (subgramRecheckBtn) subgramRecheckBtn.addEventListener('click', ()=> loadSubgramStatus(getTgid));
  if (subgramBlockerOpenBtn) subgramBlockerOpenBtn.addEventListener('click', openSubgramBot);
  if (subgramBlockerRecheckBtn) subgramBlockerRecheckBtn.addEventListener('click', ()=> loadSubgramStatus(getTgid));
}
