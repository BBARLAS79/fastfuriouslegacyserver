const { store } = require('../store');

function coerceValue(value) {
  if (typeof value !== 'string') return value;

  const trimmed = value.trim();
  if (!trimmed) return '';

  if (
    (trimmed.startsWith('{') && trimmed.endsWith('}')) ||
    (trimmed.startsWith('[') && trimmed.endsWith(']'))
  ) {
    try {
      return JSON.parse(trimmed);
    } catch (_) {
      return value;
    }
  }

  if (trimmed === 'true') return true;
  if (trimmed === 'false') return false;
  if (trimmed === 'null') return null;
  if (/^-?\d+(\.\d+)?$/.test(trimmed)) return Number(trimmed);

  return value;
}

function parseBody(req) {
  return new Promise((resolve) => {
    let body = '';
    req.on('data', (chunk) => {
      body += chunk.toString();
    });
    req.on('end', () => {
      if (!body.trim()) return resolve({});
      try {
        resolve(JSON.parse(body));
      } catch (_) {
        const params = new URLSearchParams(body);
        const result = {};
        params.forEach((value, key) => {
          result[key] = coerceValue(value);
        });
        resolve(result);
      }
    });
  });
}

function mergeRequestData(body, parsedUrl) {
  const query = {};
  const rawQuery = (parsedUrl && parsedUrl.query) || {};

  Object.keys(rawQuery).forEach((key) => {
    query[key] = coerceValue(rawQuery[key]);
  });

  return Object.assign({}, query, body || {});
}

function resolveUserIdFromToken(token) {
  const normalized = String(token || '').trim();
  if (!normalized) return '';

  const matched = Object.entries((store.state && store.state.users) || {}).find(([, user]) => {
    return user && user.auth && String(user.auth.sessionToken || '') === normalized;
  });

  if (!matched) return '';

  const [, user] = matched;
  return String(
    (user && user.auth && user.auth.naid) ||
    (user && user.profile && (user.profile.naid || user.profile.playerId || user.profile.player_id)) ||
    matched[0]
  );
}

function getUserId(body, parsedUrl) {
  const query = (parsedUrl && parsedUrl.query) || {};
  const tokenUserId = resolveUserIdFromToken(
    body.stoken ||
    body.token ||
    body.session ||
    query.stoken ||
    query.token ||
    query.session
  );

  return String(
    tokenUserId ||
    body.uid ||
    body.id ||
    body.device_id ||
    body.deviceId ||
    body.naid ||
    body.userId ||
    body.user_id ||
    body.playerId ||
    body.player_id ||
    query.uid ||
    query.id ||
    query.device_id ||
    query.deviceId ||
    query.naid ||
    query.userId ||
    query.user_id ||
    query.playerId ||
    query.player_id ||
    'default'
  );
}

function normalizeMethod(body, parsedUrl) {
  const raw =
    body.method ||
    body.path ||
    body.endpoint ||
    (parsedUrl.query && parsedUrl.query.method) ||
    '';
  const clean = String(raw || '').replace(/^\/+|\/+$/g, '');
  const parts = clean.split('/').filter(Boolean);
  return {
    raw: clean,
    name: parts[0] || '',
    args: parts.slice(1)
  };
}

module.exports = {
  parseBody,
  mergeRequestData,
  getUserId,
  normalizeMethod
};
