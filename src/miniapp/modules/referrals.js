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
    const base = 'https://t.me/GCBorzfarmbot/GCBorzfarm';
    const link = (js && js.link) || `${base}?start=${tgid}`;
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
        // Open Telegram share to choose chat
        const shareUrl = `https://t.me/share/url?url=${encodeURIComponent(url)}&text=${encodeURIComponent(text)}`;
        try { window.open(shareUrl, '_blank'); } catch(e){ try { navigator.clipboard.writeText(url); alert('Ссылка скопирована'); } catch(e){} }
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
