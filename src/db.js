'use strict';

/**
 * Price history storage in Supabase (via its REST API, no extra dependency).
 *
 * Needs SUPABASE_URL and SUPABASE_SECRET_KEY (a `sb_secret_...` key or the legacy
 * service_role key). These stay on the server; the browser never sees them.
 * Without them, price tracking is simply turned off.
 */

const { http } = require('./util');

const URL_BASE = (process.env.SUPABASE_URL || '').replace(/\/+$/, '');
const KEY = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || '';

const enabled = Boolean(URL_BASE && KEY);

function headers(extra = {}) {
  const h = {
    apikey: KEY,
    'Content-Type': 'application/json',
    Accept: 'application/json',
    // Supabase refuses secret keys from browser-like User-Agents, so identify as a server app.
    'User-Agent': 'mtg-sg-price-compare-server/1.0',
    ...extra,
  };
  // Legacy JWT keys also go in Authorization; new sb_secret_ keys only use the apikey header.
  if (KEY.startsWith('eyJ')) h.Authorization = `Bearer ${KEY}`;
  return h;
}

async function rest(path, opts = {}) {
  const res = await http(`${URL_BASE}/rest/v1/${path}`, { ...opts, headers: headers(opts.headers) });
  const text = await res.text();
  return text ? JSON.parse(text) : null;
}

/** Store one store's results for a card. Only fresh (non-cached) fetches should be recorded. */
async function recordSnapshot(cardName, store, listings) {
  if (!enabled) return null;
  const slim = listings.map(({ title, set, setCode, condition, finish, price, stock, inStock, url }) => ({
    title, set, setCode, condition, finish, price, stock, inStock, url,
  }));
  return rest('rpc/record_price_snapshot', {
    method: 'POST',
    body: JSON.stringify({ p_card_name: cardName, p_store: store, p_listings: slim }),
  });
}

/** Daily cheapest in-stock price per store for a card, oldest first. */
async function history(cardName, days = 90) {
  if (!enabled) return [];
  const since = new Date(Date.now() - days * 86400000).toISOString().slice(0, 10);
  const q = new URLSearchParams({
    select: 'store,day,min_price,min_price_nonfoil,min_price_foil,in_stock_count',
    card_key: `eq.${cardName.toLowerCase()}`,
    day: `gte.${since}`,
    order: 'day.asc',
  });
  return rest(`card_price_daily?${q}`);
}

/** Recently searched cards with current cheapest price and change vs a week ago. */
async function trending(limit = 12) {
  if (!enabled) return [];
  const q = new URLSearchParams({
    select: 'card_name,checks_30d,last_checked,cheapest_now,cheapest_store,cheapest_7d_ago',
    order: 'last_checked.desc',
    limit: String(limit),
  });
  return rest(`trending_cards?${q}`);
}

module.exports = { enabled, recordSnapshot, history, trending };
