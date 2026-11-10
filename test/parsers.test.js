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
