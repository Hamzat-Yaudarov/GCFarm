'use strict';

const https = require('https');
const http = require('http');
const { URL } = require('url');

function parseList(value) {
  return String(value || '')
    .split(/[\n,;\s]+/)
    .map((entry) => entry.trim())
    .filter((entry) => Boolean(entry));
}

const API_CHECK_URL = (process.env.SUBGRAM_API_URL || 'https://api.subgram.ru/get-user-subscriptions').trim();
const API_REQUEST_OP_URL = (process.env.SUBGRAM_REQUEST_OP_URL || 'https://api.subgram.ru/request-op/').trim();
const API_TOKEN = (process.env.SUBGRAM_API_TOKEN || '').trim();
const BOT_URL = (process.env.SUBGRAM_BOT_URL || 'https://t.me/SubGramAppBot').trim();
const DEFAULT_RECHECK_SECONDS = Math.max(30, parseInt(process.env.SUBGRAM_RECHECK_SECONDS || '90', 10) || 90);
const MAX_OP = Math.max(0, Math.min(10, parseInt(process.env.SUBGRAM_MAX_OP || '0', 10) || 0));
const EXCLUDE_IDS = parseList(process.env.SUBGRAM_EXCLUDE_IDS);
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
      timeout: 10000
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

async function checkUserSubscriptions(userId, chatId) {
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
    const payload = {
      UserId: String(numericId),
      ChatId: String(chatId ? Number(chatId) : numericId),
      action: 'subscribe'
    };
    if (MAX_OP) payload.MaxOP = MAX_OP;
    if (EXCLUDE_IDS && EXCLUDE_IDS.length) payload.exclude_channel_ids = EXCLUDE_IDS;

    const { statusCode, body } = await requestJson(API_REQUEST_OP_URL, payload);
    if (statusCode !== 200 || !body) {
      const message = body && body.message ? body.message : `SubGram ответил со статусом ${statusCode}`;
      throw new Error(message);
    }

    const status = String(body.status || '').toLowerCase();
    const code = Number(body.code || 0);
    const sponsorsData = body.additional && Array.isArray(body.additional.sponsors) ? body.additional.sponsors : [];
    const links = Array.isArray(body.links) ? body.links.map((l)=>String(l).trim()).filter(Boolean) : [];

    const normalizedSponsors = sponsorsData.map((entry)=> normalizeSponsor(entry, null)).filter(Boolean);

    // Determine subscription result: 'ok' + 200 means fully subscribed
    const subscribed = status === 'ok' && code === 200;

    // If service asks for gender explicitly, allow bypass temporarily but inform client
    const needGender = status === 'gender';

    return {
      enabled: true,
      subscribed,
      sponsors: normalizedSponsors,
      links,
      error: needGender ? 'Требуется указать пол пользователя' : null,
      temporaryBypass: needGender ? true : false,
      recheckAfterSeconds: DEFAULT_RECHECK_SECONDS
    };
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
    links: [],
    recheckAfterSeconds: DEFAULT_RECHECK_SECONDS
  };
}

module.exports = {
  getConfig,
  checkUserSubscriptions
};
