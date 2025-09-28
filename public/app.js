(() => {
  const tg = window.Telegram && window.Telegram.WebApp ? window.Telegram.WebApp : null;
  if (tg) tg.expand();

  const els = {
    avatar: document.getElementById('avatar'),
    scube: document.getElementById('scube'),
    gcube: document.getElementById('gcube'),
    energy: document.getElementById('energy'),
    capacity: document.getElementById('capacity'),
    energyFill: document.getElementById('energyFill'),
    dailyUsed: document.getElementById('dailyUsed'),
    dailyLimit: document.getElementById('dailyLimit'),
    goldCube: document.getElementById('goldCube'),
    tapHint: document.getElementById('tapHint'),
    exchangeAmount: document.getElementById('exchangeAmount'),
    exchangeBtn: document.getElementById('exchangeBtn'),
    upgradeCapacity: document.getElementById('upgradeCapacity'),
    upgradeDaily: document.getElementById('upgradeDaily'),
    limitCost: document.getElementById('limitCost'),
    tabBtns: document.querySelectorAll('.tab-btn'),
    tabHome: document.getElementById('tab-home'),
    tabShop: document.getElementById('tab-shop'),
  };

  function currentInitData() {
    return tg ? tg.initData : '';
  }

  function showToast(text) {
    if (tg && tg.showPopup) {
      tg.showPopup({ title: 'GC Farm', message: text, buttons: [{ type: 'ok' }] });
    } else {
      console.log(text);
    }
  }

  function updateUI(user) {
    els.scube.textContent = user.scube;
    els.gcube.textContent = user.gcube;
    els.energy.textContent = user.energy;
    els.capacity.textContent = user.energy_capacity;
    els.dailyUsed.textContent = user.daily_used_today;
    els.dailyLimit.textContent = user.daily_limit;
    const pct = user.energy_capacity > 0 ? Math.round((user.energy / user.energy_capacity) * 100) : 0;
    els.energyFill.style.width = pct + '%';
    const costDaily = 90 + (user.limit_level * 10);
    els.limitCost.textContent = costDaily + ' SCube';
  }

  function setAvatar(url, fallbackName) {
    if (url) {
      els.avatar.src = url;
      return;
    }
    // Generate placeholder with initials
    const initials = (fallbackName || 'U').trim().split(/\s+/).map(s => s[0]).join('').slice(0,2).toUpperCase();
    const svg = `<svg xmlns='http://www.w3.org/2000/svg' width='80' height='80'>
      <rect width='100%' height='100%' fill='#9aa5b1'/>
      <text x='50%' y='50%' dominant-baseline='middle' text-anchor='middle' font-family='sans-serif' font-size='32' fill='#fff'>${initials}</text>
    </svg>`;
    els.avatar.src = 'data:image/svg+xml;base64,' + btoa(svg);
  }

  async function initUser() {
    const initData = currentInitData();
    const unsafe = tg ? tg.initDataUnsafe : {};
    const body = {
      initData,
      avatar_url: unsafe?.user?.photo_url || null,
      username: unsafe?.user?.username || null,
      first_name: unsafe?.user?.first_name || null,
      last_name: unsafe?.user?.last_name || null,
    };
    const res = await fetch('/api/init', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const data = await res.json();
    if (!data.ok) throw new Error(data.error || 'init_failed');
    const user = data.user;
    const name = [user.first_name, user.last_name].filter(Boolean).join(' ');
    setAvatar(unsafe?.user?.photo_url || null, name);
    updateUI(user);
  }

  async function refreshState() {
    const params = new URLSearchParams({ initData: currentInitData() });
    const res = await fetch('/api/state?' + params.toString());
    const data = await res.json();
    if (data && data.ok) updateUI(data.user);
  }

  async function tapCube() {
    const res = await fetch('/api/click', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ initData: currentInitData() }) });
    const data = await res.json();
    if (!res.ok) {
      if (data.error === 'not_enough_energy') return showToast('Недостаточно энергии');
      if (data.error === 'daily_limit_reached') return showToast('Дневной лимит достигн��т');
      return showToast('Ошибка');
    }
    updateUI(data.user);
    els.tapHint.classList.remove('show');
    // animate hint
    void els.tapHint.offsetWidth; // reflow
    els.tapHint.classList.add('show');
  }

  async function exchange() {
    const amount = Math.max(0, Math.floor(Number(els.exchangeAmount.value || 0)));
    if (!amount) return showToast('Введите количество');
    const res = await fetch('/api/exchange', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ initData: currentInitData(), amount }) });
    const data = await res.json();
    if (!res.ok) {
      if (data.error === 'not_enough_scube') return showToast('Недостаточно SCube');
      return showToast('Ошибка');
    }
    els.exchangeAmount.value = '';
    updateUI(data.user);
  }

  async function upgradeCapacity() {
    const res = await fetch('/api/upgrade/capacity', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ initData: currentInitData() }) });
    const data = await res.json();
    if (!res.ok) {
      if (data.error === 'not_enough_scube') return showToast('Недостаточно SCube');
      return showToast('Ошибка');
    }
    updateUI(data.user);
  }

  async function upgradeDaily() {
    const res = await fetch('/api/upgrade/daily', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ initData: currentInitData() }) });
    const data = await res.json();
    if (!res.ok) {
      if (data.error === 'not_enough_scube') return showToast('Недостаточно SCube');
      return showToast('Ошибка');
    }
    updateUI(data.user);
  }

  function switchTab(tab) {
    document.querySelectorAll('.tab-view').forEach(el => el.classList.remove('active'));
    document.getElementById('tab-' + tab).classList.add('active');
    els.tabBtns.forEach(b => b.classList.toggle('active', b.dataset.tab === tab));
  }

  els.goldCube.addEventListener('click', tapCube);
  els.exchangeBtn.addEventListener('click', exchange);
  els.upgradeCapacity.addEventListener('click', upgradeCapacity);
  els.upgradeDaily.addEventListener('click', upgradeDaily);
  els.tabBtns.forEach(btn => btn.addEventListener('click', () => switchTab(btn.dataset.tab)));

  initUser().catch(() => setAvatar(null, 'Player'));
  setInterval(refreshState, 4000);
})();
