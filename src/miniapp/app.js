(function(){
  function qs(name){
    const url = new URL(window.location.href);
    return url.searchParams.get(name);
  }
  const tgid = qs('tgid');
  const apiBase = '/api';

  const scubeEl = document.getElementById('scube');
  const gcubeEl = document.getElementById('gcube');
  const energyEl = document.getElementById('energy');
  const energyCapEl = document.getElementById('energy-capacity');
  const dailyEl = document.getElementById('daily');
  const dailyLimitEl = document.getElementById('daily-limit');
  const dailyLevelEl = document.getElementById('daily-level');
  const dailyCostEl = document.getElementById('daily-cost');
  const avatarEl = document.getElementById('avatar');
  const golden = document.getElementById('golden-cube');

  const watchAdBtn = document.getElementById('watch-ad');
  const scubeToGBtn = document.getElementById('scube-to-gcube');
  const gcubeToSBtn = document.getElementById('gcube-to-scube');
  const upgradeBtns = document.querySelectorAll('.upgrade-btn');
  const storeFeedback = document.getElementById('store-feedback');

  const tabs = document.querySelectorAll('.tab-button');
  const contents = document.querySelectorAll('.tab-content');

  tabs.forEach(btn=>{
    btn.addEventListener('click', ()=>{
      tabs.forEach(b=>b.classList.remove('active'));
      btn.classList.add('active');
      const tab = btn.dataset.tab;
      contents.forEach(c=>{
        if (c.id===tab) c.classList.remove('hidden'); else c.classList.add('hidden');
      });
    });
  });

  async function loadUser(){
    if (!tgid) return alert('tgid is required');
    const res = await fetch(`${apiBase}/user/${tgid}`);
    if (!res.ok) return alert('Failed to load user');
    const user = await res.json();
    scubeEl.textContent = user.scube;
    gcubeEl.textContent = user.gcube;
    energyEl.textContent = user.energy;
    energyCapEl.textContent = user.energy_capacity;
    dailyEl.textContent = user.daily_count;
    dailyLevelEl.textContent = user.daily_limit_level;
    dailyLimitEl.textContent = (250 + user.daily_limit_level * 50);
    dailyCostEl.textContent = (90 + user.daily_limit_level * 10);
    avatarEl.textContent = (user.name && user.name[0]) || 'A';
  }

  golden.addEventListener('click', async ()=>{
    if (!tgid) return alert('tgid is required');
    const res = await fetch(`${apiBase}/user/${tgid}/click`, { method: 'POST' });
    const json = await res.json();
    if (!json.ok) return alert(json.message || 'Action failed');
    scubeEl.textContent = json.scube;
    energyEl.textContent = json.energy;
    dailyEl.textContent = json.daily_count;
    dailyLimitEl.textContent = json.daily_limit || dailyLimitEl.textContent;
  });

  watchAdBtn.addEventListener('click', ()=>{
    if (!tgid) return alert('tgid is required');
    // Open reward landing (integrate AdsGram here)
    const url = `/reward?tgid=${tgid}`;
    window.open(url, '_blank');
  });

  scubeToGBtn.addEventListener('click', async ()=>{
    if (!tgid) return alert('tgid is required');
    const res = await fetch(`${apiBase}/user/${tgid}/exchange`, { method: 'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ direction: 'scube_to_gcube', units: 1 }) });
    const json = await res.json();
    if (!json.ok) return showStoreFeedback(json.message || 'Ошибка');
    scubeEl.textContent = json.scube;
    gcubeEl.textContent = json.gcube;
    showStoreFeedback('Обмен выполнен');
  });

  gcubeToSBtn.addEventListener('click', async ()=>{
    if (!tgid) return alert('tgid is required');
    const res = await fetch(`${apiBase}/user/${tgid}/exchange`, { method: 'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ direction: 'gcube_to_scube', units: 1 }) });
    const json = await res.json();
    if (!json.ok) return showStoreFeedback(json.message || 'Ошибка');
    scubeEl.textContent = json.scube;
    gcubeEl.textContent = json.gcube;
    showStoreFeedback('Обмен выполнен');
  });

  upgradeBtns.forEach(btn=>{
    btn.addEventListener('click', async ()=>{
      const type = btn.dataset.type;
      if (!tgid) return alert('tgid is required');
      const res = await fetch(`${apiBase}/user/${tgid}/buy-upgrade`, { method: 'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ type }) });
      const json = await res.json();
      if (!json.ok) return showStoreFeedback(json.message || 'Ошибка покупки');
      await loadUser();
      showStoreFeedback('Покупка успешна');
    });
  });

  function showStoreFeedback(msg){
    storeFeedback.textContent = msg;
    setTimeout(()=>{ storeFeedback.textContent = ''; }, 3000);
  }

  // Periodically refresh user data
  setInterval(loadUser, 5000);
  loadUser();
})();
