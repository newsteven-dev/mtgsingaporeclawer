'use strict';

const { createBinderposStore } = require('./binderpos');

module.exports = createBinderposStore({
  id: 'greyogre',
  name: 'Grey Ogre Games',
  base: 'https://www.greyogregames.com',
  maxPages: 6,
});
