'use strict';

const list = [
  require('./agora'),
  require('./mtgasia'),
  require('./moxandlotus'),
  require('./tcgmarketplace'),
  require('./greyogre'),
];

const byId = Object.fromEntries(list.map((s) => [s.id, s]));

module.exports = { list, byId };
