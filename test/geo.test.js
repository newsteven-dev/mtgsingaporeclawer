'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const geo = require('../src/geo');

test("prefers Cloudflare's visitor address over the proxy's", () => {
  const req = {
    ip: '172.71.0.1', // a proxy
    headers: { 'cf-connecting-ip': '203.116.1.1', 'x-forwarded-for': '198.51.100.7, 172.71.0.1' },
  };
  assert.equal(geo.clientIp(req), '203.116.1.1');
  assert.equal(geo.clientIp({ ip: '::ffff:8.8.8.8', headers: {} }), '8.8.8.8');
  assert.equal(geo.clientIp({ headers: { 'x-forwarded-for': '9.9.9.9, 10.0.0.1' } }), '9.9.9.9');
  assert.equal(geo.clientIp({ headers: { 'cf-connecting-ip': 'not-an-ip' }, ip: '1.1.1.1' }), '1.1.1.1');
});

test('private and local addresses have no location', async () => {
  for (const ip of ['127.0.0.1', '10.1.2.3', '192.168.1.10', '172.20.0.5', '100.64.0.1', '::1', 'fd00::1']) {
    assert.ok(geo._isPrivate(ip), ip);
    assert.equal(await geo.locate(ip), null);
  }
  assert.ok(!geo._isPrivate('203.116.1.1'));
});

test('looks up city, region and country from the bundled database', async () => {
  const sg = await geo.locate('203.116.1.1');
  assert.equal(sg.country, 'SG');
  assert.match(sg.city, /Singapore/);
  const us = await geo.locate('8.8.8.8');
  assert.equal(us.country, 'US');
  assert.ok(us.city);
  assert.deepEqual(Object.keys(us).sort(), ['city', 'country', 'region'], 'only the place is returned, nothing else');
});

test('IPv6 visitors get their country (the small country database)', async () => {
  const v6 = await geo.locate('2406:3003:2000::1');
  assert.deepEqual(v6, { city: '', region: '', country: 'SG' });
});

test('the saved location never includes the IP address', async () => {
  const db = require('../src/db');
  // recordSnapshot only forwards city/region/country, even if given extra fields.
  const sent = [];
  const realFetch = global.fetch;
  process.env.SUPABASE_URL = process.env.SUPABASE_URL || '';
  global.fetch = async (_url, opts) => {
    sent.push(JSON.parse(opts.body));
    return { ok: true, status: 200, text: async () => '1' };
  };
  try {
    if (db.enabled) {
      await db.recordSnapshot('Card', 'agora', [], { city: 'Singapore', region: '', country: 'SG', ip: '203.116.1.1' });
      assert.deepEqual(sent[0].p_location, { city: 'Singapore', region: '', country: 'SG' });
    } else {
      assert.equal(await db.recordSnapshot('Card', 'agora', [], { ip: '1.2.3.4' }), null);
    }
  } finally {
    global.fetch = realFetch;
  }
});
