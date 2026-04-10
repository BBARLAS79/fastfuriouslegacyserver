const { store, persistState } = require('../store');
const { clone, createShellUserState } = require('./seedData');

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function mergeDeep(base, patch) {
  if (!isPlainObject(patch)) return base;

  Object.keys(patch).forEach((key) => {
    const patchValue = patch[key];
    if (Array.isArray(patchValue)) {
      base[key] = patchValue.slice();
      return;
    }
    if (isPlainObject(patchValue)) {
      if (!isPlainObject(base[key])) {
        base[key] = {};
      }
      mergeDeep(base[key], patchValue);
      return;
    }
    base[key] = patchValue;
  });

  return base;
}

function normalizeUserIdInput(userId) {
  if (userId && typeof userId === 'object' && !Array.isArray(userId)) {
    return String(
      userId.uid ||
      userId.userId ||
      userId.id ||
      userId.naid ||
      userId.playerId ||
      userId.player_id ||
      'default'
    );
  }

  const raw = String(userId || 'default').trim();
  return raw || 'default';
}

function collectIdentityValues(value) {
  if (!isPlainObject(value)) return [];

  return [
    value.uid,
    value.userId,
    value.id,
    value.naid,
    value.playerId,
    value.player_id
  ]
    .map((entry) => String(entry || '').trim())
    .filter(Boolean);
}

function stateMatchesUserId(state, userId) {
  const expected = String(userId || '').trim();
  if (!expected || !isPlainObject(state)) return false;

  const values = []
    .concat(collectIdentityValues(state))
    .concat(collectIdentityValues(state.profile))
    .concat(collectIdentityValues(state.auth))
    .concat(collectIdentityValues(state.sparx && state.sparx.dataStore && state.sparx.dataStore.profile));

  return values.some((value) => value === expected);
}

function alignCanonicalProfileIds(state, userId) {
  if (!isPlainObject(state)) return state;
  if (!isPlainObject(state.profile)) state.profile = {};

  state.profile.naid = String(userId);
  state.profile.playerId = String(userId);
  state.profile.player_id = String(userId);

  return state;
}

function getCanonicalStateKey(requestedUserId) {
  const requested = String(requestedUserId || '').trim();
  if (!requested) return 'default';
  if (store.state.users[requested]) return requested;

  const matchingKeys = Object.keys(store.state.users).filter((key) => (
    stateMatchesUserId(store.state.users[key], requested)
  ));

  if (matchingKeys.length === 0) {
    return requested;
  }

  return matchingKeys.find((key) => {
    const state = store.state.users[key];
    const auth = isPlainObject(state && state.auth) ? state.auth : {};
    const deviceAuth = isPlainObject(auth.deviceAuth) ? auth.deviceAuth : {};
    const deviceAuthData = isPlainObject(deviceAuth.data) ? deviceAuth.data : {};
    return (
      key === String(auth.naid || '').trim() ||
      key === String(deviceAuth.id || '').trim() ||
      key === String(deviceAuthData.udid || '').trim()
    );
  }) || matchingKeys[0];
}

function normalizeUserState(userId, value) {
  return mergeDeep(createShellUserState(userId), clone(value || {}));
}

function getUserState(userId) {
  const normalizedUserId = normalizeUserIdInput(userId);
  const targetUserId = getCanonicalStateKey(normalizedUserId);
  const legacyObjectKey = String(userId) === '[object Object]' ? '[object Object]' : null;

  const aliasKeys = Object.keys(store.state.users).filter((key) => (
    key !== targetUserId && (
      stateMatchesUserId(store.state.users[key], normalizedUserId) ||
      stateMatchesUserId(store.state.users[key], targetUserId)
    )
  ));

  if (aliasKeys.length > 0) {
    const merged = store.state.users[targetUserId]
      ? normalizeUserState(targetUserId, store.state.users[targetUserId])
      : createShellUserState(targetUserId);

    aliasKeys.forEach((key) => {
      mergeDeep(merged, clone(store.state.users[key]));
    });

    alignCanonicalProfileIds(merged, targetUserId);
    Object.defineProperty(merged, '__normalized', {
      value: true,
      enumerable: false,
      writable: true
    });

    store.state.users[targetUserId] = merged;
    aliasKeys.forEach((key) => {
      delete store.state.users[key];
    });
    persistState();
  }

  if (legacyObjectKey && legacyObjectKey !== targetUserId && store.state.users[legacyObjectKey]) {
    const merged = store.state.users[targetUserId]
      ? mergeDeep(normalizeUserState(targetUserId, store.state.users[targetUserId]), clone(store.state.users[legacyObjectKey]))
      : normalizeUserState(targetUserId, store.state.users[legacyObjectKey]);
    if (stateMatchesUserId(merged, targetUserId)) {
      alignCanonicalProfileIds(merged, targetUserId);
    }
    Object.defineProperty(merged, '__normalized', {
      value: true,
      enumerable: false,
      writable: true
    });
    store.state.users[targetUserId] = merged;
    delete store.state.users[legacyObjectKey];
    persistState();
  }

  if (!store.state.users[targetUserId]) {
    const created = createShellUserState(targetUserId);
    Object.defineProperty(created, '__normalized', {
      value: true,
      enumerable: false,
      writable: true
    });
    store.state.users[targetUserId] = created;
    persistState();
    return store.state.users[targetUserId];
  }

  if (!store.state.users[targetUserId].__normalized) {
    const normalized = normalizeUserState(targetUserId, store.state.users[targetUserId]);
    if (stateMatchesUserId(normalized, targetUserId)) {
      alignCanonicalProfileIds(normalized, targetUserId);
    }
    Object.defineProperty(normalized, '__normalized', {
      value: true,
      enumerable: false,
      writable: true
    });
    store.state.users[targetUserId] = normalized;
    persistState();
  }

  return store.state.users[targetUserId];
}

function getProfile(userId) {
  return getUserState(userId).profile;
}

function addFavourite(userId, articleId) {
  const user = getUserState(userId);
  if (!user.favourites.includes(articleId)) {
    user.favourites.push(articleId);
    persistState();
  }
  return user.favourites.slice();
}

function removeFavourite(userId, articleId) {
  const user = getUserState(userId);
  user.favourites = user.favourites.filter((id) => id !== articleId);
  persistState();
  return user.favourites.slice();
}

module.exports = {
  getUserState,
  getProfile,
  addFavourite,
  removeFavourite
};
