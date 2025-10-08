import { apiBase, BOT_USERNAME, BASE_URL } from './state.js';

export async function loadReferrals(getTgid){
  const tgid = getTgid && getTgid();
  const wrap = document.getElementById('referrals');
  const linkInput = document.getElementById('referral-link');
  const codeEl = document.getElementById('referral-code');
  const statCount = document.getElementById('referral-count');
  const statEarned = document.getElementById('referral-earned');
  const copyBtn = document.getElementById('copy-referral');
  const shareBtn = document.getElementById('share-invite');
  if (!wrap || !tgid) return;
  try {
    const res = await fetch(`${apiBase}/referrals/${tgid}`);
    if (!res.ok) throw new Error('failed');
    const js = await res.json();
    const link = (js && js.link) || (BOT_USERNAME ? `https://t.me/${BOT_USERNAME}?start=${tgid}` : `${String(BASE_URL||'').replace(/\/$/,'')}/miniapp?ref=${tgid}`);
    if (linkInput) { linkInput.value = link; }
    if (codeEl) { codeEl.textContent = String(tgid); }
    if (statCount) { statCount.textContent = String(js.count || 0); }
    if (statEarned) { statEarned.textContent = String(js.earned || 0); }
    if (copyBtn) {
      copyBtn.onclick = async ()=>{ try { await navigator.clipboard.writeText(link); copyBtn.textContent = 'Скопировано'; setTimeout(()=>{ copyBtn.textContent = 'Копировать'; }, 1200); } catch(e){} };
    }
    if (shareBtn) {
      shareBtn.onclick = ()=>{
        const text = 'Залетай в GC Farm и получай бонусы!';
        const url = link;
        if (window.Telegram && window.Telegram.WebApp && typeof window.Telegram.WebApp.openTelegramLink === 'function') {
          window.Telegram.WebApp.openTelegramLink(url);
        } else if (navigator.share) {
          navigator.share({ title: 'GC Farm', text, url }).catch(()=>{});
        } else {
          try { navigator.clipboard.writeText(url); } catch(e){}
          alert('Ссылка скопирована');
        }
      };
    }
  } catch (e) { /* ignore */ }
}

export async function checkAndBindReferrer(getTgid){
  try {
    const url = new URL(window.location.href);
    const ref = url.searchParams.get('ref');
    const tgid = getTgid && getTgid();
    if (ref && tgid && String(ref)!==String(tgid)) {
      await fetch(`${apiBase}/user/${tgid}/set-referrer`, { method:'POST', headers:{ 'Content-Type':'application/json' }, body: JSON.stringify({ referrer: ref }) });
      url.searchParams.delete('ref');
      window.history.replaceState({}, '', url.toString());
    }
  } catch (e) { /* noop */ }
}
