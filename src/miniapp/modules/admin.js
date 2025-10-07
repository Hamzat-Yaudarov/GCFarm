import { getTgid } from './state.js';

const ADMINS = new Set([6910097562, 7972065986]);

function el(id){ return document.getElementById(id); }

export function initAdmin(){
  const adminBtn = el('admin-tab-button');
  const adminPanel = el('admin-panel');
  const adminBack = el('admin-back');
  const tabStatsBtn = el('admin-tab-stats');
  const tabTasksBtn = el('admin-tab-tasks');
  const statsArea = el('admin-stats-area');
  const tasksList = el('admin-tasks-list');
  const createBtn = el('admin-create-task');
  const createResult = el('admin-create-result');

  function showPanel(){ adminPanel.classList.remove('hidden'); }
  function hidePanel(){ adminPanel.classList.add('hidden'); }
  function showTab(tab){
    if (tab === 'stats'){
      el('admin-tab-content-stats').classList.remove('hidden');
      el('admin-tab-content-tasks').classList.add('hidden');
    } else {
      el('admin-tab-content-stats').classList.add('hidden');
      el('admin-tab-content-tasks').classList.remove('hidden');
    }
  }

  async function loadStats(){
    statsArea.textContent = 'Загрузка…';
    try {
      const res = await fetch('/api/admin/stats');
      if (!res.ok) { statsArea.textContent = 'Ошибка доступа'; return; }
      const js = await res.json();
      if (!js.ok) { statsArea.textContent = 'Ошибка: ' + (js.message || 'unknown'); return; }
      statsArea.innerHTML = `<div>Пользователей: ${js.users.total}</div><div>SCube всего: ${js.users.scube}</div><div>VP всего: ${js.users.vp}</div><div>Билетов всего: ${js.users.tickets}</div><div>Заданий: ${js.tasks}</div>`;
    } catch(e){ statsArea.textContent = 'Ошибка при запросе'; }
  }

  async function loadTasks(){
    tasksList.textContent = 'Загрузка…';
    try {
      const res = await fetch('/api/admin/tasks');
      if (!res.ok) { tasksList.textContent = 'Ошибка доступа'; return; }
      const js = await res.json();
      if (!js.ok) { tasksList.textContent = 'Ошибка: ' + (js.message || 'unknown'); return; }
      if (!Array.isArray(js.tasks) || js.tasks.length === 0) { tasksList.textContent = 'Нет заданий'; return; }
      tasksList.innerHTML = '';
      js.tasks.forEach(t => {
        const div = document.createElement('div');
        div.className = 'admin-task-row';
        div.innerHTML = `<strong>${t.name}</strong> — ${t.task_type} — ${t.reward_amount} ${t.reward_type} <div class="admin-task-params">${JSON.stringify(t.params || {})}</div>`;
        tasksList.appendChild(div);
      });
    } catch(e){ tasksList.textContent = 'Ошибка при запросе'; }
  }

  async function createTask(){
    createResult.textContent = '';
    const name = (el('admin-task-name')||{}).value || '';
    const task_type = (el('admin-task-type')||{}).value || '';
    const reward_type = (el('admin-reward-type')||{}).value || '';
    const reward_amount = parseInt((el('admin-reward-amount')||{}).value || '0', 10) || 0;
    let params = {};
    const paramsText = (el('admin-task-params')||{}).value || '';
    if (paramsText && paramsText.trim()){
      try { params = JSON.parse(paramsText); } catch(e){ createResult.textContent = 'Неверный JSON в параметрах'; return; }
    }
    try {
      const res = await fetch('/api/admin/tasks', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ name, task_type, reward_type, reward_amount, params }) });
      const js = await res.json().catch(()=>null);
      if (!res.ok || !js || !js.ok) { createResult.textContent = 'Ошибка создания: ' + (js && js.message ? js.message : res.status); return; }
      createResult.textContent = 'Создано: ' + (js.id || 'OK');
      await loadTasks();
    } catch(e){ createResult.textContent = 'Ошибка сети'; }
  }

  // Show admin button if tgid is in admin set
  try {
    const tgid = getTgid();
    if (tgid && ADMINS.has(Number(tgid))) {
      adminBtn.classList.remove('hidden');
      adminBtn.addEventListener('click', ()=>{ showPanel(); showTab('stats'); loadStats(); loadTasks(); });
    }
  } catch(e){}

  adminBack && adminBack.addEventListener && adminBack.addEventListener('click', ()=>{ hidePanel(); });
  tabStatsBtn && tabStatsBtn.addEventListener && tabStatsBtn.addEventListener('click', ()=>{ showTab('stats'); loadStats(); });
  tabTasksBtn && tabTasksBtn.addEventListener && tabTasksBtn.addEventListener('click', ()=>{ showTab('tasks'); loadTasks(); });
  createBtn && createBtn.addEventListener && createBtn.addEventListener('click', createTask);
}
