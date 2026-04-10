const fs = require('fs');
const path = require('path');
const config = require('../config');
const { loadJson, saveJson } = require('./jsonStore');
const {
  clone,
  createShellUserState,
  deriveInternalUid,
  defaultChannels,
  defaultArticles
} = require('../services/seedData');

function mergeByKey(defaults, loaded, key) {
  const map = new Map();
  defaults.forEach((item) => {
    map.set(String(item[key]), clone(item));
  });
  loaded.forEach((item) => {
    map.set(String(item[key]), item);
  });
  return Array.from(map.values());
}

function ensureSaveDir() {
  if (!fs.existsSync(config.saveDir)) {
    fs.mkdirSync(config.saveDir, { recursive: true });
  }
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function mergeDeep(base, patch) {
  if (!isPlainObject(patch)) return base;
  Object.keys(patch).forEach((key) => {
    const value = patch[key];
    if (Array.isArray(value)) {
      base[key] = value.slice();
      return;
    }
    if (isPlainObject(value)) {
      if (!isPlainObject(base[key])) {
        base[key] = {};
      }
      mergeDeep(base[key], value);
      return;
    }
    base[key] = value;
  });
  return base;
}

function sanitizeAuthForPersist(auth, userId) {
  if (!isPlainObject(auth)) return {};
  const deviceAuth = isPlainObject(auth.deviceAuth) ? auth.deviceAuth : {};
  const deviceAuthData = isPlainObject(deviceAuth.data) ? deviceAuth.data : {};
  return {
    uid: String(auth.uid || deriveInternalUid(userId)),
    naid: String(auth.naid || userId),
    sessionToken: String(auth.sessionToken || ''),
    cohortDate: Number(auth.cohortDate || 0),
    salt: String(auth.salt || ''),
    email: String(auth.email || ''),
    deviceAuth: {
      id: String(deviceAuth.id || userId),
      data: {
        udid: String(deviceAuthData.udid || userId),
        deviceModel: String(deviceAuthData.deviceModel || 'Unknown Device'),
        deviceName: String(deviceAuthData.deviceName || 'Unknown Device')
      }
    }
  };
}

function sanitizeTutorialForPersist(tutorial) {
  if (!isPlainObject(tutorial)) return {};
  return {
    api: Number(tutorial.api || 1),
    dbHash: String(tutorial.dbHash || ''),
    currentTutorialId: tutorial.currentTutorialId == null ? null : String(tutorial.currentTutorialId),
    currentTutorialGroupId: tutorial.currentTutorialGroupId == null ? null : String(tutorial.currentTutorialGroupId),
    largestTutorialId: Number(tutorial.largestTutorialId || 0),
    largestTutorialGroupId: Number(tutorial.largestTutorialGroupId || 0),
    tutorials: Array.isArray(tutorial.tutorials) ? tutorial.tutorials.slice() : [],
    tutorialGroups: Array.isArray(tutorial.tutorialGroups) ? tutorial.tutorialGroups.slice() : [],
    tutorialGroupsCompleted: Array.isArray(tutorial.tutorialGroupsCompleted) ? tutorial.tutorialGroupsCompleted.slice() : [],
    tutorialData: isPlainObject(tutorial.tutorialData) ? clone(tutorial.tutorialData) : {}
  };
}

function sanitizeCarConditionForPersist(condition) {
  if (!isPlainObject(condition)) return null;
  return {
    curr: Number(condition.curr || 0),
    tcc: Number(condition.tcc || 0),
    dc: Number(condition.dc || 0),
    dpr: Number(condition.dpr || 0),
    pr: Number(condition.pr || 0),
    sc: Number(condition.sc || 0),
    ts: Number(condition.ts || 0),
    hc: Number(condition.hc || 0)
  };
}

function sanitizeCarsRootForPersist(cars) {
  if (!isPlainObject(cars)) return {};
  const result = {};
  Object.entries(cars).forEach(([ownerUid, bucket]) => {
    if (!isPlainObject(bucket)) return;
    const cleanBucket = {};
    Object.entries(bucket).forEach(([recordId, record]) => {
      if (!isPlainObject(record) || !isPlainObject(record.r)) return;
      const recipe = record.r;
      cleanBucket[String(recordId)] = {
        uid: String(record.uid || ownerUid),
        _id: String(record._id || record.id || recordId),
        r: {
          c: Number(recipe.c || 0),
          n: String(recipe.n || record.carId || ''),
          p: Array.isArray(recipe.p) ? recipe.p.slice() : [],
          vu: Array.isArray(recipe.vu) ? recipe.vu.slice() : [],
          eu: Array.isArray(recipe.eu) ? recipe.eu.slice() : [],
          ut: Array.isArray(recipe.ut) ? recipe.ut.slice() : [],
          q: Number(recipe.q || record.q || 0),
          pc: String(recipe.pc || ''),
          tid: Number(recipe.tid || 0),
          et: Boolean(recipe.et),
          dc: Number(recipe.dc || -1),
          hash: Number(recipe.hash || 0)
        },
        q: Number(record.q || recipe.q || 0),
        carId: String(record.carId || record.car || recipe.n || ''),
        n: String(record.n || recipe.n || ''),
        dvu: Array.isArray(record.dvu) ? record.dvu.slice() : (Array.isArray(recipe.vu) ? recipe.vu.slice() : []),
        inv: Array.isArray(record.inv) ? record.inv.slice() : [],
        ud: Boolean(record.ud),
        up: isPlainObject(record.up) ? clone(record.up) : {}
      };
      if (Number.isFinite(Number(record.pi))) {
        cleanBucket[String(recordId)].pi = Number(record.pi);
      }
      const condition = sanitizeCarConditionForPersist(record.cond);
      if (condition) {
        cleanBucket[String(recordId)].cond = condition;
      }
    });
    if (Object.keys(cleanBucket).length > 0) {
      result[String(ownerUid)] = cleanBucket;
    }
  });
  return result;
}

function sanitizeInventoryForPersist(inventory) {
  if (!isPlainObject(inventory)) return {};
  const result = {};
  ['sc', 'hc', 'xp', 'fuel'].forEach((key) => {
    if (Number.isFinite(Number(inventory[key]))) {
      result[key] = Number(inventory[key]);
    }
  });
  return result;
}

function sanitizeMessageGiftForPersist(gift) {
  if (!isPlainObject(gift)) return null;
  const items = Array.isArray(gift.items)
    ? gift.items.map((item) => (isPlainObject(item) ? clone(item) : item))
    : [];
  return {
    items,
    b: String(gift.b || gift.box || ''),
    curl: String(gift.curl || gift.claimUrl || ''),
    c: gift.c != null ? Boolean(gift.c) : Boolean(gift.claimed)
  };
}

function sanitizeMessageForPersist(message, index) {
  if (!isPlainObject(message)) return null;
  const sanitized = {
    mid: String(message.mid || message.MessageID || `local_msg_${index + 1}`),
    mtype: String(message.mtype || 'mass_basic'),
    subject: String(message.subject || ''),
    short_subject: String(message.short_subject || message.ShortSubject || message.subject || ''),
    title: String(message.title || ''),
    cta: String(message.cta || ''),
    ctalbl: String(message.ctalbl || ''),
    ctabtn: String(message.ctabtn || ''),
    r: Number(message.r || 0),
    e: Number(message.e != null ? message.e : -1),
    _ts: Number(message._ts || 0),
    body: String(message.body || '')
  };
  if (String(message.imageUrl || '').trim()) {
    sanitized.imageUrl = String(message.imageUrl);
  }
  const gift = sanitizeMessageGiftForPersist(message.g);
  if (gift) {
    sanitized.g = gift;
  }
  return sanitized;
}

function sanitizeSparxSocialForPersist(sparx) {
  if (!isPlainObject(sparx)) return {};
  const messaging = isPlainObject(sparx.messaging) ? sparx.messaging : {};
  const chat = isPlainObject(sparx.chat) ? sparx.chat : {};
  return {
    messaging: {
      messages: Array.isArray(messaging.messages)
        ? messaging.messages.map(sanitizeMessageForPersist).filter(Boolean)
        : []
    },
    chat: {
      friends: Array.isArray(chat.friends)
        ? Array.from(new Set(chat.friends.map((entry) => String(entry || '').trim()).filter(Boolean)))
        : []
    }
  };
}

function sanitizeResultProfileForPersist(profile, auth, userId) {
  const uid = String(profile.uid || auth.uid || deriveInternalUid(userId));
  const ownedVehicles = Array.isArray(profile.OwnedVehicles) ? profile.OwnedVehicles.slice() : [];
  const normalizedMaxCars = Math.max(
    Number(profile.maxcars || profile.maxCars || profile.MaxCars || 0),
    Array.from(new Set(ownedVehicles.map((tag) => String(tag || '').trim()).filter(Boolean))).length
  );
  return {
    coins: Number(profile.coins || 0),
    gold: Number(profile.gold || 0),
    xp: Number(profile.xp || profile.XP || 0),
    maxcars: normalizedMaxCars,
    energy: Number(profile.energy || 0),
    tut_id: Number(profile.tut_id || 0),
    cmid: String(profile.cmid || ''),
    jfrid: String(profile.jfrid || ''),
    crid: String(profile.crid || ''),
    won_races: isPlainObject(profile.won_races) ? clone(profile.won_races) : {},
    lost_races: isPlainObject(profile.lost_races) ? clone(profile.lost_races) : {},
    rp: Number(profile.rp || profile.respectPoints || 0),
    time: Number(profile.time || profile.Miles || 0),
    uid,
    name: String(profile.name || ''),
    email: String(auth.email || ''),
    active_recipe: Number(profile.active_recipe || 0),
    CurrentVehicleTag: String(profile.CurrentVehicleTag || profile.currentVehicleTag || ''),
    currentVehicleTag: String(profile.currentVehicleTag || profile.CurrentVehicleTag || ''),
    OwnedVehicles: ownedVehicles,
    OwnedVehiclesStatus: isPlainObject(profile.OwnedVehiclesStatus) ? clone(profile.OwnedVehiclesStatus) : {},
    active_carid: String(profile.active_carid || ''),
    activeCarId: String(profile.activeCarId || profile.active_carid || '')
  };
}

function sanitizeResultForPersist(state, userId) {
  const sparx = isPlainObject(state.sparx) ? state.sparx : {};
  const dataStore = isPlainObject(sparx.dataStore) ? sparx.dataStore : {};
  const profile = isPlainObject(dataStore.profile) ? dataStore.profile : {};
  const auth = sanitizeAuthForPersist(state.auth, userId);
  const tutorialMeta = isPlainObject(sparx.tutorial) ? sparx.tutorial : {};
  const tutorialActive =
    tutorialMeta.currentTutorialId != null ||
    tutorialMeta.currentTutorialGroupId != null ||
    (Number(profile.tut_id || 0) < 2 &&
      (String(profile.crid || '').trim() === 'chapter_00_a' || String(profile.jfrid || '').trim() === 'chapter_00_a'));
  return {
    cars: sanitizeCarsRootForPersist(dataStore.cars),
    profile: sanitizeResultProfileForPersist(profile, auth, userId),
    inventory: sanitizeInventoryForPersist(dataStore.inventory),
    stats: isPlainObject(dataStore.stats) ? clone(dataStore.stats) : {},
    unlocks: isPlainObject(dataStore.unlocks) ? clone(dataStore.unlocks) : { values: [] },
    achievements: isPlainObject(dataStore.achievements) ? clone(dataStore.achievements) : { values: {} },
    dailyraces: isPlainObject(dataStore.dailyraces) ? clone(dataStore.dailyraces) : {},
    version: String(dataStore.version || '1'),
    platform: String(dataStore.platform || 'Android')
  };
}

function serializeUserStateForPersist(userId, state) {
  const safeState = isPlainObject(state) ? state : {};
  return {
    __userId: String(userId),
    __meta: {
      auth: sanitizeAuthForPersist(safeState.auth, userId),
      tutorial: sanitizeTutorialForPersist(safeState.sparx && safeState.sparx.tutorial),
      social: sanitizeSparxSocialForPersist(safeState.sparx)
    },
    result: sanitizeResultForPersist(safeState, userId)
  };
}

function hydrateProfileFromResult(userId, resultProfile, resultCars) {
  const explicitCurrentVehicleTag = String(
    resultProfile.CurrentVehicleTag ||
    resultProfile.currentVehicleTag ||
    ''
  );
  const explicitOwnedVehicles = Array.isArray(resultProfile.OwnedVehicles)
    ? resultProfile.OwnedVehicles.slice()
    : [];
  const normalizedMaxCars = Math.max(
    Number(resultProfile.maxcars || resultProfile.maxCars || resultProfile.MaxCars || 0),
    Array.from(new Set(explicitOwnedVehicles.map((tag) => String(tag || '').trim()).filter(Boolean))).length
  );
  const profile = {
    uid: String(resultProfile.uid || deriveInternalUid(userId)),
    id: String(resultProfile.uid || deriveInternalUid(userId)),
    userId: String(resultProfile.uid || deriveInternalUid(userId)),
    naid: String(userId),
    playerId: String(userId),
    player_id: String(userId),
    Nickname: String(resultProfile.name || ''),
    name: String(resultProfile.name || ''),
    Rank: 1,
    level: 1,
    Level: 1,
    PlayerLevel: 1,
    xp: Number(resultProfile.xp || 0),
    XP: Number(resultProfile.xp || 0),
    maxcars: normalizedMaxCars,
    Miles: Number(resultProfile.time || 0),
    Fuel: Number(resultProfile.energy || 0),
    MaxFuel: 10,
    ReserveFuel: 0,
    NoCoins: Number(resultProfile.coins || 0),
    NoStars: Number(resultProfile.gold || 0),
    CurrentVehicleTag: explicitCurrentVehicleTag,
    currentVehicleTag: explicitCurrentVehicleTag,
    UsingOwnedVehicle: false,
    OwnedVehicles: explicitOwnedVehicles,
    OwnedVehiclesStatus: isPlainObject(resultProfile.OwnedVehiclesStatus) ? clone(resultProfile.OwnedVehiclesStatus) : {},
    email: String(resultProfile.email || ''),
    rp: Number(resultProfile.rp || 0),
    respectPoints: Number(resultProfile.rp || 0),
    won_races: isPlainObject(resultProfile.won_races) ? clone(resultProfile.won_races) : {},
    lost_races: isPlainObject(resultProfile.lost_races) ? clone(resultProfile.lost_races) : {},
    tut_id: Number(resultProfile.tut_id || 0),
    cmid: String(resultProfile.cmid || ''),
    crid: String(resultProfile.crid || ''),
    jfrid: String(resultProfile.jfrid || ''),
    active_carid: String(resultProfile.active_carid || resultProfile.activeCarId || ''),
    activeCarId: String(resultProfile.activeCarId || resultProfile.active_carid || ''),
    active_recipe: Number(resultProfile.active_recipe || 0),
    last_story_race: String(resultProfile.last_story_race || ''),
    CurrentRaceId: String(resultProfile.CurrentRaceId || resultProfile.crid || ''),
    currentRaceId: String(resultProfile.currentRaceId || resultProfile.crid || ''),
    current_race_id: String(resultProfile.current_race_id || resultProfile.crid || ''),
    JustFinishedRaceId: String(resultProfile.JustFinishedRaceId || resultProfile.jfrid || ''),
    justFinishedRaceId: String(resultProfile.justFinishedRaceId || resultProfile.jfrid || ''),
    just_finished_race_id: String(resultProfile.just_finished_race_id || resultProfile.jfrid || ''),
    LastWonStoryRaceID: String(resultProfile.LastWonStoryRaceID || resultProfile.last_story_race || ''),
    lastWonStoryRaceID: String(resultProfile.lastWonStoryRaceID || resultProfile.last_story_race || ''),
    lastWonStoryRaceId: String(resultProfile.lastWonStoryRaceId || resultProfile.last_story_race || '')
  };

  if (isPlainObject(resultCars)) {
    const ownedTags = explicitOwnedVehicles.slice();
    Object.values(resultCars).forEach((bucket) => {
      if (!isPlainObject(bucket)) return;
      Object.values(bucket).forEach((record) => {
        const tag = record && record.r && record.r.n ? String(record.r.n) : '';
        if (tag && !ownedTags.includes(tag)) {
          ownedTags.push(tag);
        }
      });
    });
    if (ownedTags.length > 0) {
      profile.OwnedVehicles = ownedTags;
      profile.UsingOwnedVehicle = true;
    }
  }

  if (!profile.CurrentVehicleTag && profile.OwnedVehicles.length > 0) {
    profile.CurrentVehicleTag = String(profile.OwnedVehicles[0]);
    profile.currentVehicleTag = String(profile.OwnedVehicles[0]);
  }

  profile.UsingOwnedVehicle = profile.OwnedVehicles.length > 0;
  profile.maxcars = Math.max(Number(profile.maxcars || 0), profile.OwnedVehicles.length);

  return profile;
}

function hydrateUserStateFromPersisted(userId, raw) {
  const state = createShellUserState(userId);
  if (!isPlainObject(raw)) {
    return state;
  }

  if (isPlainObject(raw.result)) {
    if (!isPlainObject(state.sparx)) state.sparx = {};
    state.sparx.ds = {};
    state.sparx.dataStore = clone(raw.result);
    state.profile = hydrateProfileFromResult(userId, raw.result.profile || {}, raw.result.cars || {});
  } else {
    mergeDeep(state, clone(raw));
  }

  if (isPlainObject(raw.__meta)) {
    if (isPlainObject(raw.__meta.auth)) {
      state.auth = clone(raw.__meta.auth);
    }
    if (isPlainObject(raw.__meta.tutorial)) {
      if (!isPlainObject(state.sparx)) state.sparx = {};
      state.sparx.tutorial = clone(raw.__meta.tutorial);
    }
    if (isPlainObject(raw.__meta.social)) {
      if (!isPlainObject(state.sparx)) state.sparx = {};
      if (isPlainObject(raw.__meta.social.messaging)) {
        state.sparx.messaging = clone(raw.__meta.social.messaging);
      }
      if (isPlainObject(raw.__meta.social.chat)) {
        state.sparx.chat = clone(raw.__meta.social.chat);
      }
    }
  }

  return state;
}

function getDeviceAuthId(state) {
  if (!isPlainObject(state)) return '';
  const auth = isPlainObject(state.auth) ? state.auth : {};
  const deviceAuth = isPlainObject(auth.deviceAuth) ? auth.deviceAuth : {};
  const data = isPlainObject(deviceAuth.data) ? deviceAuth.data : {};
  return String(deviceAuth.id || data.udid || '').trim();
}

function getCanonicalPersistUserId(userId, state) {
  const requested = String(userId || '').trim();
  const auth = isPlainObject(state && state.auth) ? state.auth : {};
  const profile = isPlainObject(state && state.profile) ? state.profile : {};
  const sparxProfile = isPlainObject(state && state.sparx && state.sparx.dataStore && state.sparx.dataStore.profile)
    ? state.sparx.dataStore.profile
    : {};
  const deviceAuthId = getDeviceAuthId(state);
  const naid = String(auth.naid || profile.naid || sparxProfile.naid || '').trim();

  return naid || requested || deviceAuthId || 'default';
}

function collapseDuplicateUsers(users) {
  const cleaned = {};
  const aliasKeys = new Set();
  const groups = new Map();

  Object.entries(users || {}).forEach(([userId, state]) => {
    const deviceAuthId = getDeviceAuthId(state);
    if (!deviceAuthId) return;
    if (!groups.has(deviceAuthId)) groups.set(deviceAuthId, []);
    groups.get(deviceAuthId).push(userId);
  });

  groups.forEach((keys, deviceAuthId) => {
    const uniqueKeys = Array.from(new Set(keys));
    if (uniqueKeys.length < 2) return;
    const preferredKey =
      uniqueKeys.find((key) => key === deviceAuthId) ||
      uniqueKeys.find((key) => {
        const state = users[key];
        const auth = isPlainObject(state && state.auth) ? state.auth : {};
        return String(auth.naid || '').trim() === deviceAuthId;
      }) ||
      uniqueKeys[0];
    uniqueKeys.forEach((key) => {
      if (key !== preferredKey) aliasKeys.add(key);
    });
  });

  Object.entries(users || {}).forEach(([userId, state]) => {
    if (aliasKeys.has(userId)) return;
    cleaned[userId] = state;
  });

  return {
    users: cleaned,
    changed: aliasKeys.size > 0
  };
}

function getUserSaveFilename(userId) {
  return `save_${encodeURIComponent(String(userId || 'default'))}.json`;
}

function getUserSavePath(userId) {
  return path.join(config.saveDir, getUserSaveFilename(userId));
}

function loadUsersFromSaveDir() {
  ensureSaveDir();

  const users = {};
  const entries = fs.readdirSync(config.saveDir, { withFileTypes: true });
  entries.forEach((entry) => {
    if (!entry.isFile()) return;
    if (!/^save_.+\.json$/i.test(entry.name)) return;
    if (/^save_probe/i.test(entry.name)) return;
    if (/\.backup-\d{8}-\d{6}\.json$/i.test(entry.name)) return;

    const filePath = path.join(config.saveDir, entry.name);
    const raw = loadJson(filePath, null);
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return;

    const encodedId = entry.name.replace(/^save_/i, '').replace(/\.json$/i, '');
    let userId = '';
    try {
      userId = decodeURIComponent(encodedId);
    } catch (_) {
      userId = encodedId;
    }

    const explicitUserId = String(raw.__userId || userId || '').trim();
    if (!explicitUserId) return;

    users[explicitUserId] = hydrateUserStateFromPersisted(explicitUserId, raw);
  });

  return { users };
}

function persistUsersToSaveDir(users) {
  ensureSaveDir();

  const desiredFiles = new Set();
  Object.entries(users || {}).forEach(([userId, value]) => {
    const canonicalUserId = getCanonicalPersistUserId(userId, value);
    if (canonicalUserId === 'default') return;
    const filePath = getUserSavePath(canonicalUserId);
    desiredFiles.add(path.basename(filePath));
    saveJson(filePath, serializeUserStateForPersist(canonicalUserId, value || {}));
  });

  const entries = fs.readdirSync(config.saveDir, { withFileTypes: true });
  entries.forEach((entry) => {
    if (!entry.isFile()) return;
    if (!/^save_.+\.json$/i.test(entry.name)) return;
    if (/^save_probe/i.test(entry.name)) return;
    if (/\.backup-\d{8}-\d{6}\.json$/i.test(entry.name)) return;
    if (desiredFiles.has(entry.name)) return;
    try {
      fs.unlinkSync(path.join(config.saveDir, entry.name));
    } catch (error) {
      if (!error || error.code !== 'ENOENT') {
        throw error;
      }
    }
  });
}

function ensureState() {
  const loaded = loadUsersFromSaveDir();
  if (!loaded.users || typeof loaded.users !== 'object') {
    loaded.users = {};
  }
  const collapsed = collapseDuplicateUsers(loaded.users);
  if (collapsed.changed) {
    persistUsersToSaveDir(collapsed.users);
  }
  return { users: collapsed.users };
}

const store = {
  channels: mergeByKey(defaultChannels, loadJson(config.channelsFile, []), 'id'),
  articles: mergeByKey(defaultArticles, loadJson(config.articlesFile, []), 'id'),
  articleMap: null,
  state: ensureState()
};

store.articleMap = new Map(store.articles.map((article) => [String(article.id), article]));

function persistState() {
  persistUsersToSaveDir(store.state.users || {});
}

module.exports = {
  store,
  persistState
};
