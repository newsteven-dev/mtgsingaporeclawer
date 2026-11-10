'use strict';

const cheerio = require('cheerio');
const { getText, titleMatchesCard, toNumber, normalizeCondition } = require('../util');

const BASE = 'https://agorahobby.com';
const PER_PAGE = 30;
const MAX_PAGES = 4;

function searchUrl(name, offset = 0) {
  const u = new URL('/store/search', BASE);
  u.searchParams.set('category', 'mtg');
  u.searchParams.set('searchfield', name);
  if (offset) u.searchParams.set('p', String(offset));
  return u.toString();
}

/** Parse one Agora search results page (server-rendered ExpressionEngine store). */
function parsePage(html) {
  const $ = cheerio.load(html);
  const items = [];
  $('.store-item').each((_, el) => {
    const $el = $(el);
    const title = $el.find('.store-item-title').first().text().trim();
    if (!title) return;
    const entryId = $el.find('input[name="entry_id"]').attr('value') || $el.find('.item-data').attr('data-itemid');
    // "[SLD] Rare - NM/M"
    const cat = $el.find('.store-item-cat').first().text().trim();
    const catMatch = cat.match(/^\[([^\]]+)\]\s*(.*?)\s*-\s*(.+)$/);
    const setCode = catMatch ? catMatch[1] : '';
    const rarity = catMatch ? catMatch[2] : '';
    let condition = catMatch ? catMatch[3] : '';
    // titles like "Lightning Bolt (Fourth Edition) [EX-PLD]" carry the real condition
    const condInTitle = title.match(/\[(NM|EX|MP|HP|PLD|EX-PLD|MP-PLD|HP-PLD|Moderately Played|Heavily Played|Lightly Played|Damaged)[^\]]*\]$/i);
    if (condInTitle) condition = condInTitle[1];
    const price = toNumber($el.find('.store-item-price').first().text());
    const stock = toNumber($el.find('.store-item-stock').first().text()) ?? toNumber($el.find('.item-data').attr('data-cur_stock')) ?? 0;
    const isFoil = /\bfoil\b/i.test(title) || $el.find('.flag-foil').length > 0;
    const image = $el.find('.store-item-img').attr('data-img') || null;
    const setFromTitle = (title.match(/\(([^)]+)\)/) || [])[1] || '';
    items.push({
      entryId,
      title,
      setCode,
      set: setFromTitle,
      rarity,
      condition: normalizeCondition(condition),
      finish: isFoil ? 'foil' : 'nonfoil',
      price,
      stock,
      image,
    });
  });

  // "Page 1 of 2 pages (60 total items)"
  const totalMatch = $('.search-paginationcontainer').text().match(/\((\d+)\s+total items\)/i);
  const total = totalMatch ? Number(totalMatch[1]) : items.length;
  return { items, total };
}

async function search(cardName) {
  const first = parsePage(await getText(searchUrl(cardName)));
  const pages = Math.min(MAX_PAGES, Math.ceil(first.total / PER_PAGE));
  const rest = await Promise.all(
    Array.from({ length: Math.max(0, pages - 1) }, (_, i) => getText(searchUrl(cardName, (i + 1) * PER_PAGE)).then(parsePage)),
  );
  const all = [first, ...rest].flatMap((p) => p.items);
  const link = searchUrl(cardName);
  return all
    .filter((it) => titleMatchesCard(it.title, cardName))
    .map((it) => ({
      title: it.title,
      set: it.set || it.setCode,
      setCode: it.setCode,
      condition: it.condition,
      finish: it.finish,
      price: it.price,
      stock: it.stock,
      inStock: it.stock > 0,
      url: link,
      image: it.image,
    }));
}

module.exports = {
  id: 'agora',
  name: 'Agora Hobby',
  homepage: BASE,
  searchPageUrl: (name) => searchUrl(name),
  search,
  _parsePage: parsePage,
};
