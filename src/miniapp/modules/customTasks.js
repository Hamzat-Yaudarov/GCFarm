import { apiBase } from './state.js';
import { animateScube, SoundManager } from './utils.js';

function openTelegramLink(raw){
  try {
    const s = String(raw||'').trim(); if (!s) return;
    let url = s;
    if (/^@/.test(s)) url = `https://t.me/${s.replace(/^@/,'')}`;
    else if (!/^https?:\/\//i.test(s)) url = `https://t.me/${s}`;
    if (window.Telegram && window.Telegram.WebApp && typeof window.Telegram.WebApp.openTelegramLink === 'function') {
      window.Telegram.WebApp.openTelegramLink(url);
    } else { window.open(url,'_blank'); }
  } catch(e){ try { window.open(String(raw),'_blank'); } catch(_){} }
}

function rewardLabel(type, amount){ const a = Math.max(1, Number(amount||0)); const map = { scube:'SCube', vp:'VP', tickets:'Билеты' }; return `+${a} ${map[String(type||'').toLowerCase()]||'SCube'}`; }

async function fetchProgress(){ try { const res = await fetch(`${apiBase}/tasks/progress`); if (!res.ok) return { earned_scube: 0 }; const js = await res.json(); return { earned_scube: Number(js.earned_scube||0) }; } catch(e){ return { earned_scube: 0 }; }
}

export async function loadCustomTasks(getTgid){
  const wrap = document.getElementById('custom-tasks-wrap');
  if (!wrap) return;
  wrap.innerHTML='';
  try{
    const res = await fetch(`${apiBase}/tasks/custom`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const js = await res.json();
    const list = (js && js.ok && Array.isArray(js.tasks)) ? js.tasks : [];
    if (!list.length) {
      const empty=document.createElement('div');
      empty.className='tasks-empty-message';
      empty.textContent='Пока кастомных заданий нет.';
      wrap.appendChild(empty);
      return;
    }

    const progress = await fetchProgress();

    list.forEach(t=>{
      const card = document.createElement('article'); card.className='adsgram-task-card sponsor-task-card';
      const header = document.createElement('div'); header.className='adsgram-task-header';
      const icon = document.createElement('div'); icon.className='adsgram-task-icon'; icon.textContent = t.type==='subscribe'?'🔔':(t.type==='earn_scube'?'⛏️':'👥');
      const text = document.createElement('div'); text.className='adsgram-task-text';
      const title = document.createElement('h4'); title.className='adsgram-task-title'; title.textContent = t.name || 'Задание';
      const subtitle = document.createElement('p'); subtitle.className='adsgram-task-subtitle';
      if (t.type==='subscribe') subtitle.textContent='Подпишитесь на канал/чат.';
      else if (t.type==='earn_scube') subtitle.textContent = `Заработайте ${t.required_count} SCube.`;
      else if (t.type==='invite_referrals') subtitle.textContent = `Пригласить рефералов — временно недоступно`;
      else subtitle.textContent = 'Задание';
      text.append(title, subtitle); header.append(icon, text);

      const rewardBanner = document.createElement('div'); rewardBanner.className='task-slot-reward';
      const amount = document.createElement('span'); amount.className='task-slot-reward-amount'; amount.textContent = rewardLabel(t.reward_type, t.reward_amount);
      const hint = document.createElement('span'); hint.className='task-slot-reward-hint'; hint.textContent = 'за выполнение';
      rewardBanner.append(amount, hint);

      const actions = document.createElement('div'); actions.className = 'task-actions-row';
      const doBtn = document.createElement('button'); doBtn.type='button'; doBtn.className='task-slot-button task-slot-button--start'; doBtn.textContent = t.type==='subscribe' ? 'Выполнить' : 'Открыть';
      const checkBtn = document.createElement('button'); checkBtn.type='button'; checkBtn.className='task-slot-button task-slot-button--claim'; checkBtn.textContent='Проверить';

      if (t.completed){ checkBtn.disabled=true; checkBtn.textContent='Завершено'; doBtn.disabled=true; }

      if (t.type==='subscribe' && t.link) { doBtn.addEventListener('click', ()=>{ try { SoundManager.click(); } catch(e){} openTelegramLink(t.link); }); }
      else { doBtn.disabled = true; }

      checkBtn.addEventListener('click', async ()=>{
        try { SoundManager.click(); } catch(e){}
        const tgid = getTgid && getTgid();
        if (!tgid) {
          alert('Требуется авторизация. Перезапустите приложение через бота.');
          return;
        }
        checkBtn.disabled = true;
        const originalText = checkBtn.textContent;
        checkBtn.textContent = 'Проверка...';
        try {
          const res = await fetch(`${apiBase}/tasks/${t.id}/verify`, { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ tgid }) });
          const js = await res.json();
          if (!res.ok || (js && js.ok===false)) {
            const errMsg = (js && (js.message||js.error)) || 'Условия задачи не выполнены';
            alert(errMsg);
            checkBtn.disabled = false;
            checkBtn.textContent = originalText;
            return;
          }
          if (js && js.already) {
            alert('Вы уже выполнили эту задачу');
            checkBtn.disabled = true;
            checkBtn.textContent = 'Завершено';
            doBtn.disabled = true;
            return;
          }
          if (js && js.balances) {
            if (typeof js.balances.scube==='number') {
              const s=document.getElementById('scube');
              if (s) {
                s.textContent=js.balances.scube;
                animateScube();
              }
            }
            if (typeof js.balances.vp==='number') {
              const el=document.getElementById('vp');
              if (el) el.textContent=js.balances.vp;
            }
            if (typeof js.balances.tickets==='number') {
              const el=document.getElementById('tickets');
              if (el) el.textContent=js.balances.tickets;
            }
          }
          const rewardText = rewardLabel(t.reward_type, js.credited || t.reward_amount);
          alert(`Задача выполнена! Получено ${rewardText}`);
          checkBtn.disabled=true;
          checkBtn.textContent='Завершено';
          doBtn.disabled=true;
        } catch(err){
          console.warn('Task verification error', err);
          alert('Ошибка при проверке задачи. Попробуйте позже.');
          checkBtn.disabled = false;
          checkBtn.textContent = originalText;
        }
      });

      card.append(header, rewardBanner);

      if (t.type==='earn_scube'){
        const prog = document.createElement('p');
        prog.className='adsgram-task-hint';
        const cur = Number(progress.earned_scube||0);
        const req = Number(t.required_count||0);
        const displayCur = Math.min(cur, req);
        const percent = req > 0 ? Math.round((displayCur / req) * 100) : 0;
        prog.textContent = `Прогресс: ${displayCur} / ${req} SCube (${percent}%)`;
        card.appendChild(prog);
        if (cur < req) {
          doBtn.disabled = true;
          checkBtn.disabled = true;
          checkBtn.textContent = 'Недостаточно SCube';
        }
      }

      if (t.type!=='invite_referrals'){ actions.append(checkBtn); if (t.type==='subscribe') actions.prepend(doBtn); card.appendChild(actions); }

      wrap.appendChild(card);
    });
  } catch(e){
    console.warn('Failed to load custom tasks', e);
    const empty=document.createElement('div');
    empty.className='tasks-empty-message';
    empty.textContent='Не удалось загрузить задания. Попробуйте обновить страницу.';
    wrap.appendChild(empty);
  }
}
