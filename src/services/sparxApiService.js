const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const config = require('../config');
const { persistState } = require('../store');
const { loadJson, saveJson } = require('../store/jsonStore');
const { compactCar, compactProfile, compactRace, compactRecipe, logFf7Debug } = require('../lib/ff7Debug');
const extractedTutorialDb = require('../data/ff7_210_tutorial_db.json');
const userService = require('./userService');
const {
  clone,
  defaultCareerData,
  defaultChallengeArticles,
  defaultPurchasables,
  defaultRandomChallengeArticles,
  defaultPerformanceLadders,
  defaultRankingsTimeline,
  defaultTuningBundleLadders,
  defaultVehicleDescriptions,
  defaultVehiclePurchasablesByVehicle,
  vehicleMetaTemplates,
  vehicleAssetAliases,
  getDefaultRecipeArrays,
  getVehicleMetaTemplate,
  ff7TutorialConfig,
  createOwnedVehicleStatus,
  createStockOwnedVehicleStatus,
  buildOwnedVehicleCondition,
  getCanonicalVehiclePi,
  getSupportedOwnedVehicleTags,
  createOwnedVehicleRecordId,
  pickDeterministicVariant,
  ff7FNV32,
  getStoryArticleRaceId
} = require('./seedData');

const SPARX_PREFIXES = [
  '/alliances',
  '/account',
  '/autorefresh',
  '/chat',
  '/ds',
  '/events',
  '/gacha',
  '/gamestore',
  '/gamestats',
  '/inbox',
  '/inventory',
  '/levelrewards',
  '/loginrewards',
  '/matches',
  '/messages',
  '/motd',
  '/objectives',
  '/offers',
  '/paymentpackages',
  '/payments',
  '/performance',
  '/performance_upgrades',
  '/prizes',
  '/racedb',
  '/rankedraces',
  '/redeemer',
  '/refresh',
  '/resources',
  '/store',
  '/tuning',
  '/tutorial',
  '/userprofile',
  '/wallet',
  '/push',
  '/wske',
  '/webview'
];

const FF7_TUTORIAL_ID = 'FTE';
const FF7_TUTORIAL_GROUP_ID = 'G1';
const FF7_TUTORIAL_RACE_ID = Object.keys(ff7TutorialConfig.races || {})[0] || 'chapter_00_a';
const FF7_TUTORIAL_CHAPTER_ID = String(((ff7TutorialConfig.races || {})[FF7_TUTORIAL_RACE_ID] || {}).chapterId || 'chapter_00');
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

const CHAT_ROOM_SPLIT_TOKEN = '--';
const CHAT_ROOM_POSTFIX = '--main';
const CHAT_MAX_FRIENDS = 50;
const DEFAULT_CREW_DB = Object.freeze({
  alliances: {},
  memberships: {}
});
const EXTERNAL_CARDB_PATH = '/Users/berkeipekci/Desktop/TextAsset/cardb.json';
let externalCardbCache = null;

function loadExternalCardb() {
  if (externalCardbCache !== null) {
    return externalCardbCache;
  }
  try {
    const raw = JSON.parse(fs.readFileSync(EXTERNAL_CARDB_PATH, 'utf8'));
    externalCardbCache = raw && typeof raw === 'object' ? raw : {};
  } catch (error) {
    externalCardbCache = {};
  }
  return externalCardbCache;
}

function loadCrewDb() {
  const raw = loadJson(config.crewsFile, null);
  return {
    alliances: raw && raw.alliances && typeof raw.alliances === 'object' ? raw.alliances : {},
    memberships: raw && raw.memberships && typeof raw.memberships === 'object' ? raw.memberships : {}
  };
}

function saveCrewDb(db = {}) {
  saveJson(config.crewsFile, {
    alliances: db && db.alliances && typeof db.alliances === 'object' ? db.alliances : {},
    memberships: db && db.memberships && typeof db.memberships === 'object' ? db.memberships : {}
  });
}

function buildDefaultAllianceStats() {
  return {
    stc: {
      intValue: 0,
      stringValue: '0',
      value: 0
    }
  };
}

function buildDefaultAllianceData() {
  return {
    bg: 0,
    banner: 0,
    border: 0,
    icon: 0,
    iconColor: 0,
    bannerColor: 0
  };
}

function normalizeAllianceMember(member = {}, fallbackRole = 'member') {
  const uid = String(firstDefined(member.uid, member.id, '') || '').trim();
  const role = String(firstDefined(member.role, member.rank, fallbackRole) || fallbackRole).trim() || fallbackRole;
  const entitlements = Array.isArray(member.entitlements)
    ? member.entitlements.map((entry) => String(entry || '').trim()).filter(Boolean)
    : [];
  return {
    uid,
    id: uid,
    name: String(firstDefined(member.name, member.displayName, `Player ${uid || '1'}`) || '').trim() || `Player ${uid || '1'}`,
    role,
    rank: role,
    lastLogin: Number(firstDefined(member.lastLogin, member.lastlogin, nowTs()) || nowTs()),
    lastlogin: Number(firstDefined(member.lastlogin, member.lastLogin, nowTs()) || nowTs()),
    entitlements: entitlements.slice(),
    Entitlements: entitlements.slice()
  };
}

function buildAllianceMemberPayload(userId, role = 'member') {
  const profile = getAuthoritativeSparxProfile(userId);
  const uid = String(getProfileUidValue(profile, userId));
  const normalizedRole = String(role || 'member').trim() || 'member';
  const entitlements = normalizedRole === 'owner'
    ? ['promote', 'demote', 'kick', 'edit']
    : (normalizedRole === 'officer' ? ['promote', 'demote', 'kick'] : []);
  return normalizeAllianceMember({
    uid,
    id: uid,
    name: sanitizeClientVisibleName(profile.name || profile.Nickname || '') || `Player ${uid}`,
    role: normalizedRole,
    rank: normalizedRole,
    lastLogin: nowTs(),
    entitlements
  }, normalizedRole);
}

function normalizeAllianceRecord(raw = {}) {
  const aid = String(firstDefined(raw.aid, raw.id, '') || '').trim();
  const members = Array.isArray(raw.members)
    ? raw.members.map((member) => normalizeAllianceMember(member)).filter((member) => member.uid)
    : [];
  const pubType = String(firstDefined(raw.pubType, raw.publicType, raw.isPublic ? 'public' : 'private', 'public') || 'public').toLowerCase();
  const isPublic = Boolean(raw.isPublic === undefined ? pubType !== 'private' : raw.isPublic);
  const maxMembers = Math.max(1, Math.trunc(Number(firstDefined(raw.maxMembers, raw.memberLimit, 20) || 20)));
  const localizedCountry = String(firstDefined(raw.localizedCountry, raw.countryName, 'Turkey') || 'Turkey');
  const locale = String(firstDefined(raw.locale, 'tr_TR') || 'tr_TR');
  const language = String(firstDefined(raw.language, 'tr') || 'tr');
  const description = String(firstDefined(raw.description, raw.msg, raw.message, '') || '');
  const normalized = {
    aid,
    id: aid,
    name: String(firstDefined(raw.name, 'Fast Crew') || 'Fast Crew').trim() || 'Fast Crew',
    tag: String(firstDefined(raw.tag, 'FAST') || 'FAST').trim() || 'FAST',
    description,
    msg: String(firstDefined(raw.msg, description, '') || ''),
    message: String(firstDefined(raw.message, description, '') || ''),
    locale,
    language,
    localizedCountry,
    country: String(firstDefined(raw.country, 'TR') || 'TR'),
    pubType,
    publicType: pubType,
    isPublic,
    public: isPublic,
    data: clone(raw.data && typeof raw.data === 'object' ? raw.data : buildDefaultAllianceData()),
    stats: clone(raw.stats && typeof raw.stats === 'object' ? raw.stats : buildDefaultAllianceStats()),
    members,
    memberCount: members.length,
    numMembers: members.length,
    maxMembers,
    createdAt: Number(firstDefined(raw.createdAt, nowTs()) || nowTs())
  };
  return normalized;
}

function ensureCrewDbMembershipMigrated(userId, db) {
  const user = getUser(userId);
  const existingAid = String(db.memberships[String(userId)] || '').trim();
  const legacyAlliance = user && user.allianceState && user.allianceState.alliance && typeof user.allianceState.alliance === 'object'
    ? normalizeAllianceRecord(user.allianceState.alliance)
    : null;
  if (!legacyAlliance || existingAid) {
    return false;
  }
  const localMember = buildAllianceMemberPayload(userId, 'owner');
  legacyAlliance.members = legacyAlliance.members.filter((member) => member.uid !== localMember.uid);
  legacyAlliance.members.unshift(localMember);
  legacyAlliance.memberCount = legacyAlliance.members.length;
  legacyAlliance.numMembers = legacyAlliance.members.length;
  db.alliances[legacyAlliance.aid] = clone(legacyAlliance);
  db.memberships[String(userId)] = legacyAlliance.aid;
  return true;
}

function getAllianceForUser(userId, db = loadCrewDb()) {
  const aid = String(db.memberships[String(userId)] || '').trim();
  if (!aid) {
    return null;
  }
  const alliance = db.alliances[aid];
  return alliance ? normalizeAllianceRecord(alliance) : null;
}

function buildRecommendedAllianceList(userId, db = loadCrewDb(), currentAid = '') {
  const alliances = Object.values(db.alliances || {})
    .map((entry) => normalizeAllianceRecord(entry))
    .filter((entry) => entry.aid && entry.aid !== currentAid);
  if (alliances.length > 0) {
    return alliances;
  }
  return [
    normalizeAllianceRecord({
      aid: 'crew_local_1',
      name: 'Fast Crew',
      tag: 'FAST',
      description: 'Local FF7 crew',
      isPublic: true,
      members: []
    })
  ];
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

const GACHA_TUTORIAL_SET_MAPPINGS = [
  { n: 'Gacha FTE Buy Car', s: 'story' },
  { n: 'Go to Gacha Screen', s: 'story' },
  { n: 'Gacha FTE Main Menu > Race Select', s: 'story' },
  { n: 'Main Menu Race Select', s: 'story' }
];

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

function buildNormalizedTutorialDb(rawDb) {
  const payload = clone(rawDb || {});
  payload.data = payload.data && typeof payload.data === 'object' ? payload.data : {};
  payload.data.SEQUENTIAL = reorderSequentialTutorialGroupEntries(
    normalizeTutorialGroupEntries(payload.data.SEQUENTIAL)
  );
  payload.data.CONTEXTUAL = normalizeTutorialGroupEntries(payload.data.CONTEXTUAL);
  return payload;
}

function getTutorialGroupRaceHint(group) {
  const steps = Array.isArray(group && group.t) ? group.t : [];
  for (const step of steps) {
    const jid = String(step && step.jid || '').trim();
    if (jid) return jid;
    const rist = String(step && step.rist || '').trim();
    if (rist) return rist;
  }
  return '';
}

function buildTutorialGroupMetadata(groups, bucket) {
  return (Array.isArray(groups) ? groups : []).reduce((acc, group) => {
    const groupId = `G${parseInt(group && group.gi, 10) || 0}`;
    if (!/^G\d+$/.test(groupId)) {
      return acc;
    }
    const steps = Array.isArray(group && group.t) ? group.t : [];
    acc[groupId] = {
      groupId,
      tutorialId: bucket === 'CONTEXTUAL' ? groupId : FF7_TUTORIAL_ID,
      bucket,
      name: String(group && group.gn || ''),
      groupSequencePath: String(group && group.gsp || ''),
      sequenceIndex: Number(group && group.si || 0),
      raceHint: getTutorialGroupRaceHint(group),
      steps: steps.map((step) => ({
        title: String(step && step.tn || ''),
        sequencePath: String(step && step.tsp || ''),
        tutorialIndex: Number(step && step.ti || 0),
        sequenceIndex: Number(step && step.si || 0),
        tutorialGroupIndex: Number(step && step.tgi || 0),
        jumpRaceId: String(step && step.jid || '').trim(),
        raceStartId: String(step && step.rist || '').trim()
      }))
    };
    return acc;
  }, {});
}

const FF7_NORMALIZED_TUTORIAL_DB = buildNormalizedTutorialDb(extractedTutorialDb);
const FF7_TUTORIAL_DB_HASH = crypto.createHash('md5').update(JSON.stringify(FF7_NORMALIZED_TUTORIAL_DB.data || FF7_NORMALIZED_TUTORIAL_DB)).digest('hex');
const FF7_TUTORIAL_DB_LTID = Number(FF7_NORMALIZED_TUTORIAL_DB.ltid || 0);
const FF7_TUTORIAL_DB_LTGID = Number(FF7_NORMALIZED_TUTORIAL_DB.ltgid || 0);
const FF7_SEQUENTIAL_TUTORIAL_ENTRIES = Array.isArray(FF7_NORMALIZED_TUTORIAL_DB && FF7_NORMALIZED_TUTORIAL_DB.data && FF7_NORMALIZED_TUTORIAL_DB.data.SEQUENTIAL)
  ? FF7_NORMALIZED_TUTORIAL_DB.data.SEQUENTIAL
  : [];
const ENGINE_TYPE_NAMES = ['V4', 'V4M', 'V6', 'V6M', 'V8', 'V8M', 'V10', 'V10M', 'V12', 'V12M'];
const ASPIRATION_TYPE_NAMES = ['NORMAL', 'TURBO_CHARGED', 'SUPER_CHARGED'];
const FF7_CONTEXTUAL_TUTORIAL_ENTRIES = Array.isArray(FF7_NORMALIZED_TUTORIAL_DB && FF7_NORMALIZED_TUTORIAL_DB.data && FF7_NORMALIZED_TUTORIAL_DB.data.CONTEXTUAL)
  ? FF7_NORMALIZED_TUTORIAL_DB.data.CONTEXTUAL
  : [];
const FF7_TUTORIAL_GROUP_METADATA = {
  ...buildTutorialGroupMetadata(FF7_SEQUENTIAL_TUTORIAL_ENTRIES, 'SEQUENTIAL'),
  ...buildTutorialGroupMetadata(FF7_CONTEXTUAL_TUTORIAL_ENTRIES, 'CONTEXTUAL')
};
const FF7_TUTORIAL_BRANCH_IDS = FF7_SEQUENTIAL_TUTORIAL_ENTRIES.length > 0
  ? FF7_SEQUENTIAL_TUTORIAL_ENTRIES
      .map((group) => `G${parseInt(group && group.gi, 10) || 0}`)
      .filter((groupId, index, list) => /^G\d+$/.test(groupId) && list.indexOf(groupId) === index)
  : [FF7_TUTORIAL_GROUP_ID];
const FF7_OFFICIAL_TUTORIAL_BRANCH_IDS = normalizeTutorialGroupEntries(
  extractedTutorialDb && extractedTutorialDb.data && extractedTutorialDb.data.SEQUENTIAL
)
  .map((group) => `G${parseInt(group && group.gi, 10) || 0}`)
  .filter((groupId, index, list) => /^G\d+$/.test(groupId) && list.indexOf(groupId) === index);
const FF7_CONTEXTUAL_TUTORIAL_IDS = FF7_CONTEXTUAL_TUTORIAL_ENTRIES.length > 0
  ? FF7_CONTEXTUAL_TUTORIAL_ENTRIES
      .map((group) => `G${parseInt(group && group.gi, 10) || 0}`)
      .filter((groupId, index, list) => /^G\d+$/.test(groupId) && list.indexOf(groupId) === index)
  : [];
const FF7_ALL_TUTORIAL_GROUP_IDS = Array.from(new Set(
  FF7_TUTORIAL_BRANCH_IDS.concat(FF7_CONTEXTUAL_TUTORIAL_IDS).filter(Boolean)
));
const FF7_TUTORIAL_BRANCH_RACE_IDS = FF7_TUTORIAL_BRANCH_IDS.reduce((map, groupId) => {
  const raceHint = String(
    FF7_TUTORIAL_GROUP_METADATA[groupId] && FF7_TUTORIAL_GROUP_METADATA[groupId].raceHint || ''
  ).trim();
  if (raceHint) {
    map[groupId] = raceHint;
  }
  return map;
}, {});

function sanitizeClientVisibleName(value) {
  const name = String(value || '').trim();
  if (!name) return '';
  if (/^(player\s|driver\s|guest|newb)/i.test(name)) {
    return '';
  }
  return name.slice(0, 16);
}
const FF7_TUTORIAL_RACE_TO_BRANCH_IDS = Object.entries(FF7_TUTORIAL_BRANCH_RACE_IDS).reduce((acc, [branchId, raceId]) => {
  acc[String(raceId)] = String(branchId);
  return acc;
}, {});
const FF7_SKIP_TUTORIAL_TO_GARAGE = Boolean(ff7TutorialConfig.skipTutorialToGarage);
const FF7_COMPLETE_TUTORIALS_ON_FRESH_SAVE = Boolean(ff7TutorialConfig.freshSavesCompleteTutorials);
const FF7_COMPLETE_ALL_TUTORIALS_EXCEPT_FIRST = Boolean(ff7TutorialConfig.completeAllTutorialsExceptFirst);
const FF7_FIRST_TUTORIAL_CONFIG = ((ff7TutorialConfig.races || {})[FF7_TUTORIAL_RACE_ID]) || {};
const FF7_LEGACY_GARAGE_CAR_IDS = Array.isArray(ff7TutorialConfig.legacyGarageCarIds)
  ? ff7TutorialConfig.legacyGarageCarIds.map((tag) => String(tag))
  : [];
const FF7_TUTORIAL_PLAYER_CAR_ID = String(
  ff7TutorialConfig.tutorialPlayerCarId ||
  FF7_FIRST_TUTORIAL_CONFIG.playerCarId ||
  'nissan_gtr_r35_2007'
);
const FF7_GARAGE_CAR_ID = String(ff7TutorialConfig.garageCarId || FF7_TUTORIAL_PLAYER_CAR_ID);
const FF7_DEFAULT_CURRENT_CAR_ID = FF7_SKIP_TUTORIAL_TO_GARAGE ? FF7_GARAGE_CAR_ID : FF7_TUTORIAL_PLAYER_CAR_ID;
const FF7_DEFAULT_OWNED_VEHICLE_TAGS = (
  FF7_SKIP_TUTORIAL_TO_GARAGE &&
  Array.isArray(ff7TutorialConfig.garageOwnedVehicleTags) &&
  ff7TutorialConfig.garageOwnedVehicleTags.length > 0
    ? ff7TutorialConfig.garageOwnedVehicleTags
    : [FF7_DEFAULT_CURRENT_CAR_ID]
).map((tag) => String(tag)).filter(Boolean);
const FF7_TUTORIAL_OPPONENT_CAR_ID = String(((ff7TutorialConfig.races || {})[FF7_TUTORIAL_RACE_ID] || {}).opponentCarId || 'ff_police_sedan_tokyo_01');
const FF7_TUTORIAL_TRAFFIC_CAR_IDS = Array.isArray(((ff7TutorialConfig.races || {})[FF7_TUTORIAL_RACE_ID] || {}).trafficCarIds)
  ? ((ff7TutorialConfig.races || {})[FF7_TUTORIAL_RACE_ID].trafficCarIds || []).slice()
  : [];
const FF7_TUTORIAL_POLICE_CAR_IDS = Array.isArray(((ff7TutorialConfig.races || {})[FF7_TUTORIAL_RACE_ID] || {}).policeCarIds)
  ? ((ff7TutorialConfig.races || {})[FF7_TUTORIAL_RACE_ID].policeCarIds || []).slice()
  : [];
const SHIPYARD_GROUP_ID = 'base';
const SHIPYARD_SET_ID = 'base';
const SHIPYARD_GACHA_TOKEN = 'shipyard_token';
const SHIPYARD_GROUP_ALIASES = ['base'];
const SHIPYARD_BOX_DEFINITIONS = [
  {
    id: 'deluxe_plus_parts',
    token: 'shipyard_deluxe_plus_parts',
    name: 'DELUXE+ PARTS',
    desc: 'INCLUDES 5 PARTS -- ALL STAGES, ALL CLASSES! GUARANTEED 1 PART CLASS A OR S!',
    kind: 'parts',
    currency: 'hc',
    cost: 80,
    bgIndex: 0,
    displayMode: 'crate',
    partCount: 5,
    featuredPart: '5_engine_01',
    guaranteedPart: '6_body_01'
  },
  {
    id: 'ten_x_pro_crate',
    token: 'shipyard_ten_x_pro_crate',
    name: '10 X PRO',
    desc: 'GET 10 X PRO CRATES WITH CLASS C OR BETTER GUARANTEED!',
    kind: 'car',
    currency: 'hc',
    cost: 900,
    bgIndex: 1,
    displayMode: 'crate',
    banner: '10',
    featuredTag: 'nissan_gtr_r35_2007',
    candidates: [
      'honda_nsx_r_2002',
      'ford_mustang_gt_2015',
      'cadillac_ctsv_2011',
      'subaru_wrx_sti_2015',
      'bmw_m3_e92_gts_2011',
      'chevrolet_camaro_zl1_2012',
      'nissan_370z_2013',
      'acura_integra_type_r_2001',
      'ford_gran_torino_1972_ff4',
      'nissan_skyline_gtr_c10_1972'
    ]
  },
  {
    id: 'pro_crate',
    token: 'shipyard_pro_crate',
    name: 'PRO',
    desc: 'PREMIUM CARS STRAIGHT FROM THE SHOWROOM. CLASS D OR BETTER GUARANTEED.',
    kind: 'car',
    currency: 'hc',
    cost: 85,
    bgIndex: 1,
    displayMode: 'car',
    featuredTag: 'nissan_gtr_r35_2007',
    candidates: [
      'honda_nsx_r_2002',
      'ford_mustang_gt_2015',
      'cadillac_ctsv_2011',
      'subaru_wrx_sti_2015',
      'bmw_m3_e92_gts_2011',
      'nissan_370z_2013',
      'acura_integra_type_r_2001',
      'subaru_impreza_wrx_sti_4dr_2012',
      'ford_gran_torino_1972_ff4',
      'dodge_challenger_1971'
    ]
  },
  {
    id: 'amateur_crate',
    token: 'shipyard_amateur_crate',
    name: 'AMATEUR',
    desc: 'FRESH FROM THE LOT. READY FOR THE STREET.',
    kind: 'car',
    currency: 'hc',
    cost: 25,
    bgIndex: 0,
    displayMode: 'car',
    featuredTag: 'pontiac_firebird_1981',
    candidates: [
      'pontiac_firebird_1981',
      'dodge_dart_gt_2013',
      'ford_escort_rs2000_1986',
      'hyundai_veloster_2012',
      'subaru_brz_2013',
      'hyundai_genesis_coupe_2013',
      'acura_rsx_type_s_2006',
      'honda_prelude_type_s_2001'
    ]
  },
  {
    id: 'daily_prize',
    token: 'shipyard_daily_prize',
    name: 'DAILY PRIZE',
    desc: 'GOLD OR CAR GUARANTEED.',
    kind: 'daily',
    currency: 'free',
    cost: 0,
    bgIndex: 0,
    freeTime: 64800,
    displayMode: 'mystery',
    featuredTag: 'subaru_brz_2013',
    candidates: [
      'subaru_brz_2013',
      'hyundai_genesis_coupe_2013',
      'honda_prelude_type_s_2001'
    ],
    goldReward: 25
  },
  {
    id: 'super_parts',
    token: 'shipyard_super_parts',
    name: 'SUPER PARTS',
    desc: 'INCLUDES 15 PARTS -- ANY STAGE, ANY CLASS!',
    kind: 'parts',
    currency: 'hc',
    cost: 45,
    bgIndex: 0,
    displayMode: 'crate',
    partCount: 15,
    featuredPart: '3_engine_01'
  },
  {
    id: 'premium_plus_crate',
    token: 'shipyard_premium_plus_crate',
    name: 'PREMIUM+',
    desc: 'CLASS A MINI. INCREASED CHANCE FOR HERO 2010 NISSAN SKYLINE GT-R!',
    kind: 'car',
    currency: 'hc',
    cost: 250,
    bgIndex: 2,
    displayMode: 'car',
    banner: '5',
    featuredTag: 'nissan_gtr_r35_2007',
    candidates: [
      'nissan_gtr_r35_2007',
      'dodge_viper_srt_gts_2013',
      'chevrolet_corvette_c7_z06_2015',
      'ford_gt_2006',
      'shelby_gt500_2014',
      'nissan_skyline_gtr_bnr34_2002',
      'cadillac_cien_concept_2002'
    ]
  }
];

const FF7_REQUIRED_DYNAMIC_VU_NAMES = Object.freeze([
  'vu_subaru_wrx_sti_2015_bodykit_aero_001_s1_a',
  'vu_subaru_wrx_sti_2015_bodykit_aero_002_s1_a',
  'vu_subaru_wrx_sti_2015_bodykit_aero_003_s1_a',
  'vu_wmotors_lykan_hypersport_2014_bodykit_aero_001_s1_a',
  'vu_wmotors_lykan_hypersport_2014_bodykit_aero_002_s1_a',
  'vu_wmotors_lykan_hypersport_2014_bodykit_aero_003_s1_a',
  'vu_dodge_viper_srt_timeattack_2014_bodykit_oem_a'
]);

function normalizeGameStoreSetId(setId) {
  const normalized = String(setId || '').trim().toLowerCase();
  if (!normalized) {
    return '';
  }
  if (normalized === 'shipyard') {
    return SHIPYARD_SET_ID;
  }
  if (normalized === SHIPYARD_SET_ID) {
    return SHIPYARD_SET_ID;
  }
  return normalized;
}

function getShipyardBoxImagePaths(definition = {}, displayMode = 'car', kind = 'car') {
  const defaultImgPaths = [
    {
      closed: 'Bundles/UITextures/Gacha/container_0',
      open: 'Bundles/UITextures/Gacha/container_0',
      bg: '0'
    },
    {
      closed: 'Bundles/UITextures/Gacha/container_1',
      open: 'Bundles/UITextures/Gacha/container_1',
      bg: '1'
    },
    {
      closed: 'Bundles/UITextures/Gacha/container_2',
      open: 'Bundles/UITextures/Gacha/container_2',
      bg: '2'
    }
  ][Math.max(0, Math.min(2, Number(firstDefined(definition && definition.bgIndex, 0) || 0)))] || {
    closed: 'Bundles/UITextures/Gacha/container_0',
    open: 'Bundles/UITextures/Gacha/container_0',
    bg: '0'
  };

  if (String(displayMode || '').toLowerCase() === 'mystery') {
    return {
      closed: 'Bundles/UITextures/Gacha/UI_car_silhouette_texture',
      open: 'Bundles/UITextures/Gacha/UI_car_silhouette_texture',
      bg: defaultImgPaths.bg
    };
  }

  if (String(kind || '').toLowerCase() === 'parts' || String(displayMode || '').toLowerCase() === 'crate') {
    return {
      closed: 'Bundles/UITextures/Gacha/container_0',
      open: 'Bundles/UITextures/Gacha/container_0',
      bg: defaultImgPaths.bg
    };
  }

  const featuredTag = String(firstDefined(definition && definition.featuredTag, '') || '').trim();
  const featuredMeta = featuredTag ? buildCarMetaPayload(featuredTag) : {};
  const thumbnailPath = String(firstDefined(featuredMeta && featuredMeta.tbp, '') || '').trim();
  return {
    closed: thumbnailPath || defaultImgPaths.closed,
    open: thumbnailPath || defaultImgPaths.open,
    bg: defaultImgPaths.bg
  };
}

function firstDefined() {
  for (let index = 0; index < arguments.length; index += 1) {
    const value = arguments[index];
    if (value !== undefined && value !== null && value !== '') {
      return value;
    }
  }
  return undefined;
}

function normalizeProfilePicRef(ppti) {
  const raw = String(ppti || '').trim();
  if (!raw) return '';
  if (raw.startsWith('http://') || raw.startsWith('https://') || raw.startsWith('/')) {
    return raw;
  }
  return raw;
}

const G1_RACE_ID = 'chapter_00_a';
const G1_CSPD_FALLBACK = 'ID_STORY_CHAPTER_0_PRE_1A:WSO|0|ROMAN|ID_STORY_CHAPTER_0_PRE_1A|ID_UI_PRERACE_LOCATION_TOKYO|GP|True';
const G1_TM_FALLBACK = 'ROMAN|dialog_character_roman01&ID_UI_PRERACE_LOCATION_TOKYO|map_tokyo_shape&icon|police';
const G1_PPTI_FALLBACK = 'profile_pic_police';
const FF7_DISABLED_TUTORIAL_RACE_IDS = new Set([
  'chapter_00_b',
  'chapter_01_a',
  'chapter_01_b',
  'chapter_01_c',
  'chapter_01_e'
]);
const FF7_RACE_RESULT_KEYS = [
  'ri', 'rc', 'rt', 'pr', 'clr', 'sim', 'dis', 'ti', 'de', 'ric', 'rci', 'rde',
  'brd', 'obj', 'sn', 'sv', 'tl', 'okl', 'on', 'oph', 'opmt', 'opi', 'tm',
  'pspd', 'cspd', 'md', 'xw', 'xgtw', 'xl', 'upw', 'upgw', 'upl', 'hc', 'ppti',
  'cr', 'gt', 'gb', 'scw', 'scl', 'pra',
  'pc', 'PlayerCar', 'playerCar', 'PlayerCarId', 'playerCarId', 'pv', 'ppu', 'pup',
  'oc', 'OpponentCar', 'opponentCar', 'OpponentCarId', 'opponentCarId',
  'ov', 'opu', 'oup'
];

function isDisabledTutorialRaceId(raceId) {
  const normalizedRaceId = String(raceId || '').trim();
  return Boolean(normalizedRaceId && FF7_DISABLED_TUTORIAL_RACE_IDS.has(normalizedRaceId));
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

function getTutorialRaceConfig(raceId) {
  const normalizedRaceId = String(raceId || '').trim();
  if (!normalizedRaceId || isDisabledTutorialRaceId(normalizedRaceId)) {
    return {};
  }
  const races = ff7TutorialConfig.races || {};
  return races[normalizedRaceId] || {};
}

function normalizeTutorialBranchId(value, fallback = FF7_TUTORIAL_GROUP_ID) {
  const raw = String(value || '').trim();
  const match = raw.match(/^G(\d+)$/i);
  if (match) {
    return `G${parseInt(match[1], 10)}`;
  }
  if (fallback === null || typeof fallback === 'undefined') {
    return String(FF7_TUTORIAL_GROUP_ID);
  }
  return String(fallback);
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

function normalizeStoryTutorialId(tutorialId, branchId) {
  const normalizedTutorialId = String(tutorialId || '').trim();
  const normalizedBranchId = normalizeTutorialBranchId(branchId, '');
  if (normalizedBranchId && isSequentialTutorialBranchId(normalizedBranchId)) {
    return FF7_TUTORIAL_ID;
  }
  return normalizedTutorialId || FF7_TUTORIAL_ID;
}

function isSequentialTutorialBranchId(branchId) {
  const normalizedBranchId = normalizeTutorialBranchId(branchId, '');
  return Boolean(
    normalizedBranchId &&
    (
      FF7_TUTORIAL_BRANCH_RACE_IDS[normalizedBranchId] ||
      FF7_TUTORIAL_BRANCH_IDS.indexOf(normalizedBranchId) !== -1
    )
  );
}

function isContextualTutorialId(tutorialId) {
  const rawTutorialId = String(tutorialId || '').trim();
  const normalizedTutorialId = /^G\d+$/i.test(rawTutorialId)
    ? `G${parseInt(rawTutorialId.replace(/^G/i, ''), 10)}`
    : '';
  const contextualTutorialIds = Array.isArray(extractedTutorialDb && extractedTutorialDb.data && extractedTutorialDb.data.CONTEXTUAL)
    ? extractedTutorialDb.data.CONTEXTUAL
        .map((group) => `G${parseInt(group && group.gi, 10) || 0}`)
        .filter((groupId, index, list) => /^G\d+$/.test(groupId) && list.indexOf(groupId) === index)
    : FF7_CONTEXTUAL_TUTORIAL_IDS;
  return Boolean(
    normalizedTutorialId &&
    contextualTutorialIds.indexOf(normalizedTutorialId) !== -1
  );
}

function isKnownTutorialId(tutorialId) {
  const normalizedTutorialId = String(tutorialId || '').trim();
  return Boolean(
    normalizedTutorialId &&
    (
      normalizedTutorialId === FF7_TUTORIAL_ID ||
      isContextualTutorialId(normalizedTutorialId)
    )
  );
}

function isKnownTutorialGroupId(groupId) {
  const normalizedGroupId = normalizeTutorialBranchId(groupId, '');
  return Boolean(
    normalizedGroupId &&
    FF7_ALL_TUTORIAL_GROUP_IDS.indexOf(normalizedGroupId) !== -1
  );
}

function getSequentialTutorialBranchIdsUpTo(branchId, options = {}) {
  const normalizedBranchId = normalizeTutorialBranchId(branchId, '');
  const inclusive = options.inclusive !== false;
  const index = FF7_TUTORIAL_BRANCH_IDS.indexOf(normalizedBranchId);
  if (index === -1) {
    return [];
  }
  return FF7_TUTORIAL_BRANCH_IDS.slice(0, inclusive ? index + 1 : index);
}

function sanitizeTutorialStateCollections(tutorial) {
  if (!tutorial || typeof tutorial !== 'object') {
    return false;
  }

  let changed = false;

  if (Array.isArray(tutorial.tutorials)) {
    const sanitizedTutorials = tutorial.tutorials
      .map((tutorialId) => String(tutorialId || '').trim())
      .filter((tutorialId, index, list) => isKnownTutorialId(tutorialId) && list.indexOf(tutorialId) === index);
    if (JSON.stringify(tutorial.tutorials) !== JSON.stringify(sanitizedTutorials)) {
      tutorial.tutorials = sanitizedTutorials;
      changed = true;
    }
  }

  ['tutorialGroups', 'tutorialGroupsCompleted'].forEach((key) => {
    if (!Array.isArray(tutorial[key])) {
      return;
    }
    const sanitizedGroups = tutorial[key]
      .map((groupId) => normalizeTutorialBranchId(groupId, ''))
      .filter((groupId, index, list) => isKnownTutorialGroupId(groupId) && list.indexOf(groupId) === index);
    if (JSON.stringify(tutorial[key]) !== JSON.stringify(sanitizedGroups)) {
      tutorial[key] = sanitizedGroups;
      changed = true;
    }
  });

  if (tutorial.tutorialData && typeof tutorial.tutorialData === 'object') {
    const sanitizedTutorialData = {};
    Object.entries(tutorial.tutorialData).forEach(([key, value]) => {
      const [rawTutorialId, rawBranchId] = String(key || '').split(':');
      const tutorialId = String(rawTutorialId || '').trim();
      const contextualTutorial = isContextualTutorialId(tutorialId);
      const branchId = normalizeTutorialBranchId(rawBranchId || tutorialId, contextualTutorial ? tutorialId : '');
      const keepEntry = contextualTutorial
        ? branchId === normalizeTutorialBranchId(tutorialId, '')
        : tutorialId === FF7_TUTORIAL_ID && isSequentialTutorialBranchId(branchId);
      if (keepEntry) {
        sanitizedTutorialData[`${tutorialId}:${branchId}`] = clone(value || {});
      }
    });
    if (JSON.stringify(tutorial.tutorialData) !== JSON.stringify(sanitizedTutorialData)) {
      tutorial.tutorialData = sanitizedTutorialData;
      changed = true;
    }
  }

  if (tutorial.userData && typeof tutorial.userData === 'object') {
    const sanitizedUserData = {};
    Object.entries(tutorial.userData).forEach(([tutorialId, value]) => {
      if (isKnownTutorialId(tutorialId)) {
        sanitizedUserData[String(tutorialId)] = clone(value || {});
      }
    });
    if (JSON.stringify(tutorial.userData) !== JSON.stringify(sanitizedUserData)) {
      tutorial.userData = sanitizedUserData;
      changed = true;
    }
  }

  return changed;
}

function resolveRequestedTutorialSelection(tutorial, params = {}) {
  const requestedTidRaw = String(firstDefined(
    params.tid,
    params.tutorialId,
    params.id,
    ''
  )).trim();
  const requestedBidRaw = String(firstDefined(
    params.bid,
    params.branchId,
    params.groupId,
    ''
  )).trim();
  const normalizedRequestedTidGroup = /^G\d+$/i.test(requestedTidRaw)
    ? normalizeTutorialBranchId(requestedTidRaw, '')
    : '';
  const normalizedRequestedBid = requestedBidRaw
    ? normalizeTutorialBranchId(requestedBidRaw, '')
    : '';

  if (isContextualTutorialId(normalizedRequestedTidGroup)) {
    return {
      tid: normalizedRequestedTidGroup,
      bid: normalizedRequestedBid || normalizedRequestedTidGroup,
      requestedTidRaw,
      requestedBidRaw
    };
  }

  if (isSequentialTutorialBranchId(normalizedRequestedTidGroup)) {
    return {
      tid: FF7_TUTORIAL_ID,
      bid: normalizedRequestedBid || normalizedRequestedTidGroup,
      requestedTidRaw,
      requestedBidRaw
    };
  }

  const fallbackBid = normalizeTutorialBranchId(
    normalizedRequestedBid ||
      firstDefined(
        tutorial && tutorial.currentTutorialGroupId,
        tutorial && tutorial.activeTutorial && tutorial.activeTutorial.bid,
        FF7_TUTORIAL_GROUP_ID
      ),
    FF7_TUTORIAL_GROUP_ID
  );

  return {
    tid: normalizeStoryTutorialId(requestedTidRaw || FF7_TUTORIAL_ID, fallbackBid),
    bid: fallbackBid,
    requestedTidRaw,
    requestedBidRaw
  };
}

function getTutorialBranchIdForRaceId(raceId, fallback = FF7_TUTORIAL_GROUP_ID) {
  const normalizedRaceId = String(raceId || '').trim();
  return String(FF7_TUTORIAL_RACE_TO_BRANCH_IDS[normalizedRaceId] || fallback || FF7_TUTORIAL_GROUP_ID);
}

function getNextTutorialBranchId(branchId) {
  const normalizedBranchId = normalizeTutorialBranchId(branchId, '');
  const index = FF7_TUTORIAL_BRANCH_IDS.indexOf(normalizedBranchId);
  if (index === -1 || index + 1 >= FF7_TUTORIAL_BRANCH_IDS.length) {
    return '';
  }
  return String(FF7_TUTORIAL_BRANCH_IDS[index + 1] || '');
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

function redirectTutorialBranchId(branchId) {
  return normalizeTutorialBranchId(branchId, '');
}

function getNextPlayableTutorialBranchId(branchId) {
  let cursor = getNextTutorialBranchId(branchId);
  while (cursor) {
    cursor = redirectTutorialBranchId(cursor);
    const raceId = getTutorialBranchRaceId(cursor, '');
    if (isConfiguredTutorialRaceId(raceId)) {
      return cursor;
    }
    cursor = getNextTutorialBranchId(cursor);
  }
  return '';
}

function getRaceLinkedTutorialBranches() {
  return FF7_TUTORIAL_BRANCH_IDS
    .map((branchId) => ({
      branchId: String(branchId || ''),
      raceId: getTutorialBranchRaceId(branchId, '')
    }))
    .filter((entry) => Boolean(entry.branchId && entry.raceId));
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
    // Also check raw (possibly disabled) race id — disabled races are still in won_races
    // when won in prior sessions. Without this check, no-race branches like G3 can never
    // advance because all later "race-linked" branches are in the disabled list.
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

function shouldCompleteTutorialsOnFreshSave(profile = {}) {
  if (!FF7_COMPLETE_TUTORIALS_ON_FRESH_SAVE || !profile || typeof profile !== 'object') {
    return false;
  }
  const wonRaces = profile.won_races && typeof profile.won_races === 'object' ? profile.won_races : {};
  const lostRaces = profile.lost_races && typeof profile.lost_races === 'object' ? profile.lost_races : {};
  const tutorialStep = Math.max(0, Math.trunc(Number(profile.tut_id || 0)));
  return Object.keys(wonRaces).length === 0 && Object.keys(lostRaces).length === 0 && tutorialStep <= 1;
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
      activeBranchId: FF7_TUTORIAL_GROUP_ID,
      completedBranchIds: []
    };
  }
  const completedBranchIds = [];

  for (let index = 0; index < FF7_TUTORIAL_BRANCH_IDS.length; index += 1) {
    const branchId = String(FF7_TUTORIAL_BRANCH_IDS[index] || '');
    const raceId = getTutorialBranchRaceId(branchId, '');
    // Raw race id includes disabled races (e.g. chapter_01_a is disabled but still in won_races).
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

function getStartupPlayableTutorialBranchId(profile = {}) {
  if (isFreshTutorialIntroProfile(profile)) {
    return FF7_TUTORIAL_GROUP_ID;
  }
  return String(getProfileDrivenTutorialCheckpoint(profile).activeBranchId || '');
}

function getEarlyTutorialCheckpoint(profile = {}) {
  if (shouldCompleteTutorialsOnFreshSave(profile)) {
    return {
      activeBranchId: '',
      completedBranchIds: FF7_TUTORIAL_BRANCH_IDS.slice()
    };
  }
  const checkpoint = getProfileDrivenTutorialCheckpoint(profile);
  if (checkpoint.activeBranchId || (Array.isArray(checkpoint.completedBranchIds) && checkpoint.completedBranchIds.length > 0)) {
    return checkpoint;
  }
  return { activeBranchId: FF7_TUTORIAL_GROUP_ID, completedBranchIds: [] };
}

function syncTutorialProgressionFields(targetProfile = {}, sourceProfile = {}) {
  if (!targetProfile || typeof targetProfile !== 'object' || !sourceProfile || typeof sourceProfile !== 'object') {
    return false;
  }

  const progressionKeys = [
    'won_races',
    'lost_races',
    'last_story_race',
    'crid',
    'jfrid',
    'cmid',
    'tut_id',
    'CurrentRaceId',
    'currentRaceId',
    'current_race_id',
    'JustFinishedRaceId',
    'justFinishedRaceId',
    'just_finished_race_id',
    'LastWonStoryRaceID',
    'lastWonStoryRaceID',
    'lastWonStoryRaceId'
  ];

  let changed = false;
  progressionKeys.forEach((key) => {
    if (!Object.prototype.hasOwnProperty.call(sourceProfile, key)) {
      return;
    }
    const sourceValue = clone(sourceProfile[key]);
    const targetValue = targetProfile[key];
    if (JSON.stringify(targetValue) !== JSON.stringify(sourceValue)) {
      targetProfile[key] = sourceValue;
      changed = true;
    }
  });

  return changed;
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

function getCompletedTutorialStepValue() {
  return FF7_TUTORIAL_BRANCH_IDS.reduce((maxValue, branchId) => {
    const match = String(branchId || '').match(/^G(\d+)$/i);
    if (!match) return maxValue;
    return Math.max(maxValue, Number(match[1] || 0));
  }, 1);
}

const FF7_EARLY_TUTORIAL_RESOURCE_DEFAULTS = Object.freeze({
  sc: 200,
  hc: 100,
  fuel: 2,
  maxFuel: 10,
  reserveFuel: 2
});

function normalizeTutorialStartingResources(profile) {
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
    profile.coins = FF7_EARLY_TUTORIAL_RESOURCE_DEFAULTS.sc;
    changed = true;
  }
  if (Number(profile.NoStars || 0) !== FF7_EARLY_TUTORIAL_RESOURCE_DEFAULTS.hc) {
    profile.NoStars = FF7_EARLY_TUTORIAL_RESOURCE_DEFAULTS.hc;
    profile.gold = FF7_EARLY_TUTORIAL_RESOURCE_DEFAULTS.hc;
    changed = true;
  }
  if (Number(profile.Fuel || 0) !== FF7_EARLY_TUTORIAL_RESOURCE_DEFAULTS.fuel) {
    profile.Fuel = FF7_EARLY_TUTORIAL_RESOURCE_DEFAULTS.fuel;
    profile.fuel = FF7_EARLY_TUTORIAL_RESOURCE_DEFAULTS.fuel;
    changed = true;
  }
  if (Number(profile.MaxFuel || 0) !== FF7_EARLY_TUTORIAL_RESOURCE_DEFAULTS.maxFuel) {
    profile.MaxFuel = FF7_EARLY_TUTORIAL_RESOURCE_DEFAULTS.maxFuel;
    profile.maxFuel = FF7_EARLY_TUTORIAL_RESOURCE_DEFAULTS.maxFuel;
    changed = true;
  }
  if (Number(profile.ReserveFuel || 0) !== FF7_EARLY_TUTORIAL_RESOURCE_DEFAULTS.reserveFuel) {
    profile.ReserveFuel = FF7_EARLY_TUTORIAL_RESOURCE_DEFAULTS.reserveFuel;
    changed = true;
  }

  return changed;
}

function syncTutorialStartingResourcesAcrossProfiles(rootProfile, dataStoreProfile) {
  if (!rootProfile || typeof rootProfile !== 'object' || !dataStoreProfile || typeof dataStoreProfile !== 'object') {
    return false;
  }

  const rootLevel = Number(rootProfile.level || rootProfile.Level || rootProfile.PlayerLevel || rootProfile.Rank || 1);
  const dataStoreLevel = Number(
    dataStoreProfile.level || dataStoreProfile.Level || dataStoreProfile.PlayerLevel || dataStoreProfile.Rank || 1
  );
  const canonical = {
    sc: Math.max(Number(rootProfile.NoCoins || rootProfile.coins || 0), Number(dataStoreProfile.NoCoins || dataStoreProfile.coins || 0)),
    hc: Math.max(Number(rootProfile.NoStars || rootProfile.gold || 0), Number(dataStoreProfile.NoStars || dataStoreProfile.gold || 0)),
    fuel: Math.max(Number(rootProfile.Fuel || rootProfile.fuel || 0), Number(dataStoreProfile.Fuel || dataStoreProfile.fuel || 0)),
    maxFuel: Math.max(
      Number(rootProfile.MaxFuel || rootProfile.maxFuel || 0),
      Number(dataStoreProfile.MaxFuel || dataStoreProfile.maxFuel || 0),
      FF7_EARLY_TUTORIAL_RESOURCE_DEFAULTS.maxFuel
    ),
    reserveFuel: Math.max(
      Number(rootProfile.ReserveFuel || rootProfile.reserveFuel || 0),
      Number(dataStoreProfile.ReserveFuel || dataStoreProfile.reserveFuel || 0),
      FF7_EARLY_TUTORIAL_RESOURCE_DEFAULTS.reserveFuel
    )
  };

  if (rootLevel <= 1 && dataStoreLevel <= 1 && canonical.sc <= 0 && canonical.hc <= 0 && canonical.fuel <= 0) {
    canonical.sc = FF7_EARLY_TUTORIAL_RESOURCE_DEFAULTS.sc;
    canonical.hc = FF7_EARLY_TUTORIAL_RESOURCE_DEFAULTS.hc;
    canonical.fuel = FF7_EARLY_TUTORIAL_RESOURCE_DEFAULTS.fuel;
  }

  let changed = false;
  const applyToProfile = (profile) => {
    if (Number(profile.NoCoins || 0) !== canonical.sc) {
      profile.NoCoins = canonical.sc;
      changed = true;
    }
    if (Number(profile.coins || 0) !== canonical.sc) {
      profile.coins = canonical.sc;
      changed = true;
    }
    if (Number(profile.NoStars || 0) !== canonical.hc) {
      profile.NoStars = canonical.hc;
      changed = true;
    }
    if (Number(profile.gold || 0) !== canonical.hc) {
      profile.gold = canonical.hc;
      changed = true;
    }
    if (Number(profile.stars || 0) !== canonical.hc) {
      profile.stars = canonical.hc;
      changed = true;
    }
    if (Number(profile.Fuel || 0) !== canonical.fuel) {
      profile.Fuel = canonical.fuel;
      changed = true;
    }
    if (Number(profile.fuel || 0) !== canonical.fuel) {
      profile.fuel = canonical.fuel;
      changed = true;
    }
    if (Number(profile.MaxFuel || 0) !== canonical.maxFuel) {
      profile.MaxFuel = canonical.maxFuel;
      changed = true;
    }
    if (Number(profile.maxFuel || 0) !== canonical.maxFuel) {
      profile.maxFuel = canonical.maxFuel;
      changed = true;
    }
    if (Number(profile.ReserveFuel || 0) !== canonical.reserveFuel) {
      profile.ReserveFuel = canonical.reserveFuel;
      changed = true;
    }
    if (Number(profile.reserveFuel || 0) !== canonical.reserveFuel) {
      profile.reserveFuel = canonical.reserveFuel;
      changed = true;
    }
  };

  applyToProfile(rootProfile);
  applyToProfile(dataStoreProfile);
  return changed;
}

function getClientVisibleCompletedTutorialBranchIds(tutorial = {}, activeBranchId = '') {
  const completedGroups = new Set(
    (Array.isArray(tutorial && tutorial.tutorialGroupsCompleted) ? tutorial.tutorialGroupsCompleted : [])
      .map((branchId) => normalizeTutorialBranchId(branchId, ''))
      .filter(Boolean)
  );
  const normalizedActiveBranchId = normalizeTutorialBranchId(activeBranchId, '');
  const activeRaceId = getTutorialBranchRaceId(normalizedActiveBranchId, '');

  if (normalizedActiveBranchId && isConfiguredTutorialRaceId(activeRaceId)) {
    const visibleIndex = FF7_TUTORIAL_BRANCH_IDS.indexOf(normalizedActiveBranchId);
    if (visibleIndex > 0) {
      for (let index = 0; index < visibleIndex; index += 1) {
        const candidateBranchId = normalizeTutorialBranchId(FF7_TUTORIAL_BRANCH_IDS[index], '');
        if (!candidateBranchId || completedGroups.has(candidateBranchId)) {
          continue;
        }
        if (!getTutorialBranchRaceId(candidateBranchId, '')) {
          completedGroups.add(candidateBranchId);
        }
      }
    }
  }

  return FF7_TUTORIAL_BRANCH_IDS.filter((branchId) => completedGroups.has(normalizeTutorialBranchId(branchId, '')));
}

function markTutorialBranchCompleted(tutorial, tutorialId, branchId) {
  const normalizedBranchId = normalizeTutorialBranchId(branchId, '');
  if (!tutorial || !normalizedBranchId) return;
  if (!Array.isArray(tutorial.tutorialGroups)) tutorial.tutorialGroups = [];
  if (!Array.isArray(tutorial.tutorialGroupsCompleted)) tutorial.tutorialGroupsCompleted = [];
  if (tutorial.tutorialGroups.indexOf(normalizedBranchId) === -1) {
    tutorial.tutorialGroups.push(normalizedBranchId);
  }
  if (tutorial.tutorialGroupsCompleted.indexOf(normalizedBranchId) === -1) {
    tutorial.tutorialGroupsCompleted.push(normalizedBranchId);
  }
  tutorial.tutorialData[`${tutorialId}:${normalizedBranchId}`] = {
    started: true,
    completed: true,
    updatedAt: nowTs()
  };
}

function markRedirectedTutorialBranchesCompleted(tutorial, tutorialId, originalBranchId, targetBranchId) {
  const normalizedOriginalBranchId = normalizeTutorialBranchId(originalBranchId, '');
  const normalizedTargetBranchId = normalizeTutorialBranchId(targetBranchId, '');
  if (!normalizedOriginalBranchId || !normalizedTargetBranchId || normalizedOriginalBranchId === normalizedTargetBranchId) {
    return;
  }
  const originalIndex = FF7_TUTORIAL_BRANCH_IDS.indexOf(normalizedOriginalBranchId);
  const targetIndex = FF7_TUTORIAL_BRANCH_IDS.indexOf(normalizedTargetBranchId);
  if (originalIndex === -1 || targetIndex === -1 || originalIndex >= targetIndex) {
    return;
  }
  let cursor = normalizedOriginalBranchId;
  const guard = new Set();
  while (cursor && cursor !== normalizedTargetBranchId && !guard.has(cursor)) {
    guard.add(cursor);
    markTutorialBranchCompleted(tutorial, tutorialId, cursor);
    cursor = getNextTutorialBranchId(cursor);
  }
}

function getTutorialBranchRange(startBranchId, endBranchId) {
  const normalizedStartBranchId = normalizeTutorialBranchId(startBranchId, '');
  const normalizedEndBranchId = normalizeTutorialBranchId(endBranchId, '');
  const startIndex = FF7_TUTORIAL_BRANCH_IDS.indexOf(normalizedStartBranchId);
  const endIndex = FF7_TUTORIAL_BRANCH_IDS.indexOf(normalizedEndBranchId);
  if (startIndex === -1 || endIndex === -1 || startIndex > endIndex) {
    return [];
  }
  return FF7_TUTORIAL_BRANCH_IDS.slice(startIndex, endIndex + 1);
}

function syncTutorialStateToBranch(tutorial, tutorialId, activeBranchId, options = {}) {
  if (!tutorial || typeof tutorial !== 'object') {
    return;
  }

  const normalizedTutorialId = String(tutorialId || FF7_TUTORIAL_ID);
  const normalizedActiveBranchId = normalizeTutorialBranchId(activeBranchId, '');
  const hasActiveBranch = Boolean(normalizedActiveBranchId);
  const activeJumpRaceId = hasActiveBranch ? getTutorialBranchRaceId(normalizedActiveBranchId, '') : '';
  const completedBranchIds = Array.from(new Set(
    (Array.isArray(options.completedBranchIds) ? options.completedBranchIds : [])
      .map((branchId) => normalizeTutorialBranchId(branchId, ''))
      .filter((branchId) => branchId && branchId !== normalizedActiveBranchId)
  ));

  tutorial.tutorials = [normalizedTutorialId];
  tutorial.tutorialGroups = hasActiveBranch
    ? Array.from(new Set([...completedBranchIds, normalizedActiveBranchId]))
    : completedBranchIds.slice();
  tutorial.tutorialGroupsCompleted = completedBranchIds.slice();
  tutorial.currentTutorialId = normalizedTutorialId;
  tutorial.currentTutorialGroupId = hasActiveBranch ? normalizedActiveBranchId : '';
  tutorial.activeTutorial = {
    tid: normalizedTutorialId,
    bid: hasActiveBranch ? normalizedActiveBranchId : ''
  };
  tutorial.largestTutorialId = Math.max(
    Number(tutorial.largestTutorialId || 0),
    FF7_TUTORIAL_DB_LTID || 1
  );
  tutorial.largestTutorialGroupId = Math.max(
    Number(tutorial.largestTutorialGroupId || 0),
    parseTutorialNumericId(normalizedActiveBranchId, 'G') || 0,
    ...completedBranchIds.map((branchId) => parseTutorialNumericId(branchId, 'G')),
    FF7_TUTORIAL_DB_LTGID || 1
  );

  tutorial.tutorialData = tutorial.tutorialData && typeof tutorial.tutorialData === 'object'
    ? tutorial.tutorialData
    : {};

  const rootNode = createTutorialBranchState(hasActiveBranch ? 1 : 2, {
    tutorialId: normalizedTutorialId,
    groupId: hasActiveBranch ? normalizedActiveBranchId : normalizedTutorialId,
    jumpRaceId: activeJumpRaceId || null,
    tutorialRunning: hasActiveBranch,
    tutorialGroupRunning: hasActiveBranch,
    tutorialGroupCompleted: !hasActiveBranch
  });

  completedBranchIds.forEach((branchId) => {
    rootNode.Branches[branchId] = createTutorialBranchState(2, {
      tutorialId: normalizedTutorialId,
      groupId: branchId,
      jumpRaceId: getTutorialBranchRaceId(branchId, ''),
      tutorialRunning: false,
      tutorialGroupRunning: false,
      tutorialGroupCompleted: true
    });
    tutorial.tutorialData[`${normalizedTutorialId}:${branchId}`] = {
      started: true,
      completed: true,
      updatedAt: nowTs()
    };
  });

  if (hasActiveBranch) {
    rootNode.Branches[normalizedActiveBranchId] = createTutorialBranchState(1, {
      tutorialId: normalizedTutorialId,
      groupId: normalizedActiveBranchId,
      jumpRaceId: activeJumpRaceId,
      tutorialRunning: true,
      tutorialGroupRunning: true,
      tutorialGroupCompleted: false
    });
  }
  rootNode.branches = rootNode.Branches;
  rootNode.Tutorials[normalizedTutorialId] = {
    tutorialID: normalizedTutorialId,
    tutorialId: normalizedTutorialId,
    tutorialGroupId: hasActiveBranch ? normalizedActiveBranchId : '',
    branchId: hasActiveBranch ? normalizedActiveBranchId : '',
    JumpToRaceID: activeJumpRaceId,
    JumpToRaceId: activeJumpRaceId,
    jumpToRaceId: activeJumpRaceId,
    JumpToRaceIds: activeJumpRaceId ? [activeJumpRaceId] : [],
    jumpToRaceIds: activeJumpRaceId ? [activeJumpRaceId] : [],
    tutorialRunning: hasActiveBranch,
    tutorialGroupRunning: hasActiveBranch,
    tutorialGroupCompleted: !hasActiveBranch,
    tutorialComplete: !hasActiveBranch,
    completed: !hasActiveBranch,
    State: hasActiveBranch ? 1 : 2,
    state: hasActiveBranch ? 1 : 2
  };
  rootNode.tutorials = rootNode.Tutorials;

  tutorial.userData = tutorial.userData && typeof tutorial.userData === 'object'
    ? tutorial.userData
    : {};
  tutorial.userData[normalizedTutorialId] = rootNode;
  if (hasActiveBranch) {
    tutorial.tutorialData[`${normalizedTutorialId}:${normalizedActiveBranchId}`] = {
      started: true,
      completed: false,
      updatedAt: nowTs()
    };
  }
}

function resolveActiveTutorialRaceId(sparx, requestedRaceId) {
  const normalizedRequestedRaceId = String(requestedRaceId || '').trim();
  const requestedBranchId = normalizedRequestedRaceId
    ? getTutorialBranchIdForRaceId(normalizedRequestedRaceId, '')
    : '';
  if (normalizedRequestedRaceId && !requestedBranchId) {
    return normalizedRequestedRaceId;
  }
  const profileState = sparx && sparx.dataStore && sparx.dataStore.profile ? sparx.dataStore.profile : {};
  if (isFreshTutorialIntroProfile(profileState)) {
    return FF7_TUTORIAL_RACE_ID;
  }
  const tutorial = sparx && sparx.tutorial ? sparx.tutorial : null;
  const startupBranchId = getStartupPlayableTutorialBranchId(
    profileState
  );
  if (startupBranchId) {
    const startupRaceId = getTutorialBranchRaceId(startupBranchId, '');
    if (startupRaceId) {
      return startupRaceId;
    }
  }
  const activeBranchId = tutorial
    ? redirectTutorialBranchId(tutorial.currentTutorialGroupId || FF7_TUTORIAL_GROUP_ID)
    : FF7_TUTORIAL_GROUP_ID;
  const activeRaceId = getTutorialBranchRaceId(activeBranchId, '');

  if (
    activeRaceId &&
    normalizedRequestedRaceId &&
    requestedBranchId &&
    normalizeTutorialBranchId(requestedBranchId, '') !== normalizeTutorialBranchId(activeBranchId, '')
  ) {
    return activeRaceId;
  }

  return normalizedRequestedRaceId || activeRaceId || FF7_TUTORIAL_RACE_ID;
}

function getProfileTutorialBranchId(profile = {}) {
  const profileRaceId = String(
    firstDefined(
      profile.crid,
      profile.jfrid,
      profile.currentRaceId,
      profile.CurrentRaceId,
      profile.current_race_id,
      ''
    )
  ).trim();
  if (!isConfiguredTutorialRaceId(profileRaceId)) {
    return '';
  }
  return normalizeTutorialBranchId(getTutorialBranchIdForRaceId(profileRaceId, ''), '');
}

function getEffectiveTutorialBranchId(tutorial = {}, profile = {}) {
  const profileCheckpoint = getProfileDrivenTutorialCheckpoint(profile);
  const activeBid = normalizeTutorialBranchId(
    firstDefined(
      tutorial.currentTutorialGroupId,
      tutorial.activeTutorial && tutorial.activeTutorial.bid,
      ''
    ),
    ''
  );
  // Check completion state first — a stale profile.tut_id must not override it.
  const firstIncompleteBranchId = getFirstIncompleteTutorialBranchId(tutorial);
  if (!firstIncompleteBranchId) {
    // All sequential branches are done — no active tutorial.
    return '';
  }
  const startupBranchId = String(profileCheckpoint.activeBranchId || '');
  if (startupBranchId) {
    const startupNumber = parseTutorialNumericId(startupBranchId, 'G');
    const activeNumber = parseTutorialNumericId(activeBid, 'G');
    if (activeBid && activeNumber >= startupNumber) {
      return redirectTutorialBranchId(activeBid);
    }
    return startupBranchId;
  }
  if (firstIncompleteBranchId) {
    const firstIncompleteNumber = parseTutorialNumericId(firstIncompleteBranchId, 'G');
    const activeNumber = parseTutorialNumericId(activeBid, 'G');
    // Keep an already-running later branch (e.g. G4 UI flow) and only advance
    // to firstIncomplete when active branch is behind it.
    if (!activeBid || (firstIncompleteNumber > 0 && activeNumber < firstIncompleteNumber)) {
      return redirectTutorialBranchId(firstIncompleteBranchId);
    }
    return redirectTutorialBranchId(activeBid);
  }
  if (!profileCheckpoint.activeBranchId && Array.isArray(profileCheckpoint.completedBranchIds) && profileCheckpoint.completedBranchIds.length > 0) {
    return '';
  }
  const profileBid = getProfileTutorialBranchId(profile);
  const completedGroups = Array.isArray(tutorial.tutorialGroupsCompleted) ? tutorial.tutorialGroupsCompleted : [];

  if (
    profileBid &&
    profileBid !== FF7_TUTORIAL_GROUP_ID &&
    (completedGroups.includes(FF7_TUTORIAL_GROUP_ID) || activeBid !== FF7_TUTORIAL_GROUP_ID)
  ) {
    return redirectTutorialBranchId(profileBid);
  }

  return redirectTutorialBranchId(activeBid || profileBid || FF7_TUTORIAL_GROUP_ID);
}

function buildTutorialChapterForRace(raceId) {
  // Use raw config so disabled races (chapter_01_a etc.) keep their correct chapterNum
  const rawRaceConfig = (ff7TutorialConfig.races && ff7TutorialConfig.races[raceId]) || {};
  const raceConfig = getTutorialRaceConfig(raceId);
  const chapterId = String(rawRaceConfig.chapterId || raceConfig.chapterId || FF7_TUTORIAL_CHAPTER_ID);
  const raceCityKey = getRaceCityKey(rawRaceConfig.raceCity ? rawRaceConfig : raceConfig, 'tokyo');
  const chapterRaces = Object.entries(ff7TutorialConfig.races || {})
    .filter(([, config]) => String(config && config.chapterId ? config.chapterId : FF7_TUTORIAL_CHAPTER_ID) === chapterId)
    .map(([mappedRaceId, config]) => ({
      name: mappedRaceId,
      type: String(config && config.raceType ? config.raceType : 'street')
    }));

  return {
    name: String(rawRaceConfig.chapterName || raceConfig.chapterName || 'Tutorial'),
    city: raceCityKey,
    status: 'started',
    count: chapterRaces.length,
    num: Number(rawRaceConfig.chapterNum != null ? rawRaceConfig.chapterNum : (raceConfig.chapterNum || 0)),
    raceInfos: chapterRaces,
    class: 0,
    redeemers: [],
    icon: '',
    gachaToken: SHIPYARD_GACHA_TOKEN
  };
}

function applyTutorialRaceProgression(profile, raceId, options = {}) {
  if (!profile || typeof profile !== 'object') return;
  const normalizedRaceId = String(raceId || '').trim();
  if (!normalizedRaceId) return;
  const raceConfig = getTutorialRaceConfig(normalizedRaceId);
  const chapterId = String(raceConfig.chapterId || FF7_TUTORIAL_CHAPTER_ID);
  const tutorialStep = Number.isFinite(options.tutId) ? Number(options.tutId) : parseTutorialNumericId(options.branchId, 'G') || Number(profile.tut_id || 1) || 1;

  profile.crid = normalizedRaceId;
  profile.jfrid = normalizedRaceId;
  profile.cmid = chapterId;
  profile.CurrentRaceId = normalizedRaceId;
  profile.currentRaceId = normalizedRaceId;
  profile.current_race_id = normalizedRaceId;
  profile.tut_id = tutorialStep;

  if (options.justFinished) {
    profile.JustFinishedRaceId = normalizedRaceId;
    profile.justFinishedRaceId = normalizedRaceId;
    profile.just_finished_race_id = normalizedRaceId;
  }

  if (options.won) {
    profile.last_story_race = normalizedRaceId;
    profile.LastWonStoryRaceID = normalizedRaceId;
    profile.lastWonStoryRaceID = normalizedRaceId;
    profile.lastWonStoryRaceId = normalizedRaceId;
  }
}

function getTutorialGarageTag() {
  return FF7_GARAGE_CAR_ID;
}

function getDefaultProfileVehicleTag() {
  return String(FF7_DEFAULT_CURRENT_CAR_ID);
}

function getDefaultOwnedVehicleTags() {
  if (!FF7_SKIP_TUTORIAL_TO_GARAGE) {
    return [];
  }
  return FF7_DEFAULT_OWNED_VEHICLE_TAGS.slice();
}

function getActiveTutorialVehicleTag(tutorial = null) {
  if (!tutorial || typeof tutorial !== 'object') return '';
  const activeTutorialId = String(
    firstDefined(
      tutorial.currentTutorialId,
      tutorial.activeTutorial && tutorial.activeTutorial.tid,
      FF7_TUTORIAL_ID
    )
  ).trim();
  const activeBranchId = normalizeTutorialBranchId(
    firstDefined(
      tutorial.currentTutorialGroupId,
      tutorial.activeTutorial && tutorial.activeTutorial.bid,
      tutorial.branchData && tutorial.branchData.branchId,
      tutorial.branchData && tutorial.branchData.tutorialGroupId,
      ''
    ),
    ''
  );
  const rootNode =
    activeTutorialId &&
    tutorial.userData &&
    typeof tutorial.userData === 'object' &&
    tutorial.userData[activeTutorialId] &&
    typeof tutorial.userData[activeTutorialId] === 'object'
      ? tutorial.userData[activeTutorialId]
      : null;
  const directRaceId = String(
    firstDefined(
      getTutorialBranchRaceId(activeBranchId, ''),
      rootNode &&
        rootNode.Tutorials &&
        rootNode.Tutorials[activeTutorialId] &&
        rootNode.Tutorials[activeTutorialId].JumpToRaceID,
      rootNode &&
        rootNode.tutorials &&
        rootNode.tutorials[activeTutorialId] &&
        rootNode.tutorials[activeTutorialId].JumpToRaceID,
      rootNode &&
        rootNode.Branches &&
        activeBranchId &&
        rootNode.Branches[activeBranchId] &&
        rootNode.Branches[activeBranchId].JumpToRaceID,
      rootNode &&
        rootNode.branches &&
        activeBranchId &&
        rootNode.branches[activeBranchId] &&
        rootNode.branches[activeBranchId].JumpToRaceID,
      ''
    )
  ).trim();
  const activeRaceId = directRaceId || resolveActiveTutorialRaceId({ tutorial }, '');
  const raceConfig = getTutorialRaceConfig(activeRaceId);
  return String(raceConfig.playerCarId || '').trim();
}

function getDesiredProfileVehicleTag(profile = {}, tutorial = null) {
  if (FF7_SKIP_TUTORIAL_TO_GARAGE) {
    return String(getDefaultProfileVehicleTag());
  }
  const tutorialVehicleTag = getActiveTutorialVehicleTag(tutorial);
  if (tutorialVehicleTag && shouldForceTutorialVehicle(profile, tutorial)) {
    return tutorialVehicleTag;
  }
  return String(
    remapGarageVehicleTag(
      profile.CurrentVehicleTag ||
      profile.currentVehicleTag ||
      getFirstOwnedVehicleTag(profile) ||
      getDefaultProfileVehicleTag(),
      getDefaultProfileVehicleTag()
    )
  );
}

function getNormalizedProfileLevel(profile = {}) {
  return Number(profile.Level || profile.level || profile.PlayerLevel || profile.Rank || 1);
}

function getNormalizedProfileXp(profile = {}) {
  return Number(profile.XP || profile.xp || 0);
}

function getNormalizedProfileMaxCars(profile = {}) {
  const ownedVehicleCount = Array.isArray(profile.OwnedVehicles)
    ? Array.from(new Set(profile.OwnedVehicles.map((tag) => String(tag || '').trim()).filter(Boolean))).length
    : 0;
  return Math.max(
    Number(
      profile.maxcars ||
      profile.maxCars ||
      profile.MaxCars ||
      profile.MaxOwnedCars ||
      0
    ),
    ownedVehicleCount
  );
}

function getFirstOwnedVehicleTag(profile = {}) {
  return Array.isArray(profile.OwnedVehicles) && profile.OwnedVehicles.length > 0
    ? String(profile.OwnedVehicles[0] || '').trim()
    : '';
}

function shouldForceTutorialVehicle(profile = {}, tutorial = null) {
  if (FF7_SKIP_TUTORIAL_TO_GARAGE) return false;
  if (!tutorial || typeof tutorial !== 'object') return false;
  if (!isIntroTutorialActive(tutorial)) return false;
  return !Array.isArray(profile.OwnedVehicles) || profile.OwnedVehicles.filter(Boolean).length === 0;
}

function getNormalizedProfileMiles(profile = {}) {
  return Number(profile.Miles || 0);
}

function buildLevelInfoPayload() {
  const levelInfo = [];
  const rankingTimeline = Array.isArray(defaultRankingsTimeline) ? defaultRankingsTimeline : [];
  const maxLevels = Math.max(rankingTimeline.length, 32);

  for (let index = 0; index < maxLevels; index += 1) {
    const rank = index + 1;
    const source = rankingTimeline[index] || {};
    levelInfo.push({
      m: String(source.icon || `rank_${rank}`),
      r: rank,
      x: Number(source.miles != null ? source.miles : index * 1000)
    });
  }

  return levelInfo;
}

function buildMapIconTogglePayload(levelInfo) {
  return levelInfo.map((entry, index) => ({
    m: entry.m,
    a: index === 0,
    u: index <= 1
  }));
}

const PERFORMANCE_CURRENT_KEYS = {
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

const PERFORMANCE_OWNED_KEYS = {
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

const PERFORMANCE_UPGRADE_CATEGORY_KEYS = [
  'balance',
  'control',
  'nos',
  'shifting',
  'topspeed',
  'weight'
];

function buildPerformanceUpgradeAttributeData(upgradeId = '') {
  return {
    id: String(upgradeId || ''),
    ipi: 0,
    tb: 0,
    fwd: 0,
    nt: 0,
    nd: 0,
    nr: 0,
    rz: 0,
    mas: 0,
    jb: 0,
    pstb: 0,
    psbd: 0,
    pdtb: 0,
    pdbd: 0,
    lcb: 0,
    dsp: 0,
    plw: 0,
    bst: 0
  };
}

function buildPerformanceUpgradeUiStats(categoryKey) {
  switch (String(categoryKey || '')) {
    case 'balance':
      return { tb: 8 };
    case 'control':
      return { bst: 0.08 };
    case 'nos':
      return { nt: 20, nd: 0.1 };
    case 'shifting':
      return { fwd: -0.02 };
    case 'topspeed':
      return { tb: 10, rz: 40 };
    case 'weight':
      return { mas: -10 };
    default:
      return {};
  }
}

function inferPerformanceUpgradeStage(status, categoryKey) {
  const normalizedStatus = status && typeof status === 'object' ? status : {};
  const persistedStages = normalizedStatus.PerformanceUpgradeStages && typeof normalizedStatus.PerformanceUpgradeStages === 'object'
    ? normalizedStatus.PerformanceUpgradeStages
    : {};
  if (persistedStages[categoryKey] != null) {
    return Math.max(0, Number(persistedStages[categoryKey]) || 0);
  }
  const rawControl = String(firstDefined(normalizedStatus.TyreId, '') || '').trim();
  const rawBalance = String(firstDefined(normalizedStatus.BrakeId, '') || '').trim();
  const rawTopSpeed = String(firstDefined(normalizedStatus.EngineCCId, '') || '').trim();
  const parseTier = (value) => {
    const match = String(value || '').match(/_(\d+)\s*$/);
    return match ? Math.max(0, Number(match[1]) - 1) : 0;
  };
  switch (String(categoryKey || '')) {
    case 'control':
      return parseTier(rawControl);
    case 'balance':
      return parseTier(rawBalance);
    case 'topspeed':
      return parseTier(rawTopSpeed);
    default:
      return 0;
  }
}

function buildPerformanceUpgradePartInfo(carRecordId, categoryKey, status = {}) {
  const currentStage = inferPerformanceUpgradeStage(status, categoryKey);
  const maxStage = 4;
  const maxProgress = 3;
  const currentProgress = maxProgress;
  const nextMaxProgress = maxProgress;
  return {
    maxStage,
    currentStage,
    minProgress: 0,
    maxProgress,
    nextMaxProgress,
    maxLevels: 12,
    currentProgress,
    ipi: 4 + currentStage * 2,
    performanceCost: 1,
    nextPerformanceCost: 1,
    up: 1,
    hc: 0,
    sc: 250 + currentStage * 150,
    tut: 0,
    nextStageLevelNeeded: 1,
    numPartsAvailable: 5,
    raceImpactData: {},
    uiStats: buildPerformanceUpgradeUiStats(categoryKey),
    carId: String(carRecordId || '')
  };
}

function buildPerformanceUpgradeInfo(carRecordId, status = {}) {
  return PERFORMANCE_UPGRADE_CATEGORY_KEYS.reduce((acc, categoryKey) => {
    acc[categoryKey] = buildPerformanceUpgradePartInfo(carRecordId, categoryKey, status);
    return acc;
  }, {});
}

function getMutablePersistedCarRecord(userId, recordId) {
  const user = getUser(userId);
  const carsRoot = user && user.sparx && user.sparx.dataStore && user.sparx.dataStore.cars;
  if (!carsRoot || typeof carsRoot !== 'object') {
    return null;
  }
  const targetId = String(recordId || '').trim();
  if (!targetId) {
    return null;
  }
  for (const bucket of Object.values(carsRoot)) {
    if (!bucket || typeof bucket !== 'object') {
      continue;
    }
    if (bucket[targetId] && typeof bucket[targetId] === 'object') {
      return bucket[targetId];
    }
  }
  return null;
}

function buildPerformanceUpgradeTransactionResult(userId, params = {}, mode = 'part') {
  const user = getUser(userId);
  const rootProfile = getProfile(userId) && typeof getProfile(userId) === 'object'
    ? getProfile(userId)
    : {};
  const dataStoreProfile =
    user &&
    user.sparx &&
    user.sparx.dataStore &&
    user.sparx.dataStore.profile &&
    typeof user.sparx.dataStore.profile === 'object'
      ? user.sparx.dataStore.profile
      : null;
  const profile = getMutableAuthoritativeSparxProfile(userId);
  const requestedCarId = String(params.carId || '').trim();
  const requestedCategory = String(params.upgradeCategory || params.category || '').trim().toLowerCase();
  const categoryKey = PERFORMANCE_UPGRADE_CATEGORY_KEYS.includes(requestedCategory)
    ? requestedCategory
    : 'topspeed';
  const resolvedRecord = resolveOwnedVehicleRecord(
    userId,
    requestedCarId,
    profile.CurrentVehicleTag || getDefaultProfileVehicleTag()
  );
  const resolvedVehicleReference = String(
    (resolvedRecord && (
      resolvedRecord.carId ||
      resolvedRecord.AssetTag ||
      resolvedRecord.assetTag ||
      resolvedRecord.CurrentVehicleTag ||
      resolvedRecord.currentVehicleTag ||
      (resolvedRecord.r && resolvedRecord.r.n) ||
      (resolvedRecord.recipe && resolvedRecord.recipe.n)
    )) ||
    profile.CurrentVehicleTag ||
    getDefaultProfileVehicleTag()
  );
  const assetTag = getAssetVehicleTag(resolvedVehicleReference, getDefaultProfileVehicleTag());
  const effectiveCarRecordId = String(
    (resolvedRecord && (resolvedRecord._id || resolvedRecord.id)) ||
    requestedCarId ||
    ''
  );

  if (!profile.OwnedVehiclesStatus || typeof profile.OwnedVehiclesStatus !== 'object') {
    profile.OwnedVehiclesStatus = {};
  }
  if (!profile.OwnedVehiclesStatus[assetTag]) {
    profile.OwnedVehiclesStatus[assetTag] = createOwnedVehicleStatus(assetTag);
  }

  const mutableStatus = profile.OwnedVehiclesStatus[assetTag];
  if (!mutableStatus.PerformanceUpgradeStages || typeof mutableStatus.PerformanceUpgradeStages !== 'object') {
    mutableStatus.PerformanceUpgradeStages = {};
  }
  const currentStage = Math.max(0, Number(mutableStatus.PerformanceUpgradeStages[categoryKey]) || 0);
  const purchaseInfo = buildPerformanceUpgradePartInfo(effectiveCarRecordId, categoryKey, mutableStatus);
  const softCost = Math.max(0, Math.trunc(Number(purchaseInfo && purchaseInfo.sc || 0)));
  const hardCost = Math.max(0, Math.trunc(Number(purchaseInfo && purchaseInfo.hc || 0)));
  const currentCoins = Math.max(0, Math.trunc(Number(profile.NoCoins || profile.coins || 0)));
  const currentStars = Math.max(0, Math.trunc(Number(profile.NoStars || profile.gold || 0)));

  if (currentCoins < softCost || currentStars < hardCost) {
    return {
      carId: effectiveCarRecordId,
      upgradeCategory: categoryKey,
      transactionComplete: false,
      transactionFailureReason: 'insufficient_funds',
      hcReplacement: hardCost,
      updatedCarState: resolvedRecord ? clone(resolvedRecord) : {},
      profile: {
        coins: currentCoins,
        stars: currentStars
      }
    };
  }

  const nextStage = Math.min(mode === 'stage' ? currentStage + 1 : currentStage + 1, 4);
  mutableStatus.PerformanceUpgradeStages[categoryKey] = nextStage;
  profile.NoCoins = currentCoins - softCost;
  profile.coins = profile.NoCoins;
  profile.NoStars = currentStars - hardCost;
  profile.gold = profile.NoStars;
  profile.stars = profile.NoStars;

  const updatedInfo = buildPerformanceUpgradePartInfo(effectiveCarRecordId, categoryKey, mutableStatus);
  const piDelta = Math.max(1, Number(updatedInfo.ipi || 0));
  const persistedRecord = getMutablePersistedCarRecord(userId, effectiveCarRecordId);
  if (persistedRecord && typeof persistedRecord === 'object') {
    persistedRecord.pi = Math.max(0, Number(persistedRecord.pi || 0) + piDelta);
  }
  if (Array.isArray(profile.cars)) {
    profile.cars = profile.cars.map((record) => (
      String(record && (record._id || record.id) || '') === effectiveCarRecordId
        ? { ...record, pi: Math.max(0, Number(record.pi || 0) + piDelta) }
        : record
    ));
  }
  if (dataStoreProfile && dataStoreProfile !== profile) {
    dataStoreProfile.OwnedVehiclesStatus = clone(profile.OwnedVehiclesStatus || {});
    dataStoreProfile.NoCoins = Number(profile.NoCoins || 0);
    dataStoreProfile.coins = Number(profile.NoCoins || 0);
    dataStoreProfile.NoStars = Number(profile.NoStars || 0);
    dataStoreProfile.gold = Number(profile.NoStars || 0);
    dataStoreProfile.stars = Number(profile.NoStars || 0);
  }
  if (rootProfile && rootProfile !== profile) {
    rootProfile.OwnedVehiclesStatus = clone(profile.OwnedVehiclesStatus || {});
    if (Array.isArray(profile.cars)) {
      rootProfile.cars = clone(profile.cars);
    }
    rootProfile.NoCoins = Number(profile.NoCoins || 0);
    rootProfile.coins = Number(profile.NoCoins || 0);
    rootProfile.NoStars = Number(profile.NoStars || 0);
    rootProfile.gold = Number(profile.NoStars || 0);
    rootProfile.stars = Number(profile.NoStars || 0);
  }

  const updatedUpgradeState = buildPerformanceUpgradesPayload(userId, {
    ...params,
    carId: effectiveCarRecordId
  });
  const updatedCarRecord = persistedRecord && typeof persistedRecord === 'object'
    ? clone(persistedRecord)
    : null;
  const asyncMessages = [
    {
      component: 'PerformanceUpgradeManager',
      message: 'upgradesUpdated',
      payload: clone(updatedUpgradeState)
    },
    {
      component: 'PerformanceUpgradeManager',
      message: 'refresh',
      payload: {
        carUpgrades: [clone(updatedUpgradeState)]
      }
    }
  ];
  if (updatedCarRecord) {
    asyncMessages.push({
      component: 'OwnedCarsManager',
      message: 'updatedCar',
      payload: clone(updatedCarRecord)
    });
  }

  persistState();

  return {
    carId: effectiveCarRecordId,
    upgradeCategory: categoryKey,
    transactionComplete: true,
    hcReplacement: hardCost,
    scCost: softCost,
    updatedCarState: updatedCarRecord ? clone(updatedCarRecord) : {},
    inventory: buildInventorySnapshotFromProfile(profile),
    profile: {
      coins: Number(profile.NoCoins || 0),
      stars: Number(profile.NoStars || 0)
    },
    async: asyncMessages
  };
}

function buildPerformanceEnvironment(options = {}) {
  return {
    aa: Number(options.aa != null ? options.aa : 0),
    aas: Number(options.aas != null ? options.aas : 100),
    aniso: Number(options.aniso != null ? options.aniso : 1),
    vc: Number(options.vc != null ? options.vc : 0),
    l: Number(options.l != null ? options.l : 100),
    hl: Number(options.hl != null ? options.hl : 0),
    rlq: Number(options.rlq != null ? options.rlq : 0),
    rl: Number(options.rl != null ? options.rl : 0),
    pq: Number(options.pq != null ? options.pq : 2),
    tq: Number(options.tq != null ? options.tq : 1),
    lfq: Number(options.lfq != null ? options.lfq : 0),
    pfxq: Number(options.pfxq != null ? options.pfxq : 0),
    pfx: Array.isArray(options.pfx) ? options.pfx.slice() : [],
    sq: Number(options.sq != null ? options.sq : 0),
    sc: Number(options.sc != null ? options.sc : 1),
    s: Boolean(options.s != null ? options.s : false),
    ui: Number(options.ui != null ? options.ui : 1),
    fe: Boolean(options.fe != null ? options.fe : false),
    aud: Number(options.aud != null ? options.aud : 0)
  };
}

function buildLegacyNamedPerformanceEnvironment(profileName, profileId, options = {}) {
  const base = buildPerformanceEnvironment(options);
  const enumLabel = {
    aa: ['Off', 'On'],
    aniso: ['Disable', 'Enable'],
    vc: ['Low', 'Medium', 'High'],
    rlq: ['Off', 'Low', 'High'],
    pq: ['Low', 'Medium', 'High'],
    tq: ['Off', 'Low', 'High'],
    lfq: ['Off', 'Low', 'High'],
    pfxq: ['Off', 'Low', 'High'],
    sq: ['Off', 'Low', 'High'],
    ui: ['SD', 'HD']
  };
  const aasLabel = {
    100: 'x1',
    200: 'x2',
    400: 'x4',
    800: 'x8'
  };

  return {
    profile: String(profileName || ''),
    name: String(profileName || ''),
    Name: String(profileName || ''),
    ProfileName: String(profileName || ''),
    _id: Number(profileId || 0),
    ProfileId: Number(profileId || 0),
    aa: enumLabel.aa[base.aa] || 'Off',
    aas: aasLabel[base.aas] || `x${Math.max(1, Math.round(base.aas / 100))}`,
    aniso: enumLabel.aniso[base.aniso] || 'Enable',
    anisotropicFiltering: enumLabel.aniso[base.aniso] || 'Enable',
    vc: enumLabel.vc[base.vc] || 'Low',
    visibilityCulling: enumLabel.vc[base.vc] || 'Low',
    l: base.l,
    lod: base.l,
    hl: base.hl,
    hiddenLayers: base.hl,
    rlq: enumLabel.rlq[base.rlq] || 'Off',
    reflectionQuality: enumLabel.rlq[base.rlq] || 'Off',
    rl: base.rl,
    reflectedLayers: base.rl,
    pq: enumLabel.pq[base.pq] || 'High',
    particleQuality: enumLabel.pq[base.pq] || 'High',
    tq: enumLabel.tq[base.tq] || 'Low',
    trailQuality: enumLabel.tq[base.tq] || 'Low',
    lfq: enumLabel.lfq[base.lfq] || 'Off',
    lensFlareQuality: enumLabel.lfq[base.lfq] || 'Off',
    pfxq: enumLabel.pfxq[base.pfxq] || 'Off',
    postFXQuality: enumLabel.pfxq[base.pfxq] || 'Off',
    pfx: Array.isArray(base.pfx) ? base.pfx.join('&') : '',
    postFX: Array.isArray(base.pfx) ? base.pfx.join('&') : '',
    sq: enumLabel.sq[base.sq] || 'Off',
    shadowQuality: enumLabel.sq[base.sq] || 'Off',
    sc: base.sc,
    shadowCount: base.sc,
    s: Boolean(base.s),
    slowDevice: Boolean(base.s),
    ui: enumLabel.ui[base.ui] || 'HD',
    uiResolution: enumLabel.ui[base.ui] || 'HD',
    fe: Boolean(base.fe),
    frontEnd: Boolean(base.fe),
    aud: Number(base.aud || 24000) || 24000,
    audioSamplingRate: Number(base.aud || 24000) || 24000,
    env: Boolean(options.env !== undefined ? options.env : true),
    environment: Boolean(options.env !== undefined ? options.env : true),
    props_primary: Boolean(options.props_primary !== undefined ? options.props_primary : true),
    props_primary_lowend: Boolean(options.props_primary_lowend !== undefined ? options.props_primary_lowend : false),
    props_secondary: Boolean(options.props_secondary !== undefined ? options.props_secondary : true),
    decal: Boolean(options.decal !== undefined ? options.decal : false),
    crowd: Boolean(options.crowd !== undefined ? options.crowd : true),
    interior: Boolean(options.interior !== undefined ? options.interior : false),
    proxy: Boolean(options.proxy !== undefined ? options.proxy : false),
    bright: Boolean(options.bright !== undefined ? options.bright : true),
    culled: Boolean(options.culled !== undefined ? options.culled : false),
    secondary_lightmaps: Boolean(options.secondary_lightmaps !== undefined ? options.secondary_lightmaps : false),
    secondaryLightmaps: Boolean(options.secondary_lightmaps !== undefined ? options.secondary_lightmaps : false)
  };
}

function buildPerformanceProfilePayload() {
  const garageEnvironment = buildLegacyNamedPerformanceEnvironment('garage', 0, {
    aa: 0,
    aas: 100,
    aniso: 1,
    vc: 1,
    l: 100,
    rlq: 0,
    pq: 2,
    tq: 1,
    lfq: 0,
    pfxq: 0,
    sq: 0,
    ui: 1,
    aud: 24000,
    env: true,
    props_primary: true,
    props_primary_lowend: false,
    props_secondary: true,
    decal: true,
    crowd: true,
    interior: true,
    proxy: false,
    bright: true,
    culled: false,
    secondary_lightmaps: false
  });
  const raceEnvironment = buildLegacyNamedPerformanceEnvironment('race', 1, {
    aa: 0,
    aas: 100,
    aniso: 1,
    vc: 1,
    l: 100,
    rlq: 0,
    pq: 2,
    tq: 1,
    lfq: 0,
    pfxq: 0,
    sq: 0,
    ui: 1,
    aud: 24000,
    env: true,
    props_primary: true,
    props_primary_lowend: false,
    props_secondary: true,
    decal: true,
    crowd: true,
    interior: false,
    proxy: false,
    bright: true,
    culled: false,
    secondary_lightmaps: false
  });
  const dragEnvironment = buildLegacyNamedPerformanceEnvironment('drag', 1, {
    aa: 0,
    aas: 100,
    aniso: 1,
    vc: 1,
    l: 100,
    rlq: 0,
    pq: 2,
    tq: 1,
    ui: 1,
    aud: 24000,
    env: true,
    props_primary: true,
    props_primary_lowend: false,
    props_secondary: true,
    decal: true,
    crowd: true,
    interior: false,
    proxy: false,
    bright: true,
    culled: false,
    secondary_lightmaps: false
  });

  // The 0.3.0 client rejects scene environment indexes >= 2 when building
  // PerformanceInfo.scenesToEnvironment, so keep live scene mappings on 0/1.
  const environments = [
    clone(garageEnvironment),
    clone(raceEnvironment)
  ];

  const scenes = [
    { name: '', env: 0 },
    { name: 'tokyo_garage', env: 0 },
    { name: 'track_tokyo_garage', env: 0 },
    { name: 'tokyo_street', env: 1 },
    { name: 'track_tokyo_street', env: 1 },
    { name: 'tokyo_street_variant_chase', env: 1 },
    { name: 'track_tokyo_street_variant_chase', env: 1 },
    { name: 'tokyo_street_variant_getawaytutorial', env: 1 },
    { name: 'track_tokyo_street_variant_getawaytutorial', env: 1 },
    { name: 'miami_street', env: 1 },
    { name: 'track_miami_street', env: 1 },
    { name: 'miami_street_variant_shortTrack', env: 1 },
    { name: 'track_miami_street_variant_shortTrack', env: 1 },
    { name: 'miami_street_variant_takedown', env: 1 },
    { name: 'track_miami_street_variant_takedown', env: 1 },
    { name: 'miami_drag', env: 1 },
    { name: 'track_miami_drag', env: 1 },
    { name: 'miami_drag_variant_quartermile', env: 1 },
    { name: 'track_miami_drag_variant_quartermile', env: 1 },
    { name: 'la_drag', env: 1 },
    { name: 'track_la_drag', env: 1 },
    { name: 'la_drag_variant_quartermile', env: 1 },
    { name: 'track_la_drag_variant_quartermile', env: 1 },
    { name: 'la_street', env: 1 },
    { name: 'track_la_street', env: 1 },
    { name: 'la_street_variant_tutorial', env: 1 },
    { name: 'track_la_street_variant_tutorial', env: 1 },
    { name: 'la_street_variant_streetgetaway', env: 1 },
    { name: 'track_la_street_variant_streetgetaway', env: 1 },
    { name: 'la_street_variant_shortTrack', env: 1 },
    { name: 'track_la_street_variant_shortTrack', env: 1 },
    { name: 'la_street_variant_mediumTrack', env: 1 },
    { name: 'track_la_street_variant_mediumTrack', env: 1 },
    { name: 'la_street_variant_fullTrack', env: 1 },
    { name: 'track_la_street_variant_fullTrack', env: 1 },
    { name: 'rio_street', env: 1 },
    { name: 'track_rio_street', env: 1 },
    { name: 'rio_drift', env: 1 },
    { name: 'track_rio_drift', env: 1 },
    { name: 'rio_drift_variant_1000m', env: 1 },
    { name: 'track_rio_drift_variant_1000m', env: 1 }
  ].map((entry) => {
    const maxEnvironmentIndex = Math.max(0, environments.length - 1);
    const normalizedEnv = Math.max(0, Math.min(Number(entry.env) || 0, maxEnvironmentIndex));
    return {
      name: String(entry.name),
      Name: String(entry.name),
      scene: String(entry.name),
      Scene: String(entry.name),
      sceneName: String(entry.name),
      SceneName: String(entry.name),
      env: normalizedEnv,
      environment: normalizedEnv,
      Environment: normalizedEnv,
      _environment: normalizedEnv,
      environmentIndex: normalizedEnv,
      EnvironmentIndex: normalizedEnv
    };
  });

  const scenesToEnvironment = {};
  scenes.forEach((entry) => {
    scenesToEnvironment[String(entry.name)] = Number(entry.env);
  });

  return {
    averageRaceFps: 60,
    averageMenuFps: 60,
    scenes: clone(scenes),
    profile: {
      name: 'android_mid',
      _id: 'android_mid',
      Garage: clone(garageEnvironment),
      Race: clone(raceEnvironment),
      Drag: clone(dragEnvironment)
    },
    ProfileName: 'android_mid',
    _id: 'android_mid',
    ProfileId: 'android_mid',
    ProfileData: {
      name: 'android_mid',
      _id: 'android_mid',
      Garage: clone(garageEnvironment),
      Race: clone(raceEnvironment),
      Drag: clone(dragEnvironment)
    },
    EnvironmentProfiles: clone(environments),
    environmentProfiles: clone(environments),
    Environments: clone(environments),
    environments: clone(environments),
    env: clone(environments),
    EnvironmentForScene: clone(scenesToEnvironment),
    environmentForScene: clone(scenesToEnvironment),
    scenesToEnvironment,
    ScenesToEnvironment: clone(scenesToEnvironment),
    sceneToEnvironment: clone(scenesToEnvironment),
    SceneToEnvironment: clone(scenesToEnvironment),
    environmentIndexForScene: clone(scenesToEnvironment),
    EnvironmentIndexForScene: clone(scenesToEnvironment),
    environmentInfoForScene: clone(scenesToEnvironment),
    EnvironmentInfoForScene: clone(scenesToEnvironment)
  };
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

function getPrefabName(record) {
  const meta = record && (record.CarMetaData || record.carMetaData || record.MetaData || record.metadata);
  return String(
    (record && record.PrefabName) ||
    (meta && meta.PrefabName) ||
    (record && record.carId) ||
    ''
  );
}

function buildRaceVuString(record) {
  const recipe = record && (record.r || record.recipe || record.Recipe);
  if (recipe && Array.isArray(recipe.vu) && recipe.vu.some((value) => Number(value) >= 0)) {
    return recipe.vu.map((value) => String(value)).join('&');
  }
  if (recipe && typeof recipe.vu === 'string' && recipe.vu.trim()) {
    return String(recipe.vu);
  }
  return '';
}

function stripRuntimeRecipeVisualUpgrades(recipe) {
  const cloned = clone(recipe || null);
  if (!cloned || typeof cloned !== 'object') {
    return cloned;
  }
  cloned.vu = [];
  return cloned;
}

function buildRacePerformanceUpgradePayload(status = {}) {
  const engineId = String(firstDefined(status.EngineCCId, '') || '').trim();
  if (!engineId) {
    return {};
  }
  return {
    id: engineId
  };
}

function buildRaceUpgradePayload(status = {}) {
  const tyreId = String(firstDefined(status.TyreId, '') || '').trim();
  const engineId = String(firstDefined(status.EngineCCId, '') || '').trim();
  return {
    balance: '',
    control: tyreId,
    nos: '',
    shifting: '',
    topspeed: engineId,
    weight: ''
  };
}

function buildRaceCarNode(record, pi) {
  const meta = record && (record.CarMetaData || record.carMetaData || record.MetaData || record.metadata);
  const recipe = clone(record && (record.r || record.recipe || record.Recipe || null));
  const currentVehicleTag = String((record && record.carId) || '');
  const activeCarId = String((record && (record._id || record.id || record.carId)) || '');
  const vehicleStatus = clone(
    (record && (record.vehicleStatus || record.VehicleStatus)) ||
    createOwnedVehicleStatus(currentVehicleTag)
  );
  return {
    n: currentVehicleTag,
    Tag: String((record && (record.Tag || record.tag)) || (meta && (meta.Tag || meta.tag)) || ''),
    tag: String((record && (record.tag || record.Tag)) || (meta && (meta.tag || meta.Tag)) || ''),
    AssetTag: String((record && (record.AssetTag || record.assetTag || record.carId)) || (meta && meta.AssetTag) || ''),
    assetTag: String((record && (record.assetTag || record.AssetTag || record.carId)) || (meta && meta.AssetTag) || ''),
    _id: activeCarId,
    id: activeCarId,
    uid: String((record && (record.uid || record.userId)) || ''),
    pi: Number(pi || 0),
    pu: clone((record && record.pu) || buildRacePerformanceUpgradePayload(vehicleStatus)),
    vu: buildRaceVuString(record),
    up: clone((record && record.up) || buildRaceUpgradePayload(vehicleStatus)),
    car: currentVehicleTag,
    carId: currentVehicleTag,
    CurrentVehicleTag: currentVehicleTag,
    currentVehicleTag,
    activeCarId,
    active_carid: activeCarId,
    active_recipe: Number((recipe && recipe.hash) || 0),
    r: clone(recipe),
    recipe: clone(recipe),
    Recipe: clone(recipe),
    CarMetaData: clone(meta || null),
    carMetaData: clone(meta || null),
    vehicleStatus,
    VehicleStatus: clone(vehicleStatus)
  };
}

function buildRaceCarsContainer(playerRecord, opponentRecord, playerPi = 0, opponentPi = 0) {
  const playerNode = buildRaceCarNode(playerRecord, playerPi);
  const opponentNode = buildRaceCarNode(opponentRecord, opponentPi);
  return {
    player: playerNode,
    Player: clone(playerNode),
    opponent: opponentNode,
    Opponent: clone(opponentNode)
  };
}

function buildTutorialRuntimeCarNode(node) {
  if (!node || typeof node !== 'object') {
    return {};
  }
  const recipe = stripRuntimeRecipeVisualUpgrades(node.r || node.recipe || node.Recipe || null);
  const meta = clone(
    node.CarMetaData ||
    node.carMetaData ||
    node.MetaData ||
    node.metadata ||
    null
  );
  const vehicleStatus = clone(
    node.vehicleStatus ||
    node.VehicleStatus ||
    createOwnedVehicleStatus(String(node.carId || node.car || node.n || ''))
  );
  return {
    n: String(node.n || node.carId || node.CurrentVehicleTag || ''),
    pi: Number(node.pi || 0),
    pu: clone(node.pu || buildRacePerformanceUpgradePayload(vehicleStatus)),
    vu: String(node.vu || ''),
    up: clone(node.up || buildRaceUpgradePayload(vehicleStatus)),
    car: String(node.car || node.carId || node.n || ''),
    carId: String(node.carId || node.car || node.n || ''),
    CurrentVehicleTag: String(node.CurrentVehicleTag || node.currentVehicleTag || node.carId || node.n || ''),
    currentVehicleTag: String(node.currentVehicleTag || node.CurrentVehicleTag || node.carId || node.n || ''),
    _id: String(node._id || node.id || ''),
    id: String(node.id || node._id || ''),
    uid: String(node.uid || ''),
    activeCarId: String(node.activeCarId || node.active_carid || node._id || node.id || ''),
    active_carid: String(node.active_carid || node.activeCarId || node._id || node.id || ''),
    active_recipe: Number(node.active_recipe || 0),
    Tag: String(node.Tag || node.tag || node.AssetTag || node.assetTag || node.carId || node.n || ''),
    tag: String(node.tag || node.Tag || node.assetTag || node.AssetTag || node.carId || node.n || ''),
    AssetTag: String(node.AssetTag || node.assetTag || node.carId || node.n || ''),
    assetTag: String(node.assetTag || node.AssetTag || node.carId || node.n || ''),
    AttributeTag: String(node.AttributeTag || (meta && meta.AttributeTag) || ''),
    PrefabName: String(node.PrefabName || (meta && meta.PrefabName) || ''),
    carPrefabPath: String(node.carPrefabPath || (meta && meta.carPrefabPath) || ''),
    carModelAttributePath: String(node.carModelAttributePath || (meta && meta.carModelAttributePath) || ''),
    r: clone(recipe),
    recipe: clone(recipe),
    Recipe: clone(recipe),
    CarMetaData: clone(meta),
    carMetaData: clone(meta),
    MetaData: clone(meta),
    metadata: clone(meta),
    carData: clone(node.carData || node.PlayerCarData || node.OpponentCarData || null),
    vehicleStatus: clone(vehicleStatus),
    VehicleStatus: clone(vehicleStatus)
  };
}

function buildTutorialRuntimeCarsContainer(cars) {
  const playerNode = buildTutorialRuntimeCarNode(cars && (cars.player || cars.Player));
  const opponentNode = buildTutorialRuntimeCarNode(cars && (cars.opponent || cars.Opponent));
  return {
    player: playerNode,
    Player: clone(playerNode),
    opponent: opponentNode,
    Opponent: clone(opponentNode)
  };
}

function buildTutorialLoginCarMeta(meta) {
  const source = clone(meta || {});
  if (!source || typeof source !== 'object') return null;
  return {
    ...source,
    Tag: String(source.Tag || source.tag || source.AssetTag || ''),
    tag: String(source.tag || source.Tag || source.AssetTag || ''),
    AssetTag: String(source.AssetTag || source.Tag || source.tag || ''),
    AttributeTag: String(source.AttributeTag || ''),
    PrefabName: String(source.PrefabName || ''),
    carPrefabPath: String(source.carPrefabPath || ''),
    carModelAttributePath: String(source.carModelAttributePath || source.cpp || ''),
    cpp: String(source.cpp || source.carModelAttributePath || ''),
    tbp: String(source.tbp || ''),
    cty: String(source.cty || ''),
    dvu: String(source.dvu || ''),
    fn: String(source.fn || source.Name || source.name || '')
  };
}

function buildTutorialLoginCarNode(node) {
  if (!node || typeof node !== 'object') return {};
  const source = clone(node);
  const recipe = clone(source.r || source.recipe || source.Recipe || null);
  const meta = buildTutorialLoginCarMeta(
    source.CarMetaData ||
    source.carMetaData ||
    source.MetaData ||
    source.metadata ||
    null
  );
  const vehicleStatus = clone(
    source.vehicleStatus ||
    source.VehicleStatus ||
    createOwnedVehicleStatus(String(source.carId || source.car || source.n || ''))
  );
  return {
    ...(meta && typeof meta === 'object' ? clone(meta) : {}),
    ...source,
    n: String(source.n || source.carId || source.CurrentVehicleTag || ''),
    pi: Number(source.pi || 0),
    pu: clone(source.pu || buildRacePerformanceUpgradePayload(vehicleStatus)),
    vu: String(source.vu || ''),
    up: clone(source.up || buildRaceUpgradePayload(vehicleStatus)),
    car: String(source.car || source.carId || source.n || ''),
    carId: String(source.carId || source.car || source.n || ''),
    CurrentVehicleTag: String(source.CurrentVehicleTag || source.currentVehicleTag || source.carId || source.n || ''),
    currentVehicleTag: String(source.currentVehicleTag || source.CurrentVehicleTag || source.carId || source.n || ''),
    _id: String(source._id || source.id || ''),
    id: String(source.id || source._id || ''),
    uid: String(source.uid || ''),
    activeCarId: String(source.activeCarId || source.active_carid || source._id || source.id || ''),
    active_carid: String(source.active_carid || source.activeCarId || source._id || source.id || ''),
    active_recipe: Number(source.active_recipe || 0),
    Tag: String(source.Tag || source.tag || source.AssetTag || source.assetTag || source.carId || source.n || ''),
    tag: String(source.tag || source.Tag || source.AssetTag || source.assetTag || source.carId || source.n || ''),
    AssetTag: String(source.AssetTag || source.assetTag || source.carId || source.n || ''),
    AttributeTag: String(source.AttributeTag || (meta && meta.AttributeTag) || ''),
    PrefabName: String(source.PrefabName || (meta && meta.PrefabName) || ''),
    carPrefabPath: String(source.carPrefabPath || (meta && meta.carPrefabPath) || ''),
    carModelAttributePath: String(source.carModelAttributePath || (meta && meta.carModelAttributePath) || ''),
    r: clone(recipe),
    recipe: clone(recipe),
    Recipe: clone(recipe),
    vehicleStatus: clone(vehicleStatus),
    VehicleStatus: clone(vehicleStatus),
    CarMetaData: clone(meta),
    carMetaData: clone(meta),
    MetaData: clone(meta),
    metadata: clone(meta)
  };
}

function buildTutorialLoginCarsContainer(cars) {
  const playerNode = buildTutorialLoginCarNode(cars && (cars.player || cars.Player));
  const opponentNode = buildTutorialLoginCarNode(cars && (cars.opponent || cars.Opponent));
  return {
    player: playerNode,
    Player: clone(playerNode),
    opponent: opponentNode,
    Opponent: clone(opponentNode)
  };
}

function buildEmptyNextRacesPayload() {
  return {
    raceData: [],
    chapterData: [],
    simMultipliers: {}
  };
}

function buildCompletedTutorialMirrorResult({
  tutorial,
  tutorialDbPayload,
  profileProgress,
  userData = {},
  tutorialDataMap = {},
  tutorialGroups = [],
  tutorialGroupsCompleted = []
} = {}) {
  const effectiveTutorialDbHash = String(
    firstDefined(
      tutorialDbPayload && tutorialDbPayload.dbhash,
      tutorial && tutorial.dbHash,
      FF7_TUTORIAL_DB_HASH
    ) || FF7_TUTORIAL_DB_HASH
  );
  const emptyNextRaces = buildEmptyNextRacesPayload();
  const completedBranchStates = Array.from(new Set(
    (Array.isArray(tutorialGroupsCompleted) ? tutorialGroupsCompleted : []).filter(Boolean)
  )).reduce((acc, branchId) => {
    acc[String(branchId)] = 2;
    return acc;
  }, {});
  const completedBranchData = createTutorialBranchState(2, {
    tutorialId: FF7_TUTORIAL_ID,
    groupId: '',
    jumpRaceId: null,
    tutorialRunning: false,
    tutorialGroupRunning: false,
    tutorialGroupCompleted: true
  });
  const completedTutorialState = buildSparxTutorialUserDataShape('', 2, completedBranchStates);
  const tutorialDataList = Object.entries(tutorialDataMap || {}).map(([key, value]) => ({
    key,
    ...(clone(value) || {})
  }));
  return {
    api: Number(firstDefined(tutorial && tutorial.api, 1) || 1),
    dbHash: effectiveTutorialDbHash,
    hash: effectiveTutorialDbHash,
    changed: true,
    refresh: true,
    check: 'uhtotallysecure',
    connected: true,
    status: 'connected',
    branchData: clone(completedBranchData),
    stateHash: effectiveTutorialDbHash,
    state1Hash: effectiveTutorialDbHash,
    state2Hash: effectiveTutorialDbHash,
    JumpToRaceID: '',
    JumpToRaceIds: [],
    currentTutorialId: FF7_TUTORIAL_ID,
    currentTutorialGroupId: '',
    largestTutorialId: Number(firstDefined(tutorial && tutorial.largestTutorialId, FF7_TUTORIAL_DB_LTID) || FF7_TUTORIAL_DB_LTID),
    largestTutorialGroupId: Number(firstDefined(tutorial && tutorial.largestTutorialGroupId, FF7_TUTORIAL_DB_LTGID) || FF7_TUTORIAL_DB_LTGID),
    tutorials: [FF7_TUTORIAL_ID],
    tutorialGroups: Array.isArray(tutorialGroups) ? tutorialGroups.slice() : [],
    tutorialGroupsCompleted: Array.isArray(tutorialGroupsCompleted) ? tutorialGroupsCompleted.slice() : [],
    activeTutorial: { tid: FF7_TUTORIAL_ID, bid: '' },
    ltid: Number(firstDefined(tutorialDbPayload && tutorialDbPayload.ltid, FF7_TUTORIAL_DB_LTID) || FF7_TUTORIAL_DB_LTID),
    ltgid: Number(firstDefined(tutorialDbPayload && tutorialDbPayload.ltgid, FF7_TUTORIAL_DB_LTGID) || FF7_TUTORIAL_DB_LTGID),
    dbhash: String(firstDefined(tutorialDbPayload && tutorialDbPayload.dbhash, effectiveTutorialDbHash) || effectiveTutorialDbHash),
    nextRaces: clone(emptyNextRaces),
    raceData: [],
    chapterData: [],
    simMultipliers: {},
    progression: buildGarageTutorialProgression(profileProgress),
    tutorialData: tutorialDataList,
    tutorialDataList,
    tutorialDataMap: clone(tutorialDataMap),
    tutorialDataByKey: clone(tutorialDataMap),
    tutorialDb: clone(tutorialDbPayload || {}),
    TutorialUserData: clone(userData || {}),
    userData: clone(userData || {}),
    tut: {
      [FF7_TUTORIAL_ID]: clone(completedTutorialState)
    },
    data: {
      tutorialId: FF7_TUTORIAL_ID,
      branchId: '',
      branchData: clone(completedBranchData),
      stateHash: effectiveTutorialDbHash,
      state1Hash: effectiveTutorialDbHash,
      state2Hash: effectiveTutorialDbHash,
      userData: clone(userData || {}),
      branches: {},
      currentTutorialId: FF7_TUTORIAL_ID,
      currentTutorialGroupId: '',
      largestTutorialId: Number(firstDefined(tutorial && tutorial.largestTutorialId, FF7_TUTORIAL_DB_LTID) || FF7_TUTORIAL_DB_LTID),
      largestTutorialGroupId: Number(firstDefined(tutorial && tutorial.largestTutorialGroupId, FF7_TUTORIAL_DB_LTGID) || FF7_TUTORIAL_DB_LTGID),
      tutorials: [FF7_TUTORIAL_ID],
      tutorialGroups: Array.isArray(tutorialGroups) ? tutorialGroups.slice() : [],
      tutorialGroupsCompleted: Array.isArray(tutorialGroupsCompleted) ? tutorialGroupsCompleted.slice() : [],
      activeTutorial: { tid: FF7_TUTORIAL_ID, bid: '' },
      raceData: [],
      chapterData: [],
      nextRaces: clone(emptyNextRaces)
    },
    branches: {},
    [FF7_TUTORIAL_ID]: clone(completedTutorialState)
  };
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

function buildGarageTutorialProgression(profile = {}) {
  const progressionSeed = buildGarageCareerProgressionSeed(profile);
  const wonRaces = clone(progressionSeed.wonRaces || {});
  const nextRaceId = String(progressionSeed.nextRaceId || '').trim();
  const chapterId = String(progressionSeed.chapterId || 'chapter_01').trim() || 'chapter_01';
  const lastStoryRaceId = String(progressionSeed.lastStoryRaceId || 'chapter_01_c').trim() || 'chapter_01_c';
  return {
    won_races: wonRaces,
    lost_races: profile.lost_races && typeof profile.lost_races === 'object' ? clone(profile.lost_races) : {},
    last_story_race: lastStoryRaceId,
    crid: nextRaceId,
    jfrid: nextRaceId,
    cmid: chapterId,
    tut_id: getCompletedTutorialStepValue(),
    CurrentRaceId: nextRaceId,
    currentRaceId: nextRaceId,
    current_race_id: nextRaceId,
    JustFinishedRaceId: lastStoryRaceId,
    justFinishedRaceId: lastStoryRaceId,
    just_finished_race_id: lastStoryRaceId,
    LastWonStoryRaceID: lastStoryRaceId,
    lastWonStoryRaceID: lastStoryRaceId,
    lastWonStoryRaceId: lastStoryRaceId
  };
}

function getGarageProfileProgressionAliases(profile = {}) {
  const normalized = buildGarageTutorialProgression(profile);
  return {
    won_races: clone((profile && typeof profile.won_races === 'object' ? profile.won_races : normalized.won_races) || {}),
    lost_races: clone((profile && typeof profile.lost_races === 'object' ? profile.lost_races : normalized.lost_races) || {}),
    last_story_race: String(firstDefined(profile.last_story_race, normalized.last_story_race, '') || ''),
    crid: String(firstDefined(profile.crid, normalized.crid, '') || ''),
    jfrid: String(firstDefined(profile.jfrid, normalized.jfrid, '') || ''),
    cmid: String(firstDefined(profile.cmid, normalized.cmid, 'chapter_01') || 'chapter_01'),
    tut_id: Number(firstDefined(profile.tut_id, normalized.tut_id, getCompletedTutorialStepValue()) || getCompletedTutorialStepValue()),
    CurrentRaceId: String(firstDefined(profile.CurrentRaceId, normalized.CurrentRaceId, '') || ''),
    currentRaceId: String(firstDefined(profile.currentRaceId, normalized.currentRaceId, '') || ''),
    current_race_id: String(firstDefined(profile.current_race_id, normalized.current_race_id, '') || ''),
    JustFinishedRaceId: String(firstDefined(profile.JustFinishedRaceId, normalized.JustFinishedRaceId, '') || ''),
    justFinishedRaceId: String(firstDefined(profile.justFinishedRaceId, normalized.justFinishedRaceId, '') || ''),
    just_finished_race_id: String(firstDefined(profile.just_finished_race_id, normalized.just_finished_race_id, '') || ''),
    LastWonStoryRaceID: String(firstDefined(profile.LastWonStoryRaceID, normalized.LastWonStoryRaceID, '') || ''),
    lastWonStoryRaceID: String(firstDefined(profile.lastWonStoryRaceID, normalized.lastWonStoryRaceID, '') || ''),
    lastWonStoryRaceId: String(firstDefined(profile.lastWonStoryRaceId, normalized.lastWonStoryRaceId, '') || '')
  };
}

function buildFreshTutorialProgression() {
  return {
    won_races: {},
    lost_races: {},
    last_story_race: '',
    crid: FF7_TUTORIAL_RACE_ID,
    jfrid: FF7_TUTORIAL_RACE_ID,
    cmid: FF7_TUTORIAL_CHAPTER_ID,
    tut_id: 1,
    CurrentRaceId: FF7_TUTORIAL_RACE_ID,
    currentRaceId: FF7_TUTORIAL_RACE_ID,
    current_race_id: FF7_TUTORIAL_RACE_ID,
    JustFinishedRaceId: '',
    justFinishedRaceId: '',
    just_finished_race_id: '',
    LastWonStoryRaceID: '',
    lastWonStoryRaceID: '',
    lastWonStoryRaceId: ''
  };
}

function applyEarlyTutorialCheckpointProfile(profile, activeBranchId) {
  if (!profile || typeof profile !== 'object') return false;
  const normalizedBranchId = normalizeTutorialBranchId(activeBranchId, '');
  if (!normalizedBranchId) return false;

  const before = JSON.stringify({
    won_races: profile.won_races || {},
    lost_races: profile.lost_races || {},
    last_story_race: profile.last_story_race || '',
    crid: profile.crid || '',
    jfrid: profile.jfrid || '',
    cmid: profile.cmid || '',
    tut_id: Number(profile.tut_id || 0),
    CurrentRaceId: profile.CurrentRaceId || '',
    currentRaceId: profile.currentRaceId || '',
    current_race_id: profile.current_race_id || '',
    JustFinishedRaceId: profile.JustFinishedRaceId || '',
    justFinishedRaceId: profile.justFinishedRaceId || '',
    just_finished_race_id: profile.just_finished_race_id || '',
    LastWonStoryRaceID: profile.LastWonStoryRaceID || '',
    lastWonStoryRaceID: profile.lastWonStoryRaceID || '',
    lastWonStoryRaceId: profile.lastWonStoryRaceId || ''
  });

  if (normalizedBranchId === 'G1') {
    Object.assign(profile, buildFreshTutorialProgression());
  } else {
    const activeIndex = FF7_TUTORIAL_BRANCH_IDS.indexOf(normalizedBranchId);
    const activeRaceId = getTutorialBranchRaceId(normalizedBranchId, '');
    let previousRaceId = '';

    if (activeRaceId) {
      for (let index = activeIndex - 1; index >= 0; index -= 1) {
        const raceId = getTutorialBranchRaceId(FF7_TUTORIAL_BRANCH_IDS[index], '');
        if (raceId) {
          previousRaceId = raceId;
          break;
        }
      }
    } else {
      previousRaceId = getLastCompletedTutorialRaceId(profile);
    }

    const activeRaceConfig = activeRaceId ? getTutorialRaceConfig(activeRaceId) : null;
    const previousRaceConfig = previousRaceId ? getTutorialRaceConfig(previousRaceId) : null;

    profile.crid = activeRaceId;
    profile.jfrid = activeRaceId;
    profile.cmid = String(
      (activeRaceConfig && activeRaceConfig.chapterId) ||
      (previousRaceConfig && previousRaceConfig.chapterId) ||
      profile.cmid ||
      FF7_TUTORIAL_CHAPTER_ID
    );
    profile.tut_id = parseTutorialNumericId(normalizedBranchId, 'G') || Number(profile.tut_id || 0) || 1;
    profile.CurrentRaceId = activeRaceId;
    profile.currentRaceId = activeRaceId;
    profile.current_race_id = activeRaceId;
    profile.last_story_race = previousRaceId;
    profile.JustFinishedRaceId = previousRaceId;
    profile.justFinishedRaceId = previousRaceId;
    profile.just_finished_race_id = previousRaceId;
    profile.LastWonStoryRaceID = previousRaceId;
    profile.lastWonStoryRaceID = previousRaceId;
    profile.lastWonStoryRaceId = previousRaceId;
  }

  const after = JSON.stringify({
    won_races: profile.won_races || {},
    lost_races: profile.lost_races || {},
    last_story_race: profile.last_story_race || '',
    crid: profile.crid || '',
    jfrid: profile.jfrid || '',
    cmid: profile.cmid || '',
    tut_id: Number(profile.tut_id || 0),
    CurrentRaceId: profile.CurrentRaceId || '',
    currentRaceId: profile.currentRaceId || '',
    current_race_id: profile.current_race_id || '',
    JustFinishedRaceId: profile.JustFinishedRaceId || '',
    justFinishedRaceId: profile.justFinishedRaceId || '',
    just_finished_race_id: profile.just_finished_race_id || '',
    LastWonStoryRaceID: profile.LastWonStoryRaceID || '',
    lastWonStoryRaceID: profile.lastWonStoryRaceID || '',
    lastWonStoryRaceId: profile.lastWonStoryRaceId || ''
  });

  return before !== after;
}

function isIntroTutorialActive(tutorial = {}) {
  if (FF7_SKIP_TUTORIAL_TO_GARAGE) return false;
  const completedGroups = Array.isArray(tutorial.tutorialGroupsCompleted) ? tutorial.tutorialGroupsCompleted : [];
  return !completedGroups.includes(FF7_TUTORIAL_GROUP_ID);
}

function syncTutorialVehicleProfile(profile, tutorial = null) {
  if (!profile || typeof profile !== 'object') return false;

  const tutorialVehicleTag = getActiveTutorialVehicleTag(tutorial);
  const forceTutorialVehicle = tutorialVehicleTag && shouldForceTutorialVehicle(profile, tutorial);
  const freshTutorialIntro = isFreshTutorialIntroProfile(profile);
  const currentOwnedVehicles = Array.isArray(profile.OwnedVehicles) ? profile.OwnedVehicles.slice() : [];
  const fallbackOwnedVehicles = getDefaultOwnedVehicleTags();
  const desiredOwnedVehicles = FF7_SKIP_TUTORIAL_TO_GARAGE
    ? (currentOwnedVehicles.length > 0 ? currentOwnedVehicles.slice() : fallbackOwnedVehicles.slice())
    : currentOwnedVehicles.slice();
  let changed = false;

  if (freshTutorialIntro) {
    desiredOwnedVehicles.length = 0;
  } else if (forceTutorialVehicle) {
    const normalizedTutorialVehicleTag = String(tutorialVehicleTag);
    const existingIndex = desiredOwnedVehicles.indexOf(normalizedTutorialVehicleTag);
    if (existingIndex !== -1) {
      desiredOwnedVehicles.splice(existingIndex, 1);
    }
    desiredOwnedVehicles.unshift(normalizedTutorialVehicleTag);
  } else if (desiredOwnedVehicles.length === 0) {
    desiredOwnedVehicles.push.apply(desiredOwnedVehicles, fallbackOwnedVehicles);
  }

  if (JSON.stringify(currentOwnedVehicles) !== JSON.stringify(desiredOwnedVehicles)) {
    profile.OwnedVehicles = desiredOwnedVehicles.slice();
    changed = true;
  }

  const currentStatuses = profile.OwnedVehiclesStatus && typeof profile.OwnedVehiclesStatus === 'object'
    ? profile.OwnedVehiclesStatus
    : {};
  const desiredStatuses = desiredOwnedVehicles.reduce((acc, tag) => {
    acc[tag] = clone(currentStatuses[tag] || createOwnedVehicleStatus(tag));
    return acc;
  }, {});
  if (JSON.stringify(currentStatuses) !== JSON.stringify(desiredStatuses)) {
    profile.OwnedVehiclesStatus = desiredStatuses;
    changed = true;
  }

  const desiredCurrentVehicle = forceTutorialVehicle
    ? String(tutorialVehicleTag)
    : String(
        remapGarageVehicleTag(
          profile.CurrentVehicleTag ||
          profile.currentVehicleTag ||
          desiredOwnedVehicles[0] ||
          getDefaultProfileVehicleTag(),
          getDefaultProfileVehicleTag()
        )
      );
  if (profile.CurrentVehicleTag !== desiredCurrentVehicle) {
    profile.CurrentVehicleTag = desiredCurrentVehicle;
    changed = true;
  }

  if (profile.currentVehicleTag !== desiredCurrentVehicle) {
    profile.currentVehicleTag = desiredCurrentVehicle;
    changed = true;
  }

  const desiredUsingOwnedVehicle = !freshTutorialIntro && desiredOwnedVehicles.length > 0;
  if (profile.UsingOwnedVehicle !== desiredUsingOwnedVehicle) {
    profile.UsingOwnedVehicle = desiredUsingOwnedVehicle;
    changed = true;
  }

  return changed;
}

function getTutorialStateForUser(userId) {
  const user = getUser(userId);
  return user && user.sparx && user.sparx.tutorial && typeof user.sparx.tutorial === 'object'
    ? user.sparx.tutorial
    : null;
}

function getAuthoritativeSparxProfile(userId) {
  const rootProfile = normalizeProfileResourceAliases(clone(getProfile(userId) || {}));
  const user = getUser(userId);
  const dataStoreProfile =
    user &&
    user.sparx &&
    user.sparx.dataStore &&
    user.sparx.dataStore.profile &&
    typeof user.sparx.dataStore.profile === 'object'
      ? normalizeProfileResourceAliases(clone(user.sparx.dataStore.profile))
      : {};
  const dataStoreCarsRoot =
    user &&
    user.sparx &&
    user.sparx.dataStore &&
    user.sparx.dataStore.cars &&
    typeof user.sparx.dataStore.cars === 'object'
      ? user.sparx.dataStore.cars
      : {};
  const tutorialState = getTutorialStateForUser(userId);
  const merged = Object.assign({}, rootProfile, dataStoreProfile);
  const preferredRecordId = String(firstDefined(
    merged.lastRequestedCarId,
    merged.LastRequestedCarId,
    merged.active_carid,
    merged.activeCarId,
    ''
  ) || '').trim();
  const preferredTag = normalizeProfileVehicleTag(
    firstDefined(
      merged.CurrentVehicleTag,
      merged.currentVehicleTag,
      ''
    ),
    ''
  );
  let selectedRecord = null;

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
      if ((preferredRecordId && recordId === preferredRecordId) || (preferredTag && recordTag === preferredTag)) {
        selectedRecord = clone(record);
        return true;
      }
      return false;
    });
  });

  if (selectedRecord) {
    const selectedTag = normalizeProfileVehicleTag(
      firstDefined(
        selectedRecord.AssetTag,
        selectedRecord.assetTag,
        selectedRecord.carId,
        selectedRecord.car,
        selectedRecord.CurrentVehicleTag,
        selectedRecord.currentVehicleTag,
        selectedRecord.r && selectedRecord.r.n,
        selectedRecord.recipe && selectedRecord.recipe.n,
        ''
      ),
      ''
    );
    const selectedId = String(firstDefined(selectedRecord._id, selectedRecord.id, '') || '').trim();
    const selectedRecipe = Number(firstDefined(
      selectedRecord.active_recipe,
      selectedRecord.r && selectedRecord.r.hash,
      selectedRecord.recipe && selectedRecord.recipe.hash,
      0
    ) || 0);
    if (selectedTag) {
      merged.CurrentVehicleTag = selectedTag;
      merged.currentVehicleTag = selectedTag;
    }
    if (selectedId) {
      merged.active_carid = selectedId;
      merged.activeCarId = selectedId;
      merged.lastRequestedCarId = selectedId;
      merged.LastRequestedCarId = selectedId;
    }
    if (selectedRecipe) {
      merged.active_recipe = selectedRecipe;
    }
  }
  const desiredVehicleTag = getDesiredProfileVehicleTag(merged, tutorialState);

  if (tutorialState && (isIntroTutorialActive(tutorialState) || desiredVehicleTag)) {
    syncTutorialVehicleProfile(merged, tutorialState);
  } else if (desiredVehicleTag) {
    merged.CurrentVehicleTag = desiredVehicleTag;
    merged.currentVehicleTag = desiredVehicleTag;
  }

  const freshTutorialIntro = isFreshTutorialIntroProfile(merged);
  if (freshTutorialIntro) {
    merged.OwnedVehicles = [];
    merged.OwnedVehiclesStatus = {};
    merged.UsingOwnedVehicle = false;
  } else if (!Array.isArray(merged.OwnedVehicles) || merged.OwnedVehicles.length === 0) {
    merged.OwnedVehicles = desiredVehicleTag ? [desiredVehicleTag] : getDefaultOwnedVehicleTags();
  }

  if (!freshTutorialIntro && desiredVehicleTag && merged.OwnedVehicles.indexOf(desiredVehicleTag) === -1) {
    merged.OwnedVehicles.unshift(desiredVehicleTag);
  }

  return normalizeProfileResourceAliases(merged);
}

function getMutableAuthoritativeSparxProfile(userId) {
  const user = getUser(userId);
  if (
    user &&
    user.sparx &&
    user.sparx.dataStore &&
    user.sparx.dataStore.profile &&
    typeof user.sparx.dataStore.profile === 'object'
  ) {
    return normalizeProfileResourceAliases(user.sparx.dataStore.profile);
  }
  const rootProfile = getProfile(userId);
  if (rootProfile && typeof rootProfile === 'object') {
    return normalizeProfileResourceAliases(rootProfile);
  }
  return {};
}

function forceTutorialProgressionProfile(profile) {
  if (!profile || typeof profile !== 'object') return false;
  const normalized = buildFreshTutorialProgression();
  const snapshot = JSON.stringify({
    won_races: profile.won_races || {},
    lost_races: profile.lost_races || {},
    last_story_race: profile.last_story_race || '',
    crid: profile.crid || '',
    jfrid: profile.jfrid || '',
    cmid: profile.cmid || '',
    tut_id: Number(profile.tut_id || 0),
    CurrentRaceId: profile.CurrentRaceId || '',
    currentRaceId: profile.currentRaceId || '',
    current_race_id: profile.current_race_id || '',
    JustFinishedRaceId: profile.JustFinishedRaceId || '',
    justFinishedRaceId: profile.justFinishedRaceId || '',
    just_finished_race_id: profile.just_finished_race_id || '',
    LastWonStoryRaceID: profile.LastWonStoryRaceID || '',
    lastWonStoryRaceID: profile.lastWonStoryRaceID || '',
    lastWonStoryRaceId: profile.lastWonStoryRaceId || ''
  });
  const desiredSnapshot = JSON.stringify(normalized);
  if (snapshot === desiredSnapshot) {
    return false;
  }
  Object.assign(profile, normalized);
  return true;
}

function buildTutorialDbPayload() {
  const payload = clone(FF7_NORMALIZED_TUTORIAL_DB);
  payload.dbhash = crypto.createHash('md5').update(JSON.stringify(payload.data || payload)).digest('hex');

  return payload;
}

function buildDisabledTutorialDbPayload() {
  return {
    ltid: 0,
    ltgid: 0,
    dbhash: FF7_TUTORIAL_DB_HASH,
    data: {
      SEQUENTIAL: [],
      CONTEXTUAL: []
    }
  };
}

function nowTs() {
  return Math.floor(Date.now() / 1000);
}

function isSparxApiPath(pathname) {
  return SPARX_PREFIXES.some((prefix) => pathname === prefix || pathname.startsWith(prefix + '/'));
}

function wrapResult(result) {
  return {
    ts: nowTs(),
    err: null,
    error: null,
    success: true,
    successful: true,
    sucessful: true,
    result,
    hashtable: clone(result)
  };
}

function wrapSparseResult(result) {
  return {
    ts: nowTs(),
    err: null,
    error: null,
    success: true,
    successful: true,
    sucessful: true,
    result
  };
}

function wrapResultWithMirrors(result, keys) {
  const payload = wrapResult(result);
  const mirrorKeys = new Set(keys || []);
  Object.keys(result || {}).forEach((key) => {
    if (key === FF7_TUTORIAL_ID || /^G\d+$/i.test(String(key || ''))) {
      mirrorKeys.add(key);
    }
  });
  mirrorKeys.forEach((key) => {
    if (result && Object.prototype.hasOwnProperty.call(result, key)) {
      payload[key] = clone(result[key]);
    }
  });
  return payload;
}

function wrapSparseResultWithMirrors(result, keys) {
  const payload = wrapSparseResult(result);
  (keys || []).forEach((key) => {
    if (result && Object.prototype.hasOwnProperty.call(result, key)) {
      payload[key] = clone(result[key]);
    }
  });
  return payload;
}

function wrapConnectedResult(result, keys) {
  return wrapResultWithMirrors(
    {
      connected: true,
      status: 'connected',
      ...(result && typeof result === 'object' ? result : { value: result })
    },
    ['connected', 'status'].concat(keys || [])
  );
}

function wrapSparseConnectedResult(result, keys) {
  return wrapSparseResultWithMirrors(
    {
      connected: true,
      status: 'connected',
      ...(result && typeof result === 'object' ? result : { value: result })
    },
    ['connected', 'status'].concat(keys || [])
  );
}

function sleepSync(ms) {
  const waitMs = Math.max(0, Math.trunc(Number(ms || 0)));
  if (waitMs <= 0) {
    return;
  }
  const signal = new Int32Array(new SharedArrayBuffer(4));
  Atomics.wait(signal, 0, 0, waitMs);
}

function buildWebViewConfigureResult() {
  return {
    enabled: false,
    tabs: [],
    defaultTab: '',
    initialTab: '',
    url: '',
    hasNativeSupport: false
  };
}

function mergeDeep(base, patch) {
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) {
    return base;
  }

  Object.keys(patch).forEach((key) => {
    const value = patch[key];
    if (Array.isArray(value)) {
      base[key] = value.slice();
      return;
    }
    if (value && typeof value === 'object') {
      if (!base[key] || typeof base[key] !== 'object' || Array.isArray(base[key])) {
        base[key] = {};
      }
      mergeDeep(base[key], value);
      return;
    }
    base[key] = value;
  });

  return base;
}

function getUser(userId) {
  return userService.getUserState(userId);
}

function getProfile(userId) {
  return userService.getProfile(userId);
}

function getPublicHttpBaseUrl() {
  return `http://${config.getPublicHttpAddress()}`;
}

function getPublicWsUrl() {
  return `ws://${config.getPublicHttpAddress()}/push/token`;
}

function getPublicWssUrl() {
  return `wss://${config.getPublicHttpAddress()}/push/token`;
}

function buildInventorySnapshotFromProfile(profile = {}, inventorySeed = {}) {
  const result = Object.keys(inventorySeed || {}).reduce((acc, key) => {
    const value = inventorySeed[key];
    if (value == null) {
      return acc;
    }
    if (typeof value === 'number' || typeof value === 'string' || typeof value === 'boolean') {
      acc[key] = value;
    }
    return acc;
  }, {
    sc: profile.NoCoins || 0,
    hc: profile.NoStars || 0,
    xp: getNormalizedProfileXp(profile),
    fuel: profile.Fuel || 0
  });

  const maxCars = getNormalizedProfileMaxCars(profile);
  const maxMechanics = getNormalizedProfileMaxMechanics(profile);
  if (maxCars > 0) {
    result.maxcars = maxCars;
  }
  if (maxMechanics > 0) {
    result.maxmechanics = maxMechanics;
  }

  if (profile.IsVIP) {
    result.premium_account = nowTs() + 86400 * 30;
  }

  return result;
}

function buildFlatInventoryResult(userId) {
  const profile = getProfile(userId);
  const inventory = ensureSparxInventoryRoot(userId);
  return buildInventorySnapshotFromProfile(profile, inventory);
}

function getNormalizedProfileMaxMechanics(profile = {}) {
  return Math.max(
    1,
    Math.trunc(Number(
      profile.maxmechanics ||
      profile.maxMechanics ||
      profile.MaxMechanics ||
      profile.MaxOwnedMechanics ||
      2
    ) || 2)
  );
}

function ensureSparxInventoryRoot(userId) {
  const sparx = ensureSparxState(userId);
  if (!sparx.dataStore || typeof sparx.dataStore !== 'object') {
    sparx.dataStore = {};
  }
  if (!sparx.dataStore.inventory || typeof sparx.dataStore.inventory !== 'object' || Array.isArray(sparx.dataStore.inventory)) {
    sparx.dataStore.inventory = {};
  }
  const inventory = sparx.dataStore.inventory;
  const profile = getProfile(userId);
  const normalized = buildInventorySnapshotFromProfile(profile, inventory);
  Object.keys(normalized).forEach((key) => {
    inventory[key] = normalized[key];
  });
  return inventory;
}

function applyRedeemersToInventory(userId, redeemers = []) {
  const inventory = ensureSparxInventoryRoot(userId);
  (Array.isArray(redeemers) ? redeemers : []).forEach((entry) => {
    if (!entry || typeof entry !== 'object') {
      return;
    }
    const type = String(firstDefined(entry.type, entry.Type, entry.t, '') || '').trim().toLowerCase();
    const data = String(firstDefined(entry.data, entry.Data, entry.n, '') || '').trim();
    const quantity = Math.max(
      0,
      Math.trunc(Number(firstDefined(entry.q, entry.quantity, entry.Quantity, 0) || 0))
    );
    if (!data || quantity <= 0) {
      return;
    }
    if (type === 'inv' || type === 'res') {
      inventory[data] = Math.max(0, Math.trunc(Number(inventory[data] || 0))) + quantity;
    }
  });
  return buildInventorySnapshotFromProfile(getProfile(userId), inventory);
}

function getInventoryItemCount(userId, itemId) {
  const inventory = ensureSparxInventoryRoot(userId);
  const normalizedItemId = String(itemId || '').trim();
  if (!normalizedItemId) {
    return 0;
  }
  return Math.max(0, Math.trunc(Number(inventory[normalizedItemId] || 0)));
}

function setInventoryItemCount(userId, itemId, quantity) {
  const inventory = ensureSparxInventoryRoot(userId);
  const normalizedItemId = String(itemId || '').trim();
  if (!normalizedItemId) {
    return 0;
  }
  const normalizedQuantity = Math.max(0, Math.trunc(Number(quantity || 0)));
  if (normalizedQuantity > 0) {
    inventory[normalizedItemId] = normalizedQuantity;
  } else {
    delete inventory[normalizedItemId];
  }
  return normalizedQuantity;
}

function addInventoryItemCount(userId, itemId, quantity) {
  return setInventoryItemCount(
    userId,
    itemId,
    getInventoryItemCount(userId, itemId) + Math.max(0, Math.trunc(Number(quantity || 0)))
  );
}

function spendInventoryItemCount(userId, itemId, quantity) {
  const normalizedQuantity = Math.max(0, Math.trunc(Number(quantity || 0)));
  if (normalizedQuantity <= 0) {
    return true;
  }
  const currentQuantity = getInventoryItemCount(userId, itemId);
  if (currentQuantity < normalizedQuantity) {
    return false;
  }
  setInventoryItemCount(userId, itemId, currentQuantity - normalizedQuantity);
  return true;
}

function getPrimaryCarRecordId(profile) {
  const activeVehicle = String((profile && profile.CurrentVehicleTag) || getDefaultProfileVehicleTag());
  const assetTag = String(vehicleAssetAliases[activeVehicle] || activeVehicle);
  return assetTag;
}

function getProfileUidValue(profile, fallbackUserId) {
  return String((profile && (profile.uid || profile.id || profile.userId)) || fallbackUserId || '1001');
}

function getAssetVehicleTag(value, fallbackTag) {
  const normalizedTag = normalizeVehicleTag(value, fallbackTag);
  return String(vehicleAssetAliases[normalizedTag] || normalizedTag || fallbackTag || getDefaultProfileVehicleTag());
}

function getCanonicalVehicleTag(value, fallbackTag) {
  const normalizedTag = normalizeVehicleTag(value, fallbackTag);
  if (defaultVehicleDescriptions[normalizedTag]) {
    return String(normalizedTag || fallbackTag || getDefaultProfileVehicleTag());
  }
  const matchedShortTag = Object.keys(vehicleAssetAliases).find((shortTag) => vehicleAssetAliases[shortTag] === normalizedTag);
  return String(matchedShortTag || normalizedTag || fallbackTag || getDefaultProfileVehicleTag());
}

function normalizeVehicleTag(value, fallbackTag) {
  const raw = String(value || '').trim().replace(/^car_attribute_/, '');
  if (!raw) return String(fallbackTag || getDefaultProfileVehicleTag());
  if (/^[0-9a-f]{24}$/i.test(raw)) {
    return String(fallbackTag || getDefaultProfileVehicleTag());
  }
  const recordMatch = raw.match(/^car-\d+-(.+)$/);
  return recordMatch ? String(recordMatch[1] || fallbackTag || getDefaultProfileVehicleTag()) : raw;
}

function normalizeProfileVehicleTag(value, fallbackTag = getDefaultProfileVehicleTag()) {
  return normalizeVehicleTag(value, fallbackTag);
}

function remapGarageVehicleTag(value, fallbackTag) {
  const normalized = normalizeVehicleTag(value, fallbackTag || getTutorialGarageTag());
  if (FF7_SKIP_TUTORIAL_TO_GARAGE && FF7_LEGACY_GARAGE_CAR_IDS.indexOf(String(normalized)) !== -1) {
    return String(getTutorialGarageTag());
  }
  return String(vehicleAssetAliases[String(normalized)] || normalized || fallbackTag || getTutorialGarageTag());
}

function findSelectedDataStoreCarRecord(dataStore = {}) {
  const profile = dataStore && dataStore.profile && typeof dataStore.profile === 'object'
    ? dataStore.profile
    : {};
  const carsRoot = dataStore && dataStore.cars && typeof dataStore.cars === 'object'
    ? dataStore.cars
    : {};
  const preferredRecordId = String(firstDefined(
    profile.lastRequestedCarId,
    profile.LastRequestedCarId,
    profile.active_carid,
    profile.activeCarId,
    ''
  ) || '').trim();
  const preferredTag = normalizeProfileVehicleTag(
    firstDefined(
      profile.CurrentVehicleTag,
      profile.currentVehicleTag,
      ''
    ),
    ''
  );
  let selectedRecord = null;

  Object.values(carsRoot).some((bucket) => {
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
      if ((preferredRecordId && recordId === preferredRecordId) || (preferredTag && recordTag === preferredTag)) {
        selectedRecord = clone(record);
        return true;
      }
      return false;
    });
  });

  return selectedRecord;
}

function syncDataStoreProfileSelectedCar(dataStore = {}, rootProfile = null) {
  const profile = dataStore && dataStore.profile && typeof dataStore.profile === 'object'
    ? dataStore.profile
    : null;
  if (!profile) {
    return false;
  }

  const selectedRecord = findSelectedDataStoreCarRecord(dataStore);
  if (!selectedRecord) {
    return false;
  }

  const selectedTag = remapGarageVehicleTag(
    firstDefined(
      selectedRecord.AssetTag,
      selectedRecord.assetTag,
      selectedRecord.carId,
      selectedRecord.car,
      selectedRecord.CurrentVehicleTag,
      selectedRecord.currentVehicleTag,
      selectedRecord.r && selectedRecord.r.n,
      selectedRecord.recipe && selectedRecord.recipe.n,
      ''
    ),
    getDefaultProfileVehicleTag()
  );
  const selectedId = String(firstDefined(selectedRecord._id, selectedRecord.id, '') || '').trim();
  const selectedRecipe = Number(firstDefined(
    selectedRecord.active_recipe,
    selectedRecord.r && selectedRecord.r.hash,
    selectedRecord.recipe && selectedRecord.recipe.hash,
    0
  ) || 0);
  let changed = false;

  const applyTarget = (target) => {
    if (!target || typeof target !== 'object') return;
    if (selectedTag && target.CurrentVehicleTag !== selectedTag) {
      target.CurrentVehicleTag = selectedTag;
      changed = true;
    }
    if (selectedTag && target.currentVehicleTag !== selectedTag) {
      target.currentVehicleTag = selectedTag;
      changed = true;
    }
    if (selectedId && target.active_carid !== selectedId) {
      target.active_carid = selectedId;
      changed = true;
    }
    if (selectedId && target.activeCarId !== selectedId) {
      target.activeCarId = selectedId;
      changed = true;
    }
    if (selectedId && target.lastRequestedCarId !== selectedId) {
      target.lastRequestedCarId = selectedId;
      changed = true;
    }
    if (selectedId && target.LastRequestedCarId !== selectedId) {
      target.LastRequestedCarId = selectedId;
      changed = true;
    }
    if (selectedRecipe && Number(target.active_recipe || 0) !== selectedRecipe) {
      target.active_recipe = selectedRecipe;
      changed = true;
    }
  };

  applyTarget(profile);
  applyTarget(rootProfile);

  if (selectedRecord && typeof selectedRecord === 'object') {
    dataStore.car = clone(selectedRecord);
    changed = true;
  }

  return changed;
}

function resolveOwnedVehicleRecord(userId, value, fallbackTag) {
  const raw = String(value || '').trim();
  if (!raw) {
    return null;
  }

  const profile = getProfile(userId);
  const ownerUid = getProfileUidValue(profile, userId);
  const user = getUser(userId);
  const tutorialState =
    user && user.sparx && user.sparx.tutorial && typeof user.sparx.tutorial === 'object'
      ? user.sparx.tutorial
      : null;
  const candidates = [];
  const carsRoot = buildCarsRoot(userId);

  Object.values(carsRoot || {}).forEach((bucket) => {
    if (!bucket || typeof bucket !== 'object') {
      return;
    }
    Object.values(bucket).forEach((record) => {
      if (record && typeof record === 'object') {
        candidates.push(record);
      }
    });
  });

  [
    getDesiredProfileVehicleTag(profile, tutorialState || {}),
    profile.CurrentVehicleTag,
    fallbackTag,
    getDefaultProfileVehicleTag(),
    FF7_TUTORIAL_PLAYER_CAR_ID,
    'ford_mustang_gt_2015'
  ].filter(Boolean).forEach((tag, index) => {
    candidates.push(buildOwnedCarRecord(tag, ownerUid, index));
  });

  const target = raw.toLowerCase();
  return candidates.find((record) => (
    [
      record && record._id,
      record && record.id,
      record && record.carId,
      record && record.car,
      record && record.CurrentVehicleTag,
      record && record.currentVehicleTag,
      record && record.AssetTag,
      record && record.assetTag,
      record && record.Tag,
      record && record.tag,
      record && record.r && record.r.n,
      record && record.recipe && record.recipe.n,
      record && record.Recipe && record.Recipe.n,
      record && record.carData && record.carData.carId,
      record && record.carData && record.carData.CurrentVehicleTag
    ].some((candidate) => String(candidate || '').trim().toLowerCase() === target)
  )) || null;
}

function getPreferredRacePlayerLookupValue(userId, params = {}, profileOverride = null) {
  const sparx = ensureSparxState(userId);
  const profile = profileOverride || getAuthoritativeSparxProfile(userId) || {};
  return String(firstDefined(
    params && (params.activeCarId || params.active_carid),
    params && (params.lastRequestedCarId || params.LastRequestedCarId),
    params && (params.carId || params.playerCarId || params.car),
    sparx && sparx.dataStore && sparx.dataStore.profile && (
      sparx.dataStore.profile.lastRequestedCarId ||
      sparx.dataStore.profile.LastRequestedCarId
    ),
    sparx && sparx.dataStore && sparx.dataStore.profile && (
      sparx.dataStore.profile.active_carid ||
      sparx.dataStore.profile.activeCarId
    ),
    profile && (profile.lastRequestedCarId || profile.LastRequestedCarId),
    profile && (profile.active_carid || profile.activeCarId),
    profile && (profile.CurrentVehicleTag || profile.currentVehicleTag),
    ''
  ) || '').trim();
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

function buildAttributeName(tag) {
  const assetTag = String(tag || '').replace(/^car_attribute_/i, '').trim();
  return `car_attribute_${assetTag}`;
}

function buildCarMetaPayload(tag) {
  const canonicalTag = getCanonicalVehicleTag(tag, getDefaultProfileVehicleTag());
  const assetTag = String(vehicleAssetAliases[canonicalTag] || canonicalTag);
  const vehicle = defaultVehicleDescriptions[canonicalTag] || defaultVehicleDescriptions[assetTag] || {};
  const recipeArrays = getDefaultRecipeArrays(assetTag);
  const metaTemplate = getVehicleMetaTemplate(assetTag);
  const defaultStatus = createOwnedVehicleStatus(assetTag);
  const manufacturer = String(assetTag.split('_')[0] || canonicalTag.split('_')[0] || 'nissan');
  const isTrafficVehicle = assetTag.startsWith('traffic_');
  const prefabName = String(metaTemplate.PrefabName || (isTrafficVehicle ? assetTag : `car_part_${assetTag}_a`));
  const prefabRoot = String(metaTemplate.PartPathRoot || (isTrafficVehicle ? 'vehicles/trafficvehicles/' : `Bundles/cars/base/assets/parts/unique/${manufacturer}/`));
  const attributePath = String(metaTemplate.cpp || (isTrafficVehicle ? `vehicles/trafficvehicles/${assetTag}` : `Bundles/cars/base/assets/attributes/stock/car_attribute_${assetTag}`));
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
    PrefabName: prefabName,
    carPrefabPath: String(metaTemplate.carPrefabPath || `${prefabRoot}${prefabName}`),
    PartPathRoot: prefabRoot,
    carModelAttributePath: attributePath,
    cpp: attributePath,
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
    pi: canonicalPi,
    PerformanceClass: String(vehicle.PerformanceClass || 'C'),
    ClassType: String(vehicle.ClassType || 'Street'),
    BasePISS: Number(vehicle.BasePISS || canonicalPi || 0),
    tcc: Number(metaTemplate.tcc || canonicalCondition.tcc || 1000),
    CanUseDriftTyres: Boolean(vehicle.CanUseDriftTyres),
    CanUseOffRoadTyres: Boolean(vehicle.CanUseOffRoadTyres)
  };
}

function buildVisualUpgradeHash(name) {
  return ff7FNV32(String(name || '').trim());
}

function buildOwnedVisualUpgradeInventory(recipeVu = []) {
  const inventory = new Set();

  (Array.isArray(recipeVu) ? recipeVu : []).forEach((entry) => {
    const numericEntry = Number(entry);
    if (Number.isFinite(numericEntry) && numericEntry > 0) {
      inventory.add(Math.trunc(numericEntry));
    }
  });

  return Array.from(inventory);
}

function normalizeVisualUpgradeArray(values, fallbackValues = []) {
  const fallback = Array.isArray(fallbackValues) ? fallbackValues.slice() : [];
  if (!Array.isArray(values) || values.length !== fallback.length) {
    return fallback;
  }
  const normalized = values.map((value, index) => {
    const numericValue = Number(value);
    if (!Number.isFinite(numericValue)) {
      return Number(fallback[index] || 0);
    }
    return Math.trunc(numericValue);
  });
  const fallbackHasMeaningfulValues = fallback.some((value) => Number(value || 0) !== 0);
  const normalizedAllZero = normalized.every((value) => Number(value || 0) === 0);
  if (fallbackHasMeaningfulValues && normalizedAllZero) {
    return fallback;
  }
  return normalized;
}

function sanitizeOwnedVehicleStatus(assetTag, rawStatus = null) {
  const stockStatus = createOwnedVehicleStatus(assetTag);
  if (!rawStatus || typeof rawStatus !== 'object') {
    return clone(stockStatus);
  }

  const status = {
    ...clone(stockStatus),
    ...clone(rawStatus)
  };

  const normalizeOptions = (candidate, fallback) => {
    const base = Array.isArray(candidate) && candidate.length > 0 ? candidate : fallback;
    return Array.from(new Set((Array.isArray(base) ? base : []).map((entry) => String(entry || '').trim()).filter(Boolean)));
  };

  const normalizeChoice = (choice, options, fallbackChoice) => {
    const normalizedOptions = Array.isArray(options) ? options : [];
    const normalizedChoice = String(choice || '').trim();
    if (normalizedChoice && normalizedOptions.includes(normalizedChoice)) {
      return normalizedChoice;
    }
    return String(fallbackChoice || normalizedOptions[0] || '');
  };

  const normalizeHealthArray = (candidate, fallback) => {
    if (!Array.isArray(candidate) || candidate.length !== fallback.length) {
      return fallback.slice();
    }
    return candidate.map((value, index) => {
      const numericValue = Number(value);
      if (!Number.isFinite(numericValue)) {
        return Number(fallback[index] || 1);
      }
      return Math.max(0, Math.min(1, numericValue));
    });
  };

  status.OwnedTyreOptions = normalizeOptions(status.OwnedTyreOptions, stockStatus.OwnedTyreOptions);
  status.OwnedBrakeOptions = normalizeOptions(status.OwnedBrakeOptions, stockStatus.OwnedBrakeOptions);
  status.EngineCCOptions = normalizeOptions(status.EngineCCOptions, stockStatus.EngineCCOptions);
  status.IntakeOptions = normalizeOptions(status.IntakeOptions, stockStatus.IntakeOptions);
  status.EngineMapOptions = normalizeOptions(status.EngineMapOptions, stockStatus.EngineMapOptions);
  status.CamshaftOptions = normalizeOptions(status.CamshaftOptions, stockStatus.CamshaftOptions);
  status.CylinderHeadOptions = normalizeOptions(status.CylinderHeadOptions, stockStatus.CylinderHeadOptions);
  status.ExhaustOptions = normalizeOptions(status.ExhaustOptions, stockStatus.ExhaustOptions);
  status.ChassisOptions = normalizeOptions(status.ChassisOptions, stockStatus.ChassisOptions);
  status.FinalDriveOptions = normalizeOptions(status.FinalDriveOptions, stockStatus.FinalDriveOptions);
  status.AeroOptions = normalizeOptions(status.AeroOptions, stockStatus.AeroOptions);
  status.OwnedOilOptions = normalizeOptions(status.OwnedOilOptions, stockStatus.OwnedOilOptions);
  status.OwnedAlloyOptions = normalizeOptions(status.OwnedAlloyOptions, stockStatus.OwnedAlloyOptions);
  status.OwnedGlassStyles = normalizeOptions(status.OwnedGlassStyles, stockStatus.OwnedGlassStyles);
  status.OwnedLicensePlates = normalizeOptions(status.OwnedLicensePlates, stockStatus.OwnedLicensePlates);
  status.OwnedPaintJobs = normalizeOptions(status.OwnedPaintJobs, stockStatus.OwnedPaintJobs);
  status.OwnedSteeringWheelCovers = normalizeOptions(status.OwnedSteeringWheelCovers, stockStatus.OwnedSteeringWheelCovers);
  status.OwnedSteeringWheels = normalizeOptions(status.OwnedSteeringWheels, stockStatus.OwnedSteeringWheels);
  status.OwnedToys = normalizeOptions(status.OwnedToys, stockStatus.OwnedToys);
  status.OwnedTuningBundles = normalizeOptions(status.OwnedTuningBundles, stockStatus.OwnedTuningBundles);

  status.TyreId = normalizeChoice(status.TyreId, status.OwnedTyreOptions, stockStatus.TyreId);
  status.BrakeId = normalizeChoice(status.BrakeId, status.OwnedBrakeOptions, stockStatus.BrakeId);
  status.EngineCCId = normalizeChoice(status.EngineCCId, status.EngineCCOptions, stockStatus.EngineCCId);
  status.IntakeId = normalizeChoice(status.IntakeId, status.IntakeOptions, stockStatus.IntakeId);
  status.EngineMapId = normalizeChoice(status.EngineMapId, status.EngineMapOptions, stockStatus.EngineMapId);
  status.CamshaftId = normalizeChoice(status.CamshaftId, status.CamshaftOptions, stockStatus.CamshaftId);
  status.CylinderHeadId = normalizeChoice(status.CylinderHeadId, status.CylinderHeadOptions, stockStatus.CylinderHeadId);
  status.ExhaustId = normalizeChoice(status.ExhaustId, status.ExhaustOptions, stockStatus.ExhaustId);
  status.ChassisId = normalizeChoice(status.ChassisId, status.ChassisOptions, stockStatus.ChassisId);
  status.FinalDriveId = normalizeChoice(status.FinalDriveId, status.FinalDriveOptions, stockStatus.FinalDriveId);
  status.AeroId = normalizeChoice(status.AeroId, status.AeroOptions, stockStatus.AeroId);
  status.OilId = normalizeChoice(status.OilId, status.OwnedOilOptions, stockStatus.OilId);
  status.AlloyId = normalizeChoice(status.AlloyId, status.OwnedAlloyOptions, stockStatus.AlloyId);
  status.GlassStyleId = normalizeChoice(status.GlassStyleId, status.OwnedGlassStyles, stockStatus.GlassStyleId);
  status.LicensePlateId = normalizeChoice(status.LicensePlateId, status.OwnedLicensePlates, stockStatus.LicensePlateId);
  status.PaintJobId = normalizeChoice(status.PaintJobId, status.OwnedPaintJobs, stockStatus.PaintJobId);
  status.SteeringWheelCoverId = normalizeChoice(status.SteeringWheelCoverId, status.OwnedSteeringWheelCovers, stockStatus.SteeringWheelCoverId);
  status.SteeringWheelId = normalizeChoice(status.SteeringWheelId, status.OwnedSteeringWheels, stockStatus.SteeringWheelId);
  status.WaxId = String(status.WaxId || stockStatus.WaxId || '#default_wax');
  status.TyreHealth = normalizeHealthArray(status.TyreHealth, stockStatus.TyreHealth);
  status.BrakeHealth = normalizeHealthArray(status.BrakeHealth, stockStatus.BrakeHealth);
  status.BodyworkHealth = Math.max(0, Math.min(1, Number(status.BodyworkHealth || stockStatus.BodyworkHealth || 1)));
  status.EngineHealth = Math.max(0, Math.min(1, Number(status.EngineHealth || stockStatus.EngineHealth || 1)));
  status.OilHealth = Math.max(0, Math.min(1, Number(status.OilHealth || stockStatus.OilHealth || 1)));
  status.ConfigurationIndex = Number.isFinite(Number(status.ConfigurationIndex))
    ? Math.max(0, Math.trunc(Number(status.ConfigurationIndex)))
    : Number(stockStatus.ConfigurationIndex || 0);
  status.PISS = Number.isFinite(Number(status.PISS))
    ? Math.max(0, Math.trunc(Number(status.PISS)))
    : Number(stockStatus.PISS || 0);
  status.FittedToys = status.FittedToys && typeof status.FittedToys === 'object'
    ? clone(status.FittedToys)
    : clone(stockStatus.FittedToys || {});

  return status;
}

let cachedDynamicVisualUpgradeNames = null;
let cachedDynamicVisualUpgradeSourceKey = '';

function readVisualUpgradeNamesFromFile(filePath) {
  if (!filePath || !fs.existsSync(filePath)) {
    return [];
  }
  try {
    const raw = fs.readFileSync(filePath, 'utf8');
    return Array.from(
      new Set(
        String(raw || '')
          .match(/vu_[A-Za-z0-9_]+/g) || []
      )
    );
  } catch (error) {
    return [];
  }
}

function getDynamicVisualUpgradeNames() {
  const candidateFiles = [
    path.resolve(__dirname, '../../data/bugs.json'),
    path.resolve(__dirname, '../../data/requests.log')
  ];
  const sourceKey = candidateFiles
    .map((filePath) => {
      try {
        const stats = fs.statSync(filePath);
        return `${filePath}:${stats.mtimeMs}:${stats.size}`;
      } catch (error) {
        return `${filePath}:missing`;
      }
    })
    .join('|');

  if (Array.isArray(cachedDynamicVisualUpgradeNames) && cachedDynamicVisualUpgradeSourceKey === sourceKey) {
    return cachedDynamicVisualUpgradeNames.slice();
  }

  const discovered = new Set();

  candidateFiles.forEach((filePath) => {
    readVisualUpgradeNamesFromFile(filePath).forEach((name) => {
      const normalized = String(name || '').trim();
      if (!normalized || normalized.startsWith('vu_icon_') || normalized === 'vu_token') {
        return;
      }
      discovered.add(normalized);
    });
  });

  FF7_REQUIRED_DYNAMIC_VU_NAMES.forEach((name) => {
    const normalized = String(name || '').trim();
    if (normalized) {
      discovered.add(normalized);
    }
  });

  const dynamicVehicleTags = new Set();
  Object.keys(defaultVehicleDescriptions || {}).forEach((tag) => {
    const assetTag = getAssetVehicleTag(tag, '');
    if (assetTag) {
      dynamicVehicleTags.add(assetTag);
    }
  });
  Object.keys(vehicleMetaTemplates || {}).forEach((tag) => {
    const assetTag = getAssetVehicleTag(tag, '');
    if (assetTag) {
      dynamicVehicleTags.add(assetTag);
    }
  });
  dynamicVehicleTags.forEach((assetTag) => {
    ['001', '002', '003'].forEach((variant) => {
      discovered.add(`vu_${assetTag}_bodykit_aero_${variant}_s1_a`);
    });
    discovered.add(`vu_${assetTag}_bodykit_oem_a`);
  });

  cachedDynamicVisualUpgradeNames = Array.from(discovered).sort();
  cachedDynamicVisualUpgradeSourceKey = sourceKey;
  return cachedDynamicVisualUpgradeNames.slice();
}

function buildStockRewardCarRecord(tag, ownerUid, index, existingRecord = null) {
  const stockStatus = createStockOwnedVehicleStatus(tag);
  const baseRecord = buildOwnedCarRecord(tag, ownerUid, index, stockStatus);
  const defaultRecipe = clone(
    baseRecord.r ||
    baseRecord.recipe ||
    baseRecord.Recipe ||
    {}
  );
  const sourceRecipe = clone(
    (existingRecord && (existingRecord.r || existingRecord.recipe || existingRecord.Recipe)) ||
    defaultRecipe ||
    {}
  );
  const stockRecipe = {
    ...defaultRecipe,
    ...sourceRecipe,
    pc: String(baseRecord.carId || baseRecord.car || sourceRecipe.pc || ''),
    n: String(baseRecord.carId || baseRecord.car || sourceRecipe.n || ''),
    p: Array.isArray(sourceRecipe.p) ? sourceRecipe.p.slice() : clone(defaultRecipe.p || new Array(14).fill(0)),
    vu: normalizeVisualUpgradeArray(sourceRecipe.vu, defaultRecipe.vu || new Array(15).fill(0)),
    eu: Array.isArray(sourceRecipe.eu) ? sourceRecipe.eu.slice() : clone(defaultRecipe.eu || new Array(9).fill(0)),
    ut: Array.isArray(sourceRecipe.ut) ? sourceRecipe.ut.slice() : clone(defaultRecipe.ut || new Array(9).fill(0))
  };
  const stockMeta = clone(baseRecord.CarMetaData || baseRecord.MetaData || baseRecord.metadata || {});
  const stockDefaultVisualUpgrade = String(
    firstDefined(
      stockMeta.defaultVisualUpgrade,
      stockMeta.dvu,
      Array.isArray(stockRecipe.vu) ? stockRecipe.vu.map((value) => String(value)).join('&') : '',
      ''
    ) || ''
  );
  stockMeta.defaultVisualUpgrade = stockDefaultVisualUpgrade;
  stockMeta.dvu = stockDefaultVisualUpgrade;

  const recordId = String(
    firstDefined(existingRecord && (existingRecord._id || existingRecord.id), baseRecord._id, baseRecord.id, '') || ''
  );

  return {
    ...clone(existingRecord || {}),
    ...baseRecord,
    _id: recordId || baseRecord._id,
    id: recordId || baseRecord.id,
    dvu: clone(stockRecipe.vu || []),
    inv: buildOwnedVisualUpgradeInventory(stockRecipe.vu || []),
    defaultVisualUpgrade: stockDefaultVisualUpgrade,
    recipe: clone(stockRecipe),
    Recipe: clone(stockRecipe),
    r: clone(stockRecipe),
    vehicleStatus: clone(stockStatus),
    VehicleStatus: clone(stockStatus),
    pu: buildRacePerformanceUpgradePayload(stockStatus),
    up: buildRaceUpgradePayload(stockStatus),
    CarMetaData: clone(stockMeta),
    MetaData: clone(stockMeta),
    metadata: clone(stockMeta)
  };
}

function buildOwnedCarRecord(tag, ownerUid, index, vehicleStatusOverride = null) {
  const canonicalTag = getCanonicalVehicleTag(tag, getDefaultProfileVehicleTag());
  const assetTag = String(vehicleAssetAliases[canonicalTag] || canonicalTag);
  const recordId = createOwnedVehicleRecordId(ownerUid, assetTag, index);
  const recipeArrays = getDefaultRecipeArrays(assetTag);
  const quarterMileMap = {
    gtr_r34: 12.8,
    nissan_skyline_gtr_bnr34_2002: 12.8,
    mx5_na: 15.2,
    supra_mk4: 12.2,
    bmw_1m_coupe: 12.9,
    nissan_gtr_r35_2007: 10.66,
    nissan_gtr_r35_2007_bensopra_ff6: 10.66,
    ff_police_sedan_tokyo_01: 12.9,
    ford_mustang_gt_2015: 11.6,
    ford_gran_torino_1972_ff4: 14.9,
    ford_gran_torino_1972: 14.9,
    ford_torino_1972gran: 14.9,
    honda_civic_euro_2012: 15.1,
    traffic_sedan_compact_01_a: 16.4,
    traffic_suv_compact_01_a: 16.8,
    traffic_truck_medium_box_01_a: 18.5,
    traffic_sedan_compact_01_cinematic: 16.4
  };
  const classMap = {
    gtr_r34: 1,
    nissan_skyline_gtr_bnr34_2002: 1,
    mx5_na: 0,
    supra_mk4: 2,
    bmw_1m_coupe: 1,
    nissan_gtr_r35_2007: 4,
    nissan_gtr_r35_2007_bensopra_ff6: 4,
    ff_police_sedan_tokyo_01: 2,
    ford_mustang_gt_2015: 2,
    ford_gran_torino_1972_ff4: 0,
    ford_gran_torino_1972: 0,
    ford_torino_1972gran: 0,
    honda_civic_euro_2012: 1,
    traffic_sedan_compact_01_a: 0,
    traffic_suv_compact_01_a: 0,
    traffic_truck_medium_box_01_a: 0,
    traffic_sedan_compact_01_cinematic: 0
  };
  const quarterMile = quarterMileMap[canonicalTag] || 13.5;
  const recipeHash = computeRecipeHash(assetTag);
  const recipe = {
    c: classMap[canonicalTag] || 0,
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
    hash: recipeHash
  };
  const meta = buildCarMetaPayload(canonicalTag);
  const vehicleStatus = clone(
    vehicleStatusOverride && typeof vehicleStatusOverride === 'object'
      ? vehicleStatusOverride
      : createOwnedVehicleStatus(assetTag)
  );
  const pi = getCanonicalVehiclePi(assetTag, vehicleStatus);
  const condition = buildOwnedVehicleCondition(assetTag, vehicleStatus);
  const topLevelName = String(recipe.n || assetTag);
  return {
    uid: String(ownerUid),
    userId: String(ownerUid),
    _id: recordId,
    id: recordId,
    car: assetTag,
    carId: assetTag,
    n: topLevelName,
    pi,
    cond: clone(condition),
    dvu: recipeArrays.vu.slice(),
    inv: buildOwnedVisualUpgradeInventory(recipeArrays.vu),
    ud: false,
    AssetTag: meta.AssetTag,
    assetTag: meta.AssetTag,
    q: quarterMile,
    e: 0,
    recipe: clone(recipe),
    Recipe: clone(recipe),
    Tag: meta.Tag,
    tag: meta.tag,
    carTag: meta.Tag,
    Name: meta.Name,
    name: meta.name,
    AttributeTag: meta.AttributeTag,
    PrefabName: meta.PrefabName,
    carPrefabPath: meta.carPrefabPath,
    carModelAttributePath: meta.carModelAttributePath,
    defaultVisualUpgrade: meta.defaultVisualUpgrade,
    CarMetaData: clone(meta),
    MetaData: clone(meta),
    metadata: clone(meta),
    pu: buildRacePerformanceUpgradePayload(vehicleStatus),
    up: buildRaceUpgradePayload(vehicleStatus),
    vehicleStatus: clone(vehicleStatus),
    VehicleStatus: clone(vehicleStatus),
    unlocks: {
      values: [`class_${classMap[canonicalTag] || 0}`]
    },
    r: recipe
  };
}

function getPersistedCarsBucketForUser(userId, ownerUid = '') {
  const user = getUser(userId);
  const carsRoot =
    user &&
    user.sparx &&
    user.sparx.dataStore &&
    user.sparx.dataStore.cars &&
    typeof user.sparx.dataStore.cars === 'object' &&
    !Array.isArray(user.sparx.dataStore.cars)
      ? user.sparx.dataStore.cars
      : {};
  const candidateOwnerIds = Array.from(new Set([
    String(ownerUid || '').trim(),
    String(user && user.profile && user.profile.uid || '').trim(),
    String(user && user.sparx && user.sparx.dataStore && user.sparx.dataStore.profile && user.sparx.dataStore.profile.uid || '').trim()
  ].filter(Boolean)));

  for (const candidateOwnerId of candidateOwnerIds) {
    const bucket = carsRoot[candidateOwnerId];
    if (bucket && typeof bucket === 'object' && !Array.isArray(bucket) && Object.keys(bucket).length > 0) {
      return bucket;
    }
  }

  const firstBucket = Object.values(carsRoot).find((bucket) => (
    bucket && typeof bucket === 'object' && !Array.isArray(bucket) && Object.keys(bucket).length > 0
  ));
  return firstBucket && typeof firstBucket === 'object' && !Array.isArray(firstBucket) ? firstBucket : null;
}

function buildPersistedOwnedCarRecord(userId, ownerUid, persistedRecord, index, fallbackTag) {
  const source = persistedRecord && typeof persistedRecord === 'object' ? clone(persistedRecord) : {};
  const rawRecipe = clone(source.r || source.recipe || source.Recipe || {});
  const rawTag = String(
    firstDefined(
      source.carId,
      source.car,
      rawRecipe.n,
      source.n,
      fallbackTag,
      getDefaultProfileVehicleTag()
    ) || ''
  ).trim();
  const canonicalTag = getSupportedOwnedVehicleTags(
    [rawTag],
    fallbackTag || getDefaultProfileVehicleTag()
  )[0];
  const assetTag = String(vehicleAssetAliases[canonicalTag] || canonicalTag);
  const recordId = String(
    firstDefined(
      source._id,
      source.id,
      createOwnedVehicleRecordId(ownerUid, assetTag, index)
    ) || ''
  );
  const recipeArrays = getDefaultRecipeArrays(assetTag);
  const quarterMile = Number(firstDefined(rawRecipe.q, source.q, 13.5) || 0);
  const recipeHash = Number(firstDefined(rawRecipe.hash, computeRecipeHash(assetTag)) || 0);
  const profile = getAuthoritativeSparxProfile(userId);
  const vehicleStatusMap = profile && typeof profile.OwnedVehiclesStatus === 'object'
    ? profile.OwnedVehiclesStatus
    : {};
  const vehicleStatus = sanitizeOwnedVehicleStatus(assetTag, clone(
    vehicleStatusMap[String(canonicalTag)] ||
    vehicleStatusMap[String(assetTag)] ||
    source.vehicleStatus ||
    source.VehicleStatus ||
    createOwnedVehicleStatus(assetTag)
  ));
  const condition = source.cond && typeof source.cond === 'object'
    ? clone(source.cond)
    : buildOwnedVehicleCondition(assetTag, vehicleStatus);
  const persistedVisualUpgrades = Array.isArray(rawRecipe.vu) && rawRecipe.vu.length > 0
    ? rawRecipe.vu.map((value) => Number(value))
    : recipeArrays.vu.slice();
  const defaultVisualUpgrades = Array.isArray(source.dvu) && source.dvu.length > 0
    ? source.dvu.map((value) => Number(value))
    : persistedVisualUpgrades.slice();
  const visualUpgradeInventory = Array.isArray(source.inv) && source.inv.length > 0
    ? source.inv.map((value) => Number(value))
    : buildOwnedVisualUpgradeInventory(persistedVisualUpgrades);
  const meta = buildCarMetaPayload(canonicalTag);
  const recipe = {
    c: Number(firstDefined(rawRecipe.c, classToNumber(canonicalTag)) || 0),
    pc: String(firstDefined(rawRecipe.pc, assetTag) || ''),
    n: String(firstDefined(rawRecipe.n, assetTag) || ''),
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
  return {
    uid: String(ownerUid),
    userId: String(ownerUid),
    _id: recordId,
    id: recordId,
    car: assetTag,
    carId: assetTag,
    n: String(firstDefined(source.n, recipe.n, assetTag) || ''),
    pi: Number(firstDefined(source.pi, getCanonicalVehiclePi(assetTag, vehicleStatus)) || 0),
    cond: clone(condition),
    dvu: defaultVisualUpgrades.slice(),
    inv: clone(visualUpgradeInventory),
    ud: Boolean(firstDefined(source.ud, false)),
    AssetTag: meta.AssetTag,
    assetTag: meta.AssetTag,
    Tag: meta.Tag,
    tag: meta.tag,
    carTag: meta.Tag,
    Name: meta.Name,
    name: meta.name,
    q: Number(firstDefined(source.q, recipe.q) || 0),
    e: Number(firstDefined(source.e, 0) || 0),
    recipe: clone(recipe),
    Recipe: clone(recipe),
    r: clone(recipe),
    pu: clone(source.pu || buildRacePerformanceUpgradePayload(vehicleStatus)),
    up: clone(source.up || buildRaceUpgradePayload(vehicleStatus)),
    vehicleStatus: clone(vehicleStatus),
    VehicleStatus: clone(vehicleStatus),
    unlocks: source.unlocks && typeof source.unlocks === 'object'
      ? clone(source.unlocks)
      : { values: [`class_${Number(firstDefined(recipe.c, 0) || 0)}`] }
  };
}

function sanitizeDataStoreCarsForClient(userId, dataStore) {
  const sanitizedCarsRoot = {};
  const carsRoot = dataStore && dataStore.cars && typeof dataStore.cars === 'object'
    ? dataStore.cars
    : {};
  const profile = dataStore && dataStore.profile && typeof dataStore.profile === 'object'
    ? dataStore.profile
    : {};
  const fallbackTag = String(
    firstDefined(
      profile.CurrentVehicleTag,
      profile.currentVehicleTag,
      getDefaultProfileVehicleTag()
    ) || ''
  ).trim() || getDefaultProfileVehicleTag();

  Object.entries(carsRoot).forEach(([ownerUid, bucket]) => {
    if (!bucket || typeof bucket !== 'object' || Array.isArray(bucket)) {
      return;
    }

    const sanitizedBucket = {};
    Object.entries(bucket).forEach(([recordId, persistedRecord], index) => {
      const sanitizedRecord = buildPersistedOwnedCarRecord(
        userId,
        ownerUid,
        persistedRecord,
        index,
        fallbackTag
      );
      sanitizedBucket[String(recordId || sanitizedRecord.id || sanitizedRecord._id || index)] = sanitizedRecord;
    });

    sanitizedCarsRoot[String(ownerUid)] = sanitizedBucket;
  });

  return sanitizedCarsRoot;
}

function sanitizeDataStoreForClient(userId, dataStore) {
  const sanitized = clone(dataStore || {});
  sanitized.profile = sanitized.profile && typeof sanitized.profile === 'object'
    ? clone(sanitized.profile)
    : {};
  sanitized.profile.name = sanitizeClientVisibleName(sanitized.profile.name || sanitized.profile.Nickname);
  sanitized.cars = sanitizeDataStoreCarsForClient(userId, sanitized);
  return sanitized;
}

function buildGarageCarRecord(tag, ownerUid, index, vehicleStatusOverride = null) {
  const canonicalTag = getCanonicalVehicleTag(tag, getDefaultProfileVehicleTag());
  const record = buildOwnedCarRecord(canonicalTag, ownerUid, index, vehicleStatusOverride);
  const canonicalRecipe = record.r ? { ...record.r, pc: canonicalTag, n: canonicalTag } : null;

  return {
    ...record,
    car: canonicalTag,
    carId: canonicalTag,
    r: canonicalRecipe,
    recipe: canonicalRecipe ? clone(canonicalRecipe) : null,
    Recipe: canonicalRecipe ? clone(canonicalRecipe) : null
  };
}

function buildMatchCarMeta(metaOrTag) {
  const meta =
    metaOrTag && typeof metaOrTag === 'object'
      ? metaOrTag
      : buildCarMetaPayload(metaOrTag);

  return {
    ...clone(meta),
    Tag: meta.Tag,
    tag: meta.tag,
    Id: meta.Id,
    id: meta.id,
    AssetTag: meta.AssetTag,
    AttributeTag: meta.AttributeTag,
    PrefabName: meta.PrefabName,
    carPrefabPath: meta.carPrefabPath,
    carModelAttributePath: meta.carModelAttributePath,
    cpp: meta.cpp,
    tbp: meta.tbp,
    cty: meta.cty,
    dvu: meta.dvu,
    ncvu: meta.ncvu,
    ncvuh: meta.ncvuh,
    rvu: meta.rvu,
    DefaultRecipe: clone(meta.DefaultRecipe || null),
    defaultVisualUpgrade: meta.defaultVisualUpgrade,
    Name: meta.Name,
    name: meta.name,
    description: meta.description,
    modelYear: meta.modelYear,
    PerformanceClass: meta.PerformanceClass,
    ClassType: meta.ClassType,
    BasePISS: meta.BasePISS,
    CanUseDriftTyres: meta.CanUseDriftTyres,
    CanUseOffRoadTyres: meta.CanUseOffRoadTyres
  };
}

function buildMatchCarRecord(recordOrTag, fallbackUid = 'player', options = {}) {
  const record =
    recordOrTag && typeof recordOrTag === 'object'
      ? recordOrTag
      : buildOwnedCarRecord(recordOrTag, fallbackUid, 0);
  const recipe = options.clearVisualUpgrades
    ? stripRuntimeRecipeVisualUpgrades(record.r || record.recipe || record.Recipe || null)
    : clone(record.r || record.recipe || record.Recipe || null);
  const meta = buildMatchCarMeta(record.CarMetaData || record.MetaData || record.metadata || record.carId);
  const vehicleStatus = clone(
    record.vehicleStatus ||
    record.VehicleStatus ||
    createOwnedVehicleStatus(String(record.carId || record.car || ''))
  );
  if (options.clearVisualUpgrades) {
    meta.dvu = '';
    meta.ncvu = '';
    meta.ncvuh = '';
    meta.defaultVisualUpgrade = '';
    if (meta.DefaultRecipe && typeof meta.DefaultRecipe === 'object') {
      meta.DefaultRecipe.vu = [];
    }
  }

  return {
    uid: String(record.uid || fallbackUid),
    userId: String(record.userId || record.uid || fallbackUid),
    _id: String(record._id || record.id || record.carId || ''),
    id: String(record.id || record._id || record.carId || ''),
    car: String(record.car || record.carId || ''),
    carId: String(record.carId || record.car || ''),
    AssetTag: String(record.AssetTag || meta.AssetTag || record.carId || ''),
    assetTag: String(record.assetTag || record.AssetTag || meta.AssetTag || record.carId || ''),
    q: Number(record.q || 0),
    e: Number(record.e || 0),
    r: recipe,
    recipe,
    Recipe: clone(recipe),
    Tag: meta.Tag,
    tag: meta.tag,
    carTag: meta.Tag,
    Name: meta.Name,
    name: meta.name,
    AttributeTag: meta.AttributeTag,
    PrefabName: meta.PrefabName,
    carPrefabPath: meta.carPrefabPath,
    carModelAttributePath: meta.carModelAttributePath,
    CarMetaData: clone(meta),
    carMetaData: clone(meta),
    MetaData: clone(meta),
    metadata: clone(meta),
    pi: Number(record.pi || meta.pi || 0),
    pu: clone(record.pu || buildRacePerformanceUpgradePayload(vehicleStatus)),
    up: clone(record.up || buildRaceUpgradePayload(vehicleStatus)),
    defaultVisualUpgrade: meta.defaultVisualUpgrade,
    CurrentVehicleTag: String(record.carId || record.car || ''),
    currentVehicleTag: String(record.carId || record.car || ''),
    activeCarId: String(record._id || record.id || record.carId || ''),
    active_carid: String(record._id || record.id || record.carId || ''),
    active_recipe: Number((recipe && recipe.hash) || 0),
    vehicleStatus: clone(vehicleStatus),
    VehicleStatus: clone(vehicleStatus)
  };
}

function indexCarRecord(target, record) {
  if (!target || !record || typeof record !== 'object') {
    return target;
  }

  [
    record.carId,
    record.car,
    record.id,
    record._id,
    record.Tag,
    record.tag,
    record.AssetTag,
    record.assetTag,
    record.AttributeTag,
    record.PrefabName,
    record.carPrefabPath,
    record.carModelAttributePath
  ]
    .map((value) => String(value || '').trim())
    .filter(Boolean)
    .forEach((key) => {
      target[key] = clone(record);
    });

  return target;
}

function buildRaceCarMirrors(playerTag, opponentTag, options = {}) {
  const playerRecord = buildOwnedCarRecord(playerTag, 'player', 0);
  const soloRace = Boolean(options && options.solo) || !String(opponentTag || '').trim();
  const opponentRecord = soloRace ? null : buildOwnedCarRecord(opponentTag, 'opponent', 0);
  const vsOpponentTag = String(options && options.vsOpponentTag || '').trim();
  const displayOpponentRecord = opponentRecord || (vsOpponentTag ? buildOwnedCarRecord(vsOpponentTag, 'opponent-vs', 0) : null);
  const trafficTags = Array.isArray(options.trafficTags)
    ? options.trafficTags
    : FF7_TUTORIAL_TRAFFIC_CAR_IDS;
  const policeTags = Array.isArray(options.policeTags)
    ? options.policeTags
    : FF7_TUTORIAL_POLICE_CAR_IDS;
  const trafficRecords = trafficTags.map((tag, index) => buildOwnedCarRecord(tag, `traffic-${index + 1}`, index));
  const policeRecords = policeTags.map((tag, index) => buildOwnedCarRecord(tag, `police-${index + 1}`, index));
  const allCars = [
    clone(playerRecord),
    ...(opponentRecord ? [clone(opponentRecord)] : []),
    ...trafficRecords.map((record) => clone(record)),
    ...policeRecords.map((record) => clone(record))
  ];
  const trafficCarIds = trafficRecords.map((record) => record.carId);
  const policeCarPrefabs = policeRecords.map((record) => getPrefabPath(record));
  const defaultPolicePrefab = policeCarPrefabs.length > 0 ? policeCarPrefabs[0] : '';
  const trafficCarPrefabs = trafficRecords.map((record) => getPrefabPath(record));
  const policeCarIds = policeRecords.map((record) => record.carId);
  const trafficLevelLabel = getTrafficLevelLabel(options.raceConfig || null, trafficRecords.length);
  const carsById = {};
  allCars.forEach((record) => {
    indexCarRecord(carsById, record);
  });
  const raceCarsContainer = buildRaceCarsContainer(
    playerRecord,
    opponentRecord,
    options.playerPi || 0,
    options.opponentPi || 0
  );
  return {
    pc: playerRecord.carId,
    PlayerCar: playerRecord.carId,
    playerCar: playerRecord.carId,
    PlayerCarId: playerRecord.carId,
    playerCarId: playerRecord.carId,
    PlayerCarRecipe: clone(playerRecord.r),
    playerCarRecipe: clone(playerRecord.r),
    PlayerCarMetaData: clone(playerRecord.CarMetaData),
    playerCarMetaData: clone(playerRecord.CarMetaData),
    pv: buildRaceVuString(playerRecord),
    ppu: clone(playerRecord.pu || buildRacePerformanceUpgradePayload(playerRecord.vehicleStatus || playerRecord.VehicleStatus || {})),
    pup: clone(playerRecord.up || buildRaceUpgradePayload(playerRecord.vehicleStatus || playerRecord.VehicleStatus || {})),
    oc: displayOpponentRecord ? displayOpponentRecord.carId : '',
    OpponentCar: displayOpponentRecord ? displayOpponentRecord.carId : '',
    opponentCar: displayOpponentRecord ? displayOpponentRecord.carId : '',
    OpponentCarId: displayOpponentRecord ? displayOpponentRecord.carId : '',
    opponentCarId: displayOpponentRecord ? displayOpponentRecord.carId : '',
    OpponentCarRecipe: clone(displayOpponentRecord && displayOpponentRecord.r),
    opponentCarRecipe: clone(displayOpponentRecord && displayOpponentRecord.r),
    OpponentCarMetaData: clone(displayOpponentRecord && displayOpponentRecord.CarMetaData),
    opponentCarMetaData: clone(displayOpponentRecord && displayOpponentRecord.CarMetaData),
    PlayerCarData: clone(playerRecord),
    playerCarData: clone(playerRecord),
    OpponentCarData: clone(displayOpponentRecord),
    opponentCarData: clone(displayOpponentRecord),
    player: clone(raceCarsContainer.player),
    opponent: clone(raceCarsContainer.opponent),
    cars: clone(raceCarsContainer),
    carRecords: clone(allCars),
    CarsArray: clone(allCars),
    carsById: clone(carsById),
    trafficCarsDisabled: trafficRecords.length === 0,
    trafficCars: trafficCarIds.slice(),
    TrafficCars: trafficCarIds.slice(),
    trafficCarIds: trafficCarIds.slice(),
    TrafficCarIds: trafficCarIds.slice(),
    trafficCarData: trafficRecords.map((record) => clone(record)),
    TrafficCarData: trafficRecords.map((record) => clone(record)),
    trafficVehiclePrefabList: trafficCarPrefabs.slice(),
    TrafficVehiclePrefabList: trafficCarPrefabs.slice(),
    aiTrafficVehicles: trafficRecords.map((record) => clone(record)),
    AiTrafficVehicles: trafficRecords.map((record) => clone(record)),
    aiTrafficVehiclePrefabs: trafficCarPrefabs.slice(),
    AiTrafficVehiclePrefabs: trafficCarPrefabs.slice(),
    trafficLevel: trafficLevelLabel,
    TrafficLevel: trafficLevelLabel,
    policeCars: policeCarIds.slice(),
    PoliceCars: policeCarIds.slice(),
    policeCarIds: policeCarIds.slice(),
    PoliceCarIds: policeCarIds.slice(),
    policeCarData: policeRecords.map((record) => clone(record)),
    PoliceCarData: policeRecords.map((record) => clone(record)),
    policeCarPrefabList: policeCarPrefabs.slice(),
    PoliceCarPrefabList: policeCarPrefabs.slice(),
    policeCarPool: policeRecords.map((record) => clone(record)),
    PoliceCarPool: policeRecords.map((record) => clone(record)),
    policeCarPath: defaultPolicePrefab,
    PoliceCarPath: defaultPolicePrefab,
    policeCarPrefab: defaultPolicePrefab,
    PoliceCarPrefab: defaultPolicePrefab,
    ov: displayOpponentRecord ? buildRaceVuString(displayOpponentRecord) : '',
    opu: clone(displayOpponentRecord ? (displayOpponentRecord.pu || buildRacePerformanceUpgradePayload(displayOpponentRecord.vehicleStatus || displayOpponentRecord.VehicleStatus || {})) : {}),
    oup: clone(displayOpponentRecord ? (displayOpponentRecord.up || buildRaceUpgradePayload(displayOpponentRecord.vehicleStatus || displayOpponentRecord.VehicleStatus || {})) : {})
  };
}

function buildCarsRoot(userId) {
  const profile = getAuthoritativeSparxProfile(userId);
  const ownerUid = getProfileUidValue(profile, userId);
  const freshTutorialIntro = isFreshTutorialIntroProfile(profile);
  const desiredOwnedVehicles = FF7_SKIP_TUTORIAL_TO_GARAGE
    ? getDefaultOwnedVehicleTags().slice()
    : (
      freshTutorialIntro
        ? []
        : Array.isArray(profile.OwnedVehicles) && profile.OwnedVehicles.length > 0
        ? profile.OwnedVehicles.slice().map((tag) => remapGarageVehicleTag(tag, getDefaultProfileVehicleTag()))
        : [String(remapGarageVehicleTag(profile.CurrentVehicleTag || getDefaultProfileVehicleTag(), getDefaultProfileVehicleTag()))]
    );
  let ownedVehicles = getSupportedOwnedVehicleTags(
    desiredOwnedVehicles,
    profile.CurrentVehicleTag || getDefaultProfileVehicleTag()
  );
  const activeVehicle = FF7_SKIP_TUTORIAL_TO_GARAGE
    ? String(getDefaultProfileVehicleTag())
    : String(getSupportedOwnedVehicleTags([
      remapGarageVehicleTag(profile.CurrentVehicleTag || ownedVehicles[0] || getDefaultProfileVehicleTag(), getDefaultProfileVehicleTag())
    ], ownedVehicles[0] || getDefaultProfileVehicleTag())[0]);

  if (!freshTutorialIntro && ownedVehicles.indexOf(activeVehicle) === -1) {
    ownedVehicles.unshift(activeVehicle);
  }

  if (ownedVehicles.length === 0) {
    getDefaultOwnedVehicleTags().forEach((tag) => {
      if (ownedVehicles.indexOf(tag) === -1) {
        ownedVehicles.push(tag);
      }
    });
  }

  const persistedBucket = getPersistedCarsBucketForUser(userId, ownerUid);
  const persistedRecordsByTag = new Map();
  if (persistedBucket && typeof persistedBucket === 'object') {
    Object.values(persistedBucket).forEach((record) => {
      if (!record || typeof record !== 'object') return;
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
        activeVehicle || getDefaultProfileVehicleTag()
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

  const bucket = {};
  ownedVehicles.forEach((tag, index) => {
    const useGarageRecord = FF7_SKIP_TUTORIAL_TO_GARAGE;
    const vehicleStatusMap = profile && typeof profile.OwnedVehiclesStatus === 'object'
      ? profile.OwnedVehiclesStatus
      : {};
    const vehicleStatus = clone(
      vehicleStatusMap[String(tag)] ||
      vehicleStatusMap[String(vehicleAssetAliases[String(tag)] || tag)] ||
      null
    );
    const persistedRecord = persistedRecordsByTag.get(String(tag || ''));
    let record = persistedRecord
      ? buildPersistedOwnedCarRecord(userId, ownerUid, persistedRecord, index, activeVehicle)
      : (useGarageRecord
          ? buildGarageCarRecord(tag, ownerUid, index, vehicleStatus)
          : buildOwnedCarRecord(tag, ownerUid, index, vehicleStatus));
    if (useGarageRecord && persistedRecord) {
      const canonicalTag = getCanonicalVehicleTag(tag, getDefaultProfileVehicleTag());
      const canonicalRecipe = record.r ? { ...record.r, pc: canonicalTag, n: canonicalTag } : null;
      record = {
        ...record,
        car: canonicalTag,
        carId: canonicalTag,
        r: canonicalRecipe,
        recipe: canonicalRecipe ? clone(canonicalRecipe) : null,
        Recipe: canonicalRecipe ? clone(canonicalRecipe) : null
      };
    }
    bucket[String(record._id)] = clone(record);
  });

  return {
    [ownerUid]: bucket
  };
}

function buildDefaultDataStore(userId) {
  const profile = getAuthoritativeSparxProfile(userId);
  const activeVehicle = String(
    remapGarageVehicleTag(
      profile.CurrentVehicleTag || getDefaultProfileVehicleTag(),
      getDefaultProfileVehicleTag()
    )
  );
  const uid = getProfileUidValue(profile, userId);
  const carsRoot = buildCarsRoot(userId);
  const activeBucket = carsRoot && carsRoot[uid] && typeof carsRoot[uid] === 'object'
    ? carsRoot[uid]
    : {};
  const activeCarRecord = clone(
    activeBucket[String(profile.lastRequestedCarId || profile.LastRequestedCarId || '')] ||
    activeBucket[String(profile.active_carid || profile.activeCarId || '')] ||
    Object.values(activeBucket).find((record) => String(record && record.carId || '') === activeVehicle) ||
    Object.values(activeBucket)[0] ||
    (FF7_SKIP_TUTORIAL_TO_GARAGE
      ? buildGarageCarRecord(activeVehicle, uid, 0)
      : buildOwnedCarRecord(activeVehicle, uid, 0))
  );
  const activeRecipeHash = Number(
    firstDefined(
      profile.active_recipe,
      activeCarRecord && activeCarRecord.recipe ? activeCarRecord.recipe.hash : 0
    ) || 0
  );
  const garageProgression = FF7_SKIP_TUTORIAL_TO_GARAGE
    ? getGarageProfileProgressionAliases(profile)
    : null;
  const now = nowTs();
  const dayIndex = Math.floor(now / 86400);

  return {
    profile: {
      uid,
      name: sanitizeClientVisibleName(profile.name || profile.Nickname),
      time: now,
      rank: getNormalizedProfileLevel(profile),
      Rank: getNormalizedProfileLevel(profile),
      level: getNormalizedProfileLevel(profile),
      Level: getNormalizedProfileLevel(profile),
      PlayerLevel: getNormalizedProfileLevel(profile),
      coins: profile.NoCoins || 0,
      gold: profile.NoStars || 0,
      rewardcachesize: 0,
      ai_car_rewarded_races: [],
      bps_expiry_time: {},
      active_recipe: activeRecipeHash,
      rp: 0,
      respectPoints: 0,
      xp: getNormalizedProfileXp(profile),
      XP: getNormalizedProfileXp(profile),
      currentXP: getNormalizedProfileXp(profile),
      nextLevelXP: Number(profile.nextLevelXP || profile.NextLevelXP || 1000),
      NextLevelXP: Number(profile.nextLevelXP || profile.NextLevelXP || 1000),
      levelRewards: Array.isArray(profile.levelRewards) ? clone(profile.levelRewards) : [],
      nextLevelRewards: Array.isArray(profile.nextLevelRewards) ? clone(profile.nextLevelRewards) : [],
      prevLevelRewards: Array.isArray(profile.prevLevelRewards) ? clone(profile.prevLevelRewards) : [],
      Miles: getNormalizedProfileMiles(profile),
      won_races: (profile.won_races && typeof profile.won_races === 'object')
        ? clone(profile.won_races)
        : (FF7_SKIP_TUTORIAL_TO_GARAGE ? clone(garageProgression && garageProgression.won_races) : {}),
      lost_races: (profile.lost_races && typeof profile.lost_races === 'object')
        ? clone(profile.lost_races)
        : clone(garageProgression && garageProgression.lost_races || {}),
      last_story_race: String(profile.last_story_race != null ? profile.last_story_race : (FF7_SKIP_TUTORIAL_TO_GARAGE ? garageProgression.last_story_race : '')),
      crid: String(profile.crid != null ? profile.crid : (FF7_SKIP_TUTORIAL_TO_GARAGE ? garageProgression.crid : FF7_TUTORIAL_RACE_ID)),
      jfrid: String(profile.jfrid != null ? profile.jfrid : (FF7_SKIP_TUTORIAL_TO_GARAGE ? garageProgression.jfrid : FF7_TUTORIAL_RACE_ID)),
      cmid: String(profile.cmid != null ? profile.cmid : (FF7_SKIP_TUTORIAL_TO_GARAGE ? garageProgression.cmid : FF7_TUTORIAL_CHAPTER_ID)),
      tut_id: profile.tut_id != null ? Number(profile.tut_id) : (FF7_SKIP_TUTORIAL_TO_GARAGE ? getCompletedTutorialStepValue() : 1),
      nrg_up: false,
      energy: profile.Fuel || 0,
      ll_time: now,
      active_carid: String(activeCarRecord._id || ''),
      activeCarId: String(activeCarRecord._id || ''),
      settings: '{"usd":2}',
      lan: 1,
      ubs: false,
      sa: true,
      battery: 0,
      bat_time: 0,
      bat_up: false,
      CurrentRaceId: String(profile.CurrentRaceId != null ? profile.CurrentRaceId : (FF7_SKIP_TUTORIAL_TO_GARAGE ? garageProgression.CurrentRaceId : FF7_TUTORIAL_RACE_ID)),
      currentRaceId: String(profile.currentRaceId != null ? profile.currentRaceId : (FF7_SKIP_TUTORIAL_TO_GARAGE ? garageProgression.currentRaceId : FF7_TUTORIAL_RACE_ID)),
      current_race_id: String(profile.current_race_id != null ? profile.current_race_id : (FF7_SKIP_TUTORIAL_TO_GARAGE ? garageProgression.current_race_id : FF7_TUTORIAL_RACE_ID)),
      JustFinishedRaceId: String(profile.JustFinishedRaceId != null ? profile.JustFinishedRaceId : (FF7_SKIP_TUTORIAL_TO_GARAGE ? garageProgression.JustFinishedRaceId : '')),
      justFinishedRaceId: String(profile.justFinishedRaceId != null ? profile.justFinishedRaceId : (FF7_SKIP_TUTORIAL_TO_GARAGE ? garageProgression.justFinishedRaceId : '')),
      just_finished_race_id: String(profile.just_finished_race_id != null ? profile.just_finished_race_id : (FF7_SKIP_TUTORIAL_TO_GARAGE ? garageProgression.just_finished_race_id : '')),
      LastWonStoryRaceID: String(profile.LastWonStoryRaceID != null ? profile.LastWonStoryRaceID : (FF7_SKIP_TUTORIAL_TO_GARAGE ? garageProgression.LastWonStoryRaceID : '')),
      lastWonStoryRaceID: String(profile.lastWonStoryRaceID != null ? profile.lastWonStoryRaceID : (FF7_SKIP_TUTORIAL_TO_GARAGE ? garageProgression.lastWonStoryRaceID : '')),
      lastWonStoryRaceId: String(profile.lastWonStoryRaceId != null ? profile.lastWonStoryRaceId : (FF7_SKIP_TUTORIAL_TO_GARAGE ? garageProgression.lastWonStoryRaceId : ''))
    },
    stats: {
      GAMES_PLAYED: 0,
      WINS: 0,
      LOSSES: 0,
      UNIQUE_WINS: 0,
      UNIQUE_LOSSES: 0,
      UNIQUE_GAMES_PLAYED: 0,
      TOTAL_DISTANCE_DRIVEN: getNormalizedProfileMiles(profile)
    },
    dailyraces: {
      lastDay: dayIndex,
      racesWonToday: 0,
      races: [],
      consecDays: 0
    },
    version: '1',
    platform: 'AndroidPlayer',
    inventory: buildInventorySnapshotFromProfile(profile),
    cars: clone(carsRoot),
    car: {
      ...activeCarRecord,
      unlocks: {
        values: ['class_1']
      }
    },
    unlocks: {
      values: ['fuel', 'lvl2', 'lvl7', 'lvl8']
    }
  };
}

function normalizeTutorialProgressionProfile(profile) {
  if (!profile || typeof profile !== 'object') return false;

  let changed = false;
  if (normalizeTutorialStartingResources(profile)) {
    changed = true;
  }
  if (FF7_SKIP_TUTORIAL_TO_GARAGE || shouldCompleteTutorialsOnFreshSave(profile)) {
    const normalized = buildGarageTutorialProgression(profile);
    if (JSON.stringify(profile) !== JSON.stringify({ ...profile, ...normalized })) {
      Object.assign(profile, normalized);
      changed = true;
    }
    return changed;
  }
  const wonRaces = profile.won_races && typeof profile.won_races === 'object' ? profile.won_races : {};
  const hasWonStoryProgress = Object.keys(wonRaces).some((raceId) => String(raceId).startsWith('chapter_'));

  if (!profile.won_races || typeof profile.won_races !== 'object') {
    profile.won_races = {};
    changed = true;
  }

  if (!profile.lost_races || typeof profile.lost_races !== 'object') {
    profile.lost_races = {};
    changed = true;
  }

  if (!hasWonStoryProgress) {
    if (profile.last_story_race !== '') {
      profile.last_story_race = '';
      changed = true;
    }
    if (profile.crid !== FF7_TUTORIAL_RACE_ID) {
      profile.crid = FF7_TUTORIAL_RACE_ID;
      changed = true;
    }
    if (profile.jfrid !== FF7_TUTORIAL_RACE_ID) {
      profile.jfrid = FF7_TUTORIAL_RACE_ID;
      changed = true;
    }
    if (profile.cmid !== FF7_TUTORIAL_CHAPTER_ID) {
      profile.cmid = FF7_TUTORIAL_CHAPTER_ID;
      changed = true;
    }
    if (profile.tut_id !== 1) {
      profile.tut_id = 1;
      changed = true;
    }
    if (profile.CurrentRaceId !== FF7_TUTORIAL_RACE_ID) {
      profile.CurrentRaceId = FF7_TUTORIAL_RACE_ID;
      changed = true;
    }
    if (profile.currentRaceId !== FF7_TUTORIAL_RACE_ID) {
      profile.currentRaceId = FF7_TUTORIAL_RACE_ID;
      changed = true;
    }
    if (profile.current_race_id !== FF7_TUTORIAL_RACE_ID) {
      profile.current_race_id = FF7_TUTORIAL_RACE_ID;
      changed = true;
    }
    if (profile.JustFinishedRaceId !== '') {
      profile.JustFinishedRaceId = '';
      changed = true;
    }
    if (profile.justFinishedRaceId !== '') {
      profile.justFinishedRaceId = '';
      changed = true;
    }
    if (profile.just_finished_race_id !== '') {
      profile.just_finished_race_id = '';
      changed = true;
    }
    if (profile.LastWonStoryRaceID !== '') {
      profile.LastWonStoryRaceID = '';
      changed = true;
    }
    if (profile.lastWonStoryRaceID !== '') {
      profile.lastWonStoryRaceID = '';
      changed = true;
    }
    if (profile.lastWonStoryRaceId !== '') {
      profile.lastWonStoryRaceId = '';
      changed = true;
    }
  }

  return changed;
}

function normalizeTutorialState(tutorial, profile = {}) {
  if (!tutorial || typeof tutorial !== 'object') return false;

  let changed = false;
  if (sanitizeTutorialStateCollections(tutorial)) {
    changed = true;
  }
  if (FF7_SKIP_TUTORIAL_TO_GARAGE || shouldCompleteTutorialsOnFreshSave(profile)) {
    const completedRoot = createTutorialBranchState(2, {
      tutorialId: FF7_TUTORIAL_ID,
      groupId: FF7_TUTORIAL_GROUP_ID,
      jumpRaceId: null,
      tutorialRunning: false,
      tutorialGroupRunning: false,
      tutorialGroupCompleted: true
    });
    const completedBranch = createTutorialBranchState(2, {
      tutorialId: FF7_TUTORIAL_ID,
      groupId: FF7_TUTORIAL_GROUP_ID,
      jumpRaceId: null,
      tutorialRunning: false,
      tutorialGroupRunning: false,
      tutorialGroupCompleted: true
    });
    completedRoot.Branches = FF7_TUTORIAL_BRANCH_IDS.reduce((acc, branchId) => {
      const normalizedBranchId = normalizeTutorialBranchId(branchId, FF7_TUTORIAL_GROUP_ID);
      acc[normalizedBranchId] = createTutorialBranchState(2, {
        tutorialId: FF7_TUTORIAL_ID,
        groupId: normalizedBranchId,
        jumpRaceId: getTutorialBranchRaceId(normalizedBranchId, ''),
        tutorialRunning: false,
        tutorialGroupRunning: false,
        tutorialGroupCompleted: true
      });
      return acc;
    }, {
      [FF7_TUTORIAL_GROUP_ID]: clone(completedBranch)
    });
    completedRoot.branches = completedRoot.Branches;
    completedRoot.Tutorials = {
      [FF7_TUTORIAL_ID]: {
        tutorialID: FF7_TUTORIAL_ID,
        tutorialId: FF7_TUTORIAL_ID,
        tutorialGroupId: FF7_TUTORIAL_GROUP_ID,
        JumpToRaceID: '',
        JumpToRaceIds: [],
        tutorialRunning: false,
        tutorialGroupRunning: false,
        tutorialGroupCompleted: true,
        State: 2,
        state: 2
      }
    };
    completedRoot.tutorials = completedRoot.Tutorials;
    const completedTutorialData = FF7_TUTORIAL_BRANCH_IDS.reduce((acc, branchId) => {
      acc[`${FF7_TUTORIAL_ID}:${branchId}`] = {
        started: true,
        completed: true,
        updatedAt: nowTs()
      };
      return acc;
    }, {});
    const completedUserData = {
      [FF7_TUTORIAL_ID]: clone(completedRoot)
    };
    FF7_CONTEXTUAL_TUTORIAL_IDS.forEach((tutorialId) => {
      completedUserData[tutorialId] = buildContextualTutorialUserDataNode(tutorialId, tutorialId, 2);
      completedTutorialData[`${tutorialId}:${tutorialId}`] = {
        started: true,
        completed: true,
        updatedAt: nowTs()
      };
    });
    const allCompletedGroupIds = Array.from(new Set(FF7_ALL_TUTORIAL_GROUP_IDS.filter(Boolean)));
    const allCompletedTutorialIds = Array.from(new Set([FF7_TUTORIAL_ID].concat(FF7_CONTEXTUAL_TUTORIAL_IDS.filter(Boolean))));
    const normalized = {
      ...tutorial,
      currentTutorialId: null,
      currentTutorialGroupId: null,
      largestTutorialId: FF7_TUTORIAL_DB_LTID,
      largestTutorialGroupId: FF7_TUTORIAL_DB_LTGID,
      tutorials: allCompletedTutorialIds,
      tutorialGroups: allCompletedGroupIds,
      tutorialGroupsCompleted: allCompletedGroupIds,
      tutorialData: completedTutorialData,
      userData: completedUserData,
      activeTutorial: null
    };
    if (JSON.stringify(tutorial) !== JSON.stringify(normalized)) {
      Object.keys(tutorial).forEach((key) => {
        delete tutorial[key];
      });
      Object.assign(tutorial, normalized);
      changed = true;
    }
    return changed;
  }
  const completedGroups = Array.isArray(tutorial.tutorialGroupsCompleted) ? tutorial.tutorialGroupsCompleted : [];
  const hasCompletedIntro = completedGroups.includes(FF7_TUTORIAL_GROUP_ID);
  const tutorialData = tutorial.tutorialData && typeof tutorial.tutorialData === 'object'
    ? tutorial.tutorialData
    : {};
  const introTutorialData = tutorialData[`${FF7_TUTORIAL_ID}:${FF7_TUTORIAL_GROUP_ID}`];
  const introCompletedInData = Boolean(introTutorialData && introTutorialData.completed);
  const hasAnySequentialCompletion = FF7_TUTORIAL_BRANCH_IDS.some((branchId) => (
    completedGroups.includes(branchId) ||
    Boolean(tutorialData[`${FF7_TUTORIAL_ID}:${branchId}`] && tutorialData[`${FF7_TUTORIAL_ID}:${branchId}`].completed)
  ));
  const shouldForceFreshIntroState = !hasCompletedIntro && !introCompletedInData && !hasAnySequentialCompletion;

  if (!Array.isArray(tutorial.tutorialGroupsCompleted)) {
    tutorial.tutorialGroupsCompleted = [];
    changed = true;
  }

  const allSequentialCompleted =
    getFirstIncompleteTutorialBranchId(tutorial) === '' &&
    Array.isArray(tutorial.tutorialGroupsCompleted) &&
    FF7_TUTORIAL_BRANCH_IDS.every((branchId) => (
      tutorial.tutorialGroupsCompleted.indexOf(normalizeTutorialBranchId(branchId, '')) !== -1
    ));

  if (allSequentialCompleted) {
    const before = JSON.stringify(tutorial);
    syncTutorialStateToBranch(tutorial, FF7_TUTORIAL_ID, '', {
      completedBranchIds: FF7_TUTORIAL_BRANCH_IDS
    });
    tutorial.tutorials = [FF7_TUTORIAL_ID];
    tutorial.currentTutorialId = FF7_TUTORIAL_ID;
    tutorial.currentTutorialGroupId = '';
    tutorial.activeTutorial = { tid: FF7_TUTORIAL_ID, bid: '' };
    if (tutorial.userData && typeof tutorial.userData === 'object') {
      tutorial.userData = {
        [FF7_TUTORIAL_ID]: clone(tutorial.userData[FF7_TUTORIAL_ID] || createTutorialBranchState(2, {
          tutorialId: FF7_TUTORIAL_ID,
          groupId: '',
          jumpRaceId: null,
          tutorialRunning: false,
          tutorialGroupRunning: false,
          tutorialGroupCompleted: true
        }))
      };
    }
    if (tutorial.tutorialData && typeof tutorial.tutorialData === 'object') {
      tutorial.tutorialData = FF7_TUTORIAL_BRANCH_IDS.reduce((acc, branchId) => {
        const existing = tutorial.tutorialData[`${FF7_TUTORIAL_ID}:${branchId}`] || {};
        acc[`${FF7_TUTORIAL_ID}:${branchId}`] = {
          started: true,
          completed: true,
          updatedAt: Number(existing.updatedAt || nowTs())
        };
        return acc;
      }, {});
    }
    if (before !== JSON.stringify(tutorial)) {
      changed = true;
    }
    return changed;
  }

  if (shouldForceFreshIntroState) {
    const completedSequentialGroups = FF7_COMPLETE_ALL_TUTORIALS_EXCEPT_FIRST
      ? FF7_TUTORIAL_BRANCH_IDS
          .map((branchId) => normalizeTutorialBranchId(branchId, ''))
          .filter((branchId) => branchId && branchId !== FF7_TUTORIAL_GROUP_ID)
      : [];
    const completedContextualGroups = FF7_CONTEXTUAL_TUTORIAL_IDS
      .map((tutorialId) => normalizeTutorialBranchId(tutorialId, ''))
      .filter(Boolean);
    const completedGroupsForState = Array.from(new Set(
      completedSequentialGroups.concat(completedContextualGroups)
    ));
    const expectedTutorialGroups = FF7_COMPLETE_ALL_TUTORIALS_EXCEPT_FIRST
      ? Array.from(new Set([FF7_TUTORIAL_GROUP_ID].concat(completedGroupsForState)))
      : [FF7_TUTORIAL_GROUP_ID];
    const expectedTutorials = Array.from(new Set([FF7_TUTORIAL_ID].concat(FF7_CONTEXTUAL_TUTORIAL_IDS.filter(Boolean))));

    if (JSON.stringify(Array.isArray(tutorial.tutorials) ? tutorial.tutorials : []) !== JSON.stringify(expectedTutorials)) {
      tutorial.tutorials = expectedTutorials.slice();
      changed = true;
    }

    if (JSON.stringify(Array.isArray(tutorial.tutorialGroups) ? tutorial.tutorialGroups : []) !== JSON.stringify(expectedTutorialGroups)) {
      tutorial.tutorialGroups = expectedTutorialGroups.slice();
      changed = true;
    }

    if (JSON.stringify(Array.isArray(tutorial.tutorialGroupsCompleted) ? tutorial.tutorialGroupsCompleted : []) !== JSON.stringify(completedGroupsForState)) {
      tutorial.tutorialGroupsCompleted = completedGroupsForState.slice();
      changed = true;
    }

    if (tutorial.currentTutorialId !== FF7_TUTORIAL_ID) {
      tutorial.currentTutorialId = FF7_TUTORIAL_ID;
      changed = true;
    }

    if (tutorial.currentTutorialGroupId !== FF7_TUTORIAL_GROUP_ID) {
      tutorial.currentTutorialGroupId = FF7_TUTORIAL_GROUP_ID;
      changed = true;
    }

    if (tutorial.largestTutorialId !== FF7_TUTORIAL_DB_LTID) {
      tutorial.largestTutorialId = FF7_TUTORIAL_DB_LTID;
      changed = true;
    }

    if (!tutorial.activeTutorial || typeof tutorial.activeTutorial !== 'object') {
      tutorial.activeTutorial = { tid: FF7_TUTORIAL_ID, bid: FF7_TUTORIAL_GROUP_ID };
      changed = true;
    } else {
      if (tutorial.activeTutorial.tid !== FF7_TUTORIAL_ID) {
        tutorial.activeTutorial.tid = FF7_TUTORIAL_ID;
        changed = true;
      }
      if (tutorial.activeTutorial.bid !== FF7_TUTORIAL_GROUP_ID) {
        tutorial.activeTutorial.bid = FF7_TUTORIAL_GROUP_ID;
        changed = true;
      }
    }

    if (tutorial.largestTutorialGroupId !== FF7_TUTORIAL_DB_LTGID) {
      tutorial.largestTutorialGroupId = FF7_TUTORIAL_DB_LTGID;
      changed = true;
    }

    const rootNode = tutorial.userData && tutorial.userData[FF7_TUTORIAL_ID];
    if (!rootNode || typeof rootNode !== 'object') {
      tutorial.userData = tutorial.userData && typeof tutorial.userData === 'object' ? tutorial.userData : {};
      tutorial.userData[FF7_TUTORIAL_ID] = createTutorialBranchState(1, {
        tutorialId: FF7_TUTORIAL_ID,
        groupId: FF7_TUTORIAL_GROUP_ID,
        tutorialRunning: true,
        tutorialGroupRunning: true,
        tutorialGroupCompleted: false
      });
      tutorial.userData[FF7_TUTORIAL_ID].Branches = {
        [FF7_TUTORIAL_GROUP_ID]: createTutorialBranchState(1, {
          tutorialId: FF7_TUTORIAL_ID,
          groupId: FF7_TUTORIAL_GROUP_ID,
          tutorialRunning: true,
          tutorialGroupRunning: true,
          tutorialGroupCompleted: false
        })
      };
      tutorial.userData[FF7_TUTORIAL_ID].branches = tutorial.userData[FF7_TUTORIAL_ID].Branches;
      tutorial.userData[FF7_TUTORIAL_ID].Tutorials = {};
      tutorial.userData[FF7_TUTORIAL_ID].tutorials = {};
      changed = true;
    } else {
      const beforeRoot = JSON.stringify(rootNode);
      applyTutorialNodeMeta(rootNode, {
        tutorialId: FF7_TUTORIAL_ID,
        groupId: FF7_TUTORIAL_GROUP_ID,
        state: 1,
        tutorialRunning: true,
        tutorialGroupRunning: true,
        tutorialGroupCompleted: false
      });
      if (JSON.stringify(rootNode) !== beforeRoot) {
        changed = true;
      }
      rootNode.Branches = rootNode.Branches && typeof rootNode.Branches === 'object' ? rootNode.Branches : {};
      rootNode.branches = rootNode.Branches;
      if (!rootNode.Branches[FF7_TUTORIAL_GROUP_ID] || typeof rootNode.Branches[FF7_TUTORIAL_GROUP_ID] !== 'object') {
        rootNode.Branches[FF7_TUTORIAL_GROUP_ID] = createTutorialBranchState(1, {
          tutorialId: FF7_TUTORIAL_ID,
          groupId: FF7_TUTORIAL_GROUP_ID,
          tutorialRunning: true,
          tutorialGroupRunning: true,
          tutorialGroupCompleted: false
        });
        rootNode.branches = rootNode.Branches;
        changed = true;
      } else {
        const branchNode = rootNode.Branches[FF7_TUTORIAL_GROUP_ID];
        const beforeBranch = JSON.stringify(branchNode);
        applyTutorialNodeMeta(branchNode, {
          tutorialId: FF7_TUTORIAL_ID,
          groupId: FF7_TUTORIAL_GROUP_ID,
          state: 1,
          tutorialRunning: true,
          tutorialGroupRunning: true,
          tutorialGroupCompleted: false
        });
        if (JSON.stringify(branchNode) !== beforeBranch) {
          changed = true;
        }
      }

      completedSequentialGroups.forEach((branchId) => {
        const beforeCompletedBranch = JSON.stringify(rootNode.Branches[branchId] || null);
        rootNode.Branches[branchId] = createTutorialBranchState(2, {
          tutorialId: FF7_TUTORIAL_ID,
          groupId: branchId,
          jumpRaceId: getTutorialBranchRaceId(branchId, ''),
          tutorialRunning: false,
          tutorialGroupRunning: false,
          tutorialGroupCompleted: true
        });
        if (JSON.stringify(rootNode.Branches[branchId]) !== beforeCompletedBranch) {
          changed = true;
        }
      });

      const expectedBranchKeys = Array.from(new Set([FF7_TUTORIAL_GROUP_ID].concat(completedSequentialGroups)));
      const actualBranchKeys = Object.keys(rootNode.Branches).sort();
      if (JSON.stringify(actualBranchKeys) !== JSON.stringify(expectedBranchKeys.slice().sort())) {
        const rebuiltBranches = {};
        expectedBranchKeys.forEach((branchId) => {
          rebuiltBranches[branchId] = rootNode.Branches[branchId];
        });
        rootNode.Branches = rebuiltBranches;
        rootNode.branches = rootNode.Branches;
        changed = true;
      }
    }

    const expectedKey = `${FF7_TUTORIAL_ID}:${FF7_TUTORIAL_GROUP_ID}`;
    if (!tutorial.tutorialData || typeof tutorial.tutorialData !== 'object') {
      tutorial.tutorialData = {};
      changed = true;
    }
    const currentEntry = tutorial.tutorialData[expectedKey] || {};
    const normalizedEntry = {
      started: true,
      completed: false,
      updatedAt: currentEntry.updatedAt || nowTs()
    };
    const expectedTutorialData = {
      [expectedKey]: normalizedEntry
    };
    completedSequentialGroups.forEach((branchId) => {
      const entryKey = `${FF7_TUTORIAL_ID}:${branchId}`;
      const existingEntry = tutorial.tutorialData[entryKey] || {};
      expectedTutorialData[`${FF7_TUTORIAL_ID}:${branchId}`] = {
        started: true,
        completed: true,
        updatedAt: existingEntry.updatedAt || nowTs()
      };
    });
    completedContextualGroups.forEach((tutorialId) => {
      const entryKey = `${tutorialId}:${tutorialId}`;
      const existingEntry = tutorial.tutorialData[entryKey] || {};
      expectedTutorialData[`${tutorialId}:${tutorialId}`] = {
        started: true,
        completed: true,
        updatedAt: existingEntry.updatedAt || nowTs()
      };
    });
    if (JSON.stringify(currentEntry) !== JSON.stringify(normalizedEntry) || JSON.stringify(tutorial.tutorialData) !== JSON.stringify(expectedTutorialData)) {
      tutorial.tutorialData = expectedTutorialData;
      changed = true;
    }

    tutorial.userData = tutorial.userData && typeof tutorial.userData === 'object' ? tutorial.userData : {};
    FF7_CONTEXTUAL_TUTORIAL_IDS.forEach((tutorialId) => {
      const contextualNode = buildContextualTutorialUserDataNode(tutorialId, tutorialId, 2);
      if (JSON.stringify(tutorial.userData[tutorialId] || null) !== JSON.stringify(contextualNode)) {
        tutorial.userData[tutorialId] = contextualNode;
        changed = true;
      }
    });
  }

  return changed;
}

function buildTuningPayload() {
  const gachaSetsByTutorialNameJson = JSON.stringify(GACHA_TUTORIAL_SET_MAPPINGS);
  const levelinfo = buildLevelInfoPayload();
  return [
    {
      bool: {
        ShowDefaultCarAsOwned: true,
        StoreCurrencyBonusInPercentage: true,
        GrantFuelOnLevelup: true,
        beginnerSaleEnabled: true,
        RaceWarsToggle: true,
        GarageShowVUSaleFlag: true,
        GarageShowPUSaleFlag: true,
        GarageShowGachaSaleFlag: true,
        PremiumAccountOn: true,
        PremiumAccountUseOffer: false,
        ShowGachaVIPBonus: true
      },
      string: {
        BeginnerSaleFreeCarName: 'car_attribute_bmw_m3_e30',
        GachaSetsByTutorialNameJson: gachaSetsByTutorialNameJson,
        GachaSetDefault: 'base',
        GachaSetStoryRewards: 'story',
        GachaBriefcaseSet: 'briefcase',
        GachaEventSet: 'events'
      },
      float: {
        ToggleDelay: 0,
        SoundMinRadius: 0,
        FlipCarSuccessSpeedMultiplier: 1.5,
        StyleBonusDisplayPixelsPerLevelItem: 1,
        StyleBonusDisplayLevelItemBackgroundWidth: 1,
        PremiumAccountXpBonus: 0.25,
        PremiumAccountCoinsBonus: 0.25,
        PremiumAccountDiscount: 0.1
      },
      int: {
        DefaultSoftCurrency: 1000,
        DeliveryCostLevel1: 0,
        DeliveryTimeLevel1: 0,
        EnergyRegenTime: 300,
        EnergyMax: 7,
        EnergyUpgrade: 3,
        FuelCost: 2,
        FuelUpgradeCost: 20,
        BeginnerSaleDurationHours: 72,
        BeginnerSaleBonusGold: 50,
        PremiumAccountCost: 150,
        PremiumAccountOfferCost: 0,
        PremiumAccountDuration: 2592000
      },
      dailyrewardinfo: [
        {
          r: [100, 200, 300]
        }
      ],
      mapicontoggle: buildMapIconTogglePayload(levelinfo),
      levelinfo,
      GachaSetsByTutorialNameJson: gachaSetsByTutorialNameJson,
      GachaSetDefault: 'base',
      GachaSetStoryRewards: 'story',
      GachaBriefcaseSet: 'briefcase',
      GachaEventSet: 'events',
      'tuning.ShowDefaultCarAsOwned': true,
      'tuning.StoreCurrencyBonusInPercentage': true,
      'tuning.GrantFuelOnLevelup': true,
      'tuning.ToggleDelay': 0,
      'tuning.SoundMinRadius': 0,
      'tuning.FlipCarSuccessSpeedMultiplier': 1.5,
      'tuning.StyleBonusDisplayPixelsPerLevelItem': 1,
      'tuning.StyleBonusDisplayLevelItemBackgroundWidth': 1,
      'tuning.stylebonusdisplaypixelsperlevelitem': 1,
      'tuning.stylebonusdisplaylevelitembackgroundwidth': 1,
      'tuning.DeliveryCostLevel1': 0,
      'tuning.DeliveryTimeLevel1': 0,
      'tuning.BeginnerSaleFreeCarName': 'bmw_m3_e30',
      'tuning.BeginnerSaleDurationHours': 72,
      'tuning.BeginnerSaleBonusGold': 50,
      'tuning.GachaSetsByTutorialNameJson': gachaSetsByTutorialNameJson,
      'tuning.GachaSetDefault': 'base',
      'tuning.GachaSetStoryRewards': 'story',
      'tuning.GachaBriefcaseSet': 'briefcase',
      'tuning.GachaEventSet': 'events',
      'tuning.beginnerSaleEnabled': true,
      'tuning.RaceWarsToggle': true,
      'GarageShowVUSaleFlag': true,
      'GarageShowPUSaleFlag': true,
      'GarageShowGachaSaleFlag': true,
      'PremiumAccountOn': true,
      'PremiumAccountUseOffer': false,
      'PremiumAccountCost': 150,
      'PremiumAccountOfferCost': 0,
      'PremiumAccountDuration': 2592000,
      'PremiumAccountXpBonus': 0.25,
      'PremiumAccountCoinsBonus': 0.25,
      'PremiumAccountDiscount': 0.1,
      'ShowGachaVIPBonus': true
    }
  ];
}

function buildObjectivesPayload() {
  const next = Math.floor(nowTs() / 86400) * 86400 + 86400;
  return {
    car: {
      _id: `obj_car_${next}`,
      category: 'car',
      name: '',
      description: '',
      data: [],
      current: 0,
      target: 5,
      complete: 0,
      next,
      type: 'rw',
      rewarded: false,
      isNew: false,
      first: false,
      rewards: [{ type: 'sc', data: '', quantity: 6000 }]
    },
    mid: {
      _id: `obj_mid_${next}`,
      category: 'mid',
      name: '',
      description: '',
      data: [],
      current: 0,
      target: 10,
      complete: 0,
      next,
      type: 'pd',
      rewarded: false,
      isNew: false,
      first: false,
      rewards: [{ type: 'hc', data: '', quantity: 4 }]
    },
    long: {
      _id: `obj_long_${next}`,
      category: 'long',
      name: '',
      description: '',
      data: [],
      current: 0,
      target: 15,
      complete: 0,
      next,
      type: 'pu',
      rewarded: false,
      isNew: false,
      first: false,
      rewards: [{ type: 'hc', data: '', quantity: 8 }]
    }
  };
}

function applyTutorialNodeMeta(node, options = {}) {
  const next = node || {};
  const tutorialId = Object.prototype.hasOwnProperty.call(options, 'tutorialId')
    ? String(options.tutorialId == null ? '' : options.tutorialId)
    : String(next.tutorialId || next.tutorialID || FF7_TUTORIAL_ID);
  const rawGroupId = Object.prototype.hasOwnProperty.call(options, 'groupId')
    ? options.groupId
    : firstDefined(next.tutorialGroupId, next.branchId, FF7_TUTORIAL_GROUP_ID);
  const groupId = normalizeTutorialBranchId(rawGroupId, '');
  const jumpRaceId = Object.prototype.hasOwnProperty.call(options, 'jumpRaceId')
    ? String(options.jumpRaceId || '')
    : getTutorialBranchRaceId(groupId, '');
  const state = Number.isFinite(options.state) ? options.state : Number(next.State || next.state || 0);
  const tutorialRunning = Boolean(options.tutorialRunning);
  const tutorialGroupRunning = Boolean(options.tutorialGroupRunning);
  const tutorialGroupCompleted = Boolean(options.tutorialGroupCompleted);

  next.State = state;
  next.state = state;
  next.tutorialID = tutorialId;
  next.tutorialId = tutorialId;
  next.tutorialGroupId = groupId;
  next.branchId = groupId;
  next.JumpToRaceID = jumpRaceId;
  next.JumpToRaceId = jumpRaceId;
  next.jumpToRaceId = jumpRaceId;
  next.JumpToRaceIds = jumpRaceId ? [jumpRaceId] : [];
  next.jumpToRaceIds = jumpRaceId ? [jumpRaceId] : [];
  next.tutorialRunning = tutorialRunning;
  next.tutorialGroupRunning = tutorialGroupRunning;
  next.tutorialGroupCompleted = tutorialGroupCompleted;
  next.tutorialComplete = tutorialGroupCompleted;
  next.completed = tutorialGroupCompleted;
  next.Branches = next.Branches || {};
  next.branches = next.branches || next.Branches;
  next.Tutorials = next.Tutorials || {};
  next.tutorials = next.tutorials || next.Tutorials;
  return next;
}

function createTutorialBranchState(state = 0, options = {}) {
  return applyTutorialNodeMeta(
    {
      Branches: {},
      branches: {},
      Tutorials: {},
      tutorials: {}
    },
    { ...options, state }
  );
}

function toSparxTutorialStateValue(state) {
  const normalizedState = Number(state || 0);
  if (normalizedState >= 2) {
    return 'completed';
  }
  if (normalizedState === 1) {
    return 'started';
  }
  return 'not_started';
}

function buildSparxTutorialBranchStateMap(branchStates = {}) {
  return Object.entries(branchStates || {}).reduce((acc, [branchId, state]) => {
    const normalizedBranchId = normalizeTutorialBranchId(branchId, '');
    if (!normalizedBranchId) {
      return acc;
    }
    acc[normalizedBranchId] = toSparxTutorialStateValue(state);
    return acc;
  }, {});
}

function buildSparxTutorialUserDataShape(currentBid, state, branchStates = {}) {
  return {
    current_bid: normalizeTutorialBranchId(currentBid, ''),
    s: toSparxTutorialStateValue(state),
    branches: buildSparxTutorialBranchStateMap(branchStates)
  };
}

function buildContextualTutorialUserDataNode(tutorialId, branchId, state = 1) {
  const normalizedTutorialId = String(tutorialId || '').trim();
  const normalizedBranchId = normalizeTutorialBranchId(branchId || tutorialId, normalizedTutorialId);
  const jumpRaceId = getTutorialBranchRaceId(normalizedBranchId, '');
  const node = createTutorialBranchState(state, {
    tutorialId: normalizedTutorialId,
    groupId: normalizedBranchId,
    jumpRaceId,
    tutorialRunning: state === 1,
    tutorialGroupRunning: state === 1,
    tutorialGroupCompleted: state >= 2
  });
  node.Branches[normalizedBranchId] = createTutorialBranchState(state, {
    tutorialId: normalizedTutorialId,
    groupId: normalizedBranchId,
    jumpRaceId,
    tutorialRunning: state === 1,
    tutorialGroupRunning: state === 1,
    tutorialGroupCompleted: state >= 2
  });
  node.branches = node.Branches;
  node.Tutorials[normalizedTutorialId] = {
    tutorialID: normalizedTutorialId,
    tutorialId: normalizedTutorialId,
    tutorialGroupId: normalizedBranchId,
    branchId: normalizedBranchId,
    JumpToRaceID: jumpRaceId,
    JumpToRaceId: jumpRaceId,
    jumpToRaceId: jumpRaceId,
    JumpToRaceIds: jumpRaceId ? [jumpRaceId] : [],
    jumpToRaceIds: jumpRaceId ? [jumpRaceId] : [],
    tutorialRunning: state === 1,
    tutorialGroupRunning: state === 1,
    tutorialGroupCompleted: state >= 2,
    tutorialComplete: state >= 2,
    completed: state >= 2,
    State: state,
    state
  };
  node.tutorials = node.Tutorials;
  return node;
}

function mergeTutorialMirrorIntoResult(result, tutorialId, branchId, state = 1) {
  if (!result || typeof result !== 'object') {
    return result;
  }

  const normalizedTutorialId = String(tutorialId || '').trim();
  if (!normalizedTutorialId) {
    return result;
  }

  const normalizedBranchId = normalizeTutorialBranchId(branchId || tutorialId, normalizedTutorialId);
  const tutorialNode = buildContextualTutorialUserDataNode(normalizedTutorialId, normalizedBranchId, state);
  const sparxState = buildSparxTutorialUserDataShape(normalizedBranchId, state, {
    [normalizedBranchId]: state
  });
  const tutorialDataEntryKey = `${normalizedTutorialId}:${normalizedBranchId}`;
  const tutorialDataEntry = {
    key: tutorialDataEntryKey,
    started: state === 1,
    completed: state >= 2,
    updatedAt: nowTs()
  };

  result[normalizedTutorialId] = clone(sparxState);
  if (normalizedBranchId !== normalizedTutorialId) {
    result[normalizedBranchId] = clone(tutorialNode.Branches[normalizedBranchId]);
  }

  result.tut = result.tut && typeof result.tut === 'object' ? result.tut : {};
  result.tut[normalizedTutorialId] = clone(sparxState);

  result.userData = result.userData && typeof result.userData === 'object' ? result.userData : {};
  result.userData[normalizedTutorialId] = clone(tutorialNode);

  if (Array.isArray(result.tutorialData)) {
    const existingIndex = result.tutorialData.findIndex((entry) => String(entry && entry.key || '') === tutorialDataEntryKey);
    if (existingIndex === -1) {
      result.tutorialData.push(clone(tutorialDataEntry));
    } else {
      result.tutorialData[existingIndex] = {
        ...result.tutorialData[existingIndex],
        ...tutorialDataEntry
      };
    }
  }

  if (Array.isArray(result.tutorialDataList)) {
    const existingIndex = result.tutorialDataList.findIndex((entry) => String(entry && entry.key || '') === tutorialDataEntryKey);
    if (existingIndex === -1) {
      result.tutorialDataList.push(clone(tutorialDataEntry));
    } else {
      result.tutorialDataList[existingIndex] = {
        ...result.tutorialDataList[existingIndex],
        ...tutorialDataEntry
      };
    }
  }

  return result;
}

function cloneTutorialUserData(userData) {
  const cloned = clone(userData || {});
  Object.keys(cloned).forEach((key) => {
    const node = cloned[key];
    if (!node || typeof node !== 'object') return;
    if (!node.Branches && node.branches) node.Branches = clone(node.branches);
    if (!node.branches && node.Branches) node.branches = clone(node.Branches);
    if (!node.Tutorials && node.tutorials) node.Tutorials = clone(node.tutorials);
    if (!node.tutorials && node.Tutorials) node.tutorials = clone(node.Tutorials);
    applyTutorialNodeMeta(node, {
      tutorialId: key.startsWith('G') ? FF7_TUTORIAL_ID : key,
      groupId: key.startsWith('G') ? normalizeTutorialBranchId(key, FF7_TUTORIAL_GROUP_ID) : FF7_TUTORIAL_GROUP_ID,
      tutorialRunning: node.state === 1 || node.State === 1,
      tutorialGroupRunning: node.state === 1 || node.State === 1,
      tutorialGroupCompleted: node.state === 2 || node.State === 2
    });
  });
  return cloned;
}

function parseTutorialNumericId(value, prefix) {
  const match = String(value || '').match(new RegExp(`^${prefix}(\\d+)$`));
  return match ? parseInt(match[1], 10) : 0;
}

function ensureSparxState(userId) {
  const user = getUser(userId);
  const profile = getProfile(userId);
  let changed = false;
  const normalizedLevel = getNormalizedProfileLevel(profile);
  const normalizedXp = getNormalizedProfileXp(profile);
  const normalizedMiles = getNormalizedProfileMiles(profile);
  const normalizedRespectPoints = Number(profile.respectPoints || profile.rp || 0);
  const normalizedNextLevelXP = Number(profile.nextLevelXP || profile.NextLevelXP || 1000);
  const normalizedLevelRewards = Array.isArray(profile.levelRewards) ? clone(profile.levelRewards) : [];
  const normalizedNextLevelRewards = Array.isArray(profile.nextLevelRewards) ? clone(profile.nextLevelRewards) : [];
  const normalizedPrevLevelRewards = Array.isArray(profile.prevLevelRewards) ? clone(profile.prevLevelRewards) : [];

  if (profile.level !== normalizedLevel) {
    profile.level = normalizedLevel;
    changed = true;
  }

  if (profile.Level !== normalizedLevel) {
    profile.Level = normalizedLevel;
    changed = true;
  }

  if (profile.PlayerLevel !== normalizedLevel) {
    profile.PlayerLevel = normalizedLevel;
    changed = true;
  }

  if (profile.Rank !== normalizedLevel) {
    profile.Rank = normalizedLevel;
    changed = true;
  }

  if (profile.xp !== normalizedXp) {
    profile.xp = normalizedXp;
    changed = true;
  }

  if (profile.XP !== normalizedXp) {
    profile.XP = normalizedXp;
    changed = true;
  }

  if (profile.currentXP !== normalizedXp) {
    profile.currentXP = normalizedXp;
    changed = true;
  }

  if (profile.rp !== normalizedRespectPoints) {
    profile.rp = normalizedRespectPoints;
    changed = true;
  }

  if (profile.respectPoints !== normalizedRespectPoints) {
    profile.respectPoints = normalizedRespectPoints;
    changed = true;
  }

  if (Number(profile.nextLevelXP || 0) !== normalizedNextLevelXP) {
    profile.nextLevelXP = normalizedNextLevelXP;
    changed = true;
  }

  if (Number(profile.NextLevelXP || 0) !== normalizedNextLevelXP) {
    profile.NextLevelXP = normalizedNextLevelXP;
    changed = true;
  }

  if (JSON.stringify(profile.levelRewards || []) !== JSON.stringify(normalizedLevelRewards)) {
    profile.levelRewards = clone(normalizedLevelRewards);
    changed = true;
  }

  if (JSON.stringify(profile.nextLevelRewards || []) !== JSON.stringify(normalizedNextLevelRewards)) {
    profile.nextLevelRewards = clone(normalizedNextLevelRewards);
    changed = true;
  }

  if (JSON.stringify(profile.prevLevelRewards || []) !== JSON.stringify(normalizedPrevLevelRewards)) {
    profile.prevLevelRewards = clone(normalizedPrevLevelRewards);
    changed = true;
  }

  if (profile.Miles !== normalizedMiles) {
    profile.Miles = normalizedMiles;
    changed = true;
  }

  if (Array.isArray(profile.OwnedVehicles)) {
    const normalizedOwnedVehicles = profile.OwnedVehicles
      .map((tag) => remapGarageVehicleTag(tag, getDefaultProfileVehicleTag()))
      .filter((tag, index, list) => list.indexOf(tag) === index);
    if (JSON.stringify(normalizedOwnedVehicles) !== JSON.stringify(profile.OwnedVehicles)) {
      profile.OwnedVehicles = normalizedOwnedVehicles;
      changed = true;
    }
  }

  if (profile.CurrentVehicleTag !== remapGarageVehicleTag(profile.CurrentVehicleTag, getDefaultProfileVehicleTag())) {
    profile.CurrentVehicleTag = remapGarageVehicleTag(profile.CurrentVehicleTag, getDefaultProfileVehicleTag());
    changed = true;
  }

  if (profile.OwnedVehiclesStatus && typeof profile.OwnedVehiclesStatus === 'object') {
    Object.keys(vehicleAssetAliases).forEach((legacyTag) => {
      const assetTag = String(vehicleAssetAliases[legacyTag]);
      if (Object.prototype.hasOwnProperty.call(profile.OwnedVehiclesStatus, legacyTag) && !Object.prototype.hasOwnProperty.call(profile.OwnedVehiclesStatus, assetTag)) {
        profile.OwnedVehiclesStatus[assetTag] = profile.OwnedVehiclesStatus[legacyTag];
        changed = true;
      }
      if (Object.prototype.hasOwnProperty.call(profile.OwnedVehiclesStatus, legacyTag)) {
        delete profile.OwnedVehiclesStatus[legacyTag];
        changed = true;
      }
    });
  }

  if (!user.sparx || typeof user.sparx !== 'object') {
    user.sparx = {};
    changed = true;
  }

  if (!user.sparx.ds || typeof user.sparx.ds !== 'object') {
    user.sparx.ds = {};
    changed = true;
  }

  if (!user.sparx.dataStore || typeof user.sparx.dataStore !== 'object') {
    user.sparx.dataStore = buildDefaultDataStore(userId);
    changed = true;
  }

  if (!user.sparx.dataStore.profile || typeof user.sparx.dataStore.profile !== 'object') {
    user.sparx.dataStore.profile = {};
    changed = true;
  }

  if (normalizeTutorialStartingResources(profile)) {
    changed = true;
  }

  if (normalizeTutorialStartingResources(user.sparx.dataStore.profile)) {
    changed = true;
  }

  if (syncTutorialStartingResourcesAcrossProfiles(profile, user.sparx.dataStore.profile)) {
    changed = true;
  }

  if (!user.sparx.messaging || typeof user.sparx.messaging !== 'object') {
    user.sparx.messaging = { messages: [] };
    changed = true;
  }

  if (!Array.isArray(user.sparx.messaging.messages)) {
    user.sparx.messaging.messages = [];
    changed = true;
  } else {
    const normalizedMessages = user.sparx.messaging.messages
      .map((entry, index) => normalizeStoredMessage(entry, index))
      .filter(Boolean);
    if (JSON.stringify(normalizedMessages) !== JSON.stringify(user.sparx.messaging.messages)) {
      user.sparx.messaging.messages = normalizedMessages;
      changed = true;
    }
  }

  if (!user.sparx.chat || typeof user.sparx.chat !== 'object') {
    user.sparx.chat = { friends: [], bans: {} };
    changed = true;
  }

  if (!Array.isArray(user.sparx.chat.friends)) {
    user.sparx.chat.friends = [];
    changed = true;
  } else {
    const normalizedFriends = Array.from(new Set(
      user.sparx.chat.friends
        .map((entry) => String(entry || '').trim())
        .filter(Boolean)
    ));
    if (JSON.stringify(normalizedFriends) !== JSON.stringify(user.sparx.chat.friends)) {
      user.sparx.chat.friends = normalizedFriends;
      changed = true;
    }
  }

  if (!user.sparx.chat.bans || typeof user.sparx.chat.bans !== 'object') {
    user.sparx.chat.bans = {};
    changed = true;
  }

  ['rank', 'Rank', 'level', 'Level', 'PlayerLevel'].forEach((key) => {
    if (user.sparx.dataStore.profile[key] !== normalizedLevel) {
      user.sparx.dataStore.profile[key] = normalizedLevel;
      changed = true;
    }
  });

  if (user.sparx.dataStore.profile.xp !== normalizedXp) {
    user.sparx.dataStore.profile.xp = normalizedXp;
    changed = true;
  }

  if (user.sparx.dataStore.profile.XP !== normalizedXp) {
    user.sparx.dataStore.profile.XP = normalizedXp;
    changed = true;
  }

  if (user.sparx.dataStore.profile.currentXP !== normalizedXp) {
    user.sparx.dataStore.profile.currentXP = normalizedXp;
    changed = true;
  }

  if (user.sparx.dataStore.profile.rp !== normalizedRespectPoints) {
    user.sparx.dataStore.profile.rp = normalizedRespectPoints;
    changed = true;
  }

  if (user.sparx.dataStore.profile.respectPoints !== normalizedRespectPoints) {
    user.sparx.dataStore.profile.respectPoints = normalizedRespectPoints;
    changed = true;
  }

  if (Number(user.sparx.dataStore.profile.nextLevelXP || 0) !== normalizedNextLevelXP) {
    user.sparx.dataStore.profile.nextLevelXP = normalizedNextLevelXP;
    changed = true;
  }

  if (Number(user.sparx.dataStore.profile.NextLevelXP || 0) !== normalizedNextLevelXP) {
    user.sparx.dataStore.profile.NextLevelXP = normalizedNextLevelXP;
    changed = true;
  }

  if (JSON.stringify(user.sparx.dataStore.profile.levelRewards || []) !== JSON.stringify(normalizedLevelRewards)) {
    user.sparx.dataStore.profile.levelRewards = clone(normalizedLevelRewards);
    changed = true;
  }

  if (JSON.stringify(user.sparx.dataStore.profile.nextLevelRewards || []) !== JSON.stringify(normalizedNextLevelRewards)) {
    user.sparx.dataStore.profile.nextLevelRewards = clone(normalizedNextLevelRewards);
    changed = true;
  }

  if (JSON.stringify(user.sparx.dataStore.profile.prevLevelRewards || []) !== JSON.stringify(normalizedPrevLevelRewards)) {
    user.sparx.dataStore.profile.prevLevelRewards = clone(normalizedPrevLevelRewards);
    changed = true;
  }

  if (user.sparx.dataStore.profile.Miles !== normalizedMiles) {
    user.sparx.dataStore.profile.Miles = normalizedMiles;
    changed = true;
  }

  if (user.sparx.dataStore.stats && typeof user.sparx.dataStore.stats === 'object' && user.sparx.dataStore.stats.TOTAL_DISTANCE_DRIVEN !== normalizedMiles) {
    user.sparx.dataStore.stats.TOTAL_DISTANCE_DRIVEN = normalizedMiles;
    changed = true;
  }

  const tutorialStateForSync =
    user.sparx.tutorial && typeof user.sparx.tutorial === 'object'
      ? user.sparx.tutorial
      : { tutorialGroupsCompleted: [] };
  const rootTutorialCheckpoint = getEarlyTutorialCheckpoint(profile || {});
  const dataStoreTutorialCheckpoint = getEarlyTutorialCheckpoint(user.sparx.dataStore.profile || {});
  const rootTutorialStageNumber = parseTutorialNumericId(rootTutorialCheckpoint.activeBranchId, 'G');
  const dataStoreTutorialStageNumber = parseTutorialNumericId(dataStoreTutorialCheckpoint.activeBranchId, 'G');
  const rootWonRaceCount = profile && profile.won_races && typeof profile.won_races === 'object'
    ? Object.keys(profile.won_races).length
    : 0;
  const dataStoreWonRaceCount = user.sparx.dataStore.profile && user.sparx.dataStore.profile.won_races && typeof user.sparx.dataStore.profile.won_races === 'object'
    ? Object.keys(user.sparx.dataStore.profile.won_races).length
    : 0;
  const rootProfileAheadOfDataStore =
    rootTutorialStageNumber > dataStoreTutorialStageNumber ||
    (rootTutorialStageNumber === dataStoreTutorialStageNumber && rootWonRaceCount > dataStoreWonRaceCount);

  if (rootProfileAheadOfDataStore) {
    if (syncTutorialProgressionFields(user.sparx.dataStore.profile, profile)) {
      changed = true;
    }
    if (rootTutorialCheckpoint.activeBranchId) {
      syncTutorialStateToBranch(
        tutorialStateForSync,
        FF7_TUTORIAL_ID,
        rootTutorialCheckpoint.activeBranchId,
        { completedBranchIds: rootTutorialCheckpoint.completedBranchIds }
      );
      changed = true;
    }
  }
  const tutorialProfileVehicleTag = getActiveTutorialVehicleTag(tutorialStateForSync);
  const tutorialIntroActive = isIntroTutorialActive(tutorialStateForSync);
  const rawActiveTutorialId = String(
    firstDefined(
      tutorialStateForSync.currentTutorialId,
      tutorialStateForSync.activeTutorial && tutorialStateForSync.activeTutorial.tid,
      ''
    )
  ).trim();
  const contextualTutorialActive = isContextualTutorialId(rawActiveTutorialId);
  const earlyTutorialCheckpoint = getEarlyTutorialCheckpoint(user.sparx.dataStore.profile || {});
  if (earlyTutorialCheckpoint && !contextualTutorialActive && !tutorialIntroActive) {
    const activeBranchId = normalizeTutorialBranchId(
      firstDefined(
        tutorialStateForSync.currentTutorialGroupId,
        tutorialStateForSync.activeTutorial && tutorialStateForSync.activeTutorial.bid,
        ''
      ),
      ''
    );
    const activeBranchNumber = parseTutorialNumericId(activeBranchId, 'G');
    const checkpointBranchNumber = parseTutorialNumericId(earlyTutorialCheckpoint.activeBranchId, 'G');
    const shouldAdvanceToCheckpoint =
      !activeBranchId || (checkpointBranchNumber > 0 && activeBranchNumber < checkpointBranchNumber);
    const checkpointCompletedAll =
      !earlyTutorialCheckpoint.activeBranchId &&
      Array.isArray(earlyTutorialCheckpoint.completedBranchIds) &&
      earlyTutorialCheckpoint.completedBranchIds.length > 0;
    if (checkpointCompletedAll) {
      syncTutorialStateToBranch(
        tutorialStateForSync,
        FF7_TUTORIAL_ID,
        '',
        { completedBranchIds: earlyTutorialCheckpoint.completedBranchIds }
      );
      changed = true;
    } else if (shouldAdvanceToCheckpoint) {
      syncTutorialStateToBranch(
        tutorialStateForSync,
        FF7_TUTORIAL_ID,
        earlyTutorialCheckpoint.activeBranchId,
        { completedBranchIds: earlyTutorialCheckpoint.completedBranchIds }
      );
      changed = true;
    } else if (Array.isArray(earlyTutorialCheckpoint.completedBranchIds) && tutorialStateForSync && typeof tutorialStateForSync === 'object') {
      // Keep minimum completed baseline from profile without regressing active branch.
      if (!Array.isArray(tutorialStateForSync.tutorialGroups)) tutorialStateForSync.tutorialGroups = [];
      if (!Array.isArray(tutorialStateForSync.tutorialGroupsCompleted)) tutorialStateForSync.tutorialGroupsCompleted = [];
      earlyTutorialCheckpoint.completedBranchIds.forEach((branchId) => {
        const normalizedBranchId = normalizeTutorialBranchId(branchId, '');
        if (!normalizedBranchId) return;
        if (tutorialStateForSync.tutorialGroups.indexOf(normalizedBranchId) === -1) {
          tutorialStateForSync.tutorialGroups.push(normalizedBranchId);
          changed = true;
        }
        if (tutorialStateForSync.tutorialGroupsCompleted.indexOf(normalizedBranchId) === -1) {
          tutorialStateForSync.tutorialGroupsCompleted.push(normalizedBranchId);
          changed = true;
        }
      });
    }
    if (shouldAdvanceToCheckpoint && applyEarlyTutorialCheckpointProfile(user.sparx.dataStore.profile, earlyTutorialCheckpoint.activeBranchId)) {
      changed = true;
    }
  }
  if ((tutorialIntroActive || tutorialProfileVehicleTag) && syncTutorialVehicleProfile(profile, tutorialStateForSync)) {
    changed = true;
  }

  if (tutorialIntroActive ? forceTutorialProgressionProfile(user.sparx.dataStore.profile) : normalizeTutorialProgressionProfile(user.sparx.dataStore.profile)) {
    changed = true;
  }

  const activeVehicle = String(remapGarageVehicleTag(
    getDesiredProfileVehicleTag(profile, tutorialStateForSync),
    getDefaultProfileVehicleTag()
  ));
  const ownerUid = getProfileUidValue(profile, userId);
  const desiredCarsRoot = buildCarsRoot(userId);
  const desiredBucket = desiredCarsRoot && desiredCarsRoot[ownerUid] && typeof desiredCarsRoot[ownerUid] === 'object'
    ? desiredCarsRoot[ownerUid]
    : {};
  const explicitActiveCarId = String(firstDefined(
    user && user.sparx && user.sparx.dataStore && user.sparx.dataStore.profile && (
      user.sparx.dataStore.profile.active_carid ||
      user.sparx.dataStore.profile.activeCarId
    ),
    profile.active_carid,
    profile.activeCarId,
    ''
  ) || '').trim();
  const explicitActiveCarRecord = explicitActiveCarId ? desiredBucket[explicitActiveCarId] : null;
  const expectedPrimaryCar = clone(
    explicitActiveCarRecord ||
    Object.values(desiredBucket).find((record) => String(record && record.carId || '') === activeVehicle) ||
    Object.values(desiredBucket)[0] ||
    (FF7_SKIP_TUTORIAL_TO_GARAGE
      ? buildGarageCarRecord(activeVehicle, ownerUid, 0)
      : buildOwnedCarRecord(activeVehicle, ownerUid, 0))
  );
  const expectedActiveRecipeHash = Number(
    expectedPrimaryCar && expectedPrimaryCar.recipe ? expectedPrimaryCar.recipe.hash : 0
  );
  const expectedPrimaryCarId = String(expectedPrimaryCar && (expectedPrimaryCar._id || expectedPrimaryCar.id) || '');
  const expectedPrimaryVehicleTag = String(expectedPrimaryCar && (expectedPrimaryCar.carId || expectedPrimaryCar.car) || activeVehicle || '');

  if (expectedPrimaryVehicleTag && profile.CurrentVehicleTag !== expectedPrimaryVehicleTag) {
    profile.CurrentVehicleTag = expectedPrimaryVehicleTag;
    changed = true;
  }

  if (expectedPrimaryVehicleTag && profile.currentVehicleTag !== expectedPrimaryVehicleTag) {
    profile.currentVehicleTag = expectedPrimaryVehicleTag;
    changed = true;
  }

  if (profile.active_carid !== expectedPrimaryCarId) {
    profile.active_carid = expectedPrimaryCarId;
    changed = true;
  }

  if (profile.activeCarId !== expectedPrimaryCarId) {
    profile.activeCarId = expectedPrimaryCarId;
    changed = true;
  }

  if (Number(profile.active_recipe || 0) !== expectedActiveRecipeHash) {
    profile.active_recipe = expectedActiveRecipeHash;
    changed = true;
  }

  if (!user.sparx.dataStore.profile.active_carid) {
    user.sparx.dataStore.profile.active_carid = expectedPrimaryCar._id;
    changed = true;
  }

  if (user.sparx.dataStore.profile.active_carid !== expectedPrimaryCar._id) {
    user.sparx.dataStore.profile.active_carid = expectedPrimaryCar._id;
    changed = true;
  }

  if (user.sparx.dataStore.profile.activeCarId !== expectedPrimaryCar._id) {
    user.sparx.dataStore.profile.activeCarId = expectedPrimaryCar._id;
    changed = true;
  }

  if (Number(user.sparx.dataStore.profile.active_recipe || 0) !== expectedActiveRecipeHash) {
    user.sparx.dataStore.profile.active_recipe = expectedActiveRecipeHash;
    changed = true;
  }

  if (!user.sparx.dataStore.car || typeof user.sparx.dataStore.car !== 'object') {
    user.sparx.dataStore.car = {};
    changed = true;
  }

  if (!user.sparx.dataStore.car.r || typeof user.sparx.dataStore.car.r !== 'object') {
    user.sparx.dataStore.car.r = {};
    changed = true;
  }

  if (JSON.stringify(user.sparx.dataStore.car) !== JSON.stringify(expectedPrimaryCar)) {
    user.sparx.dataStore.car = clone(expectedPrimaryCar);
    changed = true;
  }
  if (user.sparx.dataStore.car.uid !== ownerUid) {
    user.sparx.dataStore.car.uid = ownerUid;
    changed = true;
  }

  if (user.sparx.dataStore.car.userId !== ownerUid) {
    user.sparx.dataStore.car.userId = ownerUid;
    changed = true;
  }

  if (user.sparx.dataStore.car._id !== expectedPrimaryCar._id) {
    user.sparx.dataStore.car._id = expectedPrimaryCar._id;
    changed = true;
  }

  if (user.sparx.dataStore.car.id !== expectedPrimaryCar.id) {
    user.sparx.dataStore.car.id = expectedPrimaryCar.id;
    changed = true;
  }

  if (user.sparx.dataStore.car.carId !== expectedPrimaryCar.carId) {
    user.sparx.dataStore.car.carId = expectedPrimaryCar.carId;
    changed = true;
  }

  if (JSON.stringify(user.sparx.dataStore.car.r) !== JSON.stringify(expectedPrimaryCar.r)) {
    user.sparx.dataStore.car.r = clone(expectedPrimaryCar.r);
    changed = true;
  }

  if (user.sparx.dataStore.car.q !== expectedPrimaryCar.q) {
    user.sparx.dataStore.car.q = expectedPrimaryCar.q;
    changed = true;
  }

  if (user.sparx.dataStore.car.e !== expectedPrimaryCar.e) {
    user.sparx.dataStore.car.e = expectedPrimaryCar.e;
    changed = true;
  }

  if (!user.sparx.dataStore.car.unlocks || typeof user.sparx.dataStore.car.unlocks !== 'object') {
    user.sparx.dataStore.car.unlocks = { values: ['class_1'] };
    changed = true;
  }

  if (!user.sparx.dataStore.cars || typeof user.sparx.dataStore.cars !== 'object') {
    user.sparx.dataStore.cars = desiredCarsRoot;
    changed = true;
  } else {
    const desiredOwnerUid = Object.keys(desiredCarsRoot)[0];
    const desiredBucket = desiredCarsRoot[desiredOwnerUid];
    const existingBucket = user.sparx.dataStore.cars[desiredOwnerUid];
    if (!existingBucket || typeof existingBucket !== 'object') {
      user.sparx.dataStore.cars = desiredCarsRoot;
      changed = true;
    } else {
      const existingKeys = Object.keys(existingBucket);
      const desiredKeys = Object.keys(desiredBucket);
      const bucketsMatch =
        existingKeys.length === desiredKeys.length &&
        desiredKeys.every((carKey) => {
          const existing = existingBucket[carKey];
          const desired = desiredBucket[carKey];
          return existing &&
            existing._id === desired._id &&
            existing.carId === desired.carId &&
            Number(existing.pi || 0) === Number(desired.pi || 0) &&
            existing.r &&
            existing.r.n === desired.r.n &&
            JSON.stringify(existing.r) === JSON.stringify(desired.r);
        });
      if (!bucketsMatch) {
        user.sparx.dataStore.cars = desiredCarsRoot;
        changed = true;
      }
    }
  }

  if (!user.sparx.tutorial || typeof user.sparx.tutorial !== 'object') {
    const _skipToGarage = FF7_SKIP_TUTORIAL_TO_GARAGE || shouldCompleteTutorialsOnFreshSave(user.sparx.dataStore.profile || profile || {});
    const _initGroups = _skipToGarage
      ? FF7_TUTORIAL_BRANCH_IDS.slice()
      : [];
    user.sparx.tutorial = {
      api: 1,
      dbHash: FF7_TUTORIAL_DB_HASH,
      currentTutorialId: null,
      currentTutorialGroupId: null,
      largestTutorialId: FF7_TUTORIAL_DB_LTID,
      largestTutorialGroupId: FF7_TUTORIAL_DB_LTGID,
      tutorials: [],
      tutorialGroups: _initGroups.slice(),
      tutorialGroupsCompleted: _initGroups.slice(),
      tutorialData: {},
      userData: {},
      activeTutorial: null
    };
    changed = true;
  }

  if (!user.sparx.tutorial.userData || typeof user.sparx.tutorial.userData !== 'object') {
    user.sparx.tutorial.userData = {};
    changed = true;
  }

  const bootstrapTutorialCheckpoint = getEarlyTutorialCheckpoint(user.sparx.dataStore.profile || profile || {});
  if (!user.sparx.tutorial.activeTutorial || typeof user.sparx.tutorial.activeTutorial !== 'object') {
    if (bootstrapTutorialCheckpoint.activeBranchId) {
      user.sparx.tutorial.activeTutorial = {
        tid: FF7_TUTORIAL_ID,
        bid: bootstrapTutorialCheckpoint.activeBranchId
      };
      if (user.sparx.tutorial.currentTutorialId !== FF7_TUTORIAL_ID) {
        user.sparx.tutorial.currentTutorialId = FF7_TUTORIAL_ID;
      }
      if (user.sparx.tutorial.currentTutorialGroupId !== bootstrapTutorialCheckpoint.activeBranchId) {
        user.sparx.tutorial.currentTutorialGroupId = bootstrapTutorialCheckpoint.activeBranchId;
      }
    } else {
      user.sparx.tutorial.activeTutorial = null;
      if (user.sparx.tutorial.currentTutorialId !== null) {
        user.sparx.tutorial.currentTutorialId = null;
      }
      if (user.sparx.tutorial.currentTutorialGroupId !== null) {
        user.sparx.tutorial.currentTutorialGroupId = null;
      }
    }
    changed = true;
  }

  if (user.sparx.tutorial.dbHash !== FF7_TUTORIAL_DB_HASH) {
    user.sparx.tutorial.dbHash = FF7_TUTORIAL_DB_HASH;
    changed = true;
  }

  if (normalizeTutorialState(user.sparx.tutorial, user.sparx.dataStore.profile || profile || {})) {
    changed = true;
  }

  if (!Array.isArray(user.sparx.prizes)) {
    user.sparx.prizes = [];
    changed = true;
  }

  if (!user.sparx.loginRewards || typeof user.sparx.loginRewards !== 'object') {
    user.sparx.loginRewards = {
      currentDay: 1,
      canClaim: true,
      lastClaimTs: 0
    };
    changed = true;
  }

  if (changed) {
    persistState();
  }

  return user.sparx;
}

function buildWalletResult(userId) {
  const profile = getProfile(userId);
  const user = getUser(userId);

  return {
    NoCoins: profile.NoCoins || 0,
    NoStars: profile.NoStars || 0,
    Fuel: profile.Fuel || 0,
    MaxFuel: profile.MaxFuel || 0,
    carTokens: typeof user.carTokenBalance === 'number' ? user.carTokenBalance : 12000,
    balances: {
      sc: profile.NoCoins || 0,
      hc: profile.NoStars || 0,
      fuel: profile.Fuel || 0
    }
  };
}

function buildInventoryResult(userId) {
  return buildFlatInventoryResult(userId);
}

function buildResourceTypePayload(amount, max = 0) {
  return {
    v: Math.max(0, Math.trunc(Number(amount || 0))),
    max: Math.max(0, Math.trunc(Number(max || 0))),
    nextGrowthAmount: 0,
    nextGrowthTime: 0,
    nextFullGrowthTime: 0,
    growthInterval: 0
  };
}

function buildResourceStatusMap(userId) {
  const profile = getProfile(userId);
  const xp = getNormalizedProfileXp(profile);
  const nextLevelXP = Number(profile.nextLevelXP || profile.NextLevelXP || 1000);
  const sc = Number(profile.NoCoins || profile.coins || 0);
  const hc = Number(profile.NoStars || profile.gold || 0);
  const fuel = Number(profile.Fuel || profile.fuel || 0);
  const maxFuel = Number(profile.MaxFuel || profile.maxFuel || 10);
  const maxCars = getNormalizedProfileMaxCars(profile);
  const maxMechanics = getNormalizedProfileMaxMechanics(profile);
  const resources = {
    xp: buildResourceTypePayload(xp, nextLevelXP),
    sc: buildResourceTypePayload(sc, 0),
    hc: buildResourceTypePayload(hc, 0),
    fuel: buildResourceTypePayload(fuel, maxFuel)
  };
  if (maxCars > 0) {
    resources.maxcars = buildResourceTypePayload(maxCars, maxCars);
  }
  if (maxMechanics > 0) {
    resources.maxmechanics = buildResourceTypePayload(maxMechanics, maxMechanics);
  }
  return resources;
}

function buildResourceResult(userId) {
  return buildResourceStatusMap(userId);
}

function clearPendingSequentialTransition(tutorial) {
  if (!tutorial || typeof tutorial !== 'object') return;
  delete tutorial.pendingCompletedTutorialId;
  delete tutorial.pendingCompletedBranchId;
  delete tutorial.pendingNextBranchId;
  delete tutorial.pendingNextRaceId;
  delete tutorial.pendingResolveRaceId;
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

function classToNumber(tag) {
  const canonicalTag = normalizeCarTuningAssetTag(tag) || String(tag || FF7_DEFAULT_CURRENT_CAR_ID);
  const vehicle = defaultVehicleDescriptions[canonicalTag] || {};
  switch (String(vehicle.PerformanceClass || '').toUpperCase()) {
    case 'S':
      return 4;
    case 'A':
      return 2;
    case 'B':
      return 1;
    case 'C':
    case 'D':
    default:
      return 0;
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

function buildCarTuningPartsPayload() {
  const tuningData = {
    '#vp_engine_1': '1&0.85',
    '#vp_engine_2': '2&1.00'
  };
  Object.values(defaultVehiclePurchasablesByVehicle || {}).forEach((items) => {
    (Array.isArray(items) ? items : []).forEach((item) => {
      if (!item || String(item.itemType || '') !== 'engineCC') {
        return;
      }
      const tag = String(item.itemTag || '').trim();
      if (!tag) {
        return;
      }
      tuningData[tag] = /_2$/.test(tag) ? '2&1.00' : '1&0.85';
    });
  });
  return {
    tuningData
  };
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

function clearRacePayload(result) {
  if (!result || typeof result !== 'object') {
    return result;
  }
  FF7_RACE_RESULT_KEYS.forEach((key) => {
    if (Object.prototype.hasOwnProperty.call(result, key)) {
      delete result[key];
    }
  });
  const emptyNextRaces = buildEmptyNextRacesPayload();
  result.nextRaces = clone(emptyNextRaces);
  result.raceData = [];
  result.chapterData = [];
  if (result.data && typeof result.data === 'object') {
    result.data.nextRaces = clone(emptyNextRaces);
    result.data.raceData = [];
    result.data.chapterData = [];
  }
  return result;
}

function buildTutorialResult(userId, options = {}) {
  const sparx = ensureSparxState(userId);
  const tutorial = sparx.tutorial;
  const profileProgress = getAuthoritativeSparxProfile(userId);
  const completeFreshSaveTutorials = shouldCompleteTutorialsOnFreshSave(profileProgress);
  if (FF7_SKIP_TUTORIAL_TO_GARAGE || completeFreshSaveTutorials) {
    normalizeTutorialState(tutorial, profileProgress);
    normalizeTutorialProgressionProfile(profileProgress);


    const requestedTid = String(options.tid || FF7_TUTORIAL_ID);
    const requestedBid = String(options.bid || FF7_TUTORIAL_GROUP_ID);
    const exposeActiveBranch = Boolean(options.exposeActiveBranch);
    const forceRunningBid = options.forceRunningBid || null;
    const tutorialDbPayload = buildDisabledTutorialDbPayload();
    const completedRoot = clone((tutorial.userData && tutorial.userData[FF7_TUTORIAL_ID]) || createTutorialBranchState(2, {
      tutorialId: FF7_TUTORIAL_ID,
      groupId: FF7_TUTORIAL_GROUP_ID,
      jumpRaceId: null,
      tutorialRunning: false,
      tutorialGroupRunning: false,
      tutorialGroupCompleted: true
    }));
    const branchMap = clone(completedRoot.Branches || completedRoot.branches || {});
    const completedBranch = clone(
      branchMap[FF7_TUTORIAL_GROUP_ID] ||
      createTutorialBranchState(2, {
        tutorialId: FF7_TUTORIAL_ID,
        groupId: FF7_TUTORIAL_GROUP_ID,
        jumpRaceId: null,
        tutorialRunning: false,
        tutorialGroupRunning: false,
        tutorialGroupCompleted: true
      })
    );
    // g4Running must be declared BEFORE responseBranch uses it
    const g4AlreadyDone = Array.isArray(tutorial.tutorialGroupsCompleted) &&
      tutorial.tutorialGroupsCompleted.indexOf('G4') !== -1;
    const completedTutorialStepValue = getCompletedTutorialStepValue();
    const hasCareerWins = Object.keys(profileProgress && typeof profileProgress.won_races === 'object' ? profileProgress.won_races : {})
      .some((raceId) => /^chapter_\d{2}_[a-z]$/i.test(String(raceId || '').trim()));
    const g4Running =
      FF7_SKIP_TUTORIAL_TO_GARAGE &&
      !g4AlreadyDone &&
      !hasCareerWins &&
      Math.max(0, Math.trunc(Number(profileProgress && profileProgress.tut_id || 0))) < completedTutorialStepValue;
    const responseBranch = g4Running
      ? createTutorialBranchState(1, {
          tutorialId: FF7_TUTORIAL_ID,
          groupId: 'G4',
          jumpRaceId: null,
          tutorialRunning: true,
          tutorialGroupRunning: true,
          tutorialGroupCompleted: false
        })
      : (exposeActiveBranch && requestedBid !== FF7_TUTORIAL_GROUP_ID
        ? createTutorialBranchState(2, {
            tutorialId: requestedTid,
            groupId: requestedBid,
            jumpRaceId: null,
            tutorialRunning: false,
            tutorialGroupRunning: false,
            tutorialGroupCompleted: true
          })
        : clone(completedBranch));
    const userData = clone(tutorial.userData || {});
    if (exposeActiveBranch) {
      const requestedRoot = createTutorialBranchState(2, {
        tutorialId: requestedTid,
        groupId: requestedBid,
        jumpRaceId: null,
        tutorialRunning: false,
        tutorialGroupRunning: false,
        tutorialGroupCompleted: true
      });
      requestedRoot.Branches = {
        [requestedBid]: clone(responseBranch)
      };
      requestedRoot.branches = requestedRoot.Branches;
      requestedRoot.Tutorials = {
        [requestedTid]: {
          tutorialID: requestedTid,
          tutorialId: requestedTid,
          tutorialGroupId: requestedBid,
          JumpToRaceID: '',
          JumpToRaceId: '',
          jumpToRaceId: '',
          JumpToRaceIds: [],
          jumpToRaceIds: [],
          tutorialRunning: false,
          tutorialGroupRunning: false,
          tutorialGroupCompleted: true,
          State: 2,
          state: 2
        }
      };
      requestedRoot.tutorials = requestedRoot.Tutorials;
      userData[requestedTid] = requestedRoot;
    }
    const tutorialDataMap = clone(tutorial.tutorialData || {});
    tutorialDataMap[`${FF7_TUTORIAL_ID}:${FF7_TUTORIAL_GROUP_ID}`] = {
      started: true,
      completed: true,
      updatedAt: nowTs()
    };
    const tutorialDataList = Object.entries(tutorialDataMap).map(([key, value]) => ({
      key,
      ...(clone(value) || {})
    }));
    const effectiveNextRaces = buildEmptyNextRacesPayload();
    const tutorials = [FF7_TUTORIAL_ID];
    const tutorialGroups = Array.from(new Set([...FF7_TUTORIAL_BRANCH_IDS, requestedBid,
      ...(Array.isArray(tutorial.tutorialGroups) ? tutorial.tutorialGroups : [])].filter(Boolean)));
    const completedBeforeG4 = getSequentialTutorialBranchIdsUpTo('G4', { inclusive: false });
    const tutorialGroupsCompleted = g4Running
      ? Array.from(new Set(completedBeforeG4.filter(Boolean)))
      : Array.from(new Set([...FF7_TUTORIAL_BRANCH_IDS, requestedBid,
          ...(Array.isArray(tutorial.tutorialGroupsCompleted) ? tutorial.tutorialGroupsCompleted : [])
        ].filter(Boolean)));
    const knownGroups = g4Running ? tutorialGroups : tutorialGroupsCompleted;
    const activeTutorial = g4Running
      ? { tid: FF7_TUTORIAL_ID, bid: 'G4' }
      : { tid: FF7_TUTORIAL_ID, bid: '' };
    if (!g4Running && !exposeActiveBranch) {
      const completedUserData = clone(userData);
      const completedRoot = createTutorialBranchState(2, {
        tutorialId: FF7_TUTORIAL_ID,
        groupId: '',
        jumpRaceId: null,
        tutorialRunning: false,
        tutorialGroupRunning: false,
        tutorialGroupCompleted: true
      });
      completedRoot.Branches = {};
      completedRoot.branches = completedRoot.Branches;
      completedRoot.Tutorials = {};
      completedRoot.tutorials = completedRoot.Tutorials;
      tutorialGroupsCompleted.forEach((branchId) => {
        completedRoot.Branches[branchId] = createTutorialBranchState(2, {
          tutorialId: FF7_TUTORIAL_ID,
          groupId: branchId,
          jumpRaceId: getTutorialBranchRaceId(branchId, ''),
          tutorialRunning: false,
          tutorialGroupRunning: false,
          tutorialGroupCompleted: true
        });
      });
      completedUserData[FF7_TUTORIAL_ID] = completedRoot;
      const completedResult = buildCompletedTutorialMirrorResult({
        tutorial,
        tutorialDbPayload,
        profileProgress,
        userData: completedUserData,
        tutorialDataMap,
        tutorialGroups,
        tutorialGroupsCompleted
      });
      logFf7Debug('tutorial/result', {
        userId,
        activeTutorial: completedResult.activeTutorial,
        profile: compactProfile(getProfile(userId)),
        branchState: {
          tutorialId: FF7_TUTORIAL_ID,
          branchId: '',
          state: 2,
          jumpToRaceId: null
        },
        progression: {
          crid: completedResult.progression.crid,
          jfrid: completedResult.progression.jfrid,
          cmid: completedResult.progression.cmid,
          currentRaceId: completedResult.progression.currentRaceId
        },
        race: null
      });
      return completedResult;
    }
    const result = {
      api: tutorial.api,
      dbHash: tutorial.dbHash,
      hash: tutorial.dbHash,
      changed: true,
      refresh: true,
      check: 'uhtotallysecure',
      connected: true,
      status: 'connected',
      branchData: clone(responseBranch),
      stateHash: tutorial.dbHash,
      state1Hash: tutorial.dbHash,
      state2Hash: tutorial.dbHash,
      JumpToRaceID: '',
      JumpToRaceIds: [],
      currentTutorialId: null,
      currentTutorialGroupId: null,
      largestTutorialId: 1,
      largestTutorialGroupId: knownGroups.reduce((max, g) => Math.max(max, parseInt(g.replace(/^G/i, ''), 10) || 0), 1),
      tutorials,
      tutorialGroups,
      tutorialGroupsCompleted,
      activeTutorial,
      ltid: tutorialDbPayload.ltid,
      ltgid: tutorialDbPayload.ltgid,
      dbhash: tutorialDbPayload.dbhash,
      nextRaces: clone(effectiveNextRaces),
      raceData: clone(effectiveNextRaces.raceData || []),
      chapterData: clone(effectiveNextRaces.chapterData || []),
      simMultipliers: {},
      progression: buildGarageTutorialProgression(profileProgress),
      tutorialData: tutorialDataList,
      tutorialDataList,
      tutorialDataMap: clone(tutorialDataMap),
      tutorialDataByKey: clone(tutorialDataMap),
      tutorialDb: clone(tutorialDbPayload),
      TutorialUserData: clone(userData),
      TutorialBranchData: clone(branchMap),
      tut: exposeActiveBranch ? {
        [requestedTid]: buildSparxTutorialUserDataShape(requestedBid, 2, {
          [requestedBid]: 2
        })
      } : {},
      userData,
      data: {
        tutorialId: exposeActiveBranch ? requestedTid : null,
        branchId: exposeActiveBranch ? requestedBid : null,
        branchData: clone(responseBranch),
        stateHash: tutorial.dbHash,
        state1Hash: tutorial.dbHash,
        state2Hash: tutorial.dbHash,
        userData,
        branches: exposeActiveBranch
          ? { [requestedBid]: clone(responseBranch) }
          : { [FF7_TUTORIAL_GROUP_ID]: clone(completedBranch) },
        currentTutorialId: null,
        currentTutorialGroupId: null,
        largestTutorialId: 1,
        largestTutorialGroupId: knownGroups.reduce((max, g) => Math.max(max, parseInt(g.replace(/^G/i, ''), 10) || 0), 1),
        tutorials,
        tutorialGroups,
        tutorialGroupsCompleted,
        activeTutorial,
        raceData: clone(effectiveNextRaces.raceData || []),
        chapterData: clone(effectiveNextRaces.chapterData || []),
        nextRaces: clone(effectiveNextRaces)
      },
      branches: exposeActiveBranch
        ? { [requestedBid]: clone(responseBranch) }
        : { [FF7_TUTORIAL_GROUP_ID]: clone(completedBranch) }
    };
    if (exposeActiveBranch) {
      result[requestedTid] = buildSparxTutorialUserDataShape(
        requestedBid,
        2,
        Object.keys(branchMap).reduce((acc, branchId) => {
          acc[branchId] = 2;
          return acc;
        }, {})
      );
      if (requestedBid !== requestedTid) {
        result[requestedBid] = clone(completedBranch);
      }
    }
    logFf7Debug('tutorial/result', {
      userId,
      activeTutorial: result.activeTutorial,
      profile: compactProfile(getProfile(userId)),
      branchState: {
        tutorialId: requestedTid,
        branchId: requestedBid,
        state: 2,
        jumpToRaceId: null
      },
      progression: {
        crid: result.progression.crid,
        jfrid: result.progression.jfrid,
        cmid: result.progression.cmid,
        currentRaceId: result.progression.currentRaceId
      },
      race: compactRace((effectiveNextRaces.raceData || [])[0] || null)
    });
    return result;
  }
  // If all sequential branches are complete, return a fully-completed tutorial state
  // so the game doesn't send the player back to chapter_00_a.
  if (!getFirstIncompleteTutorialBranchId(tutorial)) {
    const lastBranchId = '';
    const completedRoot = createTutorialBranchState(2, {
      tutorialId: FF7_TUTORIAL_ID,
      groupId: lastBranchId,
      jumpRaceId: null,
      tutorialRunning: false,
      tutorialGroupRunning: false,
      tutorialGroupCompleted: true
    });
    const completedBranchIds = FF7_TUTORIAL_BRANCH_IDS.slice();
    completedBranchIds.forEach((bid) => {
      completedRoot.Branches[bid] = createTutorialBranchState(2, {
        tutorialId: FF7_TUTORIAL_ID,
        groupId: bid,
        jumpRaceId: null,
        tutorialRunning: false,
        tutorialGroupRunning: false,
        tutorialGroupCompleted: true
      });
    });
    completedRoot.branches = completedRoot.Branches;
    tutorial.currentTutorialGroupId = '';
    tutorial.currentTutorialId = FF7_TUTORIAL_ID;
    if (tutorial.activeTutorial) {
      tutorial.activeTutorial.bid = '';
      tutorial.activeTutorial.tid = FF7_TUTORIAL_ID;
    }
    const tutorialDbPayload = buildTutorialDbPayload();
    const effectiveTutorialDbHash = String(tutorialDbPayload.dbhash || tutorial.dbHash || FF7_TUTORIAL_DB_HASH);
    const effectiveActiveTutorial = { tid: FF7_TUTORIAL_ID, bid: '' };
    const userData = cloneTutorialUserData(tutorial.userData);
    userData[FF7_TUTORIAL_ID] = clone(completedRoot);
    const careerNextRaces = buildCareerNextRacesPayload(userId);
    const tutorialDataMap = clone(tutorial.tutorialData || {});
    const result = buildCompletedTutorialMirrorResult({
      tutorial,
      tutorialDbPayload,
      profileProgress,
      userData,
      tutorialDataMap,
      tutorialGroups: completedBranchIds,
      tutorialGroupsCompleted: completedBranchIds
    });
    logFf7Debug('tutorial/result', {
      userId,
      activeTutorial: clone(effectiveActiveTutorial),
      branchState: { tutorialId: FF7_TUTORIAL_ID, branchId: '', state: 2, jumpToRaceId: null },
      progression: {
        crid: result.progression.crid,
        jfrid: result.progression.jfrid,
        cmid: result.progression.cmid,
        currentRaceId: result.progression.currentRaceId
      },
      race: null
    });
    return result;
  }

  const rawActiveTid = String(
    firstDefined(
      tutorial.activeTutorial && tutorial.activeTutorial.tid,
      tutorial.currentTutorialId,
      FF7_TUTORIAL_ID
    )
  ).trim() || FF7_TUTORIAL_ID;
  const rawActiveBid = normalizeTutorialBranchId(
    firstDefined(
      tutorial.activeTutorial && tutorial.activeTutorial.bid,
      tutorial.currentTutorialGroupId,
      rawActiveTid
    ),
    rawActiveTid
  );
  const contextualActive = isContextualTutorialId(rawActiveTid);
  const sequentialActiveBid = getEffectiveTutorialBranchId(tutorial, profileProgress);
  const preferSequentialActive = contextualActive && Boolean(sequentialActiveBid);
  const activeBid = preferSequentialActive
    ? sequentialActiveBid
    : (contextualActive
        ? normalizeTutorialBranchId(rawActiveTid, rawActiveTid)
        : sequentialActiveBid);
  const activeTid = preferSequentialActive
    ? normalizeStoryTutorialId(FF7_TUTORIAL_ID, activeBid)
    : (contextualActive
        ? rawActiveTid
        : normalizeStoryTutorialId(rawActiveTid, activeBid));
  const effectiveActiveTutorial = {
    tid: activeTid,
    bid: activeBid
  };
  if (tutorial.currentTutorialId !== activeTid) {
    tutorial.currentTutorialId = activeTid;
  }
  if (tutorial.currentTutorialGroupId !== activeBid) {
    tutorial.currentTutorialGroupId = activeBid;
  }
  if (!tutorial.activeTutorial || typeof tutorial.activeTutorial !== 'object') {
    tutorial.activeTutorial = clone(effectiveActiveTutorial);
  } else {
    tutorial.activeTutorial.tid = activeTid;
    tutorial.activeTutorial.bid = activeBid;
  }
  const activeBranchRaceId = getTutorialBranchRaceId(activeBid, '');
  const activeBranchHasRace = isConfiguredTutorialRaceId(activeBranchRaceId);
  const activeRaceId = getTutorialDisplayRaceId(activeBid, activeBranchRaceId);
  const progressionRaceId = activeBranchHasRace ? activeRaceId : '';
  const suppressTutorialSequence = false;
  const activeChapterId = isConfiguredTutorialRaceId(activeRaceId)
    ? String((getTutorialRaceConfig(activeRaceId) || {}).chapterId || FF7_TUTORIAL_CHAPTER_ID)
    : '';
  const tutorialRuntime = activeBranchHasRace ? buildTutorialRaceBundle(userId, activeRaceId) : null;
  const tutorialPreloadedRaceIds = getTutorialPreloadedRaceIds(activeBid, activeRaceId);
  const tutorialLoginNextRaces = buildTutorialNextRacesPayload(userId, tutorialPreloadedRaceIds);
  const compactTutorialLoginNextRaces = buildCompactTutorialNextRaces({
    nextRaces: tutorialLoginNextRaces
  });
  const userData = cloneTutorialUserData(tutorial.userData);
  const tutorialNode = userData[activeTid] || createTutorialBranchState(0, {
    tutorialId: activeTid,
    groupId: activeBid
  });
  tutorialNode.Branches = tutorialNode.Branches && typeof tutorialNode.Branches === 'object' ? tutorialNode.Branches : {};
  tutorialNode.branches = tutorialNode.Branches;
  tutorialNode.Tutorials = tutorialNode.Tutorials && typeof tutorialNode.Tutorials === 'object' ? tutorialNode.Tutorials : {};
  tutorialNode.tutorials = tutorialNode.Tutorials;
  const branchMap = tutorialNode.Branches;
  if (contextualActive) {
    Object.keys(branchMap).forEach((branchId) => {
      if (normalizeTutorialBranchId(branchId, '') !== activeBid) {
        delete branchMap[branchId];
      }
    });
    Object.keys(tutorialNode.Tutorials).forEach((tutorialId) => {
      if (String(tutorialId || '').trim() !== activeTid) {
        delete tutorialNode.Tutorials[tutorialId];
      }
    });
    tutorialNode.tutorials = tutorialNode.Tutorials;
  }
  const branchNode = branchMap[activeBid] || createTutorialBranchState(0, {
    tutorialId: activeTid,
    groupId: activeBid
  });
  applyTutorialNodeMeta(tutorialNode, {
    tutorialId: activeTid,
    groupId: activeBid,
    state: tutorialNode.State || tutorialNode.state || 1,
    tutorialRunning: !suppressTutorialSequence,
    tutorialGroupRunning: !suppressTutorialSequence,
    tutorialGroupCompleted: false
  });
  applyTutorialNodeMeta(branchNode, {
    tutorialId: activeTid,
    groupId: activeBid,
    state: branchNode.State || branchNode.state || 1,
    tutorialRunning: !suppressTutorialSequence,
    tutorialGroupRunning: !suppressTutorialSequence,
    tutorialGroupCompleted: false
  });
  const completedBranchIds = contextualActive
    ? []
    : getClientVisibleCompletedTutorialBranchIds(tutorial, activeBid);
  const visibleTutorialGroups = contextualActive
    ? (Array.isArray(tutorial.tutorialGroups) ? tutorial.tutorialGroups.slice() : [])
    : Array.from(new Set([...completedBranchIds, activeBid].filter(Boolean)));
  completedBranchIds.forEach((branchId) => {
    const normalizedBranchId = normalizeTutorialBranchId(branchId, '');
    if (!normalizedBranchId || normalizedBranchId === activeBid) return;
    if (!branchMap[normalizedBranchId] || typeof branchMap[normalizedBranchId] !== 'object') {
      branchMap[normalizedBranchId] = createTutorialBranchState(2, {
        tutorialId: activeTid,
        groupId: normalizedBranchId,
        jumpRaceId: getTutorialBranchRaceId(normalizedBranchId, ''),
        tutorialRunning: false,
        tutorialGroupRunning: false,
        tutorialGroupCompleted: true
      });
    } else {
      applyTutorialNodeMeta(branchMap[normalizedBranchId], {
        tutorialId: activeTid,
        groupId: normalizedBranchId,
        state: 2,
        tutorialRunning: false,
        tutorialGroupRunning: false,
        tutorialGroupCompleted: true
      });
    }
  });
  branchMap[activeBid] = branchNode;
  tutorialNode.Tutorials[activeTid] = {
    tutorialID: activeTid,
    tutorialId: activeTid,
    tutorialGroupId: activeBid,
    branchId: activeBid,
    JumpToRaceID: activeBranchRaceId,
    JumpToRaceId: activeBranchRaceId,
    jumpToRaceId: activeBranchRaceId,
    JumpToRaceIds: activeBranchRaceId ? [activeBranchRaceId] : [],
    jumpToRaceIds: activeBranchRaceId ? [activeBranchRaceId] : [],
    tutorialRunning: !suppressTutorialSequence,
    tutorialGroupRunning: !suppressTutorialSequence,
    tutorialGroupCompleted: false,
    tutorialComplete: false,
    completed: false,
    State: 1,
    state: 1
  };
  tutorialNode.tutorials = tutorialNode.Tutorials;
  const sparxBranchStates = {};
  Object.entries(branchMap).forEach(([branchId, branchValue]) => {
    const branchState =
      branchValue && typeof branchValue === 'object'
        ? Number(branchValue.State || branchValue.state || 0)
        : Number(branchValue || 0);
    sparxBranchStates[String(branchId)] = Number.isFinite(branchState) ? branchState : 0;
  });
  if (!Object.prototype.hasOwnProperty.call(sparxBranchStates, activeBid)) {
    sparxBranchStates[activeBid] = Number(branchNode.State || branchNode.state || 1) || 1;
  }
  const hydratedTutorialNode = clone(tutorialNode);
  const hydratedBranchNode = clone(branchNode);
  userData[activeTid] = clone(hydratedTutorialNode);
  if (tutorialNode.Branches && typeof tutorialNode.Branches === 'object') {
    tutorialNode.Branches[activeBid] = clone(hydratedBranchNode);
  }
  if (tutorialNode.branches && typeof tutorialNode.branches === 'object') {
    tutorialNode.branches[activeBid] = clone(hydratedBranchNode);
  }
  branchMap[activeBid] = clone(hydratedBranchNode);
  const sparxTutorialState = buildSparxTutorialUserDataShape(
    activeBid,
    Number(tutorialNode.State || tutorialNode.state || 1) || 1,
    sparxBranchStates
  );
  const tutorialDbPayload = buildTutorialDbPayload();
  const effectiveTutorialDbHash = String(tutorialDbPayload.dbhash || tutorial.dbHash || FF7_TUTORIAL_DB_HASH);
  if (tutorial.dbHash !== effectiveTutorialDbHash) {
    tutorial.dbHash = effectiveTutorialDbHash;
    persistState();
  }

  const dataBlob = {
    tutorialId: activeTid,
    branchId: activeBid,
    branchData: clone(branchNode),
    stateHash: effectiveTutorialDbHash,
    state1Hash: effectiveTutorialDbHash,
    state2Hash: effectiveTutorialDbHash,
    userData,
    branches: clone(branchMap),
    currentTutorialId: tutorial.currentTutorialId,
    currentTutorialGroupId: tutorial.currentTutorialGroupId,
    largestTutorialId: tutorial.largestTutorialId,
    largestTutorialGroupId: tutorial.largestTutorialGroupId,
    tutorials: tutorial.tutorials.slice(),
    tutorialGroups: visibleTutorialGroups.slice(),
    tutorialGroupsCompleted: completedBranchIds.slice(),
    activeTutorial: clone(effectiveActiveTutorial),
    raceData: clone(compactTutorialLoginNextRaces.raceData),
    chapterData: clone(compactTutorialLoginNextRaces.chapterData),
    nextRaces: clone(compactTutorialLoginNextRaces)
  };

  const tutorialDataMap = clone(tutorial.tutorialData || {});
  const tutorialDataEntryKey = `${activeTid}:${activeBid}`;
  if (!tutorialDataMap[tutorialDataEntryKey] || typeof tutorialDataMap[tutorialDataEntryKey] !== 'object') {
    tutorialDataMap[tutorialDataEntryKey] = {};
  }
  tutorialDataMap[tutorialDataEntryKey] = {
    ...tutorialDataMap[tutorialDataEntryKey],
    id: activeTid,
    tid: activeTid,
    bid: activeBid,
    tutorialId: activeTid,
    tutorialGroupId: activeBid,
    branchId: activeBid,
    branchData: clone(hydratedBranchNode),
    stateHash: effectiveTutorialDbHash,
    state1Hash: effectiveTutorialDbHash,
    state2Hash: effectiveTutorialDbHash,
    JumpToRaceID: activeBranchRaceId,
    JumpToRaceIds: activeBranchRaceId ? [activeBranchRaceId] : [],
    started: true,
    completed: false,
    tutorialRunning: !suppressTutorialSequence,
    tutorialGroupRunning: !suppressTutorialSequence,
    tutorialGroupCompleted: false,
    data: clone(tutorialDbPayload),
    userDataBlob: {
      tutorialId: activeTid,
      branchId: activeBid,
      stateHash: effectiveTutorialDbHash,
      currentTutorialId: tutorial.currentTutorialId,
      currentTutorialGroupId: tutorial.currentTutorialGroupId,
      activeTutorial: clone(effectiveActiveTutorial)
    }
  };

  const tutorialDataList = Object.entries(tutorialDataMap)
    .map(([key, value]) => {
      const entry = {
        key,
        ...(clone(value) || {})
      };
      if (!entry.data || typeof entry.data !== 'object') {
        entry.data = clone(tutorialDbPayload);
      }
      return entry;
    })
    .sort((left, right) => {
      const leftKey = String(left && left.key || '');
      const rightKey = String(right && right.key || '');
      if (leftKey === tutorialDataEntryKey && rightKey !== tutorialDataEntryKey) return -1;
      if (rightKey === tutorialDataEntryKey && leftKey !== tutorialDataEntryKey) return 1;
      return leftKey.localeCompare(rightKey);
    });

  const result = {
    api: tutorial.api,
    dbHash: effectiveTutorialDbHash,
    hash: effectiveTutorialDbHash,
    changed: true,
    refresh: true,
    check: 'uhtotallysecure',
    connected: true,
    status: 'connected',
    branchData: clone(branchNode),
    stateHash: effectiveTutorialDbHash,
    state1Hash: effectiveTutorialDbHash,
    state2Hash: effectiveTutorialDbHash,
    JumpToRaceID: activeBranchRaceId,
    JumpToRaceIds: activeBranchRaceId ? [activeBranchRaceId] : [],
    currentTutorialId: tutorial.currentTutorialId,
    currentTutorialGroupId: tutorial.currentTutorialGroupId,
    largestTutorialId: tutorial.largestTutorialId,
    largestTutorialGroupId: tutorial.largestTutorialGroupId,
    tutorials: tutorial.tutorials.slice(),
    tutorialGroups: visibleTutorialGroups.slice(),
    tutorialGroupsCompleted: completedBranchIds.slice(),
    activeTutorial: clone(effectiveActiveTutorial),
    ltid: tutorialDbPayload.ltid,
    ltgid: tutorialDbPayload.ltgid,
    dbhash: tutorialDbPayload.dbhash,
    nextRaces: clone(compactTutorialLoginNextRaces),
    raceData: clone(compactTutorialLoginNextRaces.raceData),
    chapterData: clone(compactTutorialLoginNextRaces.chapterData),
    simMultipliers: {},
    progression: {
      won_races: clone(profileProgress.won_races || {}),
      lost_races: clone(profileProgress.lost_races || {}),
      last_story_race: String(profileProgress.last_story_race || ''),
      crid: String(progressionRaceId || ''),
      jfrid: String(progressionRaceId || ''),
      cmid: String(activeChapterId || profileProgress.cmid || ''),
      tut_id: Math.max(
        Number.isFinite(profileProgress.tut_id) ? profileProgress.tut_id : 0,
        parseTutorialNumericId(activeBid, 'G') || 1
      ),
      CurrentRaceId: String(progressionRaceId || ''),
      currentRaceId: String(progressionRaceId || ''),
      current_race_id: String(progressionRaceId || ''),
      JustFinishedRaceId: String(profileProgress.JustFinishedRaceId || ''),
      justFinishedRaceId: String(profileProgress.justFinishedRaceId || ''),
      just_finished_race_id: String(profileProgress.just_finished_race_id || ''),
      LastWonStoryRaceID: String(profileProgress.LastWonStoryRaceID || ''),
      lastWonStoryRaceID: String(profileProgress.lastWonStoryRaceID || ''),
      lastWonStoryRaceId: String(profileProgress.lastWonStoryRaceId || '')
    },
    tutorialData: tutorialDataList,
    tutorialDataList,
    tutorialDb: clone(tutorialDbPayload),
    tut: {
      [activeTid]: clone(sparxTutorialState)
    },
    userData,
    data: dataBlob,
    branches: clone(branchMap)
  };
  if (!activeBranchHasRace) {
    clearRacePayload(result);
  }
  const rootRaceSource = compactTutorialLoginNextRaces.raceData && compactTutorialLoginNextRaces.raceData[0];
  const rootRace = rootRaceSource ? clone(rootRaceSource) : null;
  if (activeBranchHasRace && rootRace && typeof rootRace === 'object') {
    Object.assign(result, rootRace);
  } else {
    clearRacePayload(result);
  }
  result[activeTid] = clone(sparxTutorialState);
  FF7_CONTEXTUAL_TUTORIAL_IDS.forEach((tutorialId) => {
    const normalizedTutorialId = String(tutorialId || '').trim();
    if (!normalizedTutorialId || normalizedTutorialId === activeTid) {
      return;
    }
    result[normalizedTutorialId] = buildSparxTutorialUserDataShape(normalizedTutorialId, 2, {
      [normalizedTutorialId]: 2
    });
  });
  if (activeBid !== activeTid) {
    result[activeBid] = clone(hydratedBranchNode);
  }
  logFf7Debug('tutorial/result', {
    userId,
    activeTutorial: clone(effectiveActiveTutorial),
    profile: compactProfile(getProfile(userId)),
    branchState: {
      tutorialId: activeTid,
      branchId: activeBid,
      state: branchNode.State || branchNode.state || 0,
      jumpToRaceId: branchNode.jumpToRaceId || branchNode.JumpToRaceId || branchNode.JumpToRaceID || null
    },
    progression: {
      crid: result.progression.crid,
      jfrid: result.progression.jfrid,
      cmid: result.progression.cmid,
      currentRaceId: result.progression.currentRaceId
    },
    race: activeBranchHasRace ? compactRace(result.raceData && result.raceData[0]) : null
  });
  return result;
}

function updateTutorialState(userId, params, complete) {
  const sparx = ensureSparxState(userId);
  const tutorial = sparx.tutorial;
  const requestedTutorialSelection = resolveRequestedTutorialSelection(sparx.tutorial, params || {});
  const requestedTid = String(requestedTutorialSelection.tid || FF7_TUTORIAL_ID);
  const contextualTutorialRequested = isContextualTutorialId(requestedTid);
  const explicitBidRaw = String(requestedTutorialSelection.requestedBidRaw || '').trim();
  const profileState = sparx.dataStore && sparx.dataStore.profile ? sparx.dataStore.profile : {};
  const sequentialStoryBid = getEffectiveTutorialBranchId(sparx.tutorial, profileState);
  const sequentialStoryActive = Boolean(sequentialStoryBid);
  const requestedBid = String(
    contextualTutorialRequested
      ? (requestedTutorialSelection.bid || requestedTid)
      : (requestedTutorialSelection.bid || FF7_TUTORIAL_GROUP_ID)
  );
  const suppressContextualTutorial =
    contextualTutorialRequested &&
    (
      sequentialStoryActive ||
      FF7_SKIP_TUTORIAL_TO_GARAGE ||
      !getFirstIncompleteTutorialBranchId(tutorial)
    );
  if (suppressContextualTutorial) {
    const contextualBid = normalizeTutorialBranchId(requestedTid, requestedTid);
    return mergeTutorialMirrorIntoResult(
      buildTutorialResult(userId),
      requestedTid,
      contextualBid,
      2
    );
  }
  if (contextualTutorialRequested && sequentialStoryActive) {
    const contextualBid = normalizeTutorialBranchId(requestedTid, requestedTid);
    tutorial.userData = tutorial.userData && typeof tutorial.userData === 'object' ? tutorial.userData : {};
    tutorial.userData[requestedTid] = buildContextualTutorialUserDataNode(requestedTid, contextualBid, complete ? 2 : 1);
    tutorial.tutorialData = tutorial.tutorialData && typeof tutorial.tutorialData === 'object' ? tutorial.tutorialData : {};
    tutorial.tutorialData[`${requestedTid}:${contextualBid}`] = {
      started: !complete,
      completed: Boolean(complete),
      updatedAt: nowTs()
    };
    persistState();
    return mergeTutorialMirrorIntoResult(
      buildTutorialResult(userId),
      requestedTid,
      contextualBid,
      complete ? 2 : 1
    );
  }
  if (FF7_SKIP_TUTORIAL_TO_GARAGE || shouldCompleteTutorialsOnFreshSave(sparx.dataStore.profile || {})) {
    normalizeTutorialState(sparx.tutorial, sparx.dataStore.profile || {});
    // Persist the incoming branch as completed so allTutorialsCompleted passes
    if (sparx.tutorial.tutorialGroups.indexOf(requestedBid) === -1) {
      sparx.tutorial.tutorialGroups.push(requestedBid);
    }
    if (sparx.tutorial.tutorialGroupsCompleted.indexOf(requestedBid) === -1) {
      sparx.tutorial.tutorialGroupsCompleted.push(requestedBid);
    }
    normalizeTutorialProgressionProfile(sparx.dataStore.profile);
    if (!sparx.tutorialBronzeBoxGranted) {
      sparx.tutorialBronzeBoxGranted = true;
      try { claimShipyardBox(userId, { box: 'bronze_container' }); } catch (_) {}
    }
    persistState();
    return buildTutorialResult(userId, {
      tid: requestedTid,
      bid: requestedBid,
      exposeActiveBranch: false
    });
  }
  const pendingCompleteBranchId = complete && !contextualTutorialRequested && !explicitBidRaw
    ? normalizeTutorialBranchId(
        firstDefined(
          tutorial.pendingCompletedBranchId,
          tutorial.currentTutorialGroupId,
          requestedBid
        ),
        FF7_TUTORIAL_GROUP_ID
      )
    : '';
  const pendingNextBranchId = complete && pendingCompleteBranchId
    ? normalizeTutorialBranchId(tutorial.pendingNextBranchId || '', '')
    : '';
  const pendingNextRaceId = complete && pendingCompleteBranchId
    ? String(tutorial.pendingNextRaceId || '').trim()
    : '';
  const bid = contextualTutorialRequested
    ? normalizeTutorialBranchId(requestedBid, requestedTid)
    : normalizeTutorialBranchId(pendingCompleteBranchId || requestedBid, FF7_TUTORIAL_GROUP_ID);
  const tid = String(requestedTid || FF7_TUTORIAL_ID);
  const branchRaceId = getTutorialBranchRaceId(bid, '');

  if (tid) {
    tutorial.activeTutorial.tid = tid;
  }
  if (bid) {
    tutorial.activeTutorial.bid = bid;
    tutorial.currentTutorialGroupId = bid;
    if (tutorial.tutorialGroups.indexOf(bid) === -1) {
      tutorial.tutorialGroups.push(bid);
    }
    tutorial.largestTutorialGroupId = Math.max(
      tutorial.largestTutorialGroupId,
      parseTutorialNumericId(bid, 'G')
    );
  }

  if (tid && tutorial.tutorials.indexOf(tid) === -1) {
    tutorial.tutorials.push(tid);
    const numericTid = parseInt(tid, 10);
    if (Number.isFinite(numericTid)) {
      tutorial.largestTutorialId = Math.max(tutorial.largestTutorialId, numericTid);
    }
  }
  tutorial.largestTutorialId = Math.max(tutorial.largestTutorialId, 1);

  tutorial.currentTutorialId = complete ? null : tid || tutorial.activeTutorial.tid || FF7_TUTORIAL_ID;
  const tutorialKey = tid || tutorial.activeTutorial.tid || FF7_TUTORIAL_ID;
  const fteNode = tutorial.userData[tutorialKey] || createTutorialBranchState(0, {
    tutorialId: tutorialKey,
    groupId: bid || FF7_TUTORIAL_GROUP_ID
  });
  const fteBranches = fteNode.Branches || (fteNode.Branches = {});
  fteNode.branches = fteBranches;
  if (contextualTutorialRequested) {
    Object.keys(fteBranches).forEach((branchId) => {
      if (normalizeTutorialBranchId(branchId, '') !== bid) {
        delete fteBranches[branchId];
      }
    });
    fteNode.Tutorials = {};
    fteNode.tutorials = fteNode.Tutorials;
  }
  applyTutorialNodeMeta(fteNode, {
    tutorialId: tutorialKey,
    groupId: bid || FF7_TUTORIAL_GROUP_ID,
    state: complete ? 2 : 1,
    tutorialRunning: !complete,
    tutorialGroupRunning: !complete,
    tutorialGroupCompleted: Boolean(complete)
  });
  if (bid) {
    const branchNode = fteBranches[bid] || createTutorialBranchState(0, {
      tutorialId: tutorialKey,
      groupId: bid
    });
    applyTutorialNodeMeta(branchNode, {
      tutorialId: tutorialKey,
      groupId: bid,
      state: complete ? 2 : 1,
      tutorialRunning: !complete,
      tutorialGroupRunning: !complete,
      tutorialGroupCompleted: Boolean(complete)
    });
    fteBranches[bid] = branchNode;
    fteNode.Tutorials[tutorialKey] = {
      tutorialID: tutorialKey,
      tutorialId: tutorialKey,
      tutorialGroupId: bid,
      JumpToRaceID: branchRaceId,
      JumpToRaceIds: branchRaceId ? [branchRaceId] : [],
      tutorialRunning: !complete,
      tutorialGroupRunning: !complete,
      tutorialGroupCompleted: Boolean(complete),
      State: complete ? 2 : 1,
      state: complete ? 2 : 1
    };
    fteNode.tutorials = fteNode.Tutorials;
  }
  fteNode.Branches = fteBranches;
  fteNode.branches = fteBranches;
  tutorial.userData[tutorialKey] = fteNode;

  if (complete && bid && tutorial.tutorialGroupsCompleted.indexOf(bid) === -1) {
    tutorial.tutorialGroupsCompleted.push(bid);
  }

  if (complete && !contextualTutorialRequested && bid) {
    getSequentialTutorialBranchIdsUpTo(bid).forEach((branchId) => {
      markTutorialBranchCompleted(tutorial, tutorialKey, branchId);
    });
  }

  tutorial.tutorialData[`${tutorialKey}:${bid || 'default'}`] = {
    started: true,
    completed: Boolean(complete),
    updatedAt: nowTs()
  };
  if (branchRaceId) {
    applyTutorialRaceProgression(sparx.dataStore.profile, branchRaceId, {
      branchId: bid,
      justFinished: Boolean(complete),
      won: Boolean(complete)
    });
    // complete-tutorial çağrısı resolve-match olmadan gelirse won_races'e de yaz
    // yoksa getStartupPlayableTutorialBranchId G1'e geri düşer
    if (complete) {
      if (!sparx.dataStore.profile.won_races || typeof sparx.dataStore.profile.won_races !== 'object') {
        sparx.dataStore.profile.won_races = {};
      }
      sparx.dataStore.profile.won_races[branchRaceId] = 1;
    }
  }
  normalizeTutorialProgressionProfile(sparx.dataStore.profile);

  if (complete && pendingCompleteBranchId && pendingNextBranchId) {
    const completedBranchIds = Array.from(new Set([
      ...(Array.isArray(tutorial.tutorialGroupsCompleted) ? tutorial.tutorialGroupsCompleted : []),
      pendingCompleteBranchId
    ].map((branchId) => normalizeTutorialBranchId(branchId, '')).filter(Boolean)));
    syncTutorialStateToBranch(tutorial, tid, pendingNextBranchId, {
      completedBranchIds
    });
    if (pendingNextRaceId) {
      applyTutorialRaceProgression(sparx.dataStore.profile, pendingNextRaceId, {
        branchId: pendingNextBranchId,
        tutId: parseTutorialNumericId(pendingNextBranchId, 'G') || Number(sparx.dataStore.profile.tut_id || 1) || 1,
        justFinished: false,
        won: false
      });
    }
    clearPendingSequentialTransition(tutorial);
  } else if (complete) {
    clearPendingSequentialTransition(tutorial);
  }

  // Tutorial tamamen bitince bronze_container ver (bir kez)
  if (complete) {
    const firstIncomplete = getFirstIncompleteTutorialBranchId(tutorial);
    const allDone = !firstIncomplete;
    if (allDone && !sparx.tutorialBronzeBoxGranted) {
      sparx.tutorialBronzeBoxGranted = true;
      try {
        claimShipyardBox(userId, { box: 'bronze_container' });
      } catch (_) {}
    }
  }

  persistState();

  return buildTutorialResult(userId);
}

function resolveMatchState(userId, params) {
  const sparx = ensureSparxState(userId);
  const tutorial = sparx.tutorial;
  const profile = sparx.dataStore && sparx.dataStore.profile ? sparx.dataStore.profile : {};
  const rootProfile = getProfile(userId);
  const raceId = String(params.raceId || params.id || params.ri || '').trim();
  const resultCode = String(params.result || '').trim().toUpperCase();
  const won = params.won === true || params.won === 1 || resultCode === 'WON';
  const careerArticle = getCareerArticleByRaceId(raceId);
  if (careerArticle) {
    return resolveCareerMatchState(userId, params, careerArticle);
  }
  const challengeArticle = getChallengeArticleByRaceId(raceId);
  if (challengeArticle) {
    return resolveChallengeMatchState(userId, params, challengeArticle);
  }
  const branchId = getTutorialBranchIdForRaceId(raceId, tutorial.currentTutorialGroupId || FF7_TUTORIAL_GROUP_ID);
  const nextBranchId = won
    ? redirectTutorialBranchId(getNextTutorialBranchId(branchId))
    : redirectTutorialBranchId(branchId);
  const nextRaceId = getTutorialBranchRaceId(nextBranchId, '');

  if (!profile.won_races || typeof profile.won_races !== 'object') {
    profile.won_races = {};
  }
  if (!profile.lost_races || typeof profile.lost_races !== 'object') {
    profile.lost_races = {};
  }

  if (raceId) {
    if (won) {
      profile.won_races[raceId] = 1;
      delete profile.lost_races[raceId];
    } else {
      profile.lost_races[raceId] = Number(profile.lost_races[raceId] || 0) + 1;
    }
    applyTutorialRaceProgression(profile, raceId, {
      branchId,
      justFinished: true,
      won
    });
  }

  if (!Array.isArray(tutorial.tutorialGroups)) {
    tutorial.tutorialGroups = [];
  }
  if (!Array.isArray(tutorial.tutorialGroupsCompleted)) {
    tutorial.tutorialGroupsCompleted = [];
  }

  if (branchId && tutorial.tutorialGroups.indexOf(branchId) === -1) {
    tutorial.tutorialGroups.push(branchId);
  }
  if (won && branchId && tutorial.tutorialGroupsCompleted.indexOf(branchId) === -1) {
    tutorial.tutorialGroupsCompleted.push(branchId);
  }
  if (won) {
    markRedirectedTutorialBranchesCompleted(tutorial, FF7_TUTORIAL_ID, getNextTutorialBranchId(branchId), nextBranchId);
  }
  if (nextBranchId && tutorial.tutorialGroups.indexOf(nextBranchId) === -1) {
    tutorial.tutorialGroups.push(nextBranchId);
  }

  tutorial.largestTutorialId = Math.max(Number(tutorial.largestTutorialId || 0), FF7_TUTORIAL_DB_LTID || 1);
  tutorial.largestTutorialGroupId = Math.max(
    Number(tutorial.largestTutorialGroupId || 0),
    parseTutorialNumericId(branchId, 'G'),
    parseTutorialNumericId(nextBranchId, 'G'),
    FF7_TUTORIAL_DB_LTGID || 1
  );

  tutorial.currentTutorialId = nextBranchId ? FF7_TUTORIAL_ID : null;
  tutorial.currentTutorialGroupId = nextBranchId || null;
  tutorial.activeTutorial = nextBranchId ? { tid: FF7_TUTORIAL_ID, bid: nextBranchId } : null;

  const rootNode = tutorial.userData[FF7_TUTORIAL_ID] || createTutorialBranchState(won ? 2 : 1, {
    tutorialId: FF7_TUTORIAL_ID,
    groupId: branchId,
    jumpRaceId: getTutorialBranchRaceId(branchId, '')
  });
  rootNode.Branches = rootNode.Branches && typeof rootNode.Branches === 'object' ? rootNode.Branches : {};
  rootNode.branches = rootNode.Branches;
  rootNode.Tutorials = rootNode.Tutorials && typeof rootNode.Tutorials === 'object' ? rootNode.Tutorials : {};
  rootNode.tutorials = rootNode.Tutorials;

  if (branchId) {
    const currentBranchNode = rootNode.Branches[branchId] || createTutorialBranchState(0, {
      tutorialId: FF7_TUTORIAL_ID,
      groupId: branchId
    });
    applyTutorialNodeMeta(currentBranchNode, {
      tutorialId: FF7_TUTORIAL_ID,
      groupId: branchId,
      jumpRaceId: getTutorialBranchRaceId(branchId, ''),
      state: won ? 2 : 1,
      tutorialRunning: !won,
      tutorialGroupRunning: !won,
      tutorialGroupCompleted: won
    });
    rootNode.Branches[branchId] = currentBranchNode;
  }

  if (nextBranchId) {
    const nextBranchNode = rootNode.Branches[nextBranchId] || createTutorialBranchState(0, {
      tutorialId: FF7_TUTORIAL_ID,
      groupId: nextBranchId
    });
    applyTutorialNodeMeta(nextBranchNode, {
      tutorialId: FF7_TUTORIAL_ID,
      groupId: nextBranchId,
      jumpRaceId: getTutorialBranchRaceId(nextBranchId, ''),
      state: 1,
      tutorialRunning: true,
      tutorialGroupRunning: true,
      tutorialGroupCompleted: false
    });
    rootNode.Branches[nextBranchId] = nextBranchNode;
  }

  const branchStillRunning = !won || Boolean(nextBranchId);
  applyTutorialNodeMeta(rootNode, {
    tutorialId: FF7_TUTORIAL_ID,
    groupId: nextBranchId || branchId,
    jumpRaceId: getTutorialBranchRaceId(nextBranchId || branchId, ''),
    state: branchStillRunning ? 1 : 2,
    tutorialRunning: branchStillRunning,
    tutorialGroupRunning: branchStillRunning,
    tutorialGroupCompleted: !nextBranchId && won
  });

  const activeBranchId = nextBranchId || branchId;
  const activeJumpRaceId = getTutorialBranchRaceId(activeBranchId, '');
  rootNode.Tutorials[FF7_TUTORIAL_ID] = {
    tutorialID: FF7_TUTORIAL_ID,
    tutorialId: FF7_TUTORIAL_ID,
    tutorialGroupId: activeBranchId,
    JumpToRaceID: activeJumpRaceId,
    JumpToRaceIds: activeJumpRaceId ? [activeJumpRaceId] : [],
    tutorialRunning: branchStillRunning,
    tutorialGroupRunning: branchStillRunning,
    tutorialGroupCompleted: !nextBranchId && won,
    State: branchStillRunning ? 1 : 2,
    state: branchStillRunning ? 1 : 2
  };
  rootNode.tutorials = rootNode.Tutorials;
  tutorial.userData[FF7_TUTORIAL_ID] = rootNode;

  if (branchId) {
    tutorial.tutorialData[`${FF7_TUTORIAL_ID}:${branchId}`] = {
      started: true,
      completed: won,
      updatedAt: nowTs()
    };
  }

  if (won && branchId) {
    tutorial.pendingCompletedTutorialId = FF7_TUTORIAL_ID;
    tutorial.pendingCompletedBranchId = branchId;
    tutorial.pendingNextBranchId = nextBranchId || '';
    tutorial.pendingNextRaceId = nextRaceId || '';
    tutorial.pendingResolveRaceId = raceId || '';
  } else {
    clearPendingSequentialTransition(tutorial);
  }

  if (won && nextRaceId) {
    const nextRaceConfig = getTutorialRaceConfig(nextRaceId);
    const nextChapterId = String(nextRaceConfig.chapterId || FF7_TUTORIAL_CHAPTER_ID);
    const nextTutorialStep = parseTutorialNumericId(nextBranchId, 'G') || Number(profile.tut_id || 1) || 1;

    profile.crid = nextRaceId;
    profile.jfrid = nextRaceId;
    profile.cmid = nextChapterId;
    profile.CurrentRaceId = nextRaceId;
    profile.currentRaceId = nextRaceId;
    profile.current_race_id = nextRaceId;
    profile.tut_id = nextTutorialStep;
  } else if (won && nextBranchId) {
    const currentRaceConfig = getTutorialRaceConfig(raceId);
    const nextTutorialStep = parseTutorialNumericId(nextBranchId, 'G') || Number(profile.tut_id || 1) || 1;
    const nextDisplayRaceId = getTutorialDisplayRaceId(nextBranchId, '');
    const nextDisplayRaceConfig = nextDisplayRaceId ? getTutorialRaceConfig(nextDisplayRaceId) : null;

    profile.crid = '';
    profile.jfrid = '';
    profile.CurrentRaceId = '';
    profile.currentRaceId = '';
    profile.current_race_id = '';
    profile.cmid = String(
      (nextDisplayRaceConfig && nextDisplayRaceConfig.chapterId) ||
      currentRaceConfig.chapterId ||
      profile.cmid ||
      FF7_TUTORIAL_CHAPTER_ID
    );
    profile.tut_id = nextTutorialStep;
    profile.last_story_race = String(raceId || profile.last_story_race || '');
    profile.JustFinishedRaceId = String(raceId || '');
    profile.justFinishedRaceId = String(raceId || '');
    profile.just_finished_race_id = String(raceId || '');
    profile.LastWonStoryRaceID = String(raceId || '');
    profile.lastWonStoryRaceID = String(raceId || '');
    profile.lastWonStoryRaceId = String(raceId || '');
  } else if (won && !nextBranchId) {
    // Last branch completed — mark tutorial fully done.
    const completedStep = parseTutorialNumericId(branchId, 'G') || Number(profile.tut_id || 1) || 1;
    profile.tut_id = completedStep;
    tutorial.currentTutorialGroupId = '';
    tutorial.currentTutorialId = null;
    tutorial.activeTutorial = null;
  }

  syncTutorialVehicleProfile(profile, tutorial);

  if (rootProfile && typeof rootProfile === 'object') {
    rootProfile.won_races = clone(profile.won_races || {});
    rootProfile.lost_races = clone(profile.lost_races || {});
    rootProfile.last_story_race = String(profile.last_story_race || '');
    rootProfile.crid = String(profile.crid || '');
    rootProfile.jfrid = String(profile.jfrid || '');
    rootProfile.cmid = String(profile.cmid || '');
    rootProfile.tut_id = Number(profile.tut_id || 0);
    rootProfile.CurrentRaceId = String(profile.CurrentRaceId || '');
    rootProfile.currentRaceId = String(profile.currentRaceId || '');
    rootProfile.current_race_id = String(profile.current_race_id || '');
    rootProfile.JustFinishedRaceId = String(profile.JustFinishedRaceId || '');
    rootProfile.justFinishedRaceId = String(profile.justFinishedRaceId || '');
    rootProfile.just_finished_race_id = String(profile.just_finished_race_id || '');
    rootProfile.LastWonStoryRaceID = String(profile.LastWonStoryRaceID || '');
    rootProfile.lastWonStoryRaceID = String(profile.lastWonStoryRaceID || '');
    rootProfile.lastWonStoryRaceId = String(profile.lastWonStoryRaceId || '');
    syncTutorialVehicleProfile(rootProfile, tutorial);
  }

  normalizeTutorialProgressionProfile(profile);
  persistState();

  const tutorialActionResult = buildCompactTutorialActionResult(buildTutorialResult(userId));
  const enrichedResult = {
    raceId,
    result: resultCode || (won ? 'WON' : 'LOST'),
    nextBranchId: nextBranchId || '',
    nextRaceId: nextRaceId || '',
    profile: {
      crid: String(profile.crid || ''),
      jfrid: String(profile.jfrid || ''),
      cmid: String(profile.cmid || ''),
      tut_id: Number(profile.tut_id || 0)
    }
  };

  getTutorialActionResponseKeys().forEach((key) => {
    if (!Object.prototype.hasOwnProperty.call(tutorialActionResult, key)) {
      return;
    }
    enrichedResult[key] = clone(tutorialActionResult[key]);
  });

  return enrichedResult;
}

function startTutorialBranch(userId, params) {
  const sparx = ensureSparxState(userId);
  const requestedTutorialSelection = resolveRequestedTutorialSelection(sparx.tutorial, params || {});
  if (FF7_SKIP_TUTORIAL_TO_GARAGE || shouldCompleteTutorialsOnFreshSave(sparx.dataStore.profile || {})) {
    const incomingBid = String(requestedTutorialSelection.bid || FF7_TUTORIAL_GROUP_ID);
    const incomingTid = String(requestedTutorialSelection.tid || FF7_TUTORIAL_ID);
    normalizeTutorialState(sparx.tutorial, sparx.dataStore.profile || {});
    if (incomingBid === 'G4') {
      getSequentialTutorialBranchIdsUpTo('G4', { inclusive: false }).forEach((bid) => {
        if (sparx.tutorial.tutorialGroups.indexOf(bid) === -1) sparx.tutorial.tutorialGroups.push(bid);
        if (sparx.tutorial.tutorialGroupsCompleted.indexOf(bid) === -1) sparx.tutorial.tutorialGroupsCompleted.push(bid);
      });
      if (sparx.tutorial.tutorialGroups.indexOf('G4') === -1) sparx.tutorial.tutorialGroups.push('G4');
      sparx.tutorial.activeTutorial = { tid: incomingTid, bid: 'G4' };
      sparx.tutorial.currentTutorialId = incomingTid;
      sparx.tutorial.currentTutorialGroupId = 'G4';
    } else {
      getSequentialTutorialBranchIdsUpTo(incomingBid).forEach((bid) => {
        if (sparx.tutorial.tutorialGroups.indexOf(bid) === -1) sparx.tutorial.tutorialGroups.push(bid);
        if (sparx.tutorial.tutorialGroupsCompleted.indexOf(bid) === -1) sparx.tutorial.tutorialGroupsCompleted.push(bid);
      });
    }
    normalizeTutorialProgressionProfile(sparx.dataStore.profile);
    persistState();
    return buildTutorialResult(userId, {
      tid: incomingTid,
      bid: incomingBid,
      exposeActiveBranch: true
    });
  }
  const tutorial = sparx.tutorial;
  const explicitBidRaw = String(requestedTutorialSelection.requestedBidRaw || '').trim();
  const explicitBranchRequested = Boolean(explicitBidRaw);
  const requestedBid = normalizeTutorialBranchId(
    requestedTutorialSelection.bid || FF7_TUTORIAL_GROUP_ID,
    FF7_TUTORIAL_GROUP_ID
  );
  const tid = String(requestedTutorialSelection.tid || FF7_TUTORIAL_ID);
  const contextualTutorialRequested = isContextualTutorialId(tid);
  const profileState = sparx.dataStore && sparx.dataStore.profile ? sparx.dataStore.profile : {};
  const startupBranchId = getStartupPlayableTutorialBranchId(profileState);

  const firstIncompleteBranchId = getFirstIncompleteTutorialBranchId(tutorial);
  const currentActiveBranchId = normalizeTutorialBranchId(
    firstDefined(
      tutorial.currentTutorialGroupId,
      tutorial.activeTutorial && tutorial.activeTutorial.bid,
      ''
    ),
    ''
  );

  const profileBid = getEffectiveTutorialBranchId(
    tutorial,
    profileState
  );
  let bid = contextualTutorialRequested
    ? normalizeTutorialBranchId(requestedTutorialSelection.bid || tid, tid)
    : (
        (explicitBranchRequested
          ? redirectTutorialBranchId(requestedBid)
          : startupBranchId) ||
        (requestedBid === FF7_TUTORIAL_GROUP_ID && profileBid && profileBid !== FF7_TUTORIAL_GROUP_ID
          ? profileBid
          : redirectTutorialBranchId(requestedBid))
      );
  const currentActiveNumber = parseTutorialNumericId(currentActiveBranchId, 'G');
  const selectedNumber = parseTutorialNumericId(bid, 'G');
  const profileNumber = parseTutorialNumericId(profileBid, 'G');
  if (!contextualTutorialRequested) {
    if (currentActiveNumber > 0 && currentActiveNumber > selectedNumber) {
      bid = redirectTutorialBranchId(currentActiveBranchId);
    }
    if (profileNumber > 0 && profileNumber > parseTutorialNumericId(bid, 'G')) {
      bid = redirectTutorialBranchId(profileBid);
    }
  }
  if (!contextualTutorialRequested && firstIncompleteBranchId) {
    const firstIncompleteNumber = parseTutorialNumericId(firstIncompleteBranchId, 'G');
    const selectedNumber = parseTutorialNumericId(bid, 'G');
    const activeBranchNumber = parseTutorialNumericId(
      normalizeTutorialBranchId(
        firstDefined(
          tutorial.currentTutorialGroupId,
          tutorial.activeTutorial && tutorial.activeTutorial.bid,
          ''
        ),
        ''
      ),
      'G'
    );
    // Never regress tutorial branch based only on stale tutorialGroupsCompleted.
    // Profile-driven startup branch (won races) is authoritative when ahead.
    const preserveSelectedLaterBranch =
      (explicitBranchRequested && selectedNumber >= firstIncompleteNumber) ||
      (activeBranchNumber > 0 && activeBranchNumber >= firstIncompleteNumber && selectedNumber >= activeBranchNumber);
    if ((!bid || firstIncompleteNumber > selectedNumber) && !preserveSelectedLaterBranch) {
      bid = redirectTutorialBranchId(firstIncompleteBranchId);
    }
  }
  let branchRaceId = getTutorialBranchRaceId(bid, '');
  const suppressTutorialSequence = false;

  if (!contextualTutorialRequested && bid !== requestedBid) {
    markRedirectedTutorialBranchesCompleted(tutorial, tid, requestedBid, bid);
  }

  if (!contextualTutorialRequested && bid && branchRaceId && !isConfiguredTutorialRaceId(branchRaceId)) {
    let cursor = bid;
    while (cursor) {
      if (tutorial.tutorialGroups.indexOf(cursor) === -1) tutorial.tutorialGroups.push(cursor);
      if (tutorial.tutorialGroupsCompleted.indexOf(cursor) === -1) tutorial.tutorialGroupsCompleted.push(cursor);
      tutorial.tutorialData[`${tid}:${cursor}`] = {
        started: true,
        completed: true,
        updatedAt: nowTs()
      };
      const nextPlayable = getNextPlayableTutorialBranchId(cursor);
      if (nextPlayable) {
        bid = nextPlayable;
        branchRaceId = getTutorialBranchRaceId(bid, '');
        break;
      }
      cursor = getNextTutorialBranchId(cursor);
      if (!cursor) {
        break;
      }
    }
  }

  tutorial.activeTutorial.tid = tid;
  tutorial.activeTutorial.bid = bid;
  tutorial.currentTutorialId = tid;
  tutorial.currentTutorialGroupId = bid;
  tutorial.largestTutorialId = Math.max(tutorial.largestTutorialId, 1);
  tutorial.largestTutorialGroupId = Math.max(
    tutorial.largestTutorialGroupId,
    parseTutorialNumericId(bid, 'G')
  );

  if (tutorial.tutorials.indexOf(tid) === -1) {
    tutorial.tutorials.push(tid);
  }
  if (tutorial.tutorialGroups.indexOf(bid) === -1) {
    tutorial.tutorialGroups.push(bid);
  }

  const rootNode = tutorial.userData[tid] || createTutorialBranchState(0, {
    tutorialId: tid,
    groupId: bid
  });
  applyTutorialNodeMeta(rootNode, {
    tutorialId: tid,
    groupId: bid,
    state: 1,
    tutorialRunning: !suppressTutorialSequence,
    tutorialGroupRunning: !suppressTutorialSequence,
    tutorialGroupCompleted: false
  });

  const branchNode = rootNode.Branches[bid] || createTutorialBranchState(0, {
    tutorialId: tid,
    groupId: bid
  });
  applyTutorialNodeMeta(branchNode, {
    tutorialId: tid,
    groupId: bid,
    state: 1,
    tutorialRunning: !suppressTutorialSequence,
    tutorialGroupRunning: !suppressTutorialSequence,
    tutorialGroupCompleted: false
  });
  rootNode.Branches[bid] = branchNode;
  rootNode.Tutorials[tid] = {
    tutorialID: tid,
    tutorialId: tid,
    tutorialGroupId: bid,
    JumpToRaceID: branchRaceId,
    JumpToRaceIds: branchRaceId ? [branchRaceId] : [],
    tutorialRunning: !suppressTutorialSequence,
    tutorialGroupRunning: !suppressTutorialSequence,
    tutorialGroupCompleted: false,
    State: 1,
    state: 1
  };
  rootNode.tutorials = rootNode.Tutorials;
  tutorial.userData[tid] = rootNode;

  tutorial.tutorialData[`${tid}:${bid}`] = {
    started: true,
    completed: false,
    updatedAt: nowTs()
  };
  if (branchRaceId) {
    applyTutorialRaceProgression(sparx.dataStore.profile, branchRaceId, { branchId: bid });
  }
  normalizeTutorialProgressionProfile(sparx.dataStore.profile);
  persistState();
  logFf7Debug('tutorial/start-branch', {
    userId,
    tid,
    bid,
    selection: {
      tid: requestedTutorialSelection.tid || null,
      bid: requestedTutorialSelection.bid || null,
      requestedTidRaw: requestedTutorialSelection.requestedTidRaw || null,
      requestedBidRaw: requestedTutorialSelection.requestedBidRaw || null
    },
    params: {
      tid: params.tid || params.tutorialId || null,
      bid: params.bid || params.branchId || null,
      nonce: params.nonce || null
    },
    profile: compactProfile(getProfile(userId))
  });

  return buildTutorialResult(userId);
}

function buildChapterData() {
  const chapters = (defaultCareerData.articleStructure && defaultCareerData.articleStructure.careerChapters) || [];
  const tutorialChapters = {};

  // Include ALL races (even disabled) so every chapter gets the correct num
  Object.entries(ff7TutorialConfig.races || {}).forEach(([raceId, raceConfig]) => {
    const chapterId = String(raceConfig.chapterId || FF7_TUTORIAL_CHAPTER_ID);
    const raceCityKey = getRaceCityKey(raceConfig, 'tokyo');
    if (!tutorialChapters[chapterId]) {
      tutorialChapters[chapterId] = {
        name: String(raceConfig.chapterName || 'Tutorial'),
        city: raceCityKey,
        status: 'started',
        count: 0,
        num: Number(raceConfig.chapterNum != null ? raceConfig.chapterNum : 0),
        raceInfos: [],
        class: 0,
        redeemers: [],
        icon: '',
        gachaToken: SHIPYARD_GACHA_TOKEN
      };
    }

    tutorialChapters[chapterId].raceInfos.push({
      name: raceId,
      type: String(raceConfig.raceType || 'street')
    });
    tutorialChapters[chapterId].count += 1;
  });

  return Object.values(tutorialChapters).concat(chapters.map((chapter, index) => ({
    name: chapter.title || `Chapter ${index + 1}`,
    city: `city_${index + 1}`,
    status: 'started',
    count: Array.isArray(chapter.events) ? chapter.events.length : 0,
    num: index + 1,
    raceInfos: (chapter.events || []).map((event, eventIndex) => ({
      name: event.id || `chapter-${index + 1}-race-${eventIndex + 1}`,
      type: 'street'
    })),
    class: 0,
    redeemers: [],
    icon: '',
    gachaToken: SHIPYARD_GACHA_TOKEN
  })));
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

function findCareerArticleByRaceKey(articles, raceKey) {
  const normalizedRaceKey = String(raceKey || '').trim();
  if (!normalizedRaceKey) {
    return null;
  }
  return (Array.isArray(articles) ? articles : []).find((article) => (
    getCareerArticleRaceKeys(article).includes(normalizedRaceKey)
  )) || null;
}

function buildCareerChapterData(userId = null) {
  const chapters = (defaultCareerData.articleStructure && defaultCareerData.articleStructure.careerChapters) || [];
  const articleById = new Map((defaultCareerData.articleList || []).map((article) => [String(article && article.id), article]));
  const profile = userId
    ? (((ensureSparxState(userId) || {}).dataStore || {}).profile || getProfile(userId) || {})
    : {};
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
    const chapterCityKey = String(
      (chapter && chapter.city) ||
      (chapter && chapter.cityKey) ||
      ''
    ).trim().toLowerCase();
    const normalizedChapterCityKey =
      chapterCityKey === 'miami, u.s.a.' ? 'miami' :
      chapterCityKey === 'los angeles' ? 'la' :
      chapterCityKey === 'tokyo, japan' ? 'tokyo' :
      (chapterCityKey || `city_${index + 1}`);
    const chapterBannerIcon = String(
      (chapter && chapter.icon) ||
      `race_story_chapter${chapterNum}_bg`
    );
    const chapterName = String(
      (chapter && chapter.name) ||
      (chapter && chapter.chapterName) ||
      `chapter_${String(chapterNum).padStart(2, '0')}`
    );
    const chapterTitle = String((chapter && chapter.title) || `CHAPTER ${index + 1}`);
    const chapterCityLabel = String((chapter && (chapter.cityLabel || chapter.city || '')) || '');
    const rawChapterId = String((chapter && (chapter.chapterId || chapter.id)) || '').trim();
    const normalizedChapterId =
      !rawChapterId || /^chapter-\d+$/i.test(rawChapterId)
        ? chapterName
        : rawChapterId;
    return {
      name: chapterName,
      chapterName,
      ChapterName: chapterName,
      city: normalizedChapterCityKey,
      status: articleIds.length > 0 && articlesFinished >= articleIds.length ? 'completed' : 'started',
      count: articleIds.length,
      num: chapterNum,
      chapterId: normalizedChapterId,
      ChapterId: normalizedChapterId,
      cmid: normalizedChapterId,
      CMID: normalizedChapterId,
      chapterTitle: chapterTitle,
      ChapterTitle: chapterTitle,
      chapterCity: normalizedChapterCityKey,
      ChapterCity: normalizedChapterCityKey,
      chapterCityLabel,
      ChapterCityLabel: chapterCityLabel,
      cityKey: normalizedChapterCityKey,
      CityKey: normalizedChapterCityKey,
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
      icon: chapterBannerIcon,
      gachaToken: SHIPYARD_GACHA_TOKEN
    };
  });
}

function buildCareerNextRacesPayload(userId = null) {
  return {
    raceData: buildCareerRaceData(null, userId).map((race) => applyStoryDialogueAliases(clone(race))),
    chapterData: buildCareerChapterData(userId),
    simMultipliers: {}
  };
}

function buildCompactResolveRaceProgressData(userId = null, preferredRaceId = '') {
  const chapterData = buildCareerChapterData(userId);
  const raceData = buildCareerRaceData(null, userId).map((race) => applyStoryDialogueAliases(clone(race)));
  const profile = userId
    ? ((((ensureSparxState(userId) || {}).dataStore || {}).profile) || getProfile(userId) || {})
    : {};
  const preferredKeys = [
    preferredRaceId,
    profile && profile.currentRaceId,
    profile && profile.CurrentRaceId,
    profile && profile.crid,
    profile && profile.jfrid,
    profile && profile.last_story_race
  ]
    .map((value) => String(value || '').trim())
    .filter(Boolean);
  const activeRace = preferredKeys
    .map((raceKey) => raceData.find((race) => String(firstDefined(race && race.ri, race && race.id, '') || '').trim() === raceKey))
    .find(Boolean) || raceData[0] || null;
  const activeChapterId = String(
    firstDefined(
      activeRace && (activeRace.chapterId || activeRace.ChapterId || activeRace.cmid),
      profile && profile.cmid,
      chapterData[0] && (chapterData[0].chapterId || chapterData[0].ChapterId || chapterData[0].cmid),
      ''
    ) || ''
  ).trim();
  const compactChapterData = activeChapterId
    ? chapterData.filter((chapter) => {
        const chapterKeys = [
          chapter && chapter.chapterId,
          chapter && chapter.ChapterId,
          chapter && chapter.cmid,
          chapter && chapter.name
        ].map((value) => String(value || '').trim()).filter(Boolean);
        return chapterKeys.includes(activeChapterId);
      })
    : [];
  const compactRaceData = activeChapterId
    ? raceData.filter((race) => {
        const chapterKeys = [
          race && race.chapterId,
          race && race.ChapterId,
          race && race.cmid
        ].map((value) => String(value || '').trim()).filter(Boolean);
        return chapterKeys.includes(activeChapterId);
      })
    : [];
  return {
    chapterData: (compactChapterData.length > 0 ? compactChapterData : chapterData.slice(0, 1)).map((entry) => clone(entry)),
    raceData: (compactRaceData.length > 0 ? compactRaceData : (activeRace ? [activeRace] : raceData.slice(0, 1)))
      .slice(0, 12)
      .map((entry) => clone(entry))
  };
}

function buildTutorialRaceBundle(userId, requestedRaceId) {
  const profile = getProfile(userId);
  const playerUid = getProfileUidValue(profile, userId);
  const raceId = String(firstDefined(requestedRaceId, FF7_TUTORIAL_RACE_ID));
  if (!isConfiguredTutorialRaceId(raceId)) {
    return null;
  }
  const chapter = buildTutorialChapterForRace(raceId);
  const allRaceData = buildRaceData(userId);
  const seedRace = clone(allRaceData.find((race) => String(race && race.ri ? race.ri : '') === raceId) || allRaceData[0] || {});
  const raceConfig = getTutorialRaceConfig(raceId);
  const selectedPlayerLookupValue = getPreferredRacePlayerLookupValue(userId, {}, profile);
  const resolvedSelectedPlayerRecord = raceConfig.useSelectedPlayerCar
    ? resolveOwnedVehicleRecord(
        userId,
        selectedPlayerLookupValue,
        firstDefined(profile && (profile.CurrentVehicleTag || profile.currentVehicleTag), getDefaultProfileVehicleTag())
      )
    : null;
  const playerTag = String(
    raceConfig.useSelectedPlayerCar
      ? normalizeVehicleTag(
          firstDefined(
            resolvedSelectedPlayerRecord && (
              resolvedSelectedPlayerRecord.carId ||
              resolvedSelectedPlayerRecord.car ||
              resolvedSelectedPlayerRecord.AssetTag ||
              resolvedSelectedPlayerRecord.assetTag ||
              (resolvedSelectedPlayerRecord.r && resolvedSelectedPlayerRecord.r.n) ||
              (resolvedSelectedPlayerRecord.recipe && resolvedSelectedPlayerRecord.recipe.n)
            ),
            selectedPlayerLookupValue,
            profile && (profile.CurrentVehicleTag || profile.currentVehicleTag),
            getDefaultProfileVehicleTag()
          ),
          getDefaultProfileVehicleTag()
        )
      : (raceConfig.playerCarId || FF7_TUTORIAL_PLAYER_CAR_ID)
  );
  const opponentTag = String(
    pickDeterministicVariant(
      `${String(userId || profile && (profile.uid || profile.id) || playerUid)}:${raceId}`,
      raceConfig.opponentCarPool,
      raceConfig.opponentCarId || FF7_TUTORIAL_OPPONENT_CAR_ID
    ) || FF7_TUTORIAL_OPPONENT_CAR_ID
  );
  const tutorialRaceOptions = {};
  const playerSeedRecord = resolvedSelectedPlayerRecord
    ? buildPersistedOwnedCarRecord(userId, playerUid, resolvedSelectedPlayerRecord, 0, playerTag)
    : buildOwnedCarRecord(playerTag, playerUid, 0);
  const playerCar = buildMatchCarRecord(playerSeedRecord, playerUid, tutorialRaceOptions);
  const opponentCar = buildMatchCarRecord(buildOwnedCarRecord(opponentTag, `opponent-${raceId}`, 0), `opponent-${raceId}`, tutorialRaceOptions);
  const trafficRecords = (Array.isArray(raceConfig.trafficCarIds) ? raceConfig.trafficCarIds : []).map((tag, index) => buildMatchCarRecord(buildOwnedCarRecord(tag, `${playerUid}-traffic-${index + 1}`, index), `${playerUid}-traffic-${index + 1}`, tutorialRaceOptions));
  const policeRecords = (Array.isArray(raceConfig.policeCarIds) ? raceConfig.policeCarIds : []).map((tag, index) => buildMatchCarRecord(buildOwnedCarRecord(tag, `${playerUid}-police-${index + 1}`, index), `${playerUid}-police-${index + 1}`, tutorialRaceOptions));
  const raceCars = [
    clone(playerCar),
    clone(opponentCar),
    ...trafficRecords.map((record) => clone(record)),
    ...policeRecords.map((record) => clone(record))
  ];
  const trafficCarIds = trafficRecords.map((record) => record.carId);
  const policeCarIds = policeRecords.map((record) => record.carId);
  const trafficCarPrefabs = trafficRecords.map((record) => getPrefabPath(record));
  const policeCarPrefabs = policeRecords.map((record) => getPrefabPath(record));
  const defaultPolicePrefab = policeCarPrefabs.length > 0 ? policeCarPrefabs[0] : '';
  const trafficLevelLabel = getTrafficLevelLabel(raceConfig, trafficRecords.length);
  const raceCarsById = {};
  raceCars.forEach((record) => {
    indexCarRecord(raceCarsById, record);
  });
  const raceCarsContainer = buildRaceCarsContainer(
    playerCar,
    opponentCar,
    Number(seedRace.pr || 0),
    Number(seedRace.opi || 0)
  );
  const race = {
    ...seedRace,
    pc: playerCar.carId,
    PlayerCar: playerCar.carId,
    playerCar: playerCar.carId,
    PlayerCarId: playerCar.carId,
    playerCarId: playerCar.carId,
    PlayerCarRecipe: clone(playerCar.r || playerCar.recipe),
    playerCarRecipe: clone(playerCar.r || playerCar.recipe),
    PlayerCarMetaData: clone(playerCar.CarMetaData || playerCar.carMetaData),
    playerCarMetaData: clone(playerCar.CarMetaData || playerCar.carMetaData),
    pv: buildRaceVuString(playerCar),
    ppu: clone(playerCar.pu || buildRacePerformanceUpgradePayload(playerCar.vehicleStatus || playerCar.VehicleStatus || {})),
    pup: clone(playerCar.up || buildRaceUpgradePayload(playerCar.vehicleStatus || playerCar.VehicleStatus || {})),
    oc: opponentCar.carId,
    OpponentCar: opponentCar.carId,
    opponentCar: opponentCar.carId,
    OpponentCarId: opponentCar.carId,
    opponentCarId: opponentCar.carId,
    OpponentCarRecipe: clone(opponentCar.r || opponentCar.recipe),
    opponentCarRecipe: clone(opponentCar.r || opponentCar.recipe),
    OpponentCarMetaData: clone(opponentCar.CarMetaData || opponentCar.carMetaData),
    opponentCarMetaData: clone(opponentCar.CarMetaData || opponentCar.carMetaData),
    PlayerCarData: clone(playerCar),
    playerCarData: clone(playerCar),
    OpponentCarData: clone(opponentCar),
    opponentCarData: clone(opponentCar),
    player: clone(raceCarsContainer.player),
    opponent: clone(raceCarsContainer.opponent),
    cars: clone(raceCarsContainer),
    carRecords: clone(raceCars),
    CarsArray: clone(raceCars),
    carsById: clone(raceCarsById),
    trafficCarsDisabled: trafficRecords.length === 0,
    trafficCars: trafficCarIds.slice(),
    TrafficCars: trafficCarIds.slice(),
    trafficCarIds: trafficCarIds.slice(),
    TrafficCarIds: trafficCarIds.slice(),
    trafficCarData: trafficRecords.map((record) => clone(record)),
    TrafficCarData: trafficRecords.map((record) => clone(record)),
    trafficVehiclePrefabList: trafficCarPrefabs.slice(),
    TrafficVehiclePrefabList: trafficCarPrefabs.slice(),
    aiTrafficVehicles: trafficRecords.map((record) => clone(record)),
    AiTrafficVehicles: trafficRecords.map((record) => clone(record)),
    aiTrafficVehiclePrefabs: trafficCarPrefabs.slice(),
    AiTrafficVehiclePrefabs: trafficCarPrefabs.slice(),
    trafficLevel: trafficLevelLabel,
    TrafficLevel: trafficLevelLabel,
    policeCars: policeCarIds.slice(),
    PoliceCars: policeCarIds.slice(),
    policeCarIds: policeCarIds.slice(),
    PoliceCarIds: policeCarIds.slice(),
    policeCarData: policeRecords.map((record) => clone(record)),
    PoliceCarData: policeRecords.map((record) => clone(record)),
    policeCarPrefabList: policeCarPrefabs.slice(),
    PoliceCarPrefabList: policeCarPrefabs.slice(),
    policeCarPool: policeRecords.map((record) => clone(record)),
    PoliceCarPool: policeRecords.map((record) => clone(record)),
    policeCarPath: defaultPolicePrefab,
    PoliceCarPath: defaultPolicePrefab,
    policeCarPrefab: defaultPolicePrefab,
    PoliceCarPrefab: defaultPolicePrefab,
    ov: buildRaceVuString(opponentCar),
    opu: clone(opponentCar.pu || buildRacePerformanceUpgradePayload(opponentCar.vehicleStatus || opponentCar.VehicleStatus || {})),
    oup: clone(opponentCar.up || buildRaceUpgradePayload(opponentCar.vehicleStatus || opponentCar.VehicleStatus || {}))
  };
  applyStoryDialogueAliases(
    enforceStartupDialogPayload(raceId, raceConfig, race)
  );

  return {
    race,
    chapter,
    nextRaces: {
      raceData: [clone(race)],
      chapterData: [clone(chapter)],
      simMultipliers: {}
    },
    cars: clone(raceCarsContainer),
    carsById: clone(raceCarsById),
    carRecords: clone(raceCars),
    CarsArray: clone(raceCars),
    playerCar: clone(playerCar),
    opponentCar: clone(opponentCar),
    trafficCars: trafficRecords.map((record) => clone(record)),
    policeCars: policeRecords.map((record) => clone(record))
  };
}

function buildTutorialLoginRace(race) {
  const lightweightRace = clone(race || {});
  if (lightweightRace.cars && typeof lightweightRace.cars === 'object') {
    const loginCars = buildTutorialLoginCarsContainer(lightweightRace.cars);
    lightweightRace.cars = loginCars;
    lightweightRace.player = clone(loginCars.player);
    lightweightRace.opponent = clone(loginCars.opponent);
  }
  [
    'carsById',
    'carRecords',
    'CarsArray',
    'PlayerCarData',
    'playerCarData',
    'OpponentCarData',
    'opponentCarData',
    'PlayerCarRecipe',
    'playerCarRecipe',
    'OpponentCarRecipe',
    'opponentCarRecipe',
    'PlayerCarMetaData',
    'playerCarMetaData',
    'OpponentCarMetaData',
    'opponentCarMetaData',
    'trafficCarData',
    'TrafficCarData',
    'aiTrafficVehicles',
    'AiTrafficVehicles',
    'policeCarData',
    'PoliceCarData',
    'policeCarPool',
    'PoliceCarPool',
    'trafficCars',
    'TrafficCars',
    'trafficCarIds',
    'TrafficCarIds',
    'trafficVehiclePrefabList',
    'TrafficVehiclePrefabList',
    'aiTrafficVehiclePrefabs',
    'AiTrafficVehiclePrefabs',
    'trafficLevel',
    'TrafficLevel',
    'policeCars',
    'PoliceCars',
    'policeCarIds',
    'PoliceCarIds',
    'policeCarPrefabList',
    'PoliceCarPrefabList',
    'policeCarPath',
    'PoliceCarPath',
    'policeCarPrefab',
    'PoliceCarPrefab'
  ].forEach((key) => {
    delete lightweightRace[key];
  });

  return applyStoryDialogueAliases(lightweightRace);
}

function getTutorialPreloadedRaceIds(activeBranchId, activeRaceId) {
  const raceIds = [];
  const pushRaceId = (raceId) => {
    const normalizedRaceId = String(raceId || '').trim();
    if (!isConfiguredTutorialRaceId(normalizedRaceId) || raceIds.includes(normalizedRaceId)) {
      return;
    }
    raceIds.push(normalizedRaceId);
  };

  pushRaceId(activeRaceId);

  return raceIds;
}

function getTutorialDisplayRaceId(activeBranchId, activeRaceId = '') {
  const normalizedActiveRaceId = String(activeRaceId || '').trim();
  return isConfiguredTutorialRaceId(normalizedActiveRaceId)
    ? normalizedActiveRaceId
    : '';
}

function buildRuntimeNextRacesPayload(userId) {
  const sparx = ensureSparxState(userId);
  const tutorial = sparx && sparx.tutorial ? sparx.tutorial : {};
  const profile = getProfile(userId) || {};
  const wonRaces = profile && typeof profile.won_races === 'object' ? profile.won_races : {};
  const hasCareerRacePointer = /^\d+$/.test(String(firstDefined(
    profile.crid,
    profile.jfrid,
    profile.CurrentRaceId,
    profile.currentRaceId,
    profile.current_race_id,
    ''
  )).trim());
  const activeBranchId = normalizeTutorialBranchId(
    firstDefined(
      getEffectiveTutorialBranchId(tutorial, profile),
      getProfileDrivenTutorialCheckpoint(profile).activeBranchId,
      ''
    ),
    ''
  );
  const activeRaceId = getTutorialBranchRaceId(activeBranchId, '');
  const tutorialMarkedComplete =
    FF7_SKIP_TUTORIAL_TO_GARAGE ||
    hasCareerRacePointer ||
    (
      !isConfiguredTutorialRaceId(activeRaceId) &&
      (
        Number(profile.tut_id || 0) >= 2 ||
        (String(profile.crid || '').trim() === '' &&
          String(profile.jfrid || '').trim() === '' &&
          Object.keys(wonRaces).length > 0)
      )
    );

  if (tutorialMarkedComplete) {
    return buildCareerNextRacesPayload(userId);
  }

  const raceIds = [];
  const pushRaceId = (raceId) => {
    const normalizedRaceId = String(raceId || '').trim();
    if (!isConfiguredTutorialRaceId(normalizedRaceId) || raceIds.includes(normalizedRaceId)) {
      return;
    }
    raceIds.push(normalizedRaceId);
  };

  pushRaceId(activeRaceId);

  return buildTutorialNextRacesPayload(userId, raceIds);
}

function buildTutorialNextRacesPayload(userId, raceIds = []) {
  const normalizedRaceIds = Array.isArray(raceIds)
    ? raceIds.map((raceId) => String(raceId || '').trim()).filter(Boolean)
    : [];
  if (normalizedRaceIds.length <= 0) {
    return buildEmptyNextRacesPayload();
  }

  const raceData = [];
  const chapterData = [];
  const chapterKeys = new Set();

  normalizedRaceIds.forEach((raceId) => {
    const runtime = buildTutorialRaceBundle(userId, raceId);
    if (!runtime || !runtime.race) {
      // Race bundle is null (e.g. disabled race), but still try to include chapter data
      const rawConfig = (ff7TutorialConfig.races && ff7TutorialConfig.races[raceId]) || {};
      if (rawConfig.chapterId) {
        const chapter = buildTutorialChapterForRace(raceId);
        if (chapter && typeof chapter === 'object') {
          const chapterKey = JSON.stringify([
            chapter.name || '',
            chapter.city || '',
            chapter.num || 0
          ]);
          if (!chapterKeys.has(chapterKey)) {
            chapterKeys.add(chapterKey);
            chapterData.push(clone(chapter));
          }
        }
      }
      return;
    }
    raceData.push(buildTutorialLoginRace(runtime.race));
    if (runtime.chapter && typeof runtime.chapter === 'object') {
      const chapterKey = JSON.stringify([
        runtime.chapter.name || '',
        runtime.chapter.city || '',
        runtime.chapter.num || 0
      ]);
      if (!chapterKeys.has(chapterKey)) {
        chapterKeys.add(chapterKey);
        chapterData.push(clone(runtime.chapter));
      }
    }
  });

  return {
    raceData,
    chapterData,
    simMultipliers: {}
  };
}

function buildCompactTutorialNextRaces(result) {
  const nextRaces = result && result.nextRaces && typeof result.nextRaces === 'object'
    ? result.nextRaces
    : buildEmptyNextRacesPayload();
  const sourceRaceData = Array.isArray(nextRaces.raceData)
    ? nextRaces.raceData
    : (Array.isArray(result && result.raceData) ? result.raceData : []);
  const sourceChapterData = Array.isArray(nextRaces.chapterData)
    ? nextRaces.chapterData
    : (Array.isArray(result && result.chapterData) ? result.chapterData : []);
  const sourceSimMultipliers =
    nextRaces.simMultipliers && typeof nextRaces.simMultipliers === 'object'
      ? nextRaces.simMultipliers
      : (result && result.simMultipliers && typeof result.simMultipliers === 'object' ? result.simMultipliers : {});
  return {
    raceData: sourceRaceData.map((race) => buildTutorialLoginRace(race)),
    chapterData: clone(sourceChapterData),
    simMultipliers: clone(sourceSimMultipliers)
  };
}

function buildCompactTutorialActionResult(result) {
  const compactNextRaces = buildCompactTutorialNextRaces(result);
  const compactResult = {
    api: result.api,
    dbHash: result.dbHash,
    hash: result.hash,
    changed: Boolean(result.changed),
    refresh: Boolean(result.refresh),
    check: String(result.check || ''),
    connected: Boolean(result.connected),
    status: String(result.status || 'connected'),
    branchData: clone(result.branchData || {}),
    stateHash: String(result.stateHash || ''),
    state1Hash: String(result.state1Hash || ''),
    state2Hash: String(result.state2Hash || ''),
    JumpToRaceID: String(result.JumpToRaceID || ''),
    JumpToRaceIds: Array.isArray(result.JumpToRaceIds) ? result.JumpToRaceIds.slice() : [],
    currentTutorialId: result.currentTutorialId == null ? null : String(result.currentTutorialId),
    currentTutorialGroupId: result.currentTutorialGroupId == null ? null : String(result.currentTutorialGroupId),
    largestTutorialId: Number(result.largestTutorialId || 0),
    largestTutorialGroupId: Number(result.largestTutorialGroupId || 0),
    tutorials: Array.isArray(result.tutorials) ? result.tutorials.slice() : [],
    tutorialGroups: Array.isArray(result.tutorialGroups) ? result.tutorialGroups.slice() : [],
    tutorialGroupsCompleted: Array.isArray(result.tutorialGroupsCompleted) ? result.tutorialGroupsCompleted.slice() : [],
    activeTutorial: clone(result.activeTutorial || null),
    ltid: Number(result.ltid || 0),
    ltgid: Number(result.ltgid || 0),
    dbhash: String(result.dbhash || result.dbHash || ''),
    nextRaces: clone(compactNextRaces),
    raceData: clone(compactNextRaces.raceData),
    chapterData: clone(compactNextRaces.chapterData),
    simMultipliers: clone(compactNextRaces.simMultipliers),
    progression: clone(result.progression || {}),
    tutorialData: Array.isArray(result.tutorialData) ? clone(result.tutorialData) : []
  };
  FF7_RACE_RESULT_KEYS.forEach((key) => {
    if (Object.prototype.hasOwnProperty.call(result || {}, key)) {
      compactResult[key] = clone(result[key]);
    }
  });

  ['tut'].forEach((key) => {
    if (Object.prototype.hasOwnProperty.call(result || {}, key)) {
      compactResult[key] = clone(result[key]);
    }
  });

  Object.keys(result || {}).forEach((key) => {
    if (Object.prototype.hasOwnProperty.call(compactResult, key)) return;
    if (key === FF7_TUTORIAL_ID || /^G\d+$/i.test(key)) {
      compactResult[key] = clone(result[key]);
    }
  });
  const activeBid = normalizeTutorialBranchId(
    result && result.activeTutorial && result.activeTutorial.bid,
    ''
  );
  const hasCareerRaceData = Array.isArray(compactResult.nextRaces && compactResult.nextRaces.raceData)
    && compactResult.nextRaces.raceData.some((race) => /^(?:\d+|chapter_\d{2}_[a-z])$/i.test(String(firstDefined(race && race.ri, race && race.id, '') || '').trim()));
  if (!hasCareerRaceData && !isConfiguredTutorialRaceId(getTutorialBranchRaceId(activeBid, ''))) {
    clearRacePayload(compactResult);
  }
  return applyStoryDialogueAliases(compactResult);
}

function getContextualTutorialMirrorState(result, tutorialId) {
  const normalizedTutorialId = String(tutorialId || '').trim();
  if (!normalizedTutorialId || !result || typeof result !== 'object') {
    return 1;
  }

  const directNode = result[normalizedTutorialId];
  if (directNode && typeof directNode === 'object') {
    const directState = String(firstDefined(directNode.s, '') || '').toLowerCase();
    if (directState === 'completed') return 2;
    if (directState === 'started') return 1;
  }

  const tutNode = result.tut && result.tut[normalizedTutorialId];
  if (tutNode && typeof tutNode === 'object') {
    const tutState = String(firstDefined(tutNode.s, '') || '').toLowerCase();
    if (tutState === 'completed') return 2;
    if (tutState === 'started') return 1;
  }

  const userDataNode = result.userData && result.userData[normalizedTutorialId];
  if (userDataNode && typeof userDataNode === 'object') {
    const numericState = Number(firstDefined(userDataNode.State, userDataNode.state, 1) || 1);
    return numericState >= 2 ? 2 : 1;
  }

  const tutorialDataEntryKey = `${normalizedTutorialId}:${normalizedTutorialId}`;
  const tutorialDataEntry = Array.isArray(result.tutorialData)
    ? result.tutorialData.find((entry) => String(entry && entry.key || '') === tutorialDataEntryKey)
    : null;
  if (tutorialDataEntry && tutorialDataEntry.completed) {
    return 2;
  }

  return 1;
}

function getTutorialActionResponseKeys() {
  return [
    'api',
    'dbHash',
    'dbhash',
    'hash',
    'changed',
    'refresh',
    'check',
    'connected',
    'status',
    'branchData',
    'branches',
    'stateHash',
    'state1Hash',
    'state2Hash',
    'JumpToRaceID',
    'JumpToRaceIds',
    'currentTutorialId',
    'currentTutorialGroupId',
    'largestTutorialId',
    'largestTutorialGroupId',
    'tutorials',
    'tutorialGroups',
    'tutorialGroupsCompleted',
    'activeTutorial',
    'ltid',
    'ltgid',
    'nextRaces',
    'raceData',
    'chapterData',
    'simMultipliers',
    'ri',
    'rc',
    'rt',
    'pr',
    'clr',
    'sim',
    'dis',
    'ti',
    'de',
    'ric',
    'rci',
    'rde',
    'brd',
    'obj',
    'sn',
    'sv',
    'tl',
    'okl',
    'on',
    'oph',
    'opmt',
    'opi',
    'tm',
    'pspd',
    'cspd',
    'md',
    'xw',
    'xgtw',
    'xl',
    'upw',
    'upgw',
    'upl',
    'hc',
    'ppti',
    'cr',
    'gt',
    'gb',
    'scw',
    'scl',
    'pra',
    'pc',
    'PlayerCar',
    'playerCar',
    'PlayerCarId',
    'playerCarId',
    'pv',
    'ppu',
    'pup',
    'oc',
    'OpponentCar',
    'opponentCar',
    'OpponentCarId',
    'opponentCarId',
    'ov',
    'opu',
    'oup',
    'progression',
    'tutorialData',
    'tut',
    FF7_TUTORIAL_ID
  ];
}

function stripHeavyRuntimeRaceData(race) {
  const lightweightRace = clone(race || {});
  [
    'cars',
    'carsById',
    'trafficCarsDisabled',
    'trafficCars',
    'TrafficCars',
    'trafficCarIds',
    'TrafficCarIds',
    'trafficCarData',
    'TrafficCarData',
    'trafficVehiclePrefabList',
    'TrafficVehiclePrefabList',
    'aiTrafficVehicles',
    'AiTrafficVehicles',
    'aiTrafficVehiclePrefabs',
    'AiTrafficVehiclePrefabs',
    'trafficLevel',
    'TrafficLevel',
  ].forEach((key) => delete lightweightRace[key]);
  return lightweightRace;
}

function buildRaceData(userId = null) {
  const articles = defaultCareerData.articleList || [];
  const profile = userId ? (getProfile(userId) || {}) : {};
  const selectedProfileTag = normalizeVehicleTag(
    firstDefined(
      profile && (profile.CurrentVehicleTag || profile.currentVehicleTag),
      getDefaultProfileVehicleTag()
    ),
    getDefaultProfileVehicleTag()
  );
  const tutorialRaces = Object.entries(ff7TutorialConfig.races || {}).flatMap(([raceId, raceConfig]) => {
    if (isDisabledTutorialRaceId(raceId)) {
      return [];
    }
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
      rci: getRaceCityKey(raceConfig, 'tokyo'),
      rde: getRaceObjectiveValue(raceConfig),
      brd: [],
      obj: getRaceObjectiveValue(raceConfig),
      sn: String(raceConfig.runtimeSceneName || raceConfig.sceneName || 'track_la_street'),
      sv: raceConfig.sceneVariant == null ? 'tutorial' : String(raceConfig.sceneVariant),
      tl: getTrafficLevelLabel(raceConfig, Array.isArray(raceConfig.trafficCarIds) ? raceConfig.trafficCarIds.length : 0),
      okl: 'easy',
      on: String(raceConfig.opponentName || 'Street Rival'),
      oph: Number(raceConfig.opponentPower || 1),
      opmt: Number(raceConfig.opponentMatchTime || 300),
      opi: Number(raceConfig.opponentPi || 280),
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
      br2: [],
      br3: [],
      br4: [],
      br5: [],
      br6: [],
      ...buildRaceCarMirrors(
        playerTag,
        opponentTag,
        {
          raceConfig,
          trafficTags: Array.isArray(raceConfig.trafficCarIds) ? raceConfig.trafficCarIds : [],
          policeTags: Array.isArray(raceConfig.policeCarIds) ? raceConfig.policeCarIds : []
        }
      )
    };
    return applyStoryDialogueAliases(
      enforceStartupDialogPayload(raceId, raceConfig, racePayload)
    );
  });

  return tutorialRaces
    .concat(buildCareerRaceData(articles, userId))
    .concat(buildCareerRaceData(defaultChallengeArticles, userId))
    .concat(buildCareerRaceData(defaultRandomChallengeArticles, userId));
}

function buildCareerRaceData(articlesArg = null, userId = null) {
  const articles = Array.isArray(articlesArg) ? articlesArg : (defaultCareerData.articleList || []);
  const profile = userId
    ? ((((ensureSparxState(userId) || {}).dataStore || {}).profile) || getProfile(userId) || {})
    : null;
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
    const preferredRecordId = String(
      firstDefined(
        profile && (profile.lastRequestedCarId || profile.LastRequestedCarId),
        profile && (profile.active_carid || profile.activeCarId),
        ''
      ) || ''
    ).trim();
    const preferredVehicleTag = normalizeProfileVehicleTag(
      firstDefined(
        profile && (profile.CurrentVehicleTag || profile.currentVehicleTag),
        getDefaultProfileVehicleTag()
      ),
      getDefaultProfileVehicleTag()
    );
    const selectedPlayerRecord = userId
      ? (
          (preferredRecordId ? resolveOwnedVehicleRecord(userId, preferredRecordId, preferredVehicleTag) : null) ||
          resolveOwnedVehicleRecord(userId, preferredVehicleTag, preferredVehicleTag)
        )
      : null;
    const playerTag = String(
      firstDefined(
        selectedPlayerRecord && (selectedPlayerRecord.carId || selectedPlayerRecord.car),
        preferredVehicleTag,
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
    const displayOpponentPi = needsVsOpponent
      ? Number((article && article.requiredPi) || 250)
      : (soloRace ? 0 : Number((article && article.opponentPi) || (article && article.requiredPi) || 250));
    const rewardSc = Math.max(0, Math.trunc(Number(firstDefined(article && article.rewardSc, article && article.softCurrencyReward, 250) || 250)));
    const rewardHc = Math.max(0, Math.trunc(Number(firstDefined(article && article.rewardHc, article && article.hardCurrencyReward, 0) || 0)));
    const rewardUp = Math.max(0, Math.trunc(Number(firstDefined(article && article.rewardUp, article && article.upgradeReward, 0) || 0)));
    const rewardXp = Math.max(0, Math.trunc(Number(firstDefined(article && article.rewardXp, article && article.xpReward, 35) || 35)));
    const classRequirement = Math.max(1, Math.trunc(Number(firstDefined(article && article.classRequirement, article && article.requiredClass, 1) || 1)));
    const classMax = Math.max(classRequirement, Math.trunc(Number(firstDefined(article && article.classMax, classRequirement, 1) || 1)));
    return ({
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
    tl: getTrafficLevelLabel(article, Array.isArray(article && article.trafficCarIds) ? article.trafficCarIds.length : 0),
    okl: 'easy',
    on: soloRace ? '' : String((article && article.opponentName) || 'Street Rival'),
    oph: soloRace ? 0 : 1,
    opmt: soloRace ? 0 : Number((article && article.opponentMatchTime) || 420),
    opi: displayOpponentPi,
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
    cr: index === 0,
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
    ...buildRaceCarMirrors(
      playerTag,
      opponentTag,
      {
        playerPi: Number((article && article.requiredPi) || 250),
        opponentPi: displayOpponentPi,
        solo: soloRace,
        vsOpponentTag: displayOpponentTag,
        trafficTags: Array.isArray(article && article.trafficCarIds) ? article.trafficCarIds : [],
        policeTags: Array.isArray(article && article.policeCarIds) ? article.policeCarIds : []
      }
    ),
    pra: '',
    br2: [],
    br3: [],
    br4: [],
    br5: [],
    br6: []
  });
  });
}

function buildCompletedRaces() {
  return {};
}

function getCareerArticleList() {
  return (Array.isArray(defaultCareerData.articleList) ? defaultCareerData.articleList : [])
    .slice()
    .sort((left, right) => Number(left && left.id || 0) - Number(right && right.id || 0));
}

function getChallengeArticleList() {
  return []
    .concat(Array.isArray(defaultChallengeArticles) ? defaultChallengeArticles : [])
    .concat(Array.isArray(defaultRandomChallengeArticles) ? defaultRandomChallengeArticles : [])
    .slice()
    .sort((left, right) => Number(left && left.id || 0) - Number(right && right.id || 0));
}

function getCareerArticleByRaceId(raceId) {
  const normalizedRaceId = String(raceId || '').trim();
  if (!normalizedRaceId) return null;
  return getCareerArticleList().find((article) => getCareerArticleRaceKeys(article).includes(normalizedRaceId)) || null;
}

function getChallengeArticleByRaceId(raceId) {
  const normalizedRaceId = String(raceId || '').trim();
  if (!normalizedRaceId) return null;
  return getChallengeArticleList().find((article) => String(article && article.id || '') === normalizedRaceId) || null;
}

function getNextCareerArticle(profile = {}, currentRaceId = '') {
  const articles = getCareerArticleList();
  const wonRaces = profile && profile.won_races && typeof profile.won_races === 'object'
    ? profile.won_races
    : {};
  const normalizedCurrentRaceId = String(currentRaceId || '').trim();
  const currentIndex = articles.findIndex((article) => getCareerArticleRaceKeys(article).includes(normalizedCurrentRaceId));
  if (currentIndex >= 0) {
    for (let index = currentIndex + 1; index < articles.length; index += 1) {
      const article = articles[index];
      if (!hasWonCareerArticle(wonRaces, article)) {
        return article;
      }
    }
  }
  return articles.find((article) => !hasWonCareerArticle(wonRaces, article)) || null;
}

function resolveChallengeMatchState(userId, params, article) {
  const sparx = ensureSparxState(userId);
  const profile = sparx.dataStore && sparx.dataStore.profile ? sparx.dataStore.profile : {};
  const rootProfile = getProfile(userId);
  const inventory = sparx.dataStore && sparx.dataStore.inventory && typeof sparx.dataStore.inventory === 'object'
    ? sparx.dataStore.inventory
    : null;
  const raceId = String(params.raceId || params.id || params.ri || '').trim();
  const resultCode = String(params.result || '').trim().toUpperCase();
  const won = params.won === true || params.won === 1 || resultCode === 'WON';
  const articleIndex = Math.max(0, getChallengeArticleList().findIndex((entry) => String(entry && entry.id || '') === raceId));
  const baseRewards = buildCareerRaceRewards(article, articleIndex);
  const rewards = won
    ? baseRewards
    : {
        hc: Math.max(0, Math.trunc(Number(baseRewards.hc || 0) * 0.25)),
        sc: Math.max(150, Math.trunc(Number(baseRewards.sc || 0) * 0.35)),
        up: Math.max(0, Math.trunc(Number(baseRewards.up || 0) * 0.25)),
        xp: Math.max(15, Math.trunc(Number(baseRewards.xp || 0) * 0.3)),
        rp: Math.max(0, Math.trunc(Number(baseRewards.rp || 0) * 0.2)),
        hardCurrency: Math.max(0, Math.trunc(Number(baseRewards.hc || 0) * 0.25)),
        softCurrency: Math.max(150, Math.trunc(Number(baseRewards.sc || 0) * 0.35)),
        upgradePoints: Math.max(0, Math.trunc(Number(baseRewards.up || 0) * 0.25)),
        experiencePoints: Math.max(15, Math.trunc(Number(baseRewards.xp || 0) * 0.3)),
        respectPoints: Math.max(0, Math.trunc(Number(baseRewards.rp || 0) * 0.2)),
        Redeemers: [
          { type: 'res', Type: 'res', data: 'sc', Data: 'sc', n: 'sc', q: Math.max(150, Math.trunc(Number(baseRewards.sc || 0) * 0.35)), quantity: Math.max(150, Math.trunc(Number(baseRewards.sc || 0) * 0.35)), Quantity: Math.max(150, Math.trunc(Number(baseRewards.sc || 0) * 0.35)) },
          ...(Math.max(0, Math.trunc(Number(baseRewards.hc || 0) * 0.25)) > 0 ? [{ type: 'res', Type: 'res', data: 'hc', Data: 'hc', n: 'hc', q: Math.max(0, Math.trunc(Number(baseRewards.hc || 0) * 0.25)), quantity: Math.max(0, Math.trunc(Number(baseRewards.hc || 0) * 0.25)), Quantity: Math.max(0, Math.trunc(Number(baseRewards.hc || 0) * 0.25)) }] : [])
        ],
        redeemers: [
          { type: 'res', Type: 'res', data: 'sc', Data: 'sc', n: 'sc', q: Math.max(150, Math.trunc(Number(baseRewards.sc || 0) * 0.35)), quantity: Math.max(150, Math.trunc(Number(baseRewards.sc || 0) * 0.35)), Quantity: Math.max(150, Math.trunc(Number(baseRewards.sc || 0) * 0.35)) },
          ...(Math.max(0, Math.trunc(Number(baseRewards.hc || 0) * 0.25)) > 0 ? [{ type: 'res', Type: 'res', data: 'hc', Data: 'hc', n: 'hc', q: Math.max(0, Math.trunc(Number(baseRewards.hc || 0) * 0.25)), quantity: Math.max(0, Math.trunc(Number(baseRewards.hc || 0) * 0.25)), Quantity: Math.max(0, Math.trunc(Number(baseRewards.hc || 0) * 0.25)) }] : [])
        ]
      };

  applyCareerRewardsToProfile(profile, rewards, inventory);
  if (rootProfile && typeof rootProfile === 'object') {
    applyCareerRewardsToProfile(rootProfile, rewards, null);
  }
  persistState();
  const compactProgressData = buildCompactResolveRaceProgressData(
    userId,
    String(
      firstDefined(
        profile.currentRaceId,
        profile.CurrentRaceId,
        profile.crid,
        profile.jfrid,
        raceId,
        ''
      ) || ''
    )
  );

  return {
    raceId,
    result: resultCode || (won ? 'WON' : 'LOST'),
    nextBranchId: '',
    nextRaceId: String(profile.currentRaceId || profile.CurrentRaceId || ''),
    raceRewards: clone(rewards),
    carCond: null,
    progression: {
      crid: String(profile.crid || ''),
      jfrid: String(profile.jfrid || ''),
      cmid: String(profile.cmid || ''),
      tut_id: Number(profile.tut_id || 0),
      currentRaceId: String(profile.currentRaceId || ''),
      CurrentRaceId: String(profile.CurrentRaceId || ''),
      last_story_race: String(profile.last_story_race || '')
    },
    profile: {
      level: Number(profile.level || profile.Level || 1),
      xp: Number(profile.xp || profile.XP || 0),
      coins: Number(profile.NoCoins || profile.coins || 0),
      stars: Number(profile.NoStars || profile.gold || 0),
      fuel: Number(profile.Fuel || profile.fuel || 0),
      crid: String(profile.crid || ''),
      jfrid: String(profile.jfrid || ''),
      cmid: String(profile.cmid || ''),
      tut_id: Number(profile.tut_id || 0),
      currentRaceId: String(profile.currentRaceId || ''),
      CurrentRaceId: String(profile.CurrentRaceId || ''),
      last_story_race: String(profile.last_story_race || ''),
      JustFinishedRaceId: String(profile.JustFinishedRaceId || ''),
      LastWonStoryRaceID: String(profile.LastWonStoryRaceID || '')
    },
    inventory: buildFlatInventoryResult(userId),
    wallet: buildWalletResult(userId),
    resources: buildResourceResult(userId),
    gamestats: buildGameStatsPayload(userId),
    levelrewards: buildLevelRewardsStatusMap(userId),
    chapterData: compactProgressData.chapterData,
    raceData: compactProgressData.raceData
  };
}

function buildCareerRaceRewards(article, articleIndex = 0) {
  const redeemers = Array.isArray(article && article.winRedeemers) && article.winRedeemers.length > 0
    ? article.winRedeemers.map((entry) => clone(entry))
    : [
        { type: 'res', Type: 'res', data: 'up', Data: 'up', n: 'up', q: 10, quantity: 10, Quantity: 10 },
        { type: 'res', Type: 'res', data: 'sc', Data: 'sc', n: 'sc', q: 450, quantity: 450, Quantity: 450 },
        { type: 'res', Type: 'res', data: 'hc', Data: 'hc', n: 'hc', q: 1, quantity: 1, Quantity: 1 }
      ];
  const sumRedeemers = (key) => redeemers.reduce((total, entry) => {
    const data = String(firstDefined(entry && entry.data, entry && entry.Data, entry && entry.n, '') || '').trim().toLowerCase();
    if (data !== key) return total;
    return total + Math.max(0, Math.trunc(Number(firstDefined(entry && entry.q, entry && entry.quantity, entry && entry.Quantity, 0) || 0)));
  }, 0);
  const hc = sumRedeemers('hc') || 1;
  const sc = sumRedeemers('sc') || 450;
  const up = sumRedeemers('up') || 10;
  const xp = Math.max(0, Math.trunc(Number(firstDefined(article && article.rewardXp, article && article.xpReward, 25) || 25)));
  const rp = 1;
  return {
    hc,
    sc,
    up,
    xp,
    rp,
    hardCurrency: hc,
    softCurrency: sc,
    upgradePoints: up,
    experiencePoints: xp,
    respectPoints: rp,
    Redeemers: clone(redeemers),
    redeemers: clone(redeemers)
  };
}

function applyCareerRewardsToProfile(profile, rewards, inventory = null) {
  if (!profile || typeof profile !== 'object') return;
  normalizeProfileResourceAliases(profile);

  const scGain = Math.max(0, Math.trunc(Number(rewards && rewards.sc || 0)));
  const hcGain = Math.max(0, Math.trunc(Number(rewards && rewards.hc || 0)));
  const xpGain = Math.max(0, Math.trunc(Number(rewards && rewards.xp || 0)));
  const rpGain = Math.max(0, Math.trunc(Number(rewards && rewards.rp || 0)));

  let level = Math.max(1, Math.trunc(Number(profile.level || profile.Level || profile.PlayerLevel || profile.Rank || 1)));
  let xp = Math.max(0, Math.trunc(Number(profile.XP || profile.xp || profile.currentXP || 0))) + xpGain;
  let nextLevelXP = Math.max(100, Math.trunc(Number(profile.nextLevelXP || profile.NextLevelXP || level * 100)));
  let prevLevelXP = Math.max(0, Math.trunc(Number(profile.prevLevelXP || profile.PrevLevelXP || (level - 1) * 100)));

  while (xp >= nextLevelXP) {
    prevLevelXP = nextLevelXP;
    level += 1;
    nextLevelXP += 100;
  }

  profile.NoCoins = Math.max(0, Math.trunc(Number(profile.NoCoins || profile.coins || 0))) + scGain;
  profile.coins = profile.NoCoins;
  profile.NoStars = Math.max(0, Math.trunc(Number(profile.NoStars || profile.gold || 0))) + hcGain;
  profile.gold = profile.NoStars;
  profile.stars = profile.NoStars;
  profile.XP = xp;
  profile.xp = xp;
  profile.currentXP = xp;
  profile.level = level;
  profile.Level = level;
  profile.PlayerLevel = level;
  profile.Rank = level;
  profile.nextLevelXP = nextLevelXP;
  profile.NextLevelXP = nextLevelXP;
  profile.prevLevelXP = prevLevelXP;
  profile.PrevLevelXP = prevLevelXP;
  profile.rp = Math.max(0, Math.trunc(Number(profile.rp || profile.respectPoints || 0))) + rpGain;
  profile.respectPoints = profile.rp;

  if (!Array.isArray(profile.levelRewards)) profile.levelRewards = [];
  if (!Array.isArray(profile.nextLevelRewards)) profile.nextLevelRewards = [];
  if (!Array.isArray(profile.prevLevelRewards)) profile.prevLevelRewards = [];

  if (inventory && typeof inventory === 'object') {
    inventory.sc = profile.NoCoins;
    inventory.hc = profile.NoStars;
    inventory.xp = xp;
    inventory.fuel = Number(profile.Fuel || profile.fuel || inventory.fuel || 0);
  }
}

function resolveCareerMatchState(userId, params, article) {
  const sparx = ensureSparxState(userId);
  const user = getUser(userId);
  const profile = sparx.dataStore && sparx.dataStore.profile ? sparx.dataStore.profile : {};
  const rootProfile = getProfile(userId);
  const inventory = sparx.dataStore && sparx.dataStore.inventory && typeof sparx.dataStore.inventory === 'object'
    ? sparx.dataStore.inventory
    : null;
  const raceId = String(params.raceId || params.id || params.ri || '').trim();
  const matchedArticle = article || getCareerArticleByRaceId(raceId);
  const resolvedRaceId = getCareerArticleClientRaceId(matchedArticle, raceId);
  const numericArticleId = String(matchedArticle && matchedArticle.id || '').trim();
  const resultCode = String(params.result || '').trim().toUpperCase();
  const won = params.won === true || params.won === 1 || resultCode === 'WON';

  if (!profile.won_races || typeof profile.won_races !== 'object') {
    profile.won_races = {};
  }
  if (!profile.lost_races || typeof profile.lost_races !== 'object') {
    profile.lost_races = {};
  }

  if (won) {
    profile.won_races[resolvedRaceId] = 1;
    delete profile.lost_races[resolvedRaceId];
    if (numericArticleId) {
      profile.won_races[numericArticleId] = 1;
      delete profile.lost_races[numericArticleId];
    }
  } else {
    profile.lost_races[resolvedRaceId] = Number(profile.lost_races[resolvedRaceId] || 0) + 1;
    if (numericArticleId) {
      profile.lost_races[numericArticleId] = Number(profile.lost_races[numericArticleId] || 0) + 1;
    }
  }

  const articleIndex = Math.max(0, getCareerArticleList().findIndex((entry) => String(entry && entry.id || '') === numericArticleId));
  const baseRewards = buildCareerRaceRewards(matchedArticle, articleIndex);
  const isChallengeRace = ['grind', 'random_grind'].includes(String(matchedArticle && matchedArticle.raceCollection || '').toLowerCase());
  const rewards = won
    ? baseRewards
    : (isChallengeRace
        ? {
            hc: Math.max(0, Math.trunc(Number(baseRewards.hc || 0) * 0.25)),
            sc: Math.max(150, Math.trunc(Number(baseRewards.sc || 0) * 0.35)),
            up: Math.max(0, Math.trunc(Number(baseRewards.up || 0) * 0.25)),
            xp: Math.max(15, Math.trunc(Number(baseRewards.xp || 0) * 0.3)),
            rp: Math.max(0, Math.trunc(Number(baseRewards.rp || 0) * 0.2)),
            hardCurrency: Math.max(0, Math.trunc(Number(baseRewards.hc || 0) * 0.25)),
            softCurrency: Math.max(150, Math.trunc(Number(baseRewards.sc || 0) * 0.35)),
            upgradePoints: Math.max(0, Math.trunc(Number(baseRewards.up || 0) * 0.25)),
            experiencePoints: Math.max(15, Math.trunc(Number(baseRewards.xp || 0) * 0.3)),
            respectPoints: Math.max(0, Math.trunc(Number(baseRewards.rp || 0) * 0.2)),
            Redeemers: [
              { type: 'res', Type: 'res', data: 'sc', Data: 'sc', n: 'sc', q: Math.max(150, Math.trunc(Number(baseRewards.sc || 0) * 0.35)), quantity: Math.max(150, Math.trunc(Number(baseRewards.sc || 0) * 0.35)), Quantity: Math.max(150, Math.trunc(Number(baseRewards.sc || 0) * 0.35)) },
              ...(Math.max(0, Math.trunc(Number(baseRewards.hc || 0) * 0.25)) > 0 ? [{ type: 'res', Type: 'res', data: 'hc', Data: 'hc', n: 'hc', q: Math.max(0, Math.trunc(Number(baseRewards.hc || 0) * 0.25)), quantity: Math.max(0, Math.trunc(Number(baseRewards.hc || 0) * 0.25)), Quantity: Math.max(0, Math.trunc(Number(baseRewards.hc || 0) * 0.25)) }] : [])
            ],
            redeemers: [
              { type: 'res', Type: 'res', data: 'sc', Data: 'sc', n: 'sc', q: Math.max(150, Math.trunc(Number(baseRewards.sc || 0) * 0.35)), quantity: Math.max(150, Math.trunc(Number(baseRewards.sc || 0) * 0.35)), Quantity: Math.max(150, Math.trunc(Number(baseRewards.sc || 0) * 0.35)) },
              ...(Math.max(0, Math.trunc(Number(baseRewards.hc || 0) * 0.25)) > 0 ? [{ type: 'res', Type: 'res', data: 'hc', Data: 'hc', n: 'hc', q: Math.max(0, Math.trunc(Number(baseRewards.hc || 0) * 0.25)), quantity: Math.max(0, Math.trunc(Number(baseRewards.hc || 0) * 0.25)), Quantity: Math.max(0, Math.trunc(Number(baseRewards.hc || 0) * 0.25)) }] : [])
            ]
          }
        : {
            hc: 0,
            sc: 0,
            up: 0,
            xp: 0,
            rp: 0,
            hardCurrency: 0,
            softCurrency: 0,
            upgradePoints: 0,
            experiencePoints: 0,
            respectPoints: 0,
            Redeemers: [],
            redeemers: []
          });
  if (won || isChallengeRace) {
    applyCareerRewardsToProfile(profile, rewards, inventory);
  } else {
    normalizeProfileResourceAliases(profile);
  }

  const nextArticle = won ? getNextCareerArticle(profile, resolvedRaceId) : (matchedArticle || getNextCareerArticle(profile, resolvedRaceId));
  const nextRaceId = nextArticle ? getCareerArticleClientRaceId(nextArticle, String(nextArticle.id || '')) : '';
  const activeChapterId = String(firstDefined(nextArticle && nextArticle.chapterId, matchedArticle && matchedArticle.chapterId, 'chapter_01') || 'chapter_01');

  profile.last_story_race = resolvedRaceId;
  profile.JustFinishedRaceId = resolvedRaceId;
  profile.justFinishedRaceId = resolvedRaceId;
  profile.just_finished_race_id = resolvedRaceId;
  if (won) {
    profile.LastWonStoryRaceID = resolvedRaceId;
    profile.lastWonStoryRaceID = resolvedRaceId;
    profile.lastWonStoryRaceId = resolvedRaceId;
  }
  profile.crid = nextRaceId;
  profile.jfrid = nextRaceId;
  profile.cmid = activeChapterId;
  profile.CurrentRaceId = nextRaceId;
  profile.currentRaceId = nextRaceId;
  profile.current_race_id = nextRaceId;
  profile.LastPlayedCareerArticleId = Number(firstDefined(nextArticle && nextArticle.id, numericArticleId, raceId, 0) || 0);
  profile.tut_id = Math.max(Number(profile.tut_id || 0), getCompletedTutorialStepValue());
  if (user && typeof user === 'object') {
    user.currentArticleId = Number(firstDefined(nextArticle && nextArticle.id, numericArticleId, raceId, 0) || 0) || user.currentArticleId;
  }

  if (rootProfile && typeof rootProfile === 'object') {
    rootProfile.won_races = clone(profile.won_races || {});
    rootProfile.lost_races = clone(profile.lost_races || {});
    rootProfile.last_story_race = String(profile.last_story_race || '');
    rootProfile.JustFinishedRaceId = String(profile.JustFinishedRaceId || '');
    rootProfile.justFinishedRaceId = String(profile.justFinishedRaceId || '');
    rootProfile.just_finished_race_id = String(profile.just_finished_race_id || '');
    rootProfile.LastWonStoryRaceID = String(profile.LastWonStoryRaceID || '');
    rootProfile.lastWonStoryRaceID = String(profile.lastWonStoryRaceID || '');
    rootProfile.lastWonStoryRaceId = String(profile.lastWonStoryRaceId || '');
    rootProfile.crid = String(profile.crid || '');
    rootProfile.jfrid = String(profile.jfrid || '');
    rootProfile.cmid = String(profile.cmid || '');
    rootProfile.CurrentRaceId = String(profile.CurrentRaceId || '');
    rootProfile.currentRaceId = String(profile.currentRaceId || '');
    rootProfile.current_race_id = String(profile.current_race_id || '');
    rootProfile.LastPlayedCareerArticleId = Number(profile.LastPlayedCareerArticleId || 0);
    rootProfile.tut_id = Number(profile.tut_id || 0);
    if (won || isChallengeRace) {
      applyCareerRewardsToProfile(rootProfile, rewards, null);
    } else {
      normalizeProfileResourceAliases(rootProfile);
    }
  }

  persistState();
  const compactProgressData = buildCompactResolveRaceProgressData(
    userId,
    String(firstDefined(nextRaceId, resolvedRaceId, profile.currentRaceId, profile.CurrentRaceId, '') || '')
  );

  return {
    raceId: resolvedRaceId,
    result: resultCode || (won ? 'WON' : 'LOST'),
    nextBranchId: '',
    nextRaceId,
    raceRewards: clone(rewards),
    carCond: null,
    progression: {
      crid: String(profile.crid || ''),
      jfrid: String(profile.jfrid || ''),
      cmid: String(profile.cmid || ''),
      tut_id: Number(profile.tut_id || 0),
      currentRaceId: String(profile.currentRaceId || ''),
      CurrentRaceId: String(profile.CurrentRaceId || ''),
      last_story_race: String(profile.last_story_race || '')
    },
    profile: {
      level: Number(profile.level || profile.Level || 1),
      xp: Number(profile.xp || profile.XP || 0),
      coins: Number(profile.NoCoins || profile.coins || 0),
      stars: Number(profile.NoStars || profile.gold || 0),
      fuel: Number(profile.Fuel || profile.fuel || 0),
      crid: String(profile.crid || ''),
      jfrid: String(profile.jfrid || ''),
      cmid: String(profile.cmid || ''),
      tut_id: Number(profile.tut_id || 0),
      currentRaceId: String(profile.currentRaceId || ''),
      CurrentRaceId: String(profile.CurrentRaceId || ''),
      last_story_race: String(profile.last_story_race || ''),
      JustFinishedRaceId: String(profile.JustFinishedRaceId || ''),
      LastWonStoryRaceID: String(profile.LastWonStoryRaceID || '')
    },
    inventory: buildFlatInventoryResult(userId),
    wallet: buildWalletResult(userId),
    resources: buildResourceResult(userId),
    gamestats: buildGameStatsPayload(userId),
    levelrewards: buildLevelRewardsStatusMap(userId),
    chapterData: compactProgressData.chapterData,
    raceData: compactProgressData.raceData
  };
}

function buildMotdStatus() {
  return {
    count: 1,
    url: `${getPublicHttpBaseUrl()}/motd`,
    templates: [
      {
        name: 'ff7_local',
        title: 'Welcome Back',
        calltoaction: 'Tap to continue',
        actionbutton: 'Continue',
        cdn: getPublicHttpBaseUrl(),
        actionimage: 'start.png',
        actioncolour: 'Color.green',
        params: {}
      }
    ]
  };
}

function buildWskeCertificateResult(userId) {
  const user = getUser(userId);

  if (!user.wske || typeof user.wske !== 'object') {
    user.wske = {};
  }

  if (!user.wske.playerId) {
    user.wske.playerId = String(userId || 'default');
  }

  if (!user.wske.playerCertificate) {
    user.wske.playerCertificate = `cert_${String(user.wske.playerId)}`;
  }

  persistState();

  return {
    playerId: String(user.wske.playerId),
    playerCertificate: String(user.wske.playerCertificate)
  };
}

function buildLoginRewards(userId) {
  return clone(ensureSparxState(userId).loginRewards);
}

function buildEventsPayload() {
  return {
    events: [
      {
        _id: 'rw_event_2026_v4',
        name: 'Race Wars Event 2026',
        eventtype: 'fast_trials',
        state: 'Running',
        start: nowTs() - 3600,
        end: nowTs() + 86400 * 7,
        final: nowTs() + 86400 * 7 + 3600,
        messaging: {
          name: 'Race Wars Live',
          long: 'Beat rivals and climb the leaderboard.'
        }
      }
    ],
    leaderboard: []
  };
}

function getOwnedVehicleAssetTags(profile) {
  const ownedVehicles = Array.isArray(profile && profile.OwnedVehicles) ? profile.OwnedVehicles : [];
  return ownedVehicles
    .map((tag) => getAssetVehicleTag(tag, tag))
    .filter(Boolean);
}

function isSupportedShipyardVehicleTag(candidate) {
  const rawTag = String(candidate || '').trim();
  if (!rawTag) {
    return false;
  }
  const assetTag = String(vehicleAssetAliases[rawTag] || rawTag);
  if (/_ff6\b/i.test(rawTag) || /_ff6\b/i.test(assetTag)) {
    return false;
  }
  return Boolean(
    defaultVehicleDescriptions[rawTag] ||
    defaultVehicleDescriptions[assetTag] ||
    vehicleMetaTemplates[rawTag] ||
    vehicleMetaTemplates[assetTag]
  );
}

function pickShipyardRewardVehicleTag(userId, boxDefinition) {
  const profile = getProfile(userId);
  const ownedAssetTags = new Set(getOwnedVehicleAssetTags(profile));
  const candidates = Array.isArray(boxDefinition && boxDefinition.candidates) ? boxDefinition.candidates : [];
  const supportedCandidates = candidates.filter((candidate) => isSupportedShipyardVehicleTag(candidate));
  const pool = supportedCandidates.length > 0 ? supportedCandidates : candidates;
  // Prefer unowned cars — skip candidates the user already has
  const unowned = pool.filter((candidate) => {
    const tag = String(vehicleAssetAliases[candidate] || candidate);
    return !ownedAssetTags.has(candidate) && !ownedAssetTags.has(tag);
  });
  const finalPool = unowned.length > 0 ? unowned : pool;
  return String(finalPool[0] || candidates[0] || 'subaru_brz_2013');
}

function buildShipyardRewardEntry(vehicleTag) {
  const assetTag = getAssetVehicleTag(vehicleTag, vehicleTag);
  const carMeta = buildCarMetaPayload(vehicleTag);
  const displayName = String(carMeta.Name || carMeta.name || assetTag).trim() || assetTag;
  const thumbnailPath = String(firstDefined(carMeta && carMeta.tbp, carMeta && carMeta.image, '') || '').trim();
  return {
    type: 'car',
    Type: 'car',
    // RedeemerItem.Data = Dot.String("data") → FeaturedPrizeDisplay splits by comma, takes [0] as
    // car name → CarDB.AddCarNamePrefix → "car_attribute_"+assetTag → thumbnailBasePath.
    // Without data field, Data="" → blank white image in the box info popup.
    data: assetTag,
    n: assetTag,
    id: assetTag,
    Id: assetTag,
    tag: assetTag,
    Tag: assetTag,
    vehicleTag: assetTag,
    VehicleTag: assetTag,
    carId: assetTag,
    CarId: assetTag,
    car: assetTag,
    car_id: assetTag,
    label: displayName,
    Label: displayName,
    name: displayName,
    Name: displayName,
    tbp: thumbnailPath,
    image: thumbnailPath,
    Image: thumbnailPath,
    thumbnail: thumbnailPath,
    Thumbnail: thumbnailPath,
    quantity: 1,
    Quantity: 1,
    count: 1,
    Count: 1
  };
}

function buildShipyardFeaturedRewards(userId, boxDefinition) {
  const kind = String(firstDefined(boxDefinition && boxDefinition.kind, 'car') || 'car').toLowerCase();
  if (kind === 'parts') {
    return [];
  }
  const candidates = Array.isArray(boxDefinition && boxDefinition.candidates)
    ? boxDefinition.candidates.filter((candidate) => isSupportedShipyardVehicleTag(candidate))
    : [];
  const preferred = [];
  const featuredTag = String(firstDefined(boxDefinition && boxDefinition.featuredTag, '') || '').trim();
  if (featuredTag && isSupportedShipyardVehicleTag(featuredTag)) {
    preferred.push(featuredTag);
  }
  candidates.forEach((candidate) => {
    if (preferred.indexOf(candidate) === -1) {
      preferred.push(candidate);
    }
  });
  const selected = preferred.slice(0, 4);
  if (selected.length === 0 && kind === 'daily') {
    return [];
  }
  return selected.map((tag) => buildShipyardRewardEntry(tag));
}

function buildShipyardDisplayRewards(userId, boxDefinition) {
  const kind = String(firstDefined(boxDefinition && boxDefinition.kind, 'car') || 'car').toLowerCase();
  const displayMode = String(firstDefined(boxDefinition && boxDefinition.displayMode, kind === 'parts' ? 'crate' : 'car') || 'car').toLowerCase();
  if (kind === 'car') {
    const featuredRewards = buildShipyardFeaturedRewards(userId, boxDefinition);
    return {
      // Gacha.Util.ContainsCar(box) only inspects PossiblePrizes. If we return only
      // keycards here, the client treats car crates like extras crates and never
      // enables the rotating featured-car display.
      possiblePrizes: clone(featuredRewards),
      featured: clone(featuredRewards)
    };
  }
  if (displayMode === 'mystery') {
    return {
      possiblePrizes: [buildInventoryRedeemerItem('daily_prize_reward', 1, 'DAILY PRIZE')],
      featured: []
    };
  }
  if (kind === 'parts') {
    return {
      possiblePrizes: clone(buildShipyardPartRewards(boxDefinition)),
      featured: []
    };
  }
  return {
    possiblePrizes: [buildInventoryRedeemerItem('shipyard_keycard', 1, 'KEYCARD')],
    featured: []
  };
}

function buildGachaPickRewardItem(vehicleTag) {
  const assetTag = getAssetVehicleTag(vehicleTag, vehicleTag);
  const carMeta = buildCarMetaPayload(vehicleTag);
  const displayName = String(carMeta.Name || carMeta.name || assetTag).trim() || assetTag;
  const recordId = arguments.length > 1 && arguments[1] && typeof arguments[1] === 'object'
    ? String(firstDefined(arguments[1]._id, arguments[1].id, assetTag) || assetTag)
    : assetTag;
  const sourceData = {
    ids: [recordId],
    name: assetTag,
    tag: assetTag,
    label: displayName,
    displayName,
    carId: recordId
  };
  return {
    type: 'car',
    Type: 'car',
    data: sourceData,
    Data: clone(sourceData),
    n: assetTag,
    name: assetTag,
    Name: assetTag,
    id: recordId,
    Id: recordId,
    tag: assetTag,
    Tag: assetTag,
    vehicleTag: assetTag,
    VehicleTag: assetTag,
    carId: recordId,
    CarId: recordId,
    label: displayName,
    Label: displayName,
    quantity: 1,
    Quantity: 1,
    q: 1
  };
}

function buildInventoryRedeemerItem(itemId, quantity = 1, label = '') {
  const data = String(itemId || '').trim();
  const qty = Math.max(1, Math.trunc(Number(quantity || 1)));
  return {
    type: 'inv',
    Type: 'inv',
    data,
    Data: data,
    n: data,
    name: String(label || data),
    Name: String(label || data),
    quantity: qty,
    Quantity: qty,
    q: qty
  };
}

function buildResourceRedeemerItem(resourceId, quantity = 1) {
  const data = String(resourceId || '').trim();
  const qty = Math.max(1, Math.trunc(Number(quantity || 1)));
  return {
    type: 'res',
    Type: 'res',
    data,
    Data: data,
    n: data,
    quantity: qty,
    Quantity: qty,
    q: qty
  };
}

function buildShipyardPartRewards(boxDefinition) {
  const rewardPool = [
    '1_engine_01',
    '1_tires_01',
    '1_brakes_01',
    '2_engine_01',
    '2_tires_01',
    '2_brakes_01',
    '3_engine_01',
    '3_body_01',
    '3_nitrous_01',
    '4_engine_01',
    '4_body_01',
    '4_turbo_01',
    '5_engine_01',
    '5_body_01',
    '6_engine_01'
  ];
  const items = [];
  const guaranteedPart = String(firstDefined(boxDefinition && boxDefinition.guaranteedPart, boxDefinition && boxDefinition.featuredPart, '3_engine_01'));
  items.push(buildInventoryRedeemerItem(guaranteedPart, 1, guaranteedPart));
  const totalCount = Math.max(1, Math.trunc(Number(firstDefined(boxDefinition && boxDefinition.partCount, 1) || 1)));
  for (let index = 1; index < totalCount; index += 1) {
    const rewardId = rewardPool[index % rewardPool.length];
    items.push(buildInventoryRedeemerItem(rewardId, 1, rewardId));
  }
  return items;
}

function buildShipyardBoxRewards(userId, boxDefinition) {
  const kind = String(firstDefined(boxDefinition && boxDefinition.kind, 'car') || 'car').toLowerCase();
  if (kind === 'parts') {
    return {
      itemType: 'parts',
      items: buildShipyardPartRewards(boxDefinition),
      async: []
    };
  }
  if (kind === 'daily') {
    const giveGold = nowTs() % 2 === 0;
    if (giveGold) {
      return {
        itemType: 'resource',
        items: [buildResourceRedeemerItem('hc', Math.max(1, Math.trunc(Number(boxDefinition && boxDefinition.goldReward || 25))))],
        async: []
      };
    }
  }
  const rewardVehicleTag = pickShipyardRewardVehicleTag(userId, boxDefinition);
  return {
    itemType: 'car',
    vehicleTag: rewardVehicleTag,
    items: [buildGachaPickRewardItem(rewardVehicleTag)],
    async: []
  };
}

function buildShipyardPrizeRecord(boxId, reward) {
  const prizeId = `shipyard:${boxId}:${nowTs()}`;
  return {
    id: prizeId,
    Id: prizeId,
    boxId: boxId,
    BoxId: boxId,
    BoxID: boxId,
    claimed: false,
    Claimed: false,
    newlyClaimed: true,
    NewlyClaimed: true,
    received: nowTs(),
    Received: nowTs(),
    claimUrl: '/prizes/claimbox/',
    ClaimUrl: '/prizes/claimbox/',
    prizes: [clone(reward)],
    Prizes: [clone(reward)],
    rewards: [clone(reward)],
    Rewards: [clone(reward)]
  };
}

function repairVehicleStatus(status) {
  if (!status || typeof status !== 'object') {
    return;
  }
  status.BodyworkHealth = 1;
  status.EngineHealth = 1;
  status.OilHealth = 1;
  status.TyreHealth = [1, 1, 1, 1];
  status.BrakeHealth = [1, 1, 1, 1];
}

function grantShipyardVehicle(userId, vehicleTag, options = {}) {
  const user = getUser(userId);
  const sparx = ensureSparxState(userId);
  const rootProfile = getProfile(userId);
  const assetTag = getAssetVehicleTag(vehicleTag, vehicleTag);
  const ownerUid = getProfileUidValue(rootProfile, userId);
  const carsRoot = sparx.dataStore.cars && typeof sparx.dataStore.cars === 'object'
    ? sparx.dataStore.cars
    : {};
  if (!carsRoot[ownerUid] || typeof carsRoot[ownerUid] !== 'object') {
    carsRoot[ownerUid] = {};
  }
  const ownerBucket = carsRoot[ownerUid];
  const shouldSetCurrent =
    Boolean(options.setCurrent) ||
    !String(rootProfile.CurrentVehicleTag || '').trim() ||
    !Array.isArray(rootProfile.OwnedVehicles) ||
    rootProfile.OwnedVehicles.length === 0;

  [rootProfile, sparx.dataStore.profile].forEach((profile) => {
    if (!profile || typeof profile !== 'object') return;
    if (!Array.isArray(profile.OwnedVehicles)) profile.OwnedVehicles = [];
    if (profile.OwnedVehicles.indexOf(assetTag) === -1) {
      profile.OwnedVehicles.push(assetTag);
    }
    if (!profile.OwnedVehiclesStatus || typeof profile.OwnedVehiclesStatus !== 'object') {
      profile.OwnedVehiclesStatus = {};
    }
    profile.OwnedVehiclesStatus[assetTag] = createStockOwnedVehicleStatus(assetTag);
    if (shouldSetCurrent) {
      profile.CurrentVehicleTag = assetTag;
      profile.currentVehicleTag = assetTag;
    }
  });

  const stockRecord = buildStockRewardCarRecord(
    assetTag,
    ownerUid,
    Object.keys(ownerBucket).length,
    null
  );
  ownerBucket[String(stockRecord._id)] = clone(stockRecord);
  sparx.dataStore.cars = carsRoot;

  if (shouldSetCurrent) {
    sparx.dataStore.profile.active_carid = String(stockRecord._id || '');
    sparx.dataStore.profile.activeCarId = String(stockRecord._id || '');
    sparx.dataStore.profile.lastRequestedCarId = String(stockRecord._id || '');
    sparx.dataStore.profile.LastRequestedCarId = String(stockRecord._id || '');
    sparx.dataStore.profile.active_recipe = Number(stockRecord.r && stockRecord.r.hash || 0);
    rootProfile.lastRequestedCarId = String(stockRecord._id || '');
    rootProfile.LastRequestedCarId = String(stockRecord._id || '');
  }

  persistState();
  return clone(stockRecord);
}

function buildShipyardCatalog(userId) {
  const user = getUser(userId);
  const sparx = ensureSparxState(userId);
  const tokenBalance = typeof user.carTokenBalance === 'number' ? user.carTokenBalance : 12000;
  const prizes = Array.isArray(sparx.prizes) ? sparx.prizes.slice() : [];
  const unclaimedBoxes = prizes.filter((entry) => entry && entry.claimed === false);
  const spendInfo = (cost, sale = 0, xp = 0) => ({
    cost: Math.max(0, Math.trunc(Number(cost || 0))),
    sale: Math.max(0, Math.trunc(Number(sale || 0))),
    xp: Math.max(0, Math.trunc(Number(xp || 0)))
  });
  const baseBoxes = SHIPYARD_BOX_DEFINITIONS.map((definition, index) => {
    const kind = String(firstDefined(definition && definition.kind, 'car') || 'car').toLowerCase();
    const displayMode = String(firstDefined(definition && definition.displayMode, kind === 'parts' ? 'crate' : 'car') || 'car').toLowerCase();
    const displayRewards = buildShipyardDisplayRewards(userId, definition);
    const possiblePrizeEntries = clone(displayRewards.possiblePrizes || []);
    const featuredRewards = clone(displayRewards.featured || []);
    const freeTime = Number(firstDefined(definition && definition.freeTime, -1) || -1);
    const imgPaths = getShipyardBoxImagePaths(definition, displayMode, kind);
    const presentationSequence = kind === 'car' || kind === 'daily'
      ? 'Prefab_Sequences/sequence_tutorial_gacha_0'
      : 'Prefab_Sequences/sequence_tutorial_gacha_1';
    const featuredPrizeEntry = clone(
      (featuredRewards || [])[0] ||
      (possiblePrizeEntries || [])[0] ||
      null
    );
    const softCost = String(firstDefined(definition && definition.currency, 'hc')).toLowerCase() === 'sc'
      ? spendInfo(definition.cost, 0, 0)
      : spendInfo(0, 0, 0);
    const hardCost = String(firstDefined(definition && definition.currency, 'hc')).toLowerCase() === 'hc'
      ? spendInfo(definition.cost, 0, 0)
      : spendInfo(0, 0, 0);
    return {
      // GachaBox abbreviated keys (what the client actually reads)
      name: definition.name,           // Dot.Loc("name") → GachaBox.Name (required for IsValid)
      displayname: definition.name,    // Dot.Loc("displayname") → GachaBox.DisplayName
      group: SHIPYARD_GROUP_ID,        // Dot.String("group")
      set: SHIPYARD_SET_ID,            // Dot.String("set") → PickSet
      version: '1',                    // Dot.String("version")
      desc: String(definition.desc || ''), // Dot.Loc("desc") → GachaBox.Description
      token: String(firstDefined(definition && definition.token, SHIPYARD_GACHA_TOKEN)),
      vinb: true,                      // Dot.Bool("vinb") → VisibleIfCantBuy
      free: freeTime,                  // Dot.Integer("free") → FreeTime
      end: -1,                         // Dot.Integer("end") → EndTime
      sort: index,                     // Dot.Integer("sort") → SortKey
      multiplier: 1,                   // Dot.Integer("multiplier")
      multtxt: '',                     // Dot.String("multtxt")
      banner: String(firstDefined(definition && definition.banner, '') || ''),
      sc: softCost,
      hc: hardCost,
      cost: Number(firstDefined(definition && definition.cost, 0) || 0),
      Cost: Number(firstDefined(definition && definition.cost, 0) || 0),
      tokenc: spendInfo(0, 0, 0),
      possiblePrizes: clone(possiblePrizeEntries),
      featured: clone(featuredRewards),
      featuredPrize: clone(featuredPrizeEntry),
      FeaturedPrize: clone(featuredPrizeEntry),
      bg: imgPaths.bg,                 // Dot.Loc("bg") → BackgroundImage
      openimg: imgPaths.open,          // Dot.Loc("openimg") → OpenImage
      closedimg: imgPaths.closed,      // Dot.Loc("closedimg") → ClosedImage
      image: imgPaths.closed,
      Image: imgPaths.closed,
      icon: imgPaths.closed,
      Icon: imgPaths.closed,
      thumbnail: imgPaths.closed,
      Thumbnail: imgPaths.closed,
      bgs3: false,
      opens3: false,
      closeds3: false,
      tokenimgs3: false,
      tokenimg: '',
      warningtime: -1,
      criticaltime: -1,
      caren: displayMode === 'car',
      carcount: displayMode === 'car' ? 1 : 0,
      carfratio: displayMode === 'car' ? 1 : 0,
      carfchance: displayMode === 'car' ? 1 : 0,
      pseq: presentationSequence,
      PresentationSequence: presentationSequence,
      presentationSequence,
      minitems: 1,
      maxitems: 1,
      // camelCase mirrors for other consumers
      Group: SHIPYARD_GROUP_ID,
      Set: SHIPYARD_SET_ID,
      Box: definition.id,
      box: definition.id,
      DisplayName: definition.name,
      displayName: definition.name,
      Version: '1',
      Token: String(firstDefined(definition && definition.token, SHIPYARD_GACHA_TOKEN)),
      Cost: definition.cost,
      cost: definition.cost,
      SoftCurrentToPay: tokenBalance,
      softCurrentToPay: tokenBalance,
      Spins: 1,
      spins: 1,
      FreeTime: freeTime,
      freeTime: freeTime,
      PossiblePrizes: clone(possiblePrizeEntries),
      Featured: clone(featuredRewards),
      Items: clone(possiblePrizeEntries),
      items: clone(possiblePrizeEntries)
    };
  });

  function cloneBoxesForGroup(groupId) {
    return baseBoxes.map((box) => ({
      ...clone(box),
      group: groupId,
      set: groupId,
      Group: groupId,
      Set: groupId
    }));
  }

  function buildShipyardSet(groupId, index) {
    const boxes = cloneBoxesForGroup(groupId);
    return {
      Set: groupId,
      set: groupId,
      Group: groupId,
      group: groupId,
      Version: '1',
      version: '1',
      Name: 'THE SHIPYARD',
      name: 'THE SHIPYARD',
      Attracts: [],
      attracts: [],
      Index: index,
      index: index,
      SortKey: index,
      sortKey: index,
      possiblePrizes: boxes.flatMap((box) => clone(box.possiblePrizes || [])),
      PossiblePrizes: boxes.flatMap((box) => clone(box.PossiblePrizes || [])),
      Boxes: clone(boxes),
      boxes: clone(boxes)
    };
  }

  const sets = SHIPYARD_GROUP_ALIASES.map((groupId, index) => buildShipyardSet(groupId, index));
  const groups = sets.map((setEntry, index) => ({
    Group: String(setEntry && setEntry.group || SHIPYARD_GROUP_ID),
    group: String(setEntry && setEntry.group || SHIPYARD_GROUP_ID),
    DisplayName: 'THE SHIPYARD',
    displayName: 'THE SHIPYARD',
    Set: clone(setEntry),
    set: clone(setEntry),
    Boxes: clone((setEntry && (setEntry.Boxes || setEntry.boxes)) || []),
    boxes: clone((setEntry && (setEntry.boxes || setEntry.Boxes)) || []),
    AttractImages: [],
    attractImages: [],
    MaxCombinedSpins: 1,
    maxCombinedSpins: 1,
    Index: index,
    index
  }));

  const boxes = clone((sets[0] && (sets[0].boxes || sets[0].Boxes)) || []);

  const tokens = SHIPYARD_BOX_DEFINITIONS.map((definition) => ({
    token: String(firstDefined(definition && definition.token, SHIPYARD_GACHA_TOKEN)),
    count: getInventoryItemCount(userId, String(firstDefined(definition && definition.token, SHIPYARD_GACHA_TOKEN)))
  }));

  const freeTimes = boxes.reduce((acc, box) => {
    acc[box.Box] = Number(box.FreeTime || 0);
    return acc;
  }, {});

  return {
    boxes,
    groups,
    sets,
    tokens,
    freeTimes,
    unclaimedBoxes
  };
}

function buildGachaRefreshSignature(userId) {
  const catalog = buildShipyardCatalog(userId);
  const summary = {
    layoutVersion: 'shipyard-v2',
    tokens: (catalog.tokens || []).map((entry) => ({
      token: String(entry && entry.token || ''),
      count: Number(entry && entry.count || 0)
    })),
    boxes: (catalog.boxes || []).map((entry) => ({
      box: String(entry && (entry.box || entry.Box) || ''),
      name: String(entry && (entry.displayname || entry.displayName || entry.name || entry.Name) || ''),
      cost: Number(entry && (entry.cost || entry.Cost) || 0),
      free: Number(entry && (entry.free || entry.FreeTime) || 0),
      banner: String(entry && entry.banner || ''),
      bg: String(entry && (entry.bg || entry.BackgroundImage) || ''),
      closedimg: String(entry && (entry.closedimg || entry.closedImage) || ''),
      openimg: String(entry && (entry.openimg || entry.openImage) || ''),
      featured: String(
        firstDefined(
          entry && entry.featured && entry.featured[0] && (entry.featured[0].vehicleTag || entry.featured[0].id),
          entry && entry.featuredPrize && (entry.featuredPrize.vehicleTag || entry.featuredPrize.id),
          entry && entry.FeaturedPrize && (entry.FeaturedPrize.vehicleTag || entry.FeaturedPrize.id),
          ''
        ) || ''
      )
    })),
    prizes: Number((catalog.unclaimedBoxes || []).length || 0)
  };
  return `local-gacha-${crypto.createHash('md5').update(JSON.stringify(summary)).digest('hex')}`;
}

function claimShipyardBox(userId, params = {}) {
  const sparx = ensureSparxState(userId);
  const requestedBoxRaw = String(params.box || params.Box || params.boxId || params.BoxId || 'amateur_crate').trim() || 'amateur_crate';
  // Client sends box NAME (e.g. "SILVER CONTAINER") not ID — match by id OR name (case-insensitive)
  const boxDefinition = SHIPYARD_BOX_DEFINITIONS.find(
    (entry) => entry.id === requestedBoxRaw || String(entry.token || '').toLowerCase() === requestedBoxRaw.toLowerCase() || entry.name.toLowerCase() === requestedBoxRaw.toLowerCase()
  ) || SHIPYARD_BOX_DEFINITIONS[0];
  const tokenId = String(firstDefined(boxDefinition && boxDefinition.token, SHIPYARD_GACHA_TOKEN));
  if (!spendInventoryItemCount(userId, tokenId, 1)) {
    return {
      success: false,
      successful: false,
      sucessful: false,
      error: 'missing_token',
      localizedError: 'missing_token',
      items: [],
      Items: [],
      async: [],
      Async: [],
      inventory: buildFlatInventoryResult(userId),
      wallet: buildWalletResult(userId),
      resources: buildResourceResult(userId)
    };
  }
  const rewardBundle = buildShipyardBoxRewards(userId, boxDefinition);
  let reward = clone((rewardBundle.items || [])[0] || buildShipyardRewardEntry('subaru_brz_2013'));
  let itemEntries = clone(rewardBundle.items || []);
  const shouldPersistPrize = params && (params.persistPrize != null || params.persist_prize != null)
    ? Boolean(params.persistPrize || params.persist_prize)
    : false;
  const activeTutorialBranchId = normalizeTutorialBranchId(
    firstDefined(
      sparx && sparx.tutorial && sparx.tutorial.activeTutorial && sparx.tutorial.activeTutorial.bid,
      sparx && sparx.tutorial && sparx.tutorial.currentTutorialGroupId,
      ''
    ),
    ''
  );
  // Use boxDefinition.id (resolved), NOT requestedBoxId — client sends "Letty's Gift" (the name),
  // which resolves to bronze_container. requestedBoxId === 'bronze_container' would be false.
  const setRewardAsCurrent = false;

  let grantedRecord = null;
  let asyncMessages = [];
  if (rewardBundle.itemType === 'car' && rewardBundle.vehicleTag) {
    const assetTag = getAssetVehicleTag(rewardBundle.vehicleTag, rewardBundle.vehicleTag);
    grantedRecord = grantShipyardVehicle(userId, assetTag, { setCurrent: setRewardAsCurrent });
    reward = buildShipyardRewardEntry(assetTag);
    itemEntries = [buildGachaPickRewardItem(assetTag, grantedRecord)];
    asyncMessages = grantedRecord
      ? [{ component: 'OwnedCarsManager', message: 'add', payload: clone(grantedRecord) }]
      : [];
  } else if (rewardBundle.itemType === 'parts') {
    applyRedeemersToInventory(userId, rewardBundle.items || []);
  } else if (rewardBundle.itemType === 'resource') {
    const goldAmount = Math.max(0, Math.trunc(Number(firstDefined((rewardBundle.items || [])[0] && ((rewardBundle.items || [])[0].q || (rewardBundle.items || [])[0].quantity), 0) || 0)));
    const profile = getProfile(userId);
    const stars = Math.max(0, Math.trunc(Number(profile.Stars || profile.stars || 0))) + goldAmount;
    profile.Stars = stars;
    profile.stars = stars;
    ensureSparxState(userId).dataStore.profile.stars = stars;
    ensureSparxState(userId).dataStore.profile.Stars = stars;
  }
  let persistedPrizePayload = null;
  if (shouldPersistPrize) {
    const prize = buildShipyardPrizeRecord(boxDefinition.id, reward);
    if (!Array.isArray(sparx.prizes)) {
      sparx.prizes = [];
    }
    sparx.prizes.unshift(clone(prize));
    persistedPrizePayload = buildPrizesPayload(userId);
  }
  const response = {
    softToPay: 0,
    xpToGive: 0,
    spins: 1,
    items: clone(itemEntries),
    Items: clone(itemEntries),
    async: clone(asyncMessages),
    Async: clone(asyncMessages),
    inventory: buildFlatInventoryResult(userId),
    wallet: buildWalletResult(userId),
    resources: buildResourceResult(userId),
    token: tokenId,
    Token: tokenId,
    count: getInventoryItemCount(userId, tokenId),
    Count: getInventoryItemCount(userId, tokenId)
  };

  if (persistedPrizePayload) {
    response.prizes = persistedPrizePayload.prizes;
    response.Prizes = persistedPrizePayload.Prizes;
    response.unclaimedBoxes = persistedPrizePayload.unclaimedBoxes;
    response.UnclaimedBoxes = persistedPrizePayload.UnclaimedBoxes;
  }

  return response;
}

function claimShipyardFreeBox(userId, params = {}) {
  const requestedBoxRaw = String(params.box || params.Box || params.boxId || params.BoxId || 'daily_prize').trim() || 'daily_prize';
  const boxDefinition = SHIPYARD_BOX_DEFINITIONS.find(
    (entry) => entry.id === requestedBoxRaw || String(entry.token || '').toLowerCase() === requestedBoxRaw.toLowerCase() || entry.name.toLowerCase() === requestedBoxRaw.toLowerCase()
  ) || SHIPYARD_BOX_DEFINITIONS[0];
  const tokenId = String(firstDefined(boxDefinition && boxDefinition.token, SHIPYARD_GACHA_TOKEN));
  addInventoryItemCount(userId, tokenId, 1);
  persistState();
  const tokenBalance = getInventoryItemCount(userId, tokenId);
  const freeTime = Number(firstDefined(boxDefinition && boxDefinition.freeTime, -1) || -1);

  return {
    token: tokenId,
    Token: tokenId,
    count: tokenBalance,
    Count: tokenBalance,
    free: freeTime,
    Free: freeTime,
    box: boxDefinition.id,
    Box: boxDefinition.id,
    boxId: boxDefinition.id,
    BoxId: boxDefinition.id
  };
}

function buildCarSalvageRedeemers(removedRecords = []) {
  const records = Array.isArray(removedRecords) ? removedRecords.filter(Boolean) : [];
  if (records.length <= 0) {
    return [];
  }
  const rewardPool = ['engine', 'tires', 'gearbox', 'nitrous', 'body', 'swaybar'];
  const redeemers = [];
  records.forEach((record, index) => {
    const rawClassIndex = firstDefined(
      record && record.r && record.r.c,
      record && record.recipe && record.recipe.c,
      record && record.CarMetaData && record.CarMetaData.c,
      record && record.MetaData && record.MetaData.c,
      record && record.metadata && record.metadata.c,
      0
    );
    const classIndex = Math.max(1, Math.min(6, Math.trunc(Number(rawClassIndex || 0)) + 1));
    const rewardCount = 3 + (index % 3);
    for (let i = 0; i < rewardCount; i += 1) {
      const itemTag = rewardPool[(index + i) % rewardPool.length];
      const data = `${classIndex}_${itemTag}_01`;
      redeemers.push({
        type: 'inv',
        t: 'inv',
        data,
        n: data,
        quantity: 1,
        q: 1
      });
    }
  });
  return redeemers;
}

function buildPrizesPayload(userId) {
  const sparx = ensureSparxState(userId);
  const prizes = Array.isArray(sparx.prizes) ? sparx.prizes.slice() : [];
  return {
    prizes: clone(prizes),
    Prizes: clone(prizes),
    unclaimedBoxes: prizes.filter((entry) => entry && entry.claimed === false).map((entry) => clone(entry)),
    UnclaimedBoxes: prizes.filter((entry) => entry && entry.claimed === false).map((entry) => clone(entry))
  };
}

function claimPendingPrizeRecords(userId, params = {}) {
  const sparx = ensureSparxState(userId);
  const requestedPrizeId = String(
    params.id ||
    params.Id ||
    params.prizeId ||
    params.PrizeId ||
    ''
  ).trim();
  const requestedBoxId = String(params.box || params.Box || params.boxId || params.BoxId || '').trim();
  const prizes = Array.isArray(sparx.prizes) ? sparx.prizes : [];
  const claimedEntries = [];

  prizes.forEach((entry) => {
    if (!entry || entry.claimed === true) {
      return;
    }
    const prizeId = String(entry.id || entry.Id || '').trim();
    const boxId = String(entry.boxId || entry.BoxId || entry.BoxID || '').trim();
    const shouldClaim =
      (!requestedPrizeId && !requestedBoxId) ||
      (requestedPrizeId && prizeId === requestedPrizeId) ||
      (requestedBoxId && boxId === requestedBoxId);
    if (shouldClaim) {
      entry.claimed = true;
      entry.Claimed = true;
      claimedEntries.push(entry);
    }
  });

  const asyncMessages = [];
  claimedEntries.forEach((entry) => {
    const reward = ((entry.prizes || entry.Prizes || [])[0]) || null;
    const assetTag = getAssetVehicleTag(firstDefined(
      reward && (reward.vehicleTag || reward.tag || reward.id || reward.data),
      ''
    ), '');
    if (!assetTag) {
      return;
    }
    const setCurrent = assetTag === 'subaru_brz_2013';
    grantShipyardVehicle(userId, assetTag, { setCurrent });
    const sparxState = ensureSparxState(userId);
    const carsRoot = sparxState.dataStore.cars || {};
    const allCarRecords = Object.values(carsRoot).reduce((acc, bucket) => {
      if (bucket && typeof bucket === 'object') {
        Object.values(bucket).forEach((record) => {
          if (record && typeof record === 'object') {
            acc.push(record);
          }
        });
      }
      return acc;
    }, []);
    const newCarRecord = allCarRecords.find((record) =>
      record && String(record.carId || record.car || (record.r && record.r.n) || '') === assetTag
    );
    if (newCarRecord) {
      asyncMessages.push({ component: 'OwnedCarsManager', message: 'add', payload: clone(newCarRecord) });
    }
  });

  persistState();
  const updatedPrizes = buildPrizesPayload(userId);
  return {
    claimed: claimedEntries.length > 0,
    prizes: updatedPrizes.prizes,
    Prizes: updatedPrizes.Prizes,
    unclaimedBoxes: updatedPrizes.unclaimedBoxes,
    UnclaimedBoxes: updatedPrizes.UnclaimedBoxes,
    async: asyncMessages,
    Async: clone(asyncMessages)
  };
}

function buildLevelRewardsStatusMap(userId) {
  const profile = getProfile(userId);
  const level = getNormalizedProfileLevel(profile);
  const nextLevelXP = Number(profile.nextLevelXP || profile.NextLevelXP || Math.max(100, level * 100));
  const prevLevelXP = Number(
    profile.prevLevelXP ||
    profile.PrevLevelXP ||
    (level > 1 ? Math.max(0, nextLevelXP - 100) : 0)
  );

  return {
    xp: {
      last_awarded_level: Math.max(0, Math.trunc(level)),
      nextLevelXp: Math.max(0, Math.trunc(nextLevelXP)),
      prevLevelXp: Math.max(0, Math.min(Math.trunc(prevLevelXP), Math.trunc(nextLevelXP)))
    }
  };
}

function buildLevelRewardsSummary(userId) {
  const profile = getProfile(userId);
  const levelrewards = buildLevelRewardsStatusMap(userId);
  const xp = getNormalizedProfileXp(profile);
  const respectPoints = Number(profile.respectPoints || profile.rp || 0);
  const levelRewards = Array.isArray(profile.levelRewards) ? clone(profile.levelRewards) : [];
  const nextLevelRewards = Array.isArray(profile.nextLevelRewards) ? clone(profile.nextLevelRewards) : [];
  const prevLevelRewards = Array.isArray(profile.prevLevelRewards) ? clone(profile.prevLevelRewards) : [];
  const xpStatus = levelrewards.xp || { last_awarded_level: 0, nextLevelXp: 1000, prevLevelXp: 0 };

  return {
    level: Number(xpStatus.last_awarded_level || 0),
    currentXP: xp,
    xp,
    XP: xp,
    nextLevelXP: Number(xpStatus.nextLevelXp || 0),
    respectPoints,
    rp: respectPoints,
    levelRewards,
    nextLevelRewards,
    prevLevelRewards,
    rewards: levelRewards,
    nextRewards: nextLevelRewards,
    prevRewards: prevLevelRewards,
    levelrewards: clone(levelrewards),
    canClaim: false,
    hasLevelUpRewards: false,
    check: 'uhtotallysecure',
    levelrewards_milestones: []
  };
}

function buildGameStatsPayload(userId) {
  const profile = getProfile(userId);
  const levelRewardsStatus = buildLevelRewardsSummary(userId);
  const level = Number(levelRewardsStatus.level || 1);
  const xp = Number(levelRewardsStatus.currentXP || 0);
  const miles = getNormalizedProfileMiles(profile);
  const respectPoints = Number(levelRewardsStatus.respectPoints || 0);
  const nextLevelXP = Number(levelRewardsStatus.nextLevelXP || 1000);
  const levelRewards = clone(levelRewardsStatus.levelRewards || []);
  const nextLevelRewards = clone(levelRewardsStatus.nextLevelRewards || []);
  const prevLevelRewards = clone(levelRewardsStatus.prevLevelRewards || []);
  // Ranked races icin bos ama null olmayan veri dondurmek zorunlu
  // yoksa RankedRacesManager.UpdateCurrentLevelRewards() NullReferenceException atiyor
  const safeLevel = {
    level: level,
    currentXP: xp,
    nextLevelXP,
    respectPoints,
    levelRewards: clone(levelRewards),
    nextLevelRewards: clone(nextLevelRewards),
    prevLevelRewards: clone(prevLevelRewards)
  };
  return {
    level,
    miles,
    achievements: [],
    xp,
    XP: xp,
    currentXP: xp,
    nextLevelXP,
    respectPoints,
    rp: respectPoints,
    levelRewards: clone(levelRewards),
    nextLevelRewards: clone(nextLevelRewards),
    prevLevelRewards: clone(prevLevelRewards),
    rankedData: safeLevel,
    playerLevel: safeLevel,
    levelData: safeLevel
  };
}

function buildAutoRefreshPayload() {
  return {
    hash: 'local',
    changed: false,
    refresh: false,
    check: 'uhtotallysecure',
    data: {}
  };
}

function buildAutoRefreshIndexPayload() {
  return {
    hash: 'local-autorefresh-v1',
    changed: true,
    refresh: true,
    check: 'uhtotallysecure',
    data: {
      groups: ['gacha', 'gamestore', 'motd', 'message', 'prizes', 'tutorialdata']
    }
  };
}

function extractGroupNames(params) {
  // Client sends: groups.0.name="gacha", groups.0.hash="...", groups.1.name="gamestore" etc.
  // OR params.groups = [{name:"gacha",...}, ...]
  const names = new Set();
  const raw = params.groups;
  if (Array.isArray(raw)) {
    raw.forEach((g) => { if (g && g.name) names.add(String(g.name).toLowerCase()); });
  } else if (raw && typeof raw === 'object') {
    // dot-notation parsed as nested object: raw[0] = {name,hash,api}
    Object.values(raw).forEach((g) => { if (g && g.name) names.add(String(g.name).toLowerCase()); });
  } else if (typeof raw === 'string') {
    raw.split(/[,\s]+/).forEach((s) => { if (s) names.add(s.trim().toLowerCase()); });
  }
  // also check flat dot-notation: params['groups.0.name'] etc.
  Object.keys(params).forEach((k) => {
    const m = k.match(/^groups?\.\d+\.name$/i);
    if (m) names.add(String(params[k]).toLowerCase());
  });
  return Array.from(names);
}

function buildAutoRefreshGroupPayload(userId, params = {}) {
  const groups = extractGroupNames(params);
  const ts = Date.now();
  const getIncomingGroupHash = (groupName) => {
    const rawGroups = params.groups;
    if (Array.isArray(rawGroups)) {
      const match = rawGroups.find((entry) => String(entry && entry.name || '').toLowerCase() === groupName);
      return String(match && match.hash || '');
    }
    if (rawGroups && typeof rawGroups === 'object') {
      const match = Object.values(rawGroups).find((entry) => String(entry && entry.name || '').toLowerCase() === groupName);
      return String(match && match.hash || '');
    }
    const flatNameKey = Object.keys(params).find((key) => {
      const match = key.match(/^groups?\.\d+\.name$/i);
      return match && String(params[key]).toLowerCase() === groupName;
    });
    if (!flatNameKey) {
      return '';
    }
    return String(params[flatNameKey.replace(/\.name$/i, '.hash')] || '');
  };

  const updates = [];
  groups.forEach((groupName) => {
    if (groupName === 'gacha') {
      const r = buildGachaRefreshPayload(userId, ts);
      const incomingHash = String(getIncomingGroupHash(groupName));
      const changed = incomingHash !== String(r.check || '');
      const update = {
        name: 'gacha',
        check: r.check,
        refresh: r.refresh,
        changed
      };
      if (changed) {
        update.gacha = r.gacha;
      }
      updates.push(update);
    } else if (groupName === 'gamestore') {
      const r = buildGameStoreRefreshPayload(userId, { partial: true });
      const incomingHash = String(getIncomingGroupHash(groupName));
      const changed = incomingHash !== String(r.check || '');
      const update = {
        name: 'gamestore',
        check: r.check,
        refresh: 3600,
        changed
      };
      if (changed) {
        update.gamestore = r;
      }
      updates.push(update);
    } else if (groupName === 'motd') {
      const r = buildMotdRefreshPayload();
      updates.push({ name: 'motd', check: `local-motd-${ts}`, refresh: 3600, motd: r });
    } else if (groupName === 'message') {
      const r = buildMessageRefreshPayload(userId);
      updates.push({ name: 'message', check: `local-message-${ts}`, refresh: 3600, message: r });
    } else if (groupName === 'prizes') {
      const r = buildPrizesRefreshPayload(userId);
      updates.push({ name: 'prizes', check: `local-prizes-${ts}`, refresh: 3600, prizes: r });
    } else if (groupName === 'tutorialdata') {
      const r = buildTutorialResult(userId);
      updates.push({ name: 'tutorialdata', check: `local-tutorial-${ts}`, refresh: 3600, tutorialdata: r });
    }
  });

  return { updates };
}

// Builds gachaCarInfo hashtable expected by PerformanceUpgradeManager.Connect() → ParseStaticCarData().
// Keys are trimmed car asset tags; values need at minimum: maxpi (int), ct (string), st (int).
// Without this, GetStaticCarData() returns null → ShowInvalidData() → "Kullanılamaz" + "888" PI.
function buildGachaCarInfoPayload() {
  const info = {};
  const allTags = new Set([
    ...Object.keys(defaultVehicleDescriptions),
    ...Object.keys(vehicleMetaTemplates)
  ]);
  allTags.forEach((tag) => {
    const desc = defaultVehicleDescriptions[tag] || {};
    const meta = vehicleMetaTemplates[tag] || {};
    const maxpi = Number(desc.BasePISS || meta.pi || 0);
    const ct = String(firstDefined(meta.ct, meta.cty, 'stock') || 'stock').trim().toLowerCase();
    const st = Math.max(0, Math.trunc(Number(firstDefined(meta.st, 4) || 4)));
    // Only include playable / tunable cars (skip pure traffic vehicles)
    if (maxpi > 0 && ct !== 'traffic') {
      info[tag.trim()] = { maxpi, ct, st };
    }
  });
  return info;
}

const FF7_VISUAL_UPGRADE_CATALOG = Object.freeze({
  paint: [
    'carpaint_2tone_cottoncandy',
    'carpaint_2tone_darkcherry',
    'carpaint_2tone_dendrobates_green',
    'carpaint_2tone_dendrobates_orange',
    'carpaint_2tone_dendrobates_yellow',
    'carpaint_2tone_plastidip_pink',
    'carpaint_acrylic_v1_black',
    'carpaint_acrylic_v1_blue_cirrus',
    'carpaint_acrylic_v1_blue_lapis',
    'carpaint_acrylic_v1_blue_oceania',
    'carpaint_acrylic_v1_green_eclipse',
    'carpaint_acrylic_v1_green_lime',
    'carpaint_acrylic_v1_orange',
    'carpaint_acrylic_v1_red',
    'carpaint_acrylic_v1_red_henna',
    'carpaint_acrylic_v1_yellow',
    'carpaint_acrylic_v2_grey',
    'carpaint_acrylic_v3_blue_cirrus',
    'carpaint_acrylic_v3_blue_lapis',
    'carpaint_acrylic_v3_blue_oceania',
    'carpaint_acrylic_v3_green_eclipse',
    'carpaint_acrylic_v3_green_lime',
    'carpaint_acrylic_v3_white',
    'carpaint_acrylic_v3_yellow',
    'carpaint_chrome_blue',
    'carpaint_chrome_bronze',
    'carpaint_chrome_gold',
    'carpaint_chrome_green',
    'carpaint_chrome_red',
    'carpaint_chrome_silver',
    'carpaint_chrome_yellow',
    'carpaint_matte_black',
    'carpaint_matte_blue',
    'carpaint_matte_gray',
    'carpaint_matte_green_army',
    'carpaint_matte_red',
    'carpaint_matte_white',
    'carpaint_matte_yellow',
    'carpaint_metallic_belge_luxor',
    'carpaint_metallic_black_diamond',
    'carpaint_metallic_black_pure',
    'carpaint_metallic_blue_cirrus',
    'carpaint_metallic_blue_lapis',
    'carpaint_metallic_blue_medium',
    'carpaint_metallic_green_electric',
    'carpaint_metallic_green_jade',
    'carpaint_metallic_green_monster',
    'carpaint_metallic_green_olive_civic',
    'carpaint_metallic_orange_fire',
    'carpaint_metallic_orange_valencia',
    'carpaint_metallic_red_crimson',
    'carpaint_metallic_red_melboume',
    'carpaint_metallic_red_radical',
    'carpaint_metallic_silver_glacier',
    'carpaint_metallic_white_alpine',
    'carpaint_metallic_white_pearl'
  ],
  decal: [
    'decal_cmn_01_a',
    'decal_cmn_01_b',
    'decal_cmn_80s_01',
    'decal_cmn_animate_01',
    'decal_cmn_badge',
    'decal_cmn_bat_01',
    'decal_cmn_black_heart',
    'decal_cmn_chn_character',
    'decal_cmn_demon_lil',
    'decal_cmn_eagle',
    'decal_cmn_graffiti',
    'decal_cmn_hello_pitbull',
    'decal_cmn_lion',
    'decal_cmn_logo_01',
    'decal_cmn_military',
    'decal_cmn_motor',
    'decal_cmn_number7',
    'decal_cmn_shield_01',
    'decal_cmn_sponsors_01',
    'decal_cmn_stencil_dog',
    'decal_logo_kabam'
  ],
  vinylCommon: [
    'nothing',
    'vinyl_cmn_blackink',
    'vinyl_cmn_camo_digital',
    'vinyl_cmn_camo_navy',
    'vinyl_cmn_checker_racingflag',
    'vinyl_cmn_cutout_01',
    'vinyl_cmn_ff7event_1',
    'vinyl_cmn_flame_01',
    'vinyl_cmn_flame_02',
    'vinyl_cmn_gradient',
    'vinyl_cmn_greenlines',
    'vinyl_cmn_linetrace_01',
    'vinyl_cmn_linetrace_02',
    'vinyl_cmn_pro_modern',
    'vinyl_cmn_sponsors_01',
    'vinyl_country_american_pride',
    'vinyl_country_germany_flag_01',
    'vinyl_country_uk_flag_01',
    'vinyl_holiday_triangles',
    'vinyl_stripes_1_black_n_red',
    'vinyl_stripes_1_lime_a',
    'vinyl_stripes_1_martini',
    'vinyl_stripes_2_black_b',
    'vinyl_stripes_2_white',
    'vinyl_stripes_x_coke_red',
    'vinyl_stripes_x_ornament_01'
  ],
  vinylUnique: [
    'vinyl_oem_boss',
    'vinyl_oem_daytona',
    'vinyl_oem_escort_rs2000',
    'vinyl_oem_ford_gt',
    'vinyl_oem_mach1'
  ],
  bodykit: [
    'bodykit_aero_001',
    'bodykit_aero_002',
    'bodykit_aero_003'
  ],
  spoiler: [
    'spoiler_aluminum_ff_001',
    'spoiler_aluminum_ff_002',
    'spoiler_aluminum_ff_003',
    'spoiler_aluminum_ff_004',
    'spoiler_carbon_ff_001',
    'spoiler_carbon_ff_002',
    'spoiler_carbon_ff_003',
    'spoiler_carbon_ff_004',
    'spoiler_carbon_ff_005',
    'spoiler_carbon_ff_006',
    'spoiler_fiberglass_ff_001',
    'spoiler_fiberglass_ff_002',
    'spoiler_fiberglass_ff_003',
    'spoiler_fiberglass_ff_004',
    'spoiler_fiberglass_ff_005'
  ],
  spoilerMaterial: [
    'spoilerpaint_aluminum_blue',
    'spoilerpaint_aluminum_orange',
    'spoilerpaint_aluminum_red',
    'spoilerpaint_aluminum_silver',
    'spoilerpaint_carbon_black_black',
    'spoilerpaint_carbon_black_blue',
    'spoilerpaint_carbon_black_chromegold',
    'spoilerpaint_carbon_black_chromesilver',
    'spoilerpaint_carbon_black_gold',
    'spoilerpaint_carbon_black_green',
    'spoilerpaint_carbon_black_orange',
    'spoilerpaint_carbon_black_red',
    'spoilerpaint_carbon_black_white'
  ],
  rim: [
    'rim_ff_ar_00_225_19_a',
    'rim_ff_ar_01_225_19_a',
    'rim_ff_dd_00_225_19_a',
    'rim_ff_dd_01_225_19_a',
    'rim_ff_dd_02_225_19_a',
    'rim_ff_gt_00_225_19_a',
    'rim_ff_gt_01_225_19_a',
    'rim_ff_gt_02_225_19_a',
    'rim_ff_tk_00_225_19_a'
  ],
  rimMaterial: [
    'rimpaint_black',
    'rimpaint_black_matte',
    'rimpaint_blue',
    'rimpaint_blue_matte',
    'rimpaint_chrome',
    'rimpaint_gold',
    'rimpaint_green',
    'rimpaint_gunmetal',
    'rimpaint_orange',
    'rimpaint_orange_matte',
    'rimpaint_pink',
    'rimpaint_red',
    'rimpaint_red_matte',
    'rimpaint_silver',
    'rimpaint_white',
    'rimpaint_yellow'
  ],
  lensflare: [
    'lensflare_02000k',
    'lensflare_03000k',
    'lensflare_04300k',
    'lensflare_05000k',
    'lensflare_06000k',
    'lensflare_10000k',
    'lensflare_12000k',
    'lensflare_blue',
    'lensflare_green',
    'lensflare_pink',
    'lensflare_purple'
  ]
});

const FF7_VISUAL_UPGRADE_CATEGORY_IDS = Object.freeze({
  BODY_PAINT: 0,
  DECAL_BODY: 1,
  DECAL_HOOD: 2,
  VINYL: 3,
  UNDERGLOW: 4,
  SPOILER: 5,
  SPOILER_MATERIAL: 6,
  RIM_FRONT: 7,
  RIM_MATERIAL_FRONT: 8,
  RIM_REAR: 9,
  RIM_MATERIAL_REAR: 10,
  TIRE_FRONT: 11,
  TIRE_REAR: 12,
  LENSFLARE: 13,
  BODYKIT: 14
});

function formatVisualUpgradeTitle(name) {
  return String(name || '')
    .replace(/^vu_/, '')
    .replace(/^carpaint_/, '')
    .replace(/^decal_/, '')
    .replace(/^vinyl_/, '')
    .replace(/^bodykit_/, '')
    .replace(/^spoilerpaint_/, '')
    .replace(/^spoiler_/, '')
    .replace(/^rimpaint_/, '')
    .replace(/^rim_/, '')
    .replace(/^lensflare_/, '')
    .replace(/_/g, ' ')
    .trim()
    .replace(/\b\w/g, (match) => match.toUpperCase());
}

function getDefaultVisualUpgradeSubCategory(categoryId, name = '') {
  const normalizedName = String(name || '').trim().toLowerCase();
  const normalizedCategoryId = Number.isFinite(Number(categoryId)) ? Number(categoryId) : -1;
  if (normalizedName.includes('rimpaint') || normalizedName.includes('rim_material')) {
    return normalizedCategoryId === FF7_VISUAL_UPGRADE_CATEGORY_IDS.RIM_MATERIAL_REAR
      ? 'rim_material_rear'
      : 'rim_material_front';
  }
  if (normalizedName.includes('tire_rear')) return 'tire_rear';
  if (normalizedName.includes('tire_front') || normalizedName.includes('tire_')) return 'tire_front';
  if (normalizedName.includes('rim_rear')) return 'rim_rear';
  if (normalizedName.includes('rim_front') || normalizedName.includes('vu_rim_') || normalizedName.includes('_rim_')) return 'rim_front';
  if (normalizedName.includes('spoilerpaint')) return 'spoiler_material';
  if (normalizedName.includes('spoiler')) return 'spoiler';
  if (normalizedName.includes('bodykit')) return 'bodykit';
  if (normalizedName.includes('lensflare')) return 'lensflare';
  if (normalizedName.includes('vinyl')) return 'vinyl_common';
  if (normalizedName.includes('decal_hood')) return 'decal_hood';
  if (normalizedName.includes('decal')) return 'decal_body';
  if (normalizedName.includes('carpaint') || normalizedName.includes('paint')) return 'paint';

  switch (normalizedCategoryId) {
    case FF7_VISUAL_UPGRADE_CATEGORY_IDS.BODY_PAINT:
      return 'paint';
    case FF7_VISUAL_UPGRADE_CATEGORY_IDS.DECAL_BODY:
      return 'decal_body';
    case FF7_VISUAL_UPGRADE_CATEGORY_IDS.DECAL_HOOD:
      return 'decal_hood';
    case FF7_VISUAL_UPGRADE_CATEGORY_IDS.VINYL:
      return 'vinyl_common';
    case FF7_VISUAL_UPGRADE_CATEGORY_IDS.UNDERGLOW:
      return 'underglow';
    case FF7_VISUAL_UPGRADE_CATEGORY_IDS.SPOILER:
      return 'spoiler';
    case FF7_VISUAL_UPGRADE_CATEGORY_IDS.SPOILER_MATERIAL:
      return 'spoiler_material';
    case FF7_VISUAL_UPGRADE_CATEGORY_IDS.RIM_FRONT:
      return 'rim_front';
    case FF7_VISUAL_UPGRADE_CATEGORY_IDS.RIM_MATERIAL_FRONT:
      return 'rim_material_front';
    case FF7_VISUAL_UPGRADE_CATEGORY_IDS.RIM_REAR:
      return 'rim_rear';
    case FF7_VISUAL_UPGRADE_CATEGORY_IDS.RIM_MATERIAL_REAR:
      return 'rim_material_rear';
    case FF7_VISUAL_UPGRADE_CATEGORY_IDS.TIRE_FRONT:
      return 'tire_front';
    case FF7_VISUAL_UPGRADE_CATEGORY_IDS.TIRE_REAR:
      return 'tire_rear';
    case FF7_VISUAL_UPGRADE_CATEGORY_IDS.LENSFLARE:
      return 'lensflare';
    case FF7_VISUAL_UPGRADE_CATEGORY_IDS.BODYKIT:
      return 'bodykit';
    default:
      return '';
  }
}

function normalizeVisualUpgradeStoreName(name) {
  const raw = String(name || '').trim();
  if (!raw) {
    return '';
  }
  if (raw === 'nothing' || raw.startsWith('vu_')) {
    return raw;
  }
  return `vu_${raw}`;
}

function buildVisualUpgradeEntry(name, category, subCategory, iconPath, texturePath, order, options = {}) {
  const rawName = String(name || '').trim();
  const visualUpgradeName = normalizeVisualUpgradeStoreName(rawName);
  const hash = buildVisualUpgradeHash(visualUpgradeName);
  const uiName = String(options.title || formatVisualUpgradeTitle(visualUpgradeName) || rawName);
  const oem = Boolean(options.oem);
  const hidden = Boolean(options.hidden);
  const categoryId = Number.isFinite(category)
    ? Number(category)
    : Number(FF7_VISUAL_UPGRADE_CATEGORY_IDS[String(category || '').toUpperCase()]);
  return {
    visualUpgradeName,
    id: visualUpgradeName,
    hash,
    Hash: hash,
    visualUpgradeCategory: Number.isFinite(categoryId) ? categoryId : 0,
    vuc: Number.isFinite(categoryId) ? categoryId : 0,
    visualUpgradeSubCategoryName: String(subCategory || ''),
    scn: String(subCategory || ''),
    visualUpgradeUIName: uiName,
    uin: uiName,
    visualUpgradeUIIconPath: String(iconPath || ''),
    ip: String(iconPath || ''),
    visualUpgradeLocked: false,
    l: false,
    visualUpgradeStyleBonus: 0,
    sb: 0,
    visualUpgradeOEM: oem,
    oem,
    visualUpgradeUIScreenOrder: Number(order || 0),
    so: Number(order || 0),
    visualUpgradeDeviceType: 0,
    dt: 0,
    visualUpgradeHidden: hidden,
    h: hidden,
    visualUpgradeNew: false,
    nw: false,
    visualUpgradeTexturePath: String(texturePath || ''),
    tp: String(texturePath || ''),
    visualUpgradePrefabPath: '',
    vehicleTag: '',
    tag: ''
  };
}

function buildVisualUpgradeEntryFromCardb(spec = {}, fallbackOrder = 0) {
  const visualUpgradeName = normalizeVisualUpgradeStoreName(spec.vun || spec.name || spec.id || '');
  if (!visualUpgradeName) {
    return null;
  }
  const order = Math.max(1, Math.trunc(Number(spec.vuso || fallbackOrder || 1)));
  const categoryId = Number.isFinite(Number(spec.vuc)) ? Number(spec.vuc) : 0;
  const subCategoryName = String(
    firstDefined(
      spec.vuscn,
      spec.scn,
      getDefaultVisualUpgradeSubCategory(categoryId, visualUpgradeName),
      ''
    ) || ''
  ).trim();
  const uiName = String(spec.vuuin || spec.uin || formatVisualUpgradeTitle(visualUpgradeName) || visualUpgradeName);
  const hidden = Boolean(spec.vuh || spec.hidden);
  const styleBonus = Math.max(0, Math.trunc(Number(spec.vusb || spec.sb || 0)));
  return {
    visualUpgradeName,
    id: visualUpgradeName,
    hash: buildVisualUpgradeHash(visualUpgradeName),
    Hash: buildVisualUpgradeHash(visualUpgradeName),
    visualUpgradeCategory: categoryId,
    vuc: categoryId,
    visualUpgradeSubCategoryName: subCategoryName,
    scn: subCategoryName,
    visualUpgradeUIName: uiName,
    uin: uiName,
    visualUpgradeUIIconPath: String(spec.vuip || spec.ip || ''),
    ip: String(spec.vuip || spec.ip || ''),
    visualUpgradeLocked: false,
    l: false,
    visualUpgradeStyleBonus: styleBonus,
    sb: styleBonus,
    visualUpgradeOEM: Boolean(spec.vuoem || spec.oem),
    oem: Boolean(spec.vuoem || spec.oem),
    visualUpgradeUIScreenOrder: order,
    so: order,
    visualUpgradeDeviceType: 0,
    dt: 0,
    visualUpgradeHidden: hidden,
    h: hidden,
    visualUpgradeNew: false,
    nw: false,
    visualUpgradeTexturePath: String(spec.vutp || spec.tp || ''),
    tp: String(spec.vutp || spec.tp || ''),
    visualUpgradePrefabPath: String(spec.vupp || spec.pp || ''),
    vupp: String(spec.vupp || spec.pp || ''),
    visualUpgradeMaterialHashList: Array.isArray(spec.vumhl) ? clone(spec.vumhl) : [],
    vumhl: Array.isArray(spec.vumhl) ? clone(spec.vumhl) : [],
    vehicleTag: '',
    tag: ''
  };
}

function buildVisualUpgradeTuningEntries() {
  const entries = [];
  const externalCardb = loadExternalCardb();
  const externalEntries = Array.isArray(externalCardb && externalCardb.vu) ? externalCardb.vu : [];
  externalEntries.forEach((spec, index) => {
    const entry = buildVisualUpgradeEntryFromCardb(spec, index + 1);
    if (entry) {
      entries.push(entry);
    }
  });
  let order = 1;
  if (entries.length > 0) {
    order = entries.reduce((max, entry) => Math.max(max, Number(entry.so || entry.visualUpgradeUIScreenOrder || 0)), 0) + 1;
  }
  const pushCategory = (names, category, subCategory, iconRoot, textureRoot = '', options = {}) => {
    (Array.isArray(names) ? names : []).forEach((name) => {
      entries.push(
        buildVisualUpgradeEntry(
          name,
          category,
          subCategory,
          `${iconRoot}${name}`,
          textureRoot ? `${textureRoot}${name}` : '',
          order,
          options
        )
      );
      order += 1;
    });
  };

  pushCategory(
    FF7_VISUAL_UPGRADE_CATALOG.paint,
    'BODY_PAINT',
    'paint',
    'Bundles/UITextures/VisualUpgrade/Carpaint/Common/thumb_'
  );
  pushCategory(
    FF7_VISUAL_UPGRADE_CATALOG.decal,
    'DECAL_BODY',
    'decal_body',
    'Bundles/UITextures/VisualUpgrade/Decal/Common/thumb_',
    'Bundles/vutextures/decal/common/'
  );
  pushCategory(
    FF7_VISUAL_UPGRADE_CATALOG.decal,
    'DECAL_HOOD',
    'decal_hood',
    'Bundles/UITextures/VisualUpgrade/Decal/Common/thumb_',
    'Bundles/vutextures/decal/common/'
  );
  pushCategory(
    FF7_VISUAL_UPGRADE_CATALOG.vinylCommon,
    'VINYL',
    'vinyl_common',
    'Bundles/UITextures/VisualUpgrade/Vinyl/Common/thumb_',
    'Bundles/vutextures/vinyl/common/'
  );
  pushCategory(
    FF7_VISUAL_UPGRADE_CATALOG.vinylUnique,
    'VINYL',
    'vinyl_unique',
    'Bundles/UITextures/VisualUpgrade/Vinyl/Unique/thumb_',
    'Bundles/vutextures/vinyl/unique/',
    { oem: true }
  );
  pushCategory(
    FF7_VISUAL_UPGRADE_CATALOG.bodykit,
    'BODYKIT',
    'bodykit',
    'Bundles/UITextures/VisualUpgrade/Bodykit/Common/thumb_'
  );
  pushCategory(
    FF7_VISUAL_UPGRADE_CATALOG.spoiler,
    'SPOILER',
    'spoiler',
    'Bundles/UITextures/VisualUpgrade/Spoiler/Common/thumb_'
  );
  pushCategory(
    FF7_VISUAL_UPGRADE_CATALOG.spoilerMaterial,
    'SPOILER_MATERIAL',
    'spoiler_material',
    'Bundles/UITextures/VisualUpgrade/Spoiler_Material/Common/thumb_'
  );
  pushCategory(
    FF7_VISUAL_UPGRADE_CATALOG.rim,
    'RIM_FRONT',
    'rim_front',
    'Bundles/UITextures/VisualUpgrade/Rim/Common/thumb_'
  );
  pushCategory(
    FF7_VISUAL_UPGRADE_CATALOG.rim,
    'RIM_REAR',
    'rim_rear',
    'Bundles/UITextures/VisualUpgrade/Rim/Common/thumb_'
  );
  pushCategory(
    FF7_VISUAL_UPGRADE_CATALOG.rimMaterial,
    'RIM_MATERIAL_FRONT',
    'rim_material_front',
    'Bundles/UITextures/VisualUpgrade/Rim_Material/Common/thumb_'
  );
  pushCategory(
    FF7_VISUAL_UPGRADE_CATALOG.rimMaterial,
    'RIM_MATERIAL_REAR',
    'rim_material_rear',
    'Bundles/UITextures/VisualUpgrade/Rim_Material/Common/thumb_'
  );
  pushCategory(
    FF7_VISUAL_UPGRADE_CATALOG.lensflare,
    'LENSFLARE',
    'lensflare',
    'Bundles/UITextures/VisualUpgrade/lensflare/Common/thumb_'
  );

  const existingNames = new Set(entries.map((entry) => String(entry.visualUpgradeName || '').trim()));
  const pushDynamicEntry = (name) => {
    const visualUpgradeName = normalizeVisualUpgradeStoreName(name);
    if (!visualUpgradeName || existingNames.has(visualUpgradeName)) {
      return;
    }

    let category = null;
    let subCategory = '';
    let iconRoot = 'Bundles/UITextures/VisualUpgrade/Bodykit/Common/thumb_';

    if (visualUpgradeName.startsWith('vu_carpaint_')) {
      category = 'BODY_PAINT';
      subCategory = 'paint';
      iconRoot = 'Bundles/UITextures/VisualUpgrade/Carpaint/Common/thumb_';
    } else if (visualUpgradeName.startsWith('vu_spoilerpaint_')) {
      category = 'SPOILER_MATERIAL';
      subCategory = 'spoiler_material';
      iconRoot = 'Bundles/UITextures/VisualUpgrade/Spoiler_Material/Common/thumb_';
    } else if (visualUpgradeName.startsWith('vu_lensflare_')) {
      category = 'LENSFLARE';
      subCategory = 'lensflare';
      iconRoot = 'Bundles/UITextures/VisualUpgrade/lensflare/Common/thumb_';
    } else if (visualUpgradeName.includes('_rim_rear_')) {
      category = 'RIM_REAR';
      subCategory = 'rim_rear';
      iconRoot = 'Bundles/UITextures/VisualUpgrade/Rim/Common/thumb_';
    } else if (visualUpgradeName.includes('_rim_front_')) {
      category = 'RIM_FRONT';
      subCategory = 'rim_front';
      iconRoot = 'Bundles/UITextures/VisualUpgrade/Rim/Common/thumb_';
    } else if (visualUpgradeName.includes('_rim_material') || visualUpgradeName.startsWith('vu_rimpaint_')) {
      category = 'RIM_MATERIAL_FRONT';
      subCategory = 'rim_material_front';
      iconRoot = 'Bundles/UITextures/VisualUpgrade/Rim_Material/Common/thumb_';
    } else if (visualUpgradeName.includes('_rim')) {
      category = 'RIM_FRONT';
      subCategory = 'rim_front';
      iconRoot = 'Bundles/UITextures/VisualUpgrade/Rim/Common/thumb_';
    } else if (visualUpgradeName.includes('_rim_material_')) {
      category = 'RIM_MATERIAL_FRONT';
      subCategory = 'rim_material_front';
      iconRoot = 'Bundles/UITextures/VisualUpgrade/Rim_Material/Common/thumb_';
    } else if (visualUpgradeName.includes('_tire_rear_')) {
      category = 'TIRE_REAR';
      subCategory = 'tire_rear';
      iconRoot = 'Bundles/UITextures/VisualUpgrade/Rim/Common/thumb_';
    } else if (visualUpgradeName.includes('_tire_front_') || visualUpgradeName.startsWith('vu_tire_')) {
      category = 'TIRE_FRONT';
      subCategory = 'tire_front';
      iconRoot = 'Bundles/UITextures/VisualUpgrade/Rim/Common/thumb_';
    } else if (visualUpgradeName.includes('_spoiler_') || /_spoiler_[a-z0-9]+$/.test(visualUpgradeName)) {
      category = 'SPOILER';
      subCategory = 'spoiler';
      iconRoot = 'Bundles/UITextures/VisualUpgrade/Spoiler/Common/thumb_';
    } else if (visualUpgradeName.includes('_bodykit_')) {
      category = 'BODYKIT';
      subCategory = 'bodykit';
      iconRoot = 'Bundles/UITextures/VisualUpgrade/Bodykit/Common/thumb_';
    }

    if (!category) {
      return;
    }

    entries.push(
      buildVisualUpgradeEntry(
        visualUpgradeName,
        category,
        subCategory,
        `${iconRoot}${visualUpgradeName}`,
        '',
        order,
        {
          oem: visualUpgradeName.includes('_bodykit_oem_') || visualUpgradeName.endsWith('_oem_a')
        }
      )
    );
    existingNames.add(visualUpgradeName);
    order += 1;
  };

  getDynamicVisualUpgradeNames().forEach(pushDynamicEntry);
  const seenCategoryKeys = new Set(
    entries.map((entry) => `${String(entry && entry.visualUpgradeName || '')}:${Number(entry && entry.visualUpgradeCategory || 0)}`)
  );
  const mirroredEntries = [];
  entries.forEach((entry) => {
    if (!entry || typeof entry !== 'object') {
      return;
    }
    const visualUpgradeName = String(entry.visualUpgradeName || '').trim();
    const categoryId = Number(entry.visualUpgradeCategory || entry.vuc || 0);
    let mirroredCategoryId = null;
    let mirroredSubCategory = '';
    if (categoryId === FF7_VISUAL_UPGRADE_CATEGORY_IDS.RIM_FRONT) {
      mirroredCategoryId = FF7_VISUAL_UPGRADE_CATEGORY_IDS.RIM_REAR;
      mirroredSubCategory = 'rim_rear';
    } else if (categoryId === FF7_VISUAL_UPGRADE_CATEGORY_IDS.RIM_MATERIAL_FRONT) {
      mirroredCategoryId = FF7_VISUAL_UPGRADE_CATEGORY_IDS.RIM_MATERIAL_REAR;
      mirroredSubCategory = 'rim_material_rear';
    } else if (categoryId === FF7_VISUAL_UPGRADE_CATEGORY_IDS.TIRE_FRONT) {
      mirroredCategoryId = FF7_VISUAL_UPGRADE_CATEGORY_IDS.TIRE_REAR;
      mirroredSubCategory = 'tire_rear';
    }
    if (mirroredCategoryId == null || !visualUpgradeName) {
      return;
    }
    const categoryKey = `${visualUpgradeName}:${mirroredCategoryId}`;
    if (seenCategoryKeys.has(categoryKey)) {
      return;
    }
    seenCategoryKeys.add(categoryKey);
    mirroredEntries.push({
      ...clone(entry),
      visualUpgradeCategory: mirroredCategoryId,
      vuc: mirroredCategoryId,
      visualUpgradeSubCategoryName: mirroredSubCategory,
      scn: mirroredSubCategory
    });
  });
  entries.push(...mirroredEntries);
  return entries;
}

function buildVisualUpgradeTuningPayload() {
  const tuningData = buildVisualUpgradeTuningEntries();
  return {
    dbHash: crypto.createHash('md5').update(JSON.stringify(tuningData)).digest('hex'),
    tuningData
  };
}

function buildCarUpgradesLoginPayload(userId) {
  const profile = getAuthoritativeSparxProfile(userId);
  const ownerUid = getProfileUidValue(profile, userId);
  const carsRoot = buildCarsRoot(userId);
  const bucket = (carsRoot && carsRoot[ownerUid] && typeof carsRoot[ownerUid] === 'object')
    ? carsRoot[ownerUid]
    : {};
  return Object.values(bucket)
    .filter((record) => record && typeof record === 'object')
    .map((record) => buildPerformanceUpgradesPayload(userId, {
      carId: String(record._id || record.id || ''),
      vehicleTag: String(record.carId || record.car || '')
    }));
}

function buildMechanicsDataPayload(userId) {
  const sparx = ensureSparxState(userId);
  if (!Array.isArray(sparx.mechanicsData)) {
    sparx.mechanicsData = [];
  }
  ensureSparxInventoryRoot(userId);
  return clone(sparx.mechanicsData);
}

function ensureAllianceState(userId) {
  const user = getUser(userId);
  const db = loadCrewDb();
  let changed = ensureCrewDbMembershipMigrated(userId, db);
  const currentAlliance = getAllianceForUser(userId, db);
  const recommended = buildRecommendedAllianceList(
    userId,
    db,
    currentAlliance && currentAlliance.aid ? currentAlliance.aid : ''
  );
  if (!user.allianceState || typeof user.allianceState !== 'object') {
    user.allianceState = {
      alliance: null,
      recommended: [],
      invites: [],
      requests: [],
      createCost: { redeemers: [] },
      joinCost: { redeemers: [] },
      firstJoinRewards: { redeemers: [] }
    };
    changed = true;
  }
  user.allianceState.alliance = currentAlliance ? clone(currentAlliance) : null;
  user.allianceState.recommended = clone(recommended);
  user.allianceState.amri = [];
  user.allianceState.AMRI = [];
  if (changed) {
    saveCrewDb(db);
    persistState();
  }
  return user.allianceState;
}

function buildAlliancePayload(userId) {
  const state = ensureAllianceState(userId);
  const currentAlliance = clone(state.alliance);
  const recommended = clone(state.recommended || []);
  const members = clone((state.alliance && state.alliance.members) || []);
  return {
    alliance: currentAlliance,
    Alliance: currentAlliance,
    currentAlliance,
    CurrentAlliance: currentAlliance,
    alliances: recommended,
    Alliances: recommended,
    recommended,
    Recommended: recommended,
    invites: clone(state.invites || []),
    Invites: clone(state.invites || []),
    requests: clone(state.requests || []),
    Requests: clone(state.requests || []),
    createCost: clone(state.createCost || { redeemers: [] }),
    CreateCost: clone(state.createCost || { redeemers: [] }),
    joinCost: clone(state.joinCost || { redeemers: [] }),
    JoinCost: clone(state.joinCost || { redeemers: [] }),
    firstJoinRewards: clone(state.firstJoinRewards || { redeemers: [] }),
    FirstJoinRewards: clone(state.firstJoinRewards || { redeemers: [] }),
    members,
    Members: members,
    amri: [],
    AMRI: []
  };
}

function buildGachaTablesPayload(userId) {
  const catalog = buildShipyardCatalog(userId);
  return {
    tables: clone(catalog.sets || []),
    sets: clone(catalog.sets || []),
    Sets: clone(catalog.sets || []),
    groups: clone(catalog.groups || []),
    Groups: clone(catalog.groups || []),
    boxes: clone(catalog.boxes || []),
    Boxes: clone(catalog.boxes || []),
    tokens: clone(catalog.tokens || []),
    Tokens: clone(catalog.tokens || []),
    freeTimes: clone(catalog.freeTimes || {}),
    FreeTimes: clone(catalog.freeTimes || {}),
    unclaimedBoxes: clone(catalog.unclaimedBoxes || []),
    UnclaimedBoxes: clone(catalog.unclaimedBoxes || [])
  };
}

function removeOwnedVehicleFromSparxState(userId, carId) {
  const user = getUser(userId);
  const profile = getMutableAuthoritativeSparxProfile(userId);
  const carsRoot = user && user.sparx && user.sparx.dataStore && user.sparx.dataStore.cars && typeof user.sparx.dataStore.cars === 'object'
    ? user.sparx.dataStore.cars
    : {};
  let removedRecord = null;
  Object.values(carsRoot).some((bucket) => {
    if (!bucket || typeof bucket !== 'object') return false;
    const bucketKey = Object.keys(bucket).find((key) => String(key || '') === String(carId || ''));
    if (!bucketKey) return false;
    removedRecord = clone(bucket[bucketKey]);
    delete bucket[bucketKey];
    return true;
  });
  if (!removedRecord) {
    return null;
  }
  const removedTag = getAssetVehicleTag(
    firstDefined(
      removedRecord.carId,
      removedRecord.car,
      removedRecord.r && removedRecord.r.n,
      removedRecord.recipe && removedRecord.recipe.n,
      ''
    ),
    ''
  );
  if (removedTag) {
    const stillOwned = Object.values(carsRoot).some((bucket) => (
      bucket &&
      typeof bucket === 'object' &&
      Object.values(bucket).some((record) => {
        const recordTag = getAssetVehicleTag(
          firstDefined(
            record && record.carId,
            record && record.car,
            record && record.r && record.r.n,
            record && record.recipe && record.recipe.n,
            ''
          ),
          ''
        );
        return recordTag === removedTag;
      })
    ));
    if (!stillOwned) {
      profile.OwnedVehicles = (Array.isArray(profile.OwnedVehicles) ? profile.OwnedVehicles : [])
        .filter((tag) => getAssetVehicleTag(tag, tag) !== removedTag);
      if (profile.OwnedVehiclesStatus && typeof profile.OwnedVehiclesStatus === 'object') {
        delete profile.OwnedVehiclesStatus[removedTag];
      }
      if (String(profile.CurrentVehicleTag || '') === removedTag || String(profile.currentVehicleTag || '') === removedTag) {
        const firstRemainingBucket = Object.values(carsRoot).find((bucket) => bucket && typeof bucket === 'object' && Object.keys(bucket).length > 0);
        const firstRemainingRecord = firstRemainingBucket ? Object.values(firstRemainingBucket)[0] : null;
        if (firstRemainingRecord) {
          const nextTag = getAssetVehicleTag(
            firstDefined(
              firstRemainingRecord.carId,
              firstRemainingRecord.car,
              firstRemainingRecord.r && firstRemainingRecord.r.n,
              firstRemainingRecord.recipe && firstRemainingRecord.recipe.n,
              getDefaultProfileVehicleTag()
            ),
            getDefaultProfileVehicleTag()
          );
          profile.CurrentVehicleTag = nextTag;
          profile.currentVehicleTag = nextTag;
          profile.active_carid = String(firstRemainingRecord._id || firstRemainingRecord.id || '');
          profile.activeCarId = String(firstRemainingRecord._id || firstRemainingRecord.id || '');
          profile.active_recipe = Number((firstRemainingRecord.r && firstRemainingRecord.r.hash) || 0);
        }
      }
    }
  }
  return removedRecord;
}

function buildRepairTransactionPayload(userId, params = {}) {
  const profile = getMutableAuthoritativeSparxProfile(userId);
  const requestedCarId = String(params.carId || params.id || '').trim();
  const resolvedRecord = resolveOwnedVehicleRecord(
    userId,
    requestedCarId,
    String(profile.CurrentVehicleTag || getDefaultProfileVehicleTag())
  );
  const vehicleReference = String(
    firstDefined(
      resolvedRecord && (resolvedRecord.carId || resolvedRecord.car || (resolvedRecord.r && resolvedRecord.r.n)),
      profile.CurrentVehicleTag,
      getDefaultProfileVehicleTag()
    ) || getDefaultProfileVehicleTag()
  );
  const assetTag = getAssetVehicleTag(vehicleReference, getDefaultProfileVehicleTag());
  const ownerUid = getProfileUidValue(profile, userId);
  if (!profile.OwnedVehiclesStatus || typeof profile.OwnedVehiclesStatus !== 'object') {
    profile.OwnedVehiclesStatus = {};
  }
  if (!profile.OwnedVehiclesStatus[assetTag]) {
    profile.OwnedVehiclesStatus[assetTag] = createOwnedVehicleStatus(assetTag);
  }
  const status = profile.OwnedVehiclesStatus[assetTag];
  const bodyDelta = Math.max(0, 1 - Number(status.BodyworkHealth || 1));
  const engineDelta = Math.max(0, 1 - Number(status.EngineHealth || 1));
  const oilDelta = Math.max(0, 1 - Number(status.OilHealth || 1));
  const tyreDelta = Array.isArray(status.TyreHealth)
    ? status.TyreHealth.reduce((sum, value) => sum + Math.max(0, 1 - Number(value || 1)), 0)
    : 0;
  const brakeDelta = Array.isArray(status.BrakeHealth)
    ? status.BrakeHealth.reduce((sum, value) => sum + Math.max(0, 1 - Number(value || 1)), 0)
    : 0;
  const totalWear = bodyDelta + engineDelta + oilDelta + tyreDelta + brakeDelta;
  const currentRecordId = String((resolvedRecord && (resolvedRecord._id || resolvedRecord.id)) || requestedCarId || '');
  if (totalWear <= 0.001) {
    return {
      transactionComplete: false,
      transactionFailureReason: 3,
      pi: Number((resolvedRecord && resolvedRecord.pi) || 0),
      fpi: Number((resolvedRecord && resolvedRecord.pi) || 0),
      carId: currentRecordId,
      updatedCarState: clone(resolvedRecord || null),
      mechanicsData: buildMechanicsDataPayload(userId),
      inventory: buildFlatInventoryResult(userId),
      wallet: buildWalletResult(userId),
      resources: buildResourceResult(userId)
    };
  }
  const repairCost = Math.max(50, Math.trunc(totalWear * 250));
  const currentCoins = Math.max(0, Math.trunc(Number(profile.NoCoins || profile.coins || 0)));
  if (currentCoins < repairCost) {
    return {
      transactionComplete: false,
      transactionFailureReason: 1,
      pi: Number((resolvedRecord && resolvedRecord.pi) || 0),
      fpi: Number((resolvedRecord && resolvedRecord.pi) || 0),
      carId: currentRecordId,
      updatedCarState: clone(resolvedRecord || null),
      mechanicsData: buildMechanicsDataPayload(userId),
      inventory: buildFlatInventoryResult(userId),
      wallet: buildWalletResult(userId),
      resources: buildResourceResult(userId)
    };
  }
  profile.NoCoins = currentCoins - repairCost;
  profile.coins = profile.NoCoins;
  repairVehicleStatus(status);
  const persistedRecord = getMutablePersistedCarRecord(userId, String((resolvedRecord && (resolvedRecord._id || resolvedRecord.id)) || requestedCarId || ''));
  if (persistedRecord && typeof persistedRecord === 'object') {
    persistedRecord.vehicleStatus = clone(status);
    persistedRecord.VehicleStatus = clone(status);
    persistedRecord.cond = buildOwnedVehicleCondition(assetTag, status);
  }
  persistState();
  const updatedCarState = buildPersistedOwnedCarRecord(
    userId,
    ownerUid,
    persistedRecord || resolvedRecord || buildOwnedCarRecord(assetTag, ownerUid, 0, status),
    0,
    assetTag
  );
  return {
    transactionComplete: true,
    transactionFailureReason: 0,
    pi: Number(updatedCarState.pi || 0),
    fpi: Number(updatedCarState.pi || 0),
    carId: String(updatedCarState._id || updatedCarState.id || requestedCarId || ''),
    updatedCarState,
    mechanicsData: buildMechanicsDataPayload(userId),
    inventory: buildFlatInventoryResult(userId),
    wallet: buildWalletResult(userId),
    resources: buildResourceResult(userId)
  };
}

function buildOilTransactionPayload(userId, params = {}) {
  const profile = getMutableAuthoritativeSparxProfile(userId);
  const requestedCarId = String(params.carId || params.id || '').trim();
  const resolvedRecord = resolveOwnedVehicleRecord(
    userId,
    requestedCarId,
    String(profile.CurrentVehicleTag || getDefaultProfileVehicleTag())
  );
  const vehicleReference = String(
    firstDefined(
      resolvedRecord && (resolvedRecord.carId || resolvedRecord.car || (resolvedRecord.r && resolvedRecord.r.n)),
      profile.CurrentVehicleTag,
      getDefaultProfileVehicleTag()
    ) || getDefaultProfileVehicleTag()
  );
  const assetTag = getAssetVehicleTag(vehicleReference, getDefaultProfileVehicleTag());
  const ownerUid = getProfileUidValue(profile, userId);
  if (!profile.OwnedVehiclesStatus || typeof profile.OwnedVehiclesStatus !== 'object') {
    profile.OwnedVehiclesStatus = {};
  }
  if (!profile.OwnedVehiclesStatus[assetTag]) {
    profile.OwnedVehiclesStatus[assetTag] = createOwnedVehicleStatus(assetTag);
  }
  const status = profile.OwnedVehiclesStatus[assetTag];
  const oilDelta = Math.max(0, 1 - Number(status.OilHealth || 1));
  const currentRecordId = String((resolvedRecord && (resolvedRecord._id || resolvedRecord.id)) || requestedCarId || '');
  if (oilDelta <= 0.001) {
    return {
      transactionComplete: false,
      transactionFailureReason: 3,
      pi: Number((resolvedRecord && resolvedRecord.pi) || 0),
      fpi: Number((resolvedRecord && resolvedRecord.pi) || 0),
      carId: currentRecordId,
      updatedCarState: clone(resolvedRecord || null),
      mechanicsData: buildMechanicsDataPayload(userId),
      inventory: buildFlatInventoryResult(userId),
      wallet: buildWalletResult(userId),
      resources: buildResourceResult(userId)
    };
  }
  const oilCost = Math.max(20, Math.trunc(oilDelta * 180));
  const currentCoins = Math.max(0, Math.trunc(Number(profile.NoCoins || profile.coins || 0)));
  if (currentCoins < oilCost) {
    return {
      transactionComplete: false,
      transactionFailureReason: 1,
      pi: Number((resolvedRecord && resolvedRecord.pi) || 0),
      fpi: Number((resolvedRecord && resolvedRecord.pi) || 0),
      carId: currentRecordId,
      updatedCarState: clone(resolvedRecord || null),
      mechanicsData: buildMechanicsDataPayload(userId),
      inventory: buildFlatInventoryResult(userId),
      wallet: buildWalletResult(userId),
      resources: buildResourceResult(userId)
    };
  }
  profile.NoCoins = currentCoins - oilCost;
  profile.coins = profile.NoCoins;
  status.OilHealth = 1;
  const persistedRecord = getMutablePersistedCarRecord(userId, String((resolvedRecord && (resolvedRecord._id || resolvedRecord.id)) || requestedCarId || ''));
  if (persistedRecord && typeof persistedRecord === 'object') {
    persistedRecord.vehicleStatus = clone(status);
    persistedRecord.VehicleStatus = clone(status);
    persistedRecord.cond = buildOwnedVehicleCondition(assetTag, status);
  }
  persistState();
  const updatedCarState = buildPersistedOwnedCarRecord(
    userId,
    ownerUid,
    persistedRecord || resolvedRecord || buildOwnedCarRecord(assetTag, ownerUid, 0, status),
    0,
    assetTag
  );
  return {
    transactionComplete: true,
    transactionFailureReason: 0,
    pi: Number(updatedCarState.pi || 0),
    fpi: Number(updatedCarState.pi || 0),
    carId: String(updatedCarState._id || updatedCarState.id || requestedCarId || ''),
    updatedCarState,
    mechanicsData: buildMechanicsDataPayload(userId),
    inventory: buildFlatInventoryResult(userId),
    wallet: buildWalletResult(userId),
    resources: buildResourceResult(userId)
  };
}

function buildSalvageTransactionPayload(userId, params = {}) {
  const carIds = Array.isArray(params.carIds)
    ? params.carIds
    : String(params.carIds || params.carId || '')
      .split(',')
      .map((value) => String(value || '').trim())
      .filter(Boolean);
  const profile = getMutableAuthoritativeSparxProfile(userId);
  let totalCoins = 0;
  const removedRecords = [];
  carIds.forEach((carId) => {
    const removed = removeOwnedVehicleFromSparxState(userId, carId);
    if (removed) {
      totalCoins += 500;
      removedRecords.push(removed);
    }
  });
  profile.NoCoins = Number(profile.NoCoins || profile.coins || 0) + totalCoins;
  profile.coins = profile.NoCoins;
  const redeemers = buildCarSalvageRedeemers(removedRecords);
  const inventory = applyRedeemersToInventory(userId, redeemers);
  persistState();
  return {
    transactionComplete: true,
    redeemers: clone(redeemers),
    Redeemers: clone(redeemers),
    inventory: inventory || buildFlatInventoryResult(userId),
    wallet: buildWalletResult(userId),
    resources: buildResourceResult(userId),
    storeResult: {
      redeemers: clone(redeemers)
    }
  };
}

function applyRaceWear(userId, params = {}) {
  const profile = getMutableAuthoritativeSparxProfile(userId);
  const requestedCarId = String(params.carId || params.id || params._id || '').trim();
  const resolvedRecord = resolveOwnedVehicleRecord(
    userId,
    requestedCarId,
    String(profile.CurrentVehicleTag || getDefaultProfileVehicleTag())
  );
  const assetTag = getAssetVehicleTag(
    firstDefined(
      resolvedRecord && (resolvedRecord.carId || resolvedRecord.car || (resolvedRecord.r && resolvedRecord.r.n)),
      profile.CurrentVehicleTag,
      getDefaultProfileVehicleTag()
    ),
    getDefaultProfileVehicleTag()
  );
  if (!profile.OwnedVehiclesStatus || typeof profile.OwnedVehiclesStatus !== 'object') {
    profile.OwnedVehiclesStatus = {};
  }
  if (!profile.OwnedVehiclesStatus[assetTag]) {
    profile.OwnedVehiclesStatus[assetTag] = createOwnedVehicleStatus(assetTag);
  }
  const status = profile.OwnedVehiclesStatus[assetTag];
  const clamp = (value) => Math.max(0.35, Math.min(1, Number(value || 1)));
  status.OilHealth = clamp(Number(status.OilHealth || 1) - 0.03);
  status.EngineHealth = clamp(Number(status.EngineHealth || 1) - 0.008);
  status.BodyworkHealth = clamp(Number(status.BodyworkHealth || 1) - 0.004);
  status.TyreHealth = (Array.isArray(status.TyreHealth) ? status.TyreHealth : [1, 1, 1, 1]).map((value) => clamp(Number(value || 1) - 0.01));
  status.BrakeHealth = (Array.isArray(status.BrakeHealth) ? status.BrakeHealth : [1, 1, 1, 1]).map((value) => clamp(Number(value || 1) - 0.008));
  const persistedRecord = getMutablePersistedCarRecord(userId, String((resolvedRecord && (resolvedRecord._id || resolvedRecord.id)) || requestedCarId || ''));
  if (persistedRecord && typeof persistedRecord === 'object') {
    persistedRecord.vehicleStatus = clone(status);
    persistedRecord.VehicleStatus = clone(status);
    persistedRecord.cond = buildOwnedVehicleCondition(assetTag, status);
  }
  const fuel = Math.max(0, Math.trunc(Number(profile.Fuel || profile.fuel || 0)) - 1);
  profile.Fuel = fuel;
  profile.fuel = fuel;
  const rootProfile = getProfile(userId);
  if (rootProfile && typeof rootProfile === 'object') {
    rootProfile.Fuel = fuel;
    rootProfile.fuel = fuel;
  }
  const sparx = ensureSparxState(userId);
  if (sparx && sparx.dataStore && sparx.dataStore.inventory && typeof sparx.dataStore.inventory === 'object') {
    sparx.dataStore.inventory.fuel = fuel;
  }
  persistState();
}

// levelrewards_levels: required by StyleBonusManager.Connect() → HandleServerData().
// Keys style1..style6 map to CAR_CLASS enum (ONE=1..SIX=6).
// Without these keys _styleBonuses[carClass]=null → GetAllStyleBonuses() returns null →
// SetData(null) skips _styleBonusLevelItems init → SetValue() NPE on _styleBonusLevelItems.Count.
// Providing empty arrays gives SetData a non-null arg → empty list → no NPE.
function buildLevelRewardsLevelsPayload() {
  return {
    style1: [],
    style2: [],
    style3: [],
    style4: [],
    style5: [],
    style6: []
  };
}

function buildGachaRefreshPayload(userId, ts) {
  const check = buildGachaRefreshSignature(userId);
  const catalog = buildShipyardCatalog(userId);
  const recommendedBox = catalog.boxes[0] || null;
  const gachaData = {
    groups: clone(catalog.groups),
    Groups: clone(catalog.groups),
    sets: clone(catalog.sets),
    Sets: clone(catalog.sets),
    boxes: clone(catalog.boxes),
    Boxes: clone(catalog.boxes),
    tokens: clone(catalog.tokens),
    Tokens: clone(catalog.tokens),
    freeTimes: clone(catalog.freeTimes),
    FreeTimes: clone(catalog.freeTimes),
    maxspins: 1,
    maxSpins: 1,
    MaxSpins: 1,
    maxCombinedSpins: 1,
    MaxCombinedSpins: 1,
    unclaimedBoxes: clone(catalog.unclaimedBoxes),
    UnclaimedBoxes: clone(catalog.unclaimedBoxes),
    gachaRecommendationData: recommendedBox ? {
      gt: 2,
      gsn: SHIPYARD_SET_ID,
      Gsn: SHIPYARD_SET_ID,
      box: recommendedBox.box,
      Box: recommendedBox.Box,
      prize: clone((recommendedBox.PossiblePrizes || [])[0] || null),
      Prize: clone((recommendedBox.PossiblePrizes || [])[0] || null)
    } : {},
    gachaToken: String(firstDefined(recommendedBox && (recommendedBox.token || recommendedBox.Token), SHIPYARD_GACHA_TOKEN))
  };
  return {
    check,
    refresh: 3600,
    gacha: gachaData
  };
}

function buildGameStoreOrders(params = {}) {
  const orders = [];
  if (Array.isArray(params.items)) {
    orders.push(...params.items);
  } else if (params.items && typeof params.items === 'object') {
    orders.push(...Object.values(params.items));
  }
  const grouped = {};
  Object.keys(params || {}).forEach((key) => {
    const match = key.match(/^items\.(\d+)\.(.+)$/i);
    if (!match) {
      return;
    }
    const index = Number(match[1]);
    if (!grouped[index]) {
      grouped[index] = {};
    }
    grouped[index][match[2]] = params[key];
  });
  Object.keys(grouped).sort((left, right) => Number(left) - Number(right)).forEach((index) => {
    orders.push(grouped[index]);
  });
  if (orders.length <= 0) {
    orders.push(params);
  }
  return orders
    .map((entry) => ({
      versionId: String(firstDefined(entry && entry.version_id, entry && entry.versionId, '') || ''),
      setId: String(firstDefined(entry && entry.set_id, entry && entry.setId, entry && entry.si, '') || ''),
      pricingId: String(firstDefined(entry && entry.pricing_id, entry && entry.pricingId, entry && entry.pi, entry && entry.id, '') || ''),
      quantity: Math.max(1, Math.trunc(Number(firstDefined(entry && entry.quantity, entry && entry.q, 1) || 1)))
    }))
    .filter((entry) => entry.pricingId);
}

function buildGameStoreRefreshPayload(userId, options = {}) {
  const catalog = buildShipyardCatalog(userId);
  const visualUpgradeEntries = buildVisualUpgradeTuningEntries();
  const versionId = 'ff7-local-gamestore-v18';
  const gameStoreItems = [];
  const packages = catalog.boxes.map((box) => ({
    id: box.box,
    Id: box.Box,
    versionId: versionId,
    VersionID: versionId,
    title: box.displayName,
    Title: box.DisplayName,
    cost: Number((box.hc && box.hc.cost) || (box.sc && box.sc.cost) || 0),
    Cost: Number((box.hc && box.hc.cost) || (box.sc && box.sc.cost) || 0),
    ct: Number((box.hc && box.hc.cost) || (box.sc && box.sc.cost) || 0),
    buy: { ct: Number((box.hc && box.hc.cost) || (box.sc && box.sc.cost) || 0) },
    Buy: { ct: Number((box.hc && box.hc.cost) || (box.sc && box.sc.cost) || 0) },
    pricingId: String(box.token || box.Token || box.box || box.Box || ''),
    PricingID: String(box.token || box.Token || box.box || box.Box || ''),
    setId: SHIPYARD_SET_ID,
    SetID: SHIPYARD_SET_ID,
    box: box.box,
    Box: box.Box
  }));
  const purchasablePackages = [];
  const visualUpgradePackages = [];
  const seenPackageIds = new Set();
  const addGameStoreItem = (item, category, options = {}) => {
    const itemId = String(item && (item.itemTag || item.id || item.name) || '').trim();
    if (!itemId) {
      return;
    }
    const title = String(item && (item.title || item.itemTitle || item.itemTag || itemId) || itemId);
    const image = String(options.image || (item && (item.image || item.thumbnail || item.iconPath)) || '').trim();
    const pricingId = String(options.pricingId || itemId);
    const setId = normalizeGameStoreSetId(options.setId || category || 'garage') || 'garage';
    const buyQuantity = Math.max(0, Math.trunc(Number(options.buyQuantity != null ? options.buyQuantity : ((item && (item.starCost || item.coinCost || 0)) || 0))));
    const buyData = String(options.buyData || ((((item && item.starCost) || 0) > 0) ? 'hc' : 'sc'));
    const priceRedeemer = buyQuantity > 0 ? [{ type: 'res', data: buyData, quantity: buyQuantity }] : [];
    const pricing = {
      version_id: versionId,
      versionId: versionId,
      VersionID: versionId,
      set_id: setId,
      pricing_id: pricingId,
      bonus: [],
      buy: clone(priceRedeemer),
      sell: [],
      sale: [],
      expiry: -1,
      tags: [],
      si: setId,
      pi: pricingId,
      b: clone(priceRedeemer),
      s: [],
      a: clone(priceRedeemer),
      u: [],
      g: [],
      t: []
    };
    gameStoreItems.push({
      enabled: true,
      version_id: versionId,
      versionId: versionId,
      VersionID: versionId,
      n: itemId,
      Name: itemId,
      id: itemId,
      itemTag: itemId,
      name: itemId,
      category: category || 'garage',
      Category: category || 'garage',
      t: title,
      Title: title,
      title,
      desc: String(options.description || ''),
      d: String(options.description || ''),
      Description: String(options.description || ''),
      description: String(options.description || ''),
      i: image,
      Image: image,
      image,
      images3: false,
      i3: false,
      pricings: [clone(pricing)],
      p: [pricing],
      redeemers: Array.isArray(options.redeemers) ? clone(options.redeemers) : [],
      r: Array.isArray(options.redeemers) ? clone(options.redeemers) : [],
      verifyredeem: false,
      e: true,
      vr: false
    });
  };
  const addPackage = (item) => {
    if (!item || !item.itemTag || seenPackageIds.has(item.itemTag)) {
      return;
    }
    seenPackageIds.add(item.itemTag);
    const cost = Number(item.starCost || item.coinCost || 0);
    purchasablePackages.push({
      id: item.itemTag,
      Id: item.itemTag,
      title: String(item.title || item.itemTitle || item.itemTag),
      Title: String(item.title || item.itemTitle || item.itemTag),
      cost,
      Cost: cost,
      buy: { ct: cost },
      Buy: { ct: cost },
      pricingId: item.itemTag,
      PricingID: item.itemTag,
      setId: 'garage',
      SetID: 'garage',
      itemTag: item.itemTag,
      ItemTag: item.itemTag
    });
    addGameStoreItem(item, 'garage');
  };
  const getVisualUpgradeCoinCost = (entry) => {
    const category = String(entry && (entry.visualUpgradeSubCategoryName || entry.scn || '') || '').toLowerCase();
    if (category.includes('paint') || category.includes('lensflare')) return 400;
    if (category.includes('rim') || category.includes('spoiler')) return 650;
    if (category.includes('bodykit')) return 900;
    return 500;
  };
  const addVisualUpgradePackage = (entry) => {
    const visualUpgradeName = String((entry && (entry.id || entry.visualUpgradeName)) || '').trim();
    if (!visualUpgradeName || seenPackageIds.has(`vu:${visualUpgradeName}`)) {
      return;
    }
    seenPackageIds.add(`vu:${visualUpgradeName}`);
    const cost = getVisualUpgradeCoinCost(entry);
    const title = String((entry && (entry.uin || entry.visualUpgradeUIName)) || visualUpgradeName);
    const icon = String((entry && (entry.ip || entry.visualUpgradeUIIconPath)) || '');
    visualUpgradePackages.push({
      id: visualUpgradeName,
      Id: visualUpgradeName,
      title,
      Title: title,
      cost,
      Cost: cost,
      buy: { ct: cost },
      Buy: { ct: cost },
      pricingId: visualUpgradeName,
      PricingID: visualUpgradeName,
      setId: 'visual_upgrades',
      SetID: 'visual_upgrades',
      itemTag: visualUpgradeName,
      ItemTag: visualUpgradeName
    });
    addGameStoreItem({
      itemTag: visualUpgradeName,
      title,
      image: icon,
      coinCost: cost,
      starCost: 0
    }, 'visual_upgrades', {
      image: icon,
      setId: 'visual_upgrades',
      pricingId: visualUpgradeName,
      buyQuantity: cost,
      buyData: 'sc'
    });
    addGameStoreItem({
      itemTag: `${visualUpgradeName}_item`,
      title: `${title} Item`,
      image: icon,
      coinCost: 0,
      starCost: 0
    }, 'visual_upgrades', {
      image: icon,
      setId: 'visual_upgrades',
      pricingId: `${visualUpgradeName}_item`,
      buyQuantity: 0,
      buyData: 'sc'
    });
  };
  defaultPurchasables.forEach(addPackage);
  Object.values(defaultVehiclePurchasablesByVehicle || {}).forEach((items) => {
    (Array.isArray(items) ? items : []).forEach(addPackage);
  });
  visualUpgradeEntries.forEach(addVisualUpgradePackage);
  catalog.boxes.forEach((box) => {
    const hardCost = Number((box.hc && box.hc.cost) || 0);
    const softCost = Number((box.sc && box.sc.cost) || 0);
    addGameStoreItem({
      itemTag: String(box.token || box.Token || box.box || box.Box || ''),
      title: String(box.displayName || box.DisplayName || box.box || ''),
      image: String(box.closedimg || box.openimg || box.icon || box.image || '')
    }, 'shipyard', {
      setId: 'shipyard',
      pricingId: String(box.token || box.Token || box.box || box.Box || ''),
      buyQuantity: hardCost > 0 ? hardCost : softCost,
      buyData: hardCost > 0 ? 'hc' : 'sc',
      image: String(box.closedimg || box.openimg || box.icon || box.image || ''),
      redeemers: [
        {
          type: 'gs',
          t: 'gs',
          data: String(box.token || box.Token || box.box || box.Box || ''),
          n: String(box.token || box.Token || box.box || box.Box || ''),
          quantity: 1,
          q: 1
        }
      ]
    });
  });
  const allPackages = packages.concat(purchasablePackages, visualUpgradePackages);
  const allStores = [
    {
      id: SHIPYARD_GROUP_ID,
      Id: SHIPYARD_GROUP_ID,
      title: 'THE SHIPYARD',
      Title: 'THE SHIPYARD',
      packages: packages.map((entry) => entry.id),
      Packages: packages.map((entry) => entry.Id)
    },
    {
      id: 'garage',
      Id: 'garage',
      title: 'GARAGE',
      Title: 'GARAGE',
      packages: purchasablePackages.map((entry) => entry.id),
      Packages: purchasablePackages.map((entry) => entry.Id)
    },
    {
      id: 'visual_upgrades',
      Id: 'visual_upgrades',
      title: 'VISUAL UPGRADES',
      Title: 'VISUAL UPGRADES',
      packages: visualUpgradePackages.map((entry) => entry.id),
      Packages: visualUpgradePackages.map((entry) => entry.Id)
    },
    {
      id: 'hurry_items',
      Id: 'hurry_items',
      title: 'HURRY ITEMS',
      Title: 'HURRY ITEMS',
      packages: [],
      Packages: []
    }
  ];
  const groupedItems = gameStoreItems.reduce((acc, entry) => {
    const category = String(entry && entry.category || 'garage');
    if (!acc[category]) {
      acc[category] = [];
    }
    acc[category].push(clone(entry));
    return acc;
  }, {});
  if (!groupedItems.shipyard) {
    groupedItems.shipyard = [];
  }
  if (groupedItems.base && groupedItems.shipyard.length === 0) {
    groupedItems.shipyard = clone(groupedItems.base);
  }
  if (!groupedItems.base && groupedItems.shipyard) {
    groupedItems.base = clone(groupedItems.shipyard);
  }
  const categoryHashes = Object.keys(groupedItems).sort().reduce((acc, category) => {
    acc[category] = crypto
      .createHash('md5')
      .update(JSON.stringify(groupedItems[category].map((entry) => ({ n: entry.n, p: entry.p, r: entry.r }))))
      .digest('hex');
    return acc;
  }, {});
  const check = `${versionId}^.${Object.keys(categoryHashes).sort().map((category) => `${category}|${categoryHashes[category]}`).join('.')}`;
  const setIdMap = {
    [SHIPYARD_SET_ID]: SHIPYARD_SET_ID,
    shipyard: SHIPYARD_SET_ID,
    garage: 'garage',
    visual_upgrades: 'visual_upgrades',
    hurry_items: 'hurry_items'
  };
  const flatItems = clone(gameStoreItems);
  const itemMap = flatItems.reduce((acc, entry) => {
    const itemId = String(firstDefined(entry && entry.n, entry && entry.id, '') || '').trim();
    if (itemId) {
      acc[itemId] = clone(entry);
    }
    return acc;
  }, {});
  const packageMap = allPackages.reduce((acc, entry) => {
    const packageId = String(firstDefined(entry && entry.id, entry && entry.Id, '') || '').trim();
    if (packageId) {
      acc[packageId] = clone(entry);
    }
    return acc;
  }, {});
  const basePayload = {
    version_id: versionId,
    versionId,
    VersionID: versionId,
    cdn: getPublicHttpBaseUrl(),
    tags: [],
    setIdMap: clone(setIdMap),
    SetIdMap: clone(setIdMap),
    hash: check,
    changed: true,
    refresh: true,
    check,
    stores: clone(allStores),
    Stores: clone(allStores),
    packages: clone(allPackages),
    Packages: clone(allPackages),
    packageMap: clone(packageMap),
    PackageMap: clone(packageMap),
    active: allPackages.map((entry) => entry.id),
    Active: allPackages.map((entry) => entry.id),
    pending: catalog.unclaimedBoxes.map((entry) => entry.id || entry.Id),
    Pending: catalog.unclaimedBoxes.map((entry) => entry.id || entry.Id)
  };
  if (options && options.partial) {
    return {
      ...basePayload,
      items: clone(flatItems),
      Items: clone(flatItems),
      itemMap: clone(itemMap),
      ItemMap: clone(itemMap),
      groupedItems: clone(groupedItems),
      GroupedItems: clone(groupedItems),
      data: {
        version_id: versionId,
        versionId,
        VersionID: versionId,
        cdn: getPublicHttpBaseUrl(),
        tags: [],
        setIdMap: clone(setIdMap),
        SetIdMap: clone(setIdMap),
        items: clone(flatItems),
        Items: clone(flatItems),
        itemMap: clone(itemMap),
        ItemMap: clone(itemMap),
        groupedItems: clone(groupedItems),
        GroupedItems: clone(groupedItems),
        stores: clone(allStores),
        Stores: clone(allStores),
        packages: clone(allPackages),
        Packages: clone(allPackages),
        packageMap: clone(packageMap),
        PackageMap: clone(packageMap),
        active: allPackages.map((entry) => entry.id),
        Active: allPackages.map((entry) => entry.id),
        pending: catalog.unclaimedBoxes.map((entry) => entry.id || entry.Id),
        Pending: catalog.unclaimedBoxes.map((entry) => entry.id || entry.Id)
      }
    };
  }
  return {
    ...basePayload,
    items: clone(gameStoreItems),
    Items: clone(gameStoreItems),
    itemMap: clone(itemMap),
    ItemMap: clone(itemMap),
    data: {
      version_id: versionId,
      versionId,
      VersionID: versionId,
      cdn: getPublicHttpBaseUrl(),
      tags: [],
      setIdMap: clone(setIdMap),
      SetIdMap: clone(setIdMap),
      items: clone(gameStoreItems),
      Items: clone(gameStoreItems),
      itemMap: clone(itemMap),
      ItemMap: clone(itemMap),
      groupedItems: clone(groupedItems),
      GroupedItems: clone(groupedItems),
      stores: clone(allStores),
      Stores: clone(allStores),
      packages: clone(allPackages),
      Packages: clone(allPackages),
      packageMap: clone(packageMap),
      PackageMap: clone(packageMap),
      active: allPackages.map((entry) => entry.id),
      Active: allPackages.map((entry) => entry.id),
      pending: catalog.unclaimedBoxes.map((entry) => entry.id || entry.Id),
      Pending: catalog.unclaimedBoxes.map((entry) => entry.id || entry.Id)
    }
  };
}

function findGameStoreCatalogEntry(userId, pricingId, setId = '') {
  const refreshPayload = buildGameStoreRefreshPayload(userId);
  const items = Array.isArray(refreshPayload && refreshPayload.items) ? refreshPayload.items : [];
  const normalizedPricingId = String(pricingId || '').trim();
  const normalizedSetId = normalizeGameStoreSetId(setId);
  const acceptableSetIds = new Set();
  if (normalizedSetId) {
    acceptableSetIds.add(normalizedSetId);
    acceptableSetIds.add(String(setId || '').trim().toLowerCase());
    if (normalizedSetId === SHIPYARD_SET_ID || String(setId || '').trim().toLowerCase() === 'shipyard') {
      acceptableSetIds.add('shipyard');
      acceptableSetIds.add(SHIPYARD_SET_ID);
    }
  }
  for (const entry of items) {
    const pricings = Array.isArray(entry && entry.p) ? entry.p : [];
    const match = pricings.find((pricing) => {
      const pricingMatch = String(pricing && pricing.pi || '') === normalizedPricingId;
      const pricingSetId = normalizeGameStoreSetId(pricing && pricing.si || '');
      const rawPricingSetId = String(pricing && pricing.si || '').trim().toLowerCase();
      const setMatch = !normalizedSetId || acceptableSetIds.has(pricingSetId) || acceptableSetIds.has(rawPricingSetId);
      return pricingMatch && setMatch;
    });
    if (match) {
      return { entry: clone(entry), pricing: clone(match) };
    }
  }
  return null;
}

function buildGameStoreFailureResult(userId, code = 'nsf') {
  return {
    success: false,
    successful: false,
    sucessful: false,
    error: code,
    localizedError: code
  };
}

function buildGameStoreBuyResult(userId, params = {}) {
  const orders = buildGameStoreOrders(params);
  const profile = getMutableAuthoritativeSparxProfile(userId);
  const redeemers = [];
  const boughtShipyardTokens = [];
  for (const order of orders) {
    const resolved = findGameStoreCatalogEntry(userId, order.pricingId, order.setId);
    if (!resolved) {
      return buildGameStoreFailureResult(userId, 'invalid_item');
    }
    const costs = Array.isArray(resolved.pricing && resolved.pricing.b) ? resolved.pricing.b : [];
    for (const cost of costs) {
      const currency = String(firstDefined(cost && cost.data, cost && cost.n, '') || '').trim().toLowerCase();
      const quantity = Math.max(0, Math.trunc(Number(firstDefined(cost && cost.quantity, cost && cost.q, 0) || 0))) * order.quantity;
      if (currency === 'hc') {
        const current = Math.max(0, Math.trunc(Number(profile.NoStars || profile.stars || 0)));
        if (current < quantity) return buildGameStoreFailureResult(userId, 'insufficient_hard_currency');
      } else if (currency === 'sc') {
        const current = Math.max(0, Math.trunc(Number(profile.NoCoins || profile.coins || 0)));
        if (current < quantity) return buildGameStoreFailureResult(userId, 'insufficient_non_hard_currency');
      }
    }
    for (const cost of costs) {
      const currency = String(firstDefined(cost && cost.data, cost && cost.n, '') || '').trim().toLowerCase();
      const quantity = Math.max(0, Math.trunc(Number(firstDefined(cost && cost.quantity, cost && cost.q, 0) || 0))) * order.quantity;
      if (currency === 'hc') {
        const next = Math.max(0, Math.trunc(Number(profile.NoStars || profile.stars || 0)) - quantity);
        profile.NoStars = next;
        profile.stars = next;
        profile.gold = next;
      } else if (currency === 'sc') {
        const next = Math.max(0, Math.trunc(Number(profile.NoCoins || profile.coins || 0)) - quantity);
        profile.NoCoins = next;
        profile.coins = next;
      }
    }
    const itemId = String(resolved.entry && resolved.entry.n || resolved.pricing && resolved.pricing.pi || '').trim();
    const category = String(resolved.entry && resolved.entry.category || '').trim();
    if (category === 'shipyard' || category === SHIPYARD_SET_ID) {
      addInventoryItemCount(userId, itemId, order.quantity);
      boughtShipyardTokens.push(itemId);
      redeemers.push({
        type: 'gs',
        t: 'gs',
        data: itemId,
        n: itemId,
        quantity: order.quantity,
        q: order.quantity
      });
    } else if (category === 'visual_upgrades') {
      const tokenItemId = itemId.endsWith('_item') ? itemId : `${itemId}_item`;
      addInventoryItemCount(userId, tokenItemId, order.quantity);
      redeemers.push({
        type: 'inv',
        t: 'inv',
        data: tokenItemId,
        n: tokenItemId,
        quantity: order.quantity,
        q: order.quantity
      });
    } else {
      const itemRedeemers = Array.isArray(resolved.entry && resolved.entry.r) ? resolved.entry.r : [];
      itemRedeemers.forEach((entry) => redeemers.push(clone(entry)));
    }
  }
  applyRedeemersToInventory(
    userId,
    redeemers.filter((entry) => String(firstDefined(entry && entry.type, entry && entry.t, '') || '').toLowerCase() === 'inv')
  );
  persistState();
  return {
    success: true,
    successful: true,
    sucessful: true,
    accepted: true,
    redeemers: clone(redeemers),
    Redeemers: clone(redeemers),
    inventory: buildFlatInventoryResult(userId),
    wallet: buildWalletResult(userId),
    resources: buildResourceResult(userId),
    token: boughtShipyardTokens[0] || '',
    Token: boughtShipyardTokens[0] || '',
    count: boughtShipyardTokens[0] ? getInventoryItemCount(userId, boughtShipyardTokens[0]) : 0,
    Count: boughtShipyardTokens[0] ? getInventoryItemCount(userId, boughtShipyardTokens[0]) : 0
  };
}

function buildGameStoreUseResult(userId, params = {}) {
  const orders = buildGameStoreOrders(params);
  const redeemers = [];
  orders.forEach((order) => {
    const resolved = findGameStoreCatalogEntry(userId, order.pricingId, order.setId);
    if (!resolved) {
      return;
    }
    const itemId = String(resolved.entry && resolved.entry.n || resolved.pricing && resolved.pricing.pi || '').trim();
    const category = String(resolved.entry && resolved.entry.category || '').trim();
    if ((category === 'shipyard' || category === SHIPYARD_SET_ID) && getInventoryItemCount(userId, itemId) > 0) {
      redeemers.push({
        type: 'gs',
        t: 'gs',
        data: itemId,
        n: itemId,
        quantity: 1,
        q: 1
      });
    } else if (category === 'visual_upgrades') {
      const tokenItemId = itemId.endsWith('_item') ? itemId : `${itemId}_item`;
      if (spendInventoryItemCount(userId, tokenItemId, order.quantity)) {
        redeemers.push({
          type: 'inv',
          t: 'inv',
          data: tokenItemId,
          n: tokenItemId,
          quantity: order.quantity,
          q: order.quantity
        });
      }
    }
  });
  return {
    success: true,
    successful: true,
    sucessful: true,
    accepted: true,
    redeemers: clone(redeemers),
    Redeemers: clone(redeemers)
  };
}

function normalizeStoredMessage(message, index = 0) {
  if (!message || typeof message !== 'object') {
    return null;
  }

  const normalized = {
    mid: String(message.mid || message.MessageID || `local_msg_${index + 1}`),
    mtype: String(message.mtype || 'mass_basic'),
    subject: String(message.subject || ''),
    short_subject: String(message.short_subject || message.ShortSubject || message.subject || ''),
    title: String(message.title || ''),
    cta: String(message.cta || ''),
    ctalbl: String(message.ctalbl || ''),
    ctabtn: String(message.ctabtn || ''),
    r: Math.max(0, Math.trunc(Number(message.r || 0))),
    e: Math.trunc(Number(message.e != null ? message.e : -1)),
    _ts: Math.max(0, Math.trunc(Number(message._ts || nowTs()))),
    body: String(message.body || '')
  };

  if (String(message.imageUrl || '').trim()) {
    normalized.imageUrl = String(message.imageUrl);
  }

  if (message.g && typeof message.g === 'object') {
    normalized.g = {
      items: Array.isArray(message.g.items) ? clone(message.g.items) : [],
      b: String(message.g.b || message.g.box || ''),
      curl: String(message.g.curl || message.g.claimUrl || ''),
      c: message.g.c != null ? Boolean(message.g.c) : Boolean(message.g.claimed)
    };
  }

  return normalized;
}

function buildInboxPayload(userId) {
  const sparx = ensureSparxState(userId);
  const messages = Array.isArray(sparx.messaging && sparx.messaging.messages)
    ? sparx.messaging.messages.map((entry, index) => normalizeStoredMessage(entry, index)).filter(Boolean)
    : [];
  const unreadCount = messages.reduce((count, entry) => count + (Number(entry.r || 0) > 0 ? 0 : 1), 0);

  return {
    cdn: getPublicHttpBaseUrl(),
    messages: clone(messages),
    messageData: clone(messages),
    unreadCount,
    messageCount: messages.length,
    messageState: {
      changed: false,
      unreadCount
    }
  };
}

function buildChatTokenPayload(userId) {
  const sparx = ensureSparxState(userId);
  const profile = getProfile(userId);
  const allianceState = ensureAllianceState(userId);
  const token = crypto
    .createHash('sha1')
    .update(`ff7-chat:${String(userId)}`)
    .digest('hex');
  const rooms = [
    {
      name: `global${CHAT_ROOM_POSTFIX}`,
      type: 'global',
      friendlyName: 'global'
    }
  ];
  if (allianceState && allianceState.alliance && allianceState.alliance.aid) {
    rooms.push({
      name: `${String(allianceState.alliance.aid)}${CHAT_ROOM_POSTFIX}`,
      type: 'alliance',
      friendlyName: String(allianceState.alliance.aid)
    });
  }

  return {
    token,
    authToken: token,
    uid: String(profile.uid || profile.id || userId),
    playerId: String(profile.playerId || profile.player_id || userId),
    friends: Array.isArray(sparx.chat && sparx.chat.friends) ? clone(sparx.chat.friends) : [],
    rooms,
    splitToken: CHAT_ROOM_SPLIT_TOKEN,
    roomPostfix: CHAT_ROOM_POSTFIX,
    chat_ban: clone((sparx.chat && sparx.chat.bans) || {}),
    max_friends: CHAT_MAX_FRIENDS,
    channelUrl: getPublicWsUrl(),
    secureChannelUrl: getPublicWssUrl(),
    url: getPublicWsUrl(),
    secure_url: getPublicWssUrl(),
    websocket: getPublicWsUrl(),
    websocket_secure: getPublicWssUrl(),
    authResponse: {
      authToken: token,
      token,
      channelUrl: getPublicWsUrl(),
      websocket: getPublicWsUrl(),
      websocket_secure: getPublicWssUrl(),
      connected: true,
      status: 'connected'
    }
  };
}

function updateChatFriends(userId, target, remove = false) {
  const sparx = ensureSparxState(userId);
  const normalizedTarget = String(target || '').trim();
  if (!normalizedTarget) {
    return {
      target: '',
      friends: Array.isArray(sparx.chat && sparx.chat.friends) ? clone(sparx.chat.friends) : []
    };
  }

  if (!Array.isArray(sparx.chat.friends)) {
    sparx.chat.friends = [];
  }

  if (remove) {
    sparx.chat.friends = sparx.chat.friends.filter((entry) => String(entry) !== normalizedTarget);
  } else if (sparx.chat.friends.indexOf(normalizedTarget) === -1) {
    sparx.chat.friends.push(normalizedTarget);
  }

  persistState();
  return {
    target: normalizedTarget,
    friends: clone(sparx.chat.friends)
  };
}

function markMessageRead(userId, messageId) {
  const sparx = ensureSparxState(userId);
  if (!Array.isArray(sparx.messaging.messages)) {
    sparx.messaging.messages = [];
  }

  const normalizedMessageId = String(messageId || '').trim();
  const now = nowTs();
  let updated = null;

  sparx.messaging.messages = sparx.messaging.messages.map((entry, index) => {
    const normalized = normalizeStoredMessage(entry, index);
    if (!normalized) return entry;
    if (normalized.mid !== normalizedMessageId) return normalized;
    normalized.r = now;
    updated = normalized;
    return normalized;
  });

  if (updated) {
    persistState();
    return updated;
  }

  return {
    mid: normalizedMessageId,
    mtype: 'mass_basic',
    subject: '',
    short_subject: '',
    title: '',
    cta: '',
    ctalbl: '',
    ctabtn: '',
    r: now,
    e: -1,
    _ts: now,
    body: ''
  };
}

function buildMessageRefreshPayload(userId) {
  const inbox = buildInboxPayload(userId);
  return {
    hash: 'local-message-v1',
    changed: true,
    refresh: true,
    check: 'uhtotallysecure',
    data: clone(inbox),
    cdn: inbox.cdn,
    messageState: clone(inbox.messageState),
    messages: clone(inbox.messages),
    messageData: clone(inbox.messageData),
    unreadCount: inbox.unreadCount
  };
}

function buildMotdRefreshPayload() {
  return {
    hash: 'local-motd-v1',
    changed: true,
    refresh: true,
    check: 'uhtotallysecure',
    data: {
      motdData: buildMotdStatus(),
      templates: buildMotdStatus().templates
    }
  };
}

function buildPrizesRefreshPayload(userId) {
  return {
    hash: 'local-prizes-v2',
    changed: true,
    refresh: true,
    check: 'uhtotallysecure',
    data: buildPrizesPayload(userId)
  };
}

function buildPushTokenPayload() {
  return {
    token: 'local_push_token',
    authToken: 'local_push_token',
    url: getPublicWsUrl(),
    secure_url: getPublicWssUrl(),
    websocket: getPublicWsUrl(),
    websocket_secure: getPublicWssUrl(),
    enabled: true,
    connected: true,
    status: 'connected',
    connectionState: 'connected'
  };
}

function buildRedeemerPayload() {
  return {
    redeemers: [],
    hash: 'local',
    changed: false,
    check: 'uhtotallysecure'
  };
}

function buildPerformanceUpgradesPayload(userId, params) {
  const profile = getAuthoritativeSparxProfile(userId);
  const sparx = ensureSparxState(userId);
  const activeTutorialRaceId = resolveActiveTutorialRaceId(sparx, String(params.raceId || params.ri || '').trim());
  const activeTutorialConfig = getTutorialRaceConfig(activeTutorialRaceId);
  const defaultTutorialCarId = String(activeTutorialConfig.playerCarId || '').trim();
  const requestedCarId = String(
    params.carId ||
    params.vehicleTag ||
    params.tag ||
    defaultTutorialCarId ||
    profile.CurrentVehicleTag ||
    getDefaultProfileVehicleTag()
  );
  const resolvedRecord = resolveOwnedVehicleRecord(
    userId,
    requestedCarId,
    defaultTutorialCarId || profile.CurrentVehicleTag || getDefaultProfileVehicleTag()
  );
  const resolvedVehicleReference = String(
    (resolvedRecord && (
      resolvedRecord.carId ||
      resolvedRecord.AssetTag ||
      resolvedRecord.assetTag ||
      resolvedRecord.CurrentVehicleTag ||
      resolvedRecord.currentVehicleTag ||
      (resolvedRecord.r && resolvedRecord.r.n) ||
      (resolvedRecord.recipe && resolvedRecord.recipe.n) ||
      (resolvedRecord.carData && (resolvedRecord.carData.carId || resolvedRecord.carData.CurrentVehicleTag))
    )) ||
    defaultTutorialCarId ||
    profile.CurrentVehicleTag ||
    getDefaultProfileVehicleTag()
  );
  const vehicleTag = remapGarageVehicleTag(resolvedVehicleReference, getTutorialGarageTag());
  const assetTag = getAssetVehicleTag(resolvedVehicleReference, getDefaultProfileVehicleTag());
  const resolvedRecordId = String(
    (resolvedRecord && (resolvedRecord._id || resolvedRecord.id)) ||
    params.activeCarId ||
    params.active_carid ||
    (sparx && sparx.dataStore && sparx.dataStore.profile && (
      sparx.dataStore.profile.activeCarId ||
      sparx.dataStore.profile.active_carid
    )) ||
    ''
  );

  if (!profile.OwnedVehiclesStatus || typeof profile.OwnedVehiclesStatus !== 'object') {
    profile.OwnedVehiclesStatus = {};
  }

  if (!profile.OwnedVehiclesStatus[assetTag]) {
    profile.OwnedVehiclesStatus[assetTag] = createOwnedVehicleStatus(assetTag);
    persistState();
  }

  const status = clone(profile.OwnedVehiclesStatus[assetTag] || {});
  const currentUpgrades = buildPerformanceUpgradeAttributeData(`perf_${assetTag}_base`);
  const ownedUpgrades = {};
  const effectiveCarRecordId = String(resolvedRecordId || requestedCarId || assetTag);
  const currentUpgradeStages = Math.max(
    0,
    ...PERFORMANCE_UPGRADE_CATEGORY_KEYS.map((categoryKey) => inferPerformanceUpgradeStage(status, categoryKey))
  );
  const maxUpgradeStages = 4;
  const maxUpgradeLevels = maxUpgradeStages * PERFORMANCE_UPGRADE_CATEGORY_KEYS.length;
  const currentUpgradeLevels = currentUpgradeStages * PERFORMANCE_UPGRADE_CATEGORY_KEYS.length;
  const upgradeInfo = buildPerformanceUpgradeInfo(effectiveCarRecordId, status);

  Object.keys(PERFORMANCE_CURRENT_KEYS).forEach((key) => {
    if (status[PERFORMANCE_CURRENT_KEYS[key]] != null) {
      currentUpgrades[key] = status[PERFORMANCE_CURRENT_KEYS[key]];
    }
  });

  Object.keys(PERFORMANCE_OWNED_KEYS).forEach((key) => {
    const value = status[PERFORMANCE_OWNED_KEYS[key]];
    ownedUpgrades[key] = Array.isArray(value) ? value.slice() : [];
  });

  return {
    carId: effectiveCarRecordId,
    requestedCarId,
    vehicleTag: assetTag,
    tag: assetTag,
    assetTag,
    activeCarId: effectiveCarRecordId,
    active_carid: effectiveCarRecordId,
    recordId: effectiveCarRecordId,
    connected: true,
    status: 'connected',
    maxUpgradeStages,
    currentUpgradeStages,
    maxUpgradeLevels,
    currentUpgradeLevels,
    currUpgrades: clone(currentUpgrades),
    upgradeInfo: clone(upgradeInfo),
    currentUpgrades,
    ownedUpgrades,
    performanceLadders: clone(defaultPerformanceLadders),
    PerformanceLadders: clone(defaultPerformanceLadders),
    purchasablePerformanceLadders: clone(defaultPerformanceLadders),
    tuningBundleLadders: clone(defaultTuningBundleLadders),
    TuningBundleLadders: clone(defaultTuningBundleLadders),
    purchasableTuningBundleLadders: clone(defaultTuningBundleLadders),
    carMetaData: buildCarMetaPayload(assetTag),
    CarMetaData: buildCarMetaPayload(assetTag),
    vehicleStatus: clone(status),
    VehicleStatus: clone(status),
    ...status
  };
}

function buildPerformanceUpgradesForCarsPayload(userId, params = {}) {
  const rawCarIds = String(params.carIds || params.carId || '')
    .split(',')
    .map((value) => String(value || '').trim())
    .filter(Boolean);
  const carUpgrades = rawCarIds.map((carId) => buildPerformanceUpgradesPayload(userId, { ...params, carId }));
  return {
    carUpgrades
  };
}

function buildProfilePayload(userId) {
  const profile = getAuthoritativeSparxProfile(userId);
  const levelRewardsStatus = buildLevelRewardsSummary(userId);
  const currentVehicleTag = remapGarageVehicleTag(
    profile.CurrentVehicleTag || getTutorialGarageTag(),
    getTutorialGarageTag()
  );
  const level = getNormalizedProfileLevel(profile);
  const xp = getNormalizedProfileXp(profile);
  const sc = Number(profile.NoCoins || profile.coins || 0);
  const hc = Number(profile.NoStars || profile.gold || 0);
  const fuel = Number(profile.Fuel || profile.fuel || 0);
  const maxFuel = Number(profile.MaxFuel || profile.maxFuel || 10);
  const legacyResources = buildResourceStatusMap(userId);
  return {
    uid: String(profile.uid || profile.id || userId),
    id: String(profile.id || profile.uid || userId),
    userId: String(profile.userId || profile.uid || userId),
    name: profile.name || profile.Nickname || `Player ${userId}`,
    Name: profile.name || profile.Nickname || `Player ${userId}`,
    rank: level,
    Rank: level,
    level,
    Level: level,
    playerLevel: level,
    PlayerLevel: level,
    xp,
    XP: xp,
    currentXP: Number(levelRewardsStatus.currentXP || xp),
    nextLevelXP: Number(levelRewardsStatus.nextLevelXP || 1000),
    rp: Number(levelRewardsStatus.rp || 0),
    respectPoints: Number(levelRewardsStatus.respectPoints || 0),
    levelRewards: clone(levelRewardsStatus.levelRewards || []),
    nextLevelRewards: clone(levelRewardsStatus.nextLevelRewards || []),
    prevLevelRewards: clone(levelRewardsStatus.prevLevelRewards || []),
    levelrewards: clone(levelRewardsStatus.levelrewards || {}),
    res: legacyResources,
    gamestats: buildGameStatsPayload(userId),
    car: currentVehicleTag,
    CurrentVehicleTag: currentVehicleTag,
    currentVehicleTag
  };
}

function buildRankedOpponent(userId, params) {
  const profile = getProfile(userId);
  return {
    raceId: params.raceId || '',
    carId: params.carId || '',
    opponent: {
      uid: 'ranked-rival-1',
      name: 'Ranked Rival',
      car: 'mx5_na',
      pi: 420
    },
    player: {
      uid: String(profile.uid || userId),
      car: profile.CurrentVehicleTag || getDefaultProfileVehicleTag()
    }
  };
}

function buildMatchPayload(userId, params = {}) {
  const profile = getAuthoritativeSparxProfile(userId);
  const sparx = ensureSparxState(userId);
  const playerUid = String(profile.uid || profile.id || profile.userId || userId || '1001');
  const playerName = sanitizeClientVisibleName(profile.name || profile.Nickname);
  const requestedRaceId = String(
    params.raceId ||
    params.ri ||
    params.rid ||
    params.race ||
    FF7_TUTORIAL_RACE_ID
  );
  const raceId = resolveActiveTutorialRaceId(sparx, requestedRaceId);
  const allRaceData = buildRaceData(userId);
  const raceEntry = allRaceData.find((entry) => String(entry.ri || '') === raceId) || allRaceData[0] || {};
  const tutorialRaceConfig = getTutorialRaceConfig(raceId);
  const isTutorialRace = Boolean(tutorialRaceConfig && tutorialRaceConfig.playerCarId);
  const requestedPlayerCarValue = getPreferredRacePlayerLookupValue(userId, params, profile);
  const resolvedOwnedPlayerRecord = (!isTutorialRace || Boolean(tutorialRaceConfig && tutorialRaceConfig.useSelectedPlayerCar))
    ? resolveOwnedVehicleRecord(
        userId,
        requestedPlayerCarValue,
        String(profile.CurrentVehicleTag || getDefaultProfileVehicleTag())
      )
    : null;
  const playerCarTag = isTutorialRace
    ? String(
        tutorialRaceConfig.useSelectedPlayerCar
          ? normalizeVehicleTag(
              firstDefined(
                requestedPlayerCarValue,
                profile.CurrentVehicleTag,
                profile.currentVehicleTag,
                getDefaultProfileVehicleTag()
              ),
              getDefaultProfileVehicleTag()
            )
          : (tutorialRaceConfig.playerCarId || FF7_TUTORIAL_PLAYER_CAR_ID)
      )
    : normalizeVehicleTag(
        firstDefined(
          resolvedOwnedPlayerRecord && (
            resolvedOwnedPlayerRecord.carId ||
            resolvedOwnedPlayerRecord.car ||
            resolvedOwnedPlayerRecord.AssetTag ||
            resolvedOwnedPlayerRecord.assetTag ||
            (resolvedOwnedPlayerRecord.r && resolvedOwnedPlayerRecord.r.n) ||
            (resolvedOwnedPlayerRecord.recipe && resolvedOwnedPlayerRecord.recipe.n)
          ),
          requestedPlayerCarValue,
          profile.CurrentVehicleTag
        ),
        String(profile.CurrentVehicleTag || getDefaultProfileVehicleTag())
      );
  const fallbackPlayerCar = (!isTutorialRace && resolvedOwnedPlayerRecord)
    ? buildPersistedOwnedCarRecord(userId, playerUid, resolvedOwnedPlayerRecord, 0, playerCarTag)
    : (isTutorialRace && tutorialRaceConfig.useSelectedPlayerCar && resolvedOwnedPlayerRecord)
      ? buildPersistedOwnedCarRecord(userId, playerUid, resolvedOwnedPlayerRecord, 0, playerCarTag)
    : buildOwnedCarRecord(playerCarTag, playerUid, 0);
  const playerCar = clone(
    (!isTutorialRace &&
      sparx &&
      sparx.dataStore &&
      sparx.dataStore.car &&
      sparx.dataStore.car.r &&
      (
        String(sparx.dataStore.car._id || sparx.dataStore.car.id || '') === String(fallbackPlayerCar._id || fallbackPlayerCar.id || '') ||
        String(sparx.dataStore.car.carId || '') === String(fallbackPlayerCar.carId || '')
      ))
      ? sparx.dataStore.car
      : fallbackPlayerCar
  );
  const tutorialRaceOptions = {};
  const compactPlayerCar = buildMatchCarRecord(playerCar, playerUid, tutorialRaceOptions);
  const opponentUid = String(params.oppUid || params.opponentUid || `opponent-${raceId}`);
  const soloRace = Boolean(!isTutorialRace && raceEntry && raceEntry.solo);
  const opponentName = soloRace ? '' : String(raceEntry.on || params.opponentName || 'Street Rival');
  const opponentCarTag = soloRace
    ? ''
    : String(
        isTutorialRace
          ? (
              pickDeterministicVariant(
                `${String(userId || profile && (profile.uid || profile.id) || playerUid)}:${raceId}`,
                tutorialRaceConfig.opponentCarPool,
                tutorialRaceConfig.opponentCarId || FF7_TUTORIAL_OPPONENT_CAR_ID
              ) || FF7_TUTORIAL_OPPONENT_CAR_ID
            )
          : (raceEntry.oc || params.opponentCarId || 'mx5_na')
      );
  const opponentCar = soloRace ? null : buildOwnedCarRecord(opponentCarTag, opponentUid, 0);
  const compactOpponentCar = soloRace ? null : buildMatchCarRecord(opponentCar, opponentUid, tutorialRaceOptions);
  const trafficRecords = (isTutorialRace
    ? (Array.isArray(tutorialRaceConfig.trafficCarIds) ? tutorialRaceConfig.trafficCarIds : [])
    : (Array.isArray(raceEntry.trafficCarIds) ? raceEntry.trafficCarIds : []))
    .map((tag, index) => buildOwnedCarRecord(tag, `${playerUid}-traffic-${index + 1}`, index));
  const policeRecords = (isTutorialRace
    ? (Array.isArray(tutorialRaceConfig.policeCarIds) ? tutorialRaceConfig.policeCarIds : [])
    : (Array.isArray(raceEntry.policeCarIds) ? raceEntry.policeCarIds : []))
    .map((tag, index) => buildOwnedCarRecord(tag, `${playerUid}-police-${index + 1}`, index));
  const compactTrafficRecords = trafficRecords.map((record, index) => buildMatchCarRecord(record, `${playerUid}-traffic-${index + 1}`, tutorialRaceOptions));
  const compactPoliceRecords = policeRecords.map((record, index) => buildMatchCarRecord(record, `${playerUid}-police-${index + 1}`, tutorialRaceOptions));
  const racePlayerCar = clone(compactPlayerCar);
  const raceOpponentCar = clone(compactOpponentCar);
  const raceTrafficRecords = compactTrafficRecords.map((record) => clone(record));
  const racePoliceRecords = compactPoliceRecords.map((record) => clone(record));
  const matchCars = [
    clone(racePlayerCar),
    ...(raceOpponentCar ? [clone(raceOpponentCar)] : []),
    ...raceTrafficRecords.map((record) => clone(record)),
    ...racePoliceRecords.map((record) => clone(record))
  ];
  const trafficCarIds = trafficRecords.map((record) => record.carId);
  const policeCarIds = policeRecords.map((record) => record.carId);
  const trafficCarPrefabs = trafficRecords.map((record) => getPrefabPath(record));
  const policeCarPrefabs = policeRecords.map((record) => getPrefabPath(record));
  const defaultPolicePrefab = policeCarPrefabs.length > 0 ? policeCarPrefabs[0] : '';
  const matchCarsById = {};
  matchCars.forEach((record) => {
    indexCarRecord(matchCarsById, record);
  });
  const trafficLevelLabel = getTrafficLevelLabel(isTutorialRace ? tutorialRaceConfig : null, raceTrafficRecords.length);
  const needsVsOpponent = soloRace && String(raceEntry && raceEntry.rt || '') === 'drift';
  const displayOpponentTag = needsVsOpponent
    ? String(
        firstDefined(
          raceEntry && (raceEntry.vsOpponentCarId || raceEntry.oc || raceEntry.OpponentCar || raceEntry.opponentCar),
          racePlayerCar && racePlayerCar.carId,
          playerCarTag,
          'honda_civic_euro_2012'
        ) || 'honda_civic_euro_2012'
      )
    : '';
  const displayOpponentCar = (!compactOpponentCar && displayOpponentTag)
    ? buildMatchCarRecord(buildOwnedCarRecord(displayOpponentTag, `${opponentUid}-vs`, 0), `${opponentUid}-vs`, tutorialRaceOptions)
    : compactOpponentCar;
  const opponentPi = needsVsOpponent
    ? Number(raceEntry.pr || 250)
    : (soloRace ? 0 : Number(raceEntry.opi || raceEntry.oph || 280));
  const matchId = String(params.matchId || params.mid || `match_${nowTs()}_${opponentUid}`);
  const racePlayerMeta =
    (racePlayerCar && (racePlayerCar.CarMetaData || racePlayerCar.carMetaData || racePlayerCar.MetaData || racePlayerCar.metadata)) ||
    compactPlayerCar.CarMetaData ||
    buildMatchCarMeta(racePlayerCar.carId || playerCarTag);
  const raceOpponentMeta =
    (
      raceOpponentCar &&
      (
        raceOpponentCar.CarMetaData ||
        raceOpponentCar.carMetaData ||
        raceOpponentCar.MetaData ||
        raceOpponentCar.metadata
      )
    ) ||
    (displayOpponentCar && displayOpponentCar.CarMetaData) ||
    ((soloRace && !needsVsOpponent) ? null : buildMatchCarMeta((displayOpponentCar && displayOpponentCar.carId) || (raceOpponentCar && raceOpponentCar.carId) || opponentCarTag || displayOpponentTag));
  const raceCarsContainer = buildRaceCarsContainer(
    racePlayerCar,
    raceOpponentCar,
    Number(raceEntry.pr || 250),
    opponentPi
  );
  if (!isTutorialRace) {
    const resolvedCurrentTag = String(racePlayerCar.carId || playerCarTag || '').trim();
    const resolvedCurrentCarId = String(racePlayerCar._id || racePlayerCar.id || '').trim();
    const resolvedActiveRecipe = Number((racePlayerCar.r && racePlayerCar.r.hash) || 0);
    if (resolvedCurrentTag) {
      profile.CurrentVehicleTag = resolvedCurrentTag;
      profile.currentVehicleTag = resolvedCurrentTag;
    }
    if (resolvedCurrentCarId) {
      profile.active_carid = resolvedCurrentCarId;
      profile.activeCarId = resolvedCurrentCarId;
      profile.lastRequestedCarId = resolvedCurrentCarId;
      profile.LastRequestedCarId = resolvedCurrentCarId;
    }
    if (resolvedActiveRecipe) {
      profile.active_recipe = resolvedActiveRecipe;
    }
    if (sparx && sparx.dataStore && typeof sparx.dataStore === 'object') {
      if (!sparx.dataStore.profile || typeof sparx.dataStore.profile !== 'object') {
        sparx.dataStore.profile = {};
      }
      if (resolvedCurrentTag) {
        sparx.dataStore.profile.CurrentVehicleTag = resolvedCurrentTag;
        sparx.dataStore.profile.currentVehicleTag = resolvedCurrentTag;
      }
      if (resolvedCurrentCarId) {
        sparx.dataStore.profile.active_carid = resolvedCurrentCarId;
        sparx.dataStore.profile.activeCarId = resolvedCurrentCarId;
        sparx.dataStore.profile.lastRequestedCarId = resolvedCurrentCarId;
        sparx.dataStore.profile.LastRequestedCarId = resolvedCurrentCarId;
      }
      if (resolvedActiveRecipe) {
        sparx.dataStore.profile.active_recipe = resolvedActiveRecipe;
      }
      sparx.dataStore.car = clone(racePlayerCar);
    }
    persistState();
  }
  let resolvedRace = Object.assign({}, clone(raceEntry), {
    CurrentVehicleTag: racePlayerCar.carId,
    currentVehicleTag: racePlayerCar.carId,
    activeCarId: racePlayerCar._id,
    active_carid: racePlayerCar._id,
    active_recipe: Number((racePlayerCar.r && racePlayerCar.r.hash) || 0),
    pc: racePlayerCar.carId,
    PlayerCar: racePlayerCar.carId,
    playerCar: racePlayerCar.carId,
    PlayerCarId: racePlayerCar.carId,
    playerCarId: racePlayerCar.carId,
    PlayerCarRecipe: clone(racePlayerCar.r),
    playerCarRecipe: clone(racePlayerCar.r),
    PlayerCarMetaData: clone(racePlayerMeta),
    playerCarMetaData: clone(racePlayerMeta),
    oc: displayOpponentCar ? displayOpponentCar.carId : '',
    OpponentCar: displayOpponentCar ? displayOpponentCar.carId : '',
    opponentCar: displayOpponentCar ? displayOpponentCar.carId : '',
    OpponentCarId: displayOpponentCar ? displayOpponentCar.carId : '',
    opponentCarId: displayOpponentCar ? displayOpponentCar.carId : '',
    OpponentCarRecipe: clone(displayOpponentCar && displayOpponentCar.r),
    opponentCarRecipe: clone(displayOpponentCar && displayOpponentCar.r),
    OpponentCarMetaData: clone(raceOpponentMeta),
    opponentCarMetaData: clone(raceOpponentMeta),
    PlayerCarData: clone(racePlayerCar),
    playerCarData: clone(racePlayerCar),
    OpponentCarData: clone(displayOpponentCar),
    opponentCarData: clone(displayOpponentCar),
    player: clone(raceCarsContainer.player),
    opponent: clone(raceCarsContainer.opponent),
    pv: buildRaceVuString(racePlayerCar),
    ppu: clone(racePlayerCar.pu || buildRacePerformanceUpgradePayload(racePlayerCar.vehicleStatus || racePlayerCar.VehicleStatus || {})),
    pup: clone(racePlayerCar.up || buildRaceUpgradePayload(racePlayerCar.vehicleStatus || racePlayerCar.VehicleStatus || {})),
    trafficCarsDisabled: raceTrafficRecords.length === 0,
    trafficCars: trafficCarIds.slice(),
    trafficCarIds: trafficCarIds.slice(),
    trafficVehiclePrefabList: trafficCarPrefabs.slice(),
    trafficCarData: raceTrafficRecords.map((record) => clone(record)),
    TrafficCarData: raceTrafficRecords.map((record) => clone(record)),
    aiTrafficVehicles: raceTrafficRecords.map((record) => clone(record)),
    AiTrafficVehicles: raceTrafficRecords.map((record) => clone(record)),
    policeCars: policeCarIds.slice(),
    policeCarIds: policeCarIds.slice(),
    policeCarPrefabList: policeCarPrefabs.slice(),
    PoliceCarPrefabList: policeCarPrefabs.slice(),
    policeCarData: racePoliceRecords.map((record) => clone(record)),
    PoliceCarData: racePoliceRecords.map((record) => clone(record)),
    policeCarPool: racePoliceRecords.map((record) => clone(record)),
    PoliceCarPool: racePoliceRecords.map((record) => clone(record)),
    policeCarPath: defaultPolicePrefab,
    PoliceCarPath: defaultPolicePrefab,
    policeCarPrefab: defaultPolicePrefab,
    ov: displayOpponentCar ? buildRaceVuString(displayOpponentCar) : '',
    opu: clone(displayOpponentCar ? (displayOpponentCar.pu || buildRacePerformanceUpgradePayload(displayOpponentCar.vehicleStatus || displayOpponentCar.VehicleStatus || {})) : {}),
    oup: clone(displayOpponentCar ? (displayOpponentCar.up || buildRaceUpgradePayload(displayOpponentCar.vehicleStatus || displayOpponentCar.VehicleStatus || {})) : {}),
    cars: clone(raceCarsContainer),
    carRecords: clone(matchCars),
    CarsArray: clone(matchCars),
    carsById: clone(matchCarsById)
  });
  [
    'carRecords',
    'CarsArray',
    'carsById',
    'cars',
    'player',
    'opponent',
    'PlayerCarData',
    'playerCarData',
    'OpponentCarData',
    'opponentCarData',
    'PlayerCar',
    'playerCar',
    'PlayerCarId',
    'playerCarId',
    'PlayerCarRecipe',
    'playerCarRecipe',
    'PlayerCarMetaData',
    'playerCarMetaData',
    'OpponentCar',
    'opponentCar',
    'OpponentCarId',
    'opponentCarId',
    'OpponentCarRecipe',
    'opponentCarRecipe',
    'OpponentCarMetaData',
    'opponentCarMetaData',
    'CurrentVehicleTag',
    'currentVehicleTag',
    'activeCarId',
    'active_carid',
    'active_recipe',
    'pc',
    'pv',
    'ppu',
    'pup',
    'oc',
    'ov',
    'opu',
    'oup',
    'trafficCarsDisabled',
    'trafficCars',
    'trafficCarIds',
    'trafficCarData',
    'TrafficCarData',
    'trafficVehiclePrefabList',
    'aiTrafficVehicles',
    'AiTrafficVehicles',
    'policeCars',
    'policeCarIds',
    'policeCarPrefabList',
    'PoliceCarPrefabList',
    'policeCarData',
    'PoliceCarData',
    'policeCarPool',
    'PoliceCarPool'
  ].forEach((key) => {
    delete resolvedRace[key];
  });
  // FF7 2.1.0 story races read player/opponent car state from the nested
  // `cars.player/opponent` payload while loading the race. Stripping these
  // fields for non-tutorial races leaves RaceDB with empty car names and the
  // client crashes in SequenceAction_SpawnCar when it tries to build a recipe.
  logFf7Debug('matches/activate-match', {
    userId,
    raceId,
    race: compactRace(resolvedRace),
    requestedCarId: params.carId || null,
    currentVehicleTag: String(profile && (profile.CurrentVehicleTag || profile.currentVehicleTag) || ''),
    dataStoreActiveCarId: sparx && sparx.dataStore && sparx.dataStore.profile
      ? sparx.dataStore.profile.active_carid
      : null,
    playerCarId: playerCar ? String(playerCar._id || playerCar.id || '') : '',
    playerCarTag: playerCar ? String(playerCar.carId || playerCar.car || '') : '',
    opponentCarTag: opponentCar ? String(opponentCar.carId || opponentCar.car || '') : '',
    matchId
  });
  const playerUser = {
    uid: playerUid,
    userId: playerUid,
    id: playerUid,
    name: playerName,
    rp: Number(profile.rp || 0),
    rating: getNormalizedProfileLevel(profile),
    pi: Number(raceEntry.pr || 250)
  };
  const playerSummary = {
    ...clone(compactPlayerCar.CarMetaData || {}),
    uid: playerUid,
    userId: playerUid,
    id: compactPlayerCar.id,
    name: playerName,
    n: String(compactPlayerCar.carId || ''),
    rating: getNormalizedProfileLevel(profile),
    pi: Number(raceEntry.pr || 250),
    pu: clone(compactPlayerCar.pu || buildRacePerformanceUpgradePayload(compactPlayerCar.vehicleStatus || compactPlayerCar.VehicleStatus || {})),
    vu: buildRaceVuString(compactPlayerCar),
    up: clone(compactPlayerCar.up || buildRaceUpgradePayload(compactPlayerCar.vehicleStatus || compactPlayerCar.VehicleStatus || {})),
    car: compactPlayerCar.carId,
    carId: compactPlayerCar.carId,
    CurrentVehicleTag: compactPlayerCar.carId,
    currentVehicleTag: compactPlayerCar.carId,
    activeCarId: compactPlayerCar._id,
    active_carid: compactPlayerCar._id,
    active_recipe: Number((compactPlayerCar.r && compactPlayerCar.r.hash) || 0),
    recipe: clone(compactPlayerCar.r),
    r: clone(compactPlayerCar.r)
  };
  const opponentUser = {
    uid: opponentUid,
    userId: opponentUid,
    id: opponentUid,
    name: opponentName,
    rp: 0,
    rating: opponentPi,
    pi: opponentPi
  };
  const opponentSummary = displayOpponentCar
    ? {
        ...clone(displayOpponentCar.CarMetaData || {}),
        uid: opponentUid,
        userId: opponentUid,
        id: displayOpponentCar.id,
        name: opponentName,
        n: String(displayOpponentCar.carId || ''),
        rating: opponentPi,
        pi: opponentPi,
        pu: clone(displayOpponentCar.pu || buildRacePerformanceUpgradePayload(displayOpponentCar.vehicleStatus || displayOpponentCar.VehicleStatus || {})),
        vu: buildRaceVuString(displayOpponentCar),
        up: clone(displayOpponentCar.up || buildRaceUpgradePayload(displayOpponentCar.vehicleStatus || displayOpponentCar.VehicleStatus || {})),
        car: displayOpponentCar.carId,
        carId: displayOpponentCar.carId,
        CurrentVehicleTag: displayOpponentCar.carId,
        currentVehicleTag: displayOpponentCar.carId,
        activeCarId: displayOpponentCar._id,
        active_carid: displayOpponentCar._id,
        active_recipe: Number((displayOpponentCar.r && displayOpponentCar.r.hash) || 0),
        recipe: clone(displayOpponentCar.r),
        r: clone(displayOpponentCar.r)
      }
    : {};
  const raceRootFields = {
    ri: resolvedRace.ri,
    rc: resolvedRace.rc,
    rt: resolvedRace.rt,
    pr: resolvedRace.pr,
    clr: resolvedRace.clr,
    sim: resolvedRace.sim,
    dis: resolvedRace.dis,
    ti: resolvedRace.ti,
    de: resolvedRace.de,
    ric: resolvedRace.ric,
    rci: resolvedRace.rci,
    rde: resolvedRace.rde,
    brd: clone(resolvedRace.brd || []),
    obj: resolvedRace.obj,
    sn: resolvedRace.sn,
    sv: resolvedRace.sv,
    tl: resolvedRace.tl,
    okl: resolvedRace.okl,
    on: resolvedRace.on,
    oph: resolvedRace.oph,
    opmt: resolvedRace.opmt,
    opi: resolvedRace.opi,
    tm: resolvedRace.tm,
    pspd: resolvedRace.pspd,
    cspd: resolvedRace.cspd,
    md: resolvedRace.md,
    xw: resolvedRace.xw,
    xgtw: resolvedRace.xgtw,
    xl: resolvedRace.xl,
    upw: resolvedRace.upw,
    upgw: resolvedRace.upgw,
    upl: resolvedRace.upl,
    hc: resolvedRace.hc,
    ppti: resolvedRace.ppti,
    cr: resolvedRace.cr,
    gt: resolvedRace.gt,
    gb: resolvedRace.gb,
    scw: resolvedRace.scw,
    scl: resolvedRace.scl,
    pra: resolvedRace.pra
  };
  return applyStoryDialogueAliases({
    success: true,
    active: true,
    status: 'active',
    connected: true,
    matchId,
    match_id: matchId,
    mid: matchId,
    raceId,
    race_id: raceId,
    ...raceRootFields,
    ri: raceId,
    player: clone(playerSummary),
    match: {
      id: matchId,
      state: 'ready'
    },
    opponent: clone(opponentSummary),
    race: resolvedRace,
    cars: clone(raceCarsContainer),
    user: playerUser,
    CurrentVehicleTag: compactPlayerCar.carId,
    currentVehicleTag: compactPlayerCar.carId,
    activeCarId: compactPlayerCar._id,
    active_carid: compactPlayerCar._id,
    active_recipe: Number((compactPlayerCar.r && compactPlayerCar.r.hash) || 0),
    pc: compactPlayerCar.carId,
    PlayerCar: compactPlayerCar.carId,
    playerCar: compactPlayerCar.carId,
    PlayerCarId: compactPlayerCar.carId,
    playerCarId: compactPlayerCar.carId,
    PlayerCarRecipe: clone(compactPlayerCar.r),
    playerCarRecipe: clone(compactPlayerCar.r),
    PlayerCarMetaData: clone(compactPlayerCar.CarMetaData),
    playerCarMetaData: clone(compactPlayerCar.CarMetaData),
    pv: buildRaceVuString(compactPlayerCar),
    ppu: clone(compactPlayerCar.pu || buildRacePerformanceUpgradePayload(compactPlayerCar.vehicleStatus || compactPlayerCar.VehicleStatus || {})),
    pup: clone(compactPlayerCar.up || buildRaceUpgradePayload(compactPlayerCar.vehicleStatus || compactPlayerCar.VehicleStatus || {})),
    oc: displayOpponentCar ? displayOpponentCar.carId : '',
    OpponentCar: displayOpponentCar ? displayOpponentCar.carId : '',
    opponentCar: displayOpponentCar ? displayOpponentCar.carId : '',
    OpponentCarId: displayOpponentCar ? displayOpponentCar.carId : '',
    opponentCarId: displayOpponentCar ? displayOpponentCar.carId : '',
    OpponentCarRecipe: clone(displayOpponentCar && displayOpponentCar.r),
    opponentCarRecipe: clone(displayOpponentCar && displayOpponentCar.r),
    OpponentCarMetaData: clone(displayOpponentCar && displayOpponentCar.CarMetaData),
    opponentCarMetaData: clone(displayOpponentCar && displayOpponentCar.CarMetaData),
    ov: displayOpponentCar ? buildRaceVuString(displayOpponentCar) : '',
    opu: clone(displayOpponentCar ? (displayOpponentCar.pu || buildRacePerformanceUpgradePayload(displayOpponentCar.vehicleStatus || displayOpponentCar.VehicleStatus || {})) : {}),
    oup: clone(displayOpponentCar ? (displayOpponentCar.up || buildRaceUpgradePayload(displayOpponentCar.vehicleStatus || displayOpponentCar.VehicleStatus || {})) : {}),
    trafficCarsDisabled: raceTrafficRecords.length === 0,
    trafficCars: trafficCarIds.slice(),
    TrafficCars: trafficCarIds.slice(),
    trafficCarIds: trafficCarIds.slice(),
    TrafficCarIds: trafficCarIds.slice(),
    trafficVehiclePrefabList: trafficCarPrefabs.slice(),
    TrafficVehiclePrefabList: trafficCarPrefabs.slice(),
    aiTrafficVehiclePrefabs: trafficCarPrefabs.slice(),
    AiTrafficVehiclePrefabs: trafficCarPrefabs.slice(),
    trafficLevel: trafficLevelLabel,
    TrafficLevel: trafficLevelLabel,
    policeCars: policeCarIds.slice(),
    PoliceCars: policeCarIds.slice(),
    policeCarIds: policeCarIds.slice(),
    PoliceCarIds: policeCarIds.slice(),
    policeCarPrefabList: policeCarPrefabs.slice(),
    PoliceCarPrefabList: policeCarPrefabs.slice(),
    policeCarPath: defaultPolicePrefab,
    PoliceCarPath: defaultPolicePrefab,
    policeCarPrefab: defaultPolicePrefab,
    PoliceCarPrefab: defaultPolicePrefab,
    recipe: compactPlayerCar.r,
    opponentRecipe: compactOpponentCar ? compactOpponentCar.r : null,
    q: compactPlayerCar.q,
    rank: 1,
    score: 0,
    raceid: matchId,
    seed: nowTs(),
    session: {
      id: matchId,
      state: 'ready'
    }
  });
}

function handleDs(pathname, method, params, userId) {
  const match = pathname.match(/^\/ds\/([^/]+)(?:\/([^/]+))?$/);
  if (!match) return null;

  const dsUid = decodeURIComponent(match[1]);
  const key = match[2] ? decodeURIComponent(match[2]) : '';
  const sparx = ensureSparxState(userId);
  const dataStore = sparx.dataStore || (sparx.dataStore = buildDefaultDataStore(userId));

  if (method === 'POST') {
    const rootProfile = getProfile(userId);
    const incomingPatch = clone(params.data || params || {});
    const startupBranchId = getStartupPlayableTutorialBranchId(
      dataStore && dataStore.profile ? dataStore.profile : {}
    );
    if (startupBranchId === 'G1') {
      delete incomingPatch.cars;
      delete incomingPatch.car;
      if (incomingPatch.profile && typeof incomingPatch.profile === 'object') {
        [
          'CurrentVehicleTag',
          'currentVehicleTag',
          'OwnedVehicles',
          'OwnedVehiclesStatus',
          'active_carid',
          'activeCarId',
          'active_recipe'
        ].forEach((field) => {
          delete incomingPatch.profile[field];
        });
      }
    }
    if (key) {
      const target = dataStore[key] && typeof dataStore[key] === 'object' && !Array.isArray(dataStore[key])
        ? dataStore[key]
        : (dataStore[key] = {});
      mergeDeep(target, incomingPatch);
    } else {
      mergeDeep(dataStore, incomingPatch);
    }
    syncDataStoreProfileSelectedCar(dataStore, rootProfile);
    normalizeTutorialProgressionProfile(dataStore.profile);
    if (dataStore.profile && typeof dataStore.profile === 'object') {
      dataStore.profile.name = sanitizeClientVisibleName(dataStore.profile.name || dataStore.profile.Nickname);
    }
    ensureSparxState(userId);
    persistState();
    return wrapConnectedResult(clone(dataStore), Object.keys(dataStore || {}));
  }

  if (key && dataStore && typeof dataStore === 'object' && key in dataStore) {
    let value = clone(dataStore[key]);
    if (key === 'profile' && value && typeof value === 'object') {
      value.name = sanitizeClientVisibleName(value.name || value.Nickname);
    }
    if (key === 'cars') {
      value = sanitizeDataStoreCarsForClient(userId, dataStore);
    }
    const keys = value && typeof value === 'object' && !Array.isArray(value) ? Object.keys(value) : [];
    return wrapConnectedResult(value, keys);
  }

  if (dataStore && dataStore.profile && typeof dataStore.profile === 'object') {
    dataStore.profile.name = sanitizeClientVisibleName(dataStore.profile.name || dataStore.profile.Nickname);
  }
  if (!key && dsUid && String(dataStore.profile && dataStore.profile.uid) !== String(dsUid)) {
    dataStore.profile = dataStore.profile || {};
    dataStore.profile.uid = String(dsUid);
    dataStore.profile.name = sanitizeClientVisibleName(dataStore.profile.name);
    persistState();
  }

  return wrapConnectedResult(sanitizeDataStoreForClient(userId, dataStore), Object.keys(dataStore || {}));
}

function handleSparxApiRequest(pathname, method, params, userId) {
  const normalizedMethod = String(method || 'GET').toUpperCase();
  const normalizedPath = pathname.replace(/\/+$/, '') || '/';

  const dsResult = handleDs(normalizedPath, normalizedMethod, params, userId);
  if (dsResult) return { statusCode: 200, payload: dsResult };

  if (
    normalizedPath === '/tutorial/get-login-data'
  ) {
    const result = buildCompactTutorialActionResult(buildTutorialResult(userId));
    return {
      statusCode: 200,
      payload: wrapResultWithMirrors(result, getTutorialActionResponseKeys())
    };
  }

  if (
    normalizedPath === '/tutorial/start-branch' ||
    normalizedPath === '/tutorial/early-start-branch'
  ) {
    const result = buildCompactTutorialActionResult(startTutorialBranch(userId, params));
    return {
      statusCode: 200,
      payload: wrapResultWithMirrors(result, getTutorialActionResponseKeys())
    };
  }

  if (normalizedPath === '/tutorial/start-tutorial') {
    const requestedTid = String(params.tid || params.tutorialId || '').trim();
    const fullResult = updateTutorialState(userId, params, false);
    let result = buildCompactTutorialActionResult(fullResult);
    if (isContextualTutorialId(requestedTid)) {
      clearRacePayload(result);
      result = mergeTutorialMirrorIntoResult(
        result,
        requestedTid,
        requestedTid,
        getContextualTutorialMirrorState(fullResult, requestedTid)
      );
    }
    logFf7Debug('tutorial/start-tutorial', {
      userId,
      params: {
        tid: params.tid || params.tutorialId || null,
        bid: params.bid || params.branchId || null
      },
      profile: compactProfile(getProfile(userId))
    });
    return {
      statusCode: 200,
      payload: wrapResultWithMirrors(result, getTutorialActionResponseKeys())
    };
  }

  if (normalizedPath === '/tutorial/complete-tutorial') {
    const requestedTid = String(params.tid || params.tutorialId || '').trim();
    let result = updateTutorialState(userId, params, true);
    if (isContextualTutorialId(requestedTid)) {
      clearRacePayload(result);
      result = mergeTutorialMirrorIntoResult(
        result,
        requestedTid,
        requestedTid,
        getContextualTutorialMirrorState(result, requestedTid)
      );
    }
    logFf7Debug('tutorial/complete-tutorial', {
      userId,
      params: {
        tid: params.tid || params.tutorialId || null,
        bid: params.bid || params.branchId || null
      },
      profile: compactProfile(getProfile(userId))
    });
    return {
      statusCode: 200,
      payload: wrapResultWithMirrors(result, getTutorialActionResponseKeys())
    };
  }

  if (normalizedPath === '/wske/cert' && normalizedMethod === 'POST') {
    const result = buildWskeCertificateResult(userId);
    return { statusCode: 200, payload: wrapConnectedResult(result, Object.keys(result || {})) };
  }

  if (normalizedPath === '/wske/redeem' && normalizedMethod === 'POST') {
    return {
      statusCode: 200,
      payload: wrapResult({
        success: true,
        rewards: []
      })
    };
  }

  if (normalizedPath === '/wallet' || normalizedPath === '/wallet/balance') {
    const result = buildWalletResult(userId);
    return { statusCode: 200, payload: wrapConnectedResult(result, Object.keys(result || {})) };
  }

  if (normalizedPath === '/wallet' && normalizedMethod === 'POST') {
    const result = buildWalletResult(userId);
    return { statusCode: 200, payload: wrapConnectedResult(result, Object.keys(result || {})) };
  }

  if (normalizedPath === '/inventory') {
    const result = buildInventoryResult(userId);
    return { statusCode: 200, payload: wrapConnectedResult(result, Object.keys(result || {})) };
  }

  if (normalizedPath === '/resources/fetch' || normalizedPath === '/resources/unittest-add-resource') {
    const result = buildResourceResult(userId);
    return { statusCode: 200, payload: wrapConnectedResult(result, Object.keys(result || {})) };
  }

  if (normalizedPath === '/motd/status') {
    const result = buildMotdStatus();
    return { statusCode: 200, payload: wrapConnectedResult(result, Object.keys(result || {})) };
  }

  if (normalizedPath === '/levelrewards/fetch') {
    const result = buildLevelRewardsStatusMap(userId);
    return { statusCode: 200, payload: wrapConnectedResult(result, Object.keys(result || {})) };
  }

  if (normalizedPath === '/loginrewards/fetch') {
    const result = buildLoginRewards(userId);
    return { statusCode: 200, payload: wrapConnectedResult(result, Object.keys(result || {})) };
  }

  if (normalizedPath === '/loginrewards/claim') {
    const sparx = ensureSparxState(userId);
    sparx.loginRewards.canClaim = false;
    sparx.loginRewards.lastClaimTs = nowTs();
    persistState();
    const result = buildLoginRewards(userId);
    return { statusCode: 200, payload: wrapConnectedResult(result, Object.keys(result || {})) };
  }

  if (normalizedPath === '/events/refresh' || normalizedPath === '/events/get-leaderboard-page') {
    const result = buildEventsPayload();
    return { statusCode: 200, payload: wrapConnectedResult(result, Object.keys(result || {})) };
  }

  if (
    normalizedPath === '/prizes/claim' ||
    normalizedPath === '/prizes/claimall' ||
    normalizedPath.startsWith('/prizes/claimbox')
  ) {
    const result = claimPendingPrizeRecords(userId, params || {});
    return { statusCode: 200, payload: wrapConnectedResult(result, Object.keys(result || {})) };
  }

  if (normalizedPath === '/gacha/claimfree') {
    const result = claimShipyardFreeBox(userId, params || {});
    const payload = wrapConnectedResult(result, Object.keys(result || {}));
    console.log('[GACHA CLAIMFREE RESPONSE]', JSON.stringify(payload));
    return { statusCode: 200, payload };
  }

  if (normalizedPath === '/gacha/pick') {
    const result = claimShipyardBox(userId, params || {});
    // Let the tap/release finish before the drag-reveal screen comes in, otherwise
    // the new screen can consume the same touch and jump straight to the final reveal.
    sleepSync(1200);
    const payload = wrapConnectedResult(result, Object.keys(result || {}));
    console.log('[GACHA RESPONSE]', JSON.stringify(payload));
    return { statusCode: 200, payload };
  }

  if (normalizedPath === '/offers/getLoginData') {
    const result = { offers: [], active: [], pending: [] };
    return { statusCode: 200, payload: wrapConnectedResult(result, Object.keys(result)) };
  }

  if (normalizedPath === '/webview/configure') {
    const result = buildWebViewConfigureResult();
    return { statusCode: 200, payload: wrapConnectedResult(result, Object.keys(result)) };
  }

  if (
    normalizedPath === '/gamestats/get-login-data' ||
    normalizedPath === '/gamestats/check-login-achievements'
  ) {
    const result = buildGameStatsPayload(userId);
    return { statusCode: 200, payload: wrapConnectedResult(result, Object.keys(result || {})) };
  }

  if (
    normalizedPath === '/objectives/fetch' ||
    normalizedPath === '/objectives/report' ||
    normalizedPath === '/objectives/reset'
  ) {
    const result = buildObjectivesPayload();
    return { statusCode: 200, payload: wrapResult(result) };
  }

  if (normalizedPath === '/performance_upgrades/getUpgradesForSingleCar') {
    const result = buildPerformanceUpgradesPayload(userId, params || {});
    return { statusCode: 200, payload: wrapConnectedResult(result, Object.keys(result || {})) };
  }

  if (normalizedPath === '/performance_upgrades/getUpgradesForCars') {
    const result = buildPerformanceUpgradesForCarsPayload(userId, params || {});
    return { statusCode: 200, payload: wrapConnectedResult(result, Object.keys(result || {})) };
  }

  if (normalizedPath === '/performance_upgrades/purchasePartUpgrade') {
    const result = buildPerformanceUpgradeTransactionResult(userId, params || {}, 'part');
    return { statusCode: 200, payload: wrapConnectedResult(result, Object.keys(result || {})) };
  }

  if (normalizedPath === '/performance_upgrades/purchaseStageUpgrade') {
    const result = buildPerformanceUpgradeTransactionResult(userId, params || {}, 'stage');
    return { statusCode: 200, payload: wrapConnectedResult(result, Object.keys(result || {})) };
  }

  if (normalizedPath === '/performance_upgrades/carTuningData') {
    const result = buildCarTuningDataPayload();
    return {
      statusCode: 200,
      payload: wrapConnectedResult({
        dbHash: String(result.dbHash || params.dbHash || ''),
        tuningData: clone(result.tuningData || []),
        carTuningData: clone(result),
        result: clone(result)
      }, ['dbHash', 'tuningData', 'carTuningData', 'result'])
    };
  }

  if (normalizedPath === '/performance_upgrades/vuTuningData') {
    const result = buildVisualUpgradeTuningPayload();
    return {
      statusCode: 200,
      payload: wrapConnectedResult({
        dbHash: String(result.dbHash || params.dbHash || ''),
        tuningData: clone(result.tuningData || []),
        vuTuning: clone(result),
        result: clone(result)
      }, ['dbHash', 'tuningData', 'vuTuning', 'result'])
    };
  }

  if (normalizedPath === '/performance_upgrades/getMechanicStatus') {
    const result = {
      mechanicsData: buildMechanicsDataPayload(userId),
      inventory: buildFlatInventoryResult(userId),
      wallet: buildWalletResult(userId),
      resources: buildResourceResult(userId)
    };
    return { statusCode: 200, payload: wrapConnectedResult(result, Object.keys(result || {})) };
  }

  if (normalizedPath === '/performance_upgrades/purchaseCarRepair') {
    const result = buildRepairTransactionPayload(userId, params || {});
    return { statusCode: 200, payload: wrapConnectedResult(result, Object.keys(result || {})) };
  }

  if (normalizedPath === '/performance_upgrades/purchaseCarOil') {
    const result = buildOilTransactionPayload(userId, params || {});
    return { statusCode: 200, payload: wrapConnectedResult(result, Object.keys(result || {})) };
  }

  if (normalizedPath === '/performance_upgrades/hurryMechanicWork' || normalizedPath === '/performance_upgrades/hurryCarRepair') {
    const result = buildRepairTransactionPayload(userId, params || {});
    return { statusCode: 200, payload: wrapConnectedResult(result, Object.keys(result || {})) };
  }

  if (normalizedPath === '/performance_upgrades/salvageCar' || normalizedPath === '/performance_upgrades/salvageCars') {
    const result = buildSalvageTransactionPayload(userId, params || {});
    return { statusCode: 200, payload: wrapConnectedResult(result, Object.keys(result || {})) };
  }

  if (normalizedPath === '/performance/profile') {
    const result = buildPerformanceProfilePayload();
    return { statusCode: 200, payload: wrapConnectedResult(result, Object.keys(result)) };
  }

  if (normalizedPath === '/tuning') {
    const result = buildTuningPayload();
    return { statusCode: 200, payload: wrapResult(result) };
  }

  if (normalizedPath === '/autorefresh' || normalizedPath === '/autorefresh/') {
    const result = buildAutoRefreshIndexPayload();
    return { statusCode: 200, payload: wrapConnectedResult(result, Object.keys(result || {})) };
  }

  if (normalizedPath === '/autorefresh/grouprefresh') {
    const result = buildAutoRefreshGroupPayload(userId, params || {});
    return { statusCode: 200, payload: wrapConnectedResult(result, Object.keys(result || {})) };
  }

  if (normalizedPath.startsWith('/autorefresh/')) {
    if (normalizedPath === '/autorefresh/gacha/refresh') {
      const result = buildGachaRefreshPayload(userId);
      const incomingHash = String(firstDefined(params.hash, '') || '');
      const changed = incomingHash !== String(result.check || '');
      return {
        statusCode: 200,
        payload: wrapSparseConnectedResult(
          changed
            ? result
            : {
                check: result.check,
                refresh: result.refresh,
                changed: false
              },
          changed ? ['check', 'refresh', 'gacha'] : ['check', 'refresh', 'changed']
        )
      };
    }
    if (normalizedPath === '/autorefresh/gamestore/refresh') {
      const result = buildGameStoreRefreshPayload(userId, { partial: true });
      const incomingHash = String(firstDefined(params.hash, '') || '');
      const changed = incomingHash !== String(result.check || '');
      return {
        statusCode: 200,
        payload: wrapConnectedResult(
          changed
            ? {
                check: result.check,
                refresh: 3600,
                gamestore: result
              }
            : {
                check: result.check,
                refresh: 3600,
                changed: false
              },
          changed ? ['check', 'refresh', 'gamestore'] : ['check', 'refresh', 'changed']
        )
      };
    }
    if (normalizedPath === '/autorefresh/motd/refresh') {
      const result = buildMotdRefreshPayload();
      return { statusCode: 200, payload: wrapConnectedResult(result, Object.keys(result || {})) };
    }
    if (normalizedPath === '/autorefresh/message/refresh') {
      const result = buildMessageRefreshPayload(userId);
      return { statusCode: 200, payload: wrapConnectedResult(result, Object.keys(result || {})) };
    }
    if (normalizedPath === '/autorefresh/prizes/refresh') {
      const result = buildPrizesRefreshPayload(userId);
      return { statusCode: 200, payload: wrapConnectedResult(result, Object.keys(result || {})) };
    }
    if (normalizedPath === '/autorefresh/tutorialdata/refresh') {
      const tutorialResult = buildCompactTutorialActionResult(buildTutorialResult(userId));
      return {
        statusCode: 200,
        payload: wrapResultWithMirrors(tutorialResult, getTutorialActionResponseKeys())
      };
    }
    const result = buildAutoRefreshPayload();
    return { statusCode: 200, payload: wrapConnectedResult(result, Object.keys(result || {})) };
  }

  if (normalizedPath === '/push/token') {
    return {
      statusCode: 200,
      payload: wrapResultWithMirrors(buildPushTokenPayload(), [
        'token',
        'authToken',
        'url',
        'secure_url',
        'websocket',
        'websocket_secure',
        'enabled',
        'connected',
        'status',
        'connectionState'
      ])
    };
  }

  if (normalizedPath === '/chat/token') {
    const result = buildChatTokenPayload(userId);
    return { statusCode: 200, payload: wrapConnectedResult(result, Object.keys(result || {})) };
  }

  if (
    normalizedPath === '/gamestore/buy' ||
    normalizedPath === '/gamestore/purchase'
  ) {
    const result = buildGameStoreBuyResult(userId, params || {});
    return { statusCode: 200, payload: wrapConnectedResult(result, Object.keys(result || {})) };
  }

  if (
    normalizedPath === '/gamestore/use' ||
    normalizedPath === '/gamestore/claim'
  ) {
    const result = buildGameStoreUseResult(userId, params || {});
    return { statusCode: 200, payload: wrapConnectedResult(result, Object.keys(result || {})) };
  }

  if (normalizedPath === '/chat/inviteFriend') {
    const result = updateChatFriends(userId, params.target, false);
    return { statusCode: 200, payload: wrapConnectedResult(result, Object.keys(result || {})) };
  }

  if (normalizedPath === '/chat/removeFriend') {
    const result = updateChatFriends(userId, params.target, true);
    return { statusCode: 200, payload: wrapConnectedResult(result, Object.keys(result || {})) };
  }

  if (normalizedPath === '/messages/read') {
    const result = markMessageRead(userId, params.mid);
    return { statusCode: 200, payload: wrapConnectedResult(result, Object.keys(result || {})) };
  }

  if (normalizedPath === '/redeemer/refresh') {
    const result = buildRedeemerPayload();
    return { statusCode: 200, payload: wrapConnectedResult(result, Object.keys(result || {})) };
  }

  if (normalizedPath === '/racedb/completedRaces') {
    return { statusCode: 200, payload: wrapResult(buildCompletedRaces()) };
  }

  if (normalizedPath === '/racedb/get-login-data') {
    const result = buildRuntimeNextRacesPayload(userId);
    return {
      statusCode: 200,
      payload: wrapResultWithMirrors(result, ['raceData', 'chapterData', 'simMultipliers'])
    };
  }

  if (normalizedPath === '/racedb/nextRaces' || normalizedPath === '/racedb/allRaces') {
    const result = normalizedPath === '/racedb/allRaces'
      ? {
          raceData: buildCareerRaceData(null, userId).map((race) => applyStoryDialogueAliases(clone(race))),
          chapterData: buildCareerChapterData(userId),
          simMultipliers: {}
        }
      : (FF7_SKIP_TUTORIAL_TO_GARAGE
          ? buildEmptyNextRacesPayload()
          : buildRuntimeNextRacesPayload(userId));
    return {
      statusCode: 200,
      payload: wrapResultWithMirrors(result, ['raceData', 'chapterData', 'simMultipliers'])
    };
  }

  if (normalizedPath === '/racedb/IsRaceCompleted') {
    const raceIds = Array.isArray(params.raceIds) ? params.raceIds : [];
    return {
      statusCode: 200,
      payload: wrapResult({
        result: raceIds.map(() => false)
      })
    };
  }

  if (normalizedPath === '/racedb/raceCompleted') {
    const raceId = String(params.raceId || params.id || params.ri || '').trim();
    const careerArticle = getCareerArticleByRaceId(raceId);
    const rewardInfo = careerArticle
      ? buildCareerRaceRewards(careerArticle, Math.max(0, getCareerArticleList().findIndex((entry) => String(entry && entry.id || '') === raceId)))
      : buildCareerRaceRewards(null, 0);
    const compactProgressData = buildCompactResolveRaceProgressData(userId, raceId);
    return {
      statusCode: 200,
      payload: wrapResult({
        raceRewards: clone(rewardInfo),
        carCond: null,
        chapterData: compactProgressData.chapterData,
        raceData: compactProgressData.raceData
      })
    };
  }

  if (normalizedPath === '/rankedraces/findRankedOpponent') {
    return { statusCode: 200, payload: wrapResult(buildRankedOpponent(userId, params)) };
  }

  if (normalizedPath.startsWith('/rankedraces/')) {
    // Tüm ranked races endpoint'leri için güvenli boş veri dön
    // RankedRacesManager.UpdateCurrentLevelRewards() null'a erişmemeli
    const safeRankedLevel = {
      level: 1,
      currentXP: 0,
      nextLevelXP: 1000,
      respectPoints: 0,
      levelRewards: [],
      nextLevelRewards: [],
      prevLevelRewards: []
    };
    const result = {
      enabled: false,
      level: 1,
      currentXP: 0,
      respectPoints: 0,
      levelRewards: [],
      nextLevelRewards: [],
      prevLevelRewards: [],
      playerLevel: safeRankedLevel,
      levelData: safeRankedLevel,
      rankedData: safeRankedLevel,
      leaderboard: [],
      opponents: [],
      races: []
    };
    return { statusCode: 200, payload: wrapConnectedResult(result, Object.keys(result)) };
  }

  if (normalizedPath === '/matches/activate-match') {
    applyRaceWear(userId, params || {});
    return { statusCode: 200, payload: wrapResult(buildMatchPayload(userId, params)) };
  }

  if (
    normalizedPath === '/matches/deactivate-match' ||
    normalizedPath === '/matches/complete-match' ||
    normalizedPath === '/matches/current-match' ||
    normalizedPath === '/matches/get-active-match'
  ) {
    return { statusCode: 200, payload: wrapResult(buildMatchPayload(userId, params)) };
  }

  if (normalizedPath === '/matches/resolve-match') {
    const result = resolveMatchState(userId, params);
    return {
      statusCode: 200,
      payload: wrapResultWithMirrors(result, [
        'raceRewards',
        'progression',
        'profile',
        'inventory',
        'wallet',
        'resources',
        'gamestats',
        'levelrewards',
        'chapterData',
        'raceData'
      ])
    };
  }

  if (normalizedPath === '/store/offerurl') {
    return { statusCode: 200, payload: wrapResult('') };
  }

  if (
    normalizedPath === '/store/payouts' ||
    normalizedPath === '/store/verify-payout' ||
    normalizedPath === '/payments/payouts' ||
    normalizedPath === '/payments/check-payout' ||
    normalizedPath === '/payments/verify-payout'
  ) {
    return { statusCode: 200, payload: wrapResult({}) };
  }

  if (normalizedPath.startsWith('/alliances/')) {
    const allianceState = ensureAllianceState(userId);
    const db = loadCrewDb();
    const allianceName = String(params.name || params.allianceName || 'Fast Crew').trim() || 'Fast Crew';
    const allianceTag = String(params.tag || params.shortTag || 'FAST').trim() || 'FAST';
    const normalizedUserId = String(userId);
    const currentProfile = getAuthoritativeSparxProfile(userId);
    const localMember = buildAllianceMemberPayload(userId, 'owner');
    if (normalizedPath === '/alliances/create') {
      const createdAlliance = normalizeAllianceRecord({
        aid: `crew_${userId}`,
        id: `crew_${userId}`,
        name: allianceName,
        tag: allianceTag,
        description: String(params.description || 'Local crew'),
        msg: String(params.description || 'Local crew'),
        locale: 'tr_TR',
        language: 'tr',
        localizedCountry: 'Turkey',
        data: buildDefaultAllianceData(),
        stats: buildDefaultAllianceStats(),
        isPublic: params.pubType !== 'private',
        members: [localMember]
      });
      db.alliances[createdAlliance.aid] = clone(createdAlliance);
      db.memberships[normalizedUserId] = createdAlliance.aid;
      saveCrewDb(db);
      allianceState.alliance = clone(createdAlliance);
      persistState();
    } else if (normalizedPath === '/alliances/join') {
      const targetAid = String(params.aid || params.id || params.organization || '').trim();
      const firstRecommended = (allianceState.recommended || [])[0] || null;
      const candidate = normalizeAllianceRecord(
        db.alliances[targetAid] ||
        (firstRecommended && db.alliances[firstRecommended.aid]) ||
        firstRecommended ||
        {}
      );
      if (candidate && candidate.aid) {
        const memberRecord = buildAllianceMemberPayload(userId, 'member');
        candidate.members = candidate.members.filter((member) => member.uid !== memberRecord.uid);
        candidate.members.push(memberRecord);
        candidate.memberCount = candidate.members.length;
        candidate.numMembers = candidate.members.length;
        db.alliances[candidate.aid] = clone(candidate);
        db.memberships[normalizedUserId] = candidate.aid;
        saveCrewDb(db);
        allianceState.alliance = clone(candidate);
      }
      persistState();
    } else if (normalizedPath === '/alliances/leave') {
      const currentAid = String(db.memberships[normalizedUserId] || '').trim();
      if (currentAid && db.alliances[currentAid]) {
        const alliance = normalizeAllianceRecord(db.alliances[currentAid]);
        const localUid = String(getProfileUidValue(currentProfile, userId));
        alliance.members = alliance.members.filter((member) => member.uid !== localUid);
        alliance.memberCount = alliance.members.length;
        alliance.numMembers = alliance.members.length;
        db.alliances[currentAid] = clone(alliance);
      }
      delete db.memberships[normalizedUserId];
      saveCrewDb(db);
      allianceState.alliance = null;
      persistState();
    } else if (normalizedPath === '/alliances/update' && allianceState.alliance) {
      const currentAid = String(allianceState.alliance.aid || '').trim();
      if (currentAid && db.alliances[currentAid]) {
        const alliance = normalizeAllianceRecord(db.alliances[currentAid]);
        alliance.name = allianceName;
        alliance.tag = allianceTag;
        alliance.description = String(params.description || alliance.description || '');
        alliance.msg = String(params.description || alliance.msg || '');
        db.alliances[currentAid] = clone(alliance);
        saveCrewDb(db);
        allianceState.alliance = clone(alliance);
        persistState();
      }
    }
    let result = buildAlliancePayload(userId);
    if (normalizedPath === '/alliances/details') {
      const requestedAid = String(params.aid || params.id || params.organization || '').trim();
      const detailsAlliance = normalizeAllianceRecord(db.alliances[requestedAid] || allianceState.alliance || {});
      result = {
        ...buildAlliancePayload(userId),
        alliance: clone(detailsAlliance),
        Alliance: clone(detailsAlliance),
        currentAlliance: clone(detailsAlliance),
        CurrentAlliance: clone(detailsAlliance),
        members: clone(detailsAlliance.members || []),
        Members: clone(detailsAlliance.members || [])
      };
    } else if (normalizedPath === '/alliances/find' || normalizedPath === '/alliances/find-recommended') {
      const query = String(params.q || params.query || '').trim().toLowerCase();
      const found = buildRecommendedAllianceList(userId, db, String(allianceState.alliance && allianceState.alliance.aid || ''))
        .filter((entry) => !query || entry.name.toLowerCase().includes(query) || entry.tag.toLowerCase().includes(query));
      result = {
        ...buildAlliancePayload(userId),
        alliances: clone(found),
        Alliances: clone(found),
        recommended: clone(found),
        Recommended: clone(found)
      };
    } else if (normalizedPath === '/alliances/request-members') {
      const members = clone((allianceState.alliance && allianceState.alliance.members) || []);
      result = {
        ...buildAlliancePayload(userId),
        members,
        Members: members
      };
    } else if (normalizedPath === '/alliances/refresh') {
      result = buildAlliancePayload(userId);
    }
    return { statusCode: 200, payload: wrapConnectedResult(result, Object.keys(result || {})) };
  }

  if (
    normalizedPath === '/userprofile' ||
    normalizedPath === '/userprofile/find' ||
    normalizedPath === '/userprofile/bulk'
  ) {
    return { statusCode: 200, payload: wrapResult(buildProfilePayload(userId)) };
  }

  if (normalizedPath === '/refresh' || normalizedPath === '/inbox') {
    const result = buildInboxPayload(userId);
    return { statusCode: 200, payload: wrapConnectedResult(result, Object.keys(result || {})) };
  }

  if (normalizedPath === '/paymentpackages') {
    return { statusCode: 200, payload: wrapResult({}) };
  }

  // /account/data is called by LoginManager._PostLogin() to populate LoginData.
  // AutoRefreshingManager.Connect() reads Dot.Object("gacha", LoginData, null) and if
  // present calls OnData() synchronously — so GachaManager._sets gets populated BEFORE
  // any tutorial screen opens (fixes "OUT OF CARS" timing race).
  if (normalizedPath === '/account/data') {
    const gachaPayload = buildGachaRefreshPayload(userId);
    const gamestore = buildGameStoreRefreshPayload(userId);
    // gachaCarInfo: required by PerformanceUpgradeManager.Connect() → ParseStaticCarData().
    // Without it staticCarData dict is empty → GetStaticCarData() returns null →
    // ShowInvalidData() fires → car name shows "Kullanılamaz" and PI shows "888".
    const gachaCarInfo = buildGachaCarInfoPayload();
    // levelrewards_levels: required by StyleBonusManager.Connect() to prevent NPE in VisualUpgrades_Screen.
    const levelrewards_levels = buildLevelRewardsLevelsPayload();
    const chat = buildChatTokenPayload(userId);
    const loginData = {
      gacha: gachaPayload,
      gamestore,
      gachaCarInfo,
      levelrewards_levels,
      vuTuning: buildVisualUpgradeTuningPayload(),
      mechanicsData: buildMechanicsDataPayload(userId),
      carUpgrades: buildCarUpgradesLoginPayload(userId),
      alliance: buildAlliancePayload(userId),
      chat,
      friends: clone(chat.friends || []),
      chat_ban: clone(chat.chat_ban || {}),
      max_friends: Number(chat.max_friends || CHAT_MAX_FRIENDS)
    };
    // response.hashtable in C# = response.result as Hashtable = parsed JSON root object.
    // Must mirror keys to root level so Dot.Object(..., LoginData) finds them.
    return { statusCode: 200, payload: wrapResultWithMirrors(loginData, ['gacha', 'gamestore', 'gachaCarInfo', 'levelrewards_levels', 'vuTuning', 'mechanicsData', 'carUpgrades', 'alliance', 'chat', 'friends', 'chat_ban', 'max_friends']) };
  }

  console.warn(`[SPARX API] returning generic stub for ${normalizedMethod} ${normalizedPath}`);
  return { statusCode: 200, payload: wrapResult({}) };
}

module.exports = {
  isSparxApiPath,
  handleSparxApiRequest,
  buildGachaRefreshPayload,
  buildGachaTablesPayload,
  buildVisualUpgradeTuningPayload,
  buildGameStoreRefreshPayload,
  buildOwnedVisualUpgradeInventory,
  buildMechanicsDataPayload,
  buildCarUpgradesLoginPayload,
  buildAlliancePayload,
  buildChatTokenPayload,
  sanitizeOwnedVehicleStatus,
  claimShipyardBox,
  claimShipyardFreeBox,
  wrapConnectedResult
};
