'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

process.env.SUPABASE_URL = 'https://example.supabase.co';
process.env.SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_test';
process.env.ADMIN_EMAILS = 'Owner@Example.com';
process.env.ADMIN_GITHUB_USERS = 'someone-else'; // ignored when ADMIN_EMAILS is set

const auth = require('../src/auth');

const confirmed = '2026-11-10T00:00:00Z';
const USERS = {
  owner: { id: '1', email: 'owner@example.com', email_confirmed_at: confirmed, app_metadata: { provider: 'github' }, user_metadata: { user_name: 'any-name' } },
  unverified: { id: '2', email: 'owner@example.com', app_metadata: { provider: 'github' }, user_metadata: { user_name: 'x' } },
  otherEmail: { id: '3', email: 'friend@example.com', email_confirmed_at: confirmed, app_metadata: { provider: 'github' }, user_metadata: { user_name: 'someone-else' } },
  emailLogin: { id: '4', email: 'owner@example.com', email_confirmed_at: confirmed, app_metadata: { provider: 'email' }, user_metadata: {} },
};
global.fetch = async (_url, opts) => {
  const user = USERS[opts.headers.Authorization.replace('Bearer ', '')];
  return user ? { ok: true, status: 200, json: async () => user } : { ok: false, status: 401, json: async () => ({}) };
};

const call = (token) =>
  new Promise((resolve) => {
    const req = { headers: { authorization: `Bearer ${token}` } };
    const res = { code: 200, status(c) { this.code = c; return this; }, json(body) { resolve({ code: this.code, body }); } };
    auth.requireAdmin(req, res, () => resolve({ code: 200, req }));
  });

test('the GitHub account with the allowed verified email gets in (case-insensitive)', async () => {
  const r = await call('owner');
  assert.equal(r.code, 200);
  assert.equal(r.req.user.email, undefined, 'email is not passed on to handlers');
});

test('an unverified email is refused', async () => {
  assert.equal((await call('unverified')).code, 403);
});

test('other emails are refused, even if the GitHub username is in ADMIN_GITHUB_USERS', async () => {
  const r = await call('otherEmail');
  assert.equal(r.code, 403);
  assert.equal(r.body.user.email, undefined, 'refusal does not echo the email');
});

test('a non-GitHub sign-in with the allowed email is refused', async () => {
  assert.equal((await call('emailLogin')).code, 403);
});
