const crypto = require('crypto');

function base64UrlFromBuffer(buf){
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/,'');
}
function collectSignatureCandidates(header){
  const trimmed = String(header || '').trim();
  if (!trimmed) return [];
  const candidates = new Set([trimmed]);
  trimmed.split(',').forEach(part=>{
    const piece = part.trim();
    if (!piece) return;
    const eqIdx = piece.indexOf('=');
    if (eqIdx === -1) {
      candidates.add(piece);
    } else {
      const val = piece.slice(eqIdx + 1).trim();
      if (val) candidates.add(val);
    }
  });
  return Array.from(candidates);
}
function timingSafeEqualString(a, b){
  const bufA = Buffer.from(String(a));
  const bufB = Buffer.from(String(b));
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}
function verifyAdsgramSignature(signatureHeader, expectedHex){
  try {
    const expectedBuf = Buffer.from(expectedHex, 'hex');
    const variants = [ expectedHex, expectedHex.toLowerCase(), expectedHex.toUpperCase(), expectedBuf.toString('base64'), base64UrlFromBuffer(expectedBuf) ].filter(Boolean);
    const candidates = collectSignatureCandidates(signatureHeader);
    for (const candidateRaw of candidates){
      const candidate = candidateRaw.trim();
      if (!candidate) continue;
      for (const variant of variants){ if (timingSafeEqualString(candidate, variant)) return true; }
      if (/^[0-9a-fA-F]+$/.test(candidate) && candidate.length === expectedHex.length) {
        const providedBuf = Buffer.from(candidate, 'hex');
        if (providedBuf.length === expectedBuf.length && crypto.timingSafeEqual(expectedBuf, providedBuf)) return true;
      }
      try { const providedBuf = Buffer.from(candidate, 'base64'); if (providedBuf.length === expectedBuf.length && crypto.timingSafeEqual(expectedBuf, providedBuf)) return true; } catch(e){}
      try { const normalized = candidate.replace(/-/g, '+').replace(/_/g, '/'); const padding = normalized.length % 4 ? '='.repeat(4 - (normalized.length % 4)) : ''; const providedBuf = Buffer.from(normalized + padding, 'base64'); if (providedBuf.length === expectedBuf.length && crypto.timingSafeEqual(expectedBuf, providedBuf)) return true; } catch(e){}
    }
    return false;
  } catch (e) { return false; }
}

function isPlainObject(value) { return value !== null && typeof value === 'object' && !Array.isArray(value); }

const DEFAULT_AD_REWARD = 5;
const DEFAULT_TASK_REWARD = 15;

function resolveAdsgramReward(payload){
  const data = payload || {};
  const rawTags = Array.isArray(data.tags) ? data.tags.map(tag => String(tag).toLowerCase()) : [];
  const rawTypeCandidates = [ data.type, data.event, data.category, data.kind, data.mode, data.source, data.reward_type ].filter(Boolean).map(value => String(value).toLowerCase());
  const taskMarkers = ['task', 'mission', 'quest'];
  let isTask = rawTags.some(tag => taskMarkers.some(marker => tag.includes(marker)));
  if (!isTask) isTask = rawTypeCandidates.some(type => taskMarkers.some(marker => type.includes(marker)));
  if (!isTask) isTask = Boolean(data.taskId || data.task_id || data.task);

  const numericFields = ['amount','reward','value','payout','reward_amount','rewardAmount','bonus','coins'];
  let numericReward;
  for (const field of numericFields){
    if (Object.prototype.hasOwnProperty.call(data, field)) {
      const parsed = Number(data[field]);
      if (Number.isFinite(parsed) && parsed > 0) { numericReward = parsed; break; }
    }
  }
  const fallback = isTask ? DEFAULT_TASK_REWARD : DEFAULT_AD_REWARD;
  const resolved = numericReward && numericReward > 0 ? numericReward : fallback;
  const safeAmount = Math.min(1000000, Math.max(1, Math.round(resolved)));
  return { amount: safeAmount, source: isTask ? 'task' : 'ad' };
}
function extractAdsgramContextId(payload){
  const data = payload || {};
  const candidates = [ data.eventId, data.event_id, data.transactionId, data.transaction_id, data.rewardId, data.reward_id, data.taskId, data.task_id, data.clickId, data.click_id, data.orderId, data.order_id, data.id, data.requestId, data.request_id ];
  for (const candidate of candidates){ if (candidate === undefined || candidate === null) continue; const trimmed = String(candidate).trim(); if (trimmed) return trimmed; }
  const user = data.userId || data.tgid || data.user_id; const adUnit = data.adUnit || data.ad_unit; const stamp = data.timestamp || data.time || data.createdAt || data.created_at || data.ts; if (user && stamp) return `${user}:${stamp}`; if (user && adUnit) return `${user}:${adUnit}`; return null;
}

module.exports = { verifyAdsgramSignature, resolveAdsgramReward, extractAdsgramContextId, isPlainObject };
