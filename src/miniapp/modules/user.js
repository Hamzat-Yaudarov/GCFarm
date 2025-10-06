import { apiBase, BOT_USERNAME, BOT_WEBAPP_PATH, BASE_URL } from './state.js';

let autoTickInterval = null;

export function startAutoTick(getTgid){ if (autoTickInterval) return; autoTickInterval = setInterval(async ()=>{ try { const tgid = getTgid(); const res = await fetch(`${apiBase}/user/${tgid}/auto-tick`, { method: 'POST' }); if (res.ok) { const json = await res.json(); if (json.ok) { const energyEl = document.getElementById('energy'); if (energyEl) energyEl.textContent = json.energy; } } } catch(e){ console.warn('auto tick failed', e); } }, 10000); }
export function stopAutoTick(){ if (autoTickInterval) { clearInterval(autoTickInterval); autoTickInterval = null; } }

export async function loadUser(getTgid, { onInitialReady } = {}){
  const tgid = getTgid();
  const appMessage = document.getElementById('app-message');
  const scubeEl = document.getElementById('scube');
  const energyEl = document.getElementById('energy');
  const energyCapEl = document.getElementById('energy-capacity');
  const dailyEl = document.getElementById('daily');
  const dailyLimitEl = document.getElementById('daily-limit');
  const dailyLevelEl = document.getElementById('daily-level');
  const dailyCostEl = document.getElementById('daily-cost');
  const avatarEl = document.getElementById('avatar');

  if (!tgid){ if (appMessage) appMessage.textContent = 'Откройте игру через кнопку в боте (нажмите /start и затем "Открыть игру").'; return; }
  try { const res = await fetch(`${apiBase}/user/${tgid}`); if (!res.ok) { let body=null; try { body = await res.json(); } catch(e){} const msg=(body && (body.error || body.message)) || `Server returned ${res.status}`; if (appMessage) appMessage.textContent = 'Не удалось загрузить данные пользователя: ' + msg; return; }
    const user = await res.json(); if (appMessage) appMessage.textContent='';
    if (scubeEl) scubeEl.textContent = user.scube; if (energyEl) energyEl.textContent = user.energy; if (energyCapEl) energyCapEl.textContent = user.energy_capacity; if (dailyEl) dailyEl.textContent = user.daily_count; if (dailyLevelEl) dailyLevelEl.textContent = user.daily_limit_level; if (dailyLimitEl) dailyLimitEl.textContent = (400 + user.daily_limit_level * 50); if (dailyCostEl) dailyCostEl.textContent = (90 + user.daily_limit_level * 10);
    try { const tgUser = (window.Telegram && window.Telegram.WebApp && window.Telegram.WebApp.initDataUnsafe && window.Telegram.WebApp.initDataUnsafe.user) || null; const photo = tgUser && tgUser.photo_url ? tgUser.photo_url : null; if (photo) { avatarEl.textContent=''; avatarEl.style.backgroundImage = `url(${photo})`; avatarEl.style.backgroundSize='cover'; avatarEl.style.backgroundPosition='center'; } else { avatarEl.style.backgroundImage=''; avatarEl.textContent = (user.name && user.name[0]) || 'A'; } } catch(e){ avatarEl.style.backgroundImage=''; avatarEl.textContent = (user.name && user.name[0]) || 'A'; }

    // referrer controls
    try {
      const referralInfoEl = document.getElementById('referral-info');
      const referralCodeEl = document.getElementById('referral-code');
      const referralStatsEl = document.getElementById('referral-stats');
      if (referralInfoEl) referralInfoEl.textContent = user.referrer_tgid ? `Вас пригласил: ${user.referrer_tgid}` : 'Вас никто не приглашал';
      if (referralCodeEl){
        const deepLink = BOT_USERNAME ? (BOT_WEBAPP_PATH ? `https://t.me/${BOT_USERNAME}/${BOT_WEBAPP_PATH}?startapp=ref_${user.tgid}` : `https://t.me/${BOT_USERNAME}?startapp=ref_${user.tgid}`) : `${BASE_URL}/miniapp?ref=${user.tgid}&tgid=${user.tgid}`;
        referralCodeEl.innerHTML = `<div class="referral-code-line">Ваш код: <strong>${user.tgid}</strong></div><div class="referral-link-line"><input id="referral-link-input" readonly value="${deepLink}" class="referral-link-input" /><button id="copy-referral" class="copy-referral small-btn">Копировать</button></div>`;
        const copyBtn = document.getElementById('copy-referral'); if (copyBtn) copyBtn.addEventListener('click', ()=>{ const input = document.getElementById('referral-link-input'); if (input) { try { navigator.clipboard.writeText(input.value); } catch(e){ input.select(); document.execCommand('copy'); } } });
        const inviteBtn = document.getElementById('invite-btn'); if (inviteBtn) inviteBtn.onclick = ()=>{ const shareText = encodeURIComponent('Залетай в GC Farm! Мой инвайт:'); const shareUrl = encodeURIComponent(deepLink); const tgLink = `https://t.me/share/url?url=${shareUrl}&text=${shareText}`; try { if (window.Telegram && window.Telegram.WebApp && typeof window.Telegram.WebApp.openTelegramLink === 'function') { window.Telegram.WebApp.openTelegramLink(tgLink); } else { window.open(tgLink, '_blank'); } } catch (e) { window.open(tgLink, '_blank'); } }; }
      if (referralStatsEl) referralStatsEl.innerHTML = `Приглашено: ${user.referrals_count || 0} | Бонусы получено: ${user.referrer_bonus || 0} SCube`;
    } catch(e){ console.warn('referral ui update failed', e); }

    if (user.auto_energy) startAutoTick(getTgid); else stopAutoTick();

    if (typeof onInitialReady === 'function') onInitialReady();
  } catch(err){ console.error('loadUser error', err); if (appMessage) appMessage.textContent = 'Ошибка связи с сервером. Попробуйте позже.'; }
}
