'use strict';

const { createBinderposStore } = require('./binderpos');

// Same BinderPOS storefront theme as Grey Ogre. Games Haven sometimes shows Shopify's
// bot check, so this reads fewer result pages per search to keep the load light.
module.exports = createBinderposStore({
  id: 'gameshaven',
  name: 'Games Haven',
  base: 'https://www.gameshaventcg.com',
  maxPages: 5,
});
