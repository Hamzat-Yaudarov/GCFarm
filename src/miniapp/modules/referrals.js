import { BASE_URL } from './state.js';

export function initReferrals(getTgid){
  const linkInput = document.getElementById('referral-link');
  const copyBtn = document.getElementById('copy-referral');
  const shareBtn = document.getElementById('share-referral');
  const statsEl = document.getElementById('referral-stats');
  const listEl = document.getElementById('referral-list');

  async function load() {
    const tgid = getTgid && getTgid();
    if (!tgid) {
      if (linkInput) linkInput.value = '';
      if (statsEl) statsEl.textContent = 'Войдите, чтобы видеть рефералов';
      return;
    }
    const link = `${BASE_URL}/miniapp?tgid=${tgid}&ref=${tgid}`;
    if (linkInput) linkInput.value = link;
    try {
      const res = await fetch(`/api/referrals/${tgid}`);
      if (!res.ok) throw new Error('Failed');
      const js = await res.json();
      if (!js || !js.ok) throw new Error('Failed');
      const stats = js.stats || { referred:0, earned:0 };
      if (statsEl) statsEl.textContent = `Рефералов: ${stats.referred} · Заработано с рефералов: ${stats.earned} SCube`;
      if (listEl) {
        listEl.innerHTML = '';
        const referrals = Array.isArray(js.referrals) ? js.referrals : [];
        if (!referrals.length) {
          const li = document.createElement('li'); li.textContent = 'Пока нет рефералов'; li.className='tasks-empty-message'; listEl.appendChild(li);
        } else {
          referrals.forEach(r=>{
            const li = document.createElement('li'); li.className='referral-item'; li.style.listStyle='none'; li.style.marginBottom='8px';
            li.textContent = `${r.name || r.tgid} — SCube: ${r.scube} · Реф-выигрыш: ${r.referral_earned}`;
            listEl.appendChild(li);
          });
        }
      }
    } catch (e) {
      if (statsEl) statsEl.textContent = 'Не удалось загрузить рефералов';
    }
  }

  if (copyBtn && linkInput) copyBtn.addEventListener('click', async ()=>{
    try { await navigator.clipboard.writeText(linkInput.value); copyBtn.textContent = 'Скопировано'; setTimeout(()=>copyBtn.textContent='Скопировать',1500); } catch(e){ alert('Не удалось скопировать'); }
  });

  if (shareBtn && linkInput) shareBtn.addEventListener('click', async ()=>{
    try {
      if (navigator.share) {
        await navigator.share({ title: 'Присоединяйся к GC Farm', text: 'Играй и зарабатывай SCube', url: linkInput.value });
      } else {
        try { await navigator.clipboard.writeText(linkInput.value); alert('Ссылка скопирована в буфер обмена'); } catch(e){ alert(linkInput.value); }
      }
    } catch(e){ alert('Не удалось поделиться'); }
  });

  return { load };
}
