'use strict';

/**
 * Top 5 cards of the newest Magic set, from Scryfall (which carries TCGplayer market prices).
 *
 * TCGplayer's own "trending" list is only available through TCGplayer's internal site API,
 * whose terms don't allow automated use, and its public API is closed to new developers.
 * So we rank the newest set's cards two ways instead:
 *   - "price":  highest TCGplayer market price (Scryfall's prices.usd)
 *   - "played": most played, by EDHREC rank (lower = in more Commander decks)
 */

const { getJson, TtlCache } = require('./util');
const { usdToSgd } = require('./cardkingdom');

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

/** Top 5 cards of the newest set, ranked by "price" or "played". */
async function topCards(rank = 'price') {
  const by = rank === 'played' ? 'played' : 'price';
  const key = `top:${by}`;
  const hit = cache.get(key);
  if (hit) return hit;

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
      };
    });
  const out = { rank: by, set, cards, usdSgd: fx.rate || null, updatedAt: new Date().toISOString() };
  cache.set(key, out);
  return out;
}

module.exports = { topCards, newestSet };
