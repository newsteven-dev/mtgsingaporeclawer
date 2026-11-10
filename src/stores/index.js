'use strict';

// Order here sets each store's colour in the price history chart (see --series-* in styles.css).
const list = [
  require('./agora'),
  require('./mtgasia'),
  require('./moxandlotus'),
  require('./tcgmarketplace'),
  require('./greyogre'),
  require('./flagship'),
  require('./gameshaven'),
];

const byId = Object.fromEntries(list.map((s) => [s.id, s]));

module.exports = { list, byId };
