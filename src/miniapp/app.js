(function(){
  // helper to query elements
  function $id(id){return document.getElementById(id);} 
  const apiBase = '/api';
  const createClanBtn = $id('create-clan-btn');
  const clanNameInput = $id('clan-name-input');
  const joinClanBtn = $id('join-clan-btn');
  const clanJoinId = $id('clan-join-id');
  const clanInfo = $id('clan-info');
  const startSearchBtn = $id('start-search');
  const joinSearchBtn = $id('join-search');
  const lobbyClanId = $id('lobby-clan-id');
  const lobbyStatus = $id('lobby-status');
  const compMap = $id('competition-map');
  const mapGrid = $id('map-grid');
  const mapStats = $id('map-stats');
  const mapLog = $id('map-log');

  async function createClan(){
    const name = clanNameInput.value && clanNameInput.value.trim();
    if(!name) return alert('Укажите название клана');
    const res = await fetch(apiBase + '/clans', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ name }) });
    const json = await res.json();
    if(!json.ok) return alert(json.message || 'Ошибка создания клана');
    clanInfo.textContent = `Клан создан: ${json.clan.name} (ID: ${json.clan.id})`;
  }

  async function joinClan(){
    const id = parseInt(clanJoinId.value,10);
    if(!id) return alert('Укажите ID клана');
    const res = await fetch(apiBase + '/clans/' + id + '/join', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({}) });
    const json = await res.json();
    if(!json.ok) return alert(json.message || 'О��ибка вступления в клан');
    clanInfo.textContent = `Вы вступили в клан ${id}`;
  }

  async function startSearch(){
    const clanId = parseInt(lobbyClanId.value,10);
    if(!clanId) return alert('Укажите ID клана');
    const res = await fetch(apiBase + '/competitions/start-search', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ clan_id: clanId }) });
    const json = await res.json();
    lobbyStatus.textContent = json.ok ? 'Поиск начат' : ('Ошибка: ' + (json.message||'неизвестно'));
  }

  async function joinSearch(){
    const clanId = parseInt(lobbyClanId.value,10);
    if(!clanId) return alert('Укажите ID клана');
    const res = await fetch(apiBase + '/competitions/join-search', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ clan_id: clanId }) });
    const json = await res.json();
    if(!json.ok) return lobbyStatus.textContent = 'Нет подходящих соперников';
    lobbyStatus.textContent = 'Матч найден, competition id: ' + json.competition_id;
    // show competition map
    loadCompetitionMap(json.competition_id);
  }

  async function loadCompetitionMap(compId){
    compMap.style.display = '';
    mapGrid.innerHTML = '';
    mapLog.textContent = '';
    // fetch status
    const res = await fetch(apiBase + '/competitions/' + compId + '/status');
    const json = await res.json();
    if(!json.ok) return mapLog.textContent = 'Не удалось загрузить карту';
    const comp = json.competition;
    const coins = json.coins || {};
    const available = json.available || {};
    mapStats.innerHTML = `<div>Competition ${comp.id} | ${comp.status} | ${comp.start_at || '—'} → ${comp.end_at || '—'}</div><div>Coins: A(${coins[comp.clan_a]||0}) B(${coins[comp.clan_b]||0})</div>`;
    // fetch buildings for competition
    const bres = await fetch('/api/competitions/' + compId + '/buildings');
    if (bres.ok) {
      const bjson = await bres.json();
      if (bjson.ok && Array.isArray(bjson.buildings)) {
        bjson.buildings.forEach(b => {
          const btn = document.createElement('button');
          btn.className = 'upgrade-btn';
          btn.textContent = `${b.name}\nPrice: ${b.base_price_scube} SCube`;
          btn.style.whiteSpace = 'pre-wrap';
          btn.onclick = async ()=>{
            const clanId = prompt('Введите ID клана, совершающего покупку (leader/co-leader)');
            if(!clanId) return;
            const resp = await fetch('/api/competitions/' + compId + '/buildings/' + b.id + '/purchase', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ clan_id: parseInt(clanId,10) }) });
            const rj = await resp.json();
            if(!rj.ok) return alert(rj.message || 'Ошибка покупки');
            mapLog.textContent = `Здание куплено: ${b.name} за ${rj.price_scube} SCube`;
            // refresh map
            setTimeout(()=> loadCompetitionMap(compId), 800);
          };
          const cell = document.createElement('div');
          cell.appendChild(btn);
          mapGrid.appendChild(cell);
        });
      }
    }
  }

  // bind events
  if (createClanBtn) createClanBtn.addEventListener('click', createClan);
  if (joinClanBtn) joinClanBtn.addEventListener('click', joinClan);
  if (startSearchBtn) startSearchBtn.addEventListener('click', startSearch);
  if (joinSearchBtn) joinSearchBtn.addEventListener('click', joinSearch);

  // Tab switching logic
  const tabButtons = Array.from(document.querySelectorAll('.tab-button'));
  const tabContents = Array.from(document.querySelectorAll('.tab-content'));
  function switchTab(tabName){
    tabButtons.forEach(b=>{ if (b.dataset && b.dataset.tab===tabName) b.classList.add('active'); else b.classList.remove('active'); });
    tabContents.forEach(c=>{ if (c.id===tabName) c.style.display = ''; else c.style.display = 'none'; });
    // hide competition map when switching away
    if (tabName !== 'home'){ if (compMap) compMap.style.display = 'none'; }
    // small visual focus for clan hub
    if (tabName === 'clan'){
      const hub = document.querySelector('.clan-hub');
      if (hub){ hub.style.boxShadow = '0 6px 24px rgba(0,0,0,0.35), 0 0 0 4px rgba(34,139,230,0.08)'; setTimeout(()=>{ hub.style.boxShadow = ''; },2200); }
    }
  }
  // bind tab buttons
  tabButtons.forEach(btn=> btn.addEventListener('click', ()=>{ const t = btn.dataset.tab; if (t) switchTab(t); }));

  // clan floating button opens clan tab
  const clanFab = document.getElementById('clan-fab');
  if (clanFab) {
    clanFab.addEventListener('click', ()=>{
      switchTab('clan');
    });
  }

  // Hide loading overlay when app is ready
  (function hideLoadingWhenReady(){
    const loadingEl = document.getElementById('loading-screen');
    function hide(){ if (!loadingEl) return; loadingEl.classList.add('loading-overlay--hidden'); }
    // Prefer to hide after window load or small timeout fallback
    if (document.readyState === 'complete') { hide(); }
    else { window.addEventListener('load', hide); setTimeout(hide, 1200); }
  })();

})();
