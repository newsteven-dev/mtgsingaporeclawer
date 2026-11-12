'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

process.env.USD_SGD_RATE = '1.30';

const cv = (nm, qty) => ({ nm_price: String(nm), nm_qty: qty, ex_price: String(nm * 0.8), ex_qty: 0, vg_price: '1', vg_qty: 0, g_price: '1', g_qty: 0 });
const PRICELIST = {
  meta: { created_at: '2026-11-11 04:00:00' },
  data: [
    { name: 'Big Mythic', edition: 'Reality Fracture', variation: '', is_foil: 'false', price_retail: '64.99', qty_retail: 8, url: 'mtg/reality-fracture/big-mythic', condition_values: cv(64.99, 8) },
    { name: 'Big Mythic', edition: 'Reality Fracture', variation: '', is_foil: 'true', price_retail: '90.00', qty_retail: 2, url: 'mtg/reality-fracture/big-mythic-foil', condition_values: cv(90, 2) },
    { name: 'Big Mythic', edition: 'Reality Fracture Variants', variation: 'Borderless', is_foil: 'false', price_retail: '599.99', qty_retail: 1, url: 'x', condition_values: cv(599.99, 1) },
    { name: 'Odd Promo', edition: 'Reality Fracture', variation: 'Prerelease', is_foil: 'false', price_retail: '500', qty_retail: 1, url: 'x', condition_values: cv(500, 1) },
    { name: 'Other Set Card', edition: 'The Hobbit', variation: '', is_foil: 'false', price_retail: '300', qty_retail: 1, url: 'x', condition_values: cv(300, 1) },
    ...['A', 'B', 'C', 'D', 'E'].map((l, i) => ({
      name: `Card ${l}`, edition: 'Reality Fracture', variation: '', is_foil: 'false', price_retail: String(20 - i), qty_retail: i,
      url: `mtg/reality-fracture/card-${l.toLowerCase()}`, condition_values: cv(20 - i, i),
    })),
  ],
};

global.fetch = async (url, opts = {}) => {
  const u = new URL(url);
  if (u.hostname === 'api.cardkingdom.com') {
    const text = JSON.stringify(PRICELIST);
    // Stream it in small chunks, like the real 68 MB download.
    const enc = new TextEncoder();
    const body = (async function* () {
      for (let i = 0; i < text.length; i += 97) yield enc.encode(text.slice(i, i + 97));
    })();
    return { ok: true, status: 200, body };
  }
  let data;
  if (u.pathname === '/cards/search') data = { data: [{ name: 'Big Mythic', prices: { usd: '38.72' }, image_uris: { small: 's.jpg' } }] };
  if (u.pathname === '/sets') data ={ data: [{ code: 'fra', name: 'Reality Fracture', set_type: 'expansion', released_at: '2026-10-02', card_count: 462 }] };
  if (u.pathname === '/cards/collection') {
    const ids = JSON.parse(opts.body).identifiers;
    data = { data: ids.map((id) => ({ name: id.name, image_uris: { small: `${id.name}.jpg` } })) };
  }
  return { ok: true, status: 200, json: async () => data };
};

const latest = require('../src/latestset');

test('Card Kingdom top 5 ranks the set\'s regular non-foil printings by NM price', async () => {
  const r = await latest.topCards('ck');
  assert.equal(r.rank, 'ck');
  assert.equal(r.set.name, 'Reality Fracture');
  assert.deepEqual(r.cards.map((c) => c.name), ['Big Mythic', 'Card A', 'Card B', 'Card C', 'Card D']);
  assert.deepEqual(
    { usd: r.cards[0].usd, sgd: r.cards[0].sgd, nmQty: r.cards[0].nmQty, image: r.cards[0].image, link: r.cards[0].link },
    { usd: 64.99, sgd: 84.49, nmQty: 8, image: 'Big Mythic.jpg', link: { label: 'Card Kingdom', url: 'https://www.cardkingdom.com/mtg/reality-fracture/big-mythic' } },
  );
});

test('unknown rankings fall back to TCGplayer price', async () => {
  const r = await latest.topCards('nonsense');
  assert.equal(r.rank, 'price');
});

test("the snapshot date is the Card Kingdom price list's own date", async () => {
  const ck = require('../src/cardkingdom');
  assert.equal(await ck.priceListDate(), '2026-11-11');
});
