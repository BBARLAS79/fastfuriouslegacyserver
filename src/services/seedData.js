const crypto = require('crypto');
const extractedTutorialCarDb = require('../data/ff7_030_tutorial_car_db.json');
const externalCarAttributeDb = require('../data/ff7_cardatadb.json');

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function deriveInternalUid(userId) {
  const source = String(userId || 'default');
  let hash = 0;
  for (let i = 0; i < source.length; i += 1) {
    hash = ((hash << 5) - hash) + source.charCodeAt(i);
    hash |= 0;
  }
  return String(100000 + (Math.abs(hash) % 900000));
}

function createOwnedVehicleRecordId(ownerUid, assetTag, index = 0) {
  const seed = `${String(ownerUid || '0')}:${String(assetTag || '').trim()}:${Number(index) || 0}`;
  return crypto.createHash('sha1').update(seed).digest('hex').slice(0, 24);
}

function pickDeterministicVariant(seed, variants, fallback = '') {
  const pool = Array.isArray(variants)
    ? variants.map((value) => String(value || '').trim()).filter(Boolean)
    : [];
  if (pool.length === 0) {
    return String(fallback || '').trim();
  }
  const source = String(seed || pool[0] || fallback || '');
  let hash = 0;
  for (let i = 0; i < source.length; i += 1) {
    hash = ((hash << 5) - hash) + source.charCodeAt(i);
    hash |= 0;
  }
  const index = Math.abs(hash) % pool.length;
  return pool[index] || pool[0];
}

function hashString(value) {
  const source = String(value || '');
  let hash = 0;
  for (let index = 0; index < source.length; index += 1) {
    hash = ((hash << 5) - hash) + source.charCodeAt(index);
    hash |= 0;
  }
  return Math.abs(hash);
}

function ff7FNV32(value) {
  const source = String(value || '');
  const prime = 16777619;
  let hash = 2166136261 >>> 0;

  for (let index = 0; index < source.length; index += 1) {
    hash = Math.imul(hash, prime) >>> 0;
    hash = (hash ^ source.charCodeAt(index)) >>> 0;
  }

  return hash >= 0x80000000 ? hash - 0x100000000 : hash;
}

function parseVisualUpgradeString(value) {
  const parts = String(value || '')
    .split('&')
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
  return parts.map((entry) => {
    const numericValue = Number(entry);
    if (Number.isFinite(numericValue)) {
      return numericValue;
    }
    return ff7FNV32(entry);
  });
}

function buildRepeatedRaceObjectiveValue(value, count) {
  const normalizedCount = Math.max(1, Math.trunc(Number(count) || 1));
  return Array.from({ length: normalizedCount }, () => String(value)).join('&');
}

function extractCarAttributeAssetTag(entry) {
  const candidates = [
    entry && entry.Tag,
    entry && entry.tag,
    entry && entry.Id,
    entry && entry.id,
    entry && entry.Name,
    entry && entry.name,
    entry && entry.n
  ];
  for (const candidate of candidates) {
    const normalized = String(candidate || '').trim().replace(/^car_attribute_/i, '');
    if (normalized) {
      return normalized;
    }
  }
  return '';
}

function hasMeaningfulVisualUpgradeArray(values) {
  return Array.isArray(values) && values.some((value) => Number(value) !== 0);
}

function coerceVisualUpgradeArray(values) {
  const next = Array.isArray(values)
    ? values.map((value) => {
      const numericValue = Number(value);
      return Number.isFinite(numericValue) ? numericValue : 0;
    })
    : [];
  while (next.length < 15) {
    next.push(-1);
  }
  return next.slice(0, 15);
}

const externalCarAttributeEntries = Array.isArray(externalCarAttributeDb && externalCarAttributeDb.cm)
  ? externalCarAttributeDb.cm.filter((entry) => entry && typeof entry === 'object')
  : [];

const defaultPackManifestText = `{
  "packs": {
    "cars": "cars",
    "global": "global",
    "tutorials": "tutorials",
    "audio": "audio",
    "cubemaps": "cubemaps",
    "scenes": "scenes"
  },
  "obb": {
    "extractSize": 853631157,
    "obbSize": 592106504,
    "totalSize": 1445652159
  },
  "scenes": [
    "1_boot",
    "2_main"
  ]
}`;

const defaultChannels = [
  { id: 'career', tag: 'career', type: 'career', title: 'Championships', indexPosition: 0 },
  { id: 'quick-races', tag: 'quick-races', type: 'channel', title: 'Quick Races', indexPosition: 1 },
  { id: 'community', tag: 'community', type: 'channel', title: 'Challenges', indexPosition: 2 },
  { id: 'places', tag: 'places', type: 'channel', title: 'Road Trip', indexPosition: 3 },
  { id: 'favourites', tag: 'favourites', type: 'favourite', title: 'Favourites', indexPosition: 4 },
  { id: '2k-drive-info', tag: '2k-drive-info', type: 'channel', title: 'Game Info', indexPosition: 5 }
];

const defaultArticles = [
  {
    id: 1001,
    title: 'WELCOME TO THE GARAGE',
    description: 'This seeded article proves the rebuilt magazine feed is alive.',
    type: 'news',
    feedTitle: '2K Drive',
    visualType: 'photo',
    layout: 'photo',
    image: '/media/cover-welcome.svg',
    summaryImage: '/media/cover-welcome.svg',
    imageThumbnail: '/media/cover-welcome-thumb.svg',
    channels: ['career', '2k-drive-info'],
    flags: ['cover', 'recommended']
  },
  {
    id: 1002,
    title: 'QUICK RACE SPOTLIGHT',
    description: 'A sample quick-race feature article for the extracted client.',
    type: 'news',
    feedTitle: 'Quick Races',
    visualType: 'photo',
    layout: 'photo',
    image: '/media/quick-race.svg',
    summaryImage: '/media/quick-race.svg',
    imageThumbnail: '/media/quick-race-thumb.svg',
    channels: ['quick-races'],
    flags: ['cover', 'recommended']
  },
  {
    id: 1003,
    title: 'COMMUNITY CHALLENGE LIVE',
    description: 'Join the weekly community event and climb the leaderboard.',
    type: 'globalcommunity',
    eventType: 'challenge',
    feedTitle: 'Challenges',
    visualType: 'photo',
    layout: 'photo',
    image: '/media/community-live.svg',
    summaryImage: '/media/community-live.svg',
    imageThumbnail: '/media/community-live-thumb.svg',
    channels: ['community'],
    flags: ['event', 'recommended'],
    playable: true,
    fuelCost: 1,
    vehicleSelectionType: 'owned',
    event: {
      targetDescription: 'Finish Top 3',
      superStarsBonus: 0
    }
  },
  {
    id: 1004,
    title: 'ROAD TRIP: TOKYO NIGHTS',
    description: 'A place article for the Road Trip channel.',
    type: 'news',
    feedTitle: 'Road Trip',
    visualType: 'photo',
    layout: 'photo',
    image: '/media/tokyo-nights.svg',
    summaryImage: '/media/tokyo-nights.svg',
    imageThumbnail: '/media/tokyo-nights-thumb.svg',
    channels: ['places'],
    flags: ['cover']
  },
  {
    id: 1005,
    title: 'PATCH NOTES',
    description: 'Internal info channel article used to verify the extracted UI.',
    type: 'news',
    feedTitle: 'Game Info',
    visualType: 'photo',
    layout: 'photo',
    image: '/media/patch-notes.svg',
    summaryImage: '/media/patch-notes.svg',
    imageThumbnail: '/media/patch-notes-thumb.svg',
    channels: ['2k-drive-info'],
    flags: []
  },
  {
    id: 2001,
    raceId: 'chapter_01_a',
    RaceId: 'chapter_01_a',
    raceIndex: 1,
    raceNumber: 1,
    title: 'STREET',
    description: 'Welcome to Miami...',
    type: 'gamecareer',
    eventType: 'street',
    isCareerArticle: true,
    feedTitle: 'CHAPTER 1',
    visualType: 'photo',
    layout: 'photo',
    image: '/media/career-city.svg',
    summaryImage: '/media/career-city.svg',
    imageThumbnail: '/media/career-city-thumb.svg',
    channels: ['career'],
    flags: ['event'],
    playable: true,
    fuelCost: 1,
    vehicleSelectionType: 'owned',
    chapterId: 'chapter_01',
    chapterTitle: 'CHAPTER 1',
    chapterCity: 'MIAMI, U.S.A.',
    chapterNumber: 1,
    chapterNum: 1,
    num: 1,
    number: 1,
    chapterIndex: 1,
    requiredClass: 1,
    classRequirement: 1,
    classMax: 1,
    chapterClassRequirement: 1,
    raceSceneName: 'track_miami_street',
    raceSceneVariant: 'shortTrack',
    raceLocationKey: 'ID_UI_PRERACE_LOCATION_MIAMI',
    opponentName: 'Roman',
    opponentCarId: 'honda_civic_euro_2012',
    opponentMatchTime: 250,
    textureMapping: 'ROMAN|dialog_character_roman01&ID_UI_PRERACE_LOCATION_MIAMI|map_miami_shape',
    currentStoryPreDialogue: 'ID_STORY_CHAPTER_1_PRE_1A:WSO|0|ROMAN|ID_STORY_CHAPTER_1_PRE_1A|ID_UI_PRERACE_LOCATION_MIAMI|GP|True',
    previousStoryPostDialogue: '',
    miscDialogue: '',
    ppti: 'profile_pic_roman01',
    requiredPi: 250,
    opponentPi: 250,
    rewardSc: 1400,
    rewardHc: 0,
    rewardUp: 7,
    rewardXp: 120,
    winRedeemers: [
      { type: 'res', Type: 'res', data: 'up', Data: 'up', n: 'up', q: 7, quantity: 7, Quantity: 7 },
      { type: 'res', Type: 'res', data: 'sc', Data: 'sc', n: 'sc', q: 1400, quantity: 1400, Quantity: 1400 }
    ],
    event: {
      targetDescription: 'Win the race',
      superStarsBonus: 500
    }
  },
  {
    id: 2002,
    raceId: 'chapter_01_b',
    RaceId: 'chapter_01_b',
    raceIndex: 2,
    raceNumber: 2,
    title: 'DRAG',
    description: 'Nail the shift...',
    type: 'gamecareer',
    eventType: 'drag',
    isCareerArticle: true,
    feedTitle: 'CHAPTER 1',
    visualType: 'photo',
    layout: 'photo',
    image: '/media/career-city.svg',
    summaryImage: '/media/career-city.svg',
    imageThumbnail: '/media/career-city-thumb.svg',
    channels: ['career'],
    flags: ['event'],
    playable: true,
    fuelCost: 1,
    vehicleSelectionType: 'owned',
    chapterId: 'chapter_01',
    chapterTitle: 'CHAPTER 1',
    chapterCity: 'MIAMI, U.S.A.',
    chapterNumber: 1,
    chapterNum: 1,
    num: 1,
    number: 1,
    chapterIndex: 1,
    requiredClass: 1,
    classRequirement: 1,
    classMax: 1,
    chapterClassRequirement: 1,
    raceSceneName: 'track_miami_drag',
    raceSceneVariant: 'quartermile',
    raceLocationKey: 'ID_UI_PRERACE_LOCATION_MIAMI',
    opponentName: 'Steve',
    opponentCarId: 'honda_civic_euro_2012',
    opponentCarPool: ['subaru_brz_2013', 'honda_civic_euro_2012'],
    opponentMatchTime: 250,
    textureMapping: 'ID_UI_PRERACE_LOCATION_MIAMI|map_miami_shape',
    currentStoryPreDialogue: '',
    previousStoryPostDialogue: '',
    miscDialogue: '',
    ppti: '',
    requiredPi: 250,
    opponentPi: 250,
    rewardSc: 1400,
    rewardHc: 10,
    rewardUp: 0,
    rewardXp: 130,
    winRedeemers: [
      { type: 'res', Type: 'res', data: 'sc', Data: 'sc', n: 'sc', q: 1400, quantity: 1400, Quantity: 1400 },
      { type: 'res', Type: 'res', data: 'hc', Data: 'hc', n: 'hc', q: 10, quantity: 10, Quantity: 10 }
    ],
    event: {
      targetDescription: 'Nail the shift...',
      superStarsBonus: 750
    }
  },
  {
    id: 2003,
    raceId: 'chapter_01_c',
    RaceId: 'chapter_01_c',
    raceIndex: 3,
    raceNumber: 3,
    title: 'DRAG',
    description: 'Keep the streak alive.',
    type: 'gamecareer',
    eventType: 'drag',
    isCareerArticle: true,
    feedTitle: 'CHAPTER 1',
    visualType: 'photo',
    layout: 'photo',
    image: '/media/career-city.svg',
    summaryImage: '/media/career-city.svg',
    imageThumbnail: '/media/career-city-thumb.svg',
    channels: ['career'],
    flags: ['event'],
    playable: true,
    fuelCost: 1,
    vehicleSelectionType: 'owned',
    chapterId: 'chapter_01',
    chapterTitle: 'CHAPTER 1',
    chapterCity: 'MIAMI, U.S.A.',
    chapterNumber: 1,
    chapterNum: 1,
    num: 1,
    number: 1,
    chapterIndex: 1,
    requiredClass: 1,
    classRequirement: 1,
    classMax: 1,
    chapterClassRequirement: 1,
    raceSceneName: 'track_miami_drag',
    raceSceneVariant: 'halfmile',
    raceLocationKey: 'ID_UI_PRERACE_LOCATION_MIAMI',
    opponentName: 'Luke',
    opponentCarId: 'honda_civic_euro_2012',
    opponentMatchTime: 260,
    textureMapping: 'ID_UI_PRERACE_LOCATION_MIAMI|map_miami_shape',
    currentStoryPreDialogue: '',
    previousStoryPostDialogue: '',
    miscDialogue: '',
    ppti: '',
    requiredPi: 270,
    opponentPi: 270,
    rewardSc: 1400,
    rewardHc: 10,
    rewardUp: 0,
    rewardXp: 140,
    winRedeemers: [
      { type: 'res', Type: 'res', data: 'sc', Data: 'sc', n: 'sc', q: 1400, quantity: 1400, Quantity: 1400 },
      { type: 'res', Type: 'res', data: 'hc', Data: 'hc', n: 'hc', q: 10, quantity: 10, Quantity: 10 }
    ],
    event: {
      targetDescription: 'Stay smooth through the gears',
      superStarsBonus: 1000
    }
  },
  {
    id: 2004,
    raceId: 'chapter_01_d',
    RaceId: 'chapter_01_d',
    raceIndex: 4,
    raceNumber: 4,
    title: 'STREET',
    description: 'Take it to the streets...',
    type: 'gamecareer',
    eventType: 'street_to_getaway',
    isCareerArticle: true,
    feedTitle: 'CHAPTER 1',
    visualType: 'photo',
    layout: 'photo',
    image: '/media/career-city.svg',
    summaryImage: '/media/career-city.svg',
    imageThumbnail: '/media/career-city-thumb.svg',
    channels: ['career'],
    flags: ['event'],
    playable: true,
    fuelCost: 1,
    vehicleSelectionType: 'owned',
    chapterId: 'chapter_01',
    chapterTitle: 'CHAPTER 1',
    chapterCity: 'MIAMI, U.S.A.',
    chapterNumber: 1,
    chapterNum: 1,
    num: 1,
    number: 1,
    chapterIndex: 1,
    requiredClass: 1,
    classRequirement: 1,
    classMax: 1,
    chapterClassRequirement: 1,
    raceSceneName: 'track_miami_street',
    raceSceneVariant: 'shortTrack',
    raceLocationKey: 'ID_UI_PRERACE_LOCATION_MIAMI',
    opponentName: 'Luke',
    opponentCarId: 'honda_civic_euro_2012',
    opponentMatchTime: 280,
    textureMapping: 'ID_UI_PRERACE_LOCATION_MIAMI|map_miami_shape',
    currentStoryPreDialogue: '',
    previousStoryPostDialogue: '',
    miscDialogue: '',
    ppti: '',
    requiredPi: 300,
    opponentPi: 300,
    rewardSc: 1200,
    rewardHc: 5,
    rewardUp: 8,
    rewardXp: 150,
    winRedeemers: [
      { type: 'res', Type: 'res', data: 'up', Data: 'up', n: 'up', q: 8, quantity: 8, Quantity: 8 },
      { type: 'res', Type: 'res', data: 'sc', Data: 'sc', n: 'sc', q: 1200, quantity: 1200, Quantity: 1200 },
      { type: 'res', Type: 'res', data: 'hc', Data: 'hc', n: 'hc', q: 5, quantity: 5, Quantity: 5 }
    ],
    trafficLevel: 'medium',
    trafficCarIds: ['traffic_sedan_compact_01_a', 'traffic_suv_compact_01_a', 'traffic_truck_medium_box_01_a'],
    policeCarIds: [],
    event: {
      targetDescription: 'Escape the heat',
      superStarsBonus: 1200
    }
  },
  {
    id: 2005,
    raceId: 'chapter_01_e',
    RaceId: 'chapter_01_e',
    raceIndex: 5,
    raceNumber: 5,
    title: 'TAKEDOWN',
    description: 'Hit hard and finish the run.',
    type: 'gamecareer',
    eventType: 'takedown',
    isCareerArticle: true,
    feedTitle: 'CHAPTER 1',
    visualType: 'photo',
    layout: 'photo',
    image: '/media/career-city.svg',
    summaryImage: '/media/career-city.svg',
    imageThumbnail: '/media/career-city-thumb.svg',
    channels: ['career'],
    flags: ['event'],
    playable: true,
    fuelCost: 1,
    vehicleSelectionType: 'owned',
    chapterId: 'chapter_01',
    chapterTitle: 'CHAPTER 1',
    chapterCity: 'MIAMI, U.S.A.',
    chapterNumber: 1,
    chapterNum: 1,
    num: 1,
    number: 1,
    chapterIndex: 1,
    requiredClass: 1,
    classRequirement: 1,
    classMax: 1,
    chapterClassRequirement: 1,
    raceSceneName: 'track_miami_street',
    raceSceneVariant: 'takedown',
    raceLocationKey: 'ID_UI_PRERACE_LOCATION_MIAMI',
    opponentName: 'Luke',
    opponentCarId: 'honda_civic_euro_2012',
    opponentMatchTime: 300,
    textureMapping: 'ID_UI_PRERACE_LOCATION_MIAMI|map_miami_shape',
    currentStoryPreDialogue: '',
    previousStoryPostDialogue: '',
    miscDialogue: '',
    ppti: '',
    requiredPi: 340,
    opponentPi: 340,
    rewardSc: 1400,
    rewardHc: 10,
    rewardUp: 13,
    rewardXp: 160,
    winRedeemers: [
      { type: 'res', Type: 'res', data: 'up', Data: 'up', n: 'up', q: 13, quantity: 13, Quantity: 13 },
      { type: 'res', Type: 'res', data: 'sc', Data: 'sc', n: 'sc', q: 1400, quantity: 1400, Quantity: 1400 },
      { type: 'res', Type: 'res', data: 'hc', Data: 'hc', n: 'hc', q: 10, quantity: 10, Quantity: 10 }
    ],
    trafficLevel: 'medium',
    trafficCarIds: ['traffic_sedan_compact_01_a', 'traffic_suv_compact_01_a'],
    policeCarIds: [],
    event: {
      targetDescription: 'Take down Luke',
      superStarsBonus: 1400
    }
  }
];

const createChallengeArticle = (overrides = {}) => ({
  type: 'globalcommunity',
  raceCollection: 'grind',
  feedTitle: 'Challenges',
  visualType: 'photo',
  layout: 'photo',
  image: '/media/quick-race.svg',
  summaryImage: '/media/quick-race.svg',
  imageThumbnail: '/media/quick-race-thumb.svg',
  channels: ['community', 'quick-races'],
  flags: ['event', 'recommended'],
  playable: true,
  fuelCost: 1,
  vehicleSelectionType: 'owned',
  chapterTitle: 'CHALLENGE',
  chapterNumber: 1,
  opponentName: 'Random Rival',
  opponentCarPool: ['honda_civic_euro_2012', 'subaru_brz_2013', 'nissan_gtr_r35_2007'],
  opponentMatchTime: 280,
  requiredPi: 260,
  opponentPi: 260,
  raceIcon: 'Practice',
  gachaTokenReward: '',
  gachaTokenBox: '',
  winRedeemers: [
    { type: 'res', Type: 'res', data: 'up', Data: 'up', n: 'up', q: 10, quantity: 10, Quantity: 10 },
    { type: 'res', Type: 'res', data: 'sc', Data: 'sc', n: 'sc', q: 450, quantity: 450, Quantity: 450 },
    { type: 'res', Type: 'res', data: 'hc', Data: 'hc', n: 'hc', q: 1, quantity: 1, Quantity: 1 }
  ],
  event: { targetDescription: 'Win the race', superStarsBonus: 600 },
  ...overrides
});

const defaultChallengeArticles = [
  createChallengeArticle({
    id: 3001,
    title: 'TOKYO STREET',
    description: 'Street sprint through Tokyo.',
    eventType: 'street',
    chapterCity: 'TOKYO, JAPAN',
    raceCity: 'tokyo',
    raceSceneName: 'track_tokyo_street',
    raceSceneVariant: 'shortTrack',
    raceLocationKey: 'ID_UI_PRERACE_LOCATION_TOKYO',
    textureMapping: 'ID_UI_PRERACE_LOCATION_TOKYO|map_tokyo_shape'
  }),
  createChallengeArticle({
    id: 3002,
    title: 'TOKYO DRAG',
    description: 'Quarter-mile drag in Tokyo.',
    eventType: 'drag',
    chapterCity: 'TOKYO, JAPAN',
    raceCity: 'tokyo',
    raceSceneName: 'track_tokyo_drag',
    raceSceneVariant: 'quartermile',
    raceLocationKey: 'ID_UI_PRERACE_LOCATION_TOKYO',
    textureMapping: 'ID_UI_PRERACE_LOCATION_TOKYO|map_tokyo_shape',
    requiredPi: 270,
    opponentPi: 270,
    event: { targetDescription: 'Nail the shift', superStarsBonus: 650 }
  }),
  createChallengeArticle({
    id: 3003,
    title: 'TOKYO DRIFT',
    description: 'Head-to-head drift challenge in Tokyo.',
    eventType: 'drift',
    chapterCity: 'TOKYO, JAPAN',
    raceCity: 'tokyo',
    raceSceneName: 'track_tokyo_drift',
    raceSceneVariant: '1000m',
    raceLocationKey: 'ID_UI_PRERACE_LOCATION_TOKYO',
    textureMapping: 'ID_UI_PRERACE_LOCATION_TOKYO|map_tokyo_shape',
    raceIcon: 'Practice',
    opponentName: 'Drift Rival',
    opponentCarPool: ['honda_civic_euro_2012', 'subaru_brz_2013'],
    opponentMatchTime: 280,
    requiredPi: 280,
    opponentPi: 280,
    event: { targetDescription: 'Score the drift run', superStarsBonus: 700 }
  }),
  createChallengeArticle({
    id: 3004,
    title: 'MIAMI STREET',
    description: 'Street sprint through Miami.',
    eventType: 'street',
    chapterCity: 'MIAMI, U.S.A.',
    raceCity: 'miami',
    raceSceneName: 'track_miami_street',
    raceSceneVariant: 'shortTrack',
    raceLocationKey: 'ID_UI_PRERACE_LOCATION_MIAMI',
    textureMapping: 'ID_UI_PRERACE_LOCATION_MIAMI|map_miami_shape'
  }),
  createChallengeArticle({
    id: 3005,
    title: 'MIAMI DRAG',
    description: 'Quarter-mile drag in Miami.',
    eventType: 'drag',
    chapterCity: 'MIAMI, U.S.A.',
    raceCity: 'miami',
    raceSceneName: 'track_miami_drag',
    raceSceneVariant: 'quartermile',
    raceLocationKey: 'ID_UI_PRERACE_LOCATION_MIAMI',
    textureMapping: 'ID_UI_PRERACE_LOCATION_MIAMI|map_miami_shape',
    requiredPi: 270,
    opponentPi: 270,
    event: { targetDescription: 'Nail the shift', superStarsBonus: 650 }
  }),
  createChallengeArticle({
    id: 3006,
    title: 'MIAMI DRIFT',
    description: 'Head-to-head drift challenge in Miami.',
    eventType: 'drift',
    chapterCity: 'MIAMI, U.S.A.',
    raceCity: 'miami',
    raceSceneName: 'track_miami_drift',
    raceSceneVariant: '1000m',
    raceLocationKey: 'ID_UI_PRERACE_LOCATION_MIAMI',
    textureMapping: 'ID_UI_PRERACE_LOCATION_MIAMI|map_miami_shape',
    raceIcon: 'Practice',
    opponentName: 'Drift Rival',
    opponentCarPool: ['honda_civic_euro_2012', 'subaru_brz_2013'],
    opponentMatchTime: 280,
    requiredPi: 280,
    opponentPi: 280,
    event: { targetDescription: 'Score the drift run', superStarsBonus: 700 }
  }),
  createChallengeArticle({
    id: 3007,
    title: 'RIO STREET',
    description: 'Street sprint through Rio.',
    eventType: 'street',
    chapterCity: 'RIO, BRAZIL',
    raceCity: 'rio',
    raceSceneName: 'track_rio_street',
    raceSceneVariant: 'shortTrack',
    raceLocationKey: 'ID_UI_PRERACE_LOCATION_RIO',
    textureMapping: 'ID_UI_PRERACE_LOCATION_RIO|map_rio_shape'
  }),
  createChallengeArticle({
    id: 3008,
    title: 'RIO DRAG',
    description: 'Quarter-mile drag in Rio.',
    eventType: 'drag',
    chapterCity: 'RIO, BRAZIL',
    raceCity: 'rio',
    raceSceneName: 'track_rio_drag',
    raceSceneVariant: 'quartermile',
    raceLocationKey: 'ID_UI_PRERACE_LOCATION_RIO',
    textureMapping: 'ID_UI_PRERACE_LOCATION_RIO|map_rio_shape',
    requiredPi: 270,
    opponentPi: 270,
    event: { targetDescription: 'Nail the shift', superStarsBonus: 650 }
  }),
  createChallengeArticle({
    id: 3009,
    title: 'RIO DRIFT',
    description: 'Head-to-head drift challenge in Rio.',
    eventType: 'drift',
    chapterCity: 'RIO, BRAZIL',
    raceCity: 'rio',
    raceSceneName: 'track_rio_drift',
    raceSceneVariant: '1000m',
    raceLocationKey: 'ID_UI_PRERACE_LOCATION_RIO',
    textureMapping: 'ID_UI_PRERACE_LOCATION_RIO|map_rio_shape',
    raceIcon: 'Practice',
    opponentName: 'Drift Rival',
    opponentCarPool: ['honda_civic_euro_2012', 'subaru_brz_2013'],
    opponentMatchTime: 280,
    requiredPi: 280,
    opponentPi: 280,
    event: { targetDescription: 'Score the drift run', superStarsBonus: 700 }
  }),
  createChallengeArticle({
    id: 3010,
    title: 'LOS ANGELES STREET',
    description: 'Street sprint through Los Angeles.',
    eventType: 'street',
    chapterCity: 'LOS ANGELES',
    raceCity: 'la',
    raceSceneName: 'track_la_street',
    raceSceneVariant: 'shortTrack',
    raceLocationKey: 'ID_UI_PRERACE_LOCATION_LA',
    textureMapping: 'ID_UI_PRERACE_LOCATION_LA|map_la_shape'
  })
];

const defaultRandomChallengeArticles = defaultChallengeArticles
  .map((article, index) => ({
    ...clone(article),
    id: 3101 + index,
    title: `${String(article.title || 'RANDOM CHALLENGE')} RANDOM`,
    raceCollection: 'random_grind',
    flags: Array.isArray(article.flags) ? Array.from(new Set([...article.flags, 'random'])) : ['random']
  }))
  .concat([
    createChallengeArticle({
      id: 3201,
      title: 'TOKYO TAKEDOWN RANDOM',
      description: 'Random takedown heat in Tokyo.',
      raceCollection: 'random_grind',
      eventType: 'takedown',
      chapterCity: 'TOKYO, JAPAN',
      raceCity: 'tokyo',
      raceSceneName: 'track_tokyo_street',
      raceSceneVariant: 'takedown',
      raceLocationKey: 'ID_UI_PRERACE_LOCATION_TOKYO',
      textureMapping: 'ID_UI_PRERACE_LOCATION_TOKYO|map_tokyo_shape',
      requiredPi: 300,
      opponentPi: 300,
      trafficLevel: 'medium',
      trafficCarIds: ['traffic_sedan_compact_01_a', 'traffic_suv_compact_01_a'],
      policeCarIds: [],
      flags: ['event', 'recommended', 'random'],
      event: { targetDescription: 'Take down the target', superStarsBonus: 800 }
    }),
    createChallengeArticle({
      id: 3202,
      title: 'MIAMI TAKEDOWN RANDOM',
      description: 'Random takedown heat in Miami.',
      raceCollection: 'random_grind',
      eventType: 'takedown',
      chapterCity: 'MIAMI, U.S.A.',
      raceCity: 'miami',
      raceSceneName: 'track_miami_street',
      raceSceneVariant: 'takedown',
      raceLocationKey: 'ID_UI_PRERACE_LOCATION_MIAMI',
      textureMapping: 'ID_UI_PRERACE_LOCATION_MIAMI|map_miami_shape',
      requiredPi: 300,
      opponentPi: 300,
      trafficLevel: 'medium',
      trafficCarIds: ['traffic_sedan_compact_01_a', 'traffic_suv_compact_01_a'],
      policeCarIds: [],
      flags: ['event', 'recommended', 'random'],
      event: { targetDescription: 'Take down the target', superStarsBonus: 800 }
    }),
    createChallengeArticle({
      id: 3203,
      title: 'RIO TAKEDOWN RANDOM',
      description: 'Random takedown heat in Rio.',
      raceCollection: 'random_grind',
      eventType: 'takedown',
      chapterCity: 'RIO, BRAZIL',
      raceCity: 'rio',
      raceSceneName: 'track_rio_street',
      raceSceneVariant: 'takedown',
      raceLocationKey: 'ID_UI_PRERACE_LOCATION_RIO',
      textureMapping: 'ID_UI_PRERACE_LOCATION_RIO|map_rio_shape',
      requiredPi: 300,
      opponentPi: 300,
      trafficLevel: 'medium',
      trafficCarIds: ['traffic_sedan_compact_01_a', 'traffic_suv_compact_01_a'],
      policeCarIds: [],
      flags: ['event', 'recommended', 'random'],
      event: { targetDescription: 'Take down the target', superStarsBonus: 800 }
    })
  ]);

defaultArticles.push(...defaultChallengeArticles.map((article) => clone(article)));
defaultArticles.push(...defaultRandomChallengeArticles.map((article) => clone(article)));

const STORY_CHAPTER_CITY_SPECS = [
  { cityKey: 'tokyo', cityLabel: 'TOKYO, JAPAN', locationKey: 'ID_UI_PRERACE_LOCATION_TOKYO', mapShape: 'map_tokyo_shape', textureSpeaker: 'TEJ|dialog_character_tej01', icon: 'race_story_chapter2_bg' },
  { cityKey: 'rio', cityLabel: 'RIO, BRAZIL', locationKey: 'ID_UI_PRERACE_LOCATION_RIO', mapShape: 'map_rio_shape', textureSpeaker: 'ROMAN|dialog_character_roman01', icon: 'race_story_chapter3_bg' },
  { cityKey: 'miami', cityLabel: 'MIAMI, U.S.A.', locationKey: 'ID_UI_PRERACE_LOCATION_MIAMI', mapShape: 'map_miami_shape', textureSpeaker: 'LETTY|dialog_character_letty01', icon: 'race_story_chapter4_bg' },
  { cityKey: 'la', cityLabel: 'LOS ANGELES', locationKey: 'ID_UI_PRERACE_LOCATION_LA', mapShape: 'map_la_shape', textureSpeaker: 'ROMAN|dialog_character_roman02', icon: 'race_story_chapter5_bg' }
];

const STORY_RIVAL_NAMES = [
  'Mia',
  'Dom',
  'Jesse',
  'Monica',
  'Suki',
  'Brian',
  'Han',
  'Gisele',
  'Tego',
  'Rico',
  'Eddie',
  'Nico'
];

const STORY_BOSSES = [
  { name: 'Tej', carId: 'ford_mustang_gt_2015', ppti: 'profile_pic_tej01', textureSpeaker: 'TEJ|dialog_character_tej01' },
  { name: 'Letty', carId: 'ford_gran_torino_1972_ff4', ppti: 'profile_pic_letty01', textureSpeaker: 'LETTY|dialog_character_letty01' },
  { name: 'Roman', carId: 'nissan_350z_2008', ppti: 'profile_pic_roman01', textureSpeaker: 'ROMAN|dialog_character_roman01' },
  { name: 'Carter Verone', carId: 'honda_s2000_cr_2009', ppti: '', textureSpeaker: '' },
  { name: 'Johnny Tran', carId: 'honda_s2000_cr_2009', ppti: '', textureSpeaker: '' },
  { name: 'Ramos', carId: 'dodge_viper_srt_timeattack_2014', ppti: '', textureSpeaker: '' }
];

function buildStoryChapterEventPlan(chapterNumber) {
  if (chapterNumber >= 7) {
    return [
      'street',
      'drag',
      'drift',
      'street_to_getaway',
      'takedown',
      'street',
      'drag',
      'drift',
      'street',
      'takedown',
      'drag',
      'street_to_getaway'
    ];
  }
  return ['street', 'drag', 'drift', 'street_to_getaway', 'takedown'];
}

function getStoryClassRequirement(chapterNumber) {
  if (chapterNumber <= 6) {
    return 1;
  }
  const postChapterClasses = [1, 2, 3, 4, 5, 6];
  const index = Math.max(0, Math.min(postChapterClasses.length - 1, chapterNumber - 7));
  return postChapterClasses[index];
}

function getStorySceneConfig(cityKey, eventType) {
  const city = String(cityKey || '').toLowerCase();
  const event = String(eventType || '').toLowerCase();
  if (event === 'drag') {
    return {
      raceSceneName: city === 'miami' ? 'track_miami_drag' : (city === 'rio' ? 'track_rio_drag' : 'track_tokyo_drag'),
      raceSceneVariant: city === 'miami' ? 'quartermile' : 'quartermile'
    };
  }
  if (event === 'drift') {
    return {
      raceSceneName: city === 'miami' ? 'track_miami_drift' : (city === 'rio' ? 'track_rio_drift' : 'track_tokyo_drift'),
      raceSceneVariant: '1000m'
    };
  }
  if (event === 'takedown') {
    return {
      raceSceneName: city === 'miami' ? 'track_miami_street' : (city === 'rio' ? 'track_rio_street' : 'track_tokyo_street'),
      raceSceneVariant: 'takedown'
    };
  }
  return {
    raceSceneName: city === 'miami' ? 'track_miami_street' : (city === 'rio' ? 'track_rio_street' : (city === 'la' ? 'track_la_street' : 'track_tokyo_street')),
    raceSceneVariant: event === 'street_to_getaway' ? 'shortTrack' : 'shortTrack'
  };
}

function pickStoryValue() {
  for (let index = 0; index < arguments.length; index += 1) {
    const value = arguments[index];
    if (value !== undefined && value !== null && value !== '') {
      return value;
    }
  }
  return undefined;
}

function buildStoryTextureMapping(citySpec, boss = null) {
  const parts = [];
  const speaker = String(pickStoryValue(boss && boss.textureSpeaker, citySpec && citySpec.textureSpeaker, '') || '').trim();
  if (speaker) {
    parts.push(speaker);
  }
  parts.push(`${String(citySpec.locationKey)}|${String(citySpec.mapShape)}`);
  return parts.join('&');
}

function buildStoryDialogue(chapterNumber, raceNumber, boss, citySpec) {
  if (!boss) {
    return '';
  }
  const speaker = String(boss.name || 'Rival').toUpperCase().replace(/[^A-Z0-9]+/g, '_');
  return `ID_STORY_CHAPTER_${chapterNumber}_PRE_${raceNumber}:WSO|0|${speaker}|ID_STORY_CHAPTER_${chapterNumber}_PRE_${raceNumber}|${citySpec.locationKey}|GP|True`;
}

function getStoryRaceSuffix(raceIndex) {
  const normalizedIndex = Math.max(1, Math.trunc(Number(raceIndex) || 1)) - 1;
  return String.fromCharCode('a'.charCodeAt(0) + normalizedIndex);
}

function buildStoryRaceId(chapterNumber, raceIndex) {
  const normalizedChapterNumber = Math.max(0, Math.trunc(Number(chapterNumber) || 0));
  return `chapter_${String(normalizedChapterNumber).padStart(2, '0')}_${getStoryRaceSuffix(raceIndex)}`;
}

function getStoryArticleRaceId(article, fallback = '') {
  if (!article || typeof article !== 'object') {
    return String(fallback || '').trim();
  }
  const explicitRaceId = String(article.raceId || article.RaceId || '').trim();
  if (explicitRaceId) {
    return explicitRaceId;
  }
  const chapterNumber = Math.trunc(Number(article.chapterNumber || article.chapterNum || article.num || article.number || 0));
  const raceIndex = Math.trunc(Number(article.raceIndex || article.raceNumber || article.indexInChapter || 0));
  if (chapterNumber > 0 && raceIndex > 0) {
    return buildStoryRaceId(chapterNumber, raceIndex);
  }
  return String(fallback || article.id || '').trim();
}

function createGeneratedStoryArticle(id, chapterNumber, raceIndex, eventType, citySpec) {
  const bossRace = raceIndex === buildStoryChapterEventPlan(chapterNumber).length;
  const boss = bossRace
    ? STORY_BOSSES[(chapterNumber - 2) % STORY_BOSSES.length]
    : null;
  const rivalName = boss
    ? boss.name
    : STORY_RIVAL_NAMES[(chapterNumber * 7 + raceIndex) % STORY_RIVAL_NAMES.length];
  const opponentPool = [
    'subaru_brz_2013',
    'honda_civic_euro_2012',
    'ford_mustang_gt_2015',
    'subaru_impreza_wrx_sti_2009',
    'nissan_350z_2008',
    'pontiac_firebird_1981'
  ];
  const sceneConfig = getStorySceneConfig(citySpec.cityKey, eventType);
  const requiredClass = getStoryClassRequirement(chapterNumber);
  const requiredPi = Math.max(260, 250 + (chapterNumber * 35) + ((raceIndex - 1) * 12));
  const rewardSc = 1400 + (chapterNumber * 180) + ((raceIndex - 1) * 60);
  const rewardHc = bossRace ? Math.max(5, chapterNumber - 1) : (eventType === 'drag' ? 3 : 0);
  const rewardUp = eventType === 'drag'
    ? 0
    : (eventType === 'drift' ? 4 + Math.max(0, chapterNumber - 2) : 5 + raceIndex);
  const rewardXp = 120 + (chapterNumber * 12) + ((raceIndex - 1) * 10);
  const titleMap = {
    street: 'STREET',
    drag: 'DRAG',
    drift: 'DRIFT',
    street_to_getaway: 'GETAWAY',
    takedown: 'TAKEDOWN'
  };
  const targetMap = {
    street: 'Own the sprint',
    drag: 'Nail the shift',
    drift: 'Hold the angle',
    street_to_getaway: 'Beat the heat',
    takedown: boss ? `Take down ${boss.name}` : 'Take down the target'
  };
  const trafficCars = ['traffic_sedan_compact_01_a', 'traffic_suv_compact_01_a', 'traffic_truck_medium_box_01_a'];
  const policeCars = eventType === 'street_to_getaway' || eventType === 'takedown'
    ? ['ff_police_sedan_tokyo_01']
    : [];
  const opponentCarId = String(pickStoryValue(boss && boss.carId, opponentPool[(chapterNumber + raceIndex) % opponentPool.length]) || opponentPool[0]);
  const textureMapping = buildStoryTextureMapping(citySpec, boss);
  const dialogue = buildStoryDialogue(chapterNumber, raceIndex, boss, citySpec);
  const raceId = buildStoryRaceId(chapterNumber, raceIndex);

  return {
    id,
    raceId,
    RaceId: raceId,
    raceIndex,
    raceNumber: raceIndex,
    title: titleMap[eventType] || 'STREET',
    description: boss
      ? `${boss.name} is waiting at the end of this chapter.`
      : `${citySpec.cityLabel} chapter ${chapterNumber}, race ${raceIndex}.`,
    type: 'gamecareer',
    eventType,
    isCareerArticle: true,
    feedTitle: `CHAPTER ${chapterNumber}`,
    visualType: 'photo',
    layout: 'photo',
    image: '/media/career-city.svg',
    summaryImage: '/media/career-city.svg',
    imageThumbnail: '/media/career-city-thumb.svg',
    channels: ['career'],
    flags: boss ? ['event', 'boss'] : ['event'],
    playable: true,
    fuelCost: 1,
    vehicleSelectionType: 'owned',
    chapterId: `chapter_${String(chapterNumber).padStart(2, '0')}`,
    chapterTitle: `CHAPTER ${chapterNumber}`,
    chapterCity: citySpec.cityLabel,
    chapterNumber,
    chapterNum: chapterNumber,
    num: chapterNumber,
    number: chapterNumber,
    chapterIndex: chapterNumber,
    requiredClass,
    classRequirement: requiredClass,
    classMax: requiredClass,
    chapterClassRequirement: requiredClass,
    raceSceneName: sceneConfig.raceSceneName,
    raceSceneVariant: sceneConfig.raceSceneVariant,
    raceLocationKey: citySpec.locationKey,
    opponentName: rivalName,
    opponentCarId,
    opponentMatchTime: requiredPi,
    textureMapping,
    currentStoryPreDialogue: dialogue,
    previousStoryPostDialogue: '',
    miscDialogue: '',
    ppti: String(pickStoryValue(boss && boss.ppti, '') || ''),
    requiredPi,
    opponentPi: requiredPi,
    rewardSc,
    rewardHc,
    rewardUp,
    rewardXp,
    winRedeemers: [
      { type: 'res', Type: 'res', data: 'sc', Data: 'sc', n: 'sc', q: rewardSc, quantity: rewardSc, Quantity: rewardSc },
      ...(rewardHc > 0 ? [{ type: 'res', Type: 'res', data: 'hc', Data: 'hc', n: 'hc', q: rewardHc, quantity: rewardHc, Quantity: rewardHc }] : []),
      ...(rewardUp > 0 ? [{ type: 'res', Type: 'res', data: 'up', Data: 'up', n: 'up', q: rewardUp, quantity: rewardUp, Quantity: rewardUp }] : [])
    ],
    trafficLevel: (eventType === 'street_to_getaway' || eventType === 'takedown') ? 'medium' : '',
    trafficCarIds: (eventType === 'street_to_getaway' || eventType === 'takedown') ? clone(trafficCars) : [],
    policeCarIds: clone(policeCars),
    event: {
      targetDescription: targetMap[eventType] || 'Win the race',
      superStarsBonus: rewardSc
    }
  };
}

const generatedStoryArticles = [];
let nextGeneratedStoryId = 2006;
for (let chapterNumber = 2; chapterNumber <= 12; chapterNumber += 1) {
  const citySpec = STORY_CHAPTER_CITY_SPECS[(chapterNumber - 2) % STORY_CHAPTER_CITY_SPECS.length];
  const eventPlan = buildStoryChapterEventPlan(chapterNumber);
  eventPlan.forEach((eventType, index) => {
    generatedStoryArticles.push(
      createGeneratedStoryArticle(
        nextGeneratedStoryId,
        chapterNumber,
        index + 1,
        eventType,
        citySpec
      )
    );
    nextGeneratedStoryId += 1;
  });
}

defaultArticles.push(...generatedStoryArticles.map((article) => clone(article)));

function buildDynamicCareerChapters(articleList = []) {
  const grouped = new Map();
  articleList.forEach((article) => {
    if (!article || article.type !== 'gamecareer') {
      return;
    }
    const chapterId = String(article.chapterId || '');
    if (!grouped.has(chapterId)) {
      grouped.set(chapterId, []);
    }
    grouped.get(chapterId).push(clone(article));
  });

  return Array.from(grouped.values())
    .map((articles) => articles.sort((a, b) => Number(a.id || 0) - Number(b.id || 0)))
    .sort((a, b) => Number(a[0] && a[0].chapterNumber || 0) - Number(b[0] && b[0].chapterNumber || 0))
    .map((articles) => {
      const first = articles[0] || {};
      const chapterNumber = Number(first.chapterNumber || first.chapterNum || first.num || 1);
      return {
        id: `chapter-${chapterNumber}`,
        title: String(first.chapterTitle || `CHAPTER ${chapterNumber}`),
        num: chapterNumber,
        number: chapterNumber,
        chapterNumber,
        chapterNum: chapterNumber,
        chapterIndex: chapterNumber,
        class: Number(first.classRequirement || first.requiredClass || 1),
        classRequirement: Number(first.classRequirement || first.requiredClass || 1),
        classMax: Number(first.classMax || first.classRequirement || first.requiredClass || 1),
        chapterClassRequirement: Number(first.chapterClassRequirement || first.classRequirement || first.requiredClass || 1),
        city: String(first.raceCity || first.raceSceneName || '').split('_')[1] || 'miami',
        cityLabel: String(first.chapterCity || ''),
        icon: `race_story_chapter${chapterNumber}_bg`,
        unlockRank: Math.max(1, chapterNumber),
        availableTimeStamp: 0,
        availableTimeStampVIP: 0,
        articlesFinished: 0,
        articlesTotal: articles.length,
        beastDefeated: false,
        beastArticleId: Number(first.id || 0),
        beastArticleIndex: 0,
        hyperArticleIndex: null,
        events: articles.map((article, index) => ({
          id: `chapter-${chapterNumber}-tier-${index + 1}`,
          articleIdList: [Number(article.id || 0)]
        })),
        beastEvent: {
          targetDescription: String(first.event && first.event.targetDescription || 'Win the race')
        }
      };
    });
}

const defaultVehicleDescriptions = {
  gtr_r34: {
    name: 'Nissan Skyline GT-R R34',
    description: 'Balanced all-wheel-drive hero car.',
    modelYear: 2002,
    PerformanceClass: 'B',
    ClassType: 'Street',
    BasePISS: 560,
    CanUseDriftTyres: true,
    CanUseOffRoadTyres: false,
    stats: {
      engineSize: '2.6L Twin Turbo',
      horsepower: '330 hp',
      torque: '289 lb-ft',
      mass: '1560 kg',
      drive: 'AWD'
    }
  },
  mx5_na: {
    name: 'Mazda MX-5 NA',
    description: 'Lightweight roadster with room to tune.',
    modelYear: 1993,
    PerformanceClass: 'C',
    ClassType: 'Street',
    BasePISS: 410,
    CanUseDriftTyres: true,
    CanUseOffRoadTyres: false,
    stats: {
      engineSize: '1.8L I4',
      horsepower: '130 hp',
      torque: '110 lb-ft',
      mass: '980 kg',
      drive: 'RWD'
    }
  },
  subaru_brz_2013: {
    name: 'Subaru BRZ',
    description: 'Starter shipyard reward coupe.',
    modelYear: 2013,
    PerformanceClass: 'C',
    ClassType: 'Street',
    BasePISS: 430,
    CanUseDriftTyres: true,
    CanUseOffRoadTyres: false,
    mf: 'subaru',
    stats: {
      engineSize: '2.0L Boxer',
      horsepower: '200 hp',
      torque: '151 lb-ft',
      mass: '1270 kg',
      drive: 'RWD'
    }
  },
  supra_mk4: {
    name: 'Toyota Supra Mk4',
    description: 'High-speed showroom unlock with big top-end potential.',
    modelYear: 1998,
    PerformanceClass: 'A',
    ClassType: 'Street',
    BasePISS: 620,
    CanUseDriftTyres: true,
    CanUseOffRoadTyres: false,
    stats: {
      engineSize: '3.0L Twin Turbo',
      horsepower: '320 hp',
      torque: '315 lb-ft',
      mass: '1490 kg',
      drive: 'RWD'
    }
  },
  nissan_gtr_r35_2007: {
    name: 'Nissan GT-R R35',
    description: 'Tutorial hero car used for the opening police escape.',
    modelYear: 2007,
    PerformanceClass: 'S',
    ClassType: 'Street',
    BasePISS: 760,
    CanUseDriftTyres: true,
    CanUseOffRoadTyres: false,
    stats: {
      engineSize: '3.8L Twin Turbo V6',
      horsepower: '480 hp',
      torque: '430 lb-ft',
      mass: '1740 kg',
      drive: 'AWD'
    }
  },
  nissan_gtr_r35_2007_bensopra_ff6: {
    name: 'Nissan GT-R R35',
    description: 'OBB-verified modified tutorial GT-R used for the opening police escape.',
    modelYear: 2007,
    PerformanceClass: 'S',
    ClassType: 'Street',
    BasePISS: 760,
    CanUseDriftTyres: true,
    CanUseOffRoadTyres: false,
    stats: {
      engineSize: '3.8L Twin Turbo V6',
      horsepower: '480 hp',
      torque: '430 lb-ft',
      mass: '1740 kg',
      drive: 'AWD'
    }
  },
  ff_police_sedan_tokyo_01: {
    name: 'Tokyo Police Sedan',
    description: 'Police interceptor used during the first tutorial chase.',
    modelYear: 2015,
    PerformanceClass: 'A',
    ClassType: 'Street',
    BasePISS: 640,
    CanUseDriftTyres: false,
    CanUseOffRoadTyres: false,
    stats: {
      engineSize: '3.5L V6',
      horsepower: '320 hp',
      torque: '280 lb-ft',
      mass: '1650 kg',
      drive: 'RWD'
    }
  },
  ford_mustang_gt_2015: {
    name: 'Ford Mustang GT',
    description: 'Tutorial drag race player car.',
    modelYear: 2015,
    PerformanceClass: 'A',
    ClassType: 'Street',
    BasePISS: 700,
    CanUseDriftTyres: true,
    CanUseOffRoadTyres: false,
    stats: {
      engineSize: '5.0L V8',
      horsepower: '435 hp',
      torque: '400 lb-ft',
      mass: '1680 kg',
      drive: 'RWD'
    }
  },
  ford_torino_1972gran: {
    name: '1972 Ford Gran Torino',
    description: 'Classic rival car used during the early drag tutorial.',
    modelYear: 1972,
    PerformanceClass: 'C',
    ClassType: 'Street',
    BasePISS: 420,
    CanUseDriftTyres: false,
    CanUseOffRoadTyres: false,
    stats: {
      engineSize: '5.8L V8',
      horsepower: '250 hp',
      torque: '290 lb-ft',
      mass: '1800 kg',
      drive: 'RWD'
    }
  },
  honda_civic_euro_2012: {
    name: 'Honda Civic Euro',
    description: 'OBB-verified traffic car used in the opening street tutorial scene.',
    modelYear: 2012,
    PerformanceClass: 'B',
    ClassType: 'Street',
    BasePISS: 520,
    CanUseDriftTyres: false,
    CanUseOffRoadTyres: false,
    stats: {
      engineSize: '2.0L I4',
      horsepower: '198 hp',
      torque: '142 lb-ft',
      mass: '1320 kg',
      drive: 'FWD'
    }
  },
  traffic_sedan_compact_01_a: {
    name: 'Traffic Sedan',
    description: 'Tokyo intro traffic vehicle used by the street tutorial scene.',
    modelYear: 2012,
    PerformanceClass: 'D',
    ClassType: 'Traffic',
    BasePISS: 250,
    CanUseDriftTyres: false,
    CanUseOffRoadTyres: false
  },
  traffic_suv_compact_01_a: {
    name: 'Traffic SUV',
    description: 'Tokyo intro traffic SUV used by the street tutorial scene.',
    modelYear: 2012,
    PerformanceClass: 'D',
    ClassType: 'Traffic',
    BasePISS: 260,
    CanUseDriftTyres: false,
    CanUseOffRoadTyres: false
  },
  traffic_truck_medium_box_01_a: {
    name: 'Traffic Box Truck',
    description: 'Tokyo intro traffic truck used by the street tutorial scene.',
    modelYear: 2012,
    PerformanceClass: 'D',
    ClassType: 'Traffic',
    BasePISS: 220,
    CanUseDriftTyres: false,
    CanUseOffRoadTyres: false
  },
  traffic_sedan_compact_01_cinematic: {
    name: 'Traffic Sedan Cinematic',
    description: 'Cinematic traffic sedan used by the Tokyo street intro sequence.',
    modelYear: 2012,
    PerformanceClass: 'D',
    ClassType: 'Traffic',
    BasePISS: 250,
    CanUseDriftTyres: false,
    CanUseOffRoadTyres: false
  }
};

const vehicleAssetAliases = {
  gtr_r34: 'nissan_skyline_gtr_bnr34_2002',
  mx5_na: 'subaru_brz_2013',
  bmw_1m_coupe: 'bmw_1m_coupe_2011',
  supra_mk4: 'subaru_brz_2013',
  ford_torino_1972gran: 'ford_gran_torino_1972_ff4'
};

const vehicleMetaTemplates = {
  nissan_gtr_r35_2007: {
    m: 1550,
    fn: '2007 NISSAN SKYLINE GT-R (R35)',
    cpp: 'Bundles/cars/base/assets/attributes/stock/car_attribute_nissan_gtr_r35_2007',
    tbp: 'Bundles/UITextures/Thumbnails/nissan_gtr_r35_2007',
    cty: 'stock',
    mtq: 519.8591,
    ms: 70,
    fs: { y: 40, x: 40 },
    cd: 20,
    fcs: '0.14&10000&600&0',
    fev: { y: 6.5, x: 6.5 },
    snd: 5,
    bst: 1,
    dvu: '478827137&-1&-1&-1&-1&-1541609369&-1&343594858&-1&-1776677561&-1&-300134898&-300134898&1304612902&-1',
    ncvu: 'BODY_PAINT&DECAL_BODY&DECAL_HOOD&VINYL&UNDERGLOW&SPOILER&SPOILER_MATERIAL&RIM_FRONT&RIM_MATERIAL_FRONT&RIM_REAR&RIM_MATERIAL_REAR&TIRE_FRONT&TIRE_REAR&LENSFLARE&BODYKIT',
    ncvuh: '-744524965&2003198165&1283149304&1361827634&-1776961364&-484631542',
    mdrpm: 8000,
    ngr: '0&0.25&0.5&1&1&1&1',
    ss: { y: 1.9, x: 2.1 },
    mrrpm: 4800,
    nd: 3,
    snt: 350,
    mrpm: 7200,
    rcs: '0.17&8200&492&0',
    kd: { y: 0.08, x: 0.15 },
    cof: 0.27,
    nt: 350,
    mxrpm: 5000,
    fes: 1,
    com: { y: 0.2, z: 0, x: 0 },
    sas: 3,
    soff: '0&0',
    sav: { y: 800, x: 900 },
    kp: { y: 0.305, x: 0.4 },
    fas: 3,
    rt: 21600,
    tsu: 25,
    rvu: '[]',
    rz: 7000,
    cset: 'none',
    frd: 30,
    at: 1,
    ses: 1,
    rsc: 100,
    sev: { y: 900, x: 1000 },
    pidst: { y: 71.2, x: 17.8 },
    psrpm: '4400&6900&6900&6900&6900&6900&7200',
    et: 2,
    egr: '0&4.056&2.301&1.595&1.248&1.001&0.796',
    pi: 506,
    rwd: 0.5,
    c: 5,
    fd: 0.3,
    mf: 'nissan',
    fav: { y: 5.5, x: 5.5 },
    tcc: 1000,
    l: 'Bundles/UITextures/CarBrands/CarBrand_Nissan'
  },
  nissan_gtr_r35_2007_bensopra_ff6: {
    m: 1440,
    fn: '2007 NISSAN SKYLINE GT-R BEN SOPRA',
    cpp: 'Bundles/cars/base/assets/attributes/stock/car_attribute_nissan_gtr_r35_2007_bensopra_ff6',
    tbp: 'Bundles/UITextures/Thumbnails/nissan_gtr_r35_2007_bensopra_ff6',
    cty: 'hero',
    mtq: 741.701,
    ms: 70,
    fs: { y: 40, x: 40 },
    cd: 20,
    fcs: '0.1&10000&600&0',
    fev: { y: 7, x: 7 },
    snd: 5,
    bst: 1.25,
    dvu: '999662577&-1&-1&-1&-1&-1284935807&-1&906752821&-1&906752821&-1&-4484383&-4484383&-842039736&-1',
    ncvu: 'BODY_PAINT&DECAL_BODY&DECAL_HOOD&VINYL&UNDERGLOW&SPOILER&SPOILER_MATERIAL&RIM_FRONT&RIM_MATERIAL_FRONT&RIM_REAR&RIM_MATERIAL_REAR&TIRE_FRONT&TIRE_REAR&LENSFLARE&BODYKIT',
    ncvuh: '-744524965&2003198165&1283149304&1361827634&-1776961364&-484631542',
    mdrpm: 8000,
    ngr: '0&0.25&0.5&1&1&1&1',
    ss: { y: 1.9, x: 2.1 },
    mrrpm: 4500,
    nd: 3,
    snt: 600,
    mrpm: 7200,
    rcs: '0.12&8200&492&0',
    kd: { y: 0.08, x: 0.15 },
    cof: 0.33,
    nt: 400,
    mxrpm: 4700,
    fes: 1,
    com: { y: 0.2, z: 0, x: 0 },
    sas: 3,
    soff: '0&0',
    sav: { y: 800, x: 900 },
    kp: { y: 0.305, x: 0.4 },
    fas: 3,
    rt: 28800,
    tsu: 25,
    rvu: '[]',
    rz: 7000,
    cset: 'none',
    frd: 30,
    at: 1,
    ses: 1,
    rsc: 100,
    sev: { y: 900, x: 1000 },
    pidst: { y: 71.2, x: 17.8 },
    psrpm: '4400&6900&6900&6900&6900&6900&7200',
    et: 2,
    egr: '0&4.056&2.301&1.595&1.248&1.001&0.796',
    pi: 654,
    rwd: 0.5996929,
    c: 6,
    fd: 0.5,
    mf: 'nissan',
    fav: { y: 6, x: 6 },
    tcc: 1000,
    l: 'Bundles/UITextures/CarBrands/CarBrand_Nissan'
  },
  ff_police_sedan_tokyo_01: {
    m: 1977,
    fn: '2012 DODGE CHARGER SRT8',
    cpp: 'Bundles/cars/base/assets/attributes/stock/car_attribute_ff_police_sedan_tokyo_01',
    tbp: 'Bundles/UITextures/Thumbnails/ff_police_sedan_tokyo_01',
    cty: 'stock',
    mtq: 470.3075,
    ms: 70,
    fs: { y: 50, x: 50 },
    cd: 20,
    fcs: '0.17&10000&600&0',
    fev: { y: 8, x: 8 },
    snd: 5,
    bst: 1,
    dvu: '1726005191&-1&-1&-1529782529&-1&-1&-1&701656725&-1&701656725&-1&1866806616&1866806616&-842039736&-1',
    ncvu: '',
    ncvuh: '',
    mdrpm: 7000,
    ngr: '0&0.25&0.5&1&1&1&1',
    ss: { y: 1.9, x: 2.1 },
    pidst: { y: 71.2, x: 17.8 },
    nd: 3,
    snt: 525,
    mrpm: 6500,
    rcs: '0.19&8200&492&0',
    kd: { y: 0.08, x: 0.15 },
    cof: 0.338,
    nt: 250,
    mxrpm: 4700,
    fes: 1,
    com: { y: 0.2, z: 0, x: 0 },
    sas: 3,
    soff: '0&0',
    sav: { y: 800, x: 900 },
    kp: { y: 0.305, x: 0.4 },
    fas: 4,
    rt: 3600,
    mrrpm: 4500,
    rvu: '[]',
    rz: 6250,
    cset: 'none',
    frd: 30,
    ses: 1,
    rsc: 100,
    sev: { y: 900, x: 1000 },
    psrpm: '3150&6200&6200&6200&6200&6500',
    et: 4,
    egr: '0&3.59&2.19&1.41&1&0.83',
    pi: 437,
    rwd: 0.5500019,
    c: 3,
    fd: 0.7,
    mf: 'misc',
    fav: { y: 6.5, x: 6.5 },
    tcc: 1000,
    l: 'Bundles/UITextures/CarBrands/CarBrand_Dodge'
  },
  traffic_sedan_compact_01_a: {
    fn: 'TOKYO TRAFFIC SEDAN',
    cpp: 'Vehicles/TrafficVehicles/traffic_sedan_compact_01_a',
    tbp: 'Vehicles/TrafficVehicles/traffic_sedan_compact_01_a',
    cty: 'traffic',
    PrefabName: 'traffic_sedan_compact_01_a',
    carPrefabPath: 'Vehicles/TrafficVehicles/traffic_sedan_compact_01_a',
    PartPathRoot: 'Vehicles/TrafficVehicles/',
    dvu: '-1&-1&-1&-1&-1&-1&-1&-1&-1&-1&-1&-1&-1&-1&-1',
    ncvu: '',
    ncvuh: '',
    rvu: '[]',
    pi: 120,
    c: 0,
    mf: 'traffic'
  },
  traffic_suv_compact_01_a: {
    fn: 'TOKYO TRAFFIC SUV',
    cpp: 'Vehicles/TrafficVehicles/traffic_suv_compact_01_a',
    tbp: 'Vehicles/TrafficVehicles/traffic_suv_compact_01_a',
    cty: 'traffic',
    PrefabName: 'traffic_suv_compact_01_a',
    carPrefabPath: 'Vehicles/TrafficVehicles/traffic_suv_compact_01_a',
    PartPathRoot: 'Vehicles/TrafficVehicles/',
    dvu: '-1&-1&-1&-1&-1&-1&-1&-1&-1&-1&-1&-1&-1&-1&-1',
    ncvu: '',
    ncvuh: '',
    rvu: '[]',
    pi: 120,
    c: 0,
    mf: 'traffic'
  },
  traffic_truck_medium_box_01_a: {
    fn: 'TOKYO TRAFFIC BOX TRUCK',
    cpp: 'Vehicles/TrafficVehicles/traffic_truck_medium_box_01_a',
    tbp: 'Vehicles/TrafficVehicles/traffic_truck_medium_box_01_a',
    cty: 'traffic',
    PrefabName: 'traffic_truck_medium_box_01_a',
    carPrefabPath: 'Vehicles/TrafficVehicles/traffic_truck_medium_box_01_a',
    PartPathRoot: 'Vehicles/TrafficVehicles/',
    dvu: '-1&-1&-1&-1&-1&-1&-1&-1&-1&-1&-1&-1&-1&-1&-1',
    ncvu: '',
    ncvuh: '',
    rvu: '[]',
    pi: 120,
    c: 0,
    mf: 'traffic'
  },
  traffic_sedan_compact_01_cinematic: {
    fn: 'TOKYO TRAFFIC SEDAN CINEMATIC',
    cpp: 'Vehicles/TrafficVehicles/traffic_sedan_compact_01_cinematic',
    tbp: 'Vehicles/TrafficVehicles/traffic_sedan_compact_01_cinematic',
    cty: 'traffic',
    PrefabName: 'traffic_sedan_compact_01_cinematic',
    carPrefabPath: 'Vehicles/TrafficVehicles/traffic_sedan_compact_01_cinematic',
    PartPathRoot: 'Vehicles/TrafficVehicles/',
    dvu: '-1&-1&-1&-1&-1&-1&-1&-1&-1&-1&-1&-1&-1&-1&-1',
    ncvu: '',
    ncvuh: '',
    rvu: '[]',
    pi: 120,
    c: 0,
    mf: 'traffic'
  },
  subaru_brz_2013: {
    fn: '2013 SUBARU BRZ',
    cpp: 'Bundles/cars/base/assets/attributes/stock/car_attribute_subaru_brz_2013',
    tbp: 'Bundles/UITextures/Thumbnails/subaru_brz_2013',
    cty: 'stock',
    mtq: 151.9364,
    ms: 70,
    fs: { y: 40, x: 40 },
    cd: 20,
    fcs: '0.14&10000&600&0',
    fev: { y: 6.5, x: 6.5 },
    snd: 5,
    bst: 1,
    dvu: '0&0&0&0&0&0&0&0&0&0&0&0&0&0&0',
    ncvu: '',
    ncvuh: '',
    rvu: '[]',
    mdrpm: 7600,
    ngr: '0&0.25&0.5&1&1&1&1',
    ss: { y: 1.9, x: 2.1 },
    mrrpm: 4700,
    nd: 3,
    snt: 350,
    mrpm: 7200,
    rcs: '0.17&8200&492&0',
    kd: { y: 0.08, x: 0.15 },
    cof: 0.27,
    nt: 150,
    mxrpm: 5000,
    fes: 1,
    com: { y: 0.2, z: 0, x: 0 },
    sas: 3,
    soff: '0&0',
    sav: { y: 800, x: 900 },
    kp: { y: 0.305, x: 0.4 },
    fas: 3,
    rt: 10800,
    tsu: 15,
    rz: 7000,
    cset: 'none',
    frd: 30,
    at: 0,
    ses: 1,
    rsc: 100,
    sev: { y: 900, x: 1000 },
    pidst: { y: 71.2, x: 17.8 },
    psrpm: '3150&6200&6200&6200&6200&6500',
    et: 2,
    egr: '0&3.59&2.19&1.41&1&0.83',
    pi: 278,
    rwd: 0.55,
    c: 1,
    fd: 0.7,
    mf: 'subaru',
    fav: { y: 5.5, x: 5.5 },
    tcc: 1000,
    l: 'Bundles/UITextures/CarBrands/CarBrand_Subaru'
  },
  honda_civic_euro_2012: {
    fn: '2012 HONDA CIVIC EURO',
    cpp: 'Bundles/cars/base/assets/attributes/stock/car_attribute_honda_civic_euro_2012',
    tbp: 'Bundles/UITextures/Thumbnails/honda_civic_euro_2012',
    cty: 'stock',
    mtq: 192.5187,
    ms: 70,
    fs: { y: 40, x: 40 },
    cd: 20,
    fcs: '0.14&10000&600&0',
    fev: { y: 6.5, x: 6.5 },
    snd: 5,
    bst: 1,
    dvu: '0&0&0&0&0&0&0&0&0&0&0&0&0&0&0',
    ncvu: '',
    ncvuh: '',
    rvu: '[]',
    mdrpm: 7800,
    ngr: '0&0.25&0.5&1&1&1&1',
    ss: { y: 1.9, x: 2.1 },
    mrrpm: 4800,
    nd: 3,
    snt: 350,
    mrpm: 7200,
    rcs: '0.17&8200&492&0',
    kd: { y: 0.08, x: 0.15 },
    cof: 0.27,
    nt: 180,
    mxrpm: 5000,
    fes: 1,
    com: { y: 0.2, z: 0, x: 0 },
    sas: 3,
    soff: '0&0',
    sav: { y: 800, x: 900 },
    kp: { y: 0.305, x: 0.4 },
    fas: 3,
    rt: 10800,
    tsu: 15,
    rz: 7000,
    cset: 'none',
    frd: 30,
    at: 0,
    ses: 1,
    rsc: 100,
    sev: { y: 900, x: 1000 },
    pidst: { y: 71.2, x: 17.8 },
    psrpm: '4400&6900&6900&6900&6900&6900&7200',
    et: 2,
    egr: '0&4.056&2.301&1.595&1.248&1.001&0.796',
    pi: 520,
    rwd: 0.45,
    c: 2,
    fd: 0.3,
    mf: 'honda',
    fav: { y: 5.5, x: 5.5 },
    tcc: 1000,
    l: 'Bundles/UITextures/CarBrands/CarBrand_Honda'
  },
  ford_mustang_gt_2015: {
    m: 1684,
    fn: '2015 MUSTANG GT',
    cpp: 'Bundles/cars/base/assets/attributes/stock/car_attribute_ford_mustang_gt_2015',
    tbp: 'Bundles/UITextures/Thumbnails/ford_mustang_gt_2015',
    cty: 'stock',
    mtq: 401.2964,
    ms: 70,
    fs: { y: 50, x: 50 },
    cd: 20,
    fcs: '0.15&10000&600&0',
    fev: { y: 8, x: 8 },
    snd: 5,
    bst: 1.25,
    dvu: '-2037675763&-1&-1&-1&-1&-1&-1&1772279311&-1&1772279311&-1&-300134898&-300134898&1304612902&-91876782',
    ncvuh: '',
    mdrpm: 8500,
    ngr: '0&0.25&0.5&1&1&1&1',
    ss: { y: 1.9, x: 2.1 },
    mrrpm: 6000,
    nd: 3,
    snt: 600,
    slvgc: 30000,
    mrpm: 7700,
    rcs: '0.16&8200&492&0',
    kd: { y: 0.08, x: 0.15 },
    cof: 0.32,
    nt: 350,
    mxrpm: 6200,
    fes: 1,
    com: { y: 0.2, z: 0, x: 0 },
    sas: 3,
    soff: '0&0',
    sav: { y: 800, x: 900 },
    kp: { y: 0.305, x: 0.4 },
    fas: 4,
    rt: 14400,
    tsu: 25,
    ncvu: '',
    rvu: '[]',
    rz: 7500,
    cset: 'none',
    frd: 30,
    ses: 1,
    rsc: 100,
    sev: { y: 900, x: 1000 },
    pidst: { y: 71.2, x: 17.8 },
    psrpm: '4250&7400&7400&7400&7400&7400&7700',
    et: 4,
    egr: '0&3.657&2.43&1.686&1.315&1&0.651',
    pi: 440,
    rwd: 0.5,
    c: 4,
    fd: 0.5,
    mf: 'ford',
    fav: { y: 6.5, x: 6.5 },
    tcc: 1000,
    l: 'Bundles/UITextures/CarBrands/CarBrand_Ford'
  },
  ford_gran_torino_1972_ff4: {
    m: 1768,
    fn: "LETTY'S 1972 FORD GRAN TORINO",
    cpp: 'Bundles/cars/base/assets/attributes/stock/car_attribute_ford_gran_torino_1972_ff4',
    tbp: 'Bundles/UITextures/Thumbnails/ford_gran_torino_1972_ff4',
    cty: 'stock',
    mtq: 324.7374,
    ms: 70,
    fs: { y: 50, x: 50 },
    cd: 20,
    fcs: '0.12&10000&600&0',
    fev: { y: 8, x: 8 },
    snd: 5,
    bst: 1.25,
    dvu: '1289556431&-1&-1&-1804020449&-1&-1&-1&-2132144339&-1&-2132144339&-1&-1036232316&1097930819&1409553428&-1',
    ncvu: '',
    ncvuh: '',
    mdrpm: 6000,
    ngr: '0&0.25&0.5&1&1&1&1',
    ss: { y: 1.9, x: 2.1 },
    mrrpm: 4300,
    nd: 3,
    snt: 600,
    mrpm: 5700,
    rcs: '0.16&8200&492&0',
    kd: { y: 0.08, x: 0.15 },
    cof: 0.5,
    nt: 50,
    mxrpm: 4500,
    fes: 1,
    com: { y: 0.2, z: 0, x: 0 },
    sas: 3,
    soff: '0&0',
    sav: { y: 800, x: 900 },
    kp: { y: 0.305, x: 0.4 },
    fas: 4,
    rt: 3600,
    tsu: 20,
    rvu: '[]',
    rz: 5500,
    cset: 'none',
    frd: 30,
    ses: 1,
    rsc: 100,
    sev: { y: 900, x: 1000 },
    pidst: { y: 71.2, x: 17.8 },
    psrpm: '3150&5400&5400&5400&5700',
    et: 5,
    egr: '0&2.78&1.93&1.36&1',
    pi: 327,
    rwd: 0.5996929,
    c: 1,
    fd: 0.7,
    mf: 'ford',
    fav: { y: 6, x: 6 },
    tcc: 1000,
    l: 'Bundles/UITextures/CarBrands/CarBrand_Ford'
  },

  // ── Box candidate cars (minimal entries so they're "supported" for gacha) ──
  subaru_impreza_wrx_sti_2009: {
    fn: '2009 SUBARU IMPREZA WRX STI',
    cpp: 'Bundles/cars/base/assets/attributes/stock/car_attribute_subaru_impreza_wrx_sti_2009',
    tbp: 'Bundles/UITextures/Thumbnails/subaru_impreza_wrx_sti_2009',
    cty: 'stock', dvu: '0&0&0&0&0&0&0&0&0&0&0&0&0&0&0', ncvu: '', ncvuh: '', rvu: '[]',
    pi: 340, c: 2, mf: 'subaru', l: 'Bundles/UITextures/CarBrands/CarBrand_Subaru'
  },
  ford_escort_rs_cosworth_1992: {
    fn: '1992 FORD ESCORT RS COSWORTH',
    cpp: 'Bundles/cars/base/assets/attributes/stock/car_attribute_ford_escort_rs_cosworth_1992',
    tbp: 'Bundles/UITextures/Thumbnails/ford_escort_rs_cosworth_1992',
    cty: 'stock', dvu: '0&0&0&0&0&0&0&0&0&0&0&0&0&0&0', ncvu: '', ncvuh: '', rvu: '[]',
    pi: 320, c: 2, mf: 'ford', l: 'Bundles/UITextures/CarBrands/CarBrand_Ford'
  },
  nissan_350z_2008: {
    fn: '2008 NISSAN 350Z',
    cpp: 'Bundles/cars/base/assets/attributes/stock/car_attribute_nissan_350z_2008',
    tbp: 'Bundles/UITextures/Thumbnails/nissan_350z_2008',
    cty: 'stock', dvu: '0&0&0&0&0&0&0&0&0&0&0&0&0&0&0', ncvu: '', ncvuh: '', rvu: '[]',
    pi: 310, c: 2, mf: 'nissan', l: 'Bundles/UITextures/CarBrands/CarBrand_Nissan'
  },
  honda_s2000_cr_2009: {
    fn: '2009 HONDA S2000 CR',
    cpp: 'Bundles/cars/base/assets/attributes/stock/car_attribute_honda_s2000_cr_2009',
    tbp: 'Bundles/UITextures/Thumbnails/honda_s2000_cr_2009',
    cty: 'stock', dvu: '0&0&0&0&0&0&0&0&0&0&0&0&0&0&0', ncvu: '', ncvuh: '', rvu: '[]',
    pi: 330, c: 2, mf: 'honda', l: 'Bundles/UITextures/CarBrands/CarBrand_Honda'
  },
  acura_rsx_type_s_2006: {
    fn: '2006 ACURA RSX TYPE-S',
    cpp: 'Bundles/cars/base/assets/attributes/stock/car_attribute_acura_rsx_type_s_2006',
    tbp: 'Bundles/UITextures/Thumbnails/acura_rsx_type_s_2006',
    cty: 'stock', dvu: '0&0&0&0&0&0&0&0&0&0&0&0&0&0&0', ncvu: '', ncvuh: '', rvu: '[]',
    pi: 295, c: 2, mf: 'acura', l: 'Bundles/UITextures/CarBrands/CarBrand_Acura'
  },
  hyundai_genesis_coupe_2013: {
    fn: '2013 HYUNDAI GENESIS COUPE',
    cpp: 'Bundles/cars/base/assets/attributes/stock/car_attribute_hyundai_genesis_coupe_2013',
    tbp: 'Bundles/UITextures/Thumbnails/hyundai_genesis_coupe_2013',
    cty: 'stock', dvu: '0&0&0&0&0&0&0&0&0&0&0&0&0&0&0', ncvu: '', ncvuh: '', rvu: '[]',
    pi: 300, c: 2, mf: 'hyundai', l: 'Bundles/UITextures/CarBrands/CarBrand_Hyundai'
  },
  ford_focus_st_2013: {
    fn: '2013 FORD FOCUS ST',
    cpp: 'Bundles/cars/base/assets/attributes/stock/car_attribute_ford_focus_st_2013',
    tbp: 'Bundles/UITextures/Thumbnails/ford_focus_st_2013',
    cty: 'stock', dvu: '0&0&0&0&0&0&0&0&0&0&0&0&0&0&0', ncvu: '', ncvuh: '', rvu: '[]',
    pi: 290, c: 2, mf: 'ford', l: 'Bundles/UITextures/CarBrands/CarBrand_Ford'
  },
  honda_prelude_type_s_2001: {
    fn: '2001 HONDA PRELUDE TYPE S',
    cpp: 'Bundles/cars/base/assets/attributes/stock/car_attribute_honda_prelude_type_s_2001',
    tbp: 'Bundles/UITextures/Thumbnails/honda_prelude_type_s_2001',
    cty: 'stock', dvu: '0&0&0&0&0&0&0&0&0&0&0&0&0&0&0', ncvu: '', ncvuh: '', rvu: '[]',
    pi: 285, c: 1, mf: 'honda', l: 'Bundles/UITextures/CarBrands/CarBrand_Honda'
  },
  hyundai_veloster_2012: {
    fn: '2012 HYUNDAI VELOSTER',
    cpp: 'Bundles/cars/base/assets/attributes/stock/car_attribute_hyundai_veloster_2012',
    tbp: 'Bundles/UITextures/Thumbnails/hyundai_veloster_2012',
    cty: 'stock', dvu: '0&0&0&0&0&0&0&0&0&0&0&0&0&0&0', ncvu: '', ncvuh: '', rvu: '[]',
    pi: 270, c: 1, mf: 'hyundai', l: 'Bundles/UITextures/CarBrands/CarBrand_Hyundai'
  },
  ford_escort_rs2000_1986_ff6: {
    fn: "BRIAN'S 1986 FORD ESCORT RS2000",
    cpp: 'Bundles/cars/base/assets/attributes/stock/car_attribute_ford_escort_rs2000_1986_ff6',
    tbp: 'Bundles/UITextures/Thumbnails/ford_escort_rs2000_1986_ff6',
    cty: 'hero', dvu: '0&0&0&0&0&0&0&0&0&0&0&0&0&0&0', ncvu: '', ncvuh: '', rvu: '[]',
    pi: 300, c: 2, mf: 'ford', l: 'Bundles/UITextures/CarBrands/CarBrand_Ford'
  },
  ford_escort_rs2000_1986: {
    fn: '1986 FORD ESCORT RS2000',
    cpp: 'Bundles/cars/base/assets/attributes/stock/car_attribute_ford_escort_rs2000_1986',
    tbp: 'Bundles/UITextures/Thumbnails/ford_escort_rs2000_1986',
    cty: 'stock', dvu: '0&0&0&0&0&0&0&0&0&0&0&0&0&0&0', ncvu: '', ncvuh: '', rvu: '[]',
    pi: 280, c: 1, mf: 'ford', l: 'Bundles/UITextures/CarBrands/CarBrand_Ford'
  },
  dodge_dart_gt_2013: {
    fn: '2013 DODGE DART GT',
    cpp: 'Bundles/cars/base/assets/attributes/stock/car_attribute_dodge_dart_gt_2013',
    tbp: 'Bundles/UITextures/Thumbnails/dodge_dart_gt_2013',
    cty: 'stock', dvu: '0&0&0&0&0&0&0&0&0&0&0&0&0&0&0', ncvu: '', ncvuh: '', rvu: '[]',
    pi: 260, c: 1, mf: 'dodge', l: 'Bundles/UITextures/CarBrands/CarBrand_Dodge'
  },
  pontiac_firebird_1981: {
    fn: '1981 PONTIAC FIREBIRD',
    cpp: 'Bundles/cars/base/assets/attributes/stock/car_attribute_pontiac_firebird_1981',
    tbp: 'Bundles/UITextures/Thumbnails/pontiac_firebird_1981',
    cty: 'stock', dvu: '0&0&0&0&0&0&0&0&0&0&0&0&0&0&0', ncvu: '', ncvuh: '', rvu: '[]',
    pi: 250, c: 1, mf: 'pontiac', l: 'Bundles/UITextures/CarBrands/CarBrand_Pontiac'
  },
  honda_nsx_r_2002: {
    fn: '2002 HONDA NSX-R',
    cpp: 'Bundles/cars/base/assets/attributes/stock/car_attribute_honda_nsx_r_2002',
    tbp: 'Bundles/UITextures/Thumbnails/honda_nsx_r_2002',
    cty: 'stock', dvu: '0&0&0&0&0&0&0&0&0&0&0&0&0&0&0', ncvu: '', ncvuh: '', rvu: '[]',
    pi: 490, c: 4, mf: 'honda', l: 'Bundles/UITextures/CarBrands/CarBrand_Honda'
  },
  cadillac_ctsv_2011: {
    fn: '2011 CADILLAC CTS-V',
    cpp: 'Bundles/cars/base/assets/attributes/stock/car_attribute_cadillac_ctsv_2011',
    tbp: 'Bundles/UITextures/Thumbnails/cadillac_ctsv_2011',
    cty: 'stock', dvu: '0&0&0&0&0&0&0&0&0&0&0&0&0&0&0', ncvu: '', ncvuh: '', rvu: '[]',
    pi: 470, c: 4, mf: 'cadillac', l: 'Bundles/UITextures/CarBrands/CarBrand_Cadillac'
  },
  cadillac_cts_vsport_2014: {
    fn: '2014 CADILLAC CTS VSPORT',
    cpp: 'Bundles/cars/base/assets/attributes/stock/car_attribute_cadillac_cts_vsport_2014',
    tbp: 'Bundles/UITextures/Thumbnails/cadillac_cts_vsport_2014',
    cty: 'stock', dvu: '0&0&0&0&0&0&0&0&0&0&0&0&0&0&0', ncvu: '', ncvuh: '', rvu: '[]',
    pi: 460, c: 4, mf: 'cadillac', l: 'Bundles/UITextures/CarBrands/CarBrand_Cadillac'
  },
  subaru_wrx_sti_2015: {
    fn: '2015 SUBARU WRX STI',
    cpp: 'Bundles/cars/base/assets/attributes/stock/car_attribute_subaru_wrx_sti_2015',
    tbp: 'Bundles/UITextures/Thumbnails/subaru_wrx_sti_2015',
    cty: 'stock', dvu: '0&0&0&0&0&0&0&0&0&0&0&0&0&0&0', ncvu: '', ncvuh: '', rvu: '[]',
    pi: 455, c: 3, mf: 'subaru', l: 'Bundles/UITextures/CarBrands/CarBrand_Subaru'
  },
  bmw_m3_e92_gts_2011: {
    fn: '2011 BMW M3 E92 GTS',
    cpp: 'Bundles/cars/base/assets/attributes/stock/car_attribute_bmw_m3_e92_gts_2011',
    tbp: 'Bundles/UITextures/Thumbnails/bmw_m3_e92_gts_2011',
    cty: 'stock', dvu: '0&0&0&0&0&0&0&0&0&0&0&0&0&0&0', ncvu: '', ncvuh: '', rvu: '[]',
    pi: 450, c: 3, mf: 'bmw', l: 'Bundles/UITextures/CarBrands/CarBrand_BMW'
  },
  dodge_charger_2015: {
    fn: '2015 DODGE CHARGER',
    cpp: 'Bundles/cars/base/assets/attributes/stock/car_attribute_dodge_charger_2015',
    tbp: 'Bundles/UITextures/Thumbnails/dodge_charger_2015',
    cty: 'stock', dvu: '0&0&0&0&0&0&0&0&0&0&0&0&0&0&0', ncvu: '', ncvuh: '', rvu: '[]',
    pi: 445, c: 3, mf: 'dodge', l: 'Bundles/UITextures/CarBrands/CarBrand_Dodge'
  },
  dodge_challenger_srt8_2012: {
    fn: '2012 DODGE CHALLENGER SRT8',
    cpp: 'Bundles/cars/base/assets/attributes/stock/car_attribute_dodge_challenger_srt8_2012',
    tbp: 'Bundles/UITextures/Thumbnails/dodge_challenger_srt8_2012',
    cty: 'stock', dvu: '0&0&0&0&0&0&0&0&0&0&0&0&0&0&0', ncvu: '', ncvuh: '', rvu: '[]',
    pi: 445, c: 3, mf: 'dodge', l: 'Bundles/UITextures/CarBrands/CarBrand_Dodge'
  },
  dodge_charger_srt8_2012: {
    fn: '2012 DODGE CHARGER SRT8',
    cpp: 'Bundles/cars/base/assets/attributes/stock/car_attribute_dodge_charger_srt8_2012',
    tbp: 'Bundles/UITextures/Thumbnails/dodge_charger_srt8_2012',
    cty: 'stock', dvu: '0&0&0&0&0&0&0&0&0&0&0&0&0&0&0', ncvu: '', ncvuh: '', rvu: '[]',
    pi: 440, c: 3, mf: 'dodge', l: 'Bundles/UITextures/CarBrands/CarBrand_Dodge'
  },
  chevrolet_camaro_zl1_2012: {
    fn: '2012 CHEVROLET CAMARO ZL1',
    cpp: 'Bundles/cars/base/assets/attributes/stock/car_attribute_chevrolet_camaro_zl1_2012',
    tbp: 'Bundles/UITextures/Thumbnails/chevrolet_camaro_zl1_2012',
    cty: 'stock', dvu: '0&0&0&0&0&0&0&0&0&0&0&0&0&0&0', ncvu: '', ncvuh: '', rvu: '[]',
    pi: 445, c: 3, mf: 'chevrolet', l: 'Bundles/UITextures/CarBrands/CarBrand_Chevrolet'
  },
  ford_mustang_boss_302_2012: {
    fn: '2012 FORD MUSTANG BOSS 302',
    cpp: 'Bundles/cars/base/assets/attributes/stock/car_attribute_ford_mustang_boss_302_2012',
    tbp: 'Bundles/UITextures/Thumbnails/ford_mustang_boss_302_2012',
    cty: 'stock', dvu: '0&0&0&0&0&0&0&0&0&0&0&0&0&0&0', ncvu: '', ncvuh: '', rvu: '[]',
    pi: 435, c: 3, mf: 'ford', l: 'Bundles/UITextures/CarBrands/CarBrand_Ford'
  },
  bmw_m3_e30_1989: {
    fn: '1989 BMW M3 E30',
    cpp: 'Bundles/cars/base/assets/attributes/stock/car_attribute_bmw_m3_e30_1989',
    tbp: 'Bundles/UITextures/Thumbnails/bmw_m3_e30_1989',
    cty: 'stock', dvu: '0&0&0&0&0&0&0&0&0&0&0&0&0&0&0', ncvu: '', ncvuh: '', rvu: '[]',
    pi: 420, c: 3, mf: 'bmw', l: 'Bundles/UITextures/CarBrands/CarBrand_BMW'
  },
  bmw_z4_35is_2011: {
    fn: '2011 BMW Z4 35IS',
    cpp: 'Bundles/cars/base/assets/attributes/stock/car_attribute_bmw_z4_35is_2011',
    tbp: 'Bundles/UITextures/Thumbnails/bmw_z4_35is_2011',
    cty: 'stock', dvu: '0&0&0&0&0&0&0&0&0&0&0&0&0&0&0', ncvu: '', ncvuh: '', rvu: '[]',
    pi: 425, c: 3, mf: 'bmw', l: 'Bundles/UITextures/CarBrands/CarBrand_BMW'
  },
  nissan_370z_2013: {
    fn: '2013 NISSAN 370Z',
    cpp: 'Bundles/cars/base/assets/attributes/stock/car_attribute_nissan_370z_2013',
    tbp: 'Bundles/UITextures/Thumbnails/nissan_370z_2013',
    cty: 'stock', dvu: '0&0&0&0&0&0&0&0&0&0&0&0&0&0&0', ncvu: '', ncvuh: '', rvu: '[]',
    pi: 410, c: 3, mf: 'nissan', l: 'Bundles/UITextures/CarBrands/CarBrand_Nissan'
  },
  acura_integra_type_r_2001: {
    fn: '2001 ACURA INTEGRA TYPE-R',
    cpp: 'Bundles/cars/base/assets/attributes/stock/car_attribute_acura_integra_type_r_2001',
    tbp: 'Bundles/UITextures/Thumbnails/acura_integra_type_r_2001',
    cty: 'stock', dvu: '0&0&0&0&0&0&0&0&0&0&0&0&0&0&0', ncvu: '', ncvuh: '', rvu: '[]',
    pi: 415, c: 3, mf: 'acura', l: 'Bundles/UITextures/CarBrands/CarBrand_Acura'
  },
  subaru_impreza_wrx_sti_4dr_2012: {
    fn: '2012 SUBARU IMPREZA WRX STI',
    cpp: 'Bundles/cars/base/assets/attributes/stock/car_attribute_subaru_impreza_wrx_sti_4dr_2012',
    tbp: 'Bundles/UITextures/Thumbnails/subaru_impreza_wrx_sti_4dr_2012',
    cty: 'stock', dvu: '0&0&0&0&0&0&0&0&0&0&0&0&0&0&0', ncvu: '', ncvuh: '', rvu: '[]',
    pi: 420, c: 3, mf: 'subaru', l: 'Bundles/UITextures/CarBrands/CarBrand_Subaru'
  },
  chevrolet_camaro_ss_rs_1969: {
    fn: '1969 CHEVROLET CAMARO SS/RS',
    cpp: 'Bundles/cars/base/assets/attributes/stock/car_attribute_chevrolet_camaro_ss_rs_1969',
    tbp: 'Bundles/UITextures/Thumbnails/chevrolet_camaro_ss_rs_1969',
    cty: 'stock', dvu: '0&0&0&0&0&0&0&0&0&0&0&0&0&0&0', ncvu: '', ncvuh: '', rvu: '[]',
    pi: 390, c: 2, mf: 'chevrolet', l: 'Bundles/UITextures/CarBrands/CarBrand_Chevrolet'
  },
  ford_gran_torino_1972: {
    fn: '1972 FORD GRAN TORINO',
    cpp: 'Bundles/cars/base/assets/attributes/stock/car_attribute_ford_gran_torino_1972',
    tbp: 'Bundles/UITextures/Thumbnails/ford_gran_torino_1972',
    cty: 'stock', dvu: '0&0&0&0&0&0&0&0&0&0&0&0&0&0&0', ncvu: '', ncvuh: '', rvu: '[]',
    pi: 350, c: 2, mf: 'ford', l: 'Bundles/UITextures/CarBrands/CarBrand_Ford'
  },
  ford_mustang_mach1_1971: {
    fn: '1971 FORD MUSTANG MACH 1',
    cpp: 'Bundles/cars/base/assets/attributes/stock/car_attribute_ford_mustang_mach1_1971',
    tbp: 'Bundles/UITextures/Thumbnails/ford_mustang_mach1_1971',
    cty: 'stock', dvu: '0&0&0&0&0&0&0&0&0&0&0&0&0&0&0', ncvu: '', ncvuh: '', rvu: '[]',
    pi: 360, c: 2, mf: 'ford', l: 'Bundles/UITextures/CarBrands/CarBrand_Ford'
  },
  nissan_skyline_gtr_c10_1972: {
    fn: '1972 NISSAN SKYLINE GT-R C10',
    cpp: 'Bundles/cars/base/assets/attributes/stock/car_attribute_nissan_skyline_gtr_c10_1972',
    tbp: 'Bundles/UITextures/Thumbnails/nissan_skyline_gtr_c10_1972',
    cty: 'stock', dvu: '0&0&0&0&0&0&0&0&0&0&0&0&0&0&0', ncvu: '', ncvuh: '', rvu: '[]',
    pi: 355, c: 2, mf: 'nissan', l: 'Bundles/UITextures/CarBrands/CarBrand_Nissan'
  },
  dodge_charger_1970: {
    fn: '1970 DODGE CHARGER',
    cpp: 'Bundles/cars/base/assets/attributes/stock/car_attribute_dodge_charger_1970',
    tbp: 'Bundles/UITextures/Thumbnails/dodge_charger_1970',
    cty: 'stock', dvu: '0&0&0&0&0&0&0&0&0&0&0&0&0&0&0', ncvu: '', ncvuh: '', rvu: '[]',
    pi: 345, c: 2, mf: 'dodge', l: 'Bundles/UITextures/CarBrands/CarBrand_Dodge'
  },
  dodge_challenger_1971: {
    fn: '1971 DODGE CHALLENGER',
    cpp: 'Bundles/cars/base/assets/attributes/stock/car_attribute_dodge_challenger_1971',
    tbp: 'Bundles/UITextures/Thumbnails/dodge_challenger_1971',
    cty: 'stock', dvu: '0&0&0&0&0&0&0&0&0&0&0&0&0&0&0', ncvu: '', ncvuh: '', rvu: '[]',
    pi: 340, c: 2, mf: 'dodge', l: 'Bundles/UITextures/CarBrands/CarBrand_Dodge'
  },
  wmotors_lykan_hypersport_2014_ff7: {
    fn: "DOM'S LYKAN HYPERSPORT",
    cpp: 'Bundles/cars/base/assets/attributes/stock/car_attribute_wmotors_lykan_hypersport_2014_ff7',
    tbp: 'Bundles/UITextures/Thumbnails/wmotors_lykan_hypersport_2014_ff7',
    cty: 'hero', dvu: '0&0&0&0&0&0&0&0&0&0&0&0&0&0&0', ncvu: '', ncvuh: '', rvu: '[]',
    pi: 820, c: 6, mf: 'wmotors', l: 'Bundles/UITextures/CarBrands/CarBrand_WMotors'
  },
  wmotors_lykan_hypersport_2014: {
    fn: '2014 W MOTORS LYKAN HYPERSPORT',
    cpp: 'Bundles/cars/base/assets/attributes/stock/car_attribute_wmotors_lykan_hypersport_2014',
    tbp: 'Bundles/UITextures/Thumbnails/wmotors_lykan_hypersport_2014',
    cty: 'stock', dvu: '0&0&0&0&0&0&0&0&0&0&0&0&0&0&0', ncvu: '', ncvuh: '', rvu: '[]',
    pi: 780, c: 6, mf: 'wmotors', l: 'Bundles/UITextures/CarBrands/CarBrand_WMotors'
  },
  dodge_viper_srt_timeattack_2014: {
    fn: '2014 DODGE VIPER SRT TIME ATTACK',
    cpp: 'Bundles/cars/base/assets/attributes/stock/car_attribute_dodge_viper_srt_timeattack_2014',
    tbp: 'Bundles/UITextures/Thumbnails/dodge_viper_srt_timeattack_2014',
    cty: 'stock', dvu: '0&0&0&0&0&0&0&0&0&0&0&0&0&0&0', ncvu: '', ncvuh: '', rvu: '[]',
    pi: 720, c: 6, mf: 'dodge', l: 'Bundles/UITextures/CarBrands/CarBrand_Dodge'
  },
  dodge_viper_srt_gts_2013: {
    fn: '2013 DODGE VIPER SRT GTS',
    cpp: 'Bundles/cars/base/assets/attributes/stock/car_attribute_dodge_viper_srt_gts_2013',
    tbp: 'Bundles/UITextures/Thumbnails/dodge_viper_srt_gts_2013',
    cty: 'stock', dvu: '0&0&0&0&0&0&0&0&0&0&0&0&0&0&0', ncvu: '', ncvuh: '', rvu: '[]',
    pi: 680, c: 5, mf: 'dodge', l: 'Bundles/UITextures/CarBrands/CarBrand_Dodge'
  },
  dodge_charger_rt_1970_ff4: {
    fn: "DOM'S 1970 DODGE CHARGER R/T",
    cpp: 'Bundles/cars/base/assets/attributes/stock/car_attribute_dodge_charger_rt_1970_ff4',
    tbp: 'Bundles/UITextures/Thumbnails/dodge_charger_rt_1970_ff4',
    cty: 'hero', dvu: '0&0&0&0&0&0&0&0&0&0&0&0&0&0&0', ncvu: '', ncvuh: '', rvu: '[]',
    pi: 660, c: 5, mf: 'dodge', l: 'Bundles/UITextures/CarBrands/CarBrand_Dodge'
  },
  dodge_charger_daytona_1969_ff6: {
    fn: "DOM'S 1969 DODGE CHARGER DAYTONA",
    cpp: 'Bundles/cars/base/assets/attributes/stock/car_attribute_dodge_charger_daytona_1969_ff6',
    tbp: 'Bundles/UITextures/Thumbnails/dodge_charger_daytona_1969_ff6',
    cty: 'hero', dvu: '0&0&0&0&0&0&0&0&0&0&0&0&0&0&0', ncvu: '', ncvuh: '', rvu: '[]',
    pi: 650, c: 5, mf: 'dodge', l: 'Bundles/UITextures/CarBrands/CarBrand_Dodge'
  },
  ford_mustang_mach1_1969_ff6: {
    fn: "LETTY'S 1969 FORD MUSTANG MACH 1",
    cpp: 'Bundles/cars/base/assets/attributes/stock/car_attribute_ford_mustang_mach1_1969_ff6',
    tbp: 'Bundles/UITextures/Thumbnails/ford_mustang_mach1_1969_ff6',
    cty: 'hero', dvu: '0&0&0&0&0&0&0&0&0&0&0&0&0&0&0', ncvu: '', ncvuh: '', rvu: '[]',
    pi: 640, c: 5, mf: 'ford', l: 'Bundles/UITextures/CarBrands/CarBrand_Ford'
  },
  dodge_challenger_srt8_2013_ff6: {
    fn: '2013 DODGE CHALLENGER SRT8 (FF6)',
    cpp: 'Bundles/cars/base/assets/attributes/stock/car_attribute_dodge_challenger_srt8_2013_ff6',
    tbp: 'Bundles/UITextures/Thumbnails/dodge_challenger_srt8_2013_ff6',
    cty: 'hero', dvu: '0&0&0&0&0&0&0&0&0&0&0&0&0&0&0', ncvu: '', ncvuh: '', rvu: '[]',
    pi: 630, c: 5, mf: 'dodge', l: 'Bundles/UITextures/CarBrands/CarBrand_Dodge'
  },
  chevrolet_corvette_c7_z06_2015: {
    fn: '2015 CHEVROLET CORVETTE C7 Z06',
    cpp: 'Bundles/cars/base/assets/attributes/stock/car_attribute_chevrolet_corvette_c7_z06_2015',
    tbp: 'Bundles/UITextures/Thumbnails/chevrolet_corvette_c7_z06_2015',
    cty: 'stock', dvu: '0&0&0&0&0&0&0&0&0&0&0&0&0&0&0', ncvu: '', ncvuh: '', rvu: '[]',
    pi: 620, c: 5, mf: 'chevrolet', l: 'Bundles/UITextures/CarBrands/CarBrand_Chevrolet'
  },
  chevrolet_corvette_c6_zr1_2013: {
    fn: '2013 CHEVROLET CORVETTE C6 ZR1',
    cpp: 'Bundles/cars/base/assets/attributes/stock/car_attribute_chevrolet_corvette_c6_zr1_2013',
    tbp: 'Bundles/UITextures/Thumbnails/chevrolet_corvette_c6_zr1_2013',
    cty: 'stock', dvu: '0&0&0&0&0&0&0&0&0&0&0&0&0&0&0', ncvu: '', ncvuh: '', rvu: '[]',
    pi: 600, c: 5, mf: 'chevrolet', l: 'Bundles/UITextures/CarBrands/CarBrand_Chevrolet'
  },
  chevrolet_corvette_c7_stingray_2014: {
    fn: '2014 CHEVROLET CORVETTE C7 STINGRAY',
    cpp: 'Bundles/cars/base/assets/attributes/stock/car_attribute_chevrolet_corvette_c7_stingray_2014',
    tbp: 'Bundles/UITextures/Thumbnails/chevrolet_corvette_c7_stingray_2014',
    cty: 'stock', dvu: '0&0&0&0&0&0&0&0&0&0&0&0&0&0&0', ncvu: '', ncvuh: '', rvu: '[]',
    pi: 590, c: 5, mf: 'chevrolet', l: 'Bundles/UITextures/CarBrands/CarBrand_Chevrolet'
  },
  bmw_m6_f12_2013: {
    fn: '2013 BMW M6',
    cpp: 'Bundles/cars/base/assets/attributes/stock/car_attribute_bmw_m6_f12_2013',
    tbp: 'Bundles/UITextures/Thumbnails/bmw_m6_f12_2013',
    cty: 'stock', dvu: '0&0&0&0&0&0&0&0&0&0&0&0&0&0&0', ncvu: '', ncvuh: '', rvu: '[]',
    pi: 580, c: 5, mf: 'bmw', l: 'Bundles/UITextures/CarBrands/CarBrand_BMW'
  },
  bmw_m5_f10_2012: {
    fn: '2012 BMW M5',
    cpp: 'Bundles/cars/base/assets/attributes/stock/car_attribute_bmw_m5_f10_2012',
    tbp: 'Bundles/UITextures/Thumbnails/bmw_m5_f10_2012',
    cty: 'stock', dvu: '0&0&0&0&0&0&0&0&0&0&0&0&0&0&0', ncvu: '', ncvuh: '', rvu: '[]',
    pi: 570, c: 5, mf: 'bmw', l: 'Bundles/UITextures/CarBrands/CarBrand_BMW'
  },
  nissan_skyline_gtr_bnr34_2002: {
    fn: '2002 NISSAN SKYLINE GT-R BNR34',
    cpp: 'Bundles/cars/base/assets/attributes/stock/car_attribute_nissan_skyline_gtr_bnr34_2002',
    tbp: 'Bundles/UITextures/Thumbnails/nissan_skyline_gtr_bnr34_2002',
    cty: 'stock', dvu: '0&0&0&0&0&0&0&0&0&0&0&0&0&0&0', ncvu: '', ncvuh: '', rvu: '[]',
    pi: 540, c: 4, mf: 'nissan', l: 'Bundles/UITextures/CarBrands/CarBrand_Nissan'
  },
  ford_gt_2006: {
    fn: '2006 FORD GT',
    cpp: 'Bundles/cars/base/assets/attributes/stock/car_attribute_ford_gt_2006',
    tbp: 'Bundles/UITextures/Thumbnails/ford_gt_2006',
    cty: 'stock', dvu: '0&0&0&0&0&0&0&0&0&0&0&0&0&0&0', ncvu: '', ncvuh: '', rvu: '[]',
    pi: 560, c: 5, mf: 'ford', l: 'Bundles/UITextures/CarBrands/CarBrand_Ford'
  },
  ford_gt40_mk1_1969: {
    fn: '1969 FORD GT40 MK1',
    cpp: 'Bundles/cars/base/assets/attributes/stock/car_attribute_ford_gt40_mk1_1969',
    tbp: 'Bundles/UITextures/Thumbnails/ford_gt40_mk1_1969',
    cty: 'stock', dvu: '0&0&0&0&0&0&0&0&0&0&0&0&0&0&0', ncvu: '', ncvuh: '', rvu: '[]',
    pi: 550, c: 5, mf: 'ford', l: 'Bundles/UITextures/CarBrands/CarBrand_Ford'
  },
  shelby_gt500_2014: {
    fn: '2014 SHELBY GT500',
    cpp: 'Bundles/cars/base/assets/attributes/stock/car_attribute_shelby_gt500_2014',
    tbp: 'Bundles/UITextures/Thumbnails/shelby_gt500_2014',
    cty: 'stock', dvu: '0&0&0&0&0&0&0&0&0&0&0&0&0&0&0', ncvu: '', ncvuh: '', rvu: '[]',
    pi: 560, c: 5, mf: 'shelby', l: 'Bundles/UITextures/CarBrands/CarBrand_Shelby'
  },
  shelby_gt500_fastback_1969: {
    fn: '1969 SHELBY GT500 FASTBACK',
    cpp: 'Bundles/cars/base/assets/attributes/stock/car_attribute_shelby_gt500_fastback_1969',
    tbp: 'Bundles/UITextures/Thumbnails/shelby_gt500_fastback_1969',
    cty: 'stock', dvu: '0&0&0&0&0&0&0&0&0&0&0&0&0&0&0', ncvu: '', ncvuh: '', rvu: '[]',
    pi: 530, c: 4, mf: 'shelby', l: 'Bundles/UITextures/CarBrands/CarBrand_Shelby'
  },
  cadillac_cien_concept_2002: {
    fn: '2002 CADILLAC CIEN CONCEPT',
    cpp: 'Bundles/cars/base/assets/attributes/stock/car_attribute_cadillac_cien_concept_2002',
    tbp: 'Bundles/UITextures/Thumbnails/cadillac_cien_concept_2002',
    cty: 'stock', dvu: '0&0&0&0&0&0&0&0&0&0&0&0&0&0&0', ncvu: '', ncvuh: '', rvu: '[]',
    pi: 540, c: 5, mf: 'cadillac', l: 'Bundles/UITextures/CarBrands/CarBrand_Cadillac'
  },
  bmw_1m_coupe_2011: {
    fn: '2011 BMW 1M COUPE',
    cpp: 'Bundles/cars/base/assets/attributes/stock/car_attribute_bmw_1m_coupe_2011',
    tbp: 'Bundles/UITextures/Thumbnails/bmw_1m_coupe_2011',
    cty: 'stock', dvu: '0&0&0&0&0&0&0&0&0&0&0&0&0&0&0', ncvu: '', ncvuh: '', rvu: '[]',
    pi: 500, c: 4, mf: 'bmw', l: 'Bundles/UITextures/CarBrands/CarBrand_BMW'
  },
  chevrolet_corvette_c3_1969: {
    fn: '1969 CHEVROLET CORVETTE C3',
    cpp: 'Bundles/cars/base/assets/attributes/stock/car_attribute_chevrolet_corvette_c3_1969',
    tbp: 'Bundles/UITextures/Thumbnails/chevrolet_corvette_c3_1969',
    cty: 'stock', dvu: '0&0&0&0&0&0&0&0&0&0&0&0&0&0&0', ncvu: '', ncvuh: '', rvu: '[]',
    pi: 480, c: 4, mf: 'chevrolet', l: 'Bundles/UITextures/CarBrands/CarBrand_Chevrolet'
  },
  dodge_charger_daytona_1969: {
    fn: '1969 DODGE CHARGER DAYTONA',
    cpp: 'Bundles/cars/base/assets/attributes/stock/car_attribute_dodge_charger_daytona_1969',
    tbp: 'Bundles/UITextures/Thumbnails/dodge_charger_daytona_1969',
    cty: 'stock', dvu: '0&0&0&0&0&0&0&0&0&0&0&0&0&0&0', ncvu: '', ncvuh: '', rvu: '[]',
    pi: 470, c: 4, mf: 'dodge', l: 'Bundles/UITextures/CarBrands/CarBrand_Dodge'
  },
  ford_mustang_mach1_1969: {
    fn: '1969 FORD MUSTANG MACH 1',
    cpp: 'Bundles/cars/base/assets/attributes/stock/car_attribute_ford_mustang_mach1_1969',
    tbp: 'Bundles/UITextures/Thumbnails/ford_mustang_mach1_1969',
    cty: 'stock', dvu: '0&0&0&0&0&0&0&0&0&0&0&0&0&0&0', ncvu: '', ncvuh: '', rvu: '[]',
    pi: 460, c: 4, mf: 'ford', l: 'Bundles/UITextures/CarBrands/CarBrand_Ford'
  },
  chevrolet_camaro_yenko_1969: {
    fn: '1969 CHEVROLET CAMARO YENKO',
    cpp: 'Bundles/cars/base/assets/attributes/stock/car_attribute_chevrolet_camaro_yenko_1969',
    tbp: 'Bundles/UITextures/Thumbnails/chevrolet_camaro_yenko_1969',
    cty: 'stock', dvu: '0&0&0&0&0&0&0&0&0&0&0&0&0&0&0', ncvu: '', ncvuh: '', rvu: '[]',
    pi: 450, c: 4, mf: 'chevrolet', l: 'Bundles/UITextures/CarBrands/CarBrand_Chevrolet'
  }
};

const defaultVehicleRecipeTemplates = {
  nissan_skyline_gtr_bnr34_2002: {
    p: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
    vu: [
      503893816,
      -1,
      -1,
      -1,
      -1,
      -1915411111,
      -1,
      -2041859519,
      -1,
      -2041859519,
      -1,
      1834699257,
      1834699257,
      1304612902,
      -1
    ],
    eu: [0, 0, 0, 0, 0, 0, 0, 0, 0],
    ut: [0, 0, 0, 0, 0, 0, 0, 0, 0]
  },
  nissan_gtr_r35_2007: {
    p: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
    vu: [
      478827137,
      -1,
      -1,
      -1,
      -1,
      -1541609369,
      -1,
      343594858,
      -1,
      -1776677561,
      -1,
      -300134898,
      -300134898,
      1304612902,
      -1
    ],
    eu: [0, 0, 0, 0, 0, 0, 0, 0, 0],
    ut: [0, 0, 0, 0, 0, 0, 0, 0, 0]
  },
  nissan_gtr_r35_2007_bensopra_ff6: {
    p: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
    vu: [
      999662577,
      -1,
      -1,
      -1,
      -1,
      -1284935807,
      -1,
      906752821,
      -1,
      906752821,
      -1,
      -4484383,
      -4484383,
      -842039736,
      -1
    ],
    eu: [0, 0, 0, 0, 0, 0, 0, 0, 0],
    ut: [0, 0, 0, 0, 0, 0, 0, 0, 0]
  },
  ff_police_sedan_tokyo_01: {
    p: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
    vu: [
      1726005191,
      -1,
      -1,
      -1529782529,
      -1,
      -1,
      -1,
      701656725,
      -1,
      701656725,
      -1,
      1866806616,
      1866806616,
      -842039736,
      -1
    ],
    eu: [0, 0, 0, 0, 0, 0, 0, 0, 0],
    ut: [0, 0, 0, 0, 0, 0, 0, 0, 0]
  },
  ford_mustang_gt_2015: {
    p: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
    vu: [
      -2037675763,
      -1,
      -1,
      -1,
      -1,
      -1,
      -1,
      1772279311,
      -1,
      1772279311,
      -1,
      -300134898,
      -300134898,
      1304612902,
      -91876782
    ],
    eu: [0, 0, 0, 0, 0, 0, 0, 0, 0],
    ut: [0, 0, 0, 0, 0, 0, 0, 0, 0]
  },
  ford_torino_1972gran: {
    p: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
    vu: [
      1289556431,
      -1,
      -1,
      -1804020449,
      -1,
      -1,
      -1,
      -2132144339,
      -1,
      -2132144339,
      -1,
      -1036232316,
      1097930819,
      1409553428,
      -1
    ],
    eu: [0, 0, 0, 0, 0, 0, 0, 0, 0],
    ut: [0, 0, 0, 0, 0, 0, 0, 0, 0]
  },
  ford_gran_torino_1972: {
    p: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
    vu: [
      724558069,
      -1,
      -1,
      -1,
      -1,
      -1,
      -1,
      83446844,
      -1,
      83446844,
      -1,
      -1249476820,
      -1249476820,
      -842039736,
      -1
    ],
    eu: [0, 0, 0, 0, 0, 0, 0, 0, 0],
    ut: [0, 0, 0, 0, 0, 0, 0, 0, 0]
  },
  ford_gran_torino_1972_ff4: {
    p: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
    vu: [
      1289556431,
      -1,
      -1,
      -1804020449,
      -1,
      -1,
      -1,
      -2132144339,
      -1,
      -2132144339,
      -1,
      -1036232316,
      1097930819,
      1409553428,
      -1
    ],
    eu: [0, 0, 0, 0, 0, 0, 0, 0, 0],
    ut: [0, 0, 0, 0, 0, 0, 0, 0, 0]
  },
  honda_civic_euro_2012: {
    p: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
    vu: [
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0
    ],
    eu: [0, 0, 0, 0, 0, 0, 0, 0, 0],
    ut: [0, 0, 0, 0, 0, 0, 0, 0, 0]
  }
};

defaultVehicleRecipeTemplates.subaru_brz_2013 = {
  p: new Array(14).fill(0),
  vu: parseVisualUpgradeString(
    (vehicleMetaTemplates.subaru_brz_2013 && vehicleMetaTemplates.subaru_brz_2013.dvu) ||
    '0&0&0&0&0&0&0&0&0&0&0&0&0&0&0'
  ),
  eu: new Array(9).fill(0),
  ut: new Array(9).fill(0)
};

Object.entries(extractedTutorialCarDb).forEach(([assetTag, metaTemplate]) => {
  if (!metaTemplate || typeof metaTemplate !== 'object') {
    return;
  }

  vehicleMetaTemplates[assetTag] = clone(metaTemplate);

  const vu = parseVisualUpgradeString(metaTemplate.dvu);
  if (vu.length > 0) {
    defaultVehicleRecipeTemplates[assetTag] = {
      p: new Array(14).fill(0),
      vu,
      eu: new Array(9).fill(0),
      ut: new Array(9).fill(0)
    };
  }
});

externalCarAttributeEntries.forEach((entry) => {
  const assetTag = extractCarAttributeAssetTag(entry);
  if (!assetTag) {
    return;
  }

  const currentMeta = vehicleMetaTemplates[assetTag] && typeof vehicleMetaTemplates[assetTag] === 'object'
    ? clone(vehicleMetaTemplates[assetTag])
    : {};
  const mergedMeta = { ...currentMeta };

  ['fn', 'tbp', 'dvu', 'rvu', 'cpp'].forEach((key) => {
    const value = String(entry && entry[key] || '').trim();
    if (value) {
      mergedMeta[key] = value;
    }
  });

  if (Object.keys(mergedMeta).length > 0) {
    vehicleMetaTemplates[assetTag] = mergedMeta;
  }

  const defaultRecipeVu = Array.isArray(entry && entry.DefaultRecipe && entry.DefaultRecipe.vu)
    ? entry.DefaultRecipe.vu
    : null;
  const fallbackVu = parseVisualUpgradeString(entry && entry.dvu);
  const resolvedVu = hasMeaningfulVisualUpgradeArray(defaultRecipeVu)
    ? coerceVisualUpgradeArray(defaultRecipeVu)
    : (hasMeaningfulVisualUpgradeArray(fallbackVu) ? coerceVisualUpgradeArray(fallbackVu) : []);

  if (hasMeaningfulVisualUpgradeArray(resolvedVu)) {
    defaultVehicleRecipeTemplates[assetTag] = {
      p: new Array(14).fill(0),
      vu: resolvedVu,
      eu: new Array(9).fill(0),
      ut: new Array(9).fill(0)
    };
  }
});

const ff7TutorialConfig = {
  skipTutorialToGarage: false,
  freshSavesCompleteTutorials: true,
  completeAllTutorialsExceptFirst: false,
  tutorialPlayerCarId: 'nissan_gtr_r35_2007',
  garageCarId: 'nissan_gtr_r35_2007',
  legacyGarageCarIds: [
    'nissan_gtr_r35_2007',
    'nissan_skyline_gtr_bnr34_2002',
    'ford_mustang_gt_2015',
    'ford_torino_1972gran',
    'ford_gran_torino_1972_ff4'
  ],
  tutorialOwnedVehicleTags: [
    'nissan_gtr_r35_2007'
  ],
  garageOwnedVehicleTags: [
    'nissan_gtr_r35_2007'
  ],
  ownedVehicleTags: [
    'nissan_gtr_r35_2007'
  ],
  races: {
    // ── G1 (gi:1) – Street Tutorial – Tokyo police chase ─────────────────────
    chapter_00_a: {
      chapterId: 'chapter_00',
      raceCity: 'tokyo',
      chapterName: 'Tutorial',
      chapterNum: 0,
      raceType: 'be_chased',
      sceneName: 'tokyo_street',
      runtimeSceneName: 'track_tokyo_street',
      sceneVariant: 'getawaytutorial',
      title: 'Street Tutorial',
      description: 'Survive the opening Tokyo police chase tutorial.',
      objective: 'Stay ahead of the police',
      // The getaway HUD indexes objective values by gate count during the chase.
      // Keep this deliberately oversized so G1 never falls off the end of the
      // objective list even if the client reports extra gate transitions.
      objectiveValue: buildRepeatedRaceObjectiveValue(90, 16384),
      trafficLevel: 'medium',
      opponentName: 'Tokyo Police',
      opponentPower: 1,
      opponentPi: 280,
      opponentMatchTime: 300,
      playerCarId: 'nissan_gtr_r35_2007',
      opponentCarId: 'ff_police_sedan_tokyo_01',
      trafficCarIds: [
        'traffic_sedan_compact_01_a',
        'traffic_suv_compact_01_a',
        'traffic_truck_medium_box_01_a',
        'traffic_sedan_compact_01_cinematic'
      ],
      policeCarIds: [],
      currentStoryPreDialogue: 'ID_STORY_CHAPTER_0_PRE_1A:WSO|0|ROMAN|ID_STORY_CHAPTER_0_PRE_1A|ID_UI_PRERACE_LOCATION_TOKYO|GP|True',
      previousStoryPostDialogue: '',
      miscDialogue: '',
      textureMapping: 'ROMAN|dialog_character_roman01&ID_UI_PRERACE_LOCATION_TOKYO|map_tokyo_shape&icon|police',
      ppti: 'profile_pic_police',
      soundId: 5
    },
    // ── G2 (gi:2) – Street to Getaway – LA street race vs Letty ─────────────
    chapter_00_b: {
      chapterId: 'chapter_00',
      raceCity: 'la',
      chapterName: 'Tutorial',
      chapterNum: 0,
      raceType: 'street',
      sceneName: 'la_street',
      runtimeSceneName: 'track_la_street',
      sceneVariant: 'streetgetaway',
      title: 'Race Wars LA',
      description: 'Race Letty in the LA street tutorial right after the chase.',
      objective: '',
      objectiveValue: '',
      trafficLevel: 'none',
      opponentName: 'Letty',
      opponentPower: 1,
      opponentPi: 230,
      opponentMatchTime: 250,
      playerCarId: 'ford_mustang_gt_2015',
      opponentCarId: 'ford_gran_torino_1972_ff4',
      trafficCarIds: [],
      policeCarIds: [],
      currentStoryPreDialogue: 'ID_STORY_CHAPTER_0_PRE_2A:WSO|0|LETTY|ID_STORY_CHAPTER_0_PRE_2A|ID_UI_PRERACE_LOCATION_LA|GP|True',
      previousStoryPostDialogue: '',
      miscDialogue: 'ID_UI_LOADING_TWO_WEEKS',
      textureMapping: 'LETTY|dialog_character_letty01&ID_UI_PRERACE_LOCATION_LA|map_la_shape',
      ppti: '',
      soundId: 5
    },
    // ── G3 (gi:3) – NO RACE – Gacha FTE (Crate Buy tutorial overlay) ─────────
    // ── G4 (gi:4) – NO RACE – Gacha → Main Menu → Race Select overlay ────────
    // Both G3 and G4 are pure UI sequences; no jid/race. Server handles them
    // by returning tutorialRunning=true with empty JumpToRaceID so the client
    // runs the sequence_tutorial_gacha_0 / _1 overlays and then POSTs
    // /tutorial/complete-tutorial to advance.

    // ── G5 (gi:5) – Results Screen Tutorial – LA street race vs Letty ───────
    chapter_01_a: {
      chapterId: 'chapter_01',
      raceCity: 'miami',
      chapterName: 'Tutorial',
      chapterNum: 1,
      raceType: 'street',
      sceneName: 'miami_street',
      runtimeSceneName: 'track_miami_street_variant_shortTrack',
      sceneVariant: 'shortTrack',
      title: 'Results Screen Tutorial',
      description: 'Complete the race and learn the rewards screen.',
      objective: 'Beat Letty',
      objectiveValue: '',
      trafficLevel: 'none',
      opponentName: 'Letty',
      textureMapping: 'LETTY|dialog_character_letty01&ID_UI_PRERACE_LOCATION_MIAMI|map_miami_shape&icon|letty01',
      currentStoryPreDialogue: 'ID_STORY_CHAPTER_1_PRE_1A:WSO|0|LETTY|ID_STORY_CHAPTER_1_PRE_1A|ID_UI_PRERACE_LOCATION_MIAMI|GP|True',
      previousStoryPostDialogue: '',
      miscDialogue: '',
      ppti: 'profile_pic_letty01',
      opponentPower: 1,
      opponentPi: 230,
      opponentMatchTime: 250,
      playerCarId: 'ford_mustang_gt_2015',
      opponentCarId: 'ford_gran_torino_1972_ff4',
      trafficCarIds: [],
      policeCarIds: []
    },
    // ── G6 (gi:6) – NO RACE – Performance Upgrade FTE overlay ────────────────
    // ── G8 (gi:8) – NO RACE – Performance Upgrade done → go to race overlay ──

    // ── G9 (gi:9) – 4th Race – Drag FTE vs Letty ─────────────────────────────
    chapter_01_b: {
      chapterId: 'chapter_01',
      raceCity: 'la',
      chapterName: 'Tutorial',
      chapterNum: 1,
      raceType: 'drag',
      sceneName: 'la_drag',
      runtimeSceneName: 'track_la_drag',
      sceneVariant: 'quartermile',
      title: 'Drag Tutorial',
      description: 'Launch and shift against Letty in the drag tutorial.',
      objective: 'Beat Letty',
      objectiveValue: '',
      trafficLevel: 'none',
      opponentName: 'Letty',
      textureMapping: 'LETTY|dialog_character_letty01&ID_UI_PRERACE_LOCATION_LA|map_la_shape',
      currentStoryPreDialogue: 'ID_STORY_CHAPTER_1_PRE_2A:WSO|0|LETTY|ID_STORY_CHAPTER_1_PRE_2A|ID_UI_PRERACE_LOCATION_LA|GP|True',
      previousStoryPostDialogue: '',
      miscDialogue: '',
      ppti: 'profile_pic_letty01',
      opponentPower: 1,
      opponentPi: 230,
      opponentMatchTime: 250,
      playerCarId: 'ford_mustang_gt_2015',
      opponentCarId: 'ford_gran_torino_1972_ff4',
      trafficCarIds: [],
      policeCarIds: []
    },
    // ── G10 (gi:10) – 5th Race – Drag Mastery ────────────────────────────────
    chapter_01_c: {
      chapterId: 'chapter_01',
      raceCity: 'la',
      chapterName: 'Tutorial',
      chapterNum: 1,
      raceType: 'drag',
      sceneName: 'la_drag',
      runtimeSceneName: 'track_la_drag',
      sceneVariant: 'quartermile',
      title: 'Drag Mastery',
      description: 'Perfect the drag launch and shifting tutorial.',
      objective: 'Beat Letty',
      objectiveValue: '',
      trafficLevel: 'none',
      opponentName: 'Letty',
      textureMapping: 'LETTY|dialog_character_letty01&ID_UI_PRERACE_LOCATION_LA|map_la_shape',
      currentStoryPreDialogue: 'ID_STORY_CHAPTER_1_PRE_3A:WSO|0|LETTY|ID_STORY_CHAPTER_1_PRE_3A|ID_UI_PRERACE_LOCATION_LA|GP|True',
      previousStoryPostDialogue: '',
      miscDialogue: '',
      ppti: 'profile_pic_letty01',
      opponentPower: 1,
      opponentPi: 230,
      opponentMatchTime: 250,
      playerCarId: 'ford_mustang_gt_2015',
      opponentCarId: 'ford_gran_torino_1972_ff4',
      trafficCarIds: [],
      policeCarIds: []
    }
    // ── G12 (gi:12) – NO RACE – Challenge Race FTE overlay ───────────────────
    // ── G39 (gi:39) – NO RACE – Takedown FTE (rist: chapter_01_e) ────────────
    // ── G15 (gi:15) – NO RACE – Drift Race Tutorial (rist: chapter_02_a) ─────
  }
};

function normalizeVehicleLookupTag(tag) {
  const raw = String(tag || '').replace(/^car_attribute_/, '').trim();
  const remapped = {
    nissan_gtr_r35_2007_bensopra_ff6: 'nissan_gtr_r35_2007',
    ford_escort_rs2000_1986_ff6: 'ford_escort_rs2000_1986',
    dodge_charger_daytona_1969_ff6: 'dodge_charger_daytona_1969',
    ford_mustang_mach1_1969_ff6: 'ford_mustang_mach1_1969',
    dodge_challenger_srt8_2013_ff6: 'dodge_challenger_srt8_2012'
  }[raw];
  if (remapped) {
    return remapped;
  }
  if (defaultVehicleDescriptions[raw] || vehicleMetaTemplates[raw] || defaultVehicleRecipeTemplates[raw]) {
    return String(raw || 'gtr_r34');
  }
  const matchedShortTag = Object.keys(vehicleAssetAliases).find((shortTag) => vehicleAssetAliases[shortTag] === raw);
  return String(matchedShortTag || raw || 'gtr_r34');
}

function getDefaultRecipeArrays(tag) {
  const canonicalTag = normalizeVehicleLookupTag(tag);
  const assetTag = String(vehicleAssetAliases[canonicalTag] || canonicalTag);
  const template = defaultVehicleRecipeTemplates[assetTag] || {};

  return {
    p: Array.isArray(template.p) ? template.p.slice() : [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
    vu: Array.isArray(template.vu) ? template.vu.slice() : [-1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1],
    eu: Array.isArray(template.eu) ? template.eu.slice() : [0, 0, 0, 0, 0, 0, 0, 0, 0],
    ut: Array.isArray(template.ut) ? template.ut.slice() : [0, 0, 0, 0, 0, 0, 0, 0, 0]
  };
}

function createStockOwnedVehicleStatus(vehicleTag) {
  const status = clone(createOwnedVehicleStatus(vehicleTag));
  const ownedPaintJobs = Array.isArray(status.OwnedPaintJobs)
    ? status.OwnedPaintJobs.filter(Boolean)
    : [];
  status.OwnedPaintJobs = ownedPaintJobs.length > 0 ? ownedPaintJobs : ['#paint_silver'];
  status.PaintJobId = String(status.PaintJobId || status.OwnedPaintJobs[0] || '#paint_silver');
  status.AeroId = String(status.AeroId || '#default_aero');
  status.OwnedTuningBundles = [];
  status.OwnedToys = [];
  status.FittedToys = {};
  return status;
}

function getVehicleMetaTemplate(tag) {
  const canonicalTag = normalizeVehicleLookupTag(tag);
  const assetTag = String(vehicleAssetAliases[canonicalTag] || canonicalTag);
  return clone(vehicleMetaTemplates[assetTag] || {});
}

function clampUnitInterval(value, fallback = 1) {
  const numericValue = Number(value);
  if (!Number.isFinite(numericValue)) {
    return fallback;
  }
  return Math.max(0, Math.min(1, numericValue));
}

function averageHealth(values, fallback = 1) {
  const list = Array.isArray(values)
    ? values
        .map((value) => Number(value))
        .filter((value) => Number.isFinite(value))
    : [];
  if (list.length === 0) {
    return fallback;
  }
  const total = list.reduce((sum, value) => sum + value, 0);
  return clampUnitInterval(total / list.length, fallback);
}

function hasClientBackedVehicleData(tag) {
  const canonicalTag = normalizeVehicleLookupTag(tag);
  const assetTag = String(vehicleAssetAliases[canonicalTag] || canonicalTag);
  return Boolean(
    defaultVehicleDescriptions[canonicalTag] ||
    defaultVehicleDescriptions[assetTag] ||
    vehicleMetaTemplates[assetTag] ||
    defaultVehicleRecipeTemplates[assetTag]
  );
}

function getSupportedOwnedVehicleTags(tags, fallbackTag = 'nissan_gtr_r35_2007') {
  const sourceTags = Array.isArray(tags) ? tags : [];
  const supportedTags = [];
  const seen = new Set();

  sourceTags.forEach((tag) => {
    if (!hasClientBackedVehicleData(tag)) {
      return;
    }
    const canonicalTag = normalizeVehicleLookupTag(tag);
    const assetTag = String(vehicleAssetAliases[canonicalTag] || canonicalTag);
    if (!assetTag || seen.has(assetTag)) {
      return;
    }
    seen.add(assetTag);
    supportedTags.push(assetTag);
  });

  if (supportedTags.length > 0) {
    return supportedTags;
  }

  const normalizedFallbackTag = normalizeVehicleLookupTag(fallbackTag);
  const fallbackAssetTag = String(vehicleAssetAliases[normalizedFallbackTag] || normalizedFallbackTag);
  return fallbackAssetTag ? [fallbackAssetTag] : ['nissan_gtr_r35_2007'];
}

function getCanonicalVehiclePi(tag, status = null) {
  const canonicalTag = normalizeVehicleLookupTag(tag);
  const assetTag = String(vehicleAssetAliases[canonicalTag] || canonicalTag);
  const meta = getVehicleMetaTemplate(assetTag);
  const description = defaultVehicleDescriptions[canonicalTag] || defaultVehicleDescriptions[assetTag] || {};
  const normalizedStatus = status && typeof status === 'object'
    ? status
    : createOwnedVehicleStatus(assetTag);
  const pi = Number(
    meta.pi ||
    description.pi ||
    description.BasePISS ||
    normalizedStatus.PISS ||
    0
  );
  return Math.max(0, Math.round(Number.isFinite(pi) ? pi : 0));
}

function buildOwnedVehicleCondition(tag, status = null) {
  const canonicalTag = normalizeVehicleLookupTag(tag);
  const assetTag = String(vehicleAssetAliases[canonicalTag] || canonicalTag);
  const meta = getVehicleMetaTemplate(assetTag);
  const normalizedStatus = status && typeof status === 'object'
    ? status
    : createOwnedVehicleStatus(assetTag);
  const totalCarCondition = Math.max(1, Math.round(Number(meta.tcc || 1000) || 1000));
  const conditionValue = averageHealth([
    normalizedStatus.BodyworkHealth,
    normalizedStatus.EngineHealth,
    normalizedStatus.OilHealth,
    averageHealth(normalizedStatus.TyreHealth, 1),
    averageHealth(normalizedStatus.BrakeHealth, 1)
  ], 1);
  const currentCondition = Math.max(1, Math.min(totalCarCondition, Math.round(totalCarCondition * conditionValue)));
  const repairCost = Math.max(0, Math.round((1 - conditionValue) * Number(meta.rsc || 100)));
  const repairSeconds = Math.max(0, Math.round((1 - conditionValue) * Number(meta.rt || 21600)));

  return {
    curr: currentCondition,
    tcc: totalCarCondition,
    dc: Math.max(1, Math.round(Number(meta.dc || (totalCarCondition * 40 / 100)))),
    dpr: Math.max(0, Math.round(Number(meta.dpr || 0))),
    pr: 0,
    sc: repairCost,
    ts: repairSeconds,
    hc: Math.max(1, Math.round(Number(meta.hc || 10)))
  };
}

function buildVehicleDescriptionCarMeta(record) {
  if (!record || typeof record !== 'object') {
    return {};
  }

  const safe = clone(record);
  delete safe.CarMetaData;
  delete safe.MetaData;
  delete safe.metadata;
  return safe;
}

function hydrateVehicleDescriptionFromMeta(tag) {
  const record = defaultVehicleDescriptions[tag];
  if (!record || typeof record !== 'object') {
    return;
  }

  const assetTag = String(vehicleAssetAliases[tag] || tag);
  const meta = vehicleMetaTemplates[assetTag];
  if (!meta || typeof meta !== 'object') {
    return;
  }

  record.n = String(meta.n || `car_attribute_${assetTag}`);
  record.fn = String(meta.fn || record.fn || record.name || assetTag);
  record.AttributeTag = String(record.n);
  record.cpp = String(meta.cpp || record.cpp || `Bundles/cars/base/assets/attributes/stock/car_attribute_${assetTag}`);
  record.tbp = String(meta.tbp || record.tbp || `Bundles/UITextures/Thumbnails/${assetTag}`);
  record.cty = String(meta.cty || record.cty || 'stock');
  record.dvu = String(meta.dvu || record.dvu || '');
  record.ncvu = String(meta.ncvu || record.ncvu || '');
  record.ncvuh = String(meta.ncvuh || record.ncvuh || '');
  record.rvu = String(meta.rvu || record.rvu || '[]');
  record.pi = Number(meta.pi || record.pi || 0);
  record.c = Number(meta.c || record.c || 0);
  record.mf = String(meta.mf || record.mf || '');
  record.l = String(meta.l || record.l || '');
  record.PrefabName = String(meta.PrefabName || record.PrefabName || `car_part_${assetTag}_a`);
  record.PartPathRoot = String(
    meta.PartPathRoot ||
    record.PartPathRoot ||
    (assetTag.startsWith('traffic_') ? 'vehicles/trafficvehicles/' : `Bundles/cars/base/assets/parts/unique/${String(record.mf || meta.mf || assetTag.split('_')[0] || 'misc')}/`)
  );
  record.carPrefabPath = String(
    meta.carPrefabPath ||
    record.carPrefabPath ||
    (assetTag.startsWith('traffic_')
      ? `${record.PartPathRoot}${record.PrefabName}`
      : `${record.PartPathRoot}${record.PrefabName}`)
  );
  record.carModelAttributePath = String(meta.cpp || record.carModelAttributePath || record.cpp);
  if (Number.isFinite(record.pi) && record.pi > 0) {
    record.BasePISS = record.pi;
  }
}

Object.keys(defaultVehicleDescriptions).forEach((tag) => {
  hydrateVehicleDescriptionFromMeta(tag);
});

Object.keys(defaultVehicleDescriptions).forEach((shortTag) => {
  const assetTag = vehicleAssetAliases[shortTag] || shortTag;
  const base = defaultVehicleDescriptions[shortTag];
  if (!base || typeof base !== 'object') return;

  base.Tag = shortTag;
  base.tag = shortTag;
  base.Id = shortTag;
  base.id = shortTag;
  base.ShortTag = shortTag;
  base.AssetTag = assetTag;
  base.AttributeTag = `car_attribute_${assetTag}`;
  base.PrefabName = `car_part_${assetTag}_a`;
  base.CarMetaData = buildVehicleDescriptionCarMeta(base);

  if (!defaultVehicleDescriptions[assetTag]) {
    defaultVehicleDescriptions[assetTag] = Object.assign({}, base, {
      Tag: assetTag,
      tag: assetTag,
      Id: assetTag,
      id: assetTag,
      ShortTag: shortTag,
      CarMetaData: null
    });
    defaultVehicleDescriptions[assetTag].CarMetaData = buildVehicleDescriptionCarMeta(defaultVehicleDescriptions[assetTag]);
  }

  const attributeTag = `car_attribute_${assetTag}`;
  if (!defaultVehicleDescriptions[attributeTag]) {
    defaultVehicleDescriptions[attributeTag] = Object.assign({}, defaultVehicleDescriptions[assetTag], {
      Tag: attributeTag,
      tag: attributeTag,
      Id: attributeTag,
      id: attributeTag,
      LookupTag: assetTag,
      CarMetaData: null
    });
    defaultVehicleDescriptions[attributeTag].CarMetaData = buildVehicleDescriptionCarMeta(defaultVehicleDescriptions[attributeTag]);
  }
});

const defaultGlobalUiData = {
  welcomeArticleId: 1001,
  RivalsBeatenRewards: [
    { rivals: 5, amount: 2500, type: 'stars' },
    { rivals: 10, amount: 100, type: 'coins' }
  ],
  FriendsInvitedRewards: [
    { friends: 3, amount: 1500, type: 'stars' },
    { friends: 5, amount: 50, type: 'coins' }
  ],
  VehicleFilterSets: [
    {
      id: 'street-open',
      filters: {
        tyreType: ['Road'],
        performanceClass: ['Any'],
        vehicleClass: ['Any'],
        driveTrain: ['Any'],
        region: ['Any']
      }
    }
  ]
};

const defaultBadgeDescriptions = {
  first_win: {
    Name: '$$Badge_FirstWin_Name',
    Description: '$$Badge_FirstWin_Description',
    Icon: 'badge-first-win',
    IsBehaviourBadge: false
  },
  garage_builder: {
    Name: '$$Badge_GarageBuilder_Name',
    Description: '$$Badge_GarageBuilder_Description',
    Icon: 'badge-garage-builder',
    IsBehaviourBadge: false
  }
};

const defaultNotifications = [
  { id: 'n-1', Type: 'reward', Text: 'Daily bonus is ready to claim.', ArticleId: 1001 },
  { id: 'n-2', Type: 'community', Text: 'A new community event has started.', ArticleId: 1003 }
];

const defaultServerNotifications = [
  { id: 's-1', Type: 'news', Text: 'Server emulation is active.', ArticleId: 1005 },
  { id: 's-2', Type: 'event', Text: 'Midnight Boss Run is live.', ArticleId: 2003 }
];

const defaultRankingsTimeline = [
  { rank: 1, miles: 0, icon: 'rank-1' },
  { rank: 2, miles: 1000, icon: 'rank-2' },
  { rank: 3, miles: 2500, icon: 'rank-3' },
  { rank: 4, miles: 5000, icon: 'rank-4' },
  { rank: 5, miles: 9000, icon: 'rank-5' },
  { rank: 6, miles: 14000, icon: 'rank-6' },
  { rank: 7, miles: 20000, icon: 'rank-7' },
  { rank: 8, miles: 27000, icon: 'rank-8' },
  { rank: 9, miles: 35000, icon: 'rank-9' },
  { rank: 10, miles: 45000, icon: 'rank-10' },
  { rank: 11, miles: 56000, icon: 'rank-11' },
  { rank: 12, miles: 68000, icon: 'rank-12' },
  { rank: 13, miles: 81000, icon: 'rank-13' }
];

const defaultPurchasables = [
  {
    id: 3001,
    itemTag: '#fuel_full',
    itemType: 'fillfueltank',
    itemTitle: 'Fill Fuel Tank',
    title: 'Fill Fuel Tank',
    cost: 120,
    order: 1
  },
  {
    id: 3002,
    itemTag: '#coin_pack_small',
    itemType: 'coins',
    itemTitle: '100 Coins',
    title: '100 Coins',
    starCost: 2500,
    order: 2
  },
  {
    id: 3003,
    itemTag: '#stars_pack_small',
    itemType: 'stars',
    itemTitle: '5,000 Stars',
    title: '5,000 Stars',
    cost: 50,
    order: 3
  },
  {
    id: 3004,
    itemTag: '#boost_nitro',
    itemType: 'boost',
    itemTitle: 'Nitro Boost',
    title: 'Nitro Boost',
    starCost: 800,
    order: 4
  },
  {
    id: 3005,
    itemTag: '#helmet_red',
    itemType: 'helmet',
    itemTitle: 'Red Helmet',
    title: 'Red Helmet',
    starCost: 1200,
    order: 5
  },
  {
    id: 3006,
    itemTag: '#suit_default',
    itemType: 'suit',
    itemTitle: 'Classic Suit',
    title: 'Classic Suit',
    starCost: 900,
    order: 6
  },
  {
    id: 3007,
    itemTag: '#gloves_default',
    itemType: 'gloves',
    itemTitle: 'Track Gloves',
    title: 'Track Gloves',
    starCost: 650,
    order: 7
  },
  {
    id: 3101,
    itemTag: '#rp_bodywork',
    itemType: 'repair',
    itemTitle: 'Repair Bodywork',
    title: 'Repair Bodywork',
    starCost: 0,
    order: 100
  },
  {
    id: 3102,
    itemTag: '#rp_engine',
    itemType: 'repair',
    itemTitle: 'Repair Engine',
    title: 'Repair Engine',
    starCost: 0,
    order: 101
  },
  {
    id: 3103,
    itemTag: '#rp_oil',
    itemType: 'repair',
    itemTitle: 'Replace Oil',
    title: 'Replace Oil',
    starCost: 0,
    order: 102
  },
  {
    id: 3104,
    itemTag: '#rp_tyres',
    itemType: 'repair',
    itemTitle: 'Replace Tyres',
    title: 'Replace Tyres',
    starCost: 0,
    order: 103
  },
  {
    id: 3105,
    itemTag: '#rp_brakes',
    itemType: 'repair',
    itemTitle: 'Service Brakes',
    title: 'Service Brakes',
    starCost: 0,
    order: 104
  },
  {
    id: 3106,
    itemTag: '#rp_quickfix',
    itemType: 'repair',
    itemTitle: 'Quick Fix',
    title: 'Quick Fix',
    starCost: 0,
    order: 105
  },
  {
    id: 3201,
    itemTag: 'supra_mk4',
    itemType: 'vehicle',
    itemTitle: 'Toyota Supra Mk4',
    title: 'Toyota Supra Mk4',
    cost: 2400,
    order: 200,
    unlockRank: 6
  }
];

const defaultInAppPurchasables = [
  {
    id: 4001,
    product_id: 'coins_small',
    title: 'Starter Coins',
    itemType: 'coins',
    amount: 500,
    price: '$0.99'
  },
  {
    id: 4002,
    product_id: 'stars_big',
    title: 'Big Stars Pack',
    itemType: 'stars',
    amount: 25000,
    price: '$2.99'
  },
  {
    id: 4003,
    product_id: 'vip_unlock',
    title: 'VIP Access',
    itemType: 'vip',
    amount: 1,
    price: '$4.99'
  }
];

const defaultVehiclePurchasablesByVehicle = {
  gtr_r34: [
    {
      id: 5001,
      itemTag: '#vp_tyres_road_1',
      itemType: 'tyres',
      itemTitle: 'Road Tyres',
      title: 'Road Tyres',
      starCost: 0,
      order: 1
    },
    {
      id: 5002,
      itemTag: '#vp_tyres_road_2',
      itemType: 'tyres',
      itemTitle: 'Sport Tyres',
      title: 'Sport Tyres',
      starCost: 1200,
      order: 2
    },
    {
      id: 5003,
      itemTag: '#vp_brakes_1',
      itemType: 'brakes',
      itemTitle: 'Street Brakes',
      title: 'Street Brakes',
      starCost: 0,
      order: 3
    },
    {
      id: 5004,
      itemTag: '#vp_brakes_2',
      itemType: 'brakes',
      itemTitle: 'Track Brakes',
      title: 'Track Brakes',
      starCost: 1600,
      order: 4
    },
    {
      id: 5005,
      itemTag: '#vp_engine_1',
      itemType: 'engineCC',
      itemTitle: 'Factory Engine',
      title: 'Factory Engine',
      starCost: 0,
      order: 5
    },
    {
      id: 5006,
      itemTag: '#vp_engine_2',
      itemType: 'engineCC',
      itemTitle: 'Forged Short Block',
      title: 'Forged Short Block',
      starCost: 3200,
      order: 6
    },
    {
      id: 5007,
      itemTag: '#paint_silver',
      itemType: 'paintJob',
      itemTitle: 'Silver Metallic',
      title: 'Silver Metallic',
      starCost: 0,
      itemCategory: 'Factory',
      nearColourR: 184,
      nearColourG: 187,
      nearColourB: 195,
      farColourR: 122,
      farColourG: 128,
      farColourB: 140,
      order: 10
    },
    {
      id: 5008,
      itemTag: '#paint_midnight',
      itemType: 'paintJob',
      itemTitle: 'Midnight Blue',
      title: 'Midnight Blue',
      starCost: 900,
      itemCategory: 'Aftermarket',
      nearColourR: 44,
      nearColourG: 76,
      nearColourB: 160,
      farColourR: 10,
      farColourG: 22,
      farColourB: 64,
      order: 11
    },
    {
      id: 5009,
      itemTag: '#toy_dashcat',
      itemType: 'toy',
      itemTitle: 'Dash Cat',
      title: 'Dash Cat',
      starCost: 450,
      locationType: 'dash',
      order: 12
    },
    {
      id: 5010,
      itemTag: '#tb_stage1',
      itemType: 'tuningBundle',
      itemTitle: 'Stage 1 Pack',
      title: 'Stage 1 Pack',
      starCost: 4500,
      tyres: '#vp_tyres_road_2',
      brakes: '#vp_brakes_2',
      engineCC: '#vp_engine_2',
      order: 20
    }
  ],
  mx5_na: [
    {
      id: 5101,
      itemTag: '#mx_tyres_1',
      itemType: 'tyres',
      itemTitle: 'Road Tyres',
      title: 'Road Tyres',
      starCost: 0,
      order: 1
    },
    {
      id: 5102,
      itemTag: '#mx_tyres_2',
      itemType: 'tyres',
      itemTitle: 'Grip Tyres',
      title: 'Grip Tyres',
      starCost: 950,
      order: 2
    },
    {
      id: 5103,
      itemTag: '#mx_paint_red',
      itemType: 'paintJob',
      itemTitle: 'Classic Red',
      title: 'Classic Red',
      starCost: 0,
      itemCategory: 'Factory',
      nearColourR: 194,
      nearColourG: 32,
      nearColourB: 32,
      farColourR: 120,
      farColourG: 12,
      farColourB: 12,
      order: 3
    }
  ],
  supra_mk4: [
    {
      id: 5201,
      itemTag: '#supra_paint_orange',
      itemType: 'paintJob',
      itemTitle: 'Burnt Orange',
      title: 'Burnt Orange',
      starCost: 0,
      itemCategory: 'Factory',
      nearColourR: 218,
      nearColourG: 112,
      nearColourB: 28,
      farColourR: 124,
      farColourG: 61,
      farColourB: 15,
      order: 1
    }
  ]
};

const defaultPerformanceLadders = {
  tyres: { items: ['#vp_tyres_road_1', '#vp_tyres_road_2'] },
  brakes: { items: ['#vp_brakes_1', '#vp_brakes_2'] },
  engine: { items: ['#vp_engine_1', '#vp_engine_2'] },
  mx_tyres: { items: ['#mx_tyres_1', '#mx_tyres_2'] }
};

defaultVehiclePurchasablesByVehicle.nissan_gtr_r35_2007 = clone(defaultVehiclePurchasablesByVehicle.gtr_r34);
defaultVehiclePurchasablesByVehicle.nissan_skyline_gtr_bnr34_2002 = clone(defaultVehiclePurchasablesByVehicle.gtr_r34);
defaultVehiclePurchasablesByVehicle.ford_mustang_gt_2015 = clone(defaultVehiclePurchasablesByVehicle.gtr_r34);
defaultVehiclePurchasablesByVehicle.subaru_brz_2013 = clone(defaultVehiclePurchasablesByVehicle.mx5_na);

const defaultTuningBundleLadders = {
  packs: { items: ['#tb_stage1'] }
};

const defaultCareerData = {
  articleStructure: {
    milestoneRewards: [
      { trophyCount: 3, amount: 2000, type: 'stars' },
      { trophyCount: 6, amount: 100, type: 'coins' }
    ],
    careerChapters: buildDynamicCareerChapters(defaultArticles.filter((article) => article && article.type === 'gamecareer'))
  },
  articleList: defaultArticles.filter((article) => article && article.type === 'gamecareer')
};

const defaultPreviousRaceResults = {
  Qualified: true,
  Failed: false,
  BeatenRival: true,
  Position: 1,
  Score: 12850,
  TimeMs: 87654
};

function createOwnedVehicleStatus(vehicleTag) {
  const normalizedVehicleTag =
    defaultVehicleDescriptions[vehicleTag] || defaultVehicleRecipeTemplates[vehicleTag]
      ? vehicleTag
      : (Object.keys(vehicleAssetAliases).find((shortTag) => vehicleAssetAliases[shortTag] === vehicleTag) || vehicleTag);

  const vehiclePurchasables = Array.isArray(defaultVehiclePurchasablesByVehicle[normalizedVehicleTag])
    ? defaultVehiclePurchasablesByVehicle[normalizedVehicleTag]
    : [];
  const ownedGenericPaints = vehiclePurchasables
    .filter((item) => item && item.itemType === 'paintJob' && item.itemTag)
    .map((item) => String(item.itemTag))
    .filter(Boolean);
  const defaultGenericPaint = ownedGenericPaints.includes('#paint_silver')
    ? '#paint_silver'
    : (ownedGenericPaints[0] || '#paint_silver');
  const normalizedOwnedGenericPaints = ownedGenericPaints.length > 0
    ? ownedGenericPaints
    : ['#paint_silver'];
  const pickPurchasableIds = (itemType, fallback) => {
    const ids = vehiclePurchasables
      .filter((item) => item && item.itemType === itemType && item.itemTag)
      .map((item) => String(item.itemTag))
      .filter(Boolean);
    return ids.length > 0 ? ids : [fallback];
  };
  const ownedTyreOptions = pickPurchasableIds('tyres', '#vp_tyres_road_1');
  const ownedBrakeOptions = pickPurchasableIds('brakes', '#vp_brakes_1');
  const ownedEngineOptions = pickPurchasableIds('engineCC', '#vp_engine_1');
  const defaultTyreId = ownedTyreOptions[0] || '#vp_tyres_road_1';
  const defaultBrakeId = ownedBrakeOptions[0] || '#vp_brakes_1';
  const defaultEngineId = ownedEngineOptions[0] || '#vp_engine_1';

  if (normalizedVehicleTag === 'mx5_na' || normalizedVehicleTag === 'subaru_brz_2013') {
    return {
      ConfigurationIndex: 0,
      PISS: 430,
      BodyworkHealth: 0.92,
      EngineHealth: 0.94,
      TyreHealth: [0.9, 0.88, 0.89, 0.9],
      BrakeHealth: [0.95, 0.95, 0.93, 0.93],
      OilHealth: 0.91,
      TyreId: '#mx_tyres_1',
      BrakeId: '#vp_brakes_1',
      EngineCCId: '#vp_engine_1',
      IntakeId: '#default_intake',
      EngineMapId: '#default_enginemap',
      CamshaftId: '#default_camshaft',
      CylinderHeadId: '#default_cylinderhead',
      ExhaustId: '#default_exhaust',
      ChassisId: '#default_chassis',
      FinalDriveId: '#default_finaldrive',
      AeroId: '#default_aero',
      OilId: '#default_oil',
      AlloyId: '#default_alloy',
      GlassStyleId: '#default_glass',
      LicensePlateId: '#default_plate',
      PaintJobId: '#mx_paint_red',
      SteeringWheelCoverId: '#default_wheelcover',
      SteeringWheelId: '#default_wheel',
      WaxId: '#default_wax',
      OwnedTyreOptions: ['#mx_tyres_1'],
      OwnedBrakeOptions: ['#vp_brakes_1'],
      EngineCCOptions: ['#vp_engine_1'],
      IntakeOptions: ['#default_intake'],
      EngineMapOptions: ['#default_enginemap'],
      CamshaftOptions: ['#default_camshaft'],
      CylinderHeadOptions: ['#default_cylinderhead'],
      ExhaustOptions: ['#default_exhaust'],
      ChassisOptions: ['#default_chassis'],
      FinalDriveOptions: ['#default_finaldrive'],
      AeroOptions: ['#default_aero'],
      OwnedOilOptions: ['#default_oil'],
      OwnedTuningBundles: [],
      OwnedAlloyOptions: ['#default_alloy'],
      OwnedGlassStyles: ['#default_glass'],
      OwnedLicensePlates: ['#default_plate'],
      OwnedPaintJobs: ['#mx_paint_red'],
      OwnedSteeringWheelCovers: ['#default_wheelcover'],
      OwnedSteeringWheels: ['#default_wheel'],
      OwnedToys: [],
      FittedToys: {}
    };
  }

  if (normalizedVehicleTag === 'supra_mk4') {
    return {
      ConfigurationIndex: 0,
      PISS: 635,
      BodyworkHealth: 1,
      EngineHealth: 1,
      TyreHealth: [1, 1, 1, 1],
      BrakeHealth: [1, 1, 1, 1],
      OilHealth: 1,
      TyreId: '#vp_tyres_road_1',
      BrakeId: '#vp_brakes_1',
      EngineCCId: '#vp_engine_1',
      IntakeId: '#default_intake',
      EngineMapId: '#default_enginemap',
      CamshaftId: '#default_camshaft',
      CylinderHeadId: '#default_cylinderhead',
      ExhaustId: '#default_exhaust',
      ChassisId: '#default_chassis',
      FinalDriveId: '#default_finaldrive',
      AeroId: '#default_aero',
      OilId: '#default_oil',
      AlloyId: '#default_alloy',
      GlassStyleId: '#default_glass',
      LicensePlateId: '#default_plate',
      PaintJobId: '#supra_paint_orange',
      SteeringWheelCoverId: '#default_wheelcover',
      SteeringWheelId: '#default_wheel',
      WaxId: '#default_wax',
      OwnedTyreOptions: ['#vp_tyres_road_1'],
      OwnedBrakeOptions: ['#vp_brakes_1'],
      EngineCCOptions: ['#vp_engine_1'],
      IntakeOptions: ['#default_intake'],
      EngineMapOptions: ['#default_enginemap'],
      CamshaftOptions: ['#default_camshaft'],
      CylinderHeadOptions: ['#default_cylinderhead'],
      ExhaustOptions: ['#default_exhaust'],
      ChassisOptions: ['#default_chassis'],
      FinalDriveOptions: ['#default_finaldrive'],
      AeroOptions: ['#default_aero'],
      OwnedOilOptions: ['#default_oil'],
      OwnedTuningBundles: [],
      OwnedAlloyOptions: ['#default_alloy'],
      OwnedGlassStyles: ['#default_glass'],
      OwnedLicensePlates: ['#default_plate'],
      OwnedPaintJobs: ['#supra_paint_orange'],
      OwnedSteeringWheelCovers: ['#default_wheelcover'],
      OwnedSteeringWheels: ['#default_wheel'],
      OwnedToys: [],
      FittedToys: {}
    };
  }

  return {
    ConfigurationIndex: 0,
    PISS: 585,
    BodyworkHealth: 0.87,
    EngineHealth: 0.91,
    TyreHealth: [0.82, 0.82, 0.8, 0.8],
    BrakeHealth: [0.86, 0.86, 0.85, 0.85],
    OilHealth: 0.78,
    TyreId: defaultTyreId,
    BrakeId: defaultBrakeId,
    EngineCCId: defaultEngineId,
    IntakeId: '#default_intake',
    EngineMapId: '#default_enginemap',
    CamshaftId: '#default_camshaft',
    CylinderHeadId: '#default_cylinderhead',
    ExhaustId: '#default_exhaust',
    ChassisId: '#default_chassis',
    FinalDriveId: '#default_finaldrive',
    AeroId: '#default_aero',
    OilId: '#default_oil',
    AlloyId: '#default_alloy',
    GlassStyleId: '#default_glass',
    LicensePlateId: '#default_plate',
    PaintJobId: defaultGenericPaint,
    SteeringWheelCoverId: '#default_wheelcover',
    SteeringWheelId: '#default_wheel',
    WaxId: '#default_wax',
    OwnedTyreOptions: ownedTyreOptions,
    OwnedBrakeOptions: ownedBrakeOptions,
    EngineCCOptions: ownedEngineOptions,
    IntakeOptions: ['#default_intake'],
    EngineMapOptions: ['#default_enginemap'],
    CamshaftOptions: ['#default_camshaft'],
    CylinderHeadOptions: ['#default_cylinderhead'],
    ExhaustOptions: ['#default_exhaust'],
    ChassisOptions: ['#default_chassis'],
    FinalDriveOptions: ['#default_finaldrive'],
    AeroOptions: ['#default_aero'],
    OwnedOilOptions: ['#default_oil'],
    OwnedTuningBundles: [],
    OwnedAlloyOptions: ['#default_alloy'],
    OwnedGlassStyles: ['#default_glass'],
    OwnedLicensePlates: ['#default_plate'],
    OwnedPaintJobs: normalizedOwnedGenericPaints,
    OwnedSteeringWheelCovers: ['#default_wheelcover'],
    OwnedSteeringWheels: ['#default_wheel'],
    OwnedToys: [],
    FittedToys: {}
  };
}

function createDefaultProfile(userId) {
  const nickname = '';
  const tutorialFirst = !Boolean(ff7TutorialConfig.skipTutorialToGarage) && !Boolean(ff7TutorialConfig.freshSavesCompleteTutorials);
  const ownedTags = tutorialFirst
    ? []
    : (
      Array.isArray(ff7TutorialConfig.garageOwnedVehicleTags) && ff7TutorialConfig.garageOwnedVehicleTags.length > 0
        ? ff7TutorialConfig.garageOwnedVehicleTags
        : [ff7TutorialConfig.garageCarId]
    ).slice();
  return {
    ProfileCreated: true,
    ServerUserValid: true,
    IsVIP: false,
    IsPaidPlayer: false,
    Nickname: nickname,
    Rank: 1,
    level: 1,
    Level: 1,
    PlayerLevel: 1,
    xp: 0,
    XP: 0,
    Miles: 0,
    Fuel: 2,
    MaxFuel: 10,
    ReserveFuel: 2,
    NoCoins: 200,
    NoStars: 100,
    ShowroomUnlocked: true,
    GarageUnlocked: true,
    HypersUnlocked: true,
    CurrentVehicleTag: tutorialFirst ? ff7TutorialConfig.tutorialPlayerCarId : ff7TutorialConfig.garageCarId,
    UsingOwnedVehicle: !tutorialFirst && ownedTags.length > 0,
    OwnedVehicles: ownedTags.slice(),
    OwnedVehiclesStatus: ownedTags.reduce((acc, tag) => {
      acc[tag] = createOwnedVehicleStatus(tag);
      return acc;
    }, {}),
    OwnedDriverHelmets: ['#helmet_red'],
    OwnedDriverSuits: ['#suit_default'],
    OwnedDriverGloves: ['#gloves_default'],
    CurrentDriverHelmet: '#helmet_red',
    CurrentDriverSuit: '#suit_default',
    CurrentDriverGloves: '#gloves_default',
    RivalsBeaten: 3,
    FacebookInvitedIds: [],
    NoCareerTrophiesWon: 0,
    ProvingGroundsPlayed: true,
    RaceFaceTaken: false,
    LastPlayedCareerArticleId: 2001,
    LastSynchedOnDifferentDevice: false,
    BadgeProgress: {
      first_win: {
        TotalMiles: 100,
        MaxMiles: 100,
        TimeStamp: 1700000000
      },
      garage_builder: {
        TotalMiles: 40,
        MaxMiles: 100,
        TimeStamp: 1700000200
      }
    },
    ArticleStatus: {
      2001: { LastTimePlayed: 0 }
    },
    AccountSuspended: false
  };
}

function createShellProfile(userId) {
  const normalizedUserId = String(userId || 'default');
  const internalUid = deriveInternalUid(normalizedUserId);
  return {
    uid: internalUid,
    id: internalUid,
    userId: internalUid,
    naid: normalizedUserId,
    playerId: normalizedUserId,
    player_id: normalizedUserId,
    Nickname: '',
    name: '',
    Rank: 0,
    level: 0,
    Level: 0,
    PlayerLevel: 0,
    xp: 0,
    XP: 0,
    Miles: 0,
    Fuel: 0,
    MaxFuel: 0,
    ReserveFuel: 0,
    NoCoins: 0,
    NoStars: 0,
    CurrentVehicleTag: '',
    UsingOwnedVehicle: false,
    OwnedVehicles: [],
    OwnedVehiclesStatus: {}
  };
}

function createShellUserState(userId) {
  return {
    favourites: [],
    profile: createShellProfile(userId),
    persistentStore: {},
    sessionStore: {},
    launchOptions: {},
    currentArticleId: null,
    previousRaceResults: {},
    notifications: [],
    serverNotifications: [],
    facebookLoggedIn: false,
    locationId: 0,
    soundState: {
      nextHandle: 1,
      handles: {}
    },
    vehiclePurchaseOptions: {}
  };
}

function createDefaultUserState(userId) {
  return {
    favourites: [1003],
    profile: createDefaultProfile(userId),
    persistentStore: {},
    sessionStore: {},
    launchOptions: {},
    currentArticleId: 1003,
    previousRaceResults: clone(defaultPreviousRaceResults),
    notifications: clone(defaultNotifications),
    serverNotifications: clone(defaultServerNotifications),
    facebookLoggedIn: false,
    locationId: 0,
    soundState: {
      nextHandle: 1,
      handles: {}
    },
    vehiclePurchaseOptions: {}
  };
}

module.exports = {
  clone,
  deriveInternalUid,
  ff7FNV32,
  defaultPackManifestText,
  defaultChannels,
  defaultArticles,
  defaultVehicleDescriptions,
  vehicleAssetAliases,
  vehicleMetaTemplates,
  defaultVehicleRecipeTemplates,
  ff7TutorialConfig,
  getDefaultRecipeArrays,
  getVehicleMetaTemplate,
  defaultGlobalUiData,
  defaultBadgeDescriptions,
  defaultNotifications,
  defaultServerNotifications,
  defaultRankingsTimeline,
  defaultPurchasables,
  defaultInAppPurchasables,
  defaultVehiclePurchasablesByVehicle,
  defaultPerformanceLadders,
  defaultTuningBundleLadders,
  defaultCareerData,
  defaultChallengeArticles,
  defaultRandomChallengeArticles,
  defaultPreviousRaceResults,
  createOwnedVehicleStatus,
  createStockOwnedVehicleStatus,
  buildOwnedVehicleCondition,
  getCanonicalVehiclePi,
  getSupportedOwnedVehicleTags,
  createOwnedVehicleRecordId,
  getStoryRaceSuffix,
  buildStoryRaceId,
  getStoryArticleRaceId,
  pickDeterministicVariant,
  createShellProfile,
  createShellUserState,
  createDefaultProfile,
  createDefaultUserState
};
