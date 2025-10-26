import { apiBase } from './state.js';
import { SoundManager } from './utils.js';

export function showStoreFeedback(msg){ const el = document.getElementById('store-feedback'); if (!el) return; el.textContent = msg; setTimeout(()=>{ if (el) el.textContent=''; }, 3000); }

export function initUpgrades(getTgid, onAfterPurchase){
  const dailyLevelEl = document.getElementById('daily-level');
  const upgradeBtns = document.querySelectorAll('.upgrade-btn');
  async function showConfirm(message){
    const confirmModal = document.getElementById('confirm-modal');
    const confirmMessage = document.getElementById('confirm-message');
    const confirmOk = document.getElementById('confirm-ok');
    const confirmCancel = document.getElementById('confirm-cancel');
    if (!confirmModal) return Promise.resolve(false);
    return new Promise((resolve)=>{
      confirmMessage.textContent = message; confirmModal.classList.remove('hidden');
      function cleanup(){ confirmModal.classList.add('hidden'); confirmOk.removeEventListener('click', onOk); confirmCancel.removeEventListener('click', onCancel); }
      function onOk(){ cleanup(); resolve(true); }
      function onCancel(){ cleanup(); resolve(false); }
      confirmOk.addEventListener('click', onOk); confirmCancel.addEventListener('click', onCancel);
    });
  }
  upgradeBtns.forEach(btn=>{
    btn.addEventListener('click', async ()=>{
      try { SoundManager.click(); } catch(e){}
      const type = btn.dataset.type; const tgid = getTgid(); if (!tgid) return alert('tgid is required');
      const confirmed = await showConfirm('Подтвердите покупку: ' + (type === 'energy_capacity' ? 'Увеличение вместимости энергии (+25) за 100 SCube' : 'Увеличение дневного лимита (+50) за рассчитанную стоимость'));
      if (!confirmed) return showStoreFeedback('Покупка отменена');
      const res = await fetch(`${apiBase}/user/${tgid}/buy-upgrade`, { method: 'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ type }) });
      const json = await res.json();
      if (!json.ok) { try { SoundManager.error(); } catch(e){} return showStoreFeedback(json.message || 'Ошибка покупки'); }
      try { SoundManager.purchase(); } catch(e){}
      showStoreFeedback('Покупка успешна');
      if (typeof onAfterPurchase === 'function') onAfterPurchase();
    });
  });
}

export function initWithdrawals(getTgid, onAfterSubmit){
  const openWithdrawalsBtn = document.getElementById('open-withdrawals');
  const withdrawBackBtn = document.getElementById('withdraw-back-to-store');
  const withdrawMethodsContainer = document.getElementById('withdraw-methods');
  const withdrawFeedbackEl = document.getElementById('withdraw-feedback');
  const withdrawModal = document.getElementById('withdraw-modal');
  const withdrawModalTitle = document.getElementById('withdraw-modal-title');
  const withdrawModalHint = document.getElementById('withdraw-modal-hint');
  const withdrawOptionsEl = document.getElementById('withdraw-options');
  const withdrawInputsEl = document.getElementById('withdraw-inputs');
  const withdrawNotesEl = document.getElementById('withdraw-notes');
  const withdrawModalFeedback = document.getElementById('withdraw-modal-feedback');
  const withdrawModalClose = document.getElementById('withdraw-modal-close');
  const withdrawForm = document.getElementById('withdraw-form');

  function setWithdrawFeedback(message, tone = 'info') {
    if (!withdrawFeedbackEl) return;
    ['success', 'error', 'warning'].forEach(t => withdrawFeedbackEl.classList.remove(`withdraw-feedback--${t}`));
    withdrawFeedbackEl.textContent = message || '';
    if (message && tone && tone !== 'info') withdrawFeedbackEl.classList.add(`withdraw-feedback--${tone}`);
    if (message) setTimeout(()=>{ ['success','error','warning'].forEach(t=> withdrawFeedbackEl.classList.remove(`withdraw-feedback--${t}`)); withdrawFeedbackEl.textContent=''; }, 4000);
  }
  function setWithdrawModalFeedback(message, tone = 'error') {
    if (!withdrawModalFeedback) return;
    ['success', 'warning'].forEach(t => withdrawModalFeedback.classList.remove(`withdraw-modal-feedback--${t}`));
    withdrawModalFeedback.textContent = message || '';
    if (message && tone === 'success') withdrawModalFeedback.classList.add('withdraw-modal-feedback--success');
    if (message && tone === 'warning') withdrawModalFeedback.classList.add('withdraw-modal-feedback--warning');
  }
  const buildWithdrawOption = (id, payoutLabel, baseCost, commission, extraNote) => ({ id, payoutLabel, baseCost, commission, totalCost: baseCost + commission, extraNote: extraNote || null });
  const WITHDRAW_METHODS = {
    stars: { key: 'stars', title: 'Вывод как Telegram-звёзды', hint: 'Выберите нужный набор звёзд. Комиссия — 5 SCube на каждые 100 SCube. Укажите ник пользователя Telegram, на который будут отправлены звёзды.', options: [ buildWithdrawOption('stars-15','15 Stars',1170,59,'Выплата: 15 Stars'), buildWithdrawOption('stars-25','25 Stars',1950,98,'Выплата: 25 Stars'), buildWithdrawOption('stars-50','50 Stars',3900,195,'Выплата: 50 Stars'), buildWithdrawOption('stars-100','100 Stars',7800,390,'Выплата: 100 Stars') ], fields: [ { id:'telegramUsername', label:'Ник в Telegram', type:'text', placeholder:'Например, username или @username', required:true, minLength:3 } ] },
    gcubes: { key: 'gcubes', title: 'Вывод как GCubes', hint: 'Укажите ID и ник из Blockman Go. Комиссия фиксированная — 50 SCube.', options: [ buildWithdrawOption('gcubes-60','60 GCubes',3900,65,'Выплата: 60 GCubes'), buildWithdrawOption('gcubes-300','300 GCubes',19500,65,'Выплата: 300 GCubes'), buildWithdrawOption('gcubes-600','600 GCubes',39000,65,'Выплата: 600 GCubes') ], fields: [ { id:'blockmanId', label:'ID в Blockman Go', type:'text', placeholder:'Например, 123456789', required:true, minLength:3 }, { id:'blockmanNickname', label:'Ник в Blockman Go', type:'text', placeholder:'Введите ник', required:true, minLength:3 } ] },
    rub: { key:'rub', title:'Вывод в рублях', hint:'Перевод на номер телефона. Комиссия — 50 SCube на каждые 100 ₽.', options:[ buildWithdrawOption('rub-200','200 ₽',9880,130,'Перевод: 200 ₽'), buildWithdrawOption('rub-500','500 ₽',24700,325,'Перевод: 500 ₽'), buildWithdrawOption('rub-750','750 ₽',37050,488,'Перевод: 750 ₽'), buildWithdrawOption('rub-1000','1000 ₽',49400,650,'Перевод: 1000 ₽'), buildWithdrawOption('rub-1500','1500 ₽',74100,975,'Перевод: 1500 ₽'), buildWithdrawOption('rub-2000','2000 ₽',98800,1300,'Перевод: 2000 ₽') ], fields:[ { id:'payoutPhone', label:'Номер для перевода', type:'tel', placeholder:'+7XXXXXXXXXX', required:true, minLength:7 } ] }
  };

  function highlightWithdrawOption(selectedId){ if (!withdrawOptionsEl) return; const cards = withdrawOptionsEl.querySelectorAll('.withdraw-option-card'); cards.forEach(card=>{ const input = card.querySelector('.withdraw-option-input'); if (input && input.value === selectedId && input.checked) card.classList.add('selected'); else card.classList.remove('selected'); }); }
  function renderWithdrawOptions(method){ if (!withdrawOptionsEl) return null; withdrawOptionsEl.innerHTML=''; let defaultId=null; method.options.forEach((option,index)=>{ const label = document.createElement('label'); label.className='withdraw-option-card'; const input = document.createElement('input'); input.type='radio'; input.name='withdraw-option'; input.value=option.id; input.className='withdraw-option-input'; if (index===0){ input.checked=true; defaultId=option.id; } const body = document.createElement('div'); body.className='withdraw-option-body'; const header=document.createElement('div'); header.className='withdraw-option-header'; const title=document.createElement('span'); title.className='withdraw-option-title'; title.textContent=option.payoutLabel; const total=document.createElement('span'); total.className='withdraw-option-total'; total.textContent=`Списываем: ${option.totalCost} SCube`; header.append(title,total); const breakdown=document.createElement('p'); breakdown.className='withdraw-option-note'; breakdown.textContent=`Стоимость: ${option.baseCost} SCube • Комиссия: ${option.commission} SCube`; body.append(header, breakdown); if (option.extraNote){ const extra=document.createElement('p'); extra.className='withdraw-option-footnote'; extra.textContent=option.extraNote; body.appendChild(extra);} label.append(input, body); withdrawOptionsEl.appendChild(label); }); highlightWithdrawOption(defaultId); return defaultId; }
  function renderWithdrawInputs(method){ if (!withdrawInputsEl) return; withdrawInputsEl.innerHTML=''; (method.fields||[]).forEach(field=>{ const group=document.createElement('label'); group.className='withdraw-input-group'; const caption=document.createElement('span'); caption.className='withdraw-input-label'; caption.textContent=field.label; const input = field.type==='textarea'? document.createElement('textarea') : document.createElement('input'); input.className = field.type==='textarea' ? 'withdraw-textarea' : 'withdraw-input'; if (field.type && field.type !== 'textarea') input.type=field.type; input.name=field.id; if (field.placeholder) input.placeholder=field.placeholder; if (field.maxLength) input.maxLength=field.maxLength; group.append(caption, input); withdrawInputsEl.appendChild(group); }); }
  function openWithdrawModal(methodKey){ if (!withdrawModal || !WITHDRAW_METHODS[methodKey]) return; const method = WITHDRAW_METHODS[methodKey]; if (withdrawForm) withdrawForm.reset(); renderWithdrawOptions(method); renderWithdrawInputs(method); if (withdrawNotesEl) withdrawNotesEl.value=''; if (withdrawModalTitle) withdrawModalTitle.textContent = method.title; if (withdrawModalHint) withdrawModalHint.textContent = method.hint; if (withdrawForm) withdrawForm.dataset.method = methodKey; setWithdrawModalFeedback(''); withdrawModal.classList.remove('hidden'); withdrawModal.setAttribute('aria-hidden','false'); }
  function closeWithdrawModal(){ if (!withdrawModal) return; withdrawModal.classList.add('hidden'); withdrawModal.setAttribute('aria-hidden','true'); if (withdrawForm) { withdrawForm.dataset.method=''; withdrawForm.reset(); } if (withdrawOptionsEl) withdrawOptionsEl.innerHTML=''; if (withdrawInputsEl) withdrawInputsEl.innerHTML=''; if (withdrawNotesEl) withdrawNotesEl.value=''; setWithdrawModalFeedback(''); }

  if (openWithdrawalsBtn) openWithdrawalsBtn.addEventListener('click', ()=>{ const { showTab } = window.__appTabs || {}; if (showTab) showTab('withdrawals'); setWithdrawFeedback('', 'info'); });
  if (withdrawBackBtn) withdrawBackBtn.addEventListener('click', ()=>{ const { showTab } = window.__appTabs || {}; if (showTab) showTab('store'); });
  if (withdrawModalClose) withdrawModalClose.addEventListener('click', closeWithdrawModal);
  if (withdrawModal) withdrawModal.addEventListener('click', (event)=>{ if (event.target === withdrawModal) closeWithdrawModal(); });
  if (withdrawMethodsContainer) withdrawMethodsContainer.addEventListener('click', (event)=>{ const trigger = event.target.closest('.withdraw-method-button'); if (!trigger) return; const methodKey = trigger.dataset.method; if (!methodKey) return; openWithdrawModal(methodKey); });
  if (withdrawOptionsEl) withdrawOptionsEl.addEventListener('change', (event)=>{ if (event.target && event.target.classList.contains('withdraw-option-input')) highlightWithdrawOption(event.target.value); });
  document.addEventListener('keydown', (event)=>{ if (event.key === 'Escape' && withdrawModal && !withdrawModal.classList.contains('hidden')) { event.preventDefault(); closeWithdrawModal(); } });

  if (withdrawForm) {
    let submitting = false;
    withdrawForm.addEventListener('submit', async (event)=>{
      event.preventDefault();
      if (submitting) return;
      const tgid = getTgid(); if (!tgid) { setWithdrawModalFeedback('Перезапустите игру через бота, чтобы авторизоваться.', 'error'); return; }
      const methodKey = withdrawForm.dataset.method; const selected = withdrawOptionsEl ? withdrawOptionsEl.querySelector('.withdraw-option-input:checked') : null; if (!methodKey) { setWithdrawModalFeedback('Выберите способ вывода.', 'error'); return; } if (!selected) { setWithdrawModalFeedback('Выберите вариант вывода.', 'error'); return; }
      const optionId = selected.value; const details = {}; let validationFailed = false; const method = Object.values(WITHDRAW_METHODS).find(m=> m.key===methodKey);
      if (Array.isArray(method.fields)) { method.fields.forEach(field=>{ if (validationFailed) return; const input = withdrawInputsEl ? withdrawInputsEl.querySelector(`[name="${field.id}"]`) : null; const value = (input && input.value ? String(input.value) : '').trim(); if (field.required && !value) { setWithdrawModalFeedback(`Заполните поле «${field.label}».`, 'error'); if (input) input.focus(); validationFailed = true; return; } if (field.minLength && value.length < field.minLength) { setWithdrawModalFeedback(`Поле «${field.label}» должно содержать не менее ${field.minLength} символов.`, 'error'); if (input) input.focus(); validationFailed = true; return; } details[field.id] = value; }); }
      if (validationFailed) return; const note = withdrawNotesEl ? withdrawNotesEl.value.trim() : '';
      submitting = true; setWithdrawModalFeedback('Отправляем заявку...', 'warning'); const submitBtn = withdrawForm.querySelector('.withdraw-submit-btn'); if (submitBtn) submitBtn.disabled = true;
      try {
        const res = await fetch(`${apiBase}/withdrawals`, { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ method: methodKey, optionId, note, details }) });
        const json = await res.json().catch(()=>({}));
        if (!res.ok || (json && json.ok === false)) { const message = (json && (json.message || json.error)) || 'Не удалось отправить заявку. Попробуйте позже.'; setWithdrawModalFeedback(message, 'error'); }
        else { closeWithdrawModal(); const message = (json && json.message) || 'Заявка на вывод отправлена. Ожидайте подтверждения.'; setWithdrawFeedback(message, 'success'); if (json && json.warning) { setWithdrawFeedback(json.warning, 'warning'); } if (typeof onAfterSubmit === 'function') onAfterSubmit(); }
      } catch(err){ console.warn('withdraw submit failed', err); setWithdrawModalFeedback('Ошибка соединения. Попробуйте позже.', 'error'); }
      finally { submitting=false; if (submitBtn) submitBtn.disabled=false; }
    });
  }
}
