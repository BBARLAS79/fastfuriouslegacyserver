const crypto = require('crypto');
const config = require('../config');
const { persistState } = require('../store');
const { store } = require('../store');
const { compactCar, compactProfile, compactRace, logFf7Debug } = require('../lib/ff7Debug');
const extractedTutorialDb = require('../data/ff7_210_tutorial_db.json');
const { getUserState, getProfile } = require('./userService');
const { clone, defaultVehicleDescriptions, vehicleMetaTemplates, vehicleAssetAliases, getDefaultRecipeArrays, getVehicleMetaTemplate, ff7TutorialConfig, createOwnedVehicleStatus, buildOwnedVehicleCondition, getCanonicalVehiclePi, getSupportedOwnedVehicleTags, createOwnedVehicleRecordId, deriveInternalUid, defaultCareerData, defaultChallengeArticles, defaultRandomChallengeArticles, defaultVehiclePurchasablesByVehicle, pickDeterministicVariant, getStoryArticleRaceId } = require('./seedData');
const {
  buildVisualUpgradeTuningPayload,
  buildGameStoreRefreshPayload,
  buildOwnedVisualUpgradeInventory,
  buildMechanicsDataPayload,
  buildCarUpgradesLoginPayload,
  buildAlliancePayload,
  buildChatTokenPayload,
  sanitizeOwnedVehicleStatus
} = require('./sparxApiService');

function normalizeProfilePicRef(ppti) {
  const raw = String(ppti || '').trim();
  if (!raw) return '';
  if (raw.startsWith('http://') || raw.startsWith('https://') || raw.startsWith('/')) return raw;
  return raw;
}

function buildLegacyLevelRewardsStateFromProfile(profile = {}) {
  const level = Number(profile.level || profile.Level || profile.PlayerLevel || profile.Rank || 1);
  const nextLevelXp = Number(profile.nextLevelXP || profile.NextLevelXP || 1000);
  const prevLevelXp = Number(
    profile.prevLevelXP ||
    profile.PrevLevelXP ||
    (level > 1 ? Math.max(0, nextLevelXp - 1000) : 0)
  );
  return {
    xp: {
      last_awarded_level: Math.max(0, Math.trunc(level)),
      nextLevelXp: Math.max(0, Math.trunc(nextLevelXp)),
      prevLevelXp: Math.max(0, Math.min(Math.trunc(prevLevelXp), Math.trunc(nextLevelXp)))
    }
  };
}

function buildLegacyResourceEntry(amount, max = 0) {
  return {
    v: Math.max(0, Math.trunc(Number(amount || 0))),
    max: Math.max(0, Math.trunc(Number(max || 0))),
    nextGrowthAmount: 0,
    nextGrowthTime: 0,
    nextFullGrowthTime: 0,
    growthInterval: 0
  };
}

const FF7_EARLY_TUTORIAL_RESOURCE_DEFAULTS = Object.freeze({
  sc: 200,
  hc: 100,
  fuel: 2,
  maxFuel: 10,
  reserveFuel: 2
});

function applyEarlyTutorialResourceDefaults(profile = {}) {
  if (!profile || typeof profile !== 'object') return false;

  const level = Number(profile.level || profile.Level || profile.PlayerLevel || profile.Rank || 1);
  const sc = Number(profile.NoCoins || profile.coins || 0);
  const hc = Number(profile.NoStars || profile.gold || 0);
  const fuel = Number(profile.Fuel || profile.fuel || 0);

  if (level > 1 || sc > 0 || hc > 0 || fuel > 0) {
    return false;
  }

  let changed = false;
  if (Number(profile.NoCoins || 0) !== FF7_EARLY_TUTORIAL_RESOURCE_DEFAULTS.sc) {
    profile.NoCoins = FF7_EARLY_TUTORIAL_RESOURCE_DEFAULTS.sc;
    changed = true;
  }
  if (Number(profile.coins || 0) !== FF7_EARLY_TUTORIAL_RESOURCE_DEFAULTS.sc) {
    profile.coins = FF7_EARLY_TUTORIAL_RESOURCE_DEFAULTS.sc;
    changed = true;
  }
  if (Number(profile.NoStars || 0) !== FF7_EARLY_TUTORIAL_RESOURCE_DEFAULTS.hc) {
    profile.NoStars = FF7_EARLY_TUTORIAL_RESOURCE_DEFAULTS.hc;
    changed = true;
  }
  if (Number(profile.gold || 0) !== FF7_EARLY_TUTORIAL_RESOURCE_DEFAULTS.hc) {
    profile.gold = FF7_EARLY_TUTORIAL_RESOURCE_DEFAULTS.hc;
    changed = true;
  }
  if (Number(profile.stars || 0) !== FF7_EARLY_TUTORIAL_RESOURCE_DEFAULTS.hc) {
    profile.stars = FF7_EARLY_TUTORIAL_RESOURCE_DEFAULTS.hc;
    changed = true;
  }
  if (Number(profile.Fuel || 0) !== FF7_EARLY_TUTORIAL_RESOURCE_DEFAULTS.fuel) {
    profile.Fuel = FF7_EARLY_TUTORIAL_RESOURCE_DEFAULTS.fuel;
    changed = true;
  }
  if (Number(profile.fuel || 0) !== FF7_EARLY_TUTORIAL_RESOURCE_DEFAULTS.fuel) {
    profile.fuel = FF7_EARLY_TUTORIAL_RESOURCE_DEFAULTS.fuel;
    changed = true;
  }
  if (Number(profile.MaxFuel || 0) !== FF7_EARLY_TUTORIAL_RESOURCE_DEFAULTS.maxFuel) {
    profile.MaxFuel = FF7_EARLY_TUTORIAL_RESOURCE_DEFAULTS.maxFuel;
    changed = true;
  }
  if (Number(profile.maxFuel || 0) !== FF7_EARLY_TUTORIAL_RESOURCE_DEFAULTS.maxFuel) {
    profile.maxFuel = FF7_EARLY_TUTORIAL_RESOURCE_DEFAULTS.maxFuel;
    changed = true;
  }
  if (Number(profile.ReserveFuel || 0) !== FF7_EARLY_TUTORIAL_RESOURCE_DEFAULTS.reserveFuel) {
    profile.ReserveFuel = FF7_EARLY_TUTORIAL_RESOURCE_DEFAULTS.reserveFuel;
    changed = true;
  }
  if (Number(profile.reserveFuel || 0) !== FF7_EARLY_TUTORIAL_RESOURCE_DEFAULTS.reserveFuel) {
    profile.reserveFuel = FF7_EARLY_TUTORIAL_RESOURCE_DEFAULTS.reserveFuel;
    changed = true;
  }

  return changed;
}

function buildLegacyResourcesStateFromProfile(profile = {}) {
  const xp = Number(profile.currentXP || profile.xp || profile.XP || 0);
  const nextLevelXp = Number(profile.nextLevelXP || profile.NextLevelXP || 1000);
  const sc = Number(profile.NoCoins || profile.coins || 0);
  const hc = Number(profile.NoStars || profile.gold || 0);
  const fuel = Number(profile.Fuel || profile.fuel || 0);
  const maxFuel = Number(profile.MaxFuel || profile.maxFuel || 10);
  const ownedVehicleCount = Array.isArray(profile.OwnedVehicles)
    ? Array.from(new Set(profile.OwnedVehicles.map((tag) => String(tag || '').trim()).filter(Boolean))).length
    : 0;
  const maxCars = Math.max(
    Number(
      profile.maxcars ||
      profile.maxCars ||
      profile.MaxCars ||
      profile.MaxOwnedCars ||
      0
    ),
    ownedVehicleCount
  );
  const maxMechanics = Math.max(
    1,
    Math.trunc(Number(
      profile.maxmechanics ||
      profile.maxMechanics ||
      profile.MaxMechanics ||
      profile.MaxOwnedMechanics ||
      2
    ) || 2)
  );
  const resources = {
    xp: buildLegacyResourceEntry(xp, nextLevelXp),
    sc: buildLegacyResourceEntry(sc, 0),
    hc: buildLegacyResourceEntry(hc, 0),
    fuel: buildLegacyResourceEntry(fuel, maxFuel)
  };
  if (maxCars > 0) {
    resources.maxcars = buildLegacyResourceEntry(maxCars, maxCars);
  }
  if (maxMechanics > 0) {
    resources.maxmechanics = buildLegacyResourceEntry(maxMechanics, maxMechanics);
  }
  return resources;
}

function buildLegacyStyleBonusLevels() {
  const neutralPrize = (name) => ({
    t: 'res',
    n: String(name || 'sc'),
    q: 0
  });
  const neutralBonusLevel = (level) => ({
    level_num: Number(level),
    required_xp: 0,
    prizes: [
      neutralPrize('sc'),
      neutralPrize('up')
    ]
  });
  return {
    style1: [neutralBonusLevel(1)],
    style2: [neutralBonusLevel(1)],
    style3: [neutralBonusLevel(1)],
    style4: [neutralBonusLevel(1)],
    style5: [neutralBonusLevel(1)],
    style6: [neutralBonusLevel(1)]
  };
}

const G1_RACE_ID = 'chapter_00_a';
const G1_CSPD_FALLBACK = 'ID_STORY_CHAPTER_0_PRE_1A:WSO|0|ROMAN|ID_STORY_CHAPTER_0_PRE_1A|ID_UI_PRERACE_LOCATION_TOKYO|GP|True';
const G1_TM_FALLBACK = 'ROMAN|dialog_character_roman01&ID_UI_PRERACE_LOCATION_TOKYO|map_tokyo_shape&icon|police';
const G1_PPTI_FALLBACK = 'profile_pic_police';
const ENGINE_TYPE_NAMES = ['V4', 'V4M', 'V6', 'V6M', 'V8', 'V8M', 'V10', 'V10M', 'V12', 'V12M'];
const ASPIRATION_TYPE_NAMES = ['NORMAL', 'TURBO_CHARGED', 'SUPER_CHARGED'];
const CAR_TUNING_META_KEY_ALIASES = {
  c: 'class',
  l: 'lsp',
  mtq: 'tq',
  mrrpm: 'minrrpm',
  mxrpm: 'maxrrpm',
  rsc: 'rsuc',
  rt: 'rts',
  tsu: 'supgd'
};

function normalizeTutorialGroupEntries(rawGroups) {
  const groups = Array.isArray(rawGroups)
    ? rawGroups.map((entry) => clone(entry))
    : [];

  return groups.map((entry, groupIndex) => {
    const clonedEntry = clone(entry || {});
    const gi = Number(clonedEntry.gi || 0);
    const steps = Array.isArray(clonedEntry.t) ? clonedEntry.t : [];
    clonedEntry.si = groupIndex;
    clonedEntry.t = steps.map((step, stepIndex) => ({
      ...clone(step || {}),
      si: stepIndex,
      tgi: Number((step && step.tgi) || gi || 0) || gi || 0
    }));
    return clonedEntry;
  });
}

const SERVER_SEQUENTIAL_TUTORIAL_BRANCH_ORDER = ['G1', 'G3', 'G4', 'G5', 'G6', 'G8', 'G9', 'G10', 'G39', 'G15'];

function reorderSequentialTutorialGroupEntries(entries) {
  const normalizedEntries = Array.isArray(entries)
    ? entries.map((entry) => clone(entry))
    : [];
  if (normalizedEntries.length <= 1) {
    return normalizedEntries;
  }

  const groupById = new Map(
    normalizedEntries.map((entry) => [
      `G${parseInt(entry && entry.gi, 10) || 0}`,
      entry
    ])
  );
  const ordered = [];
  const seen = new Set();

  for (const groupId of SERVER_SEQUENTIAL_TUTORIAL_BRANCH_ORDER) {
    const entry = groupById.get(String(groupId || ''));
    if (!entry) {
      continue;
    }
    ordered.push(entry);
    seen.add(String(groupId));
  }

  return ordered.map((entry, index) => ({
    ...entry,
    si: index
  }));
}


function enforceStartupDialogPayload(raceId, raceConfig, racePayload) {
  if (!racePayload || typeof racePayload !== 'object') return racePayload;
  const normalizedRaceId = String(raceId || '');
  if (normalizedRaceId === G1_RACE_ID) {
    racePayload.tm = String(G1_TM_FALLBACK);
    racePayload.cspd = String(G1_CSPD_FALLBACK);
    racePayload.ppti = normalizeProfilePicRef(firstDefined(
      raceConfig && raceConfig.ppti,
      G1_PPTI_FALLBACK
    ));
    return racePayload;
  }
  return racePayload;
}

function serializeCarTuningValue(value) {
  if (value === undefined || value === null) return value;
  if (Array.isArray(value)) {
    return value.map((entry) => serializeCarTuningValue(entry)).join('&');
  }
  if (typeof value === 'object') {
    const hasVector3 = Object.prototype.hasOwnProperty.call(value, 'x')
      && Object.prototype.hasOwnProperty.call(value, 'y')
      && Object.prototype.hasOwnProperty.call(value, 'z');
    if (hasVector3) {
      return `${Number(value.x || 0)}&${Number(value.y || 0)}&${Number(value.z || 0)}`;
    }
    const hasVector2 = Object.prototype.hasOwnProperty.call(value, 'x')
      && Object.prototype.hasOwnProperty.call(value, 'y')
      && !Object.prototype.hasOwnProperty.call(value, 'z');
    if (hasVector2) {
      return `${Number(value.x || 0)}&${Number(value.y || 0)}`;
    }
  }
  return value;
}

function normalizeCarTuningAssetTag(tag) {
  const raw = String(tag || '').replace(/^car_attribute_/i, '').trim();
  if (!raw) return '';
  if (vehicleMetaTemplates[raw] || defaultVehicleDescriptions[raw]) {
    return String(vehicleAssetAliases[raw] || raw || '');
  }
  const matchedShortTag = Object.keys(vehicleAssetAliases).find((shortTag) => (
    String(vehicleAssetAliases[shortTag] || '').trim() === raw
  ));
  return matchedShortTag ? String(vehicleAssetAliases[matchedShortTag] || raw || '') : '';
}

function deriveCarTuningClass(meta, assetTag) {
  if (Number.isFinite(Number(meta && meta.c))) {
    return Number(meta.c);
  }
  const description = defaultVehicleDescriptions[assetTag] || {};
  switch (String(description.PerformanceClass || '').toUpperCase()) {
    case 'S':
      return 4;
    case 'A':
      return 2;
    case 'B':
      return 1;
    case 'C':
    case 'D':
      return 0;
    default:
      return null;
  }
}

function addRelevantCarTuningTag(relevantTags, tag) {
  const assetTag = normalizeCarTuningAssetTag(tag);
  if (assetTag && !/ff6/i.test(assetTag)) {
    relevantTags.add(assetTag);
  }
}

function buildCarTuningDataPayload() {
  const relevantTags = new Set();

  Object.keys(vehicleMetaTemplates || {}).forEach((tag) => {
    addRelevantCarTuningTag(relevantTags, tag);
  });

  Object.keys(defaultVehicleDescriptions || {}).forEach((tag) => {
    addRelevantCarTuningTag(relevantTags, tag);
  });

  Object.values(ff7TutorialConfig.races || {}).forEach((raceConfig) => {
    [
      raceConfig && raceConfig.playerCarId,
      raceConfig && raceConfig.opponentCarId,
      ...(Array.isArray(raceConfig && raceConfig.trafficCarIds) ? raceConfig.trafficCarIds : []),
      ...(Array.isArray(raceConfig && raceConfig.policeCarIds) ? raceConfig.policeCarIds : [])
    ].forEach((tag) => addRelevantCarTuningTag(relevantTags, tag));
  });

  const tuningData = Array.from(relevantTags)
    .sort()
    .map((assetTag) => {
      const meta = clone(buildCarMetaPayload(assetTag) || getVehicleMetaTemplate(assetTag) || defaultVehicleDescriptions[assetTag] || null);
      if (!meta || typeof meta !== 'object') {
        return null;
      }
      const entry = {
        id: assetTag,
        fn: String(meta.fn || (defaultVehicleDescriptions[assetTag] && defaultVehicleDescriptions[assetTag].name) || assetTag),
        n: String(meta.n || `car_attribute_${assetTag}`),
        cpp: String(meta.cpp || `Bundles/cars/base/assets/attributes/stock/car_attribute_${assetTag}`),
        tbp: String(meta.tbp || `Bundles/UITextures/Thumbnails/${assetTag}`),
        cty: String(firstDefined(meta.cty, 'stock') || 'stock').toLowerCase(),
        mf: String(firstDefined(meta.mf, assetTag.split('_')[0], 'misc') || 'misc').toLowerCase(),
        dvu: String(firstDefined(meta.dvu, '') || ''),
        rvu: String(firstDefined(meta.rvu, '[]') || '[]'),
        lsp: String(firstDefined(meta.lsp, meta.l, '') || ''),
        et: Number.isFinite(Number(meta.et))
          ? (ENGINE_TYPE_NAMES[Number(meta.et)] || ENGINE_TYPE_NAMES[0])
          : String(firstDefined(meta.et, ENGINE_TYPE_NAMES[0]) || ENGINE_TYPE_NAMES[0]),
        at: Number.isFinite(Number(meta.at))
          ? (ASPIRATION_TYPE_NAMES[Number(meta.at)] || ASPIRATION_TYPE_NAMES[0])
          : String(firstDefined(meta.at, ASPIRATION_TYPE_NAMES[0]) || ASPIRATION_TYPE_NAMES[0])
      };

      Object.entries(meta).forEach(([key, rawValue]) => {
        if (key === 'id' || rawValue === undefined || rawValue === null) {
          return;
        }
        const serializedKey = CAR_TUNING_META_KEY_ALIASES[key] || key;
        if (key === 'et' && Number.isFinite(Number(rawValue))) {
          entry[serializedKey] = ENGINE_TYPE_NAMES[Number(rawValue)] || ENGINE_TYPE_NAMES[0];
          return;
        }
        if (key === 'at' && Number.isFinite(Number(rawValue))) {
          entry[serializedKey] = ASPIRATION_TYPE_NAMES[Number(rawValue)] || ASPIRATION_TYPE_NAMES[0];
          return;
        }
        entry[serializedKey] = serializeCarTuningValue(rawValue);
      });

      if (entry.class === undefined || entry.class === null || String(entry.class).trim() === '') {
        const derivedClass = deriveCarTuningClass(meta, assetTag);
        if (derivedClass !== null) {
          entry.class = derivedClass;
        }
      }

      entry.cty = String(firstDefined(entry.cty, meta.cty, 'stock') || 'stock').toLowerCase();
      entry.mf = String(firstDefined(entry.mf, meta.mf, assetTag.split('_')[0], 'misc') || 'misc').toLowerCase();
      entry.cpp = String(firstDefined(entry.cpp, meta.cpp, meta.carModelAttributePath, `Bundles/cars/base/assets/attributes/stock/car_attribute_${assetTag}`) || '');
      entry.tbp = String(firstDefined(entry.tbp, meta.tbp, `Bundles/UITextures/Thumbnails/${assetTag}`) || '');
      entry.dvu = String(firstDefined(entry.dvu, meta.dvu, '') || '');
      entry.rvu = String(firstDefined(entry.rvu, meta.rvu, '[]') || '[]');
      entry.lsp = String(firstDefined(entry.lsp, meta.lsp, meta.l, '') || '');
      entry.et = Number.isFinite(Number(entry.et))
        ? (ENGINE_TYPE_NAMES[Number(entry.et)] || ENGINE_TYPE_NAMES[0])
        : String(firstDefined(entry.et, meta.et, ENGINE_TYPE_NAMES[0]) || ENGINE_TYPE_NAMES[0]);
      entry.at = Number.isFinite(Number(entry.at))
        ? (ASPIRATION_TYPE_NAMES[Number(entry.at)] || ASPIRATION_TYPE_NAMES[0])
        : String(firstDefined(entry.at, meta.at, ASPIRATION_TYPE_NAMES[0]) || ASPIRATION_TYPE_NAMES[0]);

      if (!entry.id || !entry.fn || !entry.n || !entry.cpp) {
        return null;
      }
      if (!entry.cty || !entry.mf || !entry.et || !entry.at) {
        return null;
      }
      if (entry.class === undefined || entry.class === null || String(entry.class).trim() === '') {
        return null;
      }

      return entry;
    })
    .filter(Boolean);

  return {
    dbHash: crypto.createHash('md5').update(JSON.stringify(tuningData)).digest('hex'),
    tuningData
  };
}

function buildCarPartsPayload() {
  const tuningData = {
    '#vp_engine_1': '1&0.85',
    '#vp_engine_2': '2&1.00'
  };

  Object.values(defaultVehiclePurchasablesByVehicle || {}).forEach((items) => {
    (Array.isArray(items) ? items : []).forEach((item) => {
      if (!item || String(item.itemType || '').trim() !== 'engineCC') {
        return;
      }
      const itemTag = String(item.itemTag || '').trim();
      if (!itemTag || tuningData[itemTag]) {
        return;
      }
      tuningData[itemTag] = /_2$/i.test(itemTag) ? '2&1.00' : '1&0.85';
    });
  });

  return {
    tuningData
  };
}

function normalizeStaticCarQuality(meta = {}) {
  const raw = String(firstDefined(meta.ct, meta.cty, 'stock') || 'stock').trim().toLowerCase();
  switch (raw) {
    case 'used':
    case 'stock':
    case 'performance':
    case 'hero':
      return raw;
    case 'traffic':
      return '';
    default:
      return 'stock';
  }
}

function buildGachaCarInfoPayload() {
  const relevantTags = new Set();

  Object.keys(vehicleMetaTemplates || {}).forEach((tag) => addRelevantCarTuningTag(relevantTags, tag));
  Object.keys(defaultVehicleDescriptions || {}).forEach((tag) => addRelevantCarTuningTag(relevantTags, tag));

  const info = {};
  Array.from(relevantTags).sort().forEach((assetTag) => {
    const desc = defaultVehicleDescriptions[assetTag] || {};
    const meta = getVehicleMetaTemplate(assetTag) || {};
    const maxpi = Number(firstDefined(desc.BasePISS, desc.pi, meta.pi, 0) || 0);
    const ct = normalizeStaticCarQuality(meta);
    const st = Math.max(0, Math.trunc(Number(firstDefined(meta.st, 4) || 4)));
    if (maxpi > 0 && ct) {
      info[String(assetTag).trim()] = { maxpi, ct, st };
    }
  });

  return info;
}

function buildRacePerformanceUpgradePayload(status = {}) {
  const engineId = String(
    status && status.EngineCCId != null
      ? status.EngineCCId
      : ''
  ).trim();
  if (!engineId) {
    return {};
  }
  return {
    id: engineId,
    Id: engineId,
    engineId,
    EngineCCId: engineId
  };
}

function buildRaceUpgradePartsPayload(status = {}) {
  const tyreId = String(
    status && status.TyreId != null
      ? status.TyreId
      : ''
  ).trim();
  const engineId = String(
    status && status.EngineCCId != null
      ? status.EngineCCId
      : ''
  ).trim();
  return {
    balance: '',
    control: tyreId,
    nos: '',
    shifting: '',
    topspeed: engineId,
    weight: ''
  };
}

function buildVehicleStatusPayload(profile = {}, tag = '') {
  const canonicalTag = String(tag || FF7_DEFAULT_CURRENT_CAR_ID);
  const assetTag = String(vehicleAssetAliases[canonicalTag] || canonicalTag);
  const statusMap = profile && profile.OwnedVehiclesStatus && typeof profile.OwnedVehiclesStatus === 'object'
    ? profile.OwnedVehiclesStatus
    : {};
  const rawStatus =
    statusMap[assetTag] ||
    statusMap[canonicalTag] ||
    createOwnedVehicleStatus(assetTag);
  return clone(sanitizeOwnedVehicleStatus(assetTag, rawStatus));
}

function normalizeProfileResourceAliases(profile = {}) {
  if (!profile || typeof profile !== 'object') {
    return profile;
  }
  const coins = Number(profile.NoCoins || profile.coins || 0);
  const stars = Number(profile.NoStars || profile.gold || profile.stars || 0);
  const fuel = Number(profile.Fuel || profile.fuel || 0);
  const xp = Number(profile.XP || profile.xp || profile.currentXP || 0);
  profile.NoCoins = coins;
  profile.coins = coins;
  profile.NoStars = stars;
  profile.gold = stars;
  profile.stars = stars;
  profile.Fuel = fuel;
  profile.fuel = fuel;
  profile.XP = xp;
  profile.xp = xp;
  profile.currentXP = xp;
  return profile;
}

function applyStoryDialogueAliases(racePayload) {
  if (!racePayload || typeof racePayload !== 'object') {
    return racePayload;
  }
  racePayload.CurStoryPreDialogue = String(racePayload.cspd || '');
  racePayload.curStoryPreDialogue = String(racePayload.cspd || '');
  racePayload.CurrentStoryPreDialogue = String(racePayload.cspd || '');
  racePayload.PreviousStoryPostDialogue = String(racePayload.pspd || '');
  racePayload.previousStoryPostDialogue = String(racePayload.pspd || '');
  racePayload.MiscDialogue = String(racePayload.md || '');
  racePayload.miscDialogue = String(racePayload.md || '');
  racePayload.TextureMapping = String(racePayload.tm || '');
  racePayload.textureMapping = String(racePayload.tm || '');
  racePayload.ProfilePictureTag = String(racePayload.ppti || '');
  racePayload.profilePictureTag = String(racePayload.ppti || '');
  return racePayload;
}

const LEGACY_AUTH_PREFIXES = [
  '/auth/init',
  '/auth/prelogin',
  '/auth/enumerate',
  '/auth/login',
  '/prelogin',
  '/login',
  '/account',
  '/account/unlink',
  '/account/link',
  '/account/data',
  '/account/check-name',
  '/account/name',
  '/account/support',
  '/kabam/register',
  '/kabam/guest',
  '/kabam/login',
  '/kabam/upgrade',
  '/kabam/facebook',
  '/kabam/name',
  '/kabam/support',
  '/kabam/exists'
];

const FF7_TUTORIAL_RACE_IDS = Object.keys(ff7TutorialConfig.races || {});
const FF7_TUTORIAL_RACE_ID = FF7_TUTORIAL_RACE_IDS[0] || 'chapter_00_a';
const FF7_TUTORIAL_SEQUENTIAL = reorderSequentialTutorialGroupEntries(
  normalizeTutorialGroupEntries(
    extractedTutorialDb && extractedTutorialDb.data && extractedTutorialDb.data.SEQUENTIAL
  )
);
const FF7_TUTORIAL_CONTEXTUAL = normalizeTutorialGroupEntries(
  extractedTutorialDb && extractedTutorialDb.data && extractedTutorialDb.data.CONTEXTUAL
);
const FF7_TUTORIAL_BRANCH_IDS = Array.isArray(FF7_TUTORIAL_SEQUENTIAL)
  ? FF7_TUTORIAL_SEQUENTIAL
      .map((group) => `G${parseInt(group && group.gi, 10) || 0}`)
      .filter((groupId, index, list) => /^G\d+$/.test(groupId) && list.indexOf(groupId) === index)
  : ['G1'];
const FF7_CONTEXTUAL_TUTORIAL_IDS = Array.isArray(FF7_TUTORIAL_CONTEXTUAL)
  ? FF7_TUTORIAL_CONTEXTUAL
      .map((group) => `G${parseInt(group && group.gi, 10) || 0}`)
      .filter((groupId, index, list) => /^G\d+$/.test(groupId) && list.indexOf(groupId) === index)
  : [];
const FF7_TUTORIAL_BRANCH_RACE_IDS = (() => {
  const map = {};
  const groups = Array.isArray(FF7_TUTORIAL_SEQUENTIAL)
    ? FF7_TUTORIAL_SEQUENTIAL
    : [];
  groups.forEach((group) => {
    const groupId = `G${parseInt(group && group.gi, 10) || 0}`;
    const steps = Array.isArray(group && group.t) ? group.t : [];
    const raceStep = steps.find((step) => String((step && (step.jid || step.rist)) || '').trim());
    const raceHint = String(
      raceStep && (raceStep.jid || raceStep.rist) || ''
    ).trim();
    if (groupId && raceHint) {
      map[groupId] = raceHint;
    }
  });
  return map;
})();
const FF7_DISABLED_TUTORIAL_RACE_IDS = new Set([
  'chapter_00_b',
  'chapter_01_a',
  'chapter_01_b',
  'chapter_01_c',
  'chapter_01_e'
]);

function isDisabledTutorialRaceId(raceId) {
  const normalizedRaceId = String(raceId || '').trim();
  return Boolean(normalizedRaceId && FF7_DISABLED_TUTORIAL_RACE_IDS.has(normalizedRaceId));
}

const FF7_FIRST_TUTORIAL_CONFIG = (ff7TutorialConfig.races && ff7TutorialConfig.races[FF7_TUTORIAL_RACE_ID]) || {};
const FF7_SKIP_TUTORIAL_TO_GARAGE = Boolean(ff7TutorialConfig.skipTutorialToGarage);
const FF7_COMPLETE_TUTORIALS_ON_FRESH_SAVE = Boolean(ff7TutorialConfig.freshSavesCompleteTutorials);
const FF7_TUTORIAL_PLAYER_CAR_ID = String(
  ff7TutorialConfig.tutorialPlayerCarId ||
  FF7_FIRST_TUTORIAL_CONFIG.playerCarId ||
  'nissan_gtr_r35_2007'
);
const FF7_GARAGE_CAR_ID = String(ff7TutorialConfig.garageCarId || FF7_TUTORIAL_PLAYER_CAR_ID);
const FF7_DEFAULT_CURRENT_CAR_ID = FF7_SKIP_TUTORIAL_TO_GARAGE ? FF7_GARAGE_CAR_ID : FF7_TUTORIAL_PLAYER_CAR_ID;
const FF7_LEGACY_GARAGE_CAR_IDS = Array.isArray(ff7TutorialConfig.legacyGarageCarIds)
  ? ff7TutorialConfig.legacyGarageCarIds.map((tag) => String(tag))
  : [];
const FF7_DEFAULT_OWNED_VEHICLE_TAGS = (
  FF7_SKIP_TUTORIAL_TO_GARAGE &&
  Array.isArray(ff7TutorialConfig.garageOwnedVehicleTags) &&
  ff7TutorialConfig.garageOwnedVehicleTags.length > 0
    ? ff7TutorialConfig.garageOwnedVehicleTags
    : [FF7_DEFAULT_CURRENT_CAR_ID]
).map((tag) => String(tag)).filter(Boolean);
const FF7_TUTORIAL_OPPONENT_CAR_ID = String((ff7TutorialConfig.races && ff7TutorialConfig.races[FF7_TUTORIAL_RACE_ID] && ff7TutorialConfig.races[FF7_TUTORIAL_RACE_ID].opponentCarId) || 'ff_police_sedan_tokyo_01');
const FF7_TUTORIAL_TRAFFIC_CAR_IDS = Array.isArray(ff7TutorialConfig.races && ff7TutorialConfig.races[FF7_TUTORIAL_RACE_ID] && ff7TutorialConfig.races[FF7_TUTORIAL_RACE_ID].trafficCarIds)
  ? ff7TutorialConfig.races[FF7_TUTORIAL_RACE_ID].trafficCarIds.slice()
  : [];
const FF7_TUTORIAL_POLICE_CAR_IDS = Array.isArray(ff7TutorialConfig.races && ff7TutorialConfig.races[FF7_TUTORIAL_RACE_ID] && ff7TutorialConfig.races[FF7_TUTORIAL_RACE_ID].policeCarIds)
  ? ff7TutorialConfig.races[FF7_TUTORIAL_RACE_ID].policeCarIds.slice()
  : [];

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function normalizeTutorialBranchId(value, fallback = 'G1') {
  const raw = String(value || '').trim();
  const match = raw.match(/^G(\d+)$/i);
  if (match) {
    return `G${parseInt(match[1], 10)}`;
  }
  if (fallback === null || typeof fallback === 'undefined') {
    return 'G1';
  }
  return String(fallback);
}

function parseTutorialNumericId(value, prefix = 'G') {
  const match = String(value || '').trim().match(new RegExp(`^${prefix}(\\d+)$`, 'i'));
  return match ? Number(match[1] || 0) : 0;
}

function getFirstIncompleteTutorialBranchId(tutorial = {}) {
  const completedGroups = new Set(
    (Array.isArray(tutorial && tutorial.tutorialGroupsCompleted) ? tutorial.tutorialGroupsCompleted : [])
      .map((branchId) => normalizeTutorialBranchId(branchId, ''))
      .filter(Boolean)
  );

  for (const branchId of FF7_TUTORIAL_BRANCH_IDS) {
    const normalizedBranchId = normalizeTutorialBranchId(branchId, '');
    if (normalizedBranchId && !completedGroups.has(normalizedBranchId)) {
      return normalizedBranchId;
    }
  }

  return '';
}

function normalizeProfileVehicleTag(tag, fallbackTag = FF7_DEFAULT_CURRENT_CAR_ID) {
  const raw = String(tag || '').trim();
  if (!raw) return String(fallbackTag);
  return String(vehicleAssetAliases[raw] || raw || fallbackTag);
}

function getDefaultOwnedVehicleTags() {
  if (!FF7_SKIP_TUTORIAL_TO_GARAGE && !FF7_COMPLETE_TUTORIALS_ON_FRESH_SAVE) {
    return [];
  }
  return FF7_DEFAULT_OWNED_VEHICLE_TAGS.slice();
}

function shouldCompleteTutorialsOnFreshSave(profile = {}) {
  if (!FF7_COMPLETE_TUTORIALS_ON_FRESH_SAVE || !profile || typeof profile !== 'object') {
    return false;
  }
  const wonRaces = profile.won_races && typeof profile.won_races === 'object' ? profile.won_races : {};
  const lostRaces = profile.lost_races && typeof profile.lost_races === 'object' ? profile.lost_races : {};
  const tutorialStep = Math.max(0, Math.trunc(Number(profile.tut_id || 0)));
  return Object.keys(wonRaces).length === 0 && Object.keys(lostRaces).length === 0 && tutorialStep <= 1;
}

function getCompletedTutorialStepValue() {
  const maxGroup = FF7_TUTORIAL_BRANCH_IDS.reduce((maxValue, branchId) => {
    const match = String(branchId || '').match(/^G(\d+)$/i);
    if (!match) return maxValue;
    return Math.max(maxValue, Number(match[1] || 0));
  }, 0);
  return Math.max(1, maxGroup || FF7_TUTORIAL_BRANCH_IDS.length || 1);
}

function getFirstOwnedVehicleTag(profile) {
  return Array.isArray(profile && profile.OwnedVehicles) && profile.OwnedVehicles.length > 0
    ? String(profile.OwnedVehicles[0] || '').trim()
    : '';
}

function getTutorialRaceConfig(raceId) {
  const normalizedRaceId = String(raceId || '').trim();
  if (!normalizedRaceId || isDisabledTutorialRaceId(normalizedRaceId)) {
    return {};
  }
  const races = ff7TutorialConfig.races || {};
  return races[normalizedRaceId] || {};
}

function getAuthoritativeProfile(userId) {
  const state = getUserState(userId) || {};
  const rootProfile = normalizeProfileResourceAliases(getProfile(userId) || {});
  const dataStoreProfile =
    state &&
    state.sparx &&
    state.sparx.dataStore &&
    isPlainObject(state.sparx.dataStore.profile)
      ? normalizeProfileResourceAliases(state.sparx.dataStore.profile)
      : null;
  const dataStoreCar =
    state &&
    state.sparx &&
    state.sparx.dataStore &&
    isPlainObject(state.sparx.dataStore.car)
      ? clone(state.sparx.dataStore.car)
      : null;
  const dataStoreCarsRoot =
    state &&
    state.sparx &&
    state.sparx.dataStore &&
    isPlainObject(state.sparx.dataStore.cars)
      ? state.sparx.dataStore.cars
      : {};
  const preferredRecordId = String(firstDefined(
    dataStoreProfile && (dataStoreProfile.lastRequestedCarId || dataStoreProfile.LastRequestedCarId),
    rootProfile && (rootProfile.lastRequestedCarId || rootProfile.LastRequestedCarId),
    dataStoreProfile && (dataStoreProfile.active_carid || dataStoreProfile.activeCarId),
    rootProfile && (rootProfile.active_carid || rootProfile.activeCarId),
    ''
  ) || '').trim();
  const preferredVehicleTag = normalizeProfileVehicleTag(
    firstDefined(
      dataStoreProfile && (dataStoreProfile.CurrentVehicleTag || dataStoreProfile.currentVehicleTag),
      rootProfile && (rootProfile.CurrentVehicleTag || rootProfile.currentVehicleTag),
      ''
    ),
    ''
  );
  let dataStoreSelectedRecord = null;

  Object.values(dataStoreCarsRoot || {}).some((bucket) => {
    if (!bucket || typeof bucket !== 'object') return false;
    return Object.values(bucket).some((record) => {
      if (!record || typeof record !== 'object') return false;
      const recordId = String(firstDefined(record._id, record.id, '') || '').trim();
      const recordTag = normalizeProfileVehicleTag(
        firstDefined(
          record.AssetTag,
          record.assetTag,
          record.carId,
          record.car,
          record.CurrentVehicleTag,
          record.currentVehicleTag,
          record.r && record.r.n,
          record.recipe && record.recipe.n,
          ''
        ),
        ''
      );
      if ((preferredRecordId && recordId === preferredRecordId) || (preferredVehicleTag && recordTag === preferredVehicleTag)) {
        dataStoreSelectedRecord = clone(record);
        return true;
      }
      return false;
    });
  });

  const effectiveDataStoreCar = dataStoreSelectedRecord || dataStoreCar;

  const dataStoreCarTag = normalizeProfileVehicleTag(
    firstDefined(
      effectiveDataStoreCar && effectiveDataStoreCar.AssetTag,
      effectiveDataStoreCar && effectiveDataStoreCar.assetTag,
      effectiveDataStoreCar && effectiveDataStoreCar.carId,
      effectiveDataStoreCar && effectiveDataStoreCar.car,
      effectiveDataStoreCar && effectiveDataStoreCar.Tag,
      effectiveDataStoreCar && effectiveDataStoreCar.tag,
      effectiveDataStoreCar && effectiveDataStoreCar.CurrentVehicleTag,
      effectiveDataStoreCar && effectiveDataStoreCar.currentVehicleTag,
      effectiveDataStoreCar && effectiveDataStoreCar.r && effectiveDataStoreCar.r.n,
      effectiveDataStoreCar && effectiveDataStoreCar.recipe && effectiveDataStoreCar.recipe.n,
      ''
    ),
    ''
  );
  const dataStoreCarId = String(
    firstDefined(
      effectiveDataStoreCar && effectiveDataStoreCar._id,
      effectiveDataStoreCar && effectiveDataStoreCar.id,
      preferredRecordId,
      ''
    ) || ''
  ).trim();
  const dataStoreCarRecipeHash = Number(firstDefined(
    effectiveDataStoreCar && effectiveDataStoreCar.active_recipe,
    effectiveDataStoreCar && effectiveDataStoreCar.r && effectiveDataStoreCar.r.hash,
    effectiveDataStoreCar && effectiveDataStoreCar.recipe && effectiveDataStoreCar.recipe.hash,
    0
  ) || 0);

  if (!dataStoreProfile) {
    if (dataStoreCarTag) {
      rootProfile.CurrentVehicleTag = dataStoreCarTag;
      rootProfile.currentVehicleTag = dataStoreCarTag;
    }
    if (dataStoreCarId) {
      rootProfile.active_carid = dataStoreCarId;
      rootProfile.activeCarId = dataStoreCarId;
      rootProfile.lastRequestedCarId = dataStoreCarId;
      rootProfile.LastRequestedCarId = dataStoreCarId;
    }
    if (dataStoreCarRecipeHash) {
      rootProfile.active_recipe = dataStoreCarRecipeHash;
    }
    return rootProfile;
  }

  const merged = Object.assign({}, clone(rootProfile), clone(dataStoreProfile));
  const currentVehicleTag = String(
    firstDefined(
      dataStoreCarTag,
      dataStoreProfile.CurrentVehicleTag,
      dataStoreProfile.currentVehicleTag,
      rootProfile.CurrentVehicleTag,
      rootProfile.currentVehicleTag,
      ''
    )
  ).trim();
  const effectiveVehicleTag = currentVehicleTag;

  if (effectiveVehicleTag) {
    merged.CurrentVehicleTag = effectiveVehicleTag;
    merged.currentVehicleTag = effectiveVehicleTag;
  }

  if (dataStoreCarId) {
    merged.active_carid = dataStoreCarId;
    merged.activeCarId = dataStoreCarId;
    merged.lastRequestedCarId = dataStoreCarId;
    merged.LastRequestedCarId = dataStoreCarId;
  }

  if (dataStoreCarRecipeHash) {
    merged.active_recipe = dataStoreCarRecipeHash;
  }

  if (Array.isArray(dataStoreProfile.OwnedVehicles)) {
    merged.OwnedVehicles = dataStoreProfile.OwnedVehicles.slice();
  } else if (Array.isArray(rootProfile.OwnedVehicles)) {
    merged.OwnedVehicles = rootProfile.OwnedVehicles.slice();
  }

  const freshTutorialIntro = isFreshTutorialIntroProfile({
    ...rootProfile,
    ...dataStoreProfile,
    ...merged
  });

  if (freshTutorialIntro) {
    merged.OwnedVehicles = [];
    merged.OwnedVehiclesStatus = {};
  } else if ((!Array.isArray(merged.OwnedVehicles) || merged.OwnedVehicles.length === 0) && effectiveVehicleTag) {
    merged.OwnedVehicles = [effectiveVehicleTag];
  }

  if (!freshTutorialIntro && Array.isArray(merged.OwnedVehicles) && effectiveVehicleTag && merged.OwnedVehicles.indexOf(effectiveVehicleTag) === -1) {
    merged.OwnedVehicles.unshift(effectiveVehicleTag);
  }

  if (freshTutorialIntro) {
    merged.OwnedVehiclesStatus = {};
  } else if (isPlainObject(dataStoreProfile.OwnedVehiclesStatus)) {
    merged.OwnedVehiclesStatus = clone(dataStoreProfile.OwnedVehiclesStatus);
  } else if (isPlainObject(rootProfile.OwnedVehiclesStatus)) {
    merged.OwnedVehiclesStatus = clone(rootProfile.OwnedVehiclesStatus);
  }

  return normalizeProfileResourceAliases(merged);
}

function buildAuthoritativeVehicleState(userId) {
  const profile = getAuthoritativeProfile(userId) || {};
  const currentVehicleTag = String(
    firstDefined(
      profile.CurrentVehicleTag,
      profile.currentVehicleTag,
      ''
    ) || ''
  ).trim();
  const activeCarId = String(
    firstDefined(
      profile.active_carid,
      profile.activeCarId,
      profile.lastRequestedCarId,
      profile.LastRequestedCarId,
      ''
    ) || ''
  ).trim();
  const ownedVehicles = Array.isArray(profile.OwnedVehicles)
    ? profile.OwnedVehicles.slice()
    : [];
  const activeRecipe = Number(firstDefined(profile.active_recipe, 0) || 0);
  return {
    CurrentVehicleTag: currentVehicleTag,
    currentVehicleTag: currentVehicleTag,
    active_carid: activeCarId,
    activeCarId: activeCarId,
    lastRequestedCarId: activeCarId,
    LastRequestedCarId: activeCarId,
    OwnedVehicles: ownedVehicles,
    active_recipe: activeRecipe
  };
}

function isConfiguredTutorialRaceId(raceId) {
  const normalizedRaceId = String(raceId || '').trim();
  return Boolean(
    normalizedRaceId &&
    !isDisabledTutorialRaceId(normalizedRaceId) &&
    ff7TutorialConfig.races &&
    ff7TutorialConfig.races[normalizedRaceId]
  );
}

function getTutorialBranchRaceId(branchId, fallback = '') {
  const normalizedBranchId = normalizeTutorialBranchId(branchId, '');
  if (normalizedBranchId && FF7_TUTORIAL_BRANCH_RACE_IDS[normalizedBranchId]) {
    const mappedRaceId = String(FF7_TUTORIAL_BRANCH_RACE_IDS[normalizedBranchId] || '').trim();
    if (!mappedRaceId || isDisabledTutorialRaceId(mappedRaceId)) {
      return '';
    }
    return mappedRaceId;
  }
  return String(fallback || '');
}

function getTutorialBranchIdForRaceId(raceId, fallback = 'G1') {
  const normalizedRaceId = String(raceId || '').trim();
  const foundEntry = Object.entries(FF7_TUTORIAL_BRANCH_RACE_IDS)
    .find(([, mappedRaceId]) => String(mappedRaceId || '').trim() === normalizedRaceId);
  return foundEntry ? String(foundEntry[0]) : String(fallback || 'G1');
}

function getRaceLinkedTutorialBranches() {
  return FF7_TUTORIAL_BRANCH_IDS
    .map((branchId) => ({
      branchId: String(branchId || ''),
      raceId: getTutorialBranchRaceId(branchId, '')
    }))
    .filter((entry) => Boolean(entry.branchId && entry.raceId));
}

function getNextTutorialBranchId(branchId) {
  const normalizedBranchId = normalizeTutorialBranchId(branchId, '');
  const index = FF7_TUTORIAL_BRANCH_IDS.indexOf(normalizedBranchId);
  if (index === -1 || index + 1 >= FF7_TUTORIAL_BRANCH_IDS.length) {
    return '';
  }
  return String(FF7_TUTORIAL_BRANCH_IDS[index + 1] || '');
}

function getNextPlayableTutorialBranchId(branchId) {
  let cursor = getNextTutorialBranchId(branchId);
  while (cursor) {
    const raceId = getTutorialBranchRaceId(cursor, '');
    if (isConfiguredTutorialRaceId(raceId)) {
      return cursor;
    }
    cursor = getNextTutorialBranchId(cursor);
  }
  return '';
}

function hasWonTutorialRace(profile = {}, raceId = '') {
  const wonRaces = profile && typeof profile.won_races === 'object' ? profile.won_races : {};
  const normalizedRaceId = String(raceId || '').trim();
  if (!normalizedRaceId) {
    return false;
  }
  return Number(wonRaces[normalizedRaceId] || 0) > 0;
}

function hasCompletedLaterRaceLinkedTutorial(profile = {}, startIndex = -1) {
  for (let index = Number(startIndex || 0) + 1; index < FF7_TUTORIAL_BRANCH_IDS.length; index += 1) {
    const branchId = FF7_TUTORIAL_BRANCH_IDS[index];
    const raceId = getTutorialBranchRaceId(branchId, '');
    if (raceId && hasWonTutorialRace(profile, raceId)) {
      return true;
    }
    const rawRaceId = String(FF7_TUTORIAL_BRANCH_RACE_IDS[branchId] || '').trim();
    if (rawRaceId && rawRaceId !== raceId && hasWonTutorialRace(profile, rawRaceId)) {
      return true;
    }
  }
  return false;
}

function getProfileTutorialStageCheckpoint(profile = {}) {
  const tutId = Math.max(0, Math.trunc(Number(profile && profile.tut_id || 0)));
  const branchId = normalizeTutorialBranchId(`G${tutId}`, '');
  const branchIndex = SERVER_SEQUENTIAL_TUTORIAL_BRANCH_ORDER.indexOf(branchId);
  if (!branchId || branchIndex === -1) {
    return {
      activeBranchId: '',
      completedBranchIds: []
    };
  }
  return {
    activeBranchId: branchId,
    completedBranchIds: SERVER_SEQUENTIAL_TUTORIAL_BRANCH_ORDER.slice(0, branchIndex)
  };
}

function isFreshTutorialIntroProfile(profile = {}) {
  if (FF7_SKIP_TUTORIAL_TO_GARAGE || shouldCompleteTutorialsOnFreshSave(profile) || !profile || typeof profile !== 'object') {
    return false;
  }
  const wonRaces = profile.won_races && typeof profile.won_races === 'object' ? profile.won_races : {};
  const hasWonStoryRace = Object.keys(wonRaces).some((raceId) => String(raceId || '').startsWith('chapter_'));
  const tutorialStep = Math.max(0, Math.trunc(Number(profile.tut_id || 0)));
  return !hasWonStoryRace && tutorialStep <= 1;
}

function getProfileDrivenTutorialCheckpoint(profile = {}) {
  if (shouldCompleteTutorialsOnFreshSave(profile)) {
    return {
      activeBranchId: '',
      completedBranchIds: FF7_TUTORIAL_BRANCH_IDS.slice()
    };
  }
  if (isFreshTutorialIntroProfile(profile)) {
    return {
      activeBranchId: 'G1',
      completedBranchIds: []
    };
  }
  const completedBranchIds = [];

  for (let index = 0; index < FF7_TUTORIAL_BRANCH_IDS.length; index += 1) {
    const branchId = String(FF7_TUTORIAL_BRANCH_IDS[index] || '');
    const raceId = getTutorialBranchRaceId(branchId, '');
    const rawRaceId = String(FF7_TUTORIAL_BRANCH_RACE_IDS[branchId] || '').trim();
    const branchCompleted = raceId
      ? hasWonTutorialRace(profile, raceId)
      : (rawRaceId && hasWonTutorialRace(profile, rawRaceId))
        || hasCompletedLaterRaceLinkedTutorial(profile, index);

    if (branchCompleted) {
      completedBranchIds.push(branchId);
      continue;
    }

    return {
      activeBranchId: branchId,
      completedBranchIds
    };
  }

  const checkpoint = {
    activeBranchId: '',
    completedBranchIds
  };
  if (completedBranchIds.length >= FF7_TUTORIAL_BRANCH_IDS.length) {
    return checkpoint;
  }
  const stageCheckpoint = getProfileTutorialStageCheckpoint(profile);
  const checkpointNumber = parseTutorialNumericId(checkpoint.activeBranchId, 'G');
  const stageNumber = parseTutorialNumericId(stageCheckpoint.activeBranchId, 'G');
  if (stageNumber > checkpointNumber) {
    return stageCheckpoint;
  }
  return checkpoint;
}

function getLastCompletedTutorialRaceId(profile = {}) {
  const checkpoint = getProfileDrivenTutorialCheckpoint(profile);
  const completedBranchIds = Array.isArray(checkpoint.completedBranchIds) ? checkpoint.completedBranchIds : [];
  for (let index = completedBranchIds.length - 1; index >= 0; index -= 1) {
    const raceId = getTutorialBranchRaceId(completedBranchIds[index], '');
    if (raceId) {
      return raceId;
    }
  }
  return '';
}

function getActiveTutorialRaceIdFromState(userId) {
  const state = getUserState(userId) || {};
  const tutorial =
    state &&
    state.sparx &&
    isPlainObject(state.sparx.tutorial)
      ? state.sparx.tutorial
      : null;

  if (!tutorial) {
    return '';
  }

  const activeTid = String(
    firstDefined(
      tutorial.activeTutorial && tutorial.activeTutorial.tid,
      tutorial.currentTutorialId,
      'FTE'
    )
  ).trim();
  const activeBid = String(
    firstDefined(
      tutorial.activeTutorial && tutorial.activeTutorial.bid,
      tutorial.currentTutorialGroupId,
      ''
    )
  ).trim();
  const rootNode = tutorial.userData && isPlainObject(tutorial.userData)
    ? tutorial.userData[activeTid]
    : null;
  const candidates = [
    rootNode && isPlainObject(rootNode.Branches) && activeBid ? rootNode.Branches[activeBid] : null,
    rootNode && isPlainObject(rootNode.branches) && activeBid ? rootNode.branches[activeBid] : null,
    rootNode && isPlainObject(rootNode.Tutorials) ? rootNode.Tutorials[activeTid] : null,
    rootNode && isPlainObject(rootNode.tutorials) ? rootNode.tutorials[activeTid] : null,
    tutorial.branchData
  ];

  for (const node of candidates) {
    if (!isPlainObject(node)) continue;
    const jumpRaceId = String(
      firstDefined(
        node.jumpToRaceId,
        node.JumpToRaceId,
        node.JumpToRaceID,
        ''
      )
    ).trim();
    if (isConfiguredTutorialRaceId(jumpRaceId)) {
      return jumpRaceId;
    }
  }

  return '';
}

function getActiveTutorialBranchIdFromState(userId) {
  const authoritativeProfile = getAuthoritativeProfile(userId) || {};
  if (isFreshTutorialIntroProfile(authoritativeProfile)) {
    return 'G1';
  }
  const profileCheckpoint = getProfileDrivenTutorialCheckpoint(authoritativeProfile);
  if (!profileCheckpoint.activeBranchId && Array.isArray(profileCheckpoint.completedBranchIds) && profileCheckpoint.completedBranchIds.length > 0) {
    return '';
  }
  const state = getUserState(userId) || {};
  const tutorial =
    state &&
    state.sparx &&
    isPlainObject(state.sparx.tutorial)
      ? state.sparx.tutorial
      : null;

  if (!tutorial) {
    return '';
  }

  const activeBranchId = normalizeTutorialBranchId(
    firstDefined(
      tutorial.activeTutorial && tutorial.activeTutorial.bid,
      tutorial.currentTutorialGroupId,
      ''
    ),
    ''
  );
  const firstIncompleteBranchId = getFirstIncompleteTutorialBranchId(tutorial);
  const activeBranchNumber = parseTutorialNumericId(activeBranchId, 'G');
  const firstIncompleteNumber = parseTutorialNumericId(firstIncompleteBranchId, 'G');

  if (
    activeBranchId &&
    activeBranchNumber > 0 &&
    firstIncompleteNumber > 0 &&
    activeBranchNumber >= firstIncompleteNumber
  ) {
    return activeBranchId;
  }

  if (firstIncompleteBranchId) {
    return firstIncompleteBranchId;
  }

  return activeBranchId;
}

function getStartupPlayableTutorialRaceId(profile = {}) {
  if (isFreshTutorialIntroProfile(profile)) {
    return FF7_TUTORIAL_RACE_ID;
  }
  const activeBranchId = String(getProfileDrivenTutorialCheckpoint(profile).activeBranchId || '');
  return getTutorialBranchRaceId(activeBranchId, '');
}

function getTutorialDisplayRaceId(activeBranchId, activeRaceId = '') {
  const normalizedActiveRaceId = String(activeRaceId || '').trim();
  return isConfiguredTutorialRaceId(normalizedActiveRaceId)
    ? normalizedActiveRaceId
    : '';
}

function getActiveTutorialRaceIdForAuth(userId, profileOverride = null) {
  const profile = profileOverride || getAuthoritativeProfile(userId) || {};
  if (isFreshTutorialIntroProfile(profile)) {
    return FF7_TUTORIAL_RACE_ID;
  }
  const profileCheckpoint = getProfileDrivenTutorialCheckpoint(profile);
  const activeBranchId = getActiveTutorialBranchIdFromState(userId);
  if (activeBranchId) {
    const directRaceId = getTutorialBranchRaceId(activeBranchId, '');
    if (isConfiguredTutorialRaceId(directRaceId)) {
      return String(directRaceId).trim();
    }
    return '';
  }
  if (!profileCheckpoint.activeBranchId && Array.isArray(profileCheckpoint.completedBranchIds) && profileCheckpoint.completedBranchIds.length > 0) {
    return '';
  }
  const startupRaceId = getStartupPlayableTutorialRaceId(profile);
  if (isConfiguredTutorialRaceId(startupRaceId)) {
    return startupRaceId;
  }
  const tutorialRaceId = getActiveTutorialRaceIdFromState(userId);
  if (isConfiguredTutorialRaceId(tutorialRaceId)) {
    return tutorialRaceId;
  }
  const raceCandidates = [
    profile.currentRaceId,
    profile.CurrentRaceId,
    profile.current_race_id,
    profile.crid,
    profile.jfrid,
    profile.JustFinishedRaceId,
    profile.justFinishedRaceId,
    profile.just_finished_race_id
  ];

  for (const candidate of raceCandidates) {
    if (isConfiguredTutorialRaceId(candidate)) {
      return String(candidate).trim();
    }
  }

  return '';
}

function buildAuthPreloadedRaceIds(userId, profile = {}) {
  const raceIds = [];
  const pushRaceId = (raceId) => {
    const normalizedRaceId = String(raceId || '').trim();
    if (!isConfiguredTutorialRaceId(normalizedRaceId) || raceIds.includes(normalizedRaceId)) {
      return;
    }
    raceIds.push(normalizedRaceId);
  };

  const activeBranchId = normalizeTutorialBranchId(
    firstDefined(
      getActiveTutorialBranchIdFromState(userId),
      getProfileDrivenTutorialCheckpoint(profile).activeBranchId,
      ''
    ),
    ''
  );
  const activeRaceId = getActiveTutorialRaceIdForAuth(userId, profile);
  pushRaceId(activeRaceId);

  return raceIds;
}

function getRaceObjectiveValue(raceConfig) {
  if (raceConfig && raceConfig.objectiveValue != null) {
    return String(raceConfig.objectiveValue);
  }
  return '';
}

function getTrafficLevelLabel(raceConfig, trafficCount) {
  const explicit = raceConfig && raceConfig.trafficLevel;
  if (explicit != null && String(explicit).trim() !== '') {
    return String(explicit);
  }
  if (trafficCount <= 0) return 'none';
  if (trafficCount >= 6) return 'gridlock';
  if (trafficCount >= 4) return 'heavy';
  return 'medium';
}

function getRaceCityKey(raceConfig, fallback = 'la') {
  const explicit = raceConfig && raceConfig.raceCity;
  if (explicit != null && String(explicit).trim() !== '') {
    return String(explicit).trim().toLowerCase();
  }
  const sceneName = String(
    (raceConfig && (raceConfig.sceneName || raceConfig.runtimeSceneName)) || ''
  ).trim().toLowerCase();
  if (sceneName.includes('tokyo')) return 'tokyo';
  if (sceneName.includes('miami')) return 'miami';
  if (sceneName.includes('rio')) return 'rio';
  if (sceneName.includes('abu')) return 'abu';
  if (sceneName.includes('losangeles') || sceneName.includes('los_angeles') || sceneName.includes('la_')) return 'la';
  return String(fallback || 'la').trim().toLowerCase();
}

function getCareerRaceCityKey(article, fallback = 'miami') {
  const source = article && typeof article === 'object' ? article : {};
  const explicitCity = String(firstDefined(source.raceCity, source.city, '') || '').trim().toLowerCase();
  if (explicitCity) {
    return getRaceCityKey({ raceCity: explicitCity }, fallback);
  }

  const hint = [
    source.raceLocationKey,
    source.chapterCity,
    source.raceSceneName,
    source.sceneName,
    source.runtimeSceneName,
    source.feedTitle,
    source.title
  ]
    .map((value) => String(value || '').trim().toLowerCase())
    .filter(Boolean)
    .join(' ');

  if (hint.includes('tokyo')) return 'tokyo';
  if (hint.includes('miami')) return 'miami';
  if (hint.includes('rio')) return 'rio';
  if (hint.includes('abu')) return 'abu';
  if (hint.includes('los angeles') || hint.includes('losangeles') || hint.includes('los_angeles') || hint.includes(' la ')) return 'la';
  return String(fallback || 'miami').trim().toLowerCase();
}

function getPrefabPath(record) {
  const meta = record && (record.CarMetaData || record.carMetaData || record.MetaData || record.metadata);
  return String(
    (record && record.carPrefabPath) ||
    (meta && meta.carPrefabPath) ||
    (record && record.PrefabName) ||
    (meta && meta.PrefabName) ||
    (record && record.carId) ||
    ''
  );
}

function nowTs() {
  return Math.floor(Date.now() / 1000);
}

function getBaseUrl(params) {
  const host = firstDefined(
    nested(params, 'host', ''),
    nested(params, 'headers.host', ''),
    params.host,
    '192.168.1.141'
  );
  const normalizedHost = String(host || '192.168.1.141').replace(/^https?:\/\//, '');
  return `http://${normalizedHost}`;
}

function futureTs(days) {
  return nowTs() + days * 24 * 60 * 60;
}

function makeToken(prefix) {
  return `${prefix}_${crypto.randomBytes(12).toString('hex')}`;
}

function firstDefined() {
  for (let i = 0; i < arguments.length; i += 1) {
    const value = arguments[i];
    if (value !== undefined && value !== null && String(value).trim() !== '') {
      return value;
    }
  }
  return '';
}

function nested(obj, path, fallback) {
  const parts = path.split('.');
  let current = obj;
  for (let i = 0; i < parts.length; i += 1) {
    if (!current || typeof current !== 'object' || !(parts[i] in current)) {
      return fallback;
    }
    current = current[parts[i]];
  }
  return current;
}

function sanitizeUserName(value, fallback) {
  const trimmed = String(value || fallback || 'Player').trim();
  return (trimmed || 'Player').slice(0, 16);
}

function sanitizeOptionalUserName(value) {
  const trimmed = String(value || '').trim();
  return trimmed ? trimmed.slice(0, 16) : '';
}

function isAutoGeneratedProfileName(value) {
  const name = String(value || '').trim();
  if (!name) return false;
  return (
    /^player\s/i.test(name) ||
    /^driver\s/i.test(name) ||
    /^guest/i.test(name) ||
    /^newb/i.test(name)
  );
}

function isBootstrapAutoName(value) {
  const name = String(value || '').trim();
  if (!name) return false;
  return /^guest/i.test(name) || /^newb/i.test(name);
}

function resolveProfileName(profile, user, params) {
  const requestedName = sanitizeOptionalUserName(
    firstDefined(params.name, params.username, params.user_name, params.playerName, params.prefill_name)
  );
  if (requestedName) {
    return requestedName;
  }

  const persistedName = sanitizeOptionalUserName(firstDefined(profile.name, profile.Nickname));
  if (!persistedName) {
    return '';
  }

  const hasManualRename = Number(nested(user, 'auth.lastRenameAt', 0)) > 0;
  const tutorialStep = Number(firstDefined(profile.tut_id, 0));
  const isEarlyTutorial = Number.isFinite(tutorialStep) && tutorialStep <= 1;
  if (isEarlyTutorial && !hasManualRename) {
    return '';
  }

  if (hasManualRename) {
    return persistedName;
  }

  if (isAutoGeneratedProfileName(persistedName)) {
    return '';
  }

  return persistedName;
}

function normalizeIdentity(params) {
  const sessionToken = String(firstDefined(
    params.stoken,
    params.token,
    params.session,
    nested(params, 'headers.x-kbm-authtoken', '')
  )).trim();

  if (sessionToken) {
    const matchedUserId = Object.entries(store.state.users || {}).find(([, user]) => {
      return user && user.auth && String(user.auth.sessionToken || '') === sessionToken;
    });
    if (matchedUserId) {
      return String(matchedUserId[0]);
    }
  }

  return String(firstDefined(
    params.naid,
    params.uid,
    params.id,
    params.player_id,
    params.playerId,
    params.device_id,
    params.deviceId,
    nested(params, 'device.device_id', ''),
    nested(params, 'info.device_id', ''),
    params.openudid,
    params.udid,
    nested(params, 'device.udid', ''),
    params.userId,
    'default'
  )).trim() || 'default';
}

function resolveRequestedAuthMode(params, fallback = 'guest') {
  const source = params && typeof params === 'object' ? params : {};
  const credentials = source.credentials && typeof source.credentials === 'object' ? source.credentials : {};
  const authenticatorName = String(firstDefined(
    source.authenticator,
    source.name,
    nested(source, 'authenticator.name', '')
  )).toLowerCase();
  const useWske =
    authenticatorName === 'wske' ||
    Boolean(
      credentials.token ||
      credentials.authToken ||
      nested(source, 'auth.wske.token', '') ||
      nested(source, 'auth.wske.authToken', '')
    );
  return useWske ? 'linked' : fallback;
}

function normalizeEmail(value) {
  return String(value || '').trim().toLowerCase();
}

function getStateUserIdFromAuth(auth) {
  if (!auth || typeof auth !== 'object') return 'default';
  return String(firstDefined(
    auth.naid,
    auth.playerId,
    auth.player_id,
    auth.uid,
    'default'
  )).trim() || 'default';
}

function ensureAuthState(userId, params) {
  const user = getUserState(userId);
  const profile = getProfile(userId);
  const internalUid = deriveInternalUid(userId);

  applyEarlyTutorialResourceDefaults(profile);

  if (!user.auth || typeof user.auth !== 'object') {
    user.auth = {};
  }

  if (!user.auth.uid || String(user.auth.uid) === String(userId)) {
    const candidateUid = String(firstDefined(profile.uid, profile.id, profile.userId, '')).trim();
    user.auth.uid = /^\d+$/.test(candidateUid) ? candidateUid : internalUid;
  }

  if (!user.auth.sessionToken) {
    user.auth.sessionToken = makeToken('sess');
  }

  if (!user.auth.naid) {
    user.auth.naid = userId;
  }

  if (!user.auth.cohortDate) {
    user.auth.cohortDate = futureTs(1);
  }

  if (!user.auth.salt) {
    user.auth.salt = makeToken('salt');
  }

  if (!user.auth.deviceAuth || typeof user.auth.deviceAuth !== 'object') {
    user.auth.deviceAuth = {};
  }

  const incomingEmail = normalizeEmail(firstDefined(params.email, params.mail, params.account));
  if (incomingEmail) {
    user.auth.email = incomingEmail;
    profile.email = incomingEmail;
  }

  const incomingName = resolveProfileName(profile, user, params || {});

  const normalizedLevel = Number(profile.level || profile.Level || profile.PlayerLevel || profile.Rank || 1);

  profile.name = incomingName;
  profile.Nickname = incomingName;
  profile.uid = String(user.auth.uid);
  profile.id = String(user.auth.uid);
  profile.userId = String(user.auth.uid);
  profile.naid = String(userId);
  profile.playerId = String(userId);
  profile.player_id = String(userId);
  profile.level = normalizedLevel;
  profile.Level = normalizedLevel;
  profile.PlayerLevel = normalizedLevel;
  profile.Rank = normalizedLevel;

  profile.Miles = Number(profile.Miles || 0);
  profile.xp = Number(profile.xp || profile.XP || 0);
  profile.XP = Number(profile.XP || profile.xp || 0);
  profile.currentXP = Number(profile.currentXP || profile.xp || profile.XP || 0);
  profile.rp = Number(profile.rp || profile.respectPoints || 0);
  profile.respectPoints = Number(profile.respectPoints || profile.rp || 0);
  profile.nextLevelXP = Number(profile.nextLevelXP || profile.NextLevelXP || 1000);
  profile.NextLevelXP = Number(profile.NextLevelXP || profile.nextLevelXP || 1000);
  if (!Array.isArray(profile.levelRewards)) profile.levelRewards = [];
  if (!Array.isArray(profile.nextLevelRewards)) profile.nextLevelRewards = [];
  if (!Array.isArray(profile.prevLevelRewards)) profile.prevLevelRewards = [];

  if (!Array.isArray(profile.OwnedVehicles)) {
    profile.OwnedVehicles = [];
  }
  if (!profile.OwnedVehiclesStatus || typeof profile.OwnedVehiclesStatus !== 'object') {
    profile.OwnedVehiclesStatus = {};
  }

  profile.OwnedVehicles = profile.OwnedVehicles
    .map((tag) => normalizeProfileVehicleTag(tag))
    .filter((tag, index, list) => list.indexOf(tag) === index);

  Object.keys(vehicleAssetAliases).forEach((legacyTag) => {
    const assetTag = String(vehicleAssetAliases[legacyTag]);
    if (Object.prototype.hasOwnProperty.call(profile.OwnedVehiclesStatus, legacyTag) && !Object.prototype.hasOwnProperty.call(profile.OwnedVehiclesStatus, assetTag)) {
      profile.OwnedVehiclesStatus[assetTag] = profile.OwnedVehiclesStatus[legacyTag];
    }
    if (Object.prototype.hasOwnProperty.call(profile.OwnedVehiclesStatus, legacyTag)) {
      delete profile.OwnedVehiclesStatus[legacyTag];
    }
  });

  if (FF7_SKIP_TUTORIAL_TO_GARAGE && FF7_LEGACY_GARAGE_CAR_IDS.length > 0) {
    profile.OwnedVehicles = profile.OwnedVehicles.filter((tag) => FF7_LEGACY_GARAGE_CAR_IDS.indexOf(String(tag)) === -1);
    FF7_LEGACY_GARAGE_CAR_IDS.forEach((tag) => {
      if (Object.prototype.hasOwnProperty.call(profile.OwnedVehiclesStatus, tag)) {
        delete profile.OwnedVehiclesStatus[tag];
      }
    });
  }

  const defaultOwnedVehicles = getDefaultOwnedVehicleTags();
  const freshTutorialIntro = isFreshTutorialIntroProfile(profile);
  if (freshTutorialIntro) {
    profile.OwnedVehicles = [];
    profile.OwnedVehiclesStatus = {};
  } else if (FF7_SKIP_TUTORIAL_TO_GARAGE && defaultOwnedVehicles.length > 0) {
    if (profile.OwnedVehicles.length === 0) {
      profile.OwnedVehicles = defaultOwnedVehicles.slice();
    }
    const normalizedOwnedVehicles = Array.isArray(profile.OwnedVehicles) ? profile.OwnedVehicles.slice() : [];
    profile.OwnedVehiclesStatus = normalizedOwnedVehicles.reduce((acc, tag) => {
      acc[tag] = clone(profile.OwnedVehiclesStatus[tag] || createOwnedVehicleStatus(tag));
      return acc;
    }, {});
  } else if (profile.OwnedVehicles.length === 0 && defaultOwnedVehicles.length > 0) {
    defaultOwnedVehicles.forEach((tag) => {
      if (profile.OwnedVehicles.indexOf(tag) === -1) {
        profile.OwnedVehicles.push(tag);
      }
      if (!profile.OwnedVehiclesStatus[tag]) {
        profile.OwnedVehiclesStatus[tag] = createOwnedVehicleStatus(tag);
      }
    });
  } else if (profile.OwnedVehicles.length === 0) {
    profile.OwnedVehicles = [];
    profile.OwnedVehiclesStatus = {};
  }

  const fallbackCurrentVehicleTag = FF7_SKIP_TUTORIAL_TO_GARAGE
    ? FF7_DEFAULT_CURRENT_CAR_ID
    : (freshTutorialIntro ? FF7_TUTORIAL_PLAYER_CAR_ID : (getFirstOwnedVehicleTag(profile) || FF7_DEFAULT_CURRENT_CAR_ID));
  profile.CurrentVehicleTag = normalizeProfileVehicleTag(
    FF7_SKIP_TUTORIAL_TO_GARAGE
      ? FF7_DEFAULT_CURRENT_CAR_ID
      : (freshTutorialIntro ? FF7_TUTORIAL_PLAYER_CAR_ID : (profile.CurrentVehicleTag || fallbackCurrentVehicleTag)),
    fallbackCurrentVehicleTag
  );
  profile.currentVehicleTag = profile.CurrentVehicleTag;
  if (!freshTutorialIntro && profile.OwnedVehicles.length > 0 && profile.OwnedVehicles.indexOf(profile.CurrentVehicleTag) === -1) {
    profile.CurrentVehicleTag = normalizeProfileVehicleTag(
      getFirstOwnedVehicleTag(profile),
      fallbackCurrentVehicleTag
    );
  } else if (!freshTutorialIntro && profile.OwnedVehicles.indexOf(profile.CurrentVehicleTag) === -1) {
    profile.OwnedVehicles.unshift(profile.CurrentVehicleTag);
  }
  profile.UsingOwnedVehicle = !freshTutorialIntro && profile.OwnedVehicles.length > 0;
  profile.maxcars = Math.max(
    Number(profile.maxcars || profile.maxCars || profile.MaxCars || profile.MaxOwnedCars || 0),
    profile.OwnedVehicles.length
  );
  profile.maxCars = profile.maxcars;
  profile.MaxCars = profile.maxcars;
  profile.maxmechanics = Math.max(
    1,
    Math.trunc(Number(
      profile.maxmechanics ||
      profile.maxMechanics ||
      profile.MaxMechanics ||
      profile.MaxOwnedMechanics ||
      2
    ) || 2)
  );
  profile.maxMechanics = profile.maxmechanics;
  profile.MaxMechanics = profile.maxmechanics;

  const ownerUid = String(profile.uid || profile.id || profile.userId || internalUid || '1001');
  const persistedBucket = getPersistedCarsBucket(userId, ownerUid);
  if (persistedBucket && typeof persistedBucket === 'object') {
    const activeRecord =
      persistedBucket[String(profile.lastRequestedCarId || profile.LastRequestedCarId || '')] ||
      persistedBucket[String(profile.active_carid || profile.activeCarId || '')] ||
      Object.values(persistedBucket).find((record) => String(record && record.carId || '') === String(profile.CurrentVehicleTag || '')) ||
      Object.values(persistedBucket)[0] ||
      null;
    if (activeRecord && typeof activeRecord === 'object') {
      const activeRecordId = String(activeRecord._id || activeRecord.id || '');
      const activeRecipeHash = Number(firstDefined(
        activeRecord.active_recipe,
        activeRecord.r && activeRecord.r.hash,
        activeRecord.recipe && activeRecord.recipe.hash,
        0
      ) || 0);
      const activeVehicleTag = String(activeRecord.carId || activeRecord.car || profile.CurrentVehicleTag || '');
      if (activeVehicleTag) {
        profile.CurrentVehicleTag = activeVehicleTag;
        profile.currentVehicleTag = activeVehicleTag;
      }
      profile.active_carid = activeRecordId;
      profile.activeCarId = activeRecordId;
      profile.active_recipe = activeRecipeHash;
    }
  }

  persistState();

  return { user, profile };
}

function buildDeviceAuthPayload(userId, params) {
  const normalizedUserId = String(userId || '').trim() || normalizeIdentity(params || {});
  const { user } = ensureAuthState(normalizedUserId, params || {});
  const udid = String(firstDefined(
    params.device_id,
    params.deviceId,
    nested(params, 'device.device_id', ''),
    user.auth.naid,
    nested(params, 'device.udid', ''),
    params.udid,
    normalizedUserId
  )).trim() || normalizedUserId;
  const deviceModel = String(firstDefined(
    params.deviceModel,
    nested(params, 'device.model', ''),
    nested(params, 'device.umodel', ''),
    'Unknown Device'
  ));
  const deviceName = String(firstDefined(
    params.deviceName,
    nested(params, 'device.dname', ''),
    nested(params, 'device.deviceName', ''),
    deviceModel,
    'Unknown Device'
  ));

  user.auth.deviceAuth = {
    id: udid,
    data: {
      udid,
      deviceModel,
      deviceName
    }
  };
  persistState();

  return Object.assign({}, user.auth.deviceAuth, {
    data: Object.assign({}, user.auth.deviceAuth.data)
  });
}

function buildEnumerateAccounts(params) {
  const normalizedUserId = normalizeIdentity(params || {});
  const { user, profile } = ensureAuthState(normalizedUserId, params || {});
  const deviceAuth = buildDeviceAuthPayload(normalizedUserId, params || {});
  const wskeToken = String(firstDefined(
    nested(params, 'auth.wske.token', ''),
    nested(params, 'auth.wske.authToken', ''),
    nested(user, 'auth.wskeToken', ''),
    'local_kabam_auth_token'
  ));
  const wskeUrl = String(firstDefined(
    nested(params, 'auth.wske.url', ''),
    nested(user, 'auth.wskeUrl', ''),
    getBaseUrl(params || {})
  ));
  const uid = String(user.auth.uid || profile.uid || profile.id || profile.userId || Math.floor(100000 + Math.random() * 900000));
  const naid = String(user.auth.naid || normalizedUserId);
  const name = resolveProfileName(profile, user, params || {});
  const email = normalizeEmail(firstDefined(profile.email, user.auth.email));
  const timeLast = nowTs();
  const cohort = Number(user.auth.cohortDate || futureTs(1));

  user.auth.uid = uid;
  user.auth.naid = naid;
  user.auth.wskeToken = wskeToken;
  user.auth.wskeUrl = wskeUrl;
  profile.uid = uid;
  profile.id = uid;
  profile.userId = uid;
  profile.name = name;
  profile.Nickname = name;
  profile.email = email;

  user.auth.enumerateAccounts = [
    {
      user: {
        uid,
        id: uid,
        userId: uid,
        naid,
        playerId: naid,
        player_id: naid,
        name,
        email,
        level: Number(profile.level || profile.Level || profile.PlayerLevel || profile.Rank || 1),
        xp: Number(profile.xp || profile.XP || 0),
        XP: Number(profile.XP || profile.xp || 0),
        revenue: 0,
        time_revenue: 0,
        time_last: timeLast,
        cohort
      },
      auth: {
        device: {
          id: deviceAuth.id,
          data: Object.assign({}, deviceAuth.data)
        },
        wske: {
          id: wskeToken,
          data: {
            token: wskeToken,
            authToken: wskeToken,
            url: wskeUrl,
            wskeUrl,
            clientId: 'ff7',
            playerId: naid,
            player_id: naid
          }
        }
      }
    }
  ];
  persistState();
  return user.auth.enumerateAccounts;
}

function buildUserResource(userId, params, authMode) {
  const normalizedUserId = String(userId || '').trim() || normalizeIdentity(params || {});
  const { user, profile } = ensureAuthState(normalizedUserId, params || {});
  const uid = String(user.auth.uid);
  const naid = String(user.auth.naid || normalizedUserId);
  const stoken = String(user.auth.sessionToken || makeToken('sess'));
  const cohort = Number(user.auth.cohortDate || futureTs(1));
  const email = normalizeEmail(firstDefined(profile.email, user.auth.email, params.email));
  const name = resolveProfileName(profile, user, params || {});
  const guest = authMode === 'guest';
  const loggedIn = authMode !== 'guest';

  user.auth.naid = naid;
  user.auth.sessionToken = stoken;
  user.auth.email = email;
  user.auth.lastAuthInitAt = nowTs();
  profile.name = name;
  profile.Nickname = name;
  profile.email = email;
  persistState();

  const normalizedLevel = Number(profile.level || profile.Level || profile.PlayerLevel || profile.Rank || 1);
  const normalizedXp = Number(profile.xp || profile.XP || 0);
  const normalizedRespectPoints = Number(profile.respectPoints || profile.rp || 0);
  const normalizedNextLevelXp = Number(profile.nextLevelXP || profile.NextLevelXP || 1000);
  const normalizedLevelRewards = Array.isArray(profile.levelRewards) ? clone(profile.levelRewards) : [];
  const normalizedNextLevelRewards = Array.isArray(profile.nextLevelRewards) ? clone(profile.nextLevelRewards) : [];
  const normalizedPrevLevelRewards = Array.isArray(profile.prevLevelRewards) ? clone(profile.prevLevelRewards) : [];
  const legacyLevelRewards = buildLegacyLevelRewardsStateFromProfile(profile);
  const legacyResources = buildLegacyResourcesStateFromProfile(profile);
  const hasName = Boolean(String(name || '').trim());

  return {
    ts: nowTs(),
    uid,
    naid,
    stoken,
    cohort,
    guest,
    loggedIn,
    email,
    name,
    user: {
      uid,
      id: uid,
      userId: uid,
      playerId: naid,
      player_id: naid,
      naid,
      name,
      Name: name,
      shortName: name,
      ShortName: name,
      hasName,
      HasName: hasName,
      email,
      gcid: '',
      fbid: '',
      guest,
      loggedIn,
      cohort,
      CohortDate: cohort,
      cohortDate: cohort,
      revenue: 0,
      time_revenue: 0,
      time_last: nowTs(),
      level: normalizedLevel,
      Level: normalizedLevel,
      PlayerLevel: normalizedLevel,
      Rank: normalizedLevel,
      xp: normalizedXp,
      XP: normalizedXp,
      currentXP: normalizedXp,
      rp: normalizedRespectPoints,
      respectPoints: normalizedRespectPoints,
      nextLevelXP: normalizedNextLevelXp,
      levelRewards: normalizedLevelRewards,
      nextLevelRewards: normalizedNextLevelRewards,
      prevLevelRewards: normalizedPrevLevelRewards,
      levelrewards: legacyLevelRewards,
      res: legacyResources
    }
  };
}

function buildNextRacesPayload(userId = null, raceIds = FF7_TUTORIAL_RACE_IDS) {
  const normalizedRaceIds = Array.isArray(raceIds) && raceIds.length > 0
    ? raceIds.map((raceId) => String(raceId || '').trim()).filter(Boolean)
    : FF7_TUTORIAL_RACE_IDS.slice();
  const profile = userId ? (getAuthoritativeProfile(userId) || {}) : {};
  const selectedProfileTag = getSupportedOwnedVehicleTags(
    [String(firstDefined(profile && (profile.CurrentVehicleTag || profile.currentVehicleTag), FF7_GARAGE_CAR_ID) || FF7_GARAGE_CAR_ID)],
    FF7_GARAGE_CAR_ID
  )[0];
  const raceData = normalizedRaceIds.map((raceId) => {
    const raceConfig = getTutorialRaceConfig(raceId);
    const playerTag = String(
      raceConfig.useSelectedPlayerCar
        ? selectedProfileTag
        : (raceConfig.playerCarId || FF7_TUTORIAL_PLAYER_CAR_ID)
    );
    const opponentTag = String(
      pickDeterministicVariant(
        `${String(userId || profile && (profile.uid || profile.id) || 'player')}:${raceId}`,
        raceConfig.opponentCarPool,
        raceConfig.opponentCarId || FF7_TUTORIAL_OPPONENT_CAR_ID
      ) || FF7_TUTORIAL_OPPONENT_CAR_ID
    );
    const trafficTags = Array.isArray(raceConfig.trafficCarIds) ? raceConfig.trafficCarIds.slice() : [];
    const policeTags = Array.isArray(raceConfig.policeCarIds) ? raceConfig.policeCarIds.slice() : [];
    const playerAssetTag = String(vehicleAssetAliases[playerTag] || playerTag);
    const opponentAssetTag = String(vehicleAssetAliases[opponentTag] || opponentTag);
    const playerStatus = createOwnedVehicleStatus(playerAssetTag);
    const opponentStatus = createOwnedVehicleStatus(opponentAssetTag);
    const playerRecipeArrays = getDefaultRecipeArrays(playerAssetTag);
    const opponentRecipeArrays = getDefaultRecipeArrays(opponentAssetTag);
    const playerRecipe = {
      c: classToNumber(playerTag),
      pc: playerAssetTag,
      n: playerAssetTag,
      p: playerRecipeArrays.p.slice(),
      vu: playerRecipeArrays.vu.slice(),
      eu: playerRecipeArrays.eu.slice(),
      q: estimateQuarterMile(playerTag),
      ut: playerRecipeArrays.ut.slice(),
      tid: 0,
      et: false,
      dc: -1,
      hash: computeRecipeHash(playerAssetTag)
    };
    const opponentRecipe = {
      c: classToNumber(opponentTag),
      pc: opponentAssetTag,
      n: opponentAssetTag,
      p: opponentRecipeArrays.p.slice(),
      vu: opponentRecipeArrays.vu.slice(),
      eu: opponentRecipeArrays.eu.slice(),
      q: estimateQuarterMile(opponentTag),
      ut: opponentRecipeArrays.ut.slice(),
      tid: 0,
      et: false,
      dc: -1,
      hash: computeRecipeHash(opponentAssetTag)
    };
    const playerMeta = buildCarMetaPayload(playerTag);
    const opponentMeta = buildCarMetaPayload(opponentTag);
    const trafficCars = trafficTags.map((tag, index) => {
      const assetTag = String(vehicleAssetAliases[tag] || tag);
      const recipeArrays = getDefaultRecipeArrays(assetTag);
      return {
        uid: `traffic-${raceId}-${index + 1}`,
        userId: `traffic-${raceId}-${index + 1}`,
        _id: assetTag,
        id: assetTag,
        carId: assetTag,
        q: estimateQuarterMile(tag),
        e: 0,
        recipe: {
          c: classToNumber(tag),
          pc: assetTag,
          n: assetTag,
          p: recipeArrays.p.slice(),
          vu: recipeArrays.vu.slice(),
          eu: recipeArrays.eu.slice(),
          q: estimateQuarterMile(tag),
          ut: recipeArrays.ut.slice(),
          tid: 0,
          et: false,
          dc: -1,
          hash: computeRecipeHash(assetTag)
        },
        CarMetaData: buildCarMetaPayload(tag)
      };
    });
    const policeCars = policeTags.map((tag, index) => {
      const assetTag = String(vehicleAssetAliases[tag] || tag);
      const recipeArrays = getDefaultRecipeArrays(assetTag);
      return {
        uid: `police-${raceId}-${index + 1}`,
        userId: `police-${raceId}-${index + 1}`,
        _id: assetTag,
        id: assetTag,
        carId: assetTag,
        q: estimateQuarterMile(tag),
        e: 0,
        recipe: {
          c: classToNumber(tag),
          pc: assetTag,
          n: assetTag,
          p: recipeArrays.p.slice(),
          vu: recipeArrays.vu.slice(),
          eu: recipeArrays.eu.slice(),
          q: estimateQuarterMile(tag),
          ut: recipeArrays.ut.slice(),
          tid: 0,
          et: false,
          dc: -1,
          hash: computeRecipeHash(assetTag)
        },
        CarMetaData: buildCarMetaPayload(tag)
      };
    });
    const allCars = [
      {
        uid: 'player',
        userId: 'player',
        _id: playerAssetTag,
        id: playerAssetTag,
        carId: playerAssetTag,
        q: estimateQuarterMile(playerTag),
        e: 0,
        pu: buildRacePerformanceUpgradePayload(playerStatus),
        up: buildRaceUpgradePartsPayload(playerStatus),
        vehicleStatus: clone(playerStatus),
        VehicleStatus: clone(playerStatus),
        recipe: { ...playerRecipe },
        CarMetaData: { ...playerMeta }
      },
      {
        uid: 'opponent',
        userId: 'opponent',
        _id: opponentAssetTag,
        id: opponentAssetTag,
        carId: opponentAssetTag,
        q: estimateQuarterMile(opponentTag),
        e: 0,
        pu: buildRacePerformanceUpgradePayload(opponentStatus),
        up: buildRaceUpgradePartsPayload(opponentStatus),
        vehicleStatus: clone(opponentStatus),
        VehicleStatus: clone(opponentStatus),
        recipe: { ...opponentRecipe },
        CarMetaData: { ...opponentMeta }
      },
      ...trafficCars.map((record) => ({ ...record, recipe: { ...record.recipe }, CarMetaData: { ...record.CarMetaData } })),
      ...policeCars.map((record) => ({ ...record, recipe: { ...record.recipe }, CarMetaData: { ...record.CarMetaData } }))
    ];
    const carsById = {};
    allCars.forEach((record) => {
      carsById[record.carId] = { ...record, recipe: { ...record.recipe }, CarMetaData: { ...record.CarMetaData } };
    });
    const objectiveValue = getRaceObjectiveValue(raceConfig);
    const trafficLevelLabel = getTrafficLevelLabel(raceConfig, trafficCars.length);
    const raceCityKey = getRaceCityKey(raceConfig, 'tokyo');
    const trafficPrefabs = trafficCars.map((record) => getPrefabPath(record));
    const policePrefabs = policeCars.map((record) => getPrefabPath(record));
    const defaultPolicePrefab = policePrefabs.length > 0 ? policePrefabs[0] : '';

    const racePayload = {
      ri: raceId,
      rc: 'story',
      rt: String(raceConfig.raceType || 'street'),
      pr: 250,
      clr: 0,
      sim: false,
      dis: false,
      ti: String(raceConfig.title || 'Tutorial Race'),
      de: String(raceConfig.description || 'Tutorial race'),
      ric: '',
      rci: raceCityKey,
      rde: objectiveValue,
      brd: [],
      obj: objectiveValue,
      sn: String(raceConfig.runtimeSceneName || raceConfig.sceneName || 'track_la_street'),
      sv: raceConfig.sceneVariant == null ? 'tutorial' : String(raceConfig.sceneVariant),
      tl: trafficLevelLabel,
      okl: 'easy',
      oc: opponentAssetTag,
      OpponentCar: opponentAssetTag,
      opponentCar: opponentAssetTag,
      OpponentCarId: opponentAssetTag,
      opponentCarId: opponentAssetTag,
      OpponentCarRecipe: { ...opponentRecipe },
      opponentCarRecipe: { ...opponentRecipe },
      OpponentCarMetaData: { ...opponentMeta },
      opponentCarMetaData: { ...opponentMeta },
      ov: opponentRecipe.vu.slice(),
      on: String(raceConfig.opponentName || 'Street Rival'),
      oph: Number(raceConfig.opponentPower || 1),
      opmt: Number(raceConfig.opponentMatchTime || 300),
      opi: Number(raceConfig.opponentPi || 280),
      opu: buildRacePerformanceUpgradePayload(opponentStatus),
      oup: buildRaceUpgradePartsPayload(opponentStatus),
      tm: String(raceConfig.textureMapping || ''),
      pspd: String(raceConfig.previousStoryPostDialogue || ''),
      cspd: String(raceConfig.currentStoryPreDialogue || ''),
      md: String(raceConfig.miscDialogue || ''),
      xw: 100,
      xgtw: 120,
      xl: 35,
      upw: 0,
      upgw: 0,
      upl: 0,
      hc: 0,
      ppti: normalizeProfilePicRef(raceConfig.ppti),
      cr: false,
      gt: false,
      gb: false,
      scw: 250,
      scl: 100,
      pra: '',
      pc: playerAssetTag,
      PlayerCar: playerAssetTag,
      playerCar: playerAssetTag,
      PlayerCarId: playerAssetTag,
      playerCarId: playerAssetTag,
      PlayerCarRecipe: { ...playerRecipe },
      playerCarRecipe: { ...playerRecipe },
      PlayerCarMetaData: { ...playerMeta },
      playerCarMetaData: { ...playerMeta },
      pv: playerRecipe.vu.slice(),
      ppu: buildRacePerformanceUpgradePayload(playerStatus),
      pup: buildRaceUpgradePartsPayload(playerStatus),
      PlayerCarData: { ...allCars[0], recipe: { ...allCars[0].recipe }, CarMetaData: { ...allCars[0].CarMetaData } },
      playerCarData: { ...allCars[0], recipe: { ...allCars[0].recipe }, CarMetaData: { ...allCars[0].CarMetaData } },
      OpponentCarData: { ...allCars[1], recipe: { ...allCars[1].recipe }, CarMetaData: { ...allCars[1].CarMetaData } },
      opponentCarData: { ...allCars[1], recipe: { ...allCars[1].recipe }, CarMetaData: { ...allCars[1].CarMetaData } },
      cars: allCars.map((record) => ({ ...record, recipe: { ...record.recipe }, CarMetaData: { ...record.CarMetaData } })),
      carsById,
      trafficCarsDisabled: trafficCars.length === 0,
      trafficCars: trafficCars.map((record) => record.carId),
      TrafficCars: trafficCars.map((record) => record.carId),
      trafficCarData: trafficCars.map((record) => ({ ...record, recipe: { ...record.recipe }, CarMetaData: { ...record.CarMetaData } })),
      TrafficCarData: trafficCars.map((record) => ({ ...record, recipe: { ...record.recipe }, CarMetaData: { ...record.CarMetaData } })),
      trafficVehiclePrefabList: trafficPrefabs.slice(),
      TrafficVehiclePrefabList: trafficPrefabs.slice(),
      aiTrafficVehicles: trafficCars.map((record) => ({ ...record, recipe: { ...record.recipe }, CarMetaData: { ...record.CarMetaData } })),
      AiTrafficVehicles: trafficCars.map((record) => ({ ...record, recipe: { ...record.recipe }, CarMetaData: { ...record.CarMetaData } })),
      aiTrafficVehiclePrefabs: trafficPrefabs.slice(),
      AiTrafficVehiclePrefabs: trafficPrefabs.slice(),
      trafficLevel: trafficLevelLabel,
      TrafficLevel: trafficLevelLabel,
      policeCars: policeCars.map((record) => record.carId),
      PoliceCars: policeCars.map((record) => record.carId),
      policeCarData: policeCars.map((record) => ({ ...record, recipe: { ...record.recipe }, CarMetaData: { ...record.CarMetaData } })),
      PoliceCarData: policeCars.map((record) => ({ ...record, recipe: { ...record.recipe }, CarMetaData: { ...record.CarMetaData } })),
      policeCarPrefabList: policePrefabs.slice(),
      PoliceCarPrefabList: policePrefabs.slice(),
      policeCarPool: policeCars.map((record) => ({ ...record, recipe: { ...record.recipe }, CarMetaData: { ...record.CarMetaData } })),
      PoliceCarPool: policeCars.map((record) => ({ ...record, recipe: { ...record.recipe }, CarMetaData: { ...record.CarMetaData } })),
      policeCarPath: defaultPolicePrefab,
      PoliceCarPath: defaultPolicePrefab,
      policeCarPrefab: defaultPolicePrefab,
      PoliceCarPrefab: defaultPolicePrefab,
      br2: [],
      br3: [],
      br4: [],
      br5: [],
      br6: []
    };
    return applyStoryDialogueAliases(
      enforceStartupDialogPayload(raceId, raceConfig, racePayload)
    );
  });

  const chapterBuckets = {};
  raceData.forEach((race) => {
    // Use raw config (bypasses disabled check) so chapter_01_a etc. keep their chapterNum
    const rawRaceConfig = (ff7TutorialConfig.races && ff7TutorialConfig.races[race.ri]) || {};
    const raceConfig = getTutorialRaceConfig(race.ri);
    const chapterId = String(rawRaceConfig.chapterId || raceConfig.chapterId || race.rci || 'chapter_00');
    const raceCityKey = getRaceCityKey(rawRaceConfig.raceCity ? rawRaceConfig : raceConfig, 'tokyo');
    if (!chapterBuckets[chapterId]) {
      chapterBuckets[chapterId] = {
        name: String(rawRaceConfig.chapterName || raceConfig.chapterName || 'Tutorial'),
        city: raceCityKey,
        status: 'started',
        count: 0,
        num: Number(rawRaceConfig.chapterNum != null ? rawRaceConfig.chapterNum : (raceConfig.chapterNum || 0)),
        raceInfos: [],
        class: 0,
        redeemers: [],
        icon: '',
        gachaToken: 'shipyard_token'
      };
    }
    chapterBuckets[chapterId].raceInfos.push({
      name: race.ri,
      type: race.rt
    });
    chapterBuckets[chapterId].count += 1;
  });

  return {
    raceData,
    chapterData: Object.values(chapterBuckets),
    simMultipliers: {}
  };
}

function buildProgressionPayload(userId) {
  const profile = getAuthoritativeProfile(userId) || {};
  const profileCheckpoint = getProfileDrivenTutorialCheckpoint(profile);
  const tutorialCompleted =
    !profileCheckpoint.activeBranchId &&
    Array.isArray(profileCheckpoint.completedBranchIds) &&
    profileCheckpoint.completedBranchIds.length > 0;
  const activeBranchId = normalizeTutorialBranchId(
    firstDefined(
      getActiveTutorialBranchIdFromState(userId),
      profileCheckpoint.activeBranchId,
      ''
    ),
    ''
  );
  const activeDisplayRaceId = getActiveTutorialRaceIdForAuth(userId, profile);
  const activeBranchRaceId = getTutorialBranchRaceId(activeBranchId, '');
  const activeBranchHasRace = isConfiguredTutorialRaceId(activeBranchRaceId);
  const activeRaceId = activeBranchHasRace ? activeDisplayRaceId : '';
  const lastCompletedRaceId = getLastCompletedTutorialRaceId(profile);
  const activeRaceConfig = isConfiguredTutorialRaceId(activeDisplayRaceId) ? getTutorialRaceConfig(activeDisplayRaceId) : {};
  const lastCompletedRaceConfig = isConfiguredTutorialRaceId(lastCompletedRaceId) ? getTutorialRaceConfig(lastCompletedRaceId) : {};
  const inferredChapterId = String(
    (tutorialCompleted ? firstDefined(profile.cmid, profile.chapterId, '') : '') ||
    activeRaceConfig.chapterId ||
    lastCompletedRaceConfig.chapterId ||
    FF7_FIRST_TUTORIAL_CONFIG.chapterId ||
    'chapter_00'
  );
  const inferredTutorialStep = tutorialCompleted
    ? Math.max(Number(profile.tut_id || 0), getCompletedTutorialStepValue())
    : (
        parseInt(
          String(activeBranchId || (activeDisplayRaceId ? getTutorialBranchIdForRaceId(activeDisplayRaceId, '') : '') || '').replace(/^G/i, ''),
          10
        ) || 1
      );
  const completeFreshSaveTutorials = shouldCompleteTutorialsOnFreshSave(profile);
  const garageProgression = (FF7_SKIP_TUTORIAL_TO_GARAGE || completeFreshSaveTutorials)
    ? buildGarageCareerProgressionSeed(profile)
    : null;
  const defaults = (FF7_SKIP_TUTORIAL_TO_GARAGE || completeFreshSaveTutorials)
    ? {
        won_races: clone(garageProgression.wonRaces || {}),
        lost_races: {},
        last_story_race: String(garageProgression.lastStoryRaceId || 'chapter_01_c'),
        crid: String(garageProgression.nextRaceId || ''),
        jfrid: String(garageProgression.nextRaceId || ''),
        cmid: String(garageProgression.chapterId || 'chapter_01'),
        tut_id: getCompletedTutorialStepValue(),
        CurrentRaceId: String(garageProgression.nextRaceId || ''),
        currentRaceId: String(garageProgression.nextRaceId || ''),
        current_race_id: String(garageProgression.nextRaceId || ''),
        JustFinishedRaceId: String(garageProgression.lastStoryRaceId || 'chapter_01_c'),
        justFinishedRaceId: String(garageProgression.lastStoryRaceId || 'chapter_01_c'),
        just_finished_race_id: String(garageProgression.lastStoryRaceId || 'chapter_01_c'),
        LastWonStoryRaceID: String(garageProgression.lastStoryRaceId || 'chapter_01_c'),
        lastWonStoryRaceID: String(garageProgression.lastStoryRaceId || 'chapter_01_c'),
        lastWonStoryRaceId: String(garageProgression.lastStoryRaceId || 'chapter_01_c')
      }
    : {
        won_races: {},
        lost_races: {},
        last_story_race: String(firstDefined(profile.last_story_race, lastCompletedRaceId) || ''),
        crid: activeRaceId,
        jfrid: activeRaceId,
        cmid: inferredChapterId,
        tut_id: inferredTutorialStep,
        CurrentRaceId: activeRaceId,
        currentRaceId: activeRaceId,
        current_race_id: activeRaceId,
        JustFinishedRaceId: lastCompletedRaceId,
        justFinishedRaceId: lastCompletedRaceId,
        just_finished_race_id: lastCompletedRaceId,
        LastWonStoryRaceID: lastCompletedRaceId,
        lastWonStoryRaceID: lastCompletedRaceId,
        lastWonStoryRaceId: lastCompletedRaceId
      };
  const numericCareerWins = Object.keys((profile && profile.won_races) || {}).filter((raceId) => /^\d+$/.test(String(raceId || '')));
  if (numericCareerWins.length > 0) {
    const orderedCareerArticles = (defaultCareerData.articleList || [])
      .slice()
      .sort((left, right) => Number(left && left.id || 0) - Number(right && right.id || 0));
    const currentCareerArticle = findCareerArticleByRaceKey(
      orderedCareerArticles,
      String(firstDefined(
        defaults.crid,
        defaults.jfrid,
        defaults.CurrentRaceId,
        defaults.currentRaceId,
        defaults.current_race_id,
        ''
      ) || '').trim()
    );
    const nextCareerArticle = orderedCareerArticles.find((article) => !hasWonCareerArticle(profile && profile.won_races, article));
    const resolvedCareerArticle = currentCareerArticle || nextCareerArticle || orderedCareerArticles[0] || null;
    defaults.cmid = String(firstDefined(
      resolvedCareerArticle && resolvedCareerArticle.chapterId,
      defaults.cmid,
      'chapter_01'
    ) || 'chapter_01');
    if (!String(defaults.crid || '').trim()) {
      if (nextCareerArticle) {
        const nextRaceId = getCareerArticleClientRaceId(nextCareerArticle, String(nextCareerArticle.id || ''));
        defaults.crid = nextRaceId;
        defaults.jfrid = nextRaceId;
        defaults.CurrentRaceId = nextRaceId;
        defaults.currentRaceId = nextRaceId;
        defaults.current_race_id = nextRaceId;
      }
    }
  }
  if (!String(defaults.crid || '').trim()) {
    const firstCareerArticle = (defaultCareerData.articleList || [])
      .slice()
      .sort((left, right) => Number(left && left.id || 0) - Number(right && right.id || 0))[0];
    if (firstCareerArticle) {
      defaults.cmid = String(firstCareerArticle.chapterId || defaults.cmid || 'chapter_01');
      const firstRaceId = getCareerArticleClientRaceId(firstCareerArticle, String(firstCareerArticle.id || ''));
      defaults.crid = firstRaceId;
      defaults.jfrid = firstRaceId;
      defaults.CurrentRaceId = firstRaceId;
      defaults.currentRaceId = firstRaceId;
      defaults.current_race_id = firstRaceId;
    }
  }
  const resolvedChapterFromRace = findCareerArticleByRaceKey(
    defaultCareerData.articleList || [],
    String(firstDefined(
      defaults.crid,
      defaults.jfrid,
      defaults.CurrentRaceId,
      defaults.currentRaceId,
      defaults.current_race_id,
      ''
    ) || '').trim()
  );
  if (resolvedChapterFromRace && resolvedChapterFromRace.chapterId) {
    defaults.cmid = String(resolvedChapterFromRace.chapterId || defaults.cmid || 'chapter_01');
    const canonicalRaceId = getCareerArticleClientRaceId(
      resolvedChapterFromRace,
      String(firstDefined(defaults.crid, defaults.CurrentRaceId, resolvedChapterFromRace.id || '') || '')
    );
    defaults.crid = canonicalRaceId;
    defaults.jfrid = canonicalRaceId;
    defaults.CurrentRaceId = canonicalRaceId;
    defaults.currentRaceId = canonicalRaceId;
    defaults.current_race_id = canonicalRaceId;
  }

  return {
    won_races: profile.won_races && typeof profile.won_races === 'object' ? clone(profile.won_races) : clone(defaults.won_races),
    lost_races: profile.lost_races && typeof profile.lost_races === 'object' ? clone(profile.lost_races) : clone(defaults.lost_races),
    last_story_race: String(defaults.last_story_race || ''),
    crid: String(defaults.crid || ''),
    jfrid: String(defaults.jfrid || ''),
    cmid: String(defaults.cmid || ''),
    tut_id: Number(defaults.tut_id || 1),
    CurrentRaceId: String(defaults.CurrentRaceId || ''),
    currentRaceId: String(defaults.currentRaceId || ''),
    current_race_id: String(defaults.current_race_id || ''),
    JustFinishedRaceId: String(defaults.JustFinishedRaceId || ''),
    justFinishedRaceId: String(defaults.justFinishedRaceId || ''),
    just_finished_race_id: String(defaults.just_finished_race_id || ''),
    LastWonStoryRaceID: String(defaults.LastWonStoryRaceID || ''),
    lastWonStoryRaceID: String(defaults.lastWonStoryRaceID || ''),
    lastWonStoryRaceId: String(defaults.lastWonStoryRaceId || '')
  };
}

function compactRaceForAuth(race) {
  if (!race || typeof race !== 'object') return null;
  const source = race;
  const playerNode = (source.cars && (source.cars.player || source.cars.Player)) || {};
  const opponentNode = (source.cars && (source.cars.opponent || source.cars.Opponent)) || {};
  const playerTag = String(firstDefined(
    playerNode.n,
    playerNode.carId,
    playerNode.car,
    source.pc,
    source.PlayerCar,
    source.playerCar,
    ''
  ) || '').trim();
  const opponentTag = String(firstDefined(
    opponentNode.n,
    opponentNode.carId,
    opponentNode.car,
    source.oc,
    source.OpponentCar,
    source.opponentCar,
    ''
  ) || '').trim();
  const playerMeta = playerTag ? buildCarMetaPayload(playerTag) : null;
  const opponentMeta = opponentTag ? buildCarMetaPayload(opponentTag) : null;
  const compactCarNode = (tag, node, meta, fallbackPi) => ({
    n: tag,
    car: tag,
    carId: tag,
    Tag: tag,
    tag: tag,
    AssetTag: tag,
    pi: Number(firstDefined(node && node.pi, fallbackPi, 0) || 0),
    fn: String(firstDefined(meta && meta.fn, meta && meta.Name, meta && meta.name, tag) || ''),
    tbp: String(firstDefined(meta && meta.tbp, '') || ''),
    cty: String(firstDefined(meta && meta.cty, 'stock') || 'stock'),
    vu: String(firstDefined(node && node.vu, '') || '')
  });
  const trimmed = {
    ri: String(firstDefined(source.ri, source.id, '') || ''),
    id: String(firstDefined(source.id, source.ri, '') || ''),
    rc: String(firstDefined(source.rc, '') || ''),
    rt: String(firstDefined(source.rt, '') || ''),
    rci: String(firstDefined(source.rci, source.raceCity, source.RaceCity, source.cityKey, '') || ''),
    raceCity: String(firstDefined(source.raceCity, source.RaceCity, source.rci, source.cityKey, '') || ''),
    RaceCity: String(firstDefined(source.RaceCity, source.raceCity, source.rci, source.cityKey, '') || ''),
    sn: String(firstDefined(source.sn, '') || ''),
    sv: String(firstDefined(source.sv, '') || ''),
    on: String(firstDefined(source.on, '') || ''),
    oc: opponentTag,
    pc: playerTag,
    pr: Number(firstDefined(source.pr, 0) || 0),
    opi: Number(firstDefined(source.opi, source.oph, 0) || 0),
    prt: Number(firstDefined(source.prt, 0) || 0),
    prs: Number(firstDefined(source.prs, 0) || 0),
    ptt: Number(firstDefined(source.ptt, 0) || 0),
    cspd: String(firstDefined(source.cspd, '') || ''),
    tl: String(firstDefined(source.tl, '') || ''),
    cityKey: String(firstDefined(source.cityKey, '') || ''),
    mapShape: String(firstDefined(source.mapShape, '') || ''),
    chapterId: String(firstDefined(source.chapterId, source.cmid, '') || ''),
    chapterName: String(firstDefined(source.chapterName, '') || ''),
    chapterNumber: Number(firstDefined(source.chapterNumber, source.chapterNum, source.num, source.number, 0) || 0),
    class: String(firstDefined(source.class, '') || ''),
    classRequirement: String(firstDefined(source.classRequirement, source.ClassRequirement, '') || ''),
    classMax: String(firstDefined(source.classMax, source.ClassMax, '') || ''),
    rewards: clone(source.rewards || []),
    raceReward: clone(source.raceReward || null),
    articleId: String(firstDefined(source.articleId, '') || ''),
    icon: String(firstDefined(source.icon, '') || '')
  };
  trimmed.cars = {
    player: compactCarNode(playerTag, playerNode, playerMeta, trimmed.pr),
    opponent: compactCarNode(opponentTag, opponentNode, opponentMeta, trimmed.opi)
  };
  return trimmed;
}

function getCareerArticleClientRaceId(article, fallback = '') {
  return String(getStoryArticleRaceId(article, fallback || String(article && article.id || '')) || '').trim();
}

function getCareerArticleRaceKeys(article) {
  const keys = new Set();
  const clientRaceId = getCareerArticleClientRaceId(article, '');
  const numericId = String(article && article.id || '').trim();
  if (clientRaceId) keys.add(clientRaceId);
  if (numericId) keys.add(numericId);
  return Array.from(keys);
}

function hasWonCareerArticle(wonRaces, article) {
  if (!wonRaces || typeof wonRaces !== 'object') {
    return false;
  }
  return getCareerArticleRaceKeys(article).some((raceKey) => wonRaces[raceKey]);
}

function getOrderedCareerArticlesForProgression() {
  return (Array.isArray(defaultCareerData.articleList) ? defaultCareerData.articleList : [])
    .slice()
    .sort((left, right) => Number(left && left.id || 0) - Number(right && right.id || 0));
}

function getLatestWonCareerRaceId(profile = {}, orderedArticles = null) {
  const wonRaces = profile && typeof profile.won_races === 'object' ? profile.won_races : {};
  const ordered = Array.isArray(orderedArticles) ? orderedArticles : getOrderedCareerArticlesForProgression();
  let lastMatch = '';
  ordered.forEach((article) => {
    if (hasWonCareerArticle(wonRaces, article)) {
      lastMatch = getCareerArticleClientRaceId(article, String(article && article.id || ''));
    }
  });
  return String(firstDefined(
    profile.last_story_race,
    profile.LastWonStoryRaceID,
    profile.lastWonStoryRaceID,
    profile.lastWonStoryRaceId,
    lastMatch,
    ''
  ) || '').trim();
}

function buildGarageCareerProgressionSeed(profile = {}) {
  const orderedArticles = getOrderedCareerArticlesForProgression();
  const wonRaces = profile && typeof profile.won_races === 'object'
    ? clone(profile.won_races)
    : { chapter_00_a: 1, chapter_01_b: 1, chapter_01_c: 1 };
  const preferredRaceId = String(firstDefined(
    profile.crid,
    profile.jfrid,
    profile.CurrentRaceId,
    profile.currentRaceId,
    profile.current_race_id,
    ''
  ) || '').trim();
  const preferredArticle =
    findCareerArticleByRaceKey(orderedArticles, preferredRaceId) ||
    orderedArticles.find((article) => !hasWonCareerArticle(wonRaces, article)) ||
    orderedArticles[0] ||
    null;
  const canonicalPreferredRaceId = preferredArticle
    ? getCareerArticleClientRaceId(preferredArticle, String(preferredArticle.id || ''))
    : '';
  const nextRaceId = String(
    firstDefined(
      canonicalPreferredRaceId,
      preferredRaceId,
      ''
    ) || ''
  ).trim();
  const chapterId = String(firstDefined(
    profile.cmid,
    preferredArticle && preferredArticle.chapterId,
    'chapter_01'
  ) || 'chapter_01').trim();
  const lastStoryRaceId = getLatestWonCareerRaceId(profile, orderedArticles) || 'chapter_01_c';
  return {
    wonRaces,
    nextRaceId,
    chapterId,
    lastStoryRaceId
  };
}

function findCareerArticleByRaceKey(articles, raceKey) {
  const normalizedRaceKey = String(raceKey || '').trim();
  if (!normalizedRaceKey) {
    return null;
  }
  return (Array.isArray(articles) ? articles : []).find((article) => (
    getCareerArticleRaceKeys(article).includes(normalizedRaceKey)
  )) || null;
}

function findCareerRacePayloadByKey(races, raceKey) {
  const normalizedRaceKey = String(raceKey || '').trim();
  if (!normalizedRaceKey) {
    return null;
  }
  return (Array.isArray(races) ? races : []).find((race) => (
    [
      String(firstDefined(race && race.ri, '') || '').trim(),
      String(firstDefined(race && race.id, '') || '').trim(),
      String(firstDefined(race && race.articleId, '') || '').trim()
    ].includes(normalizedRaceKey)
  )) || null;
}

function buildCareerChapterData(userId = null) {
  const chapters = (defaultCareerData.articleStructure && defaultCareerData.articleStructure.careerChapters) || [];
  const articleById = new Map((defaultCareerData.articleList || []).map((article) => [String(article && article.id), article]));
  const profile = userId ? getAuthoritativeProfile(userId) : {};
  const wonRaces = profile && typeof profile.won_races === 'object' ? profile.won_races : {};
  return chapters.map((chapter, index) => {
    const articleIds = Array.isArray(chapter && chapter.events)
      ? chapter.events.flatMap((event) => (Array.isArray(event && event.articleIdList) ? event.articleIdList : []))
      : [];
    const articlesFinished = articleIds.reduce((count, articleId) => {
      const article = articleById.get(String(articleId)) || { id: articleId };
      return count + (hasWonCareerArticle(wonRaces, article) ? 1 : 0);
    }, 0);
    const chapterNum = Number((chapter && chapter.num) || index + 1);
    const chapterName = String(
      (chapter && chapter.name) ||
      (chapter && chapter.chapterName) ||
      `chapter_${String(chapterNum).padStart(2, '0')}`
    );
    const rawChapterId = String(
      (chapter && (chapter.chapterId || chapter.id)) ||
      ''
    ).trim();
    const normalizedChapterId =
      !rawChapterId || /^chapter-\d+$/i.test(rawChapterId)
        ? chapterName
        : rawChapterId;
    const rawCity = String((chapter && (chapter.cityKey || chapter.city || '')) || '').trim().toLowerCase();
    const normalizedCity =
      rawCity === 'miami, u.s.a.' ? 'miami' :
      rawCity === 'los angeles' ? 'la' :
      rawCity === 'tokyo, japan' ? 'tokyo' :
      (rawCity || `city_${index + 1}`);
    const chapterTitle = String((chapter && chapter.title) || `CHAPTER ${index + 1}`);
    const chapterCityLabel = String((chapter && (chapter.cityLabel || chapter.city || '')) || '');
    return {
      name: chapterName,
      chapterName,
      ChapterName: chapterName,
      city: normalizedCity,
      status: articleIds.length > 0 && articlesFinished >= articleIds.length ? 'completed' : 'started',
      count: articleIds.length,
      num: chapterNum,
      chapterId: normalizedChapterId,
      ChapterId: normalizedChapterId,
      cmid: normalizedChapterId,
      CMID: normalizedChapterId,
      chapterTitle: chapterTitle,
      ChapterTitle: chapterTitle,
      chapterCity: normalizedCity,
      ChapterCity: normalizedCity,
      chapterCityLabel,
      ChapterCityLabel: chapterCityLabel,
      cityKey: normalizedCity,
      CityKey: normalizedCity,
      chapterNumber: chapterNum,
      ChapterNumber: chapterNum,
      chapterNum,
      class: Number(firstDefined(chapter && chapter.class, chapter && chapter.classRequirement, 1) || 1),
      classRequirement: Number(firstDefined(chapter && chapter.classRequirement, chapter && chapter.class, 1) || 1),
      ClassRequirement: Number(firstDefined(chapter && chapter.classRequirement, chapter && chapter.class, 1) || 1),
      classMax: Number(firstDefined(chapter && chapter.classMax, chapter && chapter.classRequirement, 1) || 1),
      ClassMax: Number(firstDefined(chapter && chapter.classMax, chapter && chapter.classRequirement, 1) || 1),
      chapterClassRequirement: Number(firstDefined(chapter && chapter.chapterClassRequirement, chapter && chapter.classRequirement, 1) || 1),
      ChapterClassRequirement: Number(firstDefined(chapter && chapter.chapterClassRequirement, chapter && chapter.classRequirement, 1) || 1),
      articlesFinished,
      articlesTotal: articleIds.length,
      beastDefeated: articlesFinished > 0,
      raceInfos: articleIds.map((articleId) => {
        const article = articleById.get(String(articleId)) || {};
        return {
          name: getCareerArticleClientRaceId(article, String(articleId)),
          type: String(article.eventType || 'street')
        };
      }),
      redeemers: [],
      icon: String((chapter && chapter.icon) || `race_story_chapter${chapterNum}_bg`),
      gachaToken: 'shipyard_token'
    };
  });
}

function buildStandaloneAuthRaceCarRecord(tag, ownerUid, index = 0, forcedPi = null) {
  const canonicalTag = getSupportedOwnedVehicleTags(
    [String(tag || FF7_GARAGE_CAR_ID)],
    FF7_GARAGE_CAR_ID
  )[0];
  const assetTag = String(vehicleAssetAliases[canonicalTag] || canonicalTag);
  const recipeArrays = getDefaultRecipeArrays(assetTag);
  const status = clone(createOwnedVehicleStatus(assetTag));
  const condition = buildOwnedVehicleCondition(assetTag, status);
  const meta = buildCarMetaPayload(canonicalTag);
  const recordId = createOwnedVehicleRecordId(ownerUid, assetTag, index);
  const recipe = {
    c: classToNumber(canonicalTag),
    pc: assetTag,
    n: assetTag,
    p: recipeArrays.p.slice(),
    vu: recipeArrays.vu.slice(),
    eu: recipeArrays.eu.slice(),
    q: estimateQuarterMile(canonicalTag),
    ut: recipeArrays.ut.slice(),
    tid: 0,
    et: false,
    dc: -1,
    hash: computeRecipeHash(assetTag)
  };
  const pi = Number(forcedPi != null ? forcedPi : getCanonicalVehiclePi(assetTag, status));
  return {
    uid: String(ownerUid || 'opponent'),
    userId: String(ownerUid || 'opponent'),
    id: recordId,
    _id: recordId,
    carId: assetTag,
    car: assetTag,
    n: assetTag,
    pi,
    cond: clone(condition),
    dvu: recipe.vu.slice(),
    inv: [],
    ud: false,
    r: clone(recipe),
    recipe: clone(recipe),
    Recipe: clone(recipe),
    q: Number(recipe.q || 0),
    e: 0,
    pu: clone(buildRacePerformanceUpgradePayload(status)),
    up: clone(buildRaceUpgradePartsPayload(status)),
    vehicleStatus: clone(status),
    VehicleStatus: clone(status),
    Tag: assetTag,
    tag: assetTag,
    carTag: canonicalTag,
    AssetTag: meta.AssetTag,
    assetTag: meta.AssetTag,
    Name: meta.Name,
    name: meta.name,
    AttributeTag: meta.AttributeTag,
    PrefabName: meta.PrefabName,
    carPrefabPath: meta.carPrefabPath,
    carModelAttributePath: meta.carModelAttributePath,
    defaultVisualUpgrade: meta.defaultVisualUpgrade,
    CarMetaData: clone(meta),
    MetaData: clone(meta),
    metadata: clone(meta)
  };
}

function buildCareerRaceData(userId = null, articlesArg = null) {
  const articles = Array.isArray(articlesArg)
    ? articlesArg
    : (defaultCareerData.articleList || []);
  const profile = userId ? getAuthoritativeProfile(userId) : {};
  const state = userId ? getUserState(userId) : null;
  const garageCars = userId ? buildCarsPayload(userId) : [];
  const runtimeSelectedCar =
    state &&
    state.sparx &&
    state.sparx.dataStore &&
    isPlainObject(state.sparx.dataStore.car)
      ? clone(state.sparx.dataStore.car)
      : null;
  const runtimeSelectedTag = normalizeProfileVehicleTag(
    firstDefined(
      runtimeSelectedCar && runtimeSelectedCar.AssetTag,
      runtimeSelectedCar && runtimeSelectedCar.assetTag,
      runtimeSelectedCar && runtimeSelectedCar.carId,
      runtimeSelectedCar && runtimeSelectedCar.car,
      runtimeSelectedCar && runtimeSelectedCar.Tag,
      runtimeSelectedCar && runtimeSelectedCar.tag,
      runtimeSelectedCar && runtimeSelectedCar.CurrentVehicleTag,
      runtimeSelectedCar && runtimeSelectedCar.currentVehicleTag,
      runtimeSelectedCar && runtimeSelectedCar.r && runtimeSelectedCar.r.n,
      runtimeSelectedCar && runtimeSelectedCar.recipe && runtimeSelectedCar.recipe.n,
      ''
    ),
    ''
  );
  const preferredRecordId = String(
    firstDefined(
      runtimeSelectedCar && (runtimeSelectedCar._id || runtimeSelectedCar.id),
      profile && (profile.lastRequestedCarId || profile.LastRequestedCarId),
      profile && (profile.active_carid || profile.activeCarId),
      ''
    ) || ''
  ).trim();
  const fallbackVehicleTag = normalizeProfileVehicleTag(
    firstDefined(
      runtimeSelectedTag,
      profile && (profile.CurrentVehicleTag || profile.currentVehicleTag),
      FF7_GARAGE_CAR_ID
    ),
    FF7_GARAGE_CAR_ID
  );
  const runtimeSelectedRecord = clone(
    (runtimeSelectedCar && garageCars.find((record) => {
      const recordId = String(firstDefined(record && record._id, record && record.id, '') || '').trim();
      const runtimeRecordId = String(firstDefined(runtimeSelectedCar && runtimeSelectedCar._id, runtimeSelectedCar && runtimeSelectedCar.id, '') || '').trim();
      if (recordId && runtimeRecordId && recordId === runtimeRecordId) {
        return true;
      }
      const recordTag = normalizeProfileVehicleTag(
        firstDefined(
          record && (record.AssetTag || record.assetTag),
          record && (record.carTag || record.carId || record.car),
          record && record.r && record.r.n,
          record && record.recipe && record.recipe.n,
          ''
        ),
        ''
      );
      return Boolean(recordTag && runtimeSelectedTag && recordTag === runtimeSelectedTag);
    })) ||
    runtimeSelectedCar ||
    null
  );
  const selectedPlayerRecord = clone(
    runtimeSelectedRecord ||
    (preferredRecordId ? garageCars.find((record) => String(firstDefined(record && record._id, record && record.id, '') || '').trim() === preferredRecordId) : null) ||
    garageCars.find((record) => {
      const recordTag = normalizeProfileVehicleTag(
        firstDefined(
          record && (record.AssetTag || record.assetTag),
          record && (record.carTag || record.carId || record.car),
          record && record.r && record.r.n,
          record && record.recipe && record.recipe.n,
          ''
        ),
        ''
      );
      return Boolean(recordTag && recordTag === fallbackVehicleTag);
    }) ||
    garageCars.find((record) => {
      const recordId = String(firstDefined(record && record._id, record && record.id, '') || '').trim();
      const activeRecordId = String(firstDefined(
        profile && (profile.lastRequestedCarId || profile.LastRequestedCarId),
        profile && (profile.active_carid || profile.activeCarId),
        ''
      ) || '').trim();
      if (recordId && activeRecordId && recordId === activeRecordId) {
        return true;
      }
      const recordTag = normalizeProfileVehicleTag(
        firstDefined(
          record && (record.AssetTag || record.assetTag),
          record && (record.carTag || record.carId || record.car),
          ''
        ),
        ''
      );
      return Boolean(recordTag && recordTag === fallbackVehicleTag);
    }) ||
    (preferredRecordId ? resolveOwnedVehicleRecord(userId, preferredRecordId, fallbackVehicleTag) : null) ||
    resolveOwnedVehicleRecord(userId, fallbackVehicleTag, fallbackVehicleTag) ||
    garageCars[0] ||
    buildStandaloneAuthRaceCarRecord(fallbackVehicleTag, String(profile && (profile.uid || profile.id || userId) || 'player'), 0)
  );
  const activeVehicleTag = normalizeProfileVehicleTag(
    firstDefined(
      selectedPlayerRecord && (selectedPlayerRecord.AssetTag || selectedPlayerRecord.assetTag),
      selectedPlayerRecord && (selectedPlayerRecord.carTag || selectedPlayerRecord.carId || selectedPlayerRecord.car),
      selectedPlayerRecord && selectedPlayerRecord.r && selectedPlayerRecord.r.n,
      selectedPlayerRecord && selectedPlayerRecord.recipe && selectedPlayerRecord.recipe.n,
      fallbackVehicleTag
    ),
    fallbackVehicleTag
  );

  const orderedArticles = (() => {
    const wonRaces = profile && profile.won_races && typeof profile.won_races === 'object'
      ? profile.won_races
      : {};
    const chapterRaceId = String(
      firstDefined(
        profile && profile.crid,
        profile && profile.jfrid,
        profile && profile.CurrentRaceId,
        profile && profile.currentRaceId,
        profile && profile.last_story_race,
        ''
      )
    ).trim();
    const tutorialId = Number(profile && profile.tut_id || 0);
    const firstUnwonArticle = articles.find((article) => !hasWonCareerArticle(wonRaces, article));
    const preferredArticle =
      findCareerArticleByRaceKey(articles, chapterRaceId) ||
      firstUnwonArticle ||
      (tutorialId >= 9 ? findCareerArticleByRaceKey(articles, 'chapter_01_b') : null);
    if (preferredArticle) {
      const preferredArticleId = Number(preferredArticle && preferredArticle.id || 0);
      return articles.slice().sort((left, right) => {
        const leftId = Number(left && left.id || 0);
        const rightId = Number(right && right.id || 0);
        if (leftId === preferredArticleId) return -1;
        if (rightId === preferredArticleId) return 1;
        return leftId - rightId;
      });
    }
    return articles;
  })();

  return orderedArticles.map((article, index) => {
    const raceId = getCareerArticleClientRaceId(article, String(article && article.id || ''));
    const raceCityKey = getCareerRaceCityKey(article, 'miami');
    const playerTag = String(
      firstDefined(
        selectedPlayerRecord && (selectedPlayerRecord.AssetTag || selectedPlayerRecord.assetTag),
        selectedPlayerRecord && (selectedPlayerRecord.carId || selectedPlayerRecord.car || selectedPlayerRecord.carTag),
        activeVehicleTag,
        FF7_GARAGE_CAR_ID
      ) || FF7_GARAGE_CAR_ID
    );
    const soloRace = Boolean(article && article.solo);
    const needsVsOpponent = soloRace && String(article && article.eventType || '') === 'drift';
    const opponentTag = soloRace
      ? ''
      : String(
          pickDeterministicVariant(
            `${String(userId || profile && (profile.uid || profile.id) || 'player')}:${String(article && article.id || index + 1)}`,
            article && article.opponentCarPool,
            (article && article.opponentCarId) || 'honda_civic_euro_2012'
          ) || 'honda_civic_euro_2012'
        );
    const displayOpponentTag = needsVsOpponent
      ? String(
          firstDefined(
            article && article.vsOpponentCarId,
            playerTag,
            'honda_civic_euro_2012'
          ) || 'honda_civic_euro_2012'
        )
      : opponentTag;
    const opponentRecord = soloRace
      ? null
      : buildStandaloneAuthRaceCarRecord(
          opponentTag,
          `opponent-${String(article && article.id || index + 1)}`,
          0,
          Number((article && article.opponentPi) || (article && article.requiredPi) || 250)
        );
    const displayOpponentRecord = opponentRecord || (displayOpponentTag
      ? buildStandaloneAuthRaceCarRecord(
          displayOpponentTag,
          `opponent-vs-${String(article && article.id || index + 1)}`,
          0,
          Number((article && article.requiredPi) || 250)
        )
      : null);
    const trafficRecords = (Array.isArray(article && article.trafficCarIds) ? article.trafficCarIds : [])
      .map((tag, trafficIndex) => buildStandaloneAuthRaceCarRecord(
        tag,
        `traffic-${String(article && article.id || index + 1)}-${trafficIndex + 1}`,
        trafficIndex,
        Number((article && article.requiredPi) || 250)
      ));
    const policeRecords = (Array.isArray(article && article.policeCarIds) ? article.policeCarIds : [])
      .map((tag, policeIndex) => buildStandaloneAuthRaceCarRecord(
        tag,
        `police-${String(article && article.id || index + 1)}-${policeIndex + 1}`,
        policeIndex,
        Number((article && article.requiredPi) || 250)
      ));
    const trafficPrefabs = trafficRecords.map((record) => getPrefabPath(record));
    const policePrefabs = policeRecords.map((record) => getPrefabPath(record));
    const trafficCarIds = trafficRecords.map((record) => record.carId);
    const policeCarIds = policeRecords.map((record) => record.carId);
    const rewardSc = Math.max(0, Math.trunc(Number(firstDefined(article && article.rewardSc, article && article.softCurrencyReward, 250) || 250)));
    const rewardHc = Math.max(0, Math.trunc(Number(firstDefined(article && article.rewardHc, article && article.hardCurrencyReward, 0) || 0)));
    const rewardUp = Math.max(0, Math.trunc(Number(firstDefined(article && article.rewardUp, article && article.upgradeReward, 0) || 0)));
    const rewardXp = Math.max(0, Math.trunc(Number(firstDefined(article && article.rewardXp, article && article.xpReward, 35) || 35)));
    const classRequirement = Math.max(1, Math.trunc(Number(firstDefined(article && article.classRequirement, article && article.requiredClass, 1) || 1)));
    const classMax = Math.max(classRequirement, Math.trunc(Number(firstDefined(article && article.classMax, classRequirement, 1) || 1)));
    return compactRaceForAuth({
      ri: raceId,
      id: raceId,
      articleId: String(article && article.id || ''),
      rc: String((article && article.raceCollection) || 'story'),
      chapterId: String((article && article.chapterId) || 'chapter_01'),
      ChapterId: String((article && article.chapterId) || 'chapter_01'),
      cmid: String((article && article.chapterId) || 'chapter_01'),
      chapterTitle: String((article && article.chapterTitle) || 'CHAPTER 1'),
      ChapterTitle: String((article && article.chapterTitle) || 'CHAPTER 1'),
      chapterCity: String((article && article.chapterCity) || 'MIAMI, U.S.A.'),
      ChapterCity: String((article && article.chapterCity) || 'MIAMI, U.S.A.'),
      chapterNumber: Number((article && article.chapterNumber) || 1),
      ChapterNumber: Number((article && article.chapterNumber) || 1),
      chapterNum: Number((article && article.chapterNumber) || 1),
      classRequirement,
      ClassRequirement: classRequirement,
      crq: classRequirement,
      ccr: classRequirement,
      classMax,
      ClassMax: classMax,
      cmx: classMax,
      chapterClassRequirement: classRequirement,
      ChapterClassRequirement: classRequirement,
      rt: String((article && article.eventType) || 'street'),
      pr: Number((article && article.requiredPi) || 250),
      clr: 0,
      sim: false,
      dis: false,
      solo: soloRace,
      ti: String((article && article.title) || `Race ${index + 1}`),
      de: String((article && article.description) || 'Career race'),
      ric: String((article && article.raceIcon) || (soloRace ? 'EventSolo' : 'Practice')),
      rci: raceCityKey,
      rde: String((article && article.event && article.event.targetDescription) || 'Win the race'),
      brd: [],
      obj: String((article && article.event && article.event.targetDescription) || 'Win the race'),
      sn: String((article && article.raceSceneName) || 'track_miami_street'),
      sv: String((article && article.raceSceneVariant) || 'shortTrack'),
      tl: getTrafficLevelLabel(article, trafficRecords.length),
      okl: 'easy',
      on: soloRace ? '' : String((article && article.opponentName) || 'Street Rival'),
      oph: soloRace ? 0 : 1,
      opmt: soloRace ? 0 : Number((article && article.opponentMatchTime) || 420),
      opi: needsVsOpponent
        ? Number((article && article.requiredPi) || 250)
        : (soloRace ? 0 : Number((article && article.opponentPi) || (article && article.requiredPi) || 250)),
      tm: String((article && article.textureMapping) || ''),
      pspd: String((article && article.previousStoryPostDialogue) || ''),
      cspd: String((article && article.currentStoryPreDialogue) || ''),
      md: String((article && article.miscDialogue) || ''),
      xw: 100,
      xgtw: 120,
      xl: rewardXp,
      upw: rewardUp,
      upgw: 0,
      upl: 0,
      hc: rewardHc,
      ppti: String((article && article.ppti) || ''),
      cr: true,
      gt: String(article && !['grind', 'random_grind'].includes(String(article.raceCollection || ''))
        ? (article.gachaTokenReward || '')
        : ''),
      gb: String(article && !['grind', 'random_grind'].includes(String(article.raceCollection || ''))
        ? (article.gachaTokenBox || '')
        : ''),
      wr: clone((article && article.winRedeemers) || []),
      WinRedeemers: clone((article && article.winRedeemers) || []),
      scw: rewardSc,
      scl: 100,
      pc: playerTag,
      PlayerCar: playerTag,
      playerCar: playerTag,
      PlayerCarId: playerTag,
      playerCarId: playerTag,
      PlayerCarRecipe: clone(selectedPlayerRecord.r || selectedPlayerRecord.recipe || selectedPlayerRecord.Recipe || null),
      playerCarRecipe: clone(selectedPlayerRecord.r || selectedPlayerRecord.recipe || selectedPlayerRecord.Recipe || null),
      PlayerCarMetaData: clone(selectedPlayerRecord.CarMetaData || selectedPlayerRecord.carMetaData || selectedPlayerRecord.MetaData || selectedPlayerRecord.metadata || null),
      playerCarMetaData: clone(selectedPlayerRecord.CarMetaData || selectedPlayerRecord.carMetaData || selectedPlayerRecord.MetaData || selectedPlayerRecord.metadata || null),
      PlayerCarData: clone(selectedPlayerRecord),
      playerCarData: clone(selectedPlayerRecord),
      cars: {
        player: clone(selectedPlayerRecord),
        opponent: soloRace ? {} : clone(opponentRecord)
      },
      trafficCarsDisabled: trafficRecords.length === 0,
      trafficCars: trafficCarIds.slice(),
      TrafficCars: trafficCarIds.slice(),
      trafficCarIds: trafficCarIds.slice(),
      TrafficCarIds: trafficCarIds.slice(),
      trafficCarData: trafficRecords.map((record) => clone(record)),
      TrafficCarData: trafficRecords.map((record) => clone(record)),
      aiTrafficVehicles: trafficRecords.map((record) => clone(record)),
      AiTrafficVehicles: trafficRecords.map((record) => clone(record)),
      trafficVehiclePrefabList: trafficPrefabs.slice(),
      TrafficVehiclePrefabList: trafficPrefabs.slice(),
      policeCars: policeCarIds.slice(),
      PoliceCars: policeCarIds.slice(),
      policeCarIds: policeCarIds.slice(),
      PoliceCarIds: policeCarIds.slice(),
      policeCarData: policeRecords.map((record) => clone(record)),
      PoliceCarData: policeRecords.map((record) => clone(record)),
      policeCarPrefabList: policePrefabs.slice(),
      PoliceCarPrefabList: policePrefabs.slice(),
      policeCarPath: policePrefabs[0] || '',
      PoliceCarPath: policePrefabs[0] || '',
      policeCarPrefab: policePrefabs[0] || '',
      PoliceCarPrefab: policePrefabs[0] || '',
      pv: Array.isArray(selectedPlayerRecord && selectedPlayerRecord.r && selectedPlayerRecord.r.vu)
        ? selectedPlayerRecord.r.vu.join('&')
        : String((selectedPlayerRecord && selectedPlayerRecord.defaultVisualUpgrade) || ''),
      ppu: clone(selectedPlayerRecord.pu || buildRacePerformanceUpgradePayload(selectedPlayerRecord.vehicleStatus || selectedPlayerRecord.VehicleStatus || {})),
      pup: clone(selectedPlayerRecord.up || buildRaceUpgradePartsPayload(selectedPlayerRecord.vehicleStatus || selectedPlayerRecord.VehicleStatus || {})),
      oc: displayOpponentRecord ? displayOpponentRecord.carId : '',
      OpponentCar: displayOpponentRecord ? displayOpponentRecord.carId : '',
      opponentCar: displayOpponentRecord ? displayOpponentRecord.carId : '',
      OpponentCarId: displayOpponentRecord ? displayOpponentRecord.carId : '',
      opponentCarId: displayOpponentRecord ? displayOpponentRecord.carId : '',
      OpponentCarRecipe: clone(displayOpponentRecord && (displayOpponentRecord.r || displayOpponentRecord.recipe || displayOpponentRecord.Recipe || null)),
      opponentCarRecipe: clone(displayOpponentRecord && (displayOpponentRecord.r || displayOpponentRecord.recipe || displayOpponentRecord.Recipe || null)),
      OpponentCarMetaData: clone(displayOpponentRecord && (displayOpponentRecord.CarMetaData || displayOpponentRecord.carMetaData || displayOpponentRecord.MetaData || displayOpponentRecord.metadata || null)),
      opponentCarMetaData: clone(displayOpponentRecord && (displayOpponentRecord.CarMetaData || displayOpponentRecord.carMetaData || displayOpponentRecord.MetaData || displayOpponentRecord.metadata || null)),
      OpponentCarData: clone(displayOpponentRecord),
      opponentCarData: clone(displayOpponentRecord),
      pv2: '',
      ov: Array.isArray(displayOpponentRecord && displayOpponentRecord.r && displayOpponentRecord.r.vu)
        ? displayOpponentRecord.r.vu.join('&')
        : String((displayOpponentRecord && displayOpponentRecord.defaultVisualUpgrade) || ''),
      opu: clone(displayOpponentRecord ? (displayOpponentRecord.pu || buildRacePerformanceUpgradePayload(displayOpponentRecord.vehicleStatus || displayOpponentRecord.VehicleStatus || {})) : {}),
      oup: clone(displayOpponentRecord ? (displayOpponentRecord.up || buildRaceUpgradePartsPayload(displayOpponentRecord.vehicleStatus || displayOpponentRecord.VehicleStatus || {})) : {})
    });
  });
}

function buildChallengeRaceDataForAuth(userId = null) {
  return buildCareerRaceData(userId, defaultChallengeArticles)
    .concat(buildCareerRaceData(userId, defaultRandomChallengeArticles))
    .map((race) => compactRaceForAuth(race));
}

function compactChapterForAuth(chapter) {
  if (!chapter || typeof chapter !== 'object') {
    return null;
  }
  return {
    name: chapter.name,
    chapterName: chapter.chapterName,
    ChapterName: chapter.ChapterName,
    city: chapter.city,
    status: chapter.status,
    count: chapter.count,
    num: chapter.num,
    chapterId: chapter.chapterId,
    ChapterId: chapter.ChapterId,
    cmid: chapter.cmid,
    CMID: chapter.CMID,
    chapterTitle: chapter.chapterTitle,
    ChapterTitle: chapter.ChapterTitle,
    chapterCity: chapter.chapterCity,
    ChapterCity: chapter.ChapterCity,
    chapterCityLabel: chapter.chapterCityLabel,
    ChapterCityLabel: chapter.ChapterCityLabel,
    cityKey: chapter.cityKey,
    CityKey: chapter.CityKey,
    chapterNumber: chapter.chapterNumber,
    ChapterNumber: chapter.ChapterNumber,
    chapterNum: chapter.chapterNum,
    class: chapter.class,
    classRequirement: chapter.classRequirement,
    ClassRequirement: chapter.ClassRequirement,
    classMax: chapter.classMax,
    ClassMax: chapter.ClassMax,
    chapterClassRequirement: chapter.chapterClassRequirement,
    ChapterClassRequirement: chapter.ChapterClassRequirement,
    articlesFinished: chapter.articlesFinished,
    articlesTotal: chapter.articlesTotal,
    beastDefeated: chapter.beastDefeated,
    raceInfos: Array.isArray(chapter.raceInfos)
      ? chapter.raceInfos.map((raceInfo) => ({
          name: raceInfo && raceInfo.name,
          type: raceInfo && raceInfo.type
        }))
      : [],
    redeemers: Array.isArray(chapter.redeemers) ? chapter.redeemers.slice() : [],
    icon: chapter.icon,
    gachaToken: chapter.gachaToken
  };
}

function buildCompactGamestorePayload(userId) {
  const fullPayload = buildGameStoreRefreshPayload(userId, { partial: true }) || {};
  const allowedCategories = new Set(['visual_upgrades', 'shipyard']);
  const slimStoreEntry = (entry) => {
    const storeId = String(firstDefined(entry && entry.id, entry && entry.Id, '') || '').trim();
    const title = String(firstDefined(entry && entry.title, entry && entry.Title, storeId) || storeId);
    const packageIds = Array.isArray(entry && entry.packages) ? entry.packages.slice() : [];
    return {
      id: storeId,
      Id: storeId,
      title,
      Title: title,
      packages: clone(packageIds),
      Packages: clone(packageIds)
    };
  };
  const slimPackageEntry = (entry) => {
    const packageId = String(firstDefined(entry && entry.id, entry && entry.Id, '') || '').trim();
    const title = String(firstDefined(entry && entry.title, entry && entry.Title, packageId) || packageId);
    const setId = String(firstDefined(entry && entry.setId, entry && entry.SetID, '') || '').trim() || 'garage';
    const pricingId = String(firstDefined(entry && entry.pricingId, entry && entry.PricingID, packageId) || packageId);
    const cost = Math.max(0, Math.trunc(Number(firstDefined(
      entry && entry.cost,
      entry && entry.Cost,
      nested(entry, 'buy.ct', 0),
      nested(entry, 'Buy.ct', 0),
      0
    ) || 0)));
    return {
      id: packageId,
      Id: packageId,
      title,
      Title: title,
      cost,
      Cost: cost,
      buy: { ct: cost },
      Buy: { ct: cost },
      pricingId,
      PricingID: pricingId,
      setId,
      SetID: setId,
      itemTag: String(firstDefined(entry && entry.itemTag, entry && entry.ItemTag, packageId) || packageId),
      ItemTag: String(firstDefined(entry && entry.ItemTag, entry && entry.itemTag, packageId) || packageId)
    };
  };
  const slimItemEntry = (entry) => {
    const itemId = String(firstDefined(entry && entry.n, entry && entry.id, entry && entry.itemTag, '') || '').trim();
    const title = String(firstDefined(entry && entry.t, entry && entry.title, entry && entry.Title, itemId) || itemId);
    const description = String(firstDefined(entry && entry.d, entry && entry.description, entry && entry.Description, '') || '');
    const image = String(firstDefined(entry && entry.i, entry && entry.image, entry && entry.Image, '') || '');
    const category = String(firstDefined(entry && entry.category, entry && entry.Category, 'garage') || 'garage').trim() || 'garage';
    return {
      version_id: String(firstDefined(entry && entry.version_id, entry && entry.versionId, '') || ''),
      versionId: String(firstDefined(entry && entry.versionId, entry && entry.version_id, '') || ''),
      VersionID: String(firstDefined(entry && entry.VersionID, entry && entry.versionId, entry && entry.version_id, '') || ''),
      n: itemId,
      Name: itemId,
      id: itemId,
      itemTag: itemId,
      category,
      Category: category,
      t: title,
      Title: title,
      d: description,
      Description: description,
      i: image,
      Image: image,
      p: Array.isArray(entry && entry.p) ? clone(entry.p) : [],
      r: Array.isArray(entry && entry.r) ? clone(entry.r) : [],
      e: entry && entry.e !== false,
      vr: Boolean(entry && entry.vr)
    };
  };

  const compactStores = Array.isArray(fullPayload.stores)
    ? fullPayload.stores.filter((entry) => {
        const id = String(firstDefined(entry && entry.id, entry && entry.Id, '') || '').trim();
        return id === 'visual_upgrades' || id === 'shipyard';
      }).map(slimStoreEntry)
    : [];

  const compactPackages = Array.isArray(fullPayload.packages)
    ? fullPayload.packages.filter((entry) => {
        const setId = String(firstDefined(entry && entry.setId, entry && entry.SetID, '') || '').trim().toLowerCase();
        return setId === 'visual_upgrades' || setId === 'base' || setId === 'shipyard';
      }).map(slimPackageEntry)
    : [];

  const sourceItems = Array.isArray(fullPayload.items)
    ? fullPayload.items
    : Object.values((fullPayload.groupedItems && typeof fullPayload.groupedItems === 'object' ? fullPayload.groupedItems : {}) || {}).flatMap((entry) => (Array.isArray(entry) ? entry : []));
  const filteredSourceItems = sourceItems.filter((entry) => {
    const itemId = String(firstDefined(entry && entry.n, entry && entry.id, '') || '').trim();
    if (!itemId || itemId.endsWith('_item')) {
      return false;
    }
    const category = String(firstDefined(entry && entry.category, entry && entry.Category, '') || '').trim();
    return allowedCategories.has(category);
  });
  const flattenedItems = filteredSourceItems.map(slimItemEntry);
  const compactSetIdMap = fullPayload.setIdMap && typeof fullPayload.setIdMap === 'object'
    ? Object.keys(fullPayload.setIdMap).reduce((acc, key) => {
        if (key === 'visual_upgrades' || key === 'shipyard' || key === 'base' || key === 'garage' || key === 'hurry_items') {
          acc[key] = fullPayload.setIdMap[key];
        }
        return acc;
      }, {})
    : {};
  const compactPackageIds = new Set(compactPackages.map((entry) => String(firstDefined(entry && entry.id, entry && entry.Id, '') || '').trim()).filter(Boolean));
  const compactActive = Array.isArray(fullPayload.active)
    ? clone(fullPayload.active).filter((entry) => compactPackageIds.has(String(entry || '').trim()))
    : [];
  const compactPending = Array.isArray(fullPayload.pending)
    ? clone(fullPayload.pending).filter((entry) => compactPackageIds.has(String(entry || '').trim()))
    : [];
  const groupedItems = flattenedItems.reduce((acc, entry) => {
    const category = String(firstDefined(entry && entry.category, 'garage') || 'garage').trim() || 'garage';
    if (!acc[category]) {
      acc[category] = [];
    }
      acc[category].push(clone(entry));
    return acc;
  }, {});
  const itemMap = flattenedItems.reduce((acc, entry) => {
    const itemId = String(firstDefined(entry && entry.n, entry && entry.id, '') || '').trim();
    if (itemId) {
      acc[itemId] = clone(entry);
    }
    return acc;
  }, {});
  const compactCore = {
    version_id: String(fullPayload.version_id || ''),
    versionId: String(firstDefined(fullPayload.versionId, fullPayload.version_id, '') || ''),
    cdn: String(fullPayload.cdn || ''),
    tags: Array.isArray(fullPayload.tags) ? clone(fullPayload.tags) : [],
    setIdMap: clone(compactSetIdMap),
    SetIdMap: clone(compactSetIdMap),
    items: clone(flattenedItems),
    itemMap: clone(itemMap),
    groupedItems: clone(groupedItems),
    stores: clone(compactStores),
    packages: clone(compactPackages),
    active: clone(compactActive),
    pending: clone(compactPending),
    hash: String(fullPayload.hash || fullPayload.check || ''),
    check: String(fullPayload.check || fullPayload.hash || '')
  };
  return {
    ...compactCore,
    connected: true,
    status: 'ok',
    changed: fullPayload.changed !== false,
    refresh: fullPayload.refresh !== false
  };
}

function buildBootstrapGamestorePayload(userId) {
  const compact = buildCompactGamestorePayload(userId);
  const itemMap = compact.itemMap && typeof compact.itemMap === 'object' ? compact.itemMap : {};
  return {
    version_id: String(compact.version_id || ''),
    versionId: String(compact.versionId || compact.version_id || ''),
    VersionID: String(compact.VersionID || compact.version_id || ''),
    cdn: String(compact.cdn || ''),
    connected: true,
    status: 'ok',
    tags: Array.isArray(compact.tags) ? clone(compact.tags) : [],
    setIdMap: clone(compact.setIdMap || {}),
    SetIdMap: clone(compact.setIdMap || {}),
    items: Array.isArray(compact.items) ? clone(compact.items) : [],
    Items: Array.isArray(compact.items) ? clone(compact.items) : [],
    itemMap: clone(itemMap),
    ItemMap: clone(itemMap),
    stores: clone(compact.stores || []),
    Stores: clone(compact.stores || []),
    packages: clone(compact.packages || []),
    Packages: clone(compact.packages || []),
    active: Array.isArray(compact.active) ? clone(compact.active) : [],
    Active: Array.isArray(compact.active) ? clone(compact.active) : [],
    pending: Array.isArray(compact.pending) ? clone(compact.pending) : [],
    Pending: Array.isArray(compact.pending) ? clone(compact.pending) : [],
    hash: String(compact.hash || compact.check || ''),
    check: String(compact.check || compact.hash || ''),
    changed: compact.changed !== false,
    refresh: compact.refresh !== false
  };
}

function buildGamestoreAutoRefreshEnvelope(payload) {
  const innerPayload = payload && typeof payload === 'object' ? clone(payload) : {};
  const check = String(firstDefined(
    innerPayload.check,
    innerPayload.hash,
    innerPayload.dbHash,
    ''
  ) || '');
  const refresh = Math.max(60, Math.trunc(Number(firstDefined(
    innerPayload.refreshInterval,
    innerPayload.nextRefresh,
    3600
  ) || 3600)));
  return {
    connected: true,
    status: 'connected',
    changed: innerPayload.changed !== false,
    refresh,
    check,
    hash: check,
    dbHash: String(firstDefined(innerPayload.dbHash, check) || check),
    gamestore: Object.assign({}, innerPayload, {
      connected: true,
      status: 'connected',
      changed: innerPayload.changed !== false,
      refresh,
      check,
      hash: check,
      dbHash: String(firstDefined(innerPayload.dbHash, check) || check)
    })
  };
}

function buildLoginVisualUpgradeTuningPayload() {
  const fullPayload = buildVisualUpgradeTuningPayload();
  return {
    dbHash: String(firstDefined(fullPayload && fullPayload.dbHash, '') || ''),
    tuningData: clone((fullPayload && fullPayload.tuningData) || [])
  };
}

function buildLoginGamestorePayload(userId) {
  const bootstrap = buildBootstrapGamestorePayload(userId);
  return buildGamestoreAutoRefreshEnvelope(bootstrap);
}

function buildCompactAccountNextRacesPayload(userId, progression = null) {
  const currentProgression = progression || buildProgressionPayload(userId);
  const targetRaceId = String(firstDefined(
    currentProgression && currentProgression.currentRaceId,
    currentProgression && currentProgression.crid,
    currentProgression && currentProgression.jfrid,
    ''
  ) || '').trim();
  const targetChapterId = String(firstDefined(
    currentProgression && currentProgression.cmid,
    ''
  ) || '').trim();
  const storyRaceData = buildCareerRaceData(userId);
  let selectedRace = findCareerRacePayloadByKey(storyRaceData, targetRaceId) || storyRaceData[0] || null;
  const chapterData = buildCareerChapterData(userId);
  const selectedChapter = chapterData.find((chapter) => (
    String(firstDefined(
      chapter && chapter.chapterId,
      chapter && chapter.cmid,
      chapter && chapter.chapterName,
      ''
    ) || '').trim() === targetChapterId
  )) || chapterData.find((chapter) => (
    selectedRace &&
    Array.isArray(chapter && chapter.raceInfos) &&
    chapter.raceInfos.some((raceInfo) => String(firstDefined(raceInfo && raceInfo.name, '') || '').trim() === String(selectedRace.ri || '').trim())
  )) || chapterData[0] || null;

  if (
    selectedRace &&
    selectedChapter &&
    Array.isArray(selectedChapter.raceInfos) &&
    selectedChapter.raceInfos.length > 0
  ) {
    const raceBelongsToChapter = selectedChapter.raceInfos.some((raceInfo) => (
      String(firstDefined(raceInfo && raceInfo.name, '') || '').trim() === String(selectedRace.ri || '').trim()
    ));
    if (!raceBelongsToChapter) {
      const chapterRaceId = String(firstDefined(selectedChapter.raceInfos[0] && selectedChapter.raceInfos[0].name, '') || '').trim();
      const alignedRace = findCareerRacePayloadByKey(storyRaceData, chapterRaceId);
      if (alignedRace) {
        selectedRace = alignedRace;
      }
    }
  }

  return {
    raceData: selectedRace ? [compactRaceForAuth(selectedRace)] : [],
    chapterData: selectedChapter ? [compactChapterForAuth(selectedChapter)] : [],
    simMultipliers: {}
  };
}

function buildAuthNextRacesPayload(userId) {
  const profile = getAuthoritativeProfile(userId) || {};
  const completeFreshSaveTutorials = shouldCompleteTutorialsOnFreshSave(profile);
  if (isFreshTutorialIntroProfile(profile)) {
    const payload = buildNextRacesPayload(userId, [FF7_TUTORIAL_RACE_ID]);
    return {
      raceData: Array.isArray(payload.raceData) ? payload.raceData.map((race) => compactRaceForAuth(race)) : [],
      chapterData: Array.isArray(payload.chapterData)
        ? payload.chapterData.map((chapter) => ({
            name: chapter.name,
            city: chapter.city,
            status: chapter.status,
            count: chapter.count,
            num: chapter.num,
            raceInfos: Array.isArray(chapter.raceInfos) ? chapter.raceInfos.map((raceInfo) => ({ name: raceInfo.name, type: raceInfo.type })) : [],
            class: chapter.class,
            redeemers: Array.isArray(chapter.redeemers) ? clone(chapter.redeemers) : [],
            icon: chapter.icon,
            gachaToken: chapter.gachaToken
          }))
        : [],
      simMultipliers: {}
    };
  }
  const profileCheckpoint = getProfileDrivenTutorialCheckpoint(profile);
  const wonRaces = profile.won_races && typeof profile.won_races === 'object' ? profile.won_races : {};
  const tutorialStep = Math.max(0, Math.trunc(Number(profile.tut_id || 0)));
  const completedTutorialStepValue = getCompletedTutorialStepValue();
  const chapterMissionId = String(firstDefined(
    profile.cmid,
    profile.CurrentMissionId,
    profile.currentMissionId,
    ''
  ) || '').trim();
  const hasStoryChapterProgress = /^chapter_\d{2}$/i.test(chapterMissionId);
  const resolvedRacePointerId = String(firstDefined(
    profile.crid,
    profile.jfrid,
    profile.CurrentRaceId,
    profile.currentRaceId,
    profile.current_race_id,
    ''
  )).trim();
  const hasCareerRacePointer =
    /^(?:\d+|chapter_\d{2}_[a-z])$/i.test(resolvedRacePointerId) &&
    !isConfiguredTutorialRaceId(resolvedRacePointerId);
  const activeBranchId = getActiveTutorialBranchIdFromState(userId);
  const activeRaceId = getActiveTutorialRaceIdForAuth(userId, profile);
  const tutorialMarkedComplete =
    FF7_SKIP_TUTORIAL_TO_GARAGE ||
    completeFreshSaveTutorials ||
    hasCareerRacePointer ||
    (
      !profileCheckpoint.activeBranchId &&
      Array.isArray(profileCheckpoint.completedBranchIds) &&
      profileCheckpoint.completedBranchIds.length >= FF7_TUTORIAL_BRANCH_IDS.length
    ) ||
    (
      !isConfiguredTutorialRaceId(activeRaceId) &&
      (
        tutorialStep >= 2 ||
        (String(profile.crid || '').trim() === '' && String(profile.jfrid || '').trim() === '' && Object.keys(wonRaces).length > 0)
      )
    ) ||
    tutorialStep >= completedTutorialStepValue ||
    (!activeBranchId && hasStoryChapterProgress && tutorialStep >= 9);
  if (tutorialMarkedComplete) {
    const progression = buildProgressionPayload(userId);
    const compactPayload = buildCompactAccountNextRacesPayload(userId, progression);
    const challengeRaceData = buildChallengeRaceDataForAuth(userId);
    return {
      raceData: (Array.isArray(compactPayload.raceData) ? compactPayload.raceData : []).concat(challengeRaceData),
      chapterData: Array.isArray(compactPayload.chapterData) ? compactPayload.chapterData : [],
      simMultipliers: {}
    };
  }
  const preloadRaceIds = buildAuthPreloadedRaceIds(userId, profile);
  const payload = buildNextRacesPayload(userId, preloadRaceIds.length > 0 ? preloadRaceIds : [activeRaceId]);
  return {
    raceData: Array.isArray(payload.raceData) ? payload.raceData.map((race) => compactRaceForAuth(race)) : [],
    chapterData: Array.isArray(payload.chapterData)
      ? payload.chapterData.map((chapter) => ({
          name: chapter.name,
          city: chapter.city,
          status: chapter.status,
          count: chapter.count,
          num: chapter.num,
          raceInfos: Array.isArray(chapter.raceInfos)
            ? chapter.raceInfos.map((raceInfo) => ({
                name: raceInfo.name,
                type: raceInfo.type
              }))
            : [],
          class: chapter.class,
          redeemers: Array.isArray(chapter.redeemers) ? chapter.redeemers.slice() : [],
          icon: chapter.icon,
          gachaToken: chapter.gachaToken
        }))
      : [],
    simMultipliers: payload.simMultipliers || {}
  };
}

function compactCarMetaForAuth(meta) {
  if (!meta || typeof meta !== 'object') return null;
  return {
    Tag: meta.Tag,
    tag: meta.tag,
    Id: meta.Id,
    id: meta.id,
    AssetTag: meta.AssetTag,
    AttributeTag: meta.AttributeTag,
    PrefabName: meta.PrefabName,
    carPrefabPath: meta.carPrefabPath,
    cpp: meta.cpp,
    tbp: meta.tbp,
    cty: meta.cty,
    dvu: meta.dvu,
    ncvu: meta.ncvu,
    ncvuh: meta.ncvuh,
    rvu: meta.rvu,
    Name: meta.Name,
    name: meta.name
  };
}

function compactGarageCarMetaForAuth(meta, canonicalTag) {
  const compact = compactCarMetaForAuth(meta);
  if (!compact) return null;
  return {
    ...compact,
    Tag: canonicalTag,
    tag: canonicalTag,
    Id: canonicalTag,
    id: canonicalTag,
    CarId: canonicalTag,
    carId: canonicalTag
  };
}

function compactRecipeForAuth(recipe) {
  if (!recipe || typeof recipe !== 'object') return null;
  return {
    c: recipe.c,
    pc: recipe.pc,
    n: recipe.n,
    p: Array.isArray(recipe.p) ? recipe.p.slice() : [],
    vu: Array.isArray(recipe.vu) ? recipe.vu.slice() : [],
    eu: Array.isArray(recipe.eu) ? recipe.eu.slice() : [],
    q: recipe.q,
    ut: Array.isArray(recipe.ut) ? recipe.ut.slice() : [],
    tid: recipe.tid,
    et: recipe.et,
    dc: recipe.dc,
    hash: recipe.hash
  };
}

function buildAuthCarsPayload(userId) {
  return buildCarsPayload(userId).map((car) => clone(car));
}

function estimateQuarterMile(tag) {
  if (tag === 'gtr_r34') return 12.8;
  if (tag === 'nissan_skyline_gtr_bnr34_2002') return 12.8;
  if (tag === 'mx5_na') return 15.2;
  if (tag === 'supra_mk4') return 12.2;
  if (tag === 'bmw_1m_coupe') return 12.9;
  if (tag === 'nissan_gtr_r35_2007') return 10.66;
  if (tag === 'nissan_gtr_r35_2007_bensopra_ff6') return 10.66;
  if (tag === 'ff_police_sedan_tokyo_01') return 12.9;
  if (tag === 'ford_mustang_gt_2015') return 11.6;
  if (tag === 'ford_gran_torino_1972_ff4') return 14.9;
  if (tag === 'ford_gran_torino_1972') return 14.9;
  if (tag === 'ford_torino_1972gran') return 14.9;
  return 13.5;
}

function classToNumber(tag) {
  const canonicalTag = String(tag || FF7_DEFAULT_CURRENT_CAR_ID);
  const vehicle = defaultVehicleDescriptions[canonicalTag];
  const performanceClass = vehicle && vehicle.PerformanceClass;

  switch (performanceClass) {
    case 'S':
      return 4;
    case 'A':
      return 2;
    case 'B':
      return 1;
    case 'C':
    default:
      return 0;
  }
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

function buildCarMetaPayload(tag) {
  const canonicalTag = String(tag || FF7_DEFAULT_CURRENT_CAR_ID);
  const assetTag = String(vehicleAssetAliases[canonicalTag] || canonicalTag);
  const vehicle = defaultVehicleDescriptions[canonicalTag] || defaultVehicleDescriptions[assetTag] || {};
  const recipeArrays = getDefaultRecipeArrays(assetTag);
  const metaTemplate = getVehicleMetaTemplate(assetTag);
  const defaultStatus = createOwnedVehicleStatus(assetTag);
  const manufacturer = String(assetTag.split('_')[0] || canonicalTag.split('_')[0] || 'nissan');
  const prefabName = `car_part_${assetTag}_a`;
  const prefabRoot = `Bundles/cars/base/assets/parts/unique/${manufacturer}/`;
  const recipeVuString = Array.isArray(recipeArrays.vu) && recipeArrays.vu.length > 0
    ? recipeArrays.vu.join('&')
    : '';
  const defaultVisualUpgrade = String(metaTemplate.dvu || recipeVuString || '');
  const canonicalPi = getCanonicalVehiclePi(assetTag, defaultStatus);
  const canonicalCondition = buildOwnedVehicleCondition(assetTag, defaultStatus);
  return {
    ...clone(metaTemplate),
    Tag: assetTag,
    tag: assetTag,
    Id: assetTag,
    id: assetTag,
    n: String(metaTemplate.n || `car_attribute_${assetTag}`),
    fn: String(metaTemplate.fn || vehicle.name || assetTag),
    AssetTag: assetTag,
    AttributeTag: `car_attribute_${assetTag}`,
    PrefabName: String(metaTemplate.PrefabName || prefabName),
    carPrefabPath: String(metaTemplate.carPrefabPath || `${prefabRoot}${prefabName}`),
    PartPathRoot: prefabRoot,
    carModelAttributePath: String(metaTemplate.cpp || `Bundles/cars/base/assets/attributes/stock/car_attribute_${assetTag}`),
    cpp: String(metaTemplate.cpp || `Bundles/cars/base/assets/attributes/stock/car_attribute_${assetTag}`),
    tbp: String(metaTemplate.tbp || `Bundles/UITextures/Thumbnails/${assetTag}`),
    cty: String(metaTemplate.cty || 'stock'),
    dvu: defaultVisualUpgrade,
    ncvu: '',
    ncvuh: '',
    rvu: String(metaTemplate.rvu || '[]'),
    defaultVisualUpgrade,
    DefaultRecipe: {
      p: recipeArrays.p.slice(),
      vu: recipeArrays.vu.slice(),
      eu: recipeArrays.eu.slice(),
      ut: recipeArrays.ut.slice()
    },
    Name: String(vehicle.name || assetTag),
    name: String(vehicle.name || assetTag),
    description: String(vehicle.description || ''),
    modelYear: Number(vehicle.modelYear || 0),
    PerformanceClass: String(vehicle.PerformanceClass || 'C'),
    ClassType: String(vehicle.ClassType || 'Street'),
    pi: canonicalPi,
    BasePISS: Number(vehicle.BasePISS || canonicalPi || 0),
    tcc: Number(metaTemplate.tcc || canonicalCondition.tcc || 1000),
    CanUseDriftTyres: Boolean(vehicle.CanUseDriftTyres),
    CanUseOffRoadTyres: Boolean(vehicle.CanUseOffRoadTyres)
  };
}

function getPersistedCarsBucket(userId, ownerUid = '') {
  const state = getUserState(userId) || {};
  const carsRoot =
    state &&
    state.sparx &&
    state.sparx.dataStore &&
    isPlainObject(state.sparx.dataStore.cars)
      ? state.sparx.dataStore.cars
      : {};
  const candidateOwnerIds = Array.from(new Set([
    String(ownerUid || '').trim(),
    String(state && state.profile && state.profile.uid || '').trim(),
    String(state && state.sparx && state.sparx.dataStore && state.sparx.dataStore.profile && state.sparx.dataStore.profile.uid || '').trim()
  ].filter(Boolean)));

  for (const candidateOwnerId of candidateOwnerIds) {
    const bucket = carsRoot[candidateOwnerId];
    if (isPlainObject(bucket) && Object.keys(bucket).length > 0) {
      return bucket;
    }
  }

  const firstBucket = Object.values(carsRoot).find((bucket) => (
    isPlainObject(bucket) && Object.keys(bucket).length > 0
  ));
  return isPlainObject(firstBucket) ? firstBucket : null;
}

function buildPersistedAuthCarRecord(userId, ownerUid, profile, persistedRecord, index, fallbackTag) {
  const source = isPlainObject(persistedRecord) ? clone(persistedRecord) : {};
  const rawRecipe = clone(source.r || source.recipe || source.Recipe || {});
  const rawTag = String(
    firstDefined(
      source.carId,
      source.car,
      rawRecipe.n,
      source.n,
      fallbackTag,
      FF7_DEFAULT_CURRENT_CAR_ID
    ) || ''
  ).trim();
  const canonicalTag = getSupportedOwnedVehicleTags(
    [rawTag],
    fallbackTag || FF7_DEFAULT_CURRENT_CAR_ID
  )[0];
  const assetTag = String(vehicleAssetAliases[canonicalTag] || canonicalTag);
  const useGarageShape = FF7_SKIP_TUTORIAL_TO_GARAGE;
  const recipeArrays = getDefaultRecipeArrays(assetTag);
  const persistedVisualUpgrades = Array.isArray(rawRecipe.vu) && rawRecipe.vu.length > 0
    ? rawRecipe.vu.map((value) => Number(value))
    : recipeArrays.vu.slice();
  const defaultVisualUpgrades = Array.isArray(source.dvu) && source.dvu.length > 0
    ? source.dvu.map((value) => Number(value))
    : persistedVisualUpgrades.slice();
  const visualUpgradeInventory = Array.isArray(source.inv) && source.inv.length > 0
    ? source.inv.map((value) => Number(value))
    : buildOwnedVisualUpgradeInventory(persistedVisualUpgrades);
  const quarterMile = Number(firstDefined(rawRecipe.q, source.q, estimateQuarterMile(canonicalTag)) || 0);
  const recipeHash = Number(firstDefined(rawRecipe.hash, computeRecipeHash(assetTag)) || 0);
  const status = clone(buildVehicleStatusPayload(profile, canonicalTag));
  const condition = isPlainObject(source.cond)
    ? clone(source.cond)
    : buildOwnedVehicleCondition(assetTag, status);
  const pi = Number(firstDefined(source.pi, getCanonicalVehiclePi(assetTag, status)) || 0);
  const recordId = String(
    firstDefined(
      source._id,
      source.id,
      createOwnedVehicleRecordId(ownerUid, assetTag, index)
    ) || ''
  );
  const recipe = {
    c: Number(firstDefined(rawRecipe.c, classToNumber(canonicalTag)) || 0),
    pc: String(firstDefined(rawRecipe.pc, useGarageShape ? canonicalTag : assetTag) || ''),
    n: String(firstDefined(rawRecipe.n, useGarageShape ? canonicalTag : assetTag) || ''),
    p: Array.isArray(rawRecipe.p) ? rawRecipe.p.slice() : recipeArrays.p.slice(),
    vu: persistedVisualUpgrades.slice(),
    eu: Array.isArray(rawRecipe.eu) ? rawRecipe.eu.slice() : recipeArrays.eu.slice(),
    q: quarterMile,
    ut: Array.isArray(rawRecipe.ut) ? rawRecipe.ut.slice() : recipeArrays.ut.slice(),
    tid: Number(firstDefined(rawRecipe.tid, 0) || 0),
    et: Boolean(firstDefined(rawRecipe.et, false)),
    dc: Number(firstDefined(rawRecipe.dc, -1)),
    hash: recipeHash
  };
  const meta = buildCarMetaPayload(canonicalTag);
  return {
    ...source,
    uid: String(ownerUid),
    userId: String(ownerUid),
    id: recordId,
    _id: recordId,
    carId: useGarageShape ? canonicalTag : assetTag,
    car: useGarageShape ? canonicalTag : assetTag,
    n: String(firstDefined(source.n, recipe.n, assetTag) || ''),
    pi,
    cond: clone(condition),
    dvu: defaultVisualUpgrades.slice(),
    inv: clone(visualUpgradeInventory),
    ud: Boolean(firstDefined(source.ud, false)),
    r: clone(recipe),
    recipe: clone(recipe),
    Recipe: clone(recipe),
    q: Number(firstDefined(source.q, recipe.q) || 0),
    e: Number(firstDefined(source.e, 0) || 0),
    pu: clone(source.pu || buildRacePerformanceUpgradePayload(status)),
    up: clone(source.up || buildRaceUpgradePartsPayload(status)),
    vehicleStatus: clone(status),
    VehicleStatus: clone(status),
    Tag: useGarageShape ? canonicalTag : meta.Tag,
    tag: useGarageShape ? canonicalTag : meta.tag,
    carTag: canonicalTag,
    AssetTag: meta.AssetTag,
    assetTag: meta.AssetTag,
    Name: meta.Name,
    name: meta.name,
    AttributeTag: meta.AttributeTag,
    PrefabName: meta.PrefabName,
    CarMetaData: { ...meta },
    MetaData: { ...meta },
    metadata: { ...meta }
  };
}

function buildCarsPayload(userId) {
  const profile = getAuthoritativeProfile(userId);
  const ownerUid = String(profile.uid || profile.id || profile.userId || userId || '1001');
  const freshTutorialIntro = isFreshTutorialIntroProfile(profile);
  const requestedCurrentTag = FF7_SKIP_TUTORIAL_TO_GARAGE
    ? FF7_DEFAULT_CURRENT_CAR_ID
    : String(profile.CurrentVehicleTag || profile.currentVehicleTag || FF7_DEFAULT_CURRENT_CAR_ID);
  const desiredOwnedVehicles = FF7_SKIP_TUTORIAL_TO_GARAGE
    ? getDefaultOwnedVehicleTags()
    : (
      freshTutorialIntro
        ? []
        : Array.isArray(profile.OwnedVehicles) && profile.OwnedVehicles.length > 0
        ? profile.OwnedVehicles.slice()
        : [requestedCurrentTag]
    );
  const ownedVehicles = getSupportedOwnedVehicleTags(desiredOwnedVehicles, requestedCurrentTag);
  const currentTag = getSupportedOwnedVehicleTags([requestedCurrentTag], ownedVehicles[0] || FF7_DEFAULT_CURRENT_CAR_ID)[0];

  if (!freshTutorialIntro && ownedVehicles.indexOf(currentTag) === -1) {
    ownedVehicles.unshift(currentTag);
  }

  const persistedBucket = getPersistedCarsBucket(userId, ownerUid);
  const persistedRecordsByTag = new Map();
  if (isPlainObject(persistedBucket)) {
    Object.values(persistedBucket).forEach((record) => {
      if (!isPlainObject(record)) return;
      const rawTag = String(
        firstDefined(
          record.carId,
          record.car,
          record.r && record.r.n,
          record.recipe && record.recipe.n,
          record.n,
          ''
        ) || ''
      ).trim();
      if (!rawTag) return;
      const canonicalTag = getSupportedOwnedVehicleTags(
        [rawTag],
        currentTag || FF7_DEFAULT_CURRENT_CAR_ID
      )[0];
      if (canonicalTag && !persistedRecordsByTag.has(canonicalTag)) {
        persistedRecordsByTag.set(canonicalTag, clone(record));
      }
    });
  }

  persistedRecordsByTag.forEach((_, tag) => {
    if (ownedVehicles.indexOf(tag) === -1) {
      ownedVehicles.push(tag);
    }
  });

  return ownedVehicles.map((tag, index) => {
    const persistedRecord = persistedRecordsByTag.get(String(tag || ''));
    if (persistedRecord) {
      return buildPersistedAuthCarRecord(userId, ownerUid, profile, persistedRecord, index, currentTag);
    }
    const canonicalTag = String(tag || FF7_DEFAULT_CURRENT_CAR_ID);
    const assetTag = vehicleAssetAliases[tag] || tag;
    const useGarageShape = FF7_SKIP_TUTORIAL_TO_GARAGE;
    const recordId = createOwnedVehicleRecordId(ownerUid, assetTag, index);
    const recipeArrays = getDefaultRecipeArrays(assetTag);
    const quarterMile = estimateQuarterMile(tag);
    const recipeHash = computeRecipeHash(assetTag);
    const status = buildVehicleStatusPayload(profile, canonicalTag);
    const pi = getCanonicalVehiclePi(assetTag, status);
    const condition = buildOwnedVehicleCondition(assetTag, status);
    const recipe = {
      c: classToNumber(tag),
      pc: useGarageShape ? canonicalTag : assetTag,
      n: useGarageShape ? canonicalTag : assetTag,
      p: recipeArrays.p,
      vu: recipeArrays.vu,
      eu: recipeArrays.eu,
      q: quarterMile,
      ut: recipeArrays.ut,
      tid: 0,
      et: false,
      dc: -1,
      hash: recipeHash
    };
    const meta = buildCarMetaPayload(tag);
    const topLevelName = String(recipe.n || assetTag);
    const defaultVisualUpgrades = recipeArrays.vu.slice();
    return ({
      uid: ownerUid,
      userId: ownerUid,
      id: recordId,
      carId: useGarageShape ? canonicalTag : assetTag,
      _id: recordId,
      n: topLevelName,
      pi,
      cond: clone(condition),
      dvu: defaultVisualUpgrades.slice(),
      inv: buildOwnedVisualUpgradeInventory(defaultVisualUpgrades),
      ud: false,
      r: recipe,
      recipe: {
        ...recipe,
        p: recipe.p.slice(),
        vu: recipe.vu.slice(),
        eu: recipe.eu.slice(),
        ut: recipe.ut.slice()
      },
      Recipe: {
        ...recipe,
        p: recipe.p.slice(),
        vu: recipe.vu.slice(),
        eu: recipe.eu.slice(),
        ut: recipe.ut.slice()
      },
      q: quarterMile,
      e: 0,
      pu: buildRacePerformanceUpgradePayload(status),
      up: buildRaceUpgradePartsPayload(status),
      vehicleStatus: clone(status),
      VehicleStatus: clone(status),
      Tag: useGarageShape ? canonicalTag : meta.Tag,
      tag: useGarageShape ? canonicalTag : meta.tag,
      carTag: canonicalTag,
      Name: meta.Name,
      name: meta.name,
      AttributeTag: meta.AttributeTag,
      PrefabName: meta.PrefabName,
      CarMetaData: { ...meta },
      MetaData: { ...meta },
      metadata: { ...meta }
    });
  });
}

function isLegacySver2Client(params) {
  return Number(firstDefined(params && params.sver, 0)) === 2 || String(firstDefined(params && params.version, '')) === '72114';
}

function mirrorLegacy030Payload(params, payload, extras = {}) {
  if (!isLegacySver2Client(params || {})) {
    return payload;
  }

  const mirrored = Object.assign({}, payload);

  if (extras.arrayList !== undefined) {
    mirrored.arrayList = clone(extras.arrayList);
  }

  if (extras.hashtable !== undefined) {
    mirrored.hashtable = clone(extras.hashtable);
  }

  return mirrored;
}

function buildAuthInitPayload(params) {
  const auth = buildUserResource(normalizeIdentity(params || {}), params || {}, 'guest');
  const deviceAuth = buildDeviceAuthPayload(auth.naid, params || {});
  const stateUserId = getStateUserIdFromAuth(auth);
  const { user } = ensureAuthState(stateUserId, params || {});
  const baseUrl = getBaseUrl(params || {});
  const wskeClientId = 'ff7';
  const wskeMobileKey = 'ff7_local_mobile_key';
  const disableWske = isLegacySver2Client(params || {});
  const progression = buildProgressionPayload(stateUserId);
  const nextRaces = buildAuthNextRacesPayload(stateUserId);
  const cars = buildAuthCarsPayload(stateUserId);
  const gachaCarInfo = buildGachaCarInfoPayload();
  const carTuningData = buildCarTuningDataPayload();
  const parts = buildCarPartsPayload();
  const vuTuning = buildLoginVisualUpgradeTuningPayload();
  const gamestore = buildLoginGamestorePayload(stateUserId);
  const mechanicsData = buildMechanicsDataPayload(stateUserId);
  const carUpgrades = buildCarUpgradesLoginPayload(stateUserId);
  const alliance = buildAlliancePayload(stateUserId);
  const chat = buildChatTokenPayload(stateUserId);
  const authoritativeVehicleState = buildAuthoritativeVehicleState(stateUserId);
  const hasName = Boolean(String(auth.name || '').trim());
  const nestedDeviceConfig = {};
  const nestedFacebookConfig = { scope: [] };
  const nestedGoogleConfig = { enabled: false, client_id: '' };
  const nestedWskeConfig = {
    clientId: wskeClientId,
    mobileKey: wskeMobileKey,
    wskeUrl: baseUrl,
    enabled: true
  };
  const nestedGameCenterConfig = {};
  const nestedAuthFlags = {
    device: true,
    facebook: false,
    google: false,
    wske: !disableWske,
    gamecenter: false
  };
  const resultUser = Object.assign({}, auth.user, authoritativeVehicleState);
  const sharedConfig = {
    success: true,
    successful: true,
    sucessful: true,
    uid: auth.uid,
    naid: auth.naid,
    player_id: auth.naid,
    playerId: auth.naid,
    stoken: auth.stoken,
    token: auth.stoken,
    session: auth.stoken,
    guest: true,
    is_guest: true,
    loggedIn: false,
    locale: String(params.locale || ''),
    lang: String(params.lang || ''),
    platform: String(params.platform || ''),
    version: String(params.version || ''),
    name: auth.name,
    Name: auth.name,
    shortName: auth.name,
    ShortName: auth.name,
    hasName,
    HasName: hasName,
    prefill_name: auth.name,
    change_name: true,
    name_min_len: 3,
    name_max_len: 16,
    guestlogin: true,
    facebooklogin: true,
    fastlogin: false,
    crittercism: '',
    newrelic: '',
    adx: null,
    mat: null,
    chartboost: null,
    client_id: wskeClientId,
    clientId: wskeClientId,
    mobileKey: wskeMobileKey,
    enabled: true,
    wskeUrl: baseUrl,
    device: nestedDeviceConfig,
    facebook: nestedFacebookConfig,
    google: nestedGoogleConfig,
    wske: nestedWskeConfig,
    gamecenter: nestedGameCenterConfig,
    auth: nestedAuthFlags,
    auth_data: deviceAuth,
    server_tag: '',
    install: !String(auth.name || '').trim(),
    salt: String(user.auth.salt || ''),
    country: 'TR',
    nextRaces,
    progression,
    cars,
    gachaCarInfo,
    carTuningData,
    parts,
    vuTuning,
    gamestore,
    mechanicsData,
    carUpgrades,
    alliance,
    chat,
    friends: clone(chat.friends || []),
    chat_ban: clone(chat.chat_ban || {}),
    max_friends: Number(chat.max_friends || 50),
    user: resultUser,
    localUser: resultUser,
    'auth.device': true,
    'auth.facebook': false,
    'auth.google': false,
    'auth.wske': !disableWske,
    'auth.gamecenter': false
  };

  return Object.assign({
    ts: auth.ts,
    stoken: auth.stoken
  }, sharedConfig, {
    result: Object.assign({}, sharedConfig)
  });
}

function buildAuthPreloginPayload(params) {
  const auth = buildUserResource(normalizeIdentity(params || {}), params || {}, 'guest');
  const { user } = ensureAuthState(getStateUserIdFromAuth(auth), params || {});
  const salt = String(user.auth.salt || makeToken('salt'));
  user.auth.salt = salt;
  persistState();
  return {
    ts: auth.ts,
    err: null,
    error: null,
    success: true,
    successful: true,
    sucessful: true,
    salt,
    sha1: String(params.sha1 || ''),
    result: {
      salt,
      sha1: String(params.sha1 || ''),
      assign_unique: false,
      seperator_token: '',
      usernames: {
        assign_unique: false,
        seperator_token: ''
      }
    }
  };
}

function buildAuthEnumeratePayload(params) {
  const auth = buildUserResource(normalizeIdentity(params || {}), params || {}, 'guest');
  const accounts = buildEnumerateAccounts(params || {});
  return mirrorLegacy030Payload(params || {}, {
    ts: auth.ts,
    err: null,
    error: null,
    success: true,
    successful: true,
    sucessful: true,
    result: accounts
  }, {
    arrayList: accounts
  });
}

function buildAuthLoginPayload(params) {
  const credentials = params.credentials && typeof params.credentials === 'object' ? params.credentials : {};
  const authenticatorName = String(firstDefined(params.authenticator, params.name, nested(params, 'authenticator.name', ''))).toLowerCase();
  const wskeToken = String(firstDefined(
    credentials.token,
    credentials.authToken,
    nested(params, 'auth.wske.token', ''),
    nested(params, 'auth.wske.authToken', ''),
    'local_kabam_auth_token'
  ));
  const wskeUrl = String(firstDefined(
    credentials.url,
    credentials.wskeUrl,
    nested(params, 'auth.wske.url', ''),
    getBaseUrl(params || {})
  ));
  const useWske = authenticatorName === 'wske' || Boolean(credentials.token || credentials.authToken || nested(params, 'auth.wske.token', ''));
  const authMode = useWske ? 'linked' : 'guest';
  let loginUserId = normalizeIdentity(params || {});
  if (loginUserId === 'default') {
    const credentialDeviceId = String(firstDefined(
      credentials.device_id,
      credentials.deviceId,
      credentials.udid,
      ''
    ) || '').trim();
    const exactMatch = credentialDeviceId
      ? Object.entries(store.state.users || {}).find(([candidateId, candidateUser]) => {
          if (!candidateId || candidateId === 'default') return false;
          const authState = candidateUser && candidateUser.auth && typeof candidateUser.auth === 'object'
            ? candidateUser.auth
            : {};
          const naid = String(authState.naid || '').trim();
          if (!naid || naid === 'default') return false;
          const deviceAuth = authState.deviceAuth && typeof authState.deviceAuth === 'object'
            ? authState.deviceAuth
            : {};
          const deviceData = deviceAuth.data && typeof deviceAuth.data === 'object'
            ? deviceAuth.data
            : {};
          return [
            authState.naid,
            deviceAuth.id,
            deviceData.udid
          ].some((value) => String(value || '').trim() === credentialDeviceId);
        })
      : null;
    if (exactMatch) {
      loginUserId = String(exactMatch[0]);
    } else {
      const preferredUsers = Object.entries(store.state.users || {}).filter(([candidateId, candidateUser]) => {
        if (!candidateId || candidateId === 'default' || candidateId === 'u') return false;
        const authState = candidateUser && candidateUser.auth && typeof candidateUser.auth === 'object'
          ? candidateUser.auth
          : {};
        const naid = String(authState.naid || '').trim();
        return Boolean(naid) && naid !== 'default' && naid === candidateId;
      });
      if (preferredUsers.length === 1) {
        loginUserId = String(preferredUsers[0][0]);
      }
    }
  }
  const auth = buildUserResource(loginUserId, params || {}, authMode);
  const stateUserId = getStateUserIdFromAuth(auth);
  const profile = getProfile(stateUserId);
  const legacyLevelRewards = buildLegacyLevelRewardsStateFromProfile(profile);
  const legacyResources = buildLegacyResourcesStateFromProfile(profile);
  const legacyStyleBonusLevels = buildLegacyStyleBonusLevels();
  const deviceAuth = buildDeviceAuthPayload(auth.naid, credentials || params || {});
  const authData = useWske
    ? {
        id: wskeToken,
        data: {
          token: wskeToken,
          authToken: wskeToken,
          url: wskeUrl,
          wskeUrl,
          clientId: 'ff7',
          playerId: auth.naid,
          player_id: auth.naid
        }
      }
    : deviceAuth;
  const playerCertificate = makeToken('pcert');
  const resultUser = Object.assign({}, auth.user, {
    guest: auth.guest,
    loggedIn: auth.loggedIn
  });
  const progression = buildProgressionPayload(stateUserId);
  const nextRaces = buildAuthNextRacesPayload(stateUserId);
  const cars = buildAuthCarsPayload(stateUserId);
  const gachaCarInfo = buildGachaCarInfoPayload();
  const carTuningData = buildCarTuningDataPayload();
  const parts = buildCarPartsPayload();
  const vuTuning = buildLoginVisualUpgradeTuningPayload();
  const gamestore = buildLoginGamestorePayload(stateUserId);
  const mechanicsData = buildMechanicsDataPayload(stateUserId);
  const carUpgrades = buildCarUpgradesLoginPayload(stateUserId);
  const alliance = buildAlliancePayload(stateUserId);
  const chat = buildChatTokenPayload(stateUserId);
  const authoritativeVehicleState = buildAuthoritativeVehicleState(stateUserId);
  const hasName = Boolean(String(auth.name || '').trim());
  const sharedConfig = {
    success: true,
    successful: true,
    sucessful: true,
    uid: auth.uid,
    naid: auth.naid,
    player_id: auth.naid,
    playerId: auth.naid,
    stoken: auth.stoken,
    token: auth.stoken,
    session: auth.stoken,
    guest: auth.guest,
    is_guest: auth.guest,
    loggedIn: auth.loggedIn,
    locale: String(params.locale || ''),
    lang: String(params.lang || ''),
    platform: String(params.platform || ''),
    version: String(params.version || ''),
    name: auth.name,
    Name: auth.name,
    shortName: auth.name,
    ShortName: auth.name,
    hasName,
    HasName: hasName,
    prefill_name: auth.name,
    change_name: !hasName,
    name_min_len: 3,
    name_max_len: 16,
    auth_data: authData,
    playerCertificate,
    wske: {
      authToken: wskeToken,
      token: wskeToken,
      url: wskeUrl,
      wskeUrl,
      clientId: 'ff7',
      mobileKey: 'ff7_local_mobile_key',
      playerId: auth.naid,
      playerCertificate
    },
    usernames: {
      assign_unique: false,
      seperator_token: ''
    },
    nextRaces,
    progression,
    cars,
    gachaCarInfo,
    carTuningData,
    parts,
    vuTuning,
    gamestore,
    mechanicsData,
    carUpgrades,
    alliance,
    chat,
    friends: clone(chat.friends || []),
    chat_ban: clone(chat.chat_ban || {}),
    max_friends: Number(chat.max_friends || 50),
    levelrewards: legacyLevelRewards,
    levelrewards_levels: legacyStyleBonusLevels,
    levelrewards_milestones: [],
    res: legacyResources,
    server_tag: '',
    install: !String(auth.name || '').trim(),
    user: resultUser,
    localUser: resultUser
  };

  const payload = Object.assign({
    ts: auth.ts,
    err: null,
    error: null
  }, sharedConfig, {
    result: Object.assign({}, sharedConfig)
  });
  return mirrorLegacy030Payload(params || {}, payload, {
    hashtable: sharedConfig
  });
}

function buildKabamPayload(params, authMode) {
  const auth = buildUserResource(normalizeIdentity(params || {}), params || {}, authMode);
  const baseUrl = getBaseUrl(params || {});
  const wskeClientId = 'ff7';
  const wskeMobileKey = 'ff7_local_mobile_key';
  const resultUser = Object.assign({}, auth.user, authoritativeVehicleState, {
    guest: auth.guest,
    loggedIn: auth.loggedIn
  });
  const nestedAuthFlags = {
    device: true,
    facebook: false,
    google: false,
    wske: true
  };

  return {
    ts: auth.ts,
    stoken: auth.stoken,
    err: null,
    error: null,
    success: true,
    successful: true,
    sucessful: true,
    result: {
      success: true,
      successful: true,
      sucessful: true,
      uid: auth.uid,
      naid: auth.naid,
      player_id: auth.naid,
      playerId: auth.naid,
      stoken: auth.stoken,
      token: auth.stoken,
      session: auth.stoken,
      guest: auth.guest,
      is_guest: auth.guest,
      loggedIn: auth.loggedIn,
      locale: String(params.locale || ''),
      lang: String(params.lang || ''),
      platform: String(params.platform || ''),
      version: String(params.version || ''),
      name: auth.name,
      prefill_name: auth.name,
      change_name: true,
      name_min_len: 3,
      name_max_len: 16,
      guestlogin: true,
      facebooklogin: true,
      fastlogin: false,
      crittercism: '',
      newrelic: '',
      adx: null,
      mat: {},
      chartboost: {},
      client_id: wskeClientId,
      clientId: wskeClientId,
      mobileKey: wskeMobileKey,
      enabled: true,
      wskeUrl: baseUrl,
      wske: {
        clientId: wskeClientId,
        mobileKey: wskeMobileKey,
        wskeUrl: baseUrl,
        enabled: true
      },
      auth_data: {},
      server_tag: '',
      install: !String(auth.name || '').trim(),
      auth: nestedAuthFlags,
      user: resultUser,
      localUser: resultUser,
      'auth.device': true,
      'auth.facebook': false,
      'auth.google': false,
      'auth.wske': true
    }
  };
}

function buildSupportPayload() {
  return { url: '' };
}

function buildSuccessEnvelope(result, ts) {
  return {
    ts: ts || nowTs(),
    err: null,
    error: null,
    success: true,
    successful: true,
    sucessful: true,
    result
  };
}

function buildAccountListPayload(params) {
  const auth = buildUserResource(normalizeIdentity(params || {}), params || {}, 'linked');
  const accounts = buildEnumerateAccounts(params || {});
  return mirrorLegacy030Payload(params || {}, buildSuccessEnvelope(accounts, auth.ts), {
    arrayList: accounts
  });
}

function buildAccountDataPayload(params) {
  const authMode = resolveRequestedAuthMode(params || {}, 'guest');
  const auth = buildUserResource(normalizeIdentity(params || {}), params || {}, authMode);
  const accounts = buildEnumerateAccounts(params || {});
  const primary = accounts[0] || { user: auth.user, auth: {} };
  const stateUserId = getStateUserIdFromAuth(auth);
  const profile = getAuthoritativeProfile(stateUserId) || getProfile(stateUserId);
  const authoritativeVehicleState = buildAuthoritativeVehicleState(stateUserId);
  const normalizedLevel = Number(profile.level || profile.Level || profile.PlayerLevel || profile.Rank || 1);
  const normalizedXp = Number(profile.xp || profile.XP || 0);
  const normalizedUid = String(firstDefined(nested(primary, 'user.uid', ''), profile.uid, auth.uid, auth.user.uid, ''));
  const normalizedId = String(firstDefined(nested(primary, 'user.id', ''), profile.id, auth.uid, auth.user.id, ''));
  const normalizedUserId = String(firstDefined(nested(primary, 'user.userId', ''), profile.userId, auth.uid, auth.user.userId, ''));
  const preferredName = sanitizeOptionalUserName(
    firstDefined(nested(primary, 'user.name', ''), profile.name, auth.name, auth.user.name, '')
  );
  const normalizedName = preferredName && !isAutoGeneratedProfileName(preferredName)
    ? preferredName
    : '';
  if (!normalizedName && preferredName) {
    profile.name = '';
    profile.Nickname = '';
  }
  const normalizedRespectPoints = Number(profile.respectPoints || profile.rp || 0);
  const normalizedCoins = Number(profile.NoCoins || profile.coins || 0);
  const normalizedStars = Number(profile.NoStars || profile.gold || 0);
  const normalizedFuel = Number(profile.Fuel || profile.fuel || 0);
  const normalizedMaxFuel = Number(profile.MaxFuel || profile.maxFuel || 10);
  const normalizedNextLevelXp = Number(profile.nextLevelXP || profile.NextLevelXP || 1000);
  const normalizedLevelRewards = Array.isArray(profile.levelRewards) ? clone(profile.levelRewards) : [];
  const normalizedNextLevelRewards = Array.isArray(profile.nextLevelRewards) ? clone(profile.nextLevelRewards) : [];
  const normalizedPrevLevelRewards = Array.isArray(profile.prevLevelRewards) ? clone(profile.prevLevelRewards) : [];
  const legacyLevelRewards = buildLegacyLevelRewardsStateFromProfile(profile);
  const legacyResources = buildLegacyResourcesStateFromProfile(profile);
  const legacyStyleBonusLevels = buildLegacyStyleBonusLevels();
  const normalizedUser = Object.assign({}, auth.user, primary.user || {}, {
    uid: normalizedUid,
    id: normalizedId,
    userId: normalizedUserId,
    naid: String(firstDefined(nested(primary, 'user.naid', ''), auth.naid, auth.user.naid, '')),
    playerId: String(firstDefined(nested(primary, 'user.playerId', ''), auth.naid, auth.user.playerId, '')),
    player_id: String(firstDefined(nested(primary, 'user.player_id', ''), auth.naid, auth.user.player_id, '')),
    name: normalizedName,
    email: String(firstDefined(nested(primary, 'user.email', ''), profile.email, auth.email, auth.user.email, '')),
    level: normalizedLevel,
    Level: normalizedLevel,
    PlayerLevel: normalizedLevel,
    Rank: normalizedLevel,
    xp: normalizedXp,
    XP: normalizedXp,
    currentXP: normalizedXp,
    nextLevelXP: normalizedNextLevelXp,
    rp: normalizedRespectPoints,
    respectPoints: normalizedRespectPoints,
    levelRewards: normalizedLevelRewards,
    nextLevelRewards: normalizedNextLevelRewards,
    prevLevelRewards: normalizedPrevLevelRewards,
    levelrewards: legacyLevelRewards,
    res: legacyResources,
    NoCoins: normalizedCoins,
    coins: normalizedCoins,
    NoStars: normalizedStars,
    stars: normalizedStars,
    Fuel: normalizedFuel,
    fuel: normalizedFuel,
    MaxFuel: normalizedMaxFuel,
    maxFuel: normalizedMaxFuel,
    guest: auth.guest,
    is_guest: auth.guest,
    loggedIn: auth.loggedIn,
    Name: normalizedName,
    shortName: normalizedName,
    ShortName: normalizedName,
    hasName: Boolean(normalizedName),
    HasName: Boolean(normalizedName)
  }, authoritativeVehicleState, {
    active_recipe: Number(firstDefined(authoritativeVehicleState.active_recipe, profile.active_recipe, 0) || 0)
  });
  const progression = buildProgressionPayload(stateUserId);
  const nextRaces = buildAuthNextRacesPayload(stateUserId);
  const cars = buildAuthCarsPayload(stateUserId);
  const gachaCarInfo = buildGachaCarInfoPayload();
  const chat = buildChatTokenPayload(stateUserId);
  const carTuningData = buildCarTuningDataPayload();
  const parts = buildCarPartsPayload();
  const vuTuning = buildVisualUpgradeTuningPayload();
  const gamestore = buildLoginGamestorePayload(stateUserId);
  const mechanicsData = buildMechanicsDataPayload(stateUserId);
  const carUpgrades = buildCarUpgradesLoginPayload(stateUserId);
  const alliance = buildAlliancePayload(stateUserId);
  const result = {
    user: normalizedUser,
    localUser: normalizedUser,
    profile: normalizedUser,
    auth: primary.auth,
    linkedAccounts: accounts,
    guest: auth.guest,
    is_guest: auth.guest,
    loggedIn: auth.loggedIn,
    name: normalizedName,
    Name: normalizedName,
    shortName: normalizedName,
    ShortName: normalizedName,
    hasName: Boolean(normalizedName),
    HasName: Boolean(normalizedName),
    prefill_name: normalizedName,
    change_name: !Boolean(normalizedName),
    nextRaces,
    progression,
    cars,
    gachaCarInfo,
    carTuningData,
    parts,
    vuTuning,
    gamestore,
    mechanicsData,
    carUpgrades,
    alliance,
    chat,
    friends: clone(chat.friends || []),
    chat_ban: clone(chat.chat_ban || {}),
    max_friends: Number(chat.max_friends || 50),
    levelrewards: clone(legacyLevelRewards),
    levelrewards_levels: clone(legacyStyleBonusLevels),
    levelrewards_milestones: [],
    res: clone(legacyResources),
    apiversions: {},
    nid: '',
    ncat: '',
    ncta: ''
  };
  logFf7Debug('account/data', {
    retry: params.retry || 0,
    userId: stateUserId,
    profile: compactProfile(getProfile(stateUserId)),
    nextRace: compactRace(nextRaces.raceData && nextRaces.raceData[0]),
    carCount: Array.isArray(cars) ? cars.length : 0,
    activeCarId: progression && progression.active_carid
      ? progression.active_carid
      : String(firstDefined(
        result && result.profile && (result.profile.active_carid || result.profile.activeCarId),
        ''
      ) || ''),
    progression: {
      crid: progression.crid,
      jfrid: progression.jfrid,
      cmid: progression.cmid,
      tut_id: progression.tut_id
    }
  });
  const payload = Object.assign(buildSuccessEnvelope(result, auth.ts), {
    nextRaces,
    progression,
    cars,
    gachaCarInfo,
    carTuningData,
    parts,
    vuTuning,
    gamestore,
    mechanicsData,
    carUpgrades,
    alliance
  });
  return mirrorLegacy030Payload(params || {}, payload, {
    hashtable: result
  });
}

function buildCheckNamePayload(params) {
  const requestedName = sanitizeUserName(firstDefined(params.name, params.username), 'Player');
  return buildSuccessEnvelope({
    name: requestedName,
    valid: true,
    available: true,
    exists: false
  });
}

function buildSetNamePayload(params) {
  const userId = normalizeIdentity(params || {});
  const { user, profile } = ensureAuthState(userId, params || {});
  const rawRequestedName = sanitizeOptionalUserName(firstDefined(params.name, params.username));
  const requestedName = isBootstrapAutoName(rawRequestedName) ? '' : rawRequestedName;
  const rawFallbackName = sanitizeOptionalUserName(firstDefined(profile.name, profile.Nickname));
  const fallbackName = isBootstrapAutoName(rawFallbackName) ? '' : rawFallbackName;
  const hasManualRename = Number(nested(user, 'auth.lastRenameAt', 0)) > 0;
  const keepNameBlank = !requestedName && (!fallbackName || isAutoGeneratedProfileName(fallbackName) || !hasManualRename);
  const nextName = keepNameBlank ? '' : (requestedName || fallbackName);
  const storedName = keepNameBlank ? '' : (nextName || `Player ${String(profile.uid || user.auth.uid || userId).slice(0, 8)}`);
  const isBootstrapName = isBootstrapAutoName(requestedName || storedName);

  profile.name = storedName;
  profile.Nickname = storedName;
  if (requestedName && !isBootstrapName) {
    user.auth.lastRenameAt = nowTs();
  }
  persistState();
  const responseParams = keepNameBlank
    ? Object.assign({}, params || {}, {
        name: '',
        username: '',
        user_name: '',
        playerName: '',
        prefill_name: ''
      })
    : (params || {});
  const hasStoredName = Boolean(storedName);
  const responseUser = Object.assign(
    {},
    buildUserResource(userId, responseParams, 'guest').user,
    {
      guest: true,
      is_guest: true,
      loggedIn: false,
      name: storedName,
      Name: storedName,
      shortName: storedName,
      ShortName: storedName,
      hasName: hasStoredName,
      HasName: hasStoredName
    }
  );
  return buildSuccessEnvelope({
    success: true,
    name: storedName,
    prefill_name: storedName,
    change_name: !hasStoredName,
    guest: true,
    is_guest: true,
    loggedIn: false,
    user: responseUser,
    localUser: responseUser,
    profile: responseUser
  });
}

function buildUnlinkPayload(params) {
  return buildSuccessEnvelope({
    success: true,
    authenticator: String(firstDefined(params.authenticator, '')),
    aid: String(firstDefined(params.aid, ''))
  });
}

function buildExistsPayload(params) {
  const email = normalizeEmail(params.email);
  return {
    exists: Boolean(email),
    email,
    fbId: String(params.fbId || '')
  };
}

function isLegacyAuthPath(pathname) {
  return LEGACY_AUTH_PREFIXES.includes(pathname);
}

function handleLegacyAuthRequest(pathname, params) {
  if (pathname === '/auth/init') {
    return { statusCode: 200, payload: buildAuthInitPayload(params || {}) };
  }

  if (pathname === '/auth/prelogin' || pathname === '/prelogin') {
    return { statusCode: 200, payload: buildAuthPreloginPayload(params || {}) };
  }

  if (pathname === '/auth/enumerate') {
    return { statusCode: 200, payload: buildAuthEnumeratePayload(params || {}) };
  }

  if (pathname === '/auth/login' || pathname === '/login') {
    return { statusCode: 200, payload: buildAuthLoginPayload(params || {}) };
  }

  if (pathname === '/account') {
    return { statusCode: 200, payload: buildAccountListPayload(params || {}) };
  }

  if (pathname === '/account/link') {
    return { statusCode: 200, payload: buildAuthLoginPayload(params || {}) };
  }

  if (pathname === '/account/unlink') {
    return { statusCode: 200, payload: buildUnlinkPayload(params || {}) };
  }

  if (pathname === '/account/data') {
    return { statusCode: 200, payload: buildAccountDataPayload(params || {}) };
  }

  if (pathname === '/account/check-name') {
    return { statusCode: 200, payload: buildCheckNamePayload(params || {}) };
  }

  if (pathname === '/account/name') {
    return { statusCode: 200, payload: buildSetNamePayload(params || {}) };
  }

  if (pathname === '/account/support') {
    return {
      statusCode: 200,
      payload: buildSuccessEnvelope(buildSupportPayload())
    };
  }

  if (pathname === '/kabam/register' || pathname === '/kabam/guest') {
    return { statusCode: 200, payload: buildKabamPayload(params || {}, 'guest') };
  }

  if (pathname === '/kabam/login' || pathname === '/kabam/upgrade' || pathname === '/kabam/facebook' || pathname === '/kabam/name') {
    return { statusCode: 200, payload: buildKabamPayload(params || {}, 'linked') };
  }

  if (pathname === '/kabam/support') {
    return {
      statusCode: 200,
      payload: {
        ts: nowTs(),
        result: buildSupportPayload()
      }
    };
  }

  if (pathname === '/kabam/exists') {
    return {
      statusCode: 200,
      payload: {
        ts: nowTs(),
        result: buildExistsPayload(params || {})
      }
    };
  }

  return null;
}

module.exports = {
  buildAuthInitPayload,
  isLegacyAuthPath,
  handleLegacyAuthRequest
};
