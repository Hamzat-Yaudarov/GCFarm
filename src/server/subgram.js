'use strict';

const https = require('https');
const http = require('http');
const { URL } = require('url');

function parseLinks(value) {
  return String(value || '')
    .split(/[\n,;\s]+/)
    .map((entry) => entry.trim())
    .filter((entry) => Boolean(entry));
}

const API_ENDPOINT = (process.env.SUBGRAM_API_URL || 'https://api.subgram.ru/get-user-subscriptions').trim();
const API_TOKEN = (process.env.SUBGRAM_API_TOKEN || '').trim();
const BOT_URL = (process.env.SUBGRAM_BOT_URL || 'https://t.me/SubGramAppBot').trim();
const REQUIRED_LINKS = parseLinks(process.env.SUBGRAM_SPONSOR_LINKS || process.env.SUBGRAM_REQUIRED_LINKS || '');
const DEFAULT_RECHECK_SECONDS = Math.max(30, parseInt(process.env.SUBGRAM_RECHECK_SECONDS || '90', 10) || 90);
const ENABLED = Boolean(API_TOKEN);

function pickTransport(protocol) {
  return protocol === 'http:' ? http : https;
}

function buildRequestOptions(targetUrl, payload) {
  const url = new URL(targetUrl);
  const body = JSON.stringify(payload || {});
  return {
    url,
    body,
    options: {
      method: 'POST',
      hostname: url.hostname,
      port: url.port || (url.protocol === 'http:' ? 80 : 443),
      path: url.pathname + url.search,
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body),
        Auth: API_TOKEN
      },
      timeout: 8000
    }
  };
}

function requestJson(targetUrl, payload) {
  return new Promise((resolve, reject) => {
    const { url, body, options } = buildRequestOptions(targetUrl, payload);
    const transport = pickTransport(url.protocol);
    const req = transport.request(options, (res) => {
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => {
        const raw = Buffer.concat(chunks).toString('utf8');
        let parsed = null;
        if (raw) {
          try {
            parsed = JSON.parse(raw);
          } catch (error) {
            return reject(new Error('SubGram response is not valid JSON'));
          }
        }
        resolve({ statusCode: res.statusCode || 0, body: parsed });
      });
    });

    req.on('timeout', () => {
      req.destroy(new Error('SubGram request timed out'));
    });

    req.on('error', (error) => {
      reject(error);
    });

    req.write(body);
    req.end();
  });
}

function normalizeSponsor(entry, fallbackLink) {
  if (!entry && !fallbackLink) {
    return null;
  }
  const link = entry && entry.link ? String(entry.link).trim() : (fallbackLink ? String(fallbackLink).trim() : null);
  if (!link) {
    return null;
  }
  const status = entry && entry.status ? String(entry.status).toLowerCase() : 'unknown';
  return {
    link,
    status,
    type: entry && entry.type ? String(entry.type) : null,
    name: entry && entry.resource_name ? String(entry.resource_name) : null,
    logo: entry && entry.resource_logo ? String(entry.resource_logo) : null
  };
}

const REQUEST_OP_ENDPOINT = (process.env.SUBGRAM_REQUEST_OP_URL || 'https://api.subgram.ru/request-op/').trim();

async function requestOp(userId, chatId, opts = {}) {
  const numericId = Number(userId);
  const numericChat = chatId !== undefined && chatId !== null ? Number(chatId) : null;
  if (!Number.isFinite(numericId) || numericId <= 0) {
    throw new Error('Invalid user id');
  }
  const payload = Object.assign({}, opts);
  // include both common variants to be tolerant
  payload.UserId = numericId;
  payload.user_id = numericId;
  if (Number.isFinite(numericChat)) { payload.ChatId = numericChat; payload.chat_id = numericChat; }
  payload.action = payload.action || 'subscribe';
  if (!payload.MaxOP) payload.MaxOP = 3;

  const { statusCode, body } = await requestJson(REQUEST_OP_ENDPOINT, payload);
  if (statusCode !== 200 || !body) {
    const message = body && body.message ? body.message : `SubGram request-op responded with ${statusCode}`;
    throw new Error(message);
  }
  return body;
}

async function checkUserSubscriptions(userId) {
  if (!ENABLED) {
    return {
      enabled: false,
      subscribed: true,
      sponsors: [],
      links: [],
      error: null,
      temporaryBypass: false,
      recheckAfterSeconds: DEFAULT_RECHECK_SECONDS
    };
  }

  const numericId = Number(userId);
  if (!Number.isFinite(numericId) || numericId <= 0) {
    return {
      enabled: true,
      subscribed: false,
      sponsors: [],
      links: [],
      error: 'Некорректный идентификатор пользователя',
      temporaryBypass: false,
      recheckAfterSeconds: DEFAULT_RECHECK_SECONDS
    };
  }

  try {
    // Prefer dynamic request-op to get randomized links assigned to user
    try {
      const reqBody = await requestOp(numericId, numericId);
      const status = reqBody && reqBody.status ? String(reqBody.status).toLowerCase() : null;
      const code = reqBody && reqBody.code ? Number(reqBody.code) : null;
      const links = Array.isArray(reqBody.links) ? reqBody.links.slice() : [];
      const sponsorsData = reqBody.additional && Array.isArray(reqBody.additional.sponsors) ? reqBody.additional.sponsors : [];
      const sponsors = sponsorsData.map((s) => normalizeSponsor(s, s && s.link ? s.link : null)).filter(Boolean);
      const subscribed = (status === 'ok' && code === 200) ? true : (links.length === 0 ? true : sponsors.every((it) => it.status === 'subscribed'));
      return {
        enabled: true,
        subscribed,
        sponsors,
        links,
        error: null,
        temporaryBypass: false,
        recheckAfterSeconds: DEFAULT_RECHECK_SECONDS
      };
    } catch (opErr) {
      // fallback to older get-user-subscriptions endpoint using REQUIRED_LINKS when request-op fails
      const payload = {
        user_id: numericId,
        links: REQUIRED_LINKS
      };

      const { statusCode, body } = await requestJson(API_ENDPOINT, payload);
      if (statusCode !== 200 || !body) {
        const message = body && body.message ? body.message : `SubGram responded with status ${statusCode}`;
        throw new Error(message);
      }

      if (body.status && String(body.status).toLowerCase() !== 'ok') {
        // allow body.status == 'warning' and return that info
      }

      const sponsorsData = body.additional && Array.isArray(body.additional.sponsors) ? body.additional.sponsors : [];
      const sponsorsMap = new Map();
      sponsorsData.forEach((entry) => {
        if (entry && entry.link) sponsorsMap.set(String(entry.link).trim(), entry);
      });
      const links = REQUIRED_LINKS.slice();
      const sponsors = links.map((link) => normalizeSponsor(sponsorsMap.get(link), link)).filter(Boolean);
      const subscribed = sponsors.length === 0 ? true : sponsors.every((item) => item.status === 'subscribed');
      return {
        enabled: true,
        subscribed,
        sponsors,
        links,
        error: null,
        temporaryBypass: false,
        recheckAfterSeconds: DEFAULT_RECHECK_SECONDS
      };
    }
  } catch (error) {
    return {
      enabled: true,
      subscribed: true,
      sponsors: [],
      links: [],
      error: error && error.message ? error.message : 'Не удалось проверить подписки SubGram',
      temporaryBypass: true,
      recheckAfterSeconds: Math.max(DEFAULT_RECHECK_SECONDS, 180)
    };
  }
}

function getConfig() {
  return {
    enabled: ENABLED,
    botUrl: BOT_URL,
    links: REQUIRED_LINKS.slice(),
    recheckAfterSeconds: DEFAULT_RECHECK_SECONDS
  };
}

module.exports = {
  getConfig,
  checkUserSubscriptions
};
