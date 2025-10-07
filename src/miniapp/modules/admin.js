import { apiBase } from './state.js';

export function initAdmin(getTgid){
  const ADMIN_IDS = new Set(['6910097562','7972065986']);
  const adminBtn = document.getElementById('admin-panel-btn');
  const adminTabButton = document.querySelector('.admin-tab-button');
  const adminTabStatsBtn = document.getElementById('admin-tab-stats');
  const adminTabCustomBtn = document.getElementById('admin-tab-custom');
  const statsContent = document.getElementById('admin-stats-content');
  const customSection = document.getElementById('admin-custom');
  const statsSection = document.getElementById('admin-stats');
  const form = document.getElementById('admin-create-task-form');
  const feedback = document.getElementById('admin-create-feedback');

  function isAdmin(tgid){ if (!tgid) return false; return ADMIN_IDS.has(String(tgid)); }

  function formatNumber(n){ return String(n || 0).replace(/\B(?=(\d{3})+(?!\d))/g, ' '); }

  async function renderStats(){
    if (!statsContent) return;
    statsContent.innerHTML = '<div class="admin-cards">Loading…</div>';
    try {
      const res = await fetch(`${apiBase}/admin/stats`);
      if (!res.ok) { statsContent.textContent = 'Не удалось загрузить статистику'; return; }
      const js = await res.json(); if (!js || !js.ok) { statsContent.textContent = 'Ошибка данных'; return; }

      const html = `
        <div class="admin-cards">
          <div class="admin-card">
            <div class="admin-card-title">Игроков всего</div>
            <div class="admin-card-value">${formatNumber(js.total_players)}</div>
            <div class="admin-card-sub">Новых сегодня: ${formatNumber(js.new_players_today)}</div>
          </div>

          <div class="admin-card">
            <div class="admin-card-title">SCube (в системе)</div>
            <div class="admin-card-value">${formatNumber(js.scube_on_users)}</div>
            <div class="admin-card-sub">Заработано всего: ${formatNumber(js.scube_earned_total)} • Сегодня: ${formatNumber(js.scube_earned_today)}</div>
          </div>

          <div class="admin-card">
            <div class="admin-card-title">SCube потрачено на улучшения</div>
            <div class="admin-card-value">${formatNumber(js.scube_spent_upgrades_total)}</div>
            <div class="admin-card-sub">Сегодня: ${formatNumber(js.scube_spent_upgrades_today)}</div>
          </div>

          <div class="admin-card">
            <div class="admin-card-title">Валюта и билеты</div>
            <div class="admin-card-value">VP: ${formatNumber(js.vp_total)} • 🎟️ ${formatNumber(js.tickets_total)}</div>
            <div class="admin-card-sub">Кастомных заданий: ${formatNumber(js.custom_tasks)}</div>
          </div>
        </div>
      `;
      statsContent.innerHTML = html;
    } catch (e){ statsContent.textContent = 'Ошибка связи'; }
  }

  function toggleSection(name){
    if (name === 'stats') { statsSection.classList.remove('hidden'); customSection.classList.add('hidden'); adminTabStatsBtn.classList.add('active'); adminTabCustomBtn.classList.remove('active'); }
    else { statsSection.classList.add('hidden'); customSection.classList.remove('hidden'); adminTabStatsBtn.classList.remove('active'); adminTabCustomBtn.classList.add('active'); }
  }

  if (!getTgid) return;
  const tgid = getTgid();
  if (isAdmin(tgid)){
    if (adminBtn) adminBtn.classList.remove('hidden');
    if (adminTabButton) adminTabButton.classList.remove('hidden');
  }

  if (adminBtn) adminBtn.addEventListener('click', ()=>{ try { if (window.__appTabs) window.__appTabs.showTab('admin'); renderStats(); } catch(e){ console.warn(e); } });
  if (adminTabButton) adminTabButton.addEventListener('click', ()=>{ try { if (window.__appTabs) window.__appTabs.showTab('admin'); renderStats(); } catch(e){} });
  if (adminTabStatsBtn) adminTabStatsBtn.addEventListener('click', ()=> toggleSection('stats'));
  if (adminTabCustomBtn) adminTabCustomBtn.addEventListener('click', ()=> toggleSection('custom'));
  const adminBackBtn = document.getElementById('admin-back-btn');
  if (adminBackBtn) adminBackBtn.addEventListener('click', ()=>{ try { if (window.__appTabs) window.__appTabs.showTab('home'); } catch(e){ console.warn(e); } });

  const taskTypeEl = document.getElementById('admin-task-type');
  const paramsLinkInput = document.getElementById('admin-task-link');
  const paramsNumberInput = document.getElementById('admin-task-number');
  const paramsLinkLabel = document.getElementById('admin-task-link-label');
  const paramsNumberLabel = document.getElementById('admin-task-number-label');

  function updateParamsVisibility(){
    const t = (taskTypeEl && taskTypeEl.value) || '';
    if (!paramsLinkInput || !paramsNumberInput) return;
    if (t === 'subscribe') {
      paramsLinkLabel.classList.remove('hidden');
      paramsNumberLabel.classList.add('hidden');
    } else if (t === 'referrals' || t === 'earn_scube') {
      paramsLinkLabel.classList.add('hidden');
      paramsNumberLabel.classList.remove('hidden');
      paramsNumberInput.type = 'number';
    } else {
      paramsLinkLabel.classList.remove('hidden');
      paramsNumberLabel.classList.add('hidden');
    }
  }
  if (taskTypeEl) taskTypeEl.addEventListener('change', updateParamsVisibility);
  updateParamsVisibility();

  if (form) {
    form.addEventListener('submit', async (e)=>{
      e.preventDefault(); if (!isAdmin(getTgid())) { feedback.textContent = 'Доступ запрещён'; return; }
      feedback.textContent = '';
      const name = (document.getElementById('admin-task-name') || {}).value || '';
      const reward_type = (document.getElementById('admin-reward-type') || {}).value || 'scube';
      const reward_amount = Number((document.getElementById('admin-reward-amount') || {}).value || 0);
      const task_type = (document.getElementById('admin-task-type') || {}).value || '';
      let params = {};
      try {
        if (task_type === 'subscribe') {
          const raw = (paramsLinkInput || {}).value || '';
          const v = String(raw || '').trim();
          if (!v) { feedback.textContent = 'Укажите ссылку или юзернейм'; return; }
          if (/^[{\[]/.test(v) || /[}\]]$/.test(v)) { feedback.textContent = 'JSON недопустим в этом поле — вставьте только ссылку или юзернейм'; return; }
          if (v.split(' ').length > 1) { feedback.textContent = 'Укажите только одну ссылку или юзернейм без пробелов'; return; }
          params = { link: v };
        } else if (task_type === 'referrals') {
          const raw = (paramsNumberInput || {}).value || '';
          const n = parseInt(String(raw || '').trim() || '0', 10);
          if (!Number.isFinite(n) || n <= 0) { feedback.textContent = 'Укажите корректное целое количество рефералов'; return; }
          params = { count: n };
        } else if (task_type === 'earn_scube') {
          const raw = (paramsNumberInput || {}).value || '';
          const n = parseInt(String(raw || '').trim() || '0', 10);
          if (!Number.isFinite(n) || n <= 0) { feedback.textContent = 'Укажите корректное количество SCube'; return; }
          params = { amount: n };
        } else {
          params = {};
        }
      } catch(e){ feedback.textContent = 'Ошибка обработки параметров'; return; }

      try {
        const res = await fetch(`${apiBase}/admin/custom-tasks`, { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify({ name, reward_type, reward_amount, task_type, params }) });
        if (!res.ok) { const body = await res.json().catch(()=>null); feedback.textContent = (body && body.message) ? body.message : `Ошибка: ${res.status}`; return; }
        const js = await res.json(); if (js && js.ok) { feedback.textContent = 'Задание создано (id: ' + js.id + ')'; renderStats(); form.reset(); updateParamsVisibility(); } else { feedback.textContent = 'Не удалось создать задание'; }
      } catch (err){ feedback.textContent = 'Ошибка сети'; }
    });
  }

}
