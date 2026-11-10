'use strict';

const crypto = require('crypto');
const { getJson, titleMatchesCard, toNumber, normalizeCondition } = require('../util');

const SITE = 'https://thetcgmarketplace.com';
// The React storefront talks to its API on port 3501 (SG region).
const API = process.env.TCG_API_URL || 'https://thetcgmarketplace.com:3501/';

// Public key embedded in the storefront bundle; product page URLs carry the
// RSA-encrypted product id ("/" swapped for "_"), exactly as the site builds them.
const PUBLIC_KEY = `-----BEGIN PUBLIC KEY-----
MIGeMA0GCSqGSIb3DQEBAQUAA4GMADCBiAKBgGlempQY/LwZbvzeYl76yMaH/onD
/olkEmMC5rbms3BSAA/TbzPMEVjjXcKjFHcBlKC5KOAyqNF5z7VZc6hyM6GL8l4o
bNBp6LWUmeZUWFm7rsLNXIm+Sv7IOw2z/1frbyKgWagqRstIkEnmqqsgDrLJc9OS
t5FfOO99tterVzVlAgMBAAE=
-----END PUBLIC KEY-----`;

function encodeId(id) {
  const buf = crypto.publicEncrypt(
    { key: PUBLIC_KEY, padding: crypto.constants.RSA_PKCS1_OAEP_PADDING },
    Buffer.from(String(id)),
  );
  return buf.toString('base64').replace(/\//g, '_');
}

function productUrl(id) {
  try {
    return `${SITE}/product/B/${encodeURIComponent(encodeId(id))}/0`;
  } catch {
    return SITE;
  }
}

let cachedCategoryId = process.env.TCG_MTG_CATEGORY_ID ? Number(process.env.TCG_MTG_CATEGORY_ID) : null;
let categoriesSeen = [];

async function mtgCategoryId() {
  if (cachedCategoryId) return cachedCategoryId;
  const res = await getJson(new URL('category/getallcategory', API).toString());
  const list = res?.data?.data ?? res?.data ?? [];
  const arr = Array.isArray(list) ? list : [];
  categoriesSeen = arr.slice(0, 20).map((c) => ({ id: c.id, title: c.title || c.name }));
  const mtg = arr.find((c) => /magic|\bmtg\b/i.test(c.title || c.name || ''));
  cachedCategoryId = Number(mtg ? mtg.id : 1);
  return cachedCategoryId;
}

const first = (r, keys) => {
  for (const k of keys) if (r[k] !== undefined && r[k] !== null && r[k] !== '') return r[k];
  return undefined;
};

function parseResults(rows, cardName) {
  const out = [];
  for (const r of Array.isArray(rows) ? rows : []) {
    if (!r || r.name === 'No results') continue;
    // Names come back as " [FCA] Lightning Bolt": drop the leading set-code tag.
    const title = String(first(r, ['card_name', 'name', 'crd_name', 'title']) || '').replace(/^\s*\[[^\]]*\]\s*/, '').trim();
    if (!title || !titleMatchesCard(title, cardName)) continue;
    const price = toNumber(first(r, ['from', 'lowest_price', 'min_price', 'price', 'selling_price', 'highest_price']));
    if (!price) continue;
    const stock = Number(first(r, ['available', 'qty', 'quantity', 'total_qty', 'stock']) || 0);
    const foilRaw = first(r, ['crd_foil_type', 'foil_type', 'crd_foil', 'foil', 'is_foil']);
    const foil = foilRaw === undefined ? '' : String(foilRaw);
    const isFoil = /^(1|true|yes)$/i.test(foil) || (/foil/i.test(foil) && !/non/i.test(foil));
    out.push({
      title,
      set: first(r, ['set_name', 'expansion_name', 'setname']) || '',
      setCode: String(first(r, ['setcode', 'set_code']) || '').toUpperCase(),
      condition: normalizeCondition(first(r, ['crd_condition', 'condition']) || ''),
      finish: isFoil ? 'foil' : 'nonfoil',
      price,
      stock,
      inStock: stock > 0,
      url: r.id ? productUrl(r.id) : SITE,
      image: r.image || null,
      note: 'Marketplace: lowest listed price across sellers',
    });
  }
  return out;
}

async function post(path, payload) {
  const res = await getJson(new URL(path, API).toString(), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: SITE, Referer: `${SITE}/` },
    body: JSON.stringify(payload),
  });
  if (res && res.status && Number(res.status) !== 200) throw new Error(res.message || `API status ${res.status}`);
  const rows = res?.data?.data ?? res?.data ?? [];
  return Array.isArray(rows) ? rows : [];
}

async function search(cardName) {
  const categoryId = await mtgCategoryId();
  // Same request as the site's search results page ("product/filter" only feeds the
  // suggestion dropdown and has no prices).
  const rows = await post('product/advancedfilter', {
    category_id: categoryId,
    name_exact_match: true,
    available_only: false,
    name: cardName,
  });
  const listings = parseResults(rows, cardName);
  if (rows.length && !listings.length) {
    // The API answered but nothing could be read: report the row format (public listing
    // data only) in the response and the server log, so a format change is easy to spot.
    listings.diagnostics = {
      rows: rows.length,
      categoryId,
      categories: categoriesSeen,
      firstRowKeys: Object.keys(rows[0] || {}),
      firstRow: Object.fromEntries(Object.entries(rows[0] || {}).slice(0, 25).map(([k, v]) => [k, typeof v === 'string' ? v.slice(0, 80) : v])),
    };
    console.warn(`[tcgmarketplace] ${rows.length} rows for "${cardName}" but none parsed; first row keys: ${Object.keys(rows[0] || {}).join(', ')}`);
  }
  return listings;
}

module.exports = {
  id: 'tcgmarketplace',
  name: 'The TCG Marketplace',
  homepage: SITE,
  searchPageUrl: () => SITE,
  search,
  _parseResults: parseResults,
};
