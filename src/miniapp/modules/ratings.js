import { apiBase } from './state.js';
import { pluralizeRu } from './utils.js';

const leaderList = document.getElementById('leader-list');
const leaderEmpty = document.getElementById('leader-empty');
const leaderButtons = document.querySelectorAll('.leader-btn');
const leaderboardSection = document.getElementById('leaderboard');
const leaderSelfRank = document.getElementById('leader-self-rank');
const leaderSelfValue = document.getElementById('leader-self-value');
const leaderSelfNote = document.getElementById('leader-self-note');
const leaderPersonal = document.getElementById('leader-personal');

const leaderboardCache = { clicks: null, tasks: null };
const leaderboardCacheTime = { clicks: 0, tasks: 0 };
const LEADERBOARD_CACHE_TTL = 60 * 1000;
let leaderboardMode = 'clicks';
let leaderboardRequestId = 0;

function showLeaderboardMessage(message) { if (!leaderEmpty) return; leaderEmpty.textContent = message; leaderEmpty.classList.remove('hidden'); }
function hideLeaderboardMessage() { if (!leaderEmpty) return; leaderEmpty.classList.add('hidden'); }

function formatViewerValue(mode, value) {
  const safe = Number(value) || 0;
  if (mode === 'tasks') { const label = pluralizeRu(safe, ['задача', 'задачи', 'задач']); return `${safe} ${label}`; }
  return `${safe} SCube`;
}

function updateLeaderboardInsights(viewer, mode, state = 'ready', tgid){
  if (!leaderSelfRank || !leaderSelfValue || !leaderSelfNote) return;
  const isTasks = mode === 'tasks';
  if (state === 'loading') {
    leaderSelfRank.textContent = '…';
    leaderSelfValue.textContent = '…';
    leaderSelfNote.textContent = isTasks ? 'Загружаем рейтинг по заданиям…' : 'Загружаем рейтинг по SCube…';
    if (leaderPersonal) leaderPersonal.classList.add('leader-personal-empty');
    return;
  }
  if (!tgid) {
    leaderSelfRank.textContent = '—';
    leaderSelfValue.textContent = formatViewerValue(mode, 0);
    leaderSelfNote.textContent = 'Открой игру через бота, чтобы участвовать в рейтинге.';
    if (leaderPersonal) leaderPersonal.classList.add('leader-personal-empty');
    return;
  }
  if (!viewer) {
    leaderSelfRank.textContent = '—';
    leaderSelfValue.textContent = formatViewerValue(mode, 0);
    leaderSelfNote.textContent = isTasks ? 'Выполняй задания и забирай награды.' : 'Нажимай на золотой куб, чтобы добыть больше SCube.';
    if (leaderPersonal) leaderPersonal.classList.add('leader-personal-empty');
    return;
  }
  if (leaderPersonal) leaderPersonal.classList.remove('leader-personal-empty');
  leaderSelfRank.textContent = viewer.rank ? `#${viewer.rank}` : '—';
  leaderSelfValue.textContent = formatViewerValue(mode, viewer.value);
  if (viewer.rank <= 3) leaderSelfNote.textContent = 'Ты на пьедьстале! Держи темп. 🌟';
  else if (viewer.rank <= 10) leaderSelfNote.textContent = 'До медалей рукой подать — продолжай!';
  else leaderSelfNote.textContent = isTasks ? 'Выполняй задания, чтобы расти.' : 'Добывай ещё SCube — каждый клик приближает к топу!';
}

function renderLeaderboard(entries, mode, viewer, tgid){
  if (!leaderList) return;
  leaderList.innerHTML = '';
  const hasEntries = Array.isArray(entries) && entries.length > 0;
  if (!hasEntries) { updateLeaderboardInsights(viewer, mode, 'ready', tgid); showLeaderboardMessage('Пока нет данных'); return; }
  hideLeaderboardMessage();
  const podiumIcons = ['🥇', '🥈', '🥉'];
  let viewerPlaced = false;
  entries.forEach((entry)=>{
    const item = document.createElement('li'); item.className = 'leader-item'; if (entry.rank <= 3) item.classList.add('leader-item-top');
    const rankSpan = document.createElement('span'); rankSpan.className = 'leader-rank'; rankSpan.textContent = entry.rank <= 3 ? (podiumIcons[entry.rank - 1] || `#${entry.rank}`) : `#${entry.rank}`;
    const nameSpan = document.createElement('span'); nameSpan.className = 'leader-name'; nameSpan.textContent = entry.name || `Игрок ${entry.tgid}`;
    const valueSpan = document.createElement('span'); valueSpan.className = 'leader-value'; valueSpan.textContent = formatViewerValue(mode, entry.value);
    if (viewer && Number(entry.tgid) === Number(viewer.tgid)) { item.classList.add('leader-item-self'); viewerPlaced = true; }
    item.append(rankSpan, nameSpan, valueSpan);
    leaderList.appendChild(item);
  });
  if (viewer && !viewerPlaced) {
    const viewerItem = document.createElement('li'); viewerItem.className = 'leader-item leader-item-self leader-item-outside';
    const rankSpan = document.createElement('span'); rankSpan.className = 'leader-rank'; rankSpan.textContent = viewer.rank ? `#${viewer.rank}` : '—';
    const nameSpan = document.createElement('span'); nameSpan.className = 'leader-name'; nameSpan.textContent = viewer.name || `Игрок ${viewer.tgid}`;
    const valueSpan = document.createElement('span'); valueSpan.className = 'leader-value'; valueSpan.textContent = formatViewerValue(mode, viewer.value);
    viewerItem.append(rankSpan, nameSpan, valueSpan); leaderList.appendChild(viewerItem);
  }
  updateLeaderboardInsights(viewer, mode, 'ready', tgid);
}

export async function loadLeaderboard(by, tgid, forceReload = false){
  if (!leaderList || !leaderEmpty) return;
  const mode = by === 'tasks' ? 'tasks' : 'clicks';
  const now = Date.now();
  const cached = leaderboardCache[mode];
  if (!forceReload && cached && now - leaderboardCacheTime[mode] < LEADERBOARD_CACHE_TTL) {
    renderLeaderboard(cached.entries, mode, cached.viewer, tgid);
    return;
  }
  updateLeaderboardInsights(null, mode, 'loading', tgid);
  const requestId = ++leaderboardRequestId;
  leaderList.innerHTML = '';
  showLeaderboardMessage('Загружаем рейтинг...');
  try {
    const viewerQuery = tgid ? `&viewer=${tgid}` : '';
    const res = await fetch(`${apiBase}/leaderboard?by=${mode}${viewerQuery}`);
    if (!res.ok) throw new Error(`Failed with status ${res.status}`);
    const json = await res.json();
    if (!json.ok) throw new Error(json.message || 'Bad response');
    const payload = { entries: Array.isArray(json.entries) ? json.entries : [], viewer: json.viewer || null };
    leaderboardCache[mode] = payload; leaderboardCacheTime[mode] = Date.now();
    if (leaderboardRequestId === requestId) renderLeaderboard(payload.entries, mode, payload.viewer, tgid);
  } catch (err) {
    if (leaderboardRequestId === requestId) { showLeaderboardMessage('Не удалось загрузить рейтинг'); updateLeaderboardInsights(null, mode, 'ready', tgid); }
    console.warn('leaderboard fetch failed', err);
  }
}

export function initLeaderboard(getTgid){
  if (leaderButtons && leaderButtons.length) {
    leaderButtons.forEach((btn)=>{
      btn.addEventListener('click', ()=>{
        const mode = btn.id === 'leader-by-tasks' ? 'tasks' : 'clicks';
        if (leaderboardMode === mode) return;
        leaderboardMode = mode;
        leaderButtons.forEach((b)=>b.classList.remove('active')); btn.classList.add('active');
        loadLeaderboard(mode, getTgid());
      });
    });
  }
  return {
    load: (mode='clicks', force=false)=> loadLeaderboard(mode, getTgid(), force),
    get mode(){ return leaderboardMode; },
    section: leaderboardSection
  };
}
