const { store } = require('../store');
const { getUserState } = require('./userService');
const { clone, defaultCareerData } = require('./seedData');

function articleWithRuntimeFields(article) {
  return Object.assign(
    {
      imageSize: 0,
      gallery: []
    },
    article
  );
}

function filterArticles(predicate) {
  return store.articles.filter(predicate).map(articleWithRuntimeFields);
}

function paginate(list, amountArg, offsetArg) {
  const amount = Math.max(0, parseInt(amountArg || list.length, 10) || list.length);
  const offset = Math.max(0, parseInt(offsetArg || 0, 10) || 0);
  return list.slice(offset, offset + amount);
}

function getChannels() {
  return store.channels;
}

function getCoverArticles(amount, offset) {
  return paginate(filterArticles((a) => (a.flags || []).includes('cover')), amount, offset);
}

function getEventArticles(amount, offset) {
  return paginate(filterArticles((a) => (a.flags || []).includes('event')), amount, offset);
}

function getRecommendedArticlesFromFriends(amount, offset) {
  return paginate(filterArticles((a) => (a.flags || []).includes('recommended')), amount, offset);
}

function getRecommendedArticles(sourceId, amount, offset) {
  const pool = filterArticles((a) => String(a.id) !== String(sourceId || ''));
  return paginate(pool, amount, offset);
}

function getFavouriteArticles(userId) {
  const user = getUserState(userId);
  return user.favourites
    .map((id) => store.articleMap.get(String(id)))
    .filter(Boolean)
    .map(articleWithRuntimeFields);
}

function getChannelArticles(channelId, amount, offset) {
  const byChannel = filterArticles((article) => (article.channels || []).includes(String(channelId || '')));
  return paginate(byChannel, amount, offset);
}

function getArticleById(articleId) {
  const article = store.articleMap.get(String(articleId || ''));
  return article ? [articleWithRuntimeFields(article)] : [];
}

function findArticle(articleId) {
  const article = store.articleMap.get(String(articleId || ''));
  return article ? articleWithRuntimeFields(article) : null;
}

function getArticlesByIds(articleIds) {
  const ids = Array.isArray(articleIds) ? articleIds : [];
  return ids
    .map((id) => store.articleMap.get(String(id)))
    .filter(Boolean)
    .map(articleWithRuntimeFields);
}

function getAllArticleIds() {
  return store.articles.map((article) => parseInt(article.id, 10)).filter((id) => !Number.isNaN(id));
}

function getArticleDynamicData(articleId) {
  return {
    success: true,
    data: {
      articleId: String(articleId || ''),
      leaderboard: {
        global: {
          players: [
            { nickName: 'RacerOne', score: 12000, rank: 1 },
            { nickName: 'RacerTwo', score: 9800, rank: 2 },
            { nickName: 'You', score: 8500, rank: 3 }
          ]
        }
      },
      target: {
        progress: 3,
        goal: 5
      }
    }
  };
}

function getCareerData() {
  return clone(defaultCareerData);
}

function dispatchBridgeMethod(rawMethod, userId) {
  const clean = String(rawMethod || '').replace(/^\/+|\/+$/g, '');
  const parts = clean.split('/').filter(Boolean);
  const method = parts[0] || '';
  const args = parts.slice(1);

  switch (method) {
    case 'UserGetChannels':
      return getChannels();
    case 'UserGetCoverArticles':
      return getCoverArticles(args[0], args[1]);
    case 'UserGetEventArticles':
      return getEventArticles(args[0], args[1]);
    case 'UserGetRecommendedArticlesFromFriends':
      return getRecommendedArticlesFromFriends(args[0], args[1]);
    case 'UserGetRecommendedArticles':
      return getRecommendedArticles(args[0], args[1], args[2]);
    case 'UserGetFavouriteArticles':
      return getFavouriteArticles(userId);
    case 'UserGetChannelArticles':
      return getChannelArticles(args[2], args[0], args[1]);
    case 'UserGetArticleById':
      return getArticleById(args[0]);
    case 'UserGetArticleDynamicData':
      return getArticleDynamicData(args[0]);
    default:
      return {
        success: false,
        error: 'UnknownMethod',
        method: method,
        args: args
      };
  }
}

module.exports = {
  getChannels,
  getCoverArticles,
  getEventArticles,
  getRecommendedArticlesFromFriends,
  getRecommendedArticles,
  getFavouriteArticles,
  getChannelArticles,
  getArticleById,
  getArticlesByIds,
  getAllArticleIds,
  getArticleDynamicData,
  getCareerData,
  dispatchBridgeMethod,
  findArticle
};
