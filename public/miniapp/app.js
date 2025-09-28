(() => {
  // Rewarded overlay built on demand when button clicked and ad fills the slot
  function buildRewardedOverlay(){
    const overlay = document.createElement('div');
    overlay.className = 'rewarded-overlay';
    overlay.setAttribute('aria-hidden','true');
    overlay.innerHTML = `
      <div class="rewarded-backdrop"></div>
      <div class="rewarded-card" role="dialog" aria-modal="true" aria-label="Реклама за награду">
        <button class="rewarded-close" aria-label="Закрыть">×</button>
        <div id="rewarded-btn-open" class="rewarded-body"></div>
      </div>`;
    document.body.appendChild(overlay);
    return overlay;
  }

  const rewardedBtn = document.getElementById('rewarded-btn');
  let adOpenAt = 0;
  function openRewarded(){
    const overlay = buildRewardedOverlay();
    const closeBtn = overlay.querySelector('.rewarded-close');
    const backdrop = overlay.querySelector('.rewarded-backdrop');
    const slot = overlay.querySelector('#rewarded-btn-open');

    const reveal = () => {
      overlay.classList.add('is-visible');
      overlay.setAttribute('aria-hidden','false');
      adOpenAt = Date.now();
    };
    const cleanUp = () => { if (overlay.parentNode) overlay.parentNode.removeChild(overlay); };

    const watcher = new MutationObserver(() => {
      if (slot && (slot.children.length > 0 || slot.querySelector('iframe, img, div'))){
        reveal();
        watcher.disconnect();
      }
    });
    if (slot) watcher.observe(slot, { childList: true, subtree: true });

    // Timeout: if no ad appeared, close silently
    setTimeout(() => { if (!overlay.classList.contains('is-visible')) cleanUp(); }, 8000);

    function closeRewarded(){
      cleanUp();
      adOpenAt = 0;
    }
    if (closeBtn) closeBtn.addEventListener('click', closeRewarded);
    if (backdrop) overlay.addEventListener('click', (e)=>{ if (e.target === backdrop) closeRewarded(); });
  }
  if (rewardedBtn) rewardedBtn.addEventListener('click', openRewarded);
})();
