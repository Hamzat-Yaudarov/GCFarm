import { apiBase } from './state.js';

export function initAdmin(getTgid){
  const adminBtn = document.createElement('button');
  adminBtn.id = 'admin-open-btn';
  adminBtn.className = 'small-btn';
  adminBtn.textContent = '🛠️ Админ';
  adminBtn.style.display = 'none';
  const header = document.querySelector('.game-header .balances');
  if (header) header.appendChild(adminBtn);

  const section = document.getElementById('admin');

  async function checkAdmin(){
    try{
      const res = await fetch(`${apiBase}/admin/me`);
      const js = await res.json();
      if (js && js.ok && js.isAdmin){ if (adminBtn) adminBtn.style.display='inline-block'; } else { if (adminBtn) adminBtn.style.display='none'; }
    } catch(e){ /* ignore */ }
  }

  async function loadStats(){
    const wrap = document.getElementById('admin-stats'); if (!wrap) return;
    wrap.innerHTML = '<div class="section-hint">Загружаем…</div>';
    try{ const res = await fetch(`${apiBase}/admin/stats`); const js = await res.json(); if (!js.ok) throw new Error('bad'); const s = js.stats || {}; const w = s.withdrawals||{}; wrap.innerHTML = `
      <div class="admin-stats-grid">
        <div class="admin-stat">Пользователи: <strong>${s.users||0}</strong></div>
        <div class="admin-stat">SCube: <strong>${(s.totals&&s.totals.scube)||0}</strong></div>
        <div class="admin-stat">VP: <strong>${(s.totals&&s.totals.vp)||0}</strong></div>
        <div class="admin-stat">Билеты: <strong>${(s.totals&&s.totals.tickets)||0}</strong></div>
        <div class="admin-stat">GCube: <strong>${(s.totals&&s.totals.gcube)||0}</strong></div>
        <div class="admin-stat">Stars: <strong>${(s.totals&&s.totals.stars)||0}</strong></div>
        <div class="admin-stat">Клики: <strong>${(s.activity&&s.activity.clicks)||0}</strong></div>
        <div class="admin-stat">Заданий: <strong>${(s.activity&&s.activity.tasks)||0}</strong></div>
        <div class="admin-stat">WD: ожид: <strong>${w.pending||0}</strong>, вып: <strong>${w.completed||0}</strong>, откл: <strong>${w.declined||0}</strong></div>
      </div>`; } catch(e){ wrap.innerHTML='<div class="section-hint">Не удалось загрузить</div>'; }
  }

  function setupForm(){
    const form = document.getElementById('admin-task-form'); if (!form) return;
    const typeSel = form.querySelector('#task-type');
    const linkWrap = form.querySelector('#task-link-wrap');
    const reqWrap = form.querySelector('#task-required-wrap');
    function updateVis(){ const t = typeSel.value; linkWrap.style.display = (t==='subscribe')?'block':'none'; reqWrap.style.display = (t!=='subscribe')?'block':'none'; }
    typeSel.addEventListener('change', updateVis); updateVis();
    const toggle = document.getElementById('admin-task-toggle');
    const wrap = document.getElementById('admin-task-wrap');
    if (toggle && wrap){ toggle.addEventListener('click', ()=>{ wrap.classList.toggle('hidden'); }); }
    form.addEventListener('submit', async (e)=>{
      e.preventDefault();
      const payload = {
        name: form.querySelector('#task-name').value.trim(),
        type: form.querySelector('#task-type').value,
        reward_type: form.querySelector('#reward-type').value,
        reward_amount: parseInt(form.querySelector('#reward-amount').value,10)||0,
        link: form.querySelector('#task-link').value.trim()||null,
        required_count: parseInt(form.querySelector('#task-required').value,10)||null
      };
      const fb = document.getElementById('admin-task-feedback'); fb.textContent='';
      try{ const res = await fetch(`${apiBase}/admin/tasks`, { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(payload) }); const js = await res.json(); if (!res.ok || !js.ok) throw new Error(js && js.message || 'Ошибка'); fb.textContent='Задача создана'; form.reset(); updateVis(); } catch(err){ fb.textContent = err.message || 'Ошибка'; }
    });
  }

  function showAdmin(){ if (!section) return; const tabs = window.__appTabs; if (tabs && typeof tabs.showTab === 'function') { tabs.showTab('admin'); } else {
      const all = document.querySelectorAll('.tab-content'); all.forEach(c=>{ if (c.id==='admin') c.classList.remove('hidden'); else c.classList.add('hidden'); });
    }
    const bottomNav = document.querySelector('.tabs-bottom'); if (bottomNav) bottomNav.style.display='none';
    try { loadStats(); } catch(e){}
  }

  if (adminBtn) adminBtn.addEventListener('click', showAdmin);

  const backBtn = document.getElementById('admin-back'); if (backBtn) backBtn.addEventListener('click', ()=>{ const bottomNav = document.querySelector('.tabs-bottom'); if (bottomNav) bottomNav.style.display='flex'; const tabs = window.__appTabs; if (tabs && typeof tabs.showTab === 'function') tabs.showTab('home'); });

  return { checkAdmin, loadStats, setupForm };
}
