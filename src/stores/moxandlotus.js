'use strict';

const { getJson, titleMatchesCard, toNumber, normalizeCondition } = require('../util');

const BASE = 'https://moxandlotus.sg';

function apiUrl(name) {
  const u = new URL('/api/products', BASE);
  u.searchParams.set('search', name);
  u.searchParams.set('showStatus', 'false');
  return u.toString();
}

function searchPageUrl(name) {
  const u = new URL('/products', BASE);
  u.searchParams.set('search', name);
  return u.toString();
}

/** Mox & Lotus (Laravel + Vue) exposes the same JSON the storefront renders from. */
function parseProducts(products, cardName) {
  const out = [];
  for (const p of Array.isArray(products) ? products : products?.data || []) {
    if (p.category && p.category !== 'singles') continue;
    if (Number(p.hide) === 1) continue;
    const title = p.title || p.original_title || '';
    if (!titleMatchesCard(p.original_title || title, cardName) && !titleMatchesCard(title, cardName)) continue;
    const finish = /foil/i.test(p.variation_code || '') ? 'foil' : 'nonfoil';
    const url = p.expansion_code && p.id ? `${BASE}/view/${encodeURIComponent(p.expansion_code)}/${p.id}` : searchPageUrl(cardName);
    const image = p.scryfall_id
      ? `https://cards.scryfall.io/normal/front/${p.scryfall_id[0]}/${p.scryfall_id[1]}/${p.scryfall_id}.jpg`
      : p.image_path || null;
    const conditions = Array.isArray(p.conditions) && p.conditions.length ? p.conditions : [{ code: p.default_condition_code, price: p.price, stocks: p.stocks }];
    for (const c of conditions) {
      const price = toNumber(c.price);
      if (!price) continue; // placeholder conditions are priced 0.00
      const stock = Number(c.stocks || 0);
      out.push({
        title,
        set: p.expansion || p.ck_edition || '',
        setCode: p.expansion_code || '',
        condition: normalizeCondition(c.code),
        finish,
        price,
        stock,
        inStock: stock > 0,
        url,
        image,
      });
    }
  }
  return out;
}

async function search(cardName) {
  const data = await getJson(apiUrl(cardName), { headers: { 'X-Requested-With': 'XMLHttpRequest' } });
  return parseProducts(data, cardName);
}

module.exports = {
  id: 'moxandlotus',
  name: 'Mox & Lotus',
  homepage: BASE,
  searchPageUrl,
  search,
  _parseProducts: parseProducts,
};
