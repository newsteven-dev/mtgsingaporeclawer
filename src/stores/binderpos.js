'use strict';

/**
 * Shared reader for Shopify stores using the BinderPOS storefront theme (Grey Ogre Games,
 * Games Haven). Their search results list every product with per-condition prices and stock.
 */

const cheerio = require('cheerio');
const { getText, titleMatchesCard, normalizeCondition } = require('../util');

/** Shopify's bot check ("Verifying your connection") instead of the real page. */
function isBotCheck(html) {
  return /<title>\s*Verifying your connection/i.test(html) || /Your connection needs to be verified/i.test(html);
}

/** Parse a BinderPOS-theme search page into product cards with per-condition variants. */
function parsePage(html, base) {
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
      url: href ? new URL(href.split('?')[0], base).toString() : base,
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

function createBinderposStore({ id, name, base, maxPages = 6 }) {
  function searchUrl(cardName, page = 1, exact = true) {
    const u = new URL('/search', base);
    // Shopify storefront search supports field-scoped queries; this keeps results tight.
    u.searchParams.set('q', exact ? `title:"${cardName.replace(/"/g, '')}"` : cardName);
    u.searchParams.set('type', 'product');
    if (page > 1) u.searchParams.set('page', String(page));
    return u.toString();
  }

  async function page(cardName, n, exact) {
    const html = await getText(searchUrl(cardName, n, exact));
    if (isBotCheck(html)) {
      throw new Error(`${name} asked for a browser check, so prices couldn't be read right now. Try again later.`);
    }
    return parsePage(html, base);
  }

  async function fetchAll(cardName, exact) {
    const first = await page(cardName, 1, exact);
    const pages = Math.min(maxPages, first.lastPage);
    const rest = await Promise.all(Array.from({ length: Math.max(0, pages - 1) }, (_, i) => page(cardName, i + 2, exact)));
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

  return {
    id,
    name,
    homepage: base,
    searchPageUrl: (cardName) => searchUrl(cardName),
    search,
    _parsePage: (html) => parsePage(html, base),
  };
}

module.exports = { createBinderposStore, isBotCheck };
