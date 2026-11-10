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

let cachedCategoryId = process.env.TCG_MTG_CATEGORY_ID || null;

async function mtgCategoryId() {
  if (cachedCategoryId) return cachedCategoryId;
  const res = await getJson(new URL('category/getallcategory', API).toString());
  const list = res?.data?.data ?? res?.data ?? [];
  const arr = Array.isArray(list) ? list : [];
  const mtg = arr.find((c) => /magic/i.test(c.title || c.name || ''));
  cachedCategoryId = String(mtg ? mtg.id : 1);
  return cachedCategoryId;
}

function parseResults(rows, cardName) {
  const out = [];
  for (const r of Array.isArray(rows) ? rows : []) {
    if (!r || !r.card_name || r.name === 'No results') continue;
    if (!titleMatchesCard(r.card_name, cardName)) continue;
    const price = toNumber(r.lowest_price) ?? toNumber(r.highest_price);
    if (!price) continue;
    const stock = Number(r.qty || 0);
    const foil = r.crd_foil_type || (String(r.crd_foil || '').match(/^(1|true|yes|foil)$/i) ? 'Foil' : '');
    out.push({
      title: r.card_name,
      set: r.set_name || '',
      setCode: r.setcode || r.set_code || '',
      condition: normalizeCondition(r.crd_condition || ''),
      finish: foil && !/non/i.test(foil) ? 'foil' : 'nonfoil',
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

async function search(cardName) {
  const categoryId = await mtgCategoryId();
  const body = JSON.stringify({ category_id: categoryId, name: cardName, page: 1, item: 100 });
  const res = await getJson(new URL('product/filter', API).toString(), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: SITE, Referer: `${SITE}/` },
    body,
  });
  if (res && res.status && Number(res.status) !== 200) throw new Error(res.message || `API status ${res.status}`);
  return parseResults(res?.data?.data ?? [], cardName);
}

module.exports = {
  id: 'tcgmarketplace',
  name: 'The TCG Marketplace',
  homepage: SITE,
  searchPageUrl: () => SITE,
  search,
  _parseResults: parseResults,
};
