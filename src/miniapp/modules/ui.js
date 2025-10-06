import { SoundManager } from './utils.js';

const loadingOverlay = document.getElementById('loading-screen');
const loadingMessageEl = document.getElementById('loading-message');
const INITIAL_LOADING_TEXT = 'Загружаем вашу базу…';

export function showInitialLoading(message = INITIAL_LOADING_TEXT) {
  if (!loadingOverlay) return;
  if (loadingMessageEl && message) loadingMessageEl.textContent = message;
  loadingOverlay.classList.remove('loading-overlay--hidden');
}
export function hideInitialLoading() {
  if (!loadingOverlay) return;
  loadingOverlay.classList.add('loading-overlay--hidden');
}

// Onboarding controls
const ONB_KEY = 'onboarding_shown_v1';
const onbEl = document.getElementById('onboarding');
const onbSlides = document.getElementById('onb-slides');
const onbDots = document.getElementById('onb-dots');
const onbSkip = document.getElementById('onb-skip');
const onbNext = document.getElementById('onb-next');
let onbIndex = 0;

export function initOnboarding(){
  if (!onbEl || !onbSlides || !onbDots) return;
  const total = onbSlides.querySelectorAll('.onb-slide').length;
  onbDots.innerHTML = '';
  for (let i=0; i<total; i++){
    const dot = document.createElement('span');
    dot.className = 'onb-dot' + (i===0 ? ' active' : '');
    onbDots.appendChild(dot);
  }
  function render(){
    const slides = onbSlides.querySelectorAll('.onb-slide');
    slides.forEach((s, idx)=>{ if (idx===onbIndex){ s.classList.add('onb-slide-active'); } else { s.classList.remove('onb-slide-active'); } });
    const dots = onbDots.querySelectorAll('.onb-dot');
    dots.forEach((d, idx)=>{ if (idx===onbIndex){ d.classList.add('active'); } else { d.classList.remove('active'); } });
    if (onbNext) onbNext.textContent = (onbIndex === total - 1) ? 'Начать' : 'Далее';
  }
  if (onbSkip) onbSkip.addEventListener('click', ()=>{ try{ localStorage.setItem(ONB_KEY, '1'); }catch(e){} onbEl.classList.add('hidden'); });
  if (onbNext) onbNext.addEventListener('click', ()=>{ if (onbIndex < total - 1){ onbIndex += 1; render(); } else { try{ localStorage.setItem(ONB_KEY, '1'); }catch(e){} onbEl.classList.add('hidden'); } });
  render();
}
export function maybeShowOnboarding(){
  try { if (localStorage.getItem(ONB_KEY) === '1') return; if (onbEl) onbEl.classList.remove('hidden'); } catch(e){}
}

const tabs = document.querySelectorAll('.tab-button');
const contents = document.querySelectorAll('.tab-content');
const storeFab = document.getElementById('store-fab');
const mainEl = document.querySelector('.game-main');

export function setStoreFabVisibility(activeTab){
  if (!storeFab) return;
  if (activeTab === 'home') storeFab.classList.remove('hidden'); else storeFab.classList.add('hidden');
}
export function setMainCompact(activeTab){
  if (!mainEl) return;
  if (activeTab === 'home') mainEl.classList.add('game-main--homeCompact');
  else mainEl.classList.remove('game-main--homeCompact');
}

export function initTabs(onShowTab){
  function showTab(tab){
    contents.forEach(c=>{ if (c.id===tab) c.classList.remove('hidden'); else c.classList.add('hidden'); });
    tabs.forEach(b=>{ if (b.dataset.tab === tab) b.classList.add('active'); else b.classList.remove('active'); });
    setStoreFabVisibility(tab); setMainCompact(tab);
    if (typeof onShowTab === 'function') onShowTab(tab);
  }
  tabs.forEach(btn=>{ btn.addEventListener('click', ()=>{ const tab = btn.dataset.tab; showTab(tab); }); });
  if (storeFab) storeFab.addEventListener('click', ()=>{ showTab('store'); });
  const activeBtn = document.querySelector('.tab-button.active');
  setStoreFabVisibility(activeBtn ? activeBtn.dataset.tab : 'home');
  setMainCompact(activeBtn ? activeBtn.dataset.tab : 'home');
  return { showTab };
}
