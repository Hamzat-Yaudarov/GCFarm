import { apiBase, BOT_USERNAME, BASE_URL } from './state.js';

function buildReferralLink(tgid){
  const username = BOT_USERNAME || '';
  if (username) return `https://t.me/${username}?start=ref_${tgid}`;
  return `${BASE_URL}/miniapp?ref=${tgid}`;
}

export function initReferrals(getTgid){
  const section = document.getElementById('referrals');
  if (!section) return { load: ()=>{} };
  const codeEl = section.querySelector('#referral-code');
  const linkInput = section.querySelector('#referral-link');
  const copyBtn = section.querySelector('#copy-referral');
  const shareBtn = section.querySelector('#share-referral');
  const invitedEl = section.querySelector('#referrals-invited');
  const earnedEl = section.querySelector('#referrals-earned');
  const infoEl = section.querySelector('#referral-info');

  async function load(){
    const tgid = getTgid(); if (!tgid) return;
    const link = buildReferralLink(tgid);
    if (linkInput) { linkInput.value = link; }
    if (codeEl) { codeEl.textContent = tgid; }
    try {
      const res = await fetch(`${apiBase}/user/${tgid}/referrals`);
      if (res.ok){
        const js = await res.json();
        if (invitedEl) invitedEl.textContent = js.invited || 0;
        if (earnedEl) earnedEl.textContent = js.earned || 0;
      }
    } catch(e){ /* ignore */ }
  }

  if (copyBtn){
    copyBtn.addEventListener('click', async ()=>{
      try{ await navigator.clipboard.writeText(linkInput && linkInput.value || ''); if (infoEl) infoEl.textContent = 'Ссылка скопирована'; setTimeout(()=>{ if (infoEl) infoEl.textContent = ''; }, 1200); } catch(e){}
    });
  }
  if (shareBtn){
    shareBtn.addEventListener('click', ()=>{
      const link = linkInput && linkInput.value || '';
      const text = 'Присоединяйся и получай SCube!';
      try {
        if (window.Telegram && window.Telegram.WebApp && window.Telegram.WebApp.openTelegramLink) {
          window.Telegram.WebApp.openTelegramLink(link);
        } else if (navigator.share){
          navigator.share({ title: 'GC Farm', text, url: link }).catch(()=>{});
        } else {
          window.open(link, '_blank');
        }
      } catch(e){ window.open(link, '_blank'); }
    });
  }

  load();
  return { load };
}
