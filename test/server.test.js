'use strict';

// Starts the real Express app (no network calls) so syntax or wiring mistakes in
// server.js fail the test run instead of only showing up after a deploy.
const test = require('node:test');
const assert = require('node:assert/strict');

test('the server starts and serves its basic endpoints', async () => {
  const app = require('../src/server');
  const server = app.listen(0);
  await new Promise((r) => server.once('listening', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const stores = await (await fetch(`${base}/api/stores`)).json();
    assert.equal(stores.length, 7);
    assert.ok(stores.every((s) => s.id && s.name && s.homepage));
    const bad = await fetch(`${base}/api/prices?store=nope&name=x`);
    assert.equal(bad.status, 400);
    const admin = await fetch(`${base}/api/admin/movers`);
    assert.ok([401, 503].includes(admin.status), `admin report needs a sign-in (got ${admin.status})`);
    const page = await fetch(`${base}/`);
    assert.equal(page.status, 200);
    assert.match(await page.text(), /<link rel="canonical"/, 'main page is served with its metadata');
    const card = await (await fetch(`${base}/?card=Sol%20Ring`)).text();
    assert.match(card, /<title>Sol Ring price in Singapore/);
    const robots = await fetch(`${base}/robots.txt`);
    assert.equal(robots.status, 200);
    assert.match(robots.headers.get('content-type'), /text\/plain/);
    for (const f of ['/styles.css', '/favicon.svg', '/og-image.png', '/manifest.webmanifest', '/searches.html']) {
      assert.equal((await fetch(base + f)).status, 200, f);
    }
    assert.match(await (await fetch(`${base}/searches.html`)).text(), /<meta name="robots" content="noindex, nofollow"/);
  } finally {
    server.close();
  }
});
