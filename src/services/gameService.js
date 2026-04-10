const articleService = require('./articleService');
const config = require('../config');
const { store, persistState } = require('../store');
const userService = require('./userService');
const { buildTranslationDictionary } = require('./wskeApiService');
const {
  clone,
  defaultGlobalUiData,
  defaultBadgeDescriptions,
  defaultRankingsTimeline,
  defaultPurchasables,
  defaultInAppPurchasables,
  defaultVehicleDescriptions,
  vehicleAssetAliases,
  defaultVehiclePurchasablesByVehicle,
  defaultPerformanceLadders,
  defaultTuningBundleLadders,
  defaultCareerData,
  defaultPackManifestText,
  createOwnedVehicleStatus,
  getSupportedOwnedVehicleTags
} = require('./seedData');

function firstDefined(...values) {
  for (let index = 0; index < values.length; index += 1) {
    if (values[index] !== undefined && values[index] !== null) {
      return values[index];
    }
  }
  return undefined;
}

const currentItemKeys = {
  tyres: 'TyreId',
  brakes: 'BrakeId',
  engineCC: 'EngineCCId',
  intake: 'IntakeId',
  engineMap: 'EngineMapId',
  camshaft: 'CamshaftId',
  cylinderHead: 'CylinderHeadId',
  exhaust: 'ExhaustId',
  chassis: 'ChassisId',
  finalDrive: 'FinalDriveId',
  aero: 'AeroId',
  oil: 'OilId',
  alloys: 'AlloyId',
  glassStyle: 'GlassStyleId',
  licensePlate: 'LicensePlateId',
  paintJob: 'PaintJobId',
  steeringWheelCover: 'SteeringWheelCoverId',
  steeringWheel: 'SteeringWheelId',
  washAndWax: 'WaxId'
};

const ownedItemKeys = {
  tyres: 'OwnedTyreOptions',
  brakes: 'OwnedBrakeOptions',
  engineCC: 'EngineCCOptions',
  intake: 'IntakeOptions',
  engineMap: 'EngineMapOptions',
  camshaft: 'CamshaftOptions',
  cylinderHead: 'CylinderHeadOptions',
  exhaust: 'ExhaustOptions',
  chassis: 'ChassisOptions',
  finalDrive: 'FinalDriveOptions',
  aero: 'AeroOptions',
  oil: 'OwnedOilOptions',
  tuningBundle: 'OwnedTuningBundles',
  alloys: 'OwnedAlloyOptions',
  glassStyle: 'OwnedGlassStyles',
  licensePlate: 'OwnedLicensePlates',
  paintJob: 'OwnedPaintJobs',
  steeringWheelCover: 'OwnedSteeringWheelCovers',
  steeringWheel: 'OwnedSteeringWheels',
  toy: 'OwnedToys'
};

function nowTs() {
  return Math.floor(Date.now() / 1000);
}

function getServerAddress() {
  return config.getPublicHttpAddress();
}

function saveState() {
  persistState();
}

function getProfile(userId) {
  return userService.getProfile(userId);
}

function getUser(userId) {
  return userService.getUserState(userId);
}

function ensureVehicleStatus(profile, vehicleTag) {
  if (!profile.OwnedVehiclesStatus[vehicleTag]) {
    profile.OwnedVehiclesStatus[vehicleTag] = createOwnedVehicleStatus(vehicleTag);
  }
  return profile.OwnedVehiclesStatus[vehicleTag];
}

function normalizeGameVehicleTag(tag, fallbackTag = 'nissan_gtr_r35_2007') {
  return String(getSupportedOwnedVehicleTags([tag], fallbackTag)[0] || fallbackTag);
}

function buildStandaloneVehicleDescription(record) {
  if (!record || typeof record !== 'object') {
    return {};
  }

  const safe = clone(record);
  delete safe.MetaData;
  delete safe.metadata;

  if (safe.CarMetaData && typeof safe.CarMetaData === 'object') {
    const nested = clone(safe.CarMetaData);
    delete nested.CarMetaData;
    delete nested.MetaData;
    delete nested.metadata;
    safe.CarMetaData = nested;
  }

  return safe;
}

function getCurrentVehicleTag(userId) {
  const profile = getProfile(userId);
  return normalizeGameVehicleTag(
    profile.CurrentVehicleTag || profile.currentVehicleTag || 'nissan_gtr_r35_2007',
    'nissan_gtr_r35_2007'
  );
}

function getVehiclePurchasablesForTag(vehicleTag) {
  return clone(defaultVehiclePurchasablesByVehicle[vehicleTag] || []);
}

function findGeneralPurchasableById(itemId) {
  const numericId = parseInt(itemId, 10);
  if (Number.isNaN(numericId)) return null;
  for (let i = 0; i < defaultPurchasables.length; i += 1) {
    if (defaultPurchasables[i].id === numericId) return clone(defaultPurchasables[i]);
  }
  return null;
}

function findVehiclePurchasableById(vehicleTag, itemId) {
  const numericId = parseInt(itemId, 10);
  if (Number.isNaN(numericId)) return null;
  const items = defaultVehiclePurchasablesByVehicle[vehicleTag] || [];
  for (let i = 0; i < items.length; i += 1) {
    if (items[i].id === numericId) return clone(items[i]);
  }
  return null;
}

function findPurchasableById(userId, itemId) {
  const vehicleTag = getCurrentVehicleTag(userId);
  return findGeneralPurchasableById(itemId) || findVehiclePurchasableById(vehicleTag, itemId);
}

function findPurchasableByTag(itemTag) {
  for (let i = 0; i < defaultPurchasables.length; i += 1) {
    if (defaultPurchasables[i].itemTag === itemTag) return clone(defaultPurchasables[i]);
  }

  const vehicleTags = Object.keys(defaultVehiclePurchasablesByVehicle);
  for (let i = 0; i < vehicleTags.length; i += 1) {
    const items = defaultVehiclePurchasablesByVehicle[vehicleTags[i]] || [];
    for (let j = 0; j < items.length; j += 1) {
      if (items[j].itemTag === itemTag) return clone(items[j]);
    }
  }

  return null;
}

function parseStoreJson(options) {
  if (!options) return {};
  if (typeof options.storeJSON === 'string') {
    try {
      return JSON.parse(options.storeJSON);
    } catch (_) {
      return {};
    }
  }
  return options.storeJSON && typeof options.storeJSON === 'object' ? options.storeJSON : {};
}

function getRepairHealthValue(status, label) {
  if (label === 'bodywork') return status.BodyworkHealth;
  if (label === 'engine') return status.EngineHealth;
  if (label === 'oil') return status.OilHealth;
  if (label === 'tyres') return Math.min.apply(null, status.TyreHealth || [1]);
  if (label === 'brakes') return Math.min.apply(null, status.BrakeHealth || [1]);
  return 1;
}

function repairVehiclePart(status, label) {
  if (label === 'bodywork') status.BodyworkHealth = 1;
  if (label === 'engine') status.EngineHealth = 1;
  if (label === 'oil') status.OilHealth = 1;
  if (label === 'tyres') status.TyreHealth = [1, 1, 1, 1];
  if (label === 'brakes') status.BrakeHealth = [1, 1, 1, 1];
}

function repairAll(status) {
  repairVehiclePart(status, 'bodywork');
  repairVehiclePart(status, 'engine');
  repairVehiclePart(status, 'oil');
  repairVehiclePart(status, 'tyres');
  repairVehiclePart(status, 'brakes');
}

function getRepairCost(userId, label) {
  const profile = getProfile(userId);
  const status = ensureVehicleStatus(profile, getCurrentVehicleTag(userId));

  if (label === 'quickfix') {
    const labels = ['bodywork', 'engine', 'oil', 'tyres', 'brakes'];
    return labels.reduce(function (sum, key) {
      return sum + getRepairCost(userId, key);
    }, 0);
  }

  const health = getRepairHealthValue(status, label);
  return Math.max(0, Math.round((1 - health) * 2500));
}

function getRepairTime(userId, label) {
  const profile = getProfile(userId);
  const status = ensureVehicleStatus(profile, getCurrentVehicleTag(userId));
  const health = getRepairHealthValue(status, label);
  return Math.max(0, Math.round((1 - health) * 900));
}

function buildCurrentCarInfo(userId) {
  const profile = getProfile(userId);
  const vehicleTag = getCurrentVehicleTag(userId);
  const vehicle = defaultVehicleDescriptions[vehicleTag] || defaultVehicleDescriptions.gtr_r34;
  const assetTag = vehicleAssetAliases[vehicleTag] || vehicleTag;
  const status = ensureVehicleStatus(profile, vehicleTag);
  const carMetaData = buildStandaloneVehicleDescription(
    (defaultVehicleDescriptions[assetTag] && defaultVehicleDescriptions[assetTag].CarMetaData) ||
    defaultVehicleDescriptions[assetTag] ||
    vehicle
  );

  return {
    Tag: assetTag,
    tag: assetTag,
    Id: assetTag,
    id: assetTag,
    AssetTag: assetTag,
    VehicleTag: vehicleTag,
    AttributeTag: `car_attribute_${assetTag}`,
    PrefabName: `car_part_${assetTag}_a`,
    Name: vehicle.name,
    name: vehicle.name,
    CarMetaData: carMetaData,
    MetaData: clone(carMetaData),
    RightHandDrive: false,
    BasePISS: vehicle.BasePISS,
    ToyLocations: [
      { Id: 'dashboard', Name: 'Dashboard', Type: 'dash' }
    ],
    Status: clone(status),
    pissValues: {}
  };
}

function buildVehicleDescriptionMap() {
  const descriptions = {};

  Object.keys(defaultVehicleDescriptions).forEach((key) => {
    descriptions[key] = buildStandaloneVehicleDescription(defaultVehicleDescriptions[key]);
  });

  Object.keys(vehicleAssetAliases).forEach((shortTag) => {
    const assetTag = vehicleAssetAliases[shortTag];
    if (!descriptions[shortTag]) return;
    descriptions[shortTag].Tag = shortTag;
    descriptions[shortTag].tag = shortTag;
    descriptions[shortTag].Id = shortTag;
    descriptions[shortTag].id = shortTag;
    descriptions[shortTag].AssetTag = assetTag;
    descriptions[shortTag].AttributeTag = `car_attribute_${assetTag}`;
    descriptions[shortTag].PrefabName = `car_part_${assetTag}_a`;
    descriptions[shortTag].CarMetaData = buildStandaloneVehicleDescription(descriptions[shortTag]);
    if (!descriptions[assetTag]) {
      descriptions[assetTag] = Object.assign({}, descriptions[shortTag], {
        Tag: assetTag,
        tag: assetTag,
        Id: assetTag,
        id: assetTag,
        ShortTag: shortTag
      });
      descriptions[assetTag].CarMetaData = buildStandaloneVehicleDescription(descriptions[assetTag]);
    }
    descriptions[`car_attribute_${assetTag}`] = Object.assign({}, descriptions[assetTag], {
      Tag: `car_attribute_${assetTag}`,
      tag: `car_attribute_${assetTag}`,
      Id: `car_attribute_${assetTag}`,
      id: `car_attribute_${assetTag}`,
      LookupTag: assetTag
    });
    descriptions[`car_attribute_${assetTag}`].CarMetaData = buildStandaloneVehicleDescription(descriptions[`car_attribute_${assetTag}`]);
  });
  return descriptions;
}

function getCurrentVehiclePurchasables(userId) {
  const profile = getProfile(userId);
  const vehicleTag = getCurrentVehicleTag(userId);
  const status = ensureVehicleStatus(profile, vehicleTag);
  const items = getVehiclePurchasablesForTag(vehicleTag);

  return items.map(function (item) {
    const currentKey = currentItemKeys[item.itemType];
    const ownedKey = ownedItemKeys[item.itemType];
    const next = clone(item);

    if (ownedKey && Array.isArray(status[ownedKey])) {
      next.bought = status[ownedKey].indexOf(item.itemTag) !== -1;
    }

    if (currentKey) {
      next.current = status[currentKey] === item.itemTag;
    }

    if (item.itemType === 'toy') {
      next.current = Boolean(status.FittedToys && status.FittedToys.dashboard === item.itemTag);
    }

    if (item.itemType === 'tuningBundle') {
      next.bought = Array.isArray(status.OwnedTuningBundles) && status.OwnedTuningBundles.indexOf(item.itemTag) !== -1;
      next.current = next.bought;
    }

    return next;
  });
}

function getPurchasables(userId) {
  const profile = getProfile(userId);

  return clone(defaultPurchasables).map(function (item) {
    const next = clone(item);
    if (item.itemType === 'repair') {
      const label = item.itemTag.replace('#rp_', '');
      next.starCost = getRepairCost(userId, label);
    }
    if (item.itemType === 'vehicle') {
      next.bought = profile.OwnedVehicles.indexOf(item.itemTag) !== -1;
    }
    return next;
  });
}

function addUnique(list, value) {
  if (list.indexOf(value) === -1) {
    list.push(value);
  }
}

function chargePlayer(profile, item, coinPurchase) {
  const usesCoins = Boolean(coinPurchase || (item.cost !== undefined && item.starCost === undefined));
  const amount = usesCoins ? item.cost || 0 : item.starCost || 0;
  const walletKey = usesCoins ? 'NoCoins' : 'NoStars';

  if (amount <= 0) {
    return { ok: true, usesCoins: usesCoins };
  }

  if (profile[walletKey] < amount) {
    return { ok: false, status: usesCoins ? 'NotEnoughCoins' : 'NotEnoughStars' };
  }

  profile[walletKey] -= amount;
  return { ok: true, usesCoins: usesCoins };
}

function unlockVehicle(profile, user, vehicleTag) {
  if (profile.OwnedVehicles.indexOf(vehicleTag) === -1) {
    profile.OwnedVehicles.push(vehicleTag);
  }

  const status = ensureVehicleStatus(profile, vehicleTag);
  const purchaseOptions = user.vehiclePurchaseOptions[vehicleTag];
  if (purchaseOptions && purchaseOptions.paintJobTag) {
    status.PaintJobId = purchaseOptions.paintJobTag;
    addUnique(status.OwnedPaintJobs, purchaseOptions.paintJobTag);
  }
}

function equipVehicleItem(profile, vehicleTag, item) {
  const status = ensureVehicleStatus(profile, vehicleTag);
  const ownedKey = ownedItemKeys[item.itemType];
  const currentKey = currentItemKeys[item.itemType];

  if (ownedKey && Array.isArray(status[ownedKey])) {
    addUnique(status[ownedKey], item.itemTag);
  }

  if (currentKey) {
    status[currentKey] = item.itemTag;
  }

  if (item.itemType === 'toy') {
    addUnique(status.OwnedToys, item.itemTag);
    status.FittedToys.dashboard = item.itemTag;
  }

  if (item.itemType === 'tuningBundle') {
    addUnique(status.OwnedTuningBundles, item.itemTag);
    Object.keys(currentItemKeys).forEach(function (key) {
      if (item[key]) {
        const childItem = findPurchasableByTag(item[key]);
        if (childItem) equipVehicleItem(profile, vehicleTag, childItem);
      }
    });
  }

  status.PISS = Math.min(999, status.PISS + 12);
}

function unlockDriverItem(profile, item) {
  if (item.itemType === 'helmet') {
    addUnique(profile.OwnedDriverHelmets, item.itemTag);
    profile.CurrentDriverHelmet = item.itemTag;
  } else if (item.itemType === 'suit') {
    addUnique(profile.OwnedDriverSuits, item.itemTag);
    profile.CurrentDriverSuit = item.itemTag;
  } else if (item.itemType === 'gloves') {
    addUnique(profile.OwnedDriverGloves, item.itemTag);
    profile.CurrentDriverGloves = item.itemTag;
  }
}

function applyPurchase(userId, itemId, coinPurchase, freePurchase) {
  const user = getUser(userId);
  const profile = getProfile(userId);
  const vehicleTag = getCurrentVehicleTag(userId);
  const item = findPurchasableById(userId, itemId);

  if (!item) return 'NotAvailable';
  if (item.unlockRank && profile.Rank < item.unlockRank) return 'RankTooLow';
  if (item.isVIP && !profile.IsVIP) return 'VIPOnly';

  if (item.itemType === 'vehicle' && profile.OwnedVehicles.indexOf(item.itemTag) !== -1) {
    return 'AlreadyGot';
  }

  const payment = freePurchase ? { ok: true } : chargePlayer(profile, item, coinPurchase);
  if (!payment.ok) return payment.status;

  if (item.itemType === 'fillfueltank') {
    profile.Fuel = profile.MaxFuel;
  } else if (item.itemType === 'coins') {
    profile.NoCoins += 100;
  } else if (item.itemType === 'stars') {
    profile.NoStars += 5000;
  } else if (item.itemType === 'vehicle') {
    unlockVehicle(profile, user, item.itemTag);
  } else if (item.itemType === 'repair') {
    const status = ensureVehicleStatus(profile, vehicleTag);
    const label = item.itemTag.replace('#rp_', '');
    if (label === 'quickfix') {
      repairAll(status);
    } else {
      repairVehiclePart(status, label);
    }
  } else if (item.itemType === 'helmet' || item.itemType === 'suit' || item.itemType === 'gloves') {
    unlockDriverItem(profile, item);
  } else {
    equipVehicleItem(profile, vehicleTag, item);
  }

  saveState();
  return 'Success';
}

function handleInAppPurchase(userId, itemId) {
  const numericId = parseInt(itemId, 10);
  const profile = getProfile(userId);
  const item = defaultInAppPurchasables.filter(function (candidate) {
    return candidate.id === numericId;
  })[0];

  if (!item) return 'failed';

  if (item.itemType === 'coins') {
    profile.NoCoins += item.amount;
  } else if (item.itemType === 'stars') {
    profile.NoStars += item.amount;
  } else if (item.itemType === 'vip') {
    profile.IsVIP = true;
  }

  saveState();
  return 'success';
}

function getCurrentPiss(userId, options) {
  const profile = getProfile(userId);
  const vehicleTag = getCurrentVehicleTag(userId);
  const status = ensureVehicleStatus(profile, vehicleTag);
  let piss = status.PISS;

  if (options && options.itemTag) {
    piss += 15;
  }

  return { piss: piss };
}

function getBasePiss(userId) {
  const vehicleTag = getCurrentVehicleTag(userId);
  const vehicle = defaultVehicleDescriptions[vehicleTag] || defaultVehicleDescriptions.gtr_r34;
  return { piss: vehicle.BasePISS };
}

function getPerformanceBandRange(options) {
  const minPiss = options && options.minPiss ? parseInt(options.minPiss, 10) : 0;
  const maxPiss = options && options.maxPiss ? parseInt(options.maxPiss, 10) : minPiss;
  const top = Math.max(minPiss, maxPiss);

  if (top >= 620) return ['A'];
  if (top >= 540) return ['B'];
  if (top >= 420) return ['C'];
  return ['D'];
}

function handleSetCurrentCarItem(userId, options) {
  const profile = getProfile(userId);
  const vehicleTag = getCurrentVehicleTag(userId);
  const status = ensureVehicleStatus(profile, vehicleTag);
  const currentKey = currentItemKeys[options && options.type];
  const ownedKey = ownedItemKeys[options && options.type];

  if (ownedKey && Array.isArray(status[ownedKey]) && options && options.tag) {
    addUnique(status[ownedKey], options.tag);
  }
  if (currentKey && options && options.tag) {
    status[currentKey] = options.tag;
  }

  saveState();
  return true;
}

function handleSetCurrentDriverItem(userId, options) {
  const profile = getProfile(userId);
  if (!options || !options.type || !options.tag) return false;

  if (options.type === 'helmet') {
    addUnique(profile.OwnedDriverHelmets, options.tag);
    profile.CurrentDriverHelmet = options.tag;
  }
  if (options.type === 'suit') {
    addUnique(profile.OwnedDriverSuits, options.tag);
    profile.CurrentDriverSuit = options.tag;
  }
  if (options.type === 'gloves') {
    addUnique(profile.OwnedDriverGloves, options.tag);
    profile.CurrentDriverGloves = options.tag;
  }

  saveState();
  return true;
}

function handleSetVehicle(userId, options) {
  const profile = getProfile(userId);
  const requestedVehicleValue = String(
    options && (
      options.vehicleTag ||
      options.tag ||
      options.carId ||
      options.id ||
      options._id
    ) || ''
  ).trim();
  if (!requestedVehicleValue) return false;

   const user = getUser(userId);
   const carsRoot =
     user &&
     user.sparx &&
     user.sparx.dataStore &&
     user.sparx.dataStore.cars &&
     typeof user.sparx.dataStore.cars === 'object'
       ? user.sparx.dataStore.cars
       : {};
   let selectedRecord = null;
   const requestedVehicleValueLower = requestedVehicleValue.toLowerCase();

   Object.values(carsRoot).some((bucket) => {
     if (!bucket || typeof bucket !== 'object') return false;
     return Object.values(bucket).some((record) => {
       const recordCandidates = [
         record && record._id,
         record && record.id,
         record && record.carId,
         record && record.car,
         record && record.AssetTag,
         record && record.assetTag,
         record && record.Tag,
         record && record.tag,
         record && record.CurrentVehicleTag,
         record && record.currentVehicleTag,
         record && record.r && record.r.n,
         record && record.recipe && record.recipe.n
       ]
         .map((value) => String(value || '').trim().toLowerCase())
         .filter(Boolean);
       if (!recordCandidates.includes(requestedVehicleValueLower)) return false;
       selectedRecord = clone(record);
       return true;
     });
   });

  const normalizedVehicleTag = normalizeGameVehicleTag(
    firstDefined(
      selectedRecord && (selectedRecord.carId || selectedRecord.car || (selectedRecord.r && selectedRecord.r.n) || (selectedRecord.recipe && selectedRecord.recipe.n)),
      requestedVehicleValue
    )
  );
  profile.CurrentVehicleTag = normalizedVehicleTag;
  profile.currentVehicleTag = normalizedVehicleTag;
  profile.UsingOwnedVehicle = Boolean(options && options.ownedVehicle !== undefined ? options.ownedVehicle : true);
  ensureVehicleStatus(profile, normalizedVehicleTag);

   if (selectedRecord) {
     const activeCarId = String(selectedRecord._id || selectedRecord.id || '');
     const activeRecipe = Number(
       (selectedRecord.active_recipe) ||
       (selectedRecord.r && selectedRecord.r.hash) ||
       (selectedRecord.recipe && selectedRecord.recipe.hash) ||
       0
     );
     profile.active_carid = activeCarId;
     profile.activeCarId = activeCarId;
     profile.active_recipe = activeRecipe;
     profile.lastRequestedCarId = activeCarId;
     profile.LastRequestedCarId = activeCarId;

     if (user && user.sparx && user.sparx.dataStore && typeof user.sparx.dataStore === 'object') {
       if (!user.sparx.dataStore.profile || typeof user.sparx.dataStore.profile !== 'object') {
         user.sparx.dataStore.profile = {};
       }
       user.sparx.dataStore.profile.CurrentVehicleTag = normalizedVehicleTag;
       user.sparx.dataStore.profile.currentVehicleTag = normalizedVehicleTag;
       user.sparx.dataStore.profile.active_carid = activeCarId;
       user.sparx.dataStore.profile.activeCarId = activeCarId;
       user.sparx.dataStore.profile.active_recipe = activeRecipe;
       user.sparx.dataStore.profile.lastRequestedCarId = activeCarId;
       user.sparx.dataStore.profile.LastRequestedCarId = activeCarId;
       user.sparx.dataStore.car = clone(selectedRecord);
     }
   }

  saveState();
  return true;
}

function handleSetVehicleConfig(userId, options) {
  if (!options || !options.vehicleTag) return false;
  const profile = getProfile(userId);
  const status = ensureVehicleStatus(profile, options.vehicleTag);
  status.ConfigurationIndex = parseInt(options.index || 0, 10) || 0;
  saveState();
  return true;
}

function handleSetCurrentCarIndexByTag(userId, options) {
  if (!options || !options.tag) return false;
  return handleSetVehicle(userId, {
    vehicleTag: options.tag,
    ownedVehicle: true
  });
}

function handleFitVehicleToy(userId, options) {
  const profile = getProfile(userId);
  const vehicleTag = getCurrentVehicleTag(userId);
  const status = ensureVehicleStatus(profile, vehicleTag);
  const toyTag = options && options.toyTag;
  const locationId = options && options.locationId ? options.locationId : 'dashboard';

  if (!toyTag) return false;

  addUnique(status.OwnedToys, toyTag);
  status.FittedToys[locationId] = toyTag;
  saveState();
  return true;
}

function buildLeaderboard(articleId) {
  return {
    currentLeaderBoard: 'global',
    global: {
      players: [
        { nickName: 'NightShift', score: 15600, rank: 1 },
        { nickName: 'R34Hero', score: 14990, rank: 2 },
        { nickName: 'You', score: 13750, rank: 3 }
      ]
    },
    friends: {
      players: [
        { nickName: 'You', score: 13750, rank: 1 },
        { nickName: 'RacerTwo', score: 12880, rank: 2 }
      ]
    },
    articleId: String(articleId || '')
  };
}

function buildRewardsForArticle(article) {
  if (article && article.type === 'globalcommunity') {
    return [
      { description: 'Reach the Gold bracket', stars: 1500, coins: 20 }
    ];
  }

  return [
    { description: article && article.event && article.event.targetDescription ? article.event.targetDescription : 'Finish the event', stars: 2000, coins: 40 }
  ];
}

function getCareerArticleList() {
  return clone(defaultCareerData.articleList || [])
    .sort((left, right) => Number(left && left.id || 0) - Number(right && right.id || 0));
}

function resolveCurrentCareerArticleId(userId, articles) {
  const user = getUser(userId);
  const profile = getProfile(userId);
  const validIds = new Set((articles || []).map((article) => String(article && article.id || '')));
  const wonRaces = profile && profile.won_races && typeof profile.won_races === 'object'
    ? profile.won_races
    : {};
  const candidates = [
    profile && profile.current_race_id,
    profile && profile.currentRaceId,
    profile && profile.CurrentRaceId,
    profile && profile.crid,
    profile && profile.jfrid,
    profile && profile.LastPlayedCareerArticleId,
    user && user.currentArticleId
  ]
    .map((value) => String(value == null ? '' : value).trim())
    .filter((value) => /^\d+$/.test(value) && validIds.has(value));

  if (candidates.length > 0) {
    return Number(candidates[0]);
  }

  const firstUnwon = (articles || []).find((article) => !wonRaces[String(article && article.id || '')]);
  if (firstUnwon) {
    return Number(firstUnwon.id || 0);
  }

  return Number((articles && articles[0] && articles[0].id) || 0);
}

function buildRuntimeCareerData(userId) {
  const base = clone(defaultCareerData);
  const profile = getProfile(userId);
  const articles = getCareerArticleList();
  const wonRaces = profile && profile.won_races && typeof profile.won_races === 'object'
    ? profile.won_races
    : {};
  const currentArticleId = resolveCurrentCareerArticleId(userId, articles);

  base.articleList = articles.map((article, index) => {
    const articleId = String(article && article.id || '');
    const completed = Boolean(wonRaces[articleId]);
    const unlocked = index === 0 || articles.slice(0, index).every((entry) => wonRaces[String(entry && entry.id || '')]);
    return Object.assign({}, article, {
      chapterNumber: Number(article && article.chapterNumber || 1),
      ChapterNumber: Number(article && article.chapterNumber || 1),
      chapterNum: Number(article && article.chapterNumber || 1),
      completed,
      Complete: completed,
      unlocked,
      Unlocked: unlocked,
      playable: unlocked,
      current: Number(article && article.id || 0) === currentArticleId,
      Current: Number(article && article.id || 0) === currentArticleId
    });
  });

  const chapters = (((base.articleStructure || {}).careerChapters) || []).map((chapter, index) => {
    const chapterNum = Number(
      (chapter && (
        chapter.num ||
        chapter.number ||
        chapter.chapterNumber ||
        chapter.chapterNum ||
        chapter.chapterIndex
      )) || (index + 1)
    );
    const articleIds = Array.isArray(chapter && chapter.events)
      ? chapter.events.flatMap((event) => Array.isArray(event && event.articleIdList) ? event.articleIdList : [])
      : [];
    const finished = articleIds.reduce((count, articleId) => (
      wonRaces[String(articleId)] ? count + 1 : count
    ), 0);
    const chapterName = String(
      (chapter && chapter.name) ||
      (chapter && chapter.chapterName) ||
      `chapter_${String(chapterNum).padStart(2, '0')}`
    );
    return Object.assign({}, chapter, {
      name: chapterName,
      chapterName,
      ChapterName: chapterName,
      num: chapterNum,
      number: chapterNum,
      chapterNumber: chapterNum,
      chapterNum,
      chapterIndex: chapterNum,
      articlesFinished: finished,
      articlesTotal: articleIds.length,
      currentArticleId,
      CurrentArticleId: currentArticleId,
      LastPlayedCareerArticleId: Number(profile && profile.LastPlayedCareerArticleId || currentArticleId || 0),
      beastDefeated: finished > 0
    });
  });

  base.articleStructure = Object.assign({}, base.articleStructure || {}, {
    currentArticleId,
    CurrentArticleId: currentArticleId,
    LastPlayedCareerArticleId: Number(profile && profile.LastPlayedCareerArticleId || currentArticleId || 0),
    careerChapters: chapters
  });

  return base;
}

function getRuntimeCurrentCareerArticle(userId) {
  const runtimeCareerData = buildRuntimeCareerData(userId);
  const currentArticleId = Number(
    (((runtimeCareerData || {}).articleStructure || {}).currentArticleId) ||
    ((((runtimeCareerData || {}).articleList || [])[0] || {}).id) ||
    0
  );
  return (runtimeCareerData.articleList || []).find((article) => Number(article && article.id || 0) === currentArticleId) || null;
}

function buildArticleEventData(articleId) {
  const article = articleService.findArticle(articleId);
  return {
    rewards: buildRewardsForArticle(article),
    leaderboard: buildLeaderboard(articleId),
    target: {
      description: article && article.event && article.event.targetDescription ? article.event.targetDescription : 'Complete the event',
      progress: 0,
      goal: 1
    }
  };
}

function buildArticlePurchasableVehicles(articleId, userId) {
  const article = articleService.findArticle(articleId);
  const profile = getProfile(userId);
  const vehicles = getPurchasables(userId).filter(function (item) {
    return item.itemType === 'vehicle' && profile.OwnedVehicles.indexOf(item.itemTag) === -1;
  });

  if (article && Array.isArray(article.vehicleTags) && article.vehicleTags.length) {
    return vehicles.filter(function (item) {
      return article.vehicleTags.indexOf(item.itemTag) !== -1;
    });
  }

  return vehicles;
}

function handleGetServerStatus() {
  return {
    LoggedInToServer: true,
    NetConnection: true,
    '3GConnection': false,
    ClientUpdateNeeded: false,
    ServerAddress: getServerAddress(),
    ServerString: 'LOCAL DEV',
    ts: nowTs()
  };
}

function handleGameFunction(funcName, options, userId) {
  const name = String(funcName || '');
  const user = getUser(userId);
  const profile = getProfile(userId);

  switch (name) {
    case 'GetServerStatus':
      return handleGetServerStatus();

    case 'ValidateAgainstServerTime':
      return {
        InvalidTime: false,
        ServerTime: nowTs()
      };

    case 'GetBuildInfoString':
      return {
        BuildInfo: 'client_server_rebuild / bridge-emulation / 1.0.0'
      };

    case 'GetLocalisationDictionary':
      return buildTranslationDictionary();

    case 'GetGlobalUIData':
      return clone(defaultGlobalUiData);

    case 'GetProfile':
      return clone(profile);

    case 'GetBadgeDescriptions':
      return clone(defaultBadgeDescriptions);

    case 'GetNotifications':
      return clone(user.notifications);

    case 'GetServerNotifications':
      return clone(user.serverNotifications);

    case 'GetPersistentStore':
      return clone(user.persistentStore);

    case 'SetPersistentStore':
      user.persistentStore = parseStoreJson(options);
      saveState();
      return true;

    case 'GetSessionStore':
      return clone(user.sessionStore);

    case 'SetSessionStore':
      user.sessionStore = parseStoreJson(options);
      saveState();
      return true;

    case 'GetVehicleDescriptions':
      return buildVehicleDescriptionMap();

    case 'GetPurchasables':
      return getPurchasables(userId);

    case 'GetCurrentVehiclePurchasables':
      return getCurrentVehiclePurchasables(userId);

    case 'GetInAppPurchasables':
      return clone(defaultInAppPurchasables);

    case 'PurchaseItem':
      return applyPurchase(userId, options && options.itemId, options && options.coinPurchase, false);

    case 'GiftItem':
      return applyPurchase(userId, options && options.itemId, options && options.coinPurchase, true);

    case 'PurchaseInAppItem':
      return handleInAppPurchase(userId, options && options.itemId);

    case 'RestorePurchases':
      return 'success';

    case 'GetRepairCost':
      return getRepairCost(userId, options && options.label);

    case 'GetRepairTime':
      return getRepairTime(userId, options && options.label);

    case 'GetCurrentCarInfo':
      return buildCurrentCarInfo(userId);

    case 'GetCurrentCarPISS':
      return getCurrentPiss(userId, options);

    case 'GetBaseCarPISS':
    case 'ShowroomGetBaseCarPISS':
      return getBasePiss(userId);

    case 'GetPerformanceBandRange':
      return getPerformanceBandRange(options || {});

    case 'GetPurchasablePerformanceLadders':
      return clone(defaultPerformanceLadders);

    case 'GetPurchasableTuningBundleLadders':
      return clone(defaultTuningBundleLadders);

    case 'SetVehicle':
      return handleSetVehicle(userId, options);

    case 'SetVehicleConfig':
      return handleSetVehicleConfig(userId, options);

    case 'SetCurrentCarIndexByTag':
      return handleSetCurrentCarIndexByTag(userId, options);

    case 'SetCurrentCarItem':
      return handleSetCurrentCarItem(userId, options);

    case 'SetCurrentDriverItem':
      return handleSetCurrentDriverItem(userId, options);

    case 'FitVehicleToy':
      return handleFitVehicleToy(userId, options);

    case 'SetVehiclePurchaseOptions':
      if (options && options.vehicleTag) {
        user.vehiclePurchaseOptions[options.vehicleTag] = clone(options.options || {});
        saveState();
      }
      return true;

    case 'FillFuelTank':
      profile.Fuel = profile.MaxFuel;
      saveState();
      return true;

    case 'SpendFuel': {
      const amount = Math.max(0, parseInt(options && options.amount, 10) || 0);
      profile.Fuel = Math.max(0, profile.Fuel - amount);
      saveState();
      return true;
    }

    case 'GetRankingsTimeline':
      return clone(defaultRankingsTimeline);

    case 'GetCurrentArticle':
      return articleService.findArticle(user.currentArticleId) || getRuntimeCurrentCareerArticle(userId);

    case 'GetIndividualArticleData':
      return articleService.getArticleById(options && options.articleId);

    case 'GetCachedArticles':
      return articleService.getArticlesByIds(options && options.articleIds);

    case 'GetCachedArticlesList':
      return {
        ArticleIds: articleService.getAllArticleIds()
      };

    case 'GetCareerArticles':
      {
        const runtimeCareerData = buildRuntimeCareerData(userId);
        const currentArticleId = Number(
          (((runtimeCareerData || {}).articleStructure || {}).currentArticleId) || 0
        );
        if (currentArticleId > 0 && user.currentArticleId !== currentArticleId) {
          user.currentArticleId = currentArticleId;
          profile.LastPlayedCareerArticleId = currentArticleId;
          saveState();
        }
        return runtimeCareerData;
      }

    case 'GetCareerArticleStructure':
      {
        const runtimeCareerData = buildRuntimeCareerData(userId);
        const currentArticleId = Number(
          (((runtimeCareerData || {}).articleStructure || {}).currentArticleId) || 0
        );
        if (currentArticleId > 0 && user.currentArticleId !== currentArticleId) {
          user.currentArticleId = currentArticleId;
          profile.LastPlayedCareerArticleId = currentArticleId;
          saveState();
        }
        return runtimeCareerData;
      }

    case 'GetArticleEventData':
      return buildArticleEventData(options && options.articleId);

    case 'GetArticlePurchasableVehicles':
      return buildArticlePurchasableVehicles(options && options.articleId, userId);

    case 'GetPreviousRaceResults':
      return clone(user.previousRaceResults);

    case 'GetLaunchOptions':
      return clone(user.launchOptions);

    case 'CacheLaunchOptionsForNull':
      if (options && Object.keys(user.launchOptions).length === 0) {
        user.launchOptions = clone(options);
        saveState();
      }
      return true;

    case 'SetReturnURL':
      user.persistentStore.returnURL = options && options.url ? options.url : '';
      saveState();
      return true;

    case 'SetLocation':
      user.locationId = parseInt(options && options.locationId, 10) || 0;
      saveState();
      return true;

    case 'NumLocations':
      return 3;

    case 'PlacesPhotoPath':
    case 'GetRaceFaceLocationOnDisc':
      return '/media/photo-placeholder.svg';

    case 'GetFacebookLoggedIn':
      return Boolean(user.facebookLoggedIn);

    case 'UserSignIn':
    case 'RetryInternetConnection':
      return true;

    case 'RegisterArticleRead':
      if (options && options.articleId) {
        const articleId = String(options.articleId);
        if (!profile.ArticleStatus[articleId]) {
          profile.ArticleStatus[articleId] = {};
        }
        profile.ArticleStatus[articleId].LastTimePlayed = nowTs();
        if (/^\d+$/.test(articleId)) {
          profile.LastPlayedCareerArticleId = Number(articleId);
          user.currentArticleId = Number(articleId);
        }
        saveState();
      }
      return true;

    case 'OptInToGlobalArticle':
      return true;

    case 'GetServerData':
    case 'GetArticleData':
      return articleService.dispatchBridgeMethod(options && options.method, userId);

    case 'RunArticle':
    case 'RunGhostArticle':
    case 'RunCareerTieredEvent':
    case 'RunCareerLicenceArticle':
    case 'LaunchTestDriveEvent':
    case 'LaunchProvingGroundsEvent':
      if (options && options.articleId) {
        user.currentArticleId = parseInt(options.articleId, 10) || user.currentArticleId;
        if (/^\d+$/.test(String(options.articleId))) {
          profile.LastPlayedCareerArticleId = Number(options.articleId);
        }
      }
      saveState();
      return {
        started: true,
        funcName: name,
        articleId: user.currentArticleId
      };

    case 'GoToGarage':
    case 'GoToShowroom':
    case 'GoToPlace':
      user.launchOptions = clone(options || {});
      saveState();
      return true;

    case 'SwitchCar':
    case 'LoadCar':
    case 'LoadPlacesCar':
    case 'GarageIsReady':
    case 'EndLoadingScreen':
    case 'StartLoadingScreen':
    case 'EnableInactivityTimer':
    case 'DisableInactivityTimer':
    case 'AllInvisibleSelected':
    case 'ExternalSelected':
    case 'InternalSelected':
    case 'DriverSelected':
    case 'TuningSelected':
    case 'HUDAwardsContinue':
    case 'HUDAwardsRestart':
    case 'ShowPlayHavenContent':
    case 'Show2KGamesStorefront':
    case 'ShowInviteFriendsPage':
    case 'GotoAppStore':
    case 'InviteFacebookFriends':
    case 'LaunchCamera':
    case 'LaunchCameraRoll':
    case 'TakePhoto':
    case 'PlacesShareFacebook':
    case 'PlacesShareTwitter':
    case 'PostFacebookPost':
    case 'PostFacebookStatusUpdate':
    case 'postFacebookExternalImage':
    case 'SendTweet':
    case 'SendAbuseEmail':
    case 'SendAnalyticsScreen':
    case 'DebugPrint':
    case 'DebugSetHealth':
    case 'SendAnalyticsEvent':
    case 'PlayUiSound':
    case 'SetTouchPassThroughRect':
    case 'PreviewCurrentCarItem':
    case 'PreviewCurrentDriverItem':
    case 'PreviewVehicleToy':
    case 'MagazineStarted':
    case 'PostEventProgressEventsThrown':
    case 'PostEventWalletShown':
    case 'SavePlaceStatsTracker':
    case 'FacebookLogin':
      return true;

    case 'FacebookLogout':
      user.facebookLoggedIn = false;
      saveState();
      return true;

    case 'AddPersistantSound': {
      const handle = user.soundState.nextHandle++;
      user.soundState.handles[String(handle)] = clone(options || {});
      saveState();
      return handle;
    }

    case 'StartPersistantSound':
    case 'StopPersistantSound':
    case 'RemovePersistantSound':
      return true;

    case 'SetActiveItemTypes':
      return clone(options && options.types ? options.types : []);

    case 'Quit':
      return true;

    default:
      return {
        success: false,
        error: 'UnknownGameFunction',
        funcName: name,
        options: options || null
      };
  }
}

function handleRunQueue(body, userId) {
  const commands = Array.isArray(body) ? body : Array.isArray(body.commands) ? body.commands : [];
  return {
    success: true,
    results: commands.map(function (command) {
      return {
        commandId: command.commandId,
        deferId: 0,
        results: handleGameFunction(command.funcName, command.options, userId)
      };
    })
  };
}

function getPackManifestText() {
  return defaultPackManifestText;
}

module.exports = {
  handleGameFunction,
  handleRunQueue,
  handleGetServerStatus,
  getPackManifestText
};
