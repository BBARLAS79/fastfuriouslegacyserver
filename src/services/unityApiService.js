const { persistState } = require('../store');
const { compactCar, compactProfile, logFf7Debug } = require('../lib/ff7Debug');
const userService = require('./userService');
const {
  clone,
  createOwnedVehicleRecordId,
  defaultVehicleDescriptions,
  getSupportedOwnedVehicleTags,
  vehicleAssetAliases,
  getDefaultRecipeArrays,
  getVehicleMetaTemplate
} = require('./seedData');
const {
  buildGachaRefreshPayload,
  buildGachaTablesPayload,
  claimShipyardBox,
  claimShipyardFreeBox,
  wrapConnectedResult
} = require('./sparxApiService');

const CAR_TOKEN_VERSION = 'local-carinfo-v1';
const CAR_TOKEN_CHECK = 'local-carinfo-check-v1';
const DEFAULT_TOKEN_SET_ID = 'default';
const DEFAULT_CAR_TOKEN_BALANCE = 12000;
const UNITY_API_PREFIXES = [
  '/carinfo',
  '/cars',
  '/currency',
  '/carupgrades',
  '/racewars',
  '/gacha',
  '/web',
  '/trials',
  '/tournaments'
];

function nowTs() {
  return Math.floor(Date.now() / 1000);
}

function isUnityApiPath(pathname) {
  return UNITY_API_PREFIXES.some((prefix) => pathname === prefix || pathname.startsWith(prefix + '/'));
}

function normalizeCarName(carName) {
  const normalized = String(carName || '').replace(/^car_attribute_/, '').trim();
  if (/^[0-9a-f]{24}$/i.test(normalized)) {
    return '';
  }
  return normalized;
}

function getCanonicalVehicleTag(tag, fallbackTag) {
  const normalizedTag = normalizeCarName(tag || fallbackTag || 'gtr_r34');
  if (!normalizedTag) {
    return String(fallbackTag || 'gtr_r34');
  }
  if (defaultVehicleDescriptions[normalizedTag]) {
    return String(normalizedTag || fallbackTag || 'gtr_r34');
  }
  const matchedShortTag = Object.keys(vehicleAssetAliases).find((shortTag) => vehicleAssetAliases[shortTag] === normalizedTag);
  return String(matchedShortTag || normalizedTag || fallbackTag || 'gtr_r34');
}

function getAssetVehicleTag(tag, fallbackTag) {
  const canonicalTag = getCanonicalVehicleTag(tag, fallbackTag);
  return String(vehicleAssetAliases[canonicalTag] || canonicalTag);
}

function uniq(values) {
  return Array.from(new Set(values.filter(Boolean)));
}

function toInt(value, fallback) {
  const parsed = parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function getUser(userId) {
  return userService.getUserState(userId);
}

function getProfile(userId) {
  return userService.getProfile(userId);
}

function classToNumber(tag) {
  const vehicle = defaultVehicleDescriptions[getCanonicalVehicleTag(tag, 'gtr_r34')];
  const performanceClass = vehicle && vehicle.PerformanceClass;

  switch (performanceClass) {
    case 'A':
      return 2;
    case 'B':
      return 1;
    case 'C':
    default:
      return 0;
  }
}

function estimateQuarterMile(tag) {
  const canonicalTag = getCanonicalVehicleTag(tag, 'gtr_r34');
  const base = {
    gtr_r34: 12.8,
    mx5_na: 15.2,
    supra_mk4: 12.2,
    bmw_1m_coupe: 12.9
  };

  return base[canonicalTag] || 13.5;
}

function deriveCarPi(tag) {
  const canonicalTag = getCanonicalVehicleTag(tag, 'gtr_r34');
  const assetTag = getAssetVehicleTag(canonicalTag, 'gtr_r34');
  const vehicle = defaultVehicleDescriptions[canonicalTag] || defaultVehicleDescriptions[assetTag] || {};
  const meta = getVehicleMetaTemplate(assetTag);
  const resolved = Number(meta.pi || vehicle.pi || vehicle.BasePISS || 0);
  return Number.isFinite(resolved) ? Math.max(0, Math.trunc(resolved)) : 0;
}

function normalizeCarCondition(rawCondition) {
  if (!rawCondition || typeof rawCondition !== 'object') {
    return null;
  }
  return {
    curr: Math.max(0, toInt(rawCondition.curr, 0)),
    tcc: Math.max(0, toInt(rawCondition.tcc, 0)),
    dpr: Math.max(0, toInt(rawCondition.dpr, 0)),
    pr: Math.max(0, toInt(rawCondition.pr, 0)),
    sc: Math.max(0, toInt(rawCondition.sc, 0)),
    ts: Math.max(0, toInt(rawCondition.ts, 0)),
    hc: Math.max(0, toInt(rawCondition.hc, 10))
  };
}

function computeRecipeHash(assetTag) {
  const source = `car_attribute_${String(assetTag || '').replace(/^car_attribute_/i, '').trim()}`;
  let hash = 2166136261 >>> 0;

  for (let i = 0; i < source.length; i += 1) {
    hash = Math.imul(hash, 16777619) >>> 0;
    hash ^= source.charCodeAt(i);
  }

  return hash > 0x7fffffff ? hash - 0x100000000 : hash;
}

function createRecipe(tag) {
  const canonicalTag = getCanonicalVehicleTag(tag, 'gtr_r34');
  const assetTag = getAssetVehicleTag(canonicalTag, 'gtr_r34');
  const recipeArrays = getDefaultRecipeArrays(assetTag);
  const quarterMile = estimateQuarterMile(canonicalTag);
  return {
    c: classToNumber(canonicalTag),
    pc: assetTag,
    n: assetTag,
    p: recipeArrays.p,
    vu: recipeArrays.vu,
    eu: recipeArrays.eu,
    q: quarterMile,
    ut: recipeArrays.ut,
    tid: 0,
    et: false,
    dc: -1,
    hash: computeRecipeHash(assetTag)
  };
}

function createCarRecord(tag, userId, carId) {
  const canonicalTag = getCanonicalVehicleTag(tag, 'gtr_r34');
  const assetTag = getAssetVehicleTag(canonicalTag, 'gtr_r34');
  const recordId = String(carId || assetTag);
  return {
    uid: String(userId),
    userId: String(userId),
    id: String(recordId),
    carId: assetTag,
    r: createRecipe(canonicalTag),
    pi: deriveCarPi(canonicalTag),
    q: estimateQuarterMile(canonicalTag),
    e: 0,
    _id: String(recordId)
  };
}

function ensureGarage(userId) {
  const user = getUser(userId);
  const profile = getProfile(userId);
  let changed = false;

  if (!Array.isArray(user.garageRecords) || user.garageRecords.length === 0) {
    const ownedVehicles = uniq([
      profile.CurrentVehicleTag || 'gtr_r34',
      ...(Array.isArray(profile.OwnedVehicles) ? profile.OwnedVehicles : [])
    ]);
    user.garageRecords = ownedVehicles.map((tag) => createCarRecord(tag, userId));
    changed = true;
  }

  if (typeof user.carTokenBalance !== 'number') {
    user.carTokenBalance = DEFAULT_CAR_TOKEN_BALANCE;
    changed = true;
  }

  user.garageRecords.forEach((record, index) => {
    if (!record || typeof record !== 'object') return;
    const canonicalTag = getCanonicalVehicleTag(
      record.r && record.r.n ? record.r.n : getProfile(userId).CurrentVehicleTag || 'gtr_r34',
      getProfile(userId).CurrentVehicleTag || 'gtr_r34'
    );
    const assetTag = getAssetVehicleTag(canonicalTag, 'gtr_r34');
    const recordId = String(
      record._id ||
      record.id ||
      createOwnedVehicleRecordId(String(profile.uid || profile.id || userId), assetTag, index)
    ).trim();
    if (record.r && record.r.n !== assetTag) {
      record.r.n = assetTag;
      changed = true;
    }
    if (String(record._id || '') !== recordId) {
      record._id = recordId;
      changed = true;
    }
    if (record.id !== recordId) {
      record.id = recordId;
      changed = true;
    }
    if (record.carId !== assetTag) {
      record.carId = assetTag;
      changed = true;
    }
    const desiredRecipe = createRecipe(canonicalTag);
    if (!record.r || typeof record.r !== 'object') {
      record.r = desiredRecipe;
      changed = true;
    } else {
      if (JSON.stringify(record.r.p) !== JSON.stringify(desiredRecipe.p)) {
        record.r.p = desiredRecipe.p;
        changed = true;
      }
      if (JSON.stringify(record.r.vu) !== JSON.stringify(desiredRecipe.vu)) {
        record.r.vu = desiredRecipe.vu;
        changed = true;
      }
      if (JSON.stringify(record.r.eu) !== JSON.stringify(desiredRecipe.eu)) {
        record.r.eu = desiredRecipe.eu;
        changed = true;
      }
      if (JSON.stringify(record.r.ut) !== JSON.stringify(desiredRecipe.ut)) {
        record.r.ut = desiredRecipe.ut;
        changed = true;
      }
      if (record.r.c !== desiredRecipe.c) {
        record.r.c = desiredRecipe.c;
        changed = true;
      }
      if (record.r.q !== desiredRecipe.q) {
        record.r.q = desiredRecipe.q;
        changed = true;
      }
      if (record.r.pc !== desiredRecipe.pc) {
        record.r.pc = desiredRecipe.pc;
        changed = true;
      }
      if (record.r.tid !== desiredRecipe.tid) {
        record.r.tid = desiredRecipe.tid;
        changed = true;
      }
      if (record.r.et !== desiredRecipe.et) {
        record.r.et = desiredRecipe.et;
        changed = true;
      }
      if (record.r.dc !== desiredRecipe.dc) {
        record.r.dc = desiredRecipe.dc;
        changed = true;
      }
    }
    if (record.userId !== String(userId)) {
      record.userId = String(userId);
      changed = true;
    }
    if (record.uid !== String(userId)) {
      record.uid = String(userId);
      changed = true;
    }
    if (typeof record.pi !== 'number') {
      record.pi = deriveCarPi(canonicalTag);
      changed = true;
    }
    if (record.cond != null) {
      const normalizedCondition = normalizeCarCondition(record.cond);
      if (JSON.stringify(normalizedCondition) !== JSON.stringify(record.cond)) {
        record.cond = normalizedCondition;
        changed = true;
      }
    }
  });

  if (user.garageRecords.length === 0) {
    user.garageRecords.push(createCarRecord(profile.CurrentVehicleTag || 'gtr_r34', userId));
    changed = true;
  }

  if (changed) persistState();
  return user.garageRecords;
}

function syncGarageRecordToSparx(userId, record) {
  const user = getUser(userId);
  const profile = getProfile(userId);
  if (!user || !record || typeof record !== 'object') return;
  if (!user.sparx || typeof user.sparx !== 'object') user.sparx = {};
  if (!user.sparx.dataStore || typeof user.sparx.dataStore !== 'object') user.sparx.dataStore = {};
  if (!user.sparx.dataStore.cars || typeof user.sparx.dataStore.cars !== 'object') user.sparx.dataStore.cars = {};
  const ownerUid = String(profile.uid || profile.id || profile.userId || userId);
  if (!user.sparx.dataStore.cars[ownerUid] || typeof user.sparx.dataStore.cars[ownerUid] !== 'object') {
    user.sparx.dataStore.cars[ownerUid] = {};
  }
  user.sparx.dataStore.cars[ownerUid][String(record._id || record.id || record.carId)] = clone(record);
}

function syncActiveVehicleSelection(userId, record, tagOverride = '') {
  const user = getUser(userId);
  const profile = getProfile(userId);
  const canonicalTag = getCanonicalVehicleTag(
    tagOverride || (record && record.r && record.r.n) || (record && record.carId) || profile.CurrentVehicleTag || 'gtr_r34',
    profile.CurrentVehicleTag || 'gtr_r34'
  );
  const activeCarId = String(record && (record._id || record.id || record.carId) || '');
  const activeRecipe = Number(
    (record && record.active_recipe) ||
    (record && record.r && record.r.hash) ||
    (record && record.recipe && record.recipe.hash) ||
    0
  );

  profile.CurrentVehicleTag = canonicalTag;
  profile.currentVehicleTag = canonicalTag;
  if (activeCarId) {
    profile.active_carid = activeCarId;
    profile.activeCarId = activeCarId;
    profile.lastRequestedCarId = activeCarId;
    profile.LastRequestedCarId = activeCarId;
  }
  if (activeRecipe) {
    profile.active_recipe = activeRecipe;
  }

  if (user && user.sparx && user.sparx.dataStore && typeof user.sparx.dataStore === 'object') {
    if (!user.sparx.dataStore.profile || typeof user.sparx.dataStore.profile !== 'object') {
      user.sparx.dataStore.profile = {};
    }
    user.sparx.dataStore.profile.CurrentVehicleTag = canonicalTag;
    user.sparx.dataStore.profile.currentVehicleTag = canonicalTag;
    if (activeCarId) {
      user.sparx.dataStore.profile.active_carid = activeCarId;
      user.sparx.dataStore.profile.activeCarId = activeCarId;
      user.sparx.dataStore.profile.lastRequestedCarId = activeCarId;
      user.sparx.dataStore.profile.LastRequestedCarId = activeCarId;
    }
    if (activeRecipe) {
      user.sparx.dataStore.profile.active_recipe = activeRecipe;
    }
    if (record && typeof record === 'object') {
      user.sparx.dataStore.car = clone(record);
      syncGarageRecordToSparx(userId, record);
    }
  }
}

function ensureOwnedVehicle(userId, tag) {
  const profile = getProfile(userId);
  const garage = ensureGarage(userId);
  const canonicalTag = getCanonicalVehicleTag(tag, profile.CurrentVehicleTag || 'gtr_r34');
  const assetTag = getAssetVehicleTag(canonicalTag, 'gtr_r34');

  if (!profile.OwnedVehicles.includes(canonicalTag)) {
    profile.OwnedVehicles.push(canonicalTag);
  }

  let record = garage.find((item) => item && item.r && item.r.n === assetTag);
  if (!record) {
    record = createCarRecord(canonicalTag, userId);
    garage.push(record);
  }

  syncActiveVehicleSelection(userId, record, canonicalTag);
  persistState();
  return record;
}

function removeOwnedVehicle(userId, carId) {
  const user = getUser(userId);
  const profile = getProfile(userId);
  const garage = ensureGarage(userId);
  const index = garage.findIndex((record) => record && String(record._id) === String(carId));

  if (index === -1) return null;

  const [removed] = garage.splice(index, 1);
  const removedTag = getCanonicalVehicleTag(removed && removed.r ? removed.r.n : '', profile.CurrentVehicleTag || 'gtr_r34');
  const removedAssetTag = getAssetVehicleTag(removedTag, 'gtr_r34');
  const stillOwned = garage.some((record) => record && record.r && record.r.n === removedAssetTag);

  if (!stillOwned) {
    profile.OwnedVehicles = profile.OwnedVehicles.filter((tag) => tag !== removedTag);
  }

  if (profile.CurrentVehicleTag === removedTag && garage.length > 0) {
    syncActiveVehicleSelection(userId, garage[0], garage[0] && garage[0].r ? garage[0].r.n : '');
  }

  persistState();
  return removed;
}

function getCarTokenInfo(tag) {
  const canonicalTag = getCanonicalVehicleTag(tag, 'gtr_r34');
  const map = {
    gtr_r34: { buy: 4000, sell: 800 },
    bmw_1m_coupe: { buy: 4000, sell: 800 },
    supra_mk4: { buy: 5000, sell: 1000 },
    mx5_na: { buy: 1500, sell: 300 }
  };

  return map[canonicalTag] || { buy: 4000, sell: 800 };
}

function buildCarInfoPayload(userId) {
  const user = getUser(userId);
  const profile = getProfile(userId);
  const carNames = uniq([
    ...Object.keys(defaultVehicleDescriptions),
    ...profile.OwnedVehicles,
    'bmw_1m_coupe'
  ]);

  return {
    hash: CAR_TOKEN_VERSION,
    check: CAR_TOKEN_CHECK,
    ct: user.carTokenBalance,
    sets: [
      {
        _id: DEFAULT_TOKEN_SET_ID,
        items: carNames.map((name) => {
          const tokenInfo = getCarTokenInfo(name);
          return {
            name,
            buy: tokenInfo.buy,
            sell: tokenInfo.sell,
            sale: -1,
            ts: -1
          };
        })
      }
    ]
  };
}

function applyXp(profile, xpGain) {
  const oldXp = toInt(profile.XP, 0);
  const safeXpGain = Math.max(0, toInt(xpGain, 0));
  const newXp = oldXp + safeXpGain;
  profile.XP = newXp;
  return { oldXp, newXp };
}

function ensureProfileXp(profile) {
  if (typeof profile.XP !== 'number') {
    profile.XP = 0;
  }
}

function getCurrencyBucket(profile, type) {
  switch (String(type || '').toLowerCase()) {
    case 'hc':
    case 'hard':
      return 'NoStars';
    case 'sc':
    case 'soft':
    default:
      return 'NoCoins';
  }
}

function decodeCarPayload(rawCar, userId) {
  if (!rawCar || typeof rawCar !== 'object') {
    return createCarRecord(getProfile(userId).CurrentVehicleTag || 'gtr_r34', userId);
  }

  const requestedTag = normalizeCarName(
    (rawCar.r && (rawCar.r.n || rawCar.r.pc)) ||
    (rawCar.recipe && (rawCar.recipe.n || rawCar.recipe.pc)) ||
    rawCar.n ||
    rawCar.carId ||
    rawCar.car ||
    rawCar.AssetTag ||
    rawCar.assetTag ||
    rawCar.Tag ||
    rawCar.tag ||
    rawCar.name
  );
  const tag = getSupportedOwnedVehicleTags(
    [getCanonicalVehicleTag(requestedTag, getProfile(userId).CurrentVehicleTag || 'gtr_r34')],
    getProfile(userId).CurrentVehicleTag || 'gtr_r34'
  )[0];
  const recordId = String(rawCar._id || rawCar.id || '').trim() || createOwnedVehicleRecordId(
    String(getProfile(userId).uid || getProfile(userId).id || userId),
    getAssetVehicleTag(tag, 'gtr_r34'),
    0
  );
  const record = createCarRecord(tag, userId, recordId);

  if (typeof rawCar.q === 'number') record.q = rawCar.q;
  if (typeof rawCar.e === 'number') record.e = rawCar.e;
  if (typeof rawCar.pi === 'number') {
    record.pi = Math.max(0, toInt(rawCar.pi, record.pi));
  }
  const condition = normalizeCarCondition(rawCar.cond);
  if (condition) {
    record.cond = condition;
  }
  if (rawCar.r && typeof rawCar.r === 'object') {
    record.r = Object.assign({}, record.r, rawCar.r, {
      n: getAssetVehicleTag(tag, 'gtr_r34'),
      pc: getAssetVehicleTag(tag, 'gtr_r34')
    });
  }

  return record;
}

function findGarageRecord(userId, carId) {
  return ensureGarage(userId).find((record) => record && String(record._id) === String(carId)) || null;
}

function handleCarInfo(pathname, userId) {
  if (pathname === '/carinfo' || pathname === '/carinfo/check') {
    return { payload: buildCarInfoPayload(userId) };
  }

  return null;
}

function handleCars(pathname, params, userId) {
  const user = getUser(userId);
  const profile = getProfile(userId);
  ensureGarage(userId);
  ensureProfileXp(profile);

  if (pathname === '/cars' || pathname === '/cars/') {
    logFf7Debug('unity/cars', {
      userId,
      profile: compactProfile(profile),
      garage: user.garageRecords.map((record) => compactCar(record))
    });
    return { payload: clone(user.garageRecords) };
  }

  if (pathname === '/cars/save') {
    const record = decodeCarPayload(params.car, userId);
    const garage = ensureGarage(userId);
    const index = garage.findIndex((entry) => entry && String(entry._id) === String(record._id));
    const canonicalTag = getCanonicalVehicleTag(record.r && record.r.n, profile.CurrentVehicleTag || 'gtr_r34');

    if (index >= 0) garage[index] = record;
    else garage.push(record);

    if (!profile.OwnedVehicles.includes(canonicalTag)) {
      profile.OwnedVehicles.push(canonicalTag);
    }
    syncGarageRecordToSparx(userId, record);
    syncActiveVehicleSelection(userId, record, canonicalTag);
    persistState();
    logFf7Debug('unity/cars/save', {
      userId,
      profile: compactProfile(profile),
      savedCar: compactCar(record)
    });
    return { payload: { _id: record._id } };
  }

  if (pathname === '/cars/find') {
    const garage = clone(ensureGarage(userId)).slice(0, Math.max(1, toInt(params.num, 3)));
    const users = garage.map((record, index) => ({
      _id: `opponent-${index + 1}`,
      name: `Street Rival ${index + 1}`,
      uid: `opponent-${index + 1}`
    }));

    return {
      payload: {
        cars: garage,
        users
      }
    };
  }

  if (pathname === '/cars/buyCarWithCurrency') {
    const carName = normalizeCarName(params.carName) || 'gtr_r34';
    const price = Math.max(0, toInt(params.price, 0));
    const bucket = getCurrencyBucket(profile, params.payment);

    profile[bucket] = Math.max(0, toInt(profile[bucket], 0) - price);
    const xp = applyXp(profile, params.xp);
    const record = ensureOwnedVehicle(userId, carName);
    persistState();

    return {
      payload: {
        xp,
        car: clone(record)
      }
    };
  }

  if (pathname === '/cars/buyCarWithTokens2') {
    const carName = normalizeCarName(params.carName) || 'gtr_r34';
    const tokenInfo = getCarTokenInfo(carName);
    user.carTokenBalance = Math.max(0, toInt(user.carTokenBalance, DEFAULT_CAR_TOKEN_BALANCE) - tokenInfo.buy);
    const record = ensureOwnedVehicle(userId, carName);
    persistState();

    return {
      payload: {
        _id: record._id,
        ct: user.carTokenBalance,
        car: clone(record)
      }
    };
  }

  if (pathname === '/cars/sellCarForTokens') {
    const carId = params.carId;
    const record = removeOwnedVehicle(userId, carId) || findGarageRecord(userId, carId);
    const carName = record && record.r ? record.r.n : '';
    const tokenInfo = getCarTokenInfo(carName);
    user.carTokenBalance = toInt(user.carTokenBalance, DEFAULT_CAR_TOKEN_BALANCE) + tokenInfo.sell;
    persistState();

    return {
      payload: {
        _id: carId,
        ct: user.carTokenBalance
      }
    };
  }

  return null;
}

function handleCurrency(pathname, params, userId) {
  const profile = getProfile(userId);
  ensureProfileXp(profile);

  if (pathname === '/currency/credit') {
    const bucket = getCurrencyBucket(profile, params.t);
    profile[bucket] = toInt(profile[bucket], 0) + Math.max(0, toInt(params.q, 0));
    persistState();
    return { payload: { ok: true } };
  }

  if (pathname === '/currency/debit') {
    const bucket = getCurrencyBucket(profile, params.t);
    profile[bucket] = Math.max(0, toInt(profile[bucket], 0) - Math.max(0, toInt(params.q, 0)));
    const xp = applyXp(profile, params.xp);
    persistState();
    return { payload: xp };
  }

  if (pathname === '/currency/energyToken') {
    const oldEnergy = toInt(profile.Fuel, 0);
    const maxCapacity = Math.max(1, toInt(params.m, toInt(profile.MaxFuel, 10)));
    profile.Fuel = maxCapacity;
    persistState();
    return {
      payload: {
        oldEnergy,
        newEnergy: profile.Fuel
      }
    };
  }

  return null;
}

function handleCarUpgrades(pathname, params, userId) {
  const profile = getProfile(userId);
  ensureProfileXp(profile);
  const record = ensureOwnedVehicle(userId, profile.CurrentVehicleTag || 'gtr_r34');
  const xp = applyXp(profile, params.xp);
  persistState();

  if (
    pathname === '/carupgrades/visualUpgrade' ||
    pathname === '/carupgrades/partUpgrade' ||
    pathname === '/carupgrades/prestigeCar'
  ) {
    return {
      payload: {
        car: clone(record),
        xp
      }
    };
  }

  return null;
}

function handleRaceWars(pathname, userId) {
  const garage = clone(ensureGarage(userId));
  const baseRecord = garage[0] || createCarRecord('gtr_r34', userId, 'opponent-gtr-r34');

  if (pathname === '/racewars/getOpponent') {
    return {
      payload: {
        opponents: [
          {
            car: baseRecord,
            user: {
              _id: 'racewars-rival-1',
              uid: 'racewars-rival-1',
              name: 'RaceWar Rival'
            },
            streak: 3,
            score: 1200,
            rank: 1
          }
        ]
      }
    };
  }

  if (pathname === '/racewars/latest') {
    return {
      payload: {
        _id: 'racewars-latest',
        starts: nowTs() - 3600,
        ends: nowTs() + 86400,
        ended: false
      }
    };
  }

  if (pathname === '/racewars/myInfo') {
    return {
      payload: {
        bestStreak: 2,
        currentStreak: 1,
        rank: 5,
        score: 450,
        nextpm: { point: 600 },
        nextsm: { streak: 3 }
      }
    };
  }

  if (
    pathname === '/racewars/report' ||
    pathname === '/racewars/timeout' ||
    pathname === '/racewars/reset'
  ) {
    return {
      payload: {
        streak: 1,
        s: 25
      }
    };
  }

  return null;
}

function handleGacha(pathname, params, userId) {
  if (pathname === '/gacha/getTables') {
    const data = buildGachaTablesPayload(userId) || {};
    return {
      payload: {
        tables: clone(data.sets || []),
        sets: clone(data.sets || []),
        Sets: clone(data.Sets || data.sets || []),
        groups: clone(data.groups || []),
        Groups: clone(data.Groups || data.groups || []),
        boxes: clone(data.boxes || []),
        Boxes: clone(data.Boxes || data.boxes || []),
        tokens: clone(data.tokens || {}),
        Tokens: clone(data.Tokens || data.tokens || {}),
        freeTimes: clone(data.freeTimes || {}),
        FreeTimes: clone(data.FreeTimes || data.freeTimes || {}),
        unclaimedBoxes: clone(data.unclaimedBoxes || []),
        UnclaimedBoxes: clone(data.UnclaimedBoxes || data.unclaimedBoxes || [])
      }
    };
  }

  if (pathname === '/gacha/testGiveCar') {
    return {
      payload: {
        type: 'car',
        count: 1
      }
    };
  }

  if (pathname === '/gacha/claimfree') {
    const result = claimShipyardFreeBox(userId, params || {});
    const payload = wrapConnectedResult(result, Object.keys(result || {}));
    console.log('[GACHA CLAIMFREE RESPONSE]', JSON.stringify(payload));
    return { statusCode: 200, payload };
  }

  if (pathname === '/gacha/pick' || pathname === '/gacha/testProb') {
    const result = claimShipyardBox(userId, params || {});
    const payload = wrapConnectedResult(result, Object.keys(result || {}));
    console.log('[GACHA RESPONSE]', JSON.stringify(payload));
    return { statusCode: 200, payload };
  }

  return null;
}

function handleMisc(pathname) {
  if (pathname === '/web/webViewTabs') {
    return { payload: [] };
  }

  if (pathname === '/trials/setCarProgress') {
    return { payload: { ok: true } };
  }

  if (pathname === '/tournaments/latest') {
    return {
      payload: {
        _id: 'tournament-local',
        starts: nowTs() - 1800,
        ends: nowTs() + 172800
      }
    };
  }

  if (pathname === '/tournaments/prizecount') {
    return { payload: { count: 0 } };
  }

  if (pathname === '/tournaments/report') {
    return { payload: { ok: true } };
  }

  return null;
}

function handleUnityApiRequest(pathname, params, userId) {
  return (
    handleCarInfo(pathname, userId) ||
    handleCars(pathname, params, userId) ||
    handleCurrency(pathname, params, userId) ||
    handleCarUpgrades(pathname, params, userId) ||
    handleRaceWars(pathname, userId) ||
    handleGacha(pathname, params, userId) ||
    handleMisc(pathname)
  );
}

module.exports = {
  isUnityApiPath,
  handleUnityApiRequest
};
