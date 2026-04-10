const crypto = require('crypto');
const { store, persistState } = require('../store');
const { getUserState } = require('./userService');

const WSKE_ROUTE_PATTERNS = [
  /^\/kabam\/accounts$/,
  /^\/kabam\/accounts\/resetTokens$/,
  /^\/kabam\/accounts\/authTokens$/,
  /^\/kabam\/accounts\/authTokens\/[^/]+$/,
  /^\/kabam\/accounts\/me$/,
  /^\/accounts\/[^/]+\/[^/]+$/,
  /^\/accounts\/[^/]+\/[^/]+\/authTokens$/,
  /^\/accounts\/[^/]+\/[^/]+\/authTokens\/[^/]+$/,
  /^\/accounts\/[^/]+\/[^/]+\/marketing\/email$/,
  /^\/configs\/[^/]+\/[^/]+$/,
  /^\/settings\/[^/]+$/,
  /^\/translations$/,
  /^\/events\/[^/]+\/[^/]+\/[^/]+$/,
  /^\/loyalty\/.+$/,
  /^\/revenues\/.+$/,
  /^\/support\/[^/]+\/[^/]+$/
];

function nowIso() {
  return new Date().toISOString();
}

function futureIso(days) {
  return new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString();
}

function token(prefix) {
  return `${prefix}_${crypto.randomBytes(12).toString('hex')}`;
}

function decodePathPart(value, fallback) {
  if (!value) return fallback || '';
  try {
    return decodeURIComponent(value);
  } catch (_) {
    return value;
  }
}

function normalizeEmail(value, playerId) {
  if (value && String(value).includes('@')) {
    return String(value).trim();
  }
  return `${playerId}@ff7.local`;
}

function normalizePlayerId(value, fallback) {
  return String(value || fallback || 'default').trim() || 'default';
}

function normalizeClientId(value) {
  return String(value || 'ff7').trim() || 'ff7';
}

function userEntries() {
  return Object.entries(store.state.users || {});
}

function findUserIdByKabamAuthToken(authToken) {
  if (!authToken) return null;
  const entry = userEntries().find(([, user]) => user && user.wske && user.wske.kabamAuthToken === authToken);
  return entry ? entry[0] : null;
}

function ensureWskeState(userId, options) {
  const normalizedUserId = normalizePlayerId(userId);
  const user = getUserState(normalizedUserId);

  if (!user.wske || typeof user.wske !== 'object') {
    user.wske = {
      playerId: normalizedUserId,
      clientId: 'ff7',
      kId: `kid_${normalizedUserId}`,
      email: `${normalizedUserId}@ff7.local`,
      birthday: '1985-01-01',
      emailOpt: false,
      userName: user.profile.Nickname || `Player ${normalizedUserId}`,
      kabamAuthToken: token('kbm_auth'),
      kabamAuthTokenExpires: futureIso(30),
      wskeToken: token('wske'),
      wskeTokenExpires: futureIso(90),
      playerCertificate: token('cert'),
      marketingEmail: `${normalizedUserId}@ff7.local`,
      marketingOpt: 'none',
      marketingOptDefault: 'none',
      authenticatedNetworks: {},
      lastLoginAt: nowIso(),
      createdAt: nowIso()
    };
    persistState();
  }

  if (options && typeof options === 'object') {
    const updates = {};
    if (options.playerId) updates.playerId = normalizePlayerId(options.playerId, normalizedUserId);
    if (options.clientId) updates.clientId = normalizeClientId(options.clientId);
    if (options.email !== undefined) updates.email = normalizeEmail(options.email, normalizedUserId);
    if (options.birthday !== undefined) updates.birthday = String(options.birthday || '1985-01-01');
    if (options.emailOpt !== undefined) updates.emailOpt = Boolean(options.emailOpt);
    if (options.userName !== undefined) updates.userName = String(options.userName || user.wske.userName || `Player ${normalizedUserId}`);
    if (options.marketingEmail !== undefined) {
      updates.marketingEmail = normalizeEmail(options.marketingEmail, normalizedUserId);
    }
    if (options.marketingOpt !== undefined && String(options.marketingOpt).trim()) {
      updates.marketingOpt = String(options.marketingOpt).trim();
    }
    if (options.marketingOptDefault !== undefined && String(options.marketingOptDefault).trim()) {
      updates.marketingOptDefault = String(options.marketingOptDefault).trim();
    }

    if (Object.keys(updates).length > 0) {
      Object.assign(user.wske, updates);
      persistState();
    }
  }

  return user.wske;
}

function buildKabamAccountResource(wskeState) {
  return {
    authToken: wskeState.kabamAuthToken,
    birthday: wskeState.birthday,
    email: wskeState.email,
    emailOpt: Boolean(wskeState.emailOpt),
    expires: wskeState.kabamAuthTokenExpires,
    kId: wskeState.kId,
    userName: wskeState.userName
  };
}

function buildValidationResource(wskeState) {
  return {
    authToken: wskeState.kabamAuthToken,
    expires: wskeState.kabamAuthTokenExpires,
    kId: wskeState.kId,
    relationshipStatus: 'active'
  };
}

function buildTokenResource(wskeState) {
  return {
    clientId: wskeState.clientId,
    expires: wskeState.wskeTokenExpires,
    playerId: wskeState.playerId,
    token: wskeState.wskeToken
  };
}

function buildPlayerConfigResource(wskeState, clientId) {
  return {
    clientName: 'FF7 Local',
    facebookKey: '',
    facebookPermissions: '',
    facebookSecret: '',
    googleKey: '',
    googlePermissions: '',
    googleSecret: '',
    loyaltyEventRetryInterval: 60,
    loyaltyEventRetryTimeout: 30,
    maintenanceMessage: '',
    maintenanceMode: false,
    maintenanceTitle: '',
    marketingEmail: wskeState.marketingEmail || wskeState.email,
    marketingOpt: wskeState.marketingOpt || 'none',
    marketingOptDefault: wskeState.marketingOptDefault || 'none',
    moreGamesMenu: false,
    rewardsFTE: false,
    rewardsMenu: true,
    rewardsNotifications: true,
    wskeUrl: '',
    clientId: normalizeClientId(clientId),
    playerId: wskeState.playerId
  };
}

function extractAccountParams(pathname) {
  const parts = pathname.split('/').filter(Boolean);
  return {
    clientId: decodePathPart(parts[1], 'ff7'),
    playerId: normalizePlayerId(decodePathPart(parts[2], 'default'))
  };
}

function listAuthenticatedNetworks(wskeState) {
  return Object.keys(wskeState.authenticatedNetworks || {}).map((associationType) => {
    const entry = wskeState.authenticatedNetworks[associationType];
    return {
      associationType,
      assocTypeProof: entry.assocTypeProof || '',
      authToken: entry.authToken || '',
      authTokenProof: entry.authTokenProof || '',
      expires: entry.expires || futureIso(30)
    };
  });
}

function buildSettingsResource(clientId) {
  return {
    clientId: normalizeClientId(clientId),
    environment: 'local',
    maintenanceMode: false,
    supportEnabled: true
  };
}

const DEFAULT_TRANSLATION_ENTRIES = [
  // --- Characters ---
  ['ROMAN', 'ROMAN'],
  ['LETTY', 'LETTY'],
  ['TEJ', 'TEJ'],
  ['DOM', 'DOM'],
  ['BRIAN', 'BRIAN'],
  ['MIA', 'MIA'],
  ['HOBBS', 'HOBBS'],
  ['POLICE', 'POLICE'],
  ['dialog_character_roman01', 'dialog_character_roman01'],
  ['dialog_character_police01', 'dialog_character_police01'],
  ['dialog_character_letty01', 'dialog_character_letty01'],
  ['dialog_character_tej01', 'dialog_character_tej01'],
  ['dialog_character_dom01', 'dialog_character_dom01'],
  ['dialog_character_brian01', 'dialog_character_brian01'],
  ['dialog_character_mia01', 'dialog_character_mia01'],
  ['dialog_character_hobbs01', 'dialog_character_hobbs01'],
  ['letty01', 'letty01'],
  ['police', 'police'],
  ['icon', 'icon'],

  // --- Locations ---
  ['TOKYO', 'TOKYO'],
  ['MIAMI', 'MIAMI'],
  ['LOS ANGELES', 'LOS ANGELES'],
  ['la', 'LA'],
  ['miami', 'MIAMI'],
  ['tokyo', 'TOKYO'],
  ['map_tokyo_shape', 'map_tokyo_shape'],
  ['map_la_shape', 'map_la_shape'],
  ['map_miami_shape', 'map_miami_shape'],
  ['ID_UI_PRERACE_LOCATION_TOKYO', 'TOKYO, JAPAN'],
  ['ID_UI_PRERACE_LOCATION_LA', 'LOS ANGELES, U.S.A.'],
  ['ID_UI_PRERACE_LOCATION_MIAMI', 'MIAMI, U.S.A.'],
  ['ID_LOCATION_TOKYO', 'TOKYO, JAPAN'],
  ['ID_LOCATION_LA', 'LOS ANGELES, U.S.A.'],
  ['ID_LOCATION_MIAMI', 'MIAMI, U.S.A.'],
  ['ID_UI_LOCATION', 'MIAMI'],

  // --- Chapter / Race UI ---
  ['ID_UI_RACETYPE', 'STREET'],
  ['ID_UI_LOADING_TWO_WEEKS', 'TWO WEEKS EARLIER...'],
  ['TWO WEEKS EARLIER...', 'TWO WEEKS EARLIER...'],
  ['TAP ANYWHERE TO CONTINUE', 'TAP ANYWHERE TO CONTINUE'],
  ['Tap anywhere to continue', 'Tap anywhere to continue'],
  ['ID_UI_PRERACE_GAMEMODE_STREET', 'STREET RACE'],
  ['ID_UI_PRERACE_GAMEMODE_STREET_TO_GETAWAY', 'STREET RACE'],
  ['ID_UI_PRERACE_GAMEMODE_DRAG', 'DRAG RACE'],
  ['ID_UI_PRERACE_GAMEMODE_CHASE', 'GETAWAY'],
  ['ID_UI_PRERACE_GAMEMODE_PURSUIT', 'PURSUIT'],
  ['ID_UI_PRERACE_GAMEMODE_TIME_ATTACK', 'TIME ATTACK'],
  ['ID_UI_DEFAULT_NAME', 'ENTER NAME'],
  ['Race Wars LA', 'Race Wars Miami'],
  ['Race Wars Miami', 'Race Wars Miami'],

  // --- Chapter 0 Story Dialogues ---
  ['ID_STORY_CHAPTER_0_PRE_1A', "Yo, this ain't no ordinary Tokyo police action! Something else is going on... Lose the cops! Now!"],
  ['ID_STORY_CHAPTER_0_PRE_2A', "Hey, welcome to Race Wars Miami! Tej and Roman told me to expect you."],
  ['ID_STORY_CHAPTER_0_PRE_2B', "Let's see what they're talking about. I'll lend you a car for now. Don't mess up my ride."],
  ['ID_STORY_CHAPTER_0_POST_1A', "Nice driving. Now let's see what you've really got."],

  // --- Chapter 1 Story Dialogues ---
  ['ID_STORY_CHAPTER_1_PRE_1A', "Welcome to Miami, home of The Family... your Family. This is your garage. It's looking kinda empty. Let's get you a car."],
  ['ID_STORY_CHAPTER_1_PRE_2A', "Alright, forget what you know. This is drag racing — it's all about the launch. Hit the gas at the right moment and shift at the perfect time. Ready? Go!"],
  ['ID_STORY_CHAPTER_1_PRE_3A', "Good start, but you can do better. Launch it clean, hit every shift at the redline and you'll beat me. Show me you've mastered it."],
  ['ID_STORY_CHAPTER_1_POST_1A', "Not bad. There's more where that came from. Keep pushing."],
  ['ID_STORY_CHAPTER_1_POST_2A', "You're getting the hang of it. The Family doesn't lose — remember that."],
  ['ID_STORY_CHAPTER_1_POST_3A', "Now that's what I'm talking about! You're ready for the real thing."],

  // --- Chapter 2+ Story Dialogues (placeholders) ---
  ['ID_STORY_CHAPTER_2_PRE_1A', "Word is there's a new threat moving through Miami. We need to stay ahead of it."],
  ['ID_STORY_CHAPTER_2_PRE_2A', "This crew doesn't play around. We'll need every edge we can get."],
  ['ID_STORY_CHAPTER_3_PRE_1A', "It's bigger than we thought. Dom needs to know about this."],

  // --- Intro / Misc Dialogue ---
  ['letty_intro', "Hey, welcome to Race Wars Miami! Tej and Roman told me to expect you."],
  ['Hey, welcome to Race Wars LA! Tej and Roman told me to expect you.', 'Hey, welcome to Race Wars Miami! Tej and Roman told me to expect you.'],
  ['Hey, welcome to Race Wars Miami! Tej and Roman told me to expect you.', 'Hey, welcome to Race Wars Miami! Tej and Roman told me to expect you.'],

  // --- Race Titles ---
  ['Street Tutorial', 'Street Tutorial'],
  ['Race Wars Miami', 'Race Wars Miami'],
  ['Results Screen Tutorial', 'Results Screen Tutorial'],
  ['Drag Tutorial', 'Drag Tutorial'],
  ['Drag Mastery', 'Drag Mastery'],
  ['Tutorial', 'Tutorial'],

  // --- Race Objectives ---
  ['Stay ahead of the police', 'Stay ahead of the police'],
  ['Beat Letty', 'Beat Letty'],

  // --- Race Descriptions ---
  ['Survive the opening Tokyo police chase tutorial.', 'Survive the opening Tokyo police chase tutorial.'],
  ['Race Letty in the LA street tutorial right after the chase.', 'Race Letty in the street tutorial right after the chase.'],
  ['Complete the race and learn the rewards screen.', 'Complete the race and learn the rewards screen.'],
  ['Launch and shift against Letty in the drag tutorial.', 'Launch and shift against Letty in the drag tutorial.'],
  ['Perfect the drag launch and shifting tutorial.', 'Perfect the drag launch and shifting tutorial.'],

  // --- Chapter Names ---
  ['chapter_00', 'CHAPTER 0'],
  ['chapter_01', 'CHAPTER 1'],
  ['chapter_02', 'CHAPTER 2'],
  ['chapter_03', 'CHAPTER 3'],

  // --- Generic UI ---
  ['ID_UI_CHAPTER', 'CHAPTER'],
  ['ID_UI_RACE', 'RACE'],
  ['ID_UI_OPPONENT', 'OPPONENT'],
  ['ID_UI_OBJECTIVE', 'OBJECTIVE'],
  ['ID_UI_REWARD', 'REWARD'],
  ['ID_UI_CONTINUE', 'CONTINUE'],
  ['ID_UI_RETRY', 'RETRY'],
  ['ID_UI_SKIP', 'SKIP'],
  ['ID_UI_CANCEL', 'CANCEL'],
  ['ID_UI_CONFIRM', 'CONFIRM'],
  ['ID_UI_OK', 'OK'],
  ['ID_UI_YES', 'YES'],
  ['ID_UI_NO', 'NO'],
  ['ID_UI_BACK', 'BACK'],
  ['ID_UI_NEXT', 'NEXT'],
  ['ID_UI_CLOSE', 'CLOSE'],
  ['ID_UI_LOADING', 'LOADING...'],
  ['ID_UI_WIN', 'VICTORY!'],
  ['ID_UI_LOSE', 'DEFEAT'],
  ['ID_UI_GARAGE', 'GARAGE'],
  ['ID_UI_STORE', 'STORE'],
  ['ID_UI_INBOX', 'INBOX'],
  ['ID_UI_SETTINGS', 'SETTINGS'],
  ['ID_UI_LEADERBOARD', 'LEADERBOARD'],

  // --- Car Classes ---
  ['ID_UI_CLASS_S', 'CLASS S'],
  ['ID_UI_CLASS_A', 'CLASS A'],
  ['ID_UI_CLASS_B', 'CLASS B'],
  ['ID_UI_CLASS_C', 'CLASS C'],
  ['ID_UI_CLASS_D', 'CLASS D'],

  // --- Currencies ---
  ['ID_UI_GOLD', 'GOLD'],
  ['ID_UI_CASH', 'CASH'],
  ['ID_UI_PARTS', 'PARTS'],

  // --- Opponent Names ---
  ['Tokyo Police', 'Tokyo Police'],
  ['Letty', 'Letty'],
  ['Roman', 'Roman'],
  ['Tej', 'Tej'],
  ['Dom', 'Dom'],
];

function buildTranslationDictionary() {
  return DEFAULT_TRANSLATION_ENTRIES.reduce((acc, [phrase, trans]) => {
    acc[phrase] = trans;
    return acc;
  }, {});
}

function buildTranslationsResource(params = {}) {
  const date = nowIso();
  const catalog = DEFAULT_TRANSLATION_ENTRIES.flatMap(([phrase, trans]) => ([
    {
      date,
      locale: 'tr_TR',
      phrase,
      key: phrase,
      stringId: phrase,
      StringId: phrase,
      trans,
      translation: trans,
      text: trans,
      value: trans,
      localized: trans
    },
    {
      date,
      locale: 'en_US',
      phrase,
      key: phrase,
      stringId: phrase,
      StringId: phrase,
      trans,
      translation: trans,
      text: trans,
      value: trans,
      localized: trans
    }
  ]));
  const requestedPhrase = String(params.phrase || '').trim();
  if (!requestedPhrase) {
    return catalog;
  }
  return catalog.filter((entry) => (
    String(entry.phrase || '') === requestedPhrase ||
    String(entry.key || '') === requestedPhrase ||
    String(entry.stringId || '') === requestedPhrase
  ));
}

function buildLoyaltyInformation(playerId) {
  return {
    playerId,
    currentPoints: 0,
    availablePoints: 0,
    unfulfilledRedemptions: []
  };
}

function buildSupportResource(clientId, playerId) {
  return {
    clientId,
    playerId,
    faqUrl: '',
    supportEmail: 'support@ff7.local'
  };
}

function resolveUserIdForKabamAuth(params, headers) {
  const authToken = headers['x-kbm-authtoken'] || params.authToken || params.token;
  const byToken = findUserIdByKabamAuthToken(authToken);
  if (byToken) return byToken;
  return normalizePlayerId(params.playerId, 'default');
}

function handleKabamAccounts(pathname, method, params, headers) {
  if (pathname === '/kabam/accounts' && method === 'POST') {
    const playerId = normalizePlayerId(params.playerId, 'default');
    const wskeState = ensureWskeState(playerId, {
      playerId,
      email: params.email,
      birthday: params.birthday,
      emailOpt: params.emailOpt,
      userName: params.userName
    });

    wskeState.kabamAuthToken = token('kbm_auth');
    wskeState.kabamAuthTokenExpires = futureIso(30);
    wskeState.lastLoginAt = nowIso();
    persistState();

    return { statusCode: 200, payload: buildKabamAccountResource(wskeState) };
  }

  if (pathname === '/kabam/accounts/authTokens' && method === 'POST') {
    const playerId = resolveUserIdForKabamAuth(params, headers);
    const wskeState = ensureWskeState(playerId, {
      playerId,
      email: params.email,
      userName: params.userName
    });

    wskeState.kabamAuthToken = token('kbm_auth');
    wskeState.kabamAuthTokenExpires = futureIso(30);
    wskeState.lastLoginAt = nowIso();
    persistState();

    return { statusCode: 200, payload: buildKabamAccountResource(wskeState) };
  }

  if (pathname === '/kabam/accounts/me' && method === 'GET') {
    const playerId = resolveUserIdForKabamAuth(params, headers);
    const wskeState = ensureWskeState(playerId, { playerId });
    const incomingToken = headers['x-kbm-authtoken'] || params.authToken || params.token;

    if (incomingToken && incomingToken !== wskeState.kabamAuthToken) {
      wskeState.kabamAuthToken = String(incomingToken);
      wskeState.kabamAuthTokenExpires = futureIso(30);
      persistState();
    }

    return { statusCode: 200, payload: buildKabamAccountResource(wskeState) };
  }

  if (pathname === '/kabam/accounts/resetTokens' && method === 'POST') {
    return {
      statusCode: 200,
      payload: {
        success: true,
        email: params.email || ''
      }
    };
  }

  const validationMatch = pathname.match(/^\/kabam\/accounts\/authTokens\/([^/]+)$/);
  if (validationMatch && method === 'GET') {
    const suppliedToken = decodePathPart(validationMatch[1], '');
    const userId = findUserIdByKabamAuthToken(suppliedToken) || normalizePlayerId(params.playerId, 'default');
    const wskeState = ensureWskeState(userId, { playerId: userId });

    if (suppliedToken && wskeState.kabamAuthToken !== suppliedToken) {
      wskeState.kabamAuthToken = suppliedToken;
      wskeState.kabamAuthTokenExpires = futureIso(30);
      persistState();
    }

    return { statusCode: 200, payload: buildValidationResource(wskeState) };
  }

  return null;
}

function handleAccounts(pathname, method, params, headers) {
  const accountMatch = pathname.match(/^\/accounts\/([^/]+)\/([^/]+)(?:\/(.*))?$/);
  if (!accountMatch) return null;

  const clientId = normalizeClientId(decodePathPart(accountMatch[1], 'ff7'));
  const playerId = normalizePlayerId(decodePathPart(accountMatch[2], 'default'));
  const suffix = accountMatch[3] || '';
  const wskeState = ensureWskeState(playerId, { playerId, clientId });

  if (!suffix && method === 'PUT') {
    const playerCertificate = headers['x-kbm-player-certificate'] || params.playerCertificate || wskeState.playerCertificate;
    wskeState.clientId = clientId;
    wskeState.playerCertificate = String(playerCertificate || token('cert'));
    wskeState.wskeToken = token('wske');
    wskeState.wskeTokenExpires = futureIso(90);
    persistState();

    return { statusCode: 200, payload: buildTokenResource(wskeState) };
  }

  if (suffix === 'authTokens' && method === 'GET') {
    return { statusCode: 200, payload: listAuthenticatedNetworks(wskeState) };
  }

  const sendTokenMatch = suffix.match(/^authTokens\/([^/]+)$/);
  if (sendTokenMatch && method === 'POST') {
    const associationType = decodePathPart(sendTokenMatch[1], 'unknown');
    wskeState.authenticatedNetworks[associationType] = {
      assocTypeProof: String(params.assocTypeProof || ''),
      authToken: String(params.authToken || ''),
      authTokenProof: String(params.authTokenProof || ''),
      expires: futureIso(30)
    };
    persistState();

    return {
      statusCode: 200,
      payload: {
        success: true,
        associationType
      }
    };
  }

  if (sendTokenMatch && method === 'DELETE') {
    const associationType = decodePathPart(sendTokenMatch[1], 'unknown');
    delete wskeState.authenticatedNetworks[associationType];
    persistState();
    return { statusCode: 200, payload: { success: true, associationType } };
  }

  if (suffix === 'marketing/email' && method === 'PUT') {
    wskeState.marketingEmail = normalizeEmail(params.email || params.marketingEmail, playerId);
    persistState();
    return { statusCode: 200, payload: { success: true, email: wskeState.marketingEmail } };
  }

  return null;
}

function handleConfigs(pathname, method, params) {
  const match = pathname.match(/^\/configs\/([^/]+)\/([^/]+)$/);
  if (!match || method !== 'GET') return null;

  const clientId = normalizeClientId(decodePathPart(match[1], 'ff7'));
  const playerId = normalizePlayerId(decodePathPart(match[2], 'default'));
  const wskeState = ensureWskeState(playerId, {
    playerId,
    clientId,
    marketingOpt: params.marketingOpt,
    marketingOptDefault: params.marketingOptDefault
  });

  return { statusCode: 200, payload: buildPlayerConfigResource(wskeState, clientId) };
}

function handleWskeMisc(pathname, method, params) {
  const settingsMatch = pathname.match(/^\/settings\/([^/]+)$/);
  if (settingsMatch && method === 'GET') {
    return {
      statusCode: 200,
      payload: buildSettingsResource(decodePathPart(settingsMatch[1], 'ff7'))
    };
  }

  if (pathname === '/translations' && method === 'GET') {
    return { statusCode: 200, payload: buildTranslationsResource(params) };
  }

  const eventsMatch = pathname.match(/^\/events\/([^/]+)\/([^/]+)\/([^/]+)$/);
  if (eventsMatch && method === 'POST') {
    return {
      statusCode: 200,
      payload: {
        success: true,
        clientId: decodePathPart(eventsMatch[1], 'ff7'),
        playerId: decodePathPart(eventsMatch[2], 'default'),
        event: decodePathPart(eventsMatch[3], 'unknown')
      }
    };
  }

  const supportMatch = pathname.match(/^\/support\/([^/]+)\/([^/]+)$/);
  if (supportMatch && method === 'GET') {
    return {
      statusCode: 200,
      payload: buildSupportResource(
        decodePathPart(supportMatch[1], 'ff7'),
        decodePathPart(supportMatch[2], 'default')
      )
    };
  }

  const loyaltyInfoMatch = pathname.match(/^\/loyalty\/information\/([^/]+)\/([^/]+)$/);
  if (loyaltyInfoMatch && method === 'GET') {
    return {
      statusCode: 200,
      payload: buildLoyaltyInformation(decodePathPart(loyaltyInfoMatch[2], 'default'))
    };
  }

  if (/^\/loyalty\/redeemables\/[^/]+\/[^/]+$/.test(pathname) && method === 'GET') {
    return { statusCode: 200, payload: [] };
  }

  if (/^\/loyalty\/redemptions\/.+$/.test(pathname)) {
    return { statusCode: 200, payload: [] };
  }

  if (/^\/loyalty\/events\/.+$/.test(pathname)) {
    return { statusCode: 200, payload: [] };
  }

  if (/^\/revenues\/.+$/.test(pathname)) {
    return {
      statusCode: 200,
      payload: {
        success: true,
        transactionId: params.transactionId || ''
      }
    };
  }

  return null;
}

function isWskeApiPath(pathname) {
  return WSKE_ROUTE_PATTERNS.some((pattern) => pattern.test(pathname));
}

function handleWskeApiRequest(pathname, method, params, headers) {
  const normalizedMethod = String(method || 'GET').toUpperCase();
  const normalizedHeaders = headers || {};

  return (
    handleKabamAccounts(pathname, normalizedMethod, params || {}, normalizedHeaders) ||
    handleAccounts(pathname, normalizedMethod, params || {}, normalizedHeaders) ||
    handleConfigs(pathname, normalizedMethod, params || {}, normalizedHeaders) ||
    handleWskeMisc(pathname, normalizedMethod, params || {}, normalizedHeaders)
  );
}

module.exports = {
  isWskeApiPath,
  handleWskeApiRequest,
  buildTranslationDictionary
};
