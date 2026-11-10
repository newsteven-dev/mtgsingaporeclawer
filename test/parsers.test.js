'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { baseCardName, titleMatchesCard, normalizeCondition } = require('../src/util');
const agora = require('../src/stores/agora');
const greyogre = require('../src/stores/greyogre');
const mox = require('../src/stores/moxandlotus');
const mtgasia = require('../src/stores/mtgasia');
const tcg = require('../src/stores/tcgmarketplace');

test('baseCardName strips shop decorations', () => {
  assert.equal(baseCardName('Lightning Bolt FOIL [Secret Lair - 085]'), 'Lightning Bolt');
  assert.equal(baseCardName('Lightning Bolt (Fourth Edition) [EX-PLD]'), 'Lightning Bolt');
  assert.equal(baseCardName('Lightning Bolt [Beta Edition]'), 'Lightning Bolt');
  assert.equal(baseCardName('Thoughtseize (0020 - Showcase)'), 'Thoughtseize');
});

test('titleMatchesCard is exact on card name', () => {
  assert.ok(titleMatchesCard('Lightning Bolt (Showcase)', 'Lightning Bolt'));
  assert.ok(!titleMatchesCard('Chain Lightning', 'Lightning Bolt'));
  assert.ok(!titleMatchesCard('Lightning Bolt Token', 'Lightning Bolt'));
  assert.ok(titleMatchesCard('Delver of Secrets [Innistrad]', 'Delver of Secrets // Insectile Aberration'));
  assert.ok(titleMatchesCard('Aether Vial', 'Æther Vial'));
});

test('normalizeCondition', () => {
  assert.equal(normalizeCondition('Near Mint'), 'NM');
  assert.equal(normalizeCondition('NM/M'), 'NM');
  assert.equal(normalizeCondition('Lightly Played'), 'LP');
  assert.equal(normalizeCondition('EX-PLD'), 'LP');
  assert.equal(normalizeCondition('Moderately Played'), 'MP');
  assert.equal(normalizeCondition('MP-PLD'), 'MP');
  assert.equal(normalizeCondition('Heavily Played'), 'HP');
  assert.equal(normalizeCondition('Damaged'), 'DMG');
});

test('agora page parser', () => {
  const html = `
    <div class="store-item"><form><input name="entry_id" value="1"/>
      <div data-itemid="1" data-cur_stock="1" class="item-data"></div>
      <div class="store-item-img" data-img="https://agorahobby.com/x.jpg"></div>
      <div class="store-item-title">Lightning Bolt FOIL [Secret Lair - 085]</div>
      <div class="store-item-cat">[SLD] Rare - NM/M</div>
      <div class="store-item-price">$$6.50</div>
      <div class="store-item-stock">Stock: 1</div>
      <div class="item-flag flag-foil">Foil</div></form></div>
    <div class="search-paginationcontainer"><p>Page 1 of 1 pages (1 total items)</p></div>`;
  const { items, total } = agora._parsePage(html);
  assert.equal(total, 1);
  assert.deepEqual(
    { setCode: items[0].setCode, condition: items[0].condition, finish: items[0].finish, price: items[0].price, stock: items[0].stock },
    { setCode: 'SLD', condition: 'NM', finish: 'foil', price: 6.5, stock: 1 },
  );
});

test('grey ogre page parser', () => {
  const html = `
    <div class="productCard__card" data-productType="MTG Single">
      <a href="/products/lightning-bolt-beta?_pos=1" class="productCard__a">
        <img data-src="//cdn/x.jpg" alt="Lightning Bolt [Beta Edition]" class="productCard__img"></a>
      <p class="productCard__setName">Beta Edition</p>
      <ul><li class="productChip" data-variantAvailable="true" data-variantQty="5" data-variantPrice="51200" data-variantTitle="Lightly Played"></li>
          <li class="productChip" data-variantAvailable="false" data-variantQty="0" data-variantPrice="64000" data-variantTitle="Near Mint Foil"></li></ul>
    </div>
    <a href="/search?page=3&q=x">3</a>`;
  const { products, lastPage } = greyogre._parsePage(html);
  assert.equal(lastPage, 3);
  assert.equal(products[0].url, 'https://www.greyogregames.com/products/lightning-bolt-beta');
  assert.equal(products[0].variants[0].priceCents, 51200);
  assert.equal(products[0].variants[1].title, 'Near Mint Foil');
});

test('mox & lotus parser', () => {
  const rows = mox._parseProducts(
    [
      {
        id: 5, title: 'Lightning Bolt', category: 'singles', expansion: 'Jumpstart', expansion_code: 'JMP', variation_code: 'foil',
        scryfall_id: 'ce711943-c1a1-43a0-8b89-8d169cfb8e06',
        conditions: [{ code: 'NM', price: '3.79', stocks: 2 }, { code: 'L', price: '0.00', stocks: 0 }],
      },
      { id: 6, title: 'Chain Lightning', category: 'singles', conditions: [{ code: 'NM', price: '9', stocks: 1 }] },
    ],
    'Lightning Bolt',
  );
  assert.equal(rows.length, 1);
  assert.equal(rows[0].url, 'https://moxandlotus.sg/view/JMP/5');
  assert.equal(rows[0].finish, 'foil');
  assert.equal(rows[0].price, 3.79);
});

test('mtg asia parser', () => {
  const rows = mtgasia._parseItems(
    { items: [{ id: 'abc', name: 'Thoughtseize', selling_price: 14.3, qty_available: 1, condition: 'NM', sub_category: '2XM Non-Foil' }] },
    'Thoughtseize',
  );
  assert.equal(rows[0].url, 'https://mtg-asia.com/card/abc');
  assert.equal(rows[0].finish, 'nonfoil');
});

test('tcg marketplace parser', () => {
  const rows = tcg._parseResults(
    [{ id: 42, card_name: 'Lightning Bolt', set_name: 'Magic 2010', lowest_price: '2.5', qty: 3, crd_foil_type: 'Foil' }],
    'Lightning Bolt',
  );
  assert.equal(rows[0].price, 2.5);
  assert.equal(rows[0].finish, 'foil');
  assert.match(rows[0].url, /^https:\/\/thetcgmarketplace\.com\/product\/B\/.+\/0$/);
});

test('card kingdom streaming scanner handles records split across chunks', () => {
  const ck = require('../src/cardkingdom');
  const doc = JSON.stringify({
    meta: { created_at: '2026-11-10 04:09:39', base_url: 'https://www.cardkingdom.com/' },
    data: [
      { name: 'Lightning Bolt', edition: 'Alpha', variation: '', is_foil: 'false', price_buy: '540.00', qty_buying: 3, url: 'mtg/alpha/lightning-bolt' },
      { name: 'Odd "quoted} name', edition: 'X', variation: 'a{b', is_foil: 'true', price_buy: '1.00', qty_buying: 0 },
    ],
  });
  for (const size of [1, 7, 50, doc.length]) {
    const recs = [];
    let m = null;
    const feed = ck._createRecordScanner((r) => recs.push(r), (x) => (m = x));
    for (let i = 0; i < doc.length; i += size) feed(doc.slice(i, i + size));
    assert.equal(recs.length, 2, `chunk size ${size}`);
    assert.equal(recs[1].name, 'Odd "quoted} name');
    assert.equal(m.created_at, '2026-11-10 04:09:39');
  }
});

test('tcg marketplace parser accepts alternate field names and skips price-less suggestion rows', () => {
  const rows = tcg._parseResults(
    [
      { id: 1, name: 'Lightning Bolt', type: 1 }, // suggestion-style row: no price
      { id: 2, name: 'Lightning Bolt', set_name: 'Masters 25', min_price: '3.10', quantity: 2, crd_foil: 1 },
      { id: 3, card_name: 'Chain Lightning', lowest_price: '9' },
      { name: 'No results', type: 0, id: 0 },
    ],
    'Lightning Bolt',
  );
  assert.equal(rows.length, 1);
  assert.equal(rows[0].price, 3.1);
  assert.equal(rows[0].stock, 2);
  assert.equal(rows[0].finish, 'foil');
});

test('card kingdom keeps retail price and stock per condition', () => {
  const ck = require('../src/cardkingdom');
  const e = ck._slim({
    name: 'Lightning Bolt', edition: 'Masters 25', variation: '', is_foil: 'false', price_retail: '2.29', qty_retail: 21,
    url: 'mtg/masters-25/lightning-bolt',
    condition_values: { nm_price: '2.29', nm_qty: 20, ex_price: '1.83', ex_qty: 1, vg_price: '1.60', vg_qty: 0, g_price: '1.15', g_qty: 0 },
  });
  assert.deepEqual(e.conds, [[2.29, 20], [1.83, 1], [1.6, 0], [1.15, 0]]);
  assert.equal(e.url, 'https://www.cardkingdom.com/mtg/masters-25/lightning-bolt');
  // Older lists without condition_values fall back to the retail price as NM.
  assert.deepEqual(ck._slim({ name: 'X', price_retail: '5', qty_retail: 2 }).conds, [[5, 2], null, null, null]);
});

test('tcg marketplace parser reads the live advancedfilter row format', () => {
  // Shape seen from the live API on 2026-11-10.
  const rows = tcg._parseResults(
    [
      { id: 920632, name: ' [FCA] Lightning Bolt', setcode: 'fca', setname: 'Final Fantasy: Through the Ages', crd_foil_type: null, rarity: 'Uncommon', available: 43, from: '1.40' },
      { id: 5, name: ' [STA] Lightning Bolt', setcode: 'sta', setname: 'Strixhaven Mystical Archive', crd_foil_type: 'Etched Foil', available: 0, from: '6.00' },
      { id: 6, name: ' [2X2] Chain Lightning', setcode: '2x2', setname: 'Double Masters 2022', available: 3, from: '2.00' },
    ],
    'Lightning Bolt',
  );
  assert.equal(rows.length, 2);
  assert.deepEqual(
    { title: rows[0].title, set: rows[0].set, setCode: rows[0].setCode, price: rows[0].price, stock: rows[0].stock, inStock: rows[0].inStock, finish: rows[0].finish },
    { title: 'Lightning Bolt', set: 'Final Fantasy: Through the Ages', setCode: 'FCA', price: 1.4, stock: 43, inStock: true, finish: 'nonfoil' },
  );
  assert.equal(rows[1].finish, 'foil');
  assert.equal(rows[1].inStock, false);
});

test('binderpos stores build product links on their own site and spot the bot check', () => {
  const { isBotCheck } = require('../src/stores/binderpos');
  const gh = require('../src/stores/gameshaven');
  const html = `<div class="productCard__card" data-productType="MTG Single">
    <a href="/products/sol-ring-commander-2020?_pos=1" class="productCard__a"><img data-src="//cdn/x.jpg" alt="Sol Ring [Commander 2020]" class="productCard__img"></a>
    <ul><li class="productChip" data-variantAvailable="true" data-variantQty="16" data-variantPrice="247" data-variantTitle="Near Mint"></li></ul></div>`;
  const { products } = gh._parsePage(html);
  assert.equal(products[0].url, 'https://www.gameshaventcg.com/products/sol-ring-commander-2020');
  assert.equal(greyogre._parsePage(html).products[0].url, 'https://www.greyogregames.com/products/sol-ring-commander-2020');
  assert.ok(isBotCheck('<title>Verifying your connection...</title>'));
  assert.ok(!isBotCheck(html));
});

test('flagship reads handles from search results and conditions from product JSON', () => {
  const flagship = require('../src/stores/flagship');
  const { products } = flagship._parseSearchPage(`
    <a href="/products/lightning-bolt-fourth-edition?_pos=1"><img alt="Lightning Bolt [Fourth Edition]"></a>
    <a href="/products/lightning-bolt-fourth-edition?_pos=1"><div class="h4 grid-view-item__title">Lightning Bolt [Fourth Edition]</div></a>
    <a href="/search?page=2&q=x">2</a>`);
  assert.deepEqual(products, [{ handle: 'lightning-bolt-fourth-edition', title: 'Lightning Bolt [Fourth Edition]' }]);
  const rows = flagship._parseProduct({
    handle: 'lightning-bolt-fourth-edition', title: 'Lightning Bolt [Fourth Edition]', type: 'MTG Single', featured_image: '//cdn/x.jpg',
    variants: [{ title: 'Near Mint', price: 300, available: false }, { title: 'Moderately Played', price: 200, available: true }],
  });
  assert.equal(rows.length, 2);
  assert.deepEqual(
    { set: rows[1].set, condition: rows[1].condition, price: rows[1].price, inStock: rows[1].inStock, stock: rows[1].stock, url: rows[1].url },
    { set: 'Fourth Edition', condition: 'MP', price: 2, inStock: true, stock: null, url: 'https://www.flagshipgames.sg/products/lightning-bolt-fourth-edition' },
  );
  assert.deepEqual(flagship._parseProduct({ type: 'Booster Box', variants: [{ price: 100 }] }), []);
});
