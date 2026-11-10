'use strict';

/**
 * Sign-in with GitHub through Supabase Auth.
 *
 * The browser signs in with supabase-js and sends its access token as
 * `Authorization: Bearer <token>`. We ask Supabase who the token belongs to and only
 * let through GitHub accounts listed in ADMIN_GITHUB_USERS.
 */

const { http } = require('./util');

const SUPABASE_URL = (process.env.SUPABASE_URL || '').replace(/\/+$/, '');
// Public "publishable" key: safe to send to the browser.
const PUBLISHABLE_KEY = process.env.SUPABASE_PUBLISHABLE_KEY || '';
const list = (v) =>
  String(v || '')
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
// Who may see captured searches. When ADMIN_EMAILS is set, only GitHub accounts whose
// verified email is in it get in (and ADMIN_GITHUB_USERS is ignored). Otherwise the
// GitHub usernames in ADMIN_GITHUB_USERS decide.
const ALLOWED_EMAILS = list(process.env.ADMIN_EMAILS);
const ALLOWED = list(process.env.ADMIN_GITHUB_USERS || 'newsteven-dev');

const enabled = Boolean(SUPABASE_URL && PUBLISHABLE_KEY);
const cache = new Map(); // token -> { user, expires }

function githubLogin(user) {
  const meta = user.user_metadata || {};
  const identity = (user.identities || []).find((i) => i.provider === 'github');
  const idData = (identity && identity.identity_data) || {};
  return String(meta.user_name || meta.preferred_username || idData.user_name || idData.preferred_username || '').toLowerCase();
}

async function userFromToken(token) {
  const hit = cache.get(token);
  if (hit && hit.expires > Date.now()) return hit.user;
  let user = null;
  try {
    const res = await http(`${SUPABASE_URL}/auth/v1/user`, {
      headers: {
        apikey: PUBLISHABLE_KEY,
        Authorization: `Bearer ${token}`,
        Accept: 'application/json',
        'User-Agent': 'mtg-sg-price-compare-server/1.0',
      },
      timeout: 10000,
    });
    const u = await res.json();
    const meta = u.user_metadata || {};
    user = {
      id: u.id,
      login: githubLogin(u),
      name: meta.full_name || meta.name || meta.user_name || '',
      avatar: meta.avatar_url || null,
      provider: (u.app_metadata && u.app_metadata.provider) || '',
      email: String(u.email || '').toLowerCase(),
      emailVerified: Boolean(u.email_confirmed_at || u.confirmed_at),
    };
  } catch (err) {
    if (err.status !== 401 && err.status !== 403) throw err;
  }
  cache.set(token, { user, expires: Date.now() + 60 * 1000 });
  if (cache.size > 200) cache.delete(cache.keys().next().value);
  return user;
}

function isAllowed(user) {
  if (user.provider !== 'github') return false;
  if (ALLOWED_EMAILS.length) return user.emailVerified && ALLOWED_EMAILS.includes(user.email);
  return ALLOWED.includes(user.login);
}

/** Express middleware: requires a signed-in GitHub user on the allowlist. */
function requireAdmin(req, res, next) {
  if (!enabled) return res.status(503).json({ error: 'Sign-in is not configured on this server (SUPABASE_PUBLISHABLE_KEY missing).' });
  const m = String(req.headers.authorization || '').match(/^Bearer\s+(.+)$/i);
  if (!m) return res.status(401).json({ error: 'Please sign in.' });
  userFromToken(m[1])
    .then((user) => {
      if (!user) return res.status(401).json({ error: 'Your session has expired. Please sign in again.' });
      if (!isAllowed(user)) {
        return res.status(403).json({
          error: `GitHub account "${user.login || 'unknown'}" isn't allowed to view captured searches.`,
          user: { login: user.login, name: user.name, avatar: user.avatar },
        });
      }
      req.user = { id: user.id, login: user.login, name: user.name, avatar: user.avatar };
      next();
    })
    .catch((err) => res.status(502).json({ error: `Couldn't check your sign-in: ${err.message}` }));
}

module.exports = {
  enabled,
  requireAdmin,
  publicConfig: () => ({ enabled, supabaseUrl: SUPABASE_URL, publishableKey: PUBLISHABLE_KEY }),
  _githubLogin: githubLogin,
};
