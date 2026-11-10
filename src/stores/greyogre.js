'use strict';

const cheerio = require('cheerio');
const { getText, titleMatchesCard, normalizeCondition } = require('../util');

const BASE = 'https://www.greyogregames.com';
const MAX_PAGES = 6;

function searchUrl(name, page = 1, exact = true) {
  const u = new URL('/search', BASE);
  // Shopify storefront search supports field-scoped queries; this keeps results tight.
  u.searchParams.set('q', exact ? `title:"${name.replace(/"/g, '')}"` : name);
  u.searchParams.set('type', 'product');
  if (page > 1) u.searchParams.set('page', String(page));
  return u.toString();
}

/** Parse a Shopify (BinderPOS theme) search page into product cards with per-condition variants. */
function parsePage(html) {
  const $ = cheerio.load(html);
  const products = [];
  $('.productCard__card').each((_, el) => {
    const $el = $(el);
    const type = $el.attr('data-producttype') || '';
    const href = $el.find('a.productCard__a').attr('href') || $el.find('.productCard__title a').attr('href') || '';
    const img = $el.find('img.productCard__img').attr('data-src') || $el.find('img.productCard__img').attr('src') || '';
    const title = ($el.find('img.productCard__img').attr('alt') || $el.find('.productCard__title').text() || '').trim();
    const setName = $el.find('.productCard__setName').first().text().trim();
    const variants = [];
    $el.find('li.productChip').each((__, li) => {
      const $li = $(li);
      variants.push({
        title: $li.attr('data-varianttitle') || '',
        available: $li.attr('data-variantavailable') === 'true',
        qty: Number($li.attr('data-variantqty') || 0),
        priceCents: Number($li.attr('data-variantprice') || 0),
      });
    });
    products.push({
      type,
      title,
      setName,
      url: href ? new URL(href.split('?')[0], BASE).toString() : BASE,
      image: img ? (img.startsWith('//') ? `https:${img}` : img) : null,
      variants,
    });
  });

  let lastPage = 1;
  $('a[href*="page="]').each((_, a) => {
    const m = ($(a).attr('href') || '').match(/[?&]page=(\d+)/);
    if (m) lastPage = Math.max(lastPage, Number(m[1]));
  });
  return { products, lastPage };
}

async function fetchAll(cardName, exact) {
  const first = parsePage(await getText(searchUrl(cardName, 1, exact)));
  const pages = Math.min(MAX_PAGES, first.lastPage);
  const rest = await Promise.all(
    Array.from({ length: Math.max(0, pages - 1) }, (_, i) => getText(searchUrl(cardName, i + 2, exact)).then(parsePage)),
  );
  return [first, ...rest].flatMap((p) => p.products);
}

async function search(cardName) {
  let products = await fetchAll(cardName, true);
  if (!products.length) products = await fetchAll(cardName, false);

  const out = [];
  for (const p of products) {
    if (p.type && !/single/i.test(p.type)) continue;
    if (!titleMatchesCard(p.title, cardName)) continue;
    for (const v of p.variants) {
      if (!v.priceCents) continue;
      const isFoil = /foil/i.test(v.title);
      out.push({
        title: p.title,
        set: p.setName,
        setCode: '',
        condition: normalizeCondition(v.title.replace(/foil/i, '')),
        finish: isFoil ? 'foil' : 'nonfoil',
        price: v.priceCents / 100,
        stock: v.qty,
        inStock: v.available && v.qty > 0,
        url: p.url,
        image: p.image,
      });
    }
  }
  return out;
}

module.exports = {
  id: 'greyogre',
  name: 'Grey Ogre Games',
  homepage: BASE,
  searchPageUrl: (name) => searchUrl(name),
  search,
  _parsePage: parsePage,
};
