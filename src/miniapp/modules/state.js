// Shared state and config
export const apiBase = '/api';
export const APP_CONFIG = window.APP_CONFIG || {};
export const BOT_USERNAME = APP_CONFIG.BOT_USERNAME || '';
export const BOT_WEBAPP_PATH = APP_CONFIG.BOT_WEBAPP_PATH || '';
export const BASE_URL = APP_CONFIG.BASE_URL || window.location.origin;

let tgidValue = null;
export function getTgid(){ return tgidValue; }
export function setTgid(v){ tgidValue = v; }

function qs(name){
  const url = new URL(window.location.href);
  return url.searchParams.get(name);
}

// Try to get tgid from URL or Telegram initData
export async function initAuth(){
  let tgid = qs('tgid');
  if (!tgid && window.Telegram && window.Telegram.WebApp && window.Telegram.WebApp.initDataUnsafe && window.Telegram.WebApp.initDataUnsafe.user) {
    tgid = window.Telegram.WebApp.initDataUnsafe.user.id;
  }
  if (tgid) setTgid(tgid);
  try {
    if (window.Telegram && window.Telegram.WebApp && window.Telegram.WebApp.initData) {
      const initData = window.Telegram.WebApp.initData;
      if (initData && initData.length > 0) {
        const res = await fetch('/auth/telegram', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ initData }) });
        if (res.ok) {
          const json = await res.json();
          if (json && json.ok && json.tgid) {
            setTgid(json.tgid);
          }
        }
      }
    }
  } catch (e) { console.warn('Auth exchange failed', e); }
}
