const tg = window.Telegram?.WebApp;
if (tg) {
  tg.expand();
  tg.MainButton.hide();
}

const $ = (sel) => document.querySelector(sel);
const tabs = {
  home: $('#tab-home'),
  shop: $('#tab-shop')
};

function switchTab(name) {
  document.querySelectorAll('.tab').forEach(el => el.classList.remove('active'));
  document.querySelectorAll('.tab-btn').forEach(el => el.classList.remove('active'));
  tabs[name].classList.add('active');
  document.querySelector(`.tab-btn[data-tab="${name}"]`).classList.add('active');
}

document.querySelectorAll('.tab-btn').forEach(btn => btn.addEventListener('click', () => switchTab(btn.dataset.tab)));

const state = {
  user: null
};

function getInitData() {
  return tg?.initData || new URLSearchParams(location.search).get('initData') || '';
}

async function api(path, body) {
  const initData = getInitData();
  const res = await fetch(`/api${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-init-data': initData },
    body: JSON.stringify(body || {})
  });
  if (res.status === 401) throw new Error('unauthorized');
  return res.json();
}

async function fetchState() {
  const initData = getInitData();
  const res = await fetch(`/api/state?initData=${encodeURIComponent(initData)}`);
  if (!res.ok) throw new Error('state failed');
  const data = await res.json();
  state.user = data.user;
  render();
}

function render() {
  if (!state.user) return;
  $('#scube').textContent = state.user.scube;
  $('#gcube').textContent = state.user.gcube;
  $('#energy').textContent = state.user.energy_current;
  $('#capacity').textContent = state.user.energy_capacity;
  $('#daily').textContent = state.user.daily_collected;
  $('#dailyLimit').textContent = state.user.daily_limit;
  const limitCost = 90 + (state.user.limit_level || 0) * 10;
  $('#limit-cost').textContent = String(limitCost);

  const avatar = $('#avatar');
  if (state.user.photo_url) {
    avatar.src = state.user.photo_url;
  } else {
    avatar.src = 'data:image/svg+xml;utf8,' + encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64"><rect width="100%" height="100%" fill="#e3e7ef"/><text x="50%" y="50%" dominant-baseline="middle" text-anchor="middle" font-family="Arial" font-size="24" fill="#7b849a">👤</text></svg>`);
  }
}

$('#gold-cube').addEventListener('click', async () => {
  const res = await api('/tap');
  if (!res.ok) {
    if (res.reason === 'no_energy') toast('Нет энергии');
    else if (res.reason === 'daily_limit') toast('Дневной лимит достигнут');
  }
  state.user = res.user || state.user;
  render();
});

$('#exchange-btn').addEventListener('click', async () => {
  const amount = Math.max(1, Math.floor(Number($('#exchange-amount').value || 0)));
  const res = await api('/exchange', { amount });
  if (!res.ok) {
    if (res.error === 'not_enough_scube') toast('Недостаточно SCube');
    return;
  }
  state.user = res.user;
  render();
});

$('#upgrade-capacity').addEventListener('click', async () => {
  const res = await api('/upgrade/capacity');
  if (!res.ok) { toast('Не хватает SCube'); return; }
  state.user = res.user;
  render();
});

$('#upgrade-limit').addEventListener('click', async () => {
  const res = await api('/upgrade/daily_limit');
  if (!res.ok) { toast(`Не хватает SCube (нужно ${res.cost})`); return; }
  state.user = res.user;
  render();
});

function toast(text) {
  const el = document.createElement('div');
  el.className = 'toast';
  el.textContent = text;
  document.body.appendChild(el);
  setTimeout(() => { el.classList.add('show'); }, 10);
  setTimeout(() => { el.classList.remove('show'); el.remove(); }, 2000);
}

// energy regen ticker (client-side visual aid; server is the source of truth)
setInterval(() => {
  if (!state.user) return;
  if (state.user.energy_current < state.user.energy_capacity) {
    state.user.energy_last_ts = state.user.energy_last_ts || Date.now();
    const elapsed = Date.now() - state.user.energy_last_ts;
    if (elapsed >= 4000) {
      const gain = Math.floor(elapsed / 4000);
      state.user.energy_current = Math.min(state.user.energy_capacity, state.user.energy_current + gain);
      state.user.energy_last_ts = Date.now() - (elapsed % 4000);
      render();
    }
  }
}, 1000);

// AdsGram rewarded ad (optional)
$('#watch-ad').addEventListener('click', async () => {
  try {
    if (window.Adsgram) {
      window.Adsgram.show({ type: 'rewarded' }, async (result) => {
        if (result === 'reward') {
          toast('Награда за рекламу');
          await fetch('/reward', { method: 'POST', headers: { 'x-init-data': getInitData() } });
          await fetchState();
        }
      });
    } else {
      toast('Реклама недоступна');
    }
  } catch (e) {
    toast('Ошибка показа рекламы');
  }
});

fetchState().catch(() => toast('Ошибка авторизации'));
