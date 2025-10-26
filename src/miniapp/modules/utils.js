// Utility helpers, sounds, microinteractions, animations
export function addAdCooldown(button, duration = 10000) {
  if (!button) return;
  if (button.disabled) return;
  button.disabled = true;
  button.classList.add('btn-disabled');
  const orig = button.dataset.origText || button.textContent;
  button.dataset.origText = orig;
  let seconds = Math.ceil(duration / 1000);
  button.textContent = `${orig} (${seconds}s)`;
  const iv = setInterval(() => {
    seconds -= 1;
    if (seconds > 0) button.textContent = `${orig} (${seconds}s)`;
    else {
      clearInterval(iv);
      button.disabled = false;
      button.classList.remove('btn-disabled');
      button.textContent = button.dataset.origText || orig;
    }
  }, 1000);
}

export function initRippleEffects(){
  const all = Array.from(document.querySelectorAll('button, .upgrade-btn, .withdraw-method-button, .withdraw-trigger-btn, .leader-btn, .watch-ad, .create-room-btn, .share-invite-btn, .bet-chip'));
  const candidates = all.filter(btn => btn && btn.id !== 'golden-cube' && !btn.classList.contains('tab-button'));
  candidates.forEach((btn)=>{
    if (btn.classList.contains('with-ripple')) return;
    btn.classList.add('with-ripple');
    let rippleTimeout;
    btn.addEventListener('click', (e)=>{
      try { SoundManager.click(); } catch(e){}
      const rect = btn.getBoundingClientRect();
      const ripple = document.createElement('span');
      ripple.className = 'btn-ripple';
      const size = Math.max(rect.width, rect.height);
      ripple.style.width = ripple.style.height = size + 'px';
      ripple.style.left = (e.clientX - rect.left - size/2) + 'px';
      ripple.style.top = (e.clientY - rect.top - size/2) + 'px';
      btn.appendChild(ripple);
      if (rippleTimeout) clearTimeout(rippleTimeout);
      rippleTimeout = setTimeout(()=>{ if (ripple && ripple.parentNode) ripple.parentNode.removeChild(ripple); }, 650);
    });
  });
}

export function animateScube() {
  const scubeEl = document.getElementById('scube');
  if (!scubeEl) return;
  scubeEl.classList.add('scube-pop');
  setTimeout(() => scubeEl.classList.remove('scube-pop'), 700);
}

export function animateGolden() {
  const golden = document.getElementById('golden-cube');
  if (!golden) return;
  golden.classList.remove('shake');
  void golden.offsetWidth;
  golden.classList.add('shake');
  setTimeout(()=> golden.classList.remove('shake'), 450);
}

export function sparkleAtElement(el, particles = 5){
  if (!el) return;
  const rect = el.getBoundingClientRect();
  const cx = rect.left + rect.width/2;
  const cy = rect.top + rect.height/2;
  for (let i=0;i<particles;i++){
    const s = document.createElement('div');
    s.className = 'sparkle';
    const angle = (Math.PI*2) * (i/particles) + Math.random()*0.5;
    const dist = 12 + Math.random()*20;
    s.style.left = cx + 'px';
    s.style.top = cy + 'px';
    s.style.setProperty('--dx', Math.cos(angle)*dist + 'px');
    s.style.setProperty('--dy', Math.sin(angle)*dist + 'px');
    document.body.appendChild(s);
    setTimeout(()=>{ if (s && s.parentNode) s.parentNode.removeChild(s); }, 480);
  }
}

export function rewardBurstNear(el){
  if (!el) return;
  const rect = el.getBoundingClientRect();
  const cx = rect.left + rect.width/2;
  const cy = rect.top + 8;
  const container = document.createElement('div');
  container.className = 'burst';
  container.style.left = cx + 'px';
  container.style.top = cy + 'px';
  for (let i=0;i<4;i++){
    const dot = document.createElement('span');
    dot.className = 'burst-dot';
    const angle = (Math.PI*2) * (i/4);
    const dist = 24;
    dot.style.setProperty('--bx', Math.cos(angle)*dist + 'px');
    dot.style.setProperty('--by', Math.sin(angle)*dist + 'px');
    container.appendChild(dot);
  }
  document.body.appendChild(container);
  setTimeout(()=>{ if (container && container.parentNode) container.parentNode.removeChild(container); }, 520);
}

export const SoundManager = (function(){
  let ctx = null;
  function ensure() {
    try { if (!ctx) ctx = new (window.AudioContext || window.webkitAudioContext)(); } catch(e) { ctx = null; }
    return ctx;
  }
  function playTone(freq, type = 'sine', duration = 0.08, gain = 0.12) {
    const c = ensure(); if (!c) return;
    const o = c.createOscillator(); const g = c.createGain();
    o.type = type; o.frequency.value = freq; g.gain.value = gain;
    o.connect(g); g.connect(c.destination); o.start();
    g.gain.exponentialRampToValueAtTime(0.0001, c.currentTime + duration);
    setTimeout(()=>{ try{ o.stop(); }catch(e){} }, duration * 1000 + 20);
  }
  return {
    click() { playTone(900, 'sine', 0.06, 0.08); },
    purchase() { playTone(1150, 'triangle', 0.12, 0.14); playTone(880, 'sine', 0.09, 0.08); },
    output() { playTone(720, 'sine', 0.10, 0.12); },
    gold() { playTone(1400, 'sine', 0.09, 0.14); playTone(1000, 'sine', 0.06, 0.1); },
    reward() { playTone(1600, 'sine', 0.12, 0.16); playTone(1200, 'sine', 0.08, 0.12); },
    error() { playTone(240, 'sawtooth', 0.12, 0.14); }
  };
})();

export function ensureCustomElementReady(name) {
  if (!window.customElements || typeof window.customElements.whenDefined !== 'function') {
    return Promise.resolve();
  }
  if (window.customElements.get(name)) return Promise.resolve();
  try { return window.customElements.whenDefined(name); } catch (err) { console.warn(`Failed to observe custom element ${name}`, err); return Promise.resolve(); }
}

export function pluralizeRu(value, forms) {
  const abs = Math.abs(Number(value) || 0) % 100;
  const last = abs % 10;
  if (abs > 10 && abs < 20) return forms[2];
  if (last === 1) return forms[0];
  if (last >= 2 && last <= 4) return forms[1];
  return forms[2];
}
