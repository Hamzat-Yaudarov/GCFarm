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
  const dailyEl = document.getElementById('daily');
  const avatarEl = document.getElementById('avatar');
  const golden = document.getElementById('golden-cube');

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
    dailyEl.textContent = user.daily_count;
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
  });

  loadUser();
})();
