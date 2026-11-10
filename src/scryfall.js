'use strict';

const { getJson, TtlCache } = require('./util');

// Scryfall asks API clients to send a descriptive User-Agent and an Accept header.
const HEADERS = { 'User-Agent': 'MTGSGPriceCompare/1.0', Accept: 'application/json' };
const API = 'https://api.scryfall.com';

const acCache = new TtlCache(60 * 60 * 1000);
const cardCache = new TtlCache(6 * 60 * 60 * 1000);

/** Card-name autocomplete (Scryfall returns up to 20 English card names). */
async function autocomplete(q) {
  const query = String(q || '').trim();
  if (query.length < 2) return [];
  const key = query.toLowerCase();
  const hit = acCache.get(key);
  if (hit) return hit;
  const url = `${API}/cards/autocomplete?q=${encodeURIComponent(query)}`;
  const res = await getJson(url, { headers: HEADERS });
  const names = res.data || [];
  acCache.set(key, names);
  return names;
}

function imageOf(card) {
  if (card.image_uris) return card.image_uris.normal;
  if (card.card_faces && card.card_faces[0].image_uris) return card.card_faces[0].image_uris.normal;
  return null;
}

/** Canonical card details for the selected name. */
async function cardInfo(name) {
  const key = String(name || '').toLowerCase();
  const hit = cardCache.get(key);
  if (hit) return hit;
  let card;
  try {
    card = await getJson(`${API}/cards/named?exact=${encodeURIComponent(name)}`, { headers: HEADERS });
  } catch (err) {
    if (err.status !== 404) throw err;
    card = await getJson(`${API}/cards/named?fuzzy=${encodeURIComponent(name)}`, { headers: HEADERS });
  }
  const info = {
    name: card.name,
    typeLine: card.type_line,
    manaCost: card.mana_cost || (card.card_faces || []).map((f) => f.mana_cost).filter(Boolean).join(' // '),
    image: imageOf(card),
    scryfallUri: card.scryfall_uri,
    gathererUri: `https://gatherer.wizards.com/search?name=${encodeURIComponent(card.name)}`,
    usd: card.prices && card.prices.usd,
    usdFoil: card.prices && card.prices.usd_foil,
  };
  cardCache.set(key, info);
  return info;
}

module.exports = { autocomplete, cardInfo };
