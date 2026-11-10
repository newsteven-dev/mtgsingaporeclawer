'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

process.env.SUPABASE_URL = 'https://example.supabase.co';
process.env.SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_test';
process.env.ADMIN_GITHUB_USERS = 'newsteven-dev, Someone-Else';

const auth = require('../src/auth');

// Fake Supabase /auth/v1/user: the token decides which user comes back.
const USERS = {
  owner: { id: '1', app_metadata: { provider: 'github' }, user_metadata: { user_name: 'NewSteven-Dev', avatar_url: 'a' } },
  stranger: { id: '2', app_metadata: { provider: 'github' }, user_metadata: { user_name: 'random-person' } },
  emailUser: { id: '3', app_metadata: { provider: 'email' }, user_metadata: { user_name: 'newsteven-dev' } },
};
global.fetch = async (url, opts) => {
  assert.equal(url, 'https://example.supabase.co/auth/v1/user');
  assert.equal(opts.headers.apikey, 'sb_publishable_test');
  const token = opts.headers.Authorization.replace('Bearer ', '');
  const user = USERS[token];
  return user
    ? { ok: true, status: 200, json: async () => user }
    : { ok: false, status: 401, json: async () => ({ msg: 'invalid JWT' }) };
};

function call(authorization) {
  return new Promise((resolve) => {
    const req = { headers: authorization ? { authorization } : {} };
    const res = {
      code: 200,
      status(c) { this.code = c; return this; },
      json(body) { resolve({ code: this.code, body, req }); },
    };
    auth.requireAdmin(req, res, () => resolve({ code: 200, req }));
  });
}

test('allowlisted GitHub user gets through (case-insensitive)', async () => {
  const r = await call('Bearer owner');
  assert.equal(r.code, 200);
  assert.equal(r.req.user.login, 'newsteven-dev');
});

test('other GitHub users are refused', async () => {
  assert.equal((await call('Bearer stranger')).code, 403);
});

test('non-GitHub sign-ins are refused even with a matching name', async () => {
  assert.equal((await call('Bearer emailUser')).code, 403);
});

test('missing or invalid tokens get 401', async () => {
  assert.equal((await call()).code, 401);
  assert.equal((await call('Bearer nope')).code, 401);
});

test('public config exposes only the URL and publishable key', () => {
  assert.deepEqual(auth.publicConfig(), { enabled: true, supabaseUrl: 'https://example.supabase.co', publishableKey: 'sb_publishable_test' });
});
