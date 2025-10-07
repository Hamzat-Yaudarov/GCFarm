import { SoundManager } from './utils.js';

const TRACKS = {
  MUZ1: '/miniapp/static/muzik/MUZ1.mp3',
  MUZ2: '/miniapp/static/muzik/MUZ2.mp3'
};

let musicEl = null;
let musicVolume = Math.min(1, Math.max(0, Number(localStorage.getItem('audio.musicVolume') || 0.5)));
let currentTrack = localStorage.getItem('audio.musicTrack') || 'MUZ1';
let interactionHooked = false;
let gatingExpanded = false;

function isExpanded(){
  try { return !!(window.Telegram && window.Telegram.WebApp && window.Telegram.WebApp.isExpanded); } catch(e){ return false; }
}
function shouldPlay(){ return isExpanded(); }

function ensureAudio(){
  if (musicEl) return musicEl;
  musicEl = new Audio();
  musicEl.src = TRACKS[currentTrack] || TRACKS.MUZ1;
  musicEl.loop = true;
  musicEl.preload = 'auto';
  musicEl.volume = musicVolume;
  return musicEl;
}

async function play(){ const el = ensureAudio(); try { SoundManager.resume(); await el.play().catch(()=>{}); } catch(e){} }
function pause(){ const el = ensureAudio(); try { el.pause(); } catch(e){} }

async function evaluatePlayback(){
  gatingExpanded = shouldPlay();
  if (gatingExpanded) await play(); else pause();
}

function hookFirstInteraction(){
  if (interactionHooked) return; interactionHooked = true;
  const handler = ()=>{ evaluatePlayback(); cleanup(); };
  const cleanup = ()=>{ ['pointerdown','click','touchstart','touchend','keydown','mousedown'].forEach(ev=> document.removeEventListener(ev, handler, { passive:true })); };
  ['pointerdown','click','touchstart','touchend','keydown','mousedown'].forEach(ev=> document.addEventListener(ev, handler, { passive:true }));
}

function setTrack(key){
  const next = TRACKS[key] ? key : 'MUZ1';
  currentTrack = next;
  try { localStorage.setItem('audio.musicTrack', next); } catch(e){}
  const el = ensureAudio();
  const wasPlaying = !el.paused;
  const targetSrc = TRACKS[next];
  if (el.src.endsWith(targetSrc)) return;
  try {
    el.pause();
    el.src = targetSrc;
    el.load();
    el.volume = musicVolume;
    if (wasPlaying && shouldPlay()) el.play().catch(()=>{});
  } catch(e){}
}

function setMusicVolume(v){
  musicVolume = Math.min(1, Math.max(0, Number(v)||0));
  try { localStorage.setItem('audio.musicVolume', String(musicVolume)); } catch(e){}
  const el = ensureAudio();
  el.volume = musicVolume;
}

export async function initAudio(){
  ensureAudio();
  try { if (window.Telegram && window.Telegram.WebApp && typeof window.Telegram.WebApp.expand === 'function') window.Telegram.WebApp.expand(); } catch(e){}
  await evaluatePlayback();
  hookFirstInteraction();
  setupLifecycleWatchers();
  setupSettingsUI();
}

function setupLifecycleWatchers(){
  try {
    if (window.Telegram && window.Telegram.WebApp && typeof window.Telegram.WebApp.onEvent === 'function'){
      window.Telegram.WebApp.onEvent('viewportChanged', ()=>{ evaluatePlayback(); });
    }
  } catch(e){}
  document.addEventListener('visibilitychange', ()=>{ if (document.hidden) pause(); else evaluatePlayback(); });
  window.addEventListener('pagehide', ()=> pause());
}

function setupSettingsUI(){
  const modal = document.getElementById('settings-modal');
  const openers = [document.getElementById('avatar')].filter(Boolean);
  const closeBtn = document.getElementById('settings-close');
  const sfxRange = document.getElementById('settings-sfx-volume');
  const musicRange = document.getElementById('settings-music-volume');
  const trackSel = document.getElementById('settings-track');

  if (sfxRange) { sfxRange.value = String(Math.round(SoundManager.getSfxVolume()*100)); sfxRange.addEventListener('input', ()=>{ const val = Number(sfxRange.value)/100; SoundManager.setSfxVolume(val); }); }
  if (musicRange) { musicRange.value = String(Math.round(musicVolume*100)); musicRange.addEventListener('input', ()=>{ const val = Number(musicRange.value)/100; setMusicVolume(val); }); }
  if (trackSel) { trackSel.value = currentTrack; trackSel.addEventListener('change', ()=>{ setTrack(trackSel.value); evaluatePlayback(); }); }

  openers.forEach(el=> el.addEventListener('click', ()=>{ if (!modal) return; modal.classList.remove('hidden'); evaluatePlayback(); }));
  if (closeBtn) closeBtn.addEventListener('click', ()=>{ if (!modal) return; modal.classList.add('hidden'); });
}

export function runWithAdSilence(fn){
  return (async ()=>{ try { pause(); } catch(e){} try { const r = await fn(); return r; } finally { await evaluatePlayback(); } })();
}

export function pauseForAd(){ pause(); }
export async function resumeAfterAd(){ await evaluatePlayback(); }

export { setTrack, setMusicVolume };
