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

  async function renderStats(){
    if (!statsContent) return;
    statsContent.textContent = 'Загрузка…';
    try {
      const res = await fetch(`${apiBase}/admin/stats`);
      if (!res.ok) { statsContent.textContent = 'Не удалось загрузить статистику'; return; }
      const js = await res.json(); if (!js || !js.ok) { statsContent.textContent = 'Ошибка данных'; return; }
      statsContent.innerHTML = `Пользователей: ${js.users} <br>Всего SCube: ${js.total_scube} <br>Всего VP: ${js.total_vp} <br>Всего билетов: ${js.total_tickets} <br>Кастомных заданий: ${js.custom_tasks}`;
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
  if (adminTabStatsBtn) adminTabStatsBtn.addEventListener('click', ()=> toggleSection('stats'));
  if (adminTabCustomBtn) adminTabCustomBtn.addEventListener('click', ()=> toggleSection('custom'));

  if (form) {
    form.addEventListener('submit', async (e)=>{
      e.preventDefault(); if (!isAdmin(getTgid())) { feedback.textContent = 'Доступ запрещён'; return; }
      feedback.textContent = '';
      const name = (document.getElementById('admin-task-name') || {}).value || '';
      const reward_type = (document.getElementById('admin-reward-type') || {}).value || 'scube';
      const reward_amount = Number((document.getElementById('admin-reward-amount') || {}).value || 0);
      const task_type = (document.getElementById('admin-task-type') || {}).value || '';
      const paramsText = (document.getElementById('admin-task-params') || {}).value || '';
      let params = {};
      try { if (paramsText && paramsText.trim()) params = JSON.parse(paramsText); } catch(e){ feedback.textContent = 'Неверный JSON в параметрах'; return; }
      try {
        const res = await fetch(`${apiBase}/admin/custom-tasks`, { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify({ name, reward_type, reward_amount, task_type, params }) });
        if (!res.ok) { const body = await res.json().catch(()=>null); feedback.textContent = (body && body.message) ? body.message : `Ошибка: ${res.status}`; return; }
        const js = await res.json(); if (js && js.ok) { feedback.textContent = 'Задание создано (id: ' + js.id + ')'; renderStats(); form.reset(); } else { feedback.textContent = 'Не удалось создать задание'; }
      } catch (err){ feedback.textContent = 'Ошибка сети'; }
    });
  }

}
