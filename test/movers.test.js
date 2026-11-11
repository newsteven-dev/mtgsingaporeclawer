'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const movers = require('../src/movers');

const set = { code: 'fra', name: 'Reality Fracture' };

test("only the set's own printing counts, not older reprints", () => {
  assert.ok(movers._isSetPrinting({ set: 'Reality Fracture', setCode: '' }, set));
  assert.ok(movers._isSetPrinting({ set: 'Reality Fracture Variants' }, set), 'showcase/borderless versions of the set count');
  assert.ok(movers._isSetPrinting({ set: '', setCode: 'FRA' }, set), 'set code match (Agora, Mox & Lotus, TCG Marketplace)');
  assert.ok(movers._isSetPrinting({ set: 'Reality Fracture: Prerelease' }, set));
  assert.ok(!movers._isSetPrinting({ set: 'Magic 2010', setCode: 'M10' }, set), 'older reprints are left out');
  assert.ok(!movers._isSetPrinting({ set: '', setCode: '' }, set), 'unknown set is left out');
});

test("compares each listing with Card Kingdom's price for the same condition", () => {
  const ck = { usd: { NM: 10, LP: 8, MP: 7 } };
  assert.deepEqual(movers._ckPriceFor(ck, 'NM'), { usd: 10, grade: 'NM' });
  assert.deepEqual(movers._ckPriceFor(ck, 'LP'), { usd: 8, grade: 'LP' });
  assert.deepEqual(movers._ckPriceFor(ck, 'MP'), { usd: 7, grade: 'MP' });
  assert.deepEqual(movers._ckPriceFor(ck, 'HP'), { usd: 7, grade: 'MP' }, 'falls back to the nearest better grade CK has');
  assert.deepEqual(movers._ckPriceFor({ usd: { NM: 10 } }, 'LP'), { usd: 10, grade: 'NM' });
  assert.equal(movers._ckPriceFor({ usd: {} }, 'NM'), null);
});
