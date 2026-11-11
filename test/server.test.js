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
  } finally {
    server.close();
  }
});
