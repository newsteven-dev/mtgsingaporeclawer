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

/** The newest released paper expansion or core set. */
async function newestSet() {
  const hit = cache.get('set');
  if (hit) return hit;
  const today = new Date().toISOString().slice(0, 10);
  const { data } = await getJson(`${API}/sets`, { headers: HEADERS });
  const set = (data || [])
    .filter((s) => SET_TYPES.has(s.set_type) && !s.digital && s.released_at && s.released_at <= today && s.card_count > 0)
    .sort((a, b) => b.released_at.localeCompare(a.released_at))[0];
  if (!set) throw new Error('No released set found on Scryfall');
  const info = { code: set.code, name: set.name, releasedAt: set.released_at, icon: set.icon_svg_uri, scryfallUri: set.scryfall_uri };
  cache.set('set', info);
  return info;
}

function imageOf(card) {
  const uris = card.image_uris || (card.card_faces && card.card_faces[0] && card.card_faces[0].image_uris) || {};
  return uris.small || uris.normal || null;
}

const tcgplayerSearch = (name) =>
  `https://www.tcgplayer.com/search/magic/product?productLineName=magic&q=${encodeURIComponent(name)}`;

/** Card images for cards in one set, in one Scryfall request. */
async function imagesFor(names, setCode) {
  if (!names.length) return {};
  const res = await getJson(`${API}/cards/collection`, {
    method: 'POST',
    headers: { ...HEADERS, 'Content-Type': 'application/json' },
    body: JSON.stringify({ identifiers: names.map((name) => ({ name, set: setCode })) }),
  });
  const out = {};
  for (const c of res.data || []) out[c.name.toLowerCase()] = imageOf(c);
  return out;
}

/** Top 5 regular printings of the newest set by Card Kingdom's Near Mint price. */
async function topAtCardKingdom(set) {
  const [rows, fx] = await Promise.all([topInEdition(set.name, 5), usdToSgd()]);
  const images = await imagesFor(rows.map((r) => r.name), set.code).catch(() => ({}));
  const cards = rows.map((r, i) => ({
    rank: i + 1,
    name: r.name,
    image: images[r.name.toLowerCase()] || null,
    usd: r.usd,
    foilOnly: false,
    sgd: r.sgd,
    nmQty: r.nmQty,
    link: { label: 'Card Kingdom', url: r.url },
  }));
  return { rank: 'ck', set, cards, usdSgd: fx.rate || null, updatedAt: new Date().toISOString() };
}

/** Top 5 cards of the newest set, ranked by "price", "played" or "ck" (Card Kingdom price). */
async function topCards(rank = 'price') {
  const by = ['played', 'ck'].includes(rank) ? rank : 'price';
  const key = `top:${by}`;
  const hit = cache.get(key);
  if (hit) return hit;

  if (by === 'ck') {
    const out = await topAtCardKingdom(await newestSet());
    if (out.cards.length) cache.set(key, out);
    return out;
  }

  const [set, fx] = await Promise.all([newestSet(), usdToSgd()]);
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
  const out = { rank: by, set, cards, usdSgd: fx.rate || null, updatedAt: new Date().toISOString() };
  cache.set(key, out);
  return out;
}

module.exports = { topCards, newestSet };
