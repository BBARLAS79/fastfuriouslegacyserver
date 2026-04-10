const articleService = require('../services/articleService');
const userService = require('../services/userService');

function handleBridgeMethod(methodInfo, userId) {
  const args = methodInfo.args;

  switch (methodInfo.name) {
    case 'UserGetChannels':
      return articleService.getChannels();

    case 'UserGetCoverArticles':
      return articleService.getCoverArticles(args[0], args[1]);

    case 'UserGetEventArticles':
      return articleService.getEventArticles(args[0], args[1]);

    case 'UserGetRecommendedArticlesFromFriends':
      return articleService.getRecommendedArticlesFromFriends(args[0], args[1]);

    case 'UserGetRecommendedArticles':
      return articleService.getRecommendedArticles(args[0], args[1], args[2]);

    case 'UserGetFavouriteArticles':
      return articleService.getFavouriteArticles(userId);

    case 'UserAddFavouriteArticle': {
      const articleId = parseInt(args[0], 10);
      const favourites = Number.isNaN(articleId) ? userService.getUserState(userId).favourites.slice() : userService.addFavourite(userId, articleId);
      return { success: true, favourites };
    }

    case 'UserRemoveFavouriteArticle': {
      const articleId = parseInt(args[0], 10);
      const favourites = Number.isNaN(articleId) ? userService.getUserState(userId).favourites.slice() : userService.removeFavourite(userId, articleId);
      return { success: true, favourites };
    }

    case 'UserGetChannelArticles':
      return articleService.getChannelArticles(args[2], args[0], args[1]);

    case 'UserGetArticleById':
      return articleService.getArticleById(args[0]);

    case 'UserGetArticleDynamicData':
      return articleService.getArticleDynamicData(args[0]);

    default:
      return articleService.dispatchBridgeMethod(methodInfo.raw, userId);
  }
}

module.exports = {
  handleBridgeMethod
};
