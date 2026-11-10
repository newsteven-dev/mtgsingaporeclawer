'use strict';

const { getJson, titleMatchesCard, toNumber, normalizeCondition } = require('../util');

const BASE = 'https://mtg-asia.com';
// Public Base44 app id embedded in the storefront's index.html.
const APP_ID = process.env.MTGASIA_APP_ID || '6a984c3786516ed6b7f9a090';

const escapeRegex = (s) => String(s || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Same anonymous read the storefront's own search box performs:
 *   InventoryItem.filter({ name: { $regex, $options: 'i' }, spike_hold: { $ne: true } }, { sort: 'name', limit: 300 })
 */
function apiUrl(name) {
  const u = new URL(`/api/apps/${APP_ID}/entities/InventoryItem`, BASE);
  u.searchParams.set('q', JSON.stringify({ name: { $regex: escapeRegex(name), $options: 'i' }, spike_hold: { $ne: true } }));
  u.searchParams.set('sort', 'name');
  u.searchParams.set('limit', '300');
  return u.toString();
}

function searchPageUrl(name) {
  const u = new URL('/store', BASE);
  u.searchParams.set('search', name);
  return u.toString();
}

function isFoil(...fields) {
  const s = fields.filter(Boolean).join(' ');
  return /foil/i.test(s) && !/non[- ]?foil/i.test(s);
}

function parseItems(data, cardName) {
  const items = Array.isArray(data) ? data : data?.items || [];
  const out = [];
  for (const it of items) {
    if (!titleMatchesCard(it.name, cardName)) continue;
    const price = toNumber(it.selling_price);
    if (!price) continue;
    const stock = Number(it.qty_available || 0);
    out.push({
      title: it.name,
      set: it.set_name || it.sub_category || '',
      setCode: '',
      condition: normalizeCondition(it.condition),
      finish: isFoil(it.sub_category, it.name, it.condition) ? 'foil' : 'nonfoil',
      price,
      stock,
      inStock: stock > 0,
      url: it.id ? `${BASE}/card/${it.id}` : searchPageUrl(cardName),
      image: it.image || null,
    });
  }
  return out;
}

async function search(cardName) {
  const data = await getJson(apiUrl(cardName), { headers: { 'X-App-Id': APP_ID } });
  return parseItems(data, cardName);
}

module.exports = {
  id: 'mtgasia',
  name: 'MTG Asia',
  homepage: BASE,
  searchPageUrl,
  search,
  _parseItems: parseItems,
};
