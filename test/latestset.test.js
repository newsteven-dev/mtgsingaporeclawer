'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

process.env.USD_SGD_RATE = '1.30';

const requested = [];
global.fetch = async (url) => {
  requested.push(String(url));
  const u = new URL(url);
  let body;
  if (u.pathname === '/sets') {
    body = {
      data: [
        { code: 'fut', name: 'Future Set', set_type: 'expansion', released_at: '2999-01-01', card_count: 300 },
        { code: 'dig', name: 'Digital Set', set_type: 'expansion', released_at: '2026-10-20', card_count: 100, digital: true },
        { code: 'cmd', name: 'Commander Deck', set_type: 'commander', released_at: '2026-10-15', card_count: 100 },
        { code: 'fra', name: 'Reality Fracture', set_type: 'expansion', released_at: '2026-10-02', card_count: 462 },
        { code: 'hob', name: 'The Hobbit', set_type: 'expansion', released_at: '2026-08-14', card_count: 321 },
      ],
    };
  } else if (u.pathname === '/cards/search') {
    const played = u.searchParams.get('order') === 'edhrec';
    body = {
      data: [
        { name: played ? 'Land A' : 'Big Mythic', rarity: 'mythic', prices: { usd: '38.72' }, edhrec_rank: 10, image_uris: { small: 's.jpg' } },
        { name: 'Foil Only', rarity: 'rare', prices: { usd: null, usd_foil: '5.00' }, edhrec_rank: 20, card_faces: [{ image_uris: { small: 'f.jpg' } }] },
        { name: 'No Price', rarity: 'rare', prices: { usd: null, usd_foil: null }, edhrec_rank: 30 },
        ...Array.from({ length: 5 }, (_, i) => ({ name: `Card ${i}`, rarity: 'rare', prices: { usd: '1.00' }, edhrec_rank: 40 + i })),
      ],
    };
  }
  return { ok: true, status: 200, json: async () => body, text: async () => JSON.stringify(body) };
};

const latest = require('../src/latestset');

test('picks the newest released paper expansion or core set', async () => {
  const set = await latest.newestSet();
  assert.equal(set.code, 'fra');
  assert.equal(set.name, 'Reality Fracture');
});

test('top 5 by price skips cards with no price and converts to SGD', async () => {
  const r = await latest.topCards('price');
  assert.equal(r.cards.length, 5);
  assert.deepEqual(r.cards.map((c) => c.name), ['Big Mythic', 'Foil Only', 'Card 0', 'Card 1', 'Card 2']);
  assert.equal(r.cards[0].sgd, 50.34);
  assert.equal(r.cards[1].foilOnly, true);
  assert.equal(r.cards[1].image, 'f.jpg');
  assert.match(r.cards[0].tcgplayerUrl, /^https:\/\/www\.tcgplayer\.com\/search\/magic\/product\?/);
  const search = new URL(requested.find((u) => u.includes('/cards/search') && u.includes('order=usd')));
  assert.equal(search.searchParams.get('q'), 'set:fra game:paper');
  assert.equal(search.searchParams.get('dir'), 'desc');
});

test('most played orders by EDHREC rank', async () => {
  const r = await latest.topCards('played');
  assert.equal(r.rank, 'played');
  assert.equal(r.cards[0].name, 'Land A');
  assert.equal(r.cards[0].edhrecRank, 10);
  assert.ok(requested.some((u) => u.includes('order=edhrec') && u.includes('dir=asc')));
});

test('lists the recent sets and ranks the one asked for', async () => {
  const sets = await latest.recentSets();
  assert.deepEqual(sets.map((s) => s.code), ['fra', 'hob'], 'unreleased, digital and Commander sets are skipped; at most 4');
  const r = await latest.topCards('price', 'HOB');
  assert.equal(r.set.code, 'hob');
  assert.deepEqual(r.sets.map((s) => s.code), ['fra', 'hob']);
  assert.ok(requested.some((u) => decodeURIComponent(u).includes('q=set:hob game:paper') || new URL(u).searchParams.get('q') === 'set:hob game:paper'));
  const fallback = await latest.topCards('price', 'nope');
  assert.equal(fallback.set.code, 'fra', 'unknown set codes fall back to the newest set');
});
