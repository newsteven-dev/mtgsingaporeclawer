'use strict';

/**
 * Flagship Games (Shopify). Its search page lists products and prices but not which
 * conditions are in stock, so we search for in-stock products only, then read each
 * product's standard Shopify JSON (/products/<handle>.js) for per-condition price and
 * availability. Flagship doesn't publish stock counts, so stock is unknown (null).
 */

const cheerio = require('cheerio');
const { getText, getJson, titleMatchesCard, normalizeCondition, mapLimit } = require('../util');
const { isBotCheck } = require('./binderpos');

const BASE = 'https://www.flagshipgames.sg';
const MAX_PAGES = 3;
const MAX_PRODUCTS = 40;

function searchUrl(name, page = 1, inStockOnly = true) {
  const u = new URL('/search', BASE);
  u.searchParams.set('q', `title:"${name.replace(/"/g, '')}"`);
  u.searchParams.set('type', 'product');
  if (inStockOnly) u.searchParams.set('filter.v.availability', '1');
  if (page > 1) u.searchParams.set('page', String(page));
  return u.toString();
}

/** Product handles and titles from a search results page. */
function parseSearchPage(html) {
  const $ = cheerio.load(html);
  const seen = new Set();
  const products = [];
  $('a[href^="/products/"]').each((_, a) => {
    const handle = ($(a).attr('href') || '').split('?')[0].replace(/^\/products\//, '');
    if (!handle || seen.has(handle)) return;
    const title = $(a).find('.grid-view-item__title').text().trim() || $(a).find('img').attr('alt') || '';
    if (!title) return;
    seen.add(handle);
    products.push({ handle, title: title.trim() });
  });
  let lastPage = 1;
  $('a[href*="page="]').each((_, a) => {
    const m = ($(a).attr('href') || '').match(/[?&]page=(\d+)/);
    if (m) lastPage = Math.max(lastPage, Number(m[1]));
  });
  return { products, lastPage };
}

/** "Lightning Bolt (Borderless) [Double Masters 2022]" -> "Double Masters 2022" */
const setFromTitle = (title) => (String(title).match(/\[([^\]]+)\]\s*$/) || [])[1] || '';

/** Listings from one product's Shopify JSON. */
function parseProduct(p) {
  if (!p || (p.type && !/single/i.test(p.type))) return [];
  const image = p.featured_image ? (String(p.featured_image).startsWith('//') ? `https:${p.featured_image}` : p.featured_image) : null;
  return (p.variants || [])
    .filter((v) => v.price)
    .map((v) => {
      const vt = v.title || v.public_title || '';
      return {
        title: p.title,
        set: setFromTitle(p.title),
        setCode: '',
        condition: normalizeCondition(vt.replace(/foil/i, '')),
        finish: /foil/i.test(vt) || /\bfoil\b/i.test(p.title) ? 'foil' : 'nonfoil',
        price: Number(v.price) / 100,
        stock: null, // not published by the store
        inStock: Boolean(v.available),
        url: `${BASE}/products/${p.handle}`,
        image,
      };
    });
}

async function getPage(cardName, n) {
  const html = await getText(searchUrl(cardName, n));
  if (isBotCheck(html)) throw new Error('Flagship Games asked for a browser check, so prices could not be read right now.');
  return parseSearchPage(html);
}

async function search(cardName) {
  const first = await getPage(cardName, 1);
  const pages = Math.min(MAX_PAGES, first.lastPage);
  const rest = await Promise.all(Array.from({ length: Math.max(0, pages - 1) }, (_, i) => getPage(cardName, i + 2)));
  const candidates = [first, ...rest]
    .flatMap((r) => r.products)
    .filter((p) => titleMatchesCard(p.title, cardName))
    .slice(0, MAX_PRODUCTS);

  const products = await mapLimit(candidates, 4, (c) =>
    getJson(`${BASE}/products/${encodeURIComponent(c.handle)}.js`).catch(() => null),
  );
  return products.filter(Boolean).flatMap(parseProduct);
}

module.exports = {
  id: 'flagship',
  name: 'Flagship Games',
  homepage: BASE,
  searchPageUrl: (name) => searchUrl(name, 1, false),
  search,
  _parseSearchPage: parseSearchPage,
  _parseProduct: parseProduct,
};
