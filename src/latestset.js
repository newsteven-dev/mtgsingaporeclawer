'use strict';

/**
 * Top 5 cards of the newest Magic set, from Scryfall (which carries TCGplayer market prices).
 *
 * TCGplayer's own "trending" list is only available through TCGplayer's internal site API,
 * whose terms don't allow automated use, and its public API is closed to new developers.
 * So we rank the newest set's cards two ways instead:
 *   - "price":  highest TCGplayer market price (Scryfall's prices.usd)
 *   - "played": most played, by EDHREC rank (lower = in more Commander decks)
 *   - "ck":     highest Card Kingdom Near Mint price, regular non-foil printings only
 */

const { getJson, TtlCache } = require('./util');
const { usdToSgd, topInEdition } = require('./cardkingdom');

const HEADERS = { 'User-Agent': 'MTGSGPriceCompare/1.0', Accept: 'application/json' };
const API = 'https://api.scryfall.com';
const cache = new TtlCache(6 * 60 * 60 * 1000);
const SET_TYPES = new Set(['expansion', 'core']);

const RECENT_SETS = 4;

/** The most recently released paper expansion or core sets, newest first. */
async function recentSets() {
  const hit = cache.get('sets');
  if (hit) return hit;
  const today = new Date().toISOString().slice(0, 10);
  const { data } = await getJson(`${API}/sets`, { headers: HEADERS });
  const sets = (data || [])
    .filter((s) => SET_TYPES.has(s.set_type) && !s.digital && s.released_at && s.released_at <= today && s.card_count > 0)
    .sort((a, b) => b.released_at.localeCompare(a.released_at))
    .slice(0, RECENT_SETS)
    .map((s) => ({ code: s.code, name: s.name, releasedAt: s.released_at, icon: s.icon_svg_uri, scryfallUri: s.scryfall_uri }));
  if (!sets.length) throw new Error('No released set found on Scryfall');
  cache.set('sets', sets);
  return sets;
}

/** The newest released paper expansion or core set. */
async function newestSet() {
  return (await recentSets())[0];
}

function imageOf(card) {
  const uris = card.image_uris || (card.card_faces && card.card_faces[0] && card.card_faces[0].image_uris) || {};
  return uris.small || uris.normal || null;
}

const tcgplayerSearch = (name) =>
  `https://www.tcgplayer.com/search/magic/product?productLineName=magic&q=${encodeURIComponent(name)}`;

/** Card images for cards in one set, in one Scryfall request. */
/**
 * Scryfall cards for Card Kingdom rows, in one request. Looks up by Scryfall id when Card
 * Kingdom gives one (its names can differ, e.g. "Mjolnir" or a double-faced card's front
 * face only), otherwise by name within the set. Returns a lookup by row index.
 */
async function scryfallCardsFor(rows, setCode) {
  if (!rows.length) return [];
  const identifiers = rows.map((r) => (r.scryfallId ? { id: r.scryfallId } : { name: r.name, set: setCode }));
  const res = await getJson(`${API}/cards/collection`, {
    method: 'POST',
    headers: { ...HEADERS, 'Content-Type': 'application/json' },
    body: JSON.stringify({ identifiers }),
  });
  const byId = new Map();
  const byName = new Map();
  for (const c of res.data || []) {
    byId.set(c.id, c);
    byName.set(c.name.toLowerCase(), c);
    if (c.card_faces && c.card_faces[0]) byName.set(c.card_faces[0].name.toLowerCase(), c);
  }
  return rows.map((r) => (r.scryfallId && byId.get(r.scryfallId)) || byName.get(r.name.toLowerCase()) || null);
}

/** Top 5 regular printings of the newest set by Card Kingdom's Near Mint price. */
async function topAtCardKingdom(set) {
  const [rows, fx] = await Promise.all([topInEdition(set.name, 5), usdToSgd()]);
  const found = await scryfallCardsFor(rows, set.code).catch(() => []);
  const cards = rows.map((r, i) => ({
    rank: i + 1,
    // Scryfall's name is the one the stores and autocomplete use (accents, both faces).
    name: (found[i] && found[i].name) || r.name,
    image: found[i] ? imageOf(found[i]) : null,
    usd: r.usd,
    foilOnly: false,
    sgd: r.sgd,
    nmQty: r.nmQty,
    link: { label: 'Card Kingdom', url: r.url },
  }));
  return { rank: 'ck', set, cards, usdSgd: fx.rate || null, updatedAt: new Date().toISOString() };
}

/**
 * Top 5 cards of one of the recent sets (default: the newest), ranked by "price",
 * "played" or "ck" (Card Kingdom price). The response lists the recent sets for tabs.
 */
async function topCards(rank = 'price', setCode = '') {
  const by = ['played', 'ck'].includes(rank) ? rank : 'price';
  const sets = await recentSets();
  const set = sets.find((s) => s.code === String(setCode).toLowerCase()) || sets[0];
  const key = `top:${by}:${set.code}`;
  const hit = cache.get(key);
  if (hit) return hit;

  if (by === 'ck') {
    const out = { ...(await topAtCardKingdom(set)), sets };
    if (out.cards.length) cache.set(key, out);
    return out;
  }

  const fx = await usdToSgd();
  const q = new URLSearchParams({
    q: `set:${set.code} game:paper`,
    unique: 'cards',
    order: by === 'played' ? 'edhrec' : 'usd',
    dir: by === 'played' ? 'asc' : 'desc',
  });
  const res = await getJson(`${API}/cards/search?${q}`, { headers: HEADERS });
  const cards = (res.data || [])
    .filter((c) => (by === 'played' ? c.edhrec_rank : c.prices && (c.prices.usd || c.prices.usd_foil)))
    .slice(0, 5)
    .map((c, i) => {
      const usd = Number((c.prices && (c.prices.usd || c.prices.usd_foil)) || 0) || null;
      return {
        rank: i + 1,
        name: c.name,
        rarity: c.rarity,
        image: imageOf(c),
        usd,
        foilOnly: Boolean(!c.prices.usd && c.prices.usd_foil),
        sgd: usd && fx.rate ? Math.round(usd * fx.rate * 100) / 100 : null,
        edhrecRank: c.edhrec_rank || null,
        tcgplayerUrl: tcgplayerSearch(c.name),
        link: { label: 'TCGplayer', url: tcgplayerSearch(c.name) },
      };
    });
  const out = { rank: by, set, sets, cards, usdSgd: fx.rate || null, updatedAt: new Date().toISOString() };
  cache.set(key, out);
  return out;
}

module.exports = { topCards, newestSet, recentSets };
