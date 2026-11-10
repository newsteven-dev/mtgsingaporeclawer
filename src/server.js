'use strict';

// Load .env if present (Node 20.12+). Keeps SUPABASE_SECRET_KEY out of the code.
try {
  process.loadEnvFile();
} catch {
  /* no .env file */
}

const path = require('path');
const express = require('express');
const stores = require('./stores');
const scryfall = require('./scryfall');
const db = require('./db');
const cardkingdom = require('./cardkingdom');
const auth = require('./auth');
const { TtlCache } = require('./util');

const PORT = Number(process.env.PORT || 3000);
const CACHE_MINUTES = Number(process.env.CACHE_MINUTES || 10);

const priceCache = new TtlCache(CACHE_MINUTES * 60 * 1000);
const inflight = new Map();

const app = express();
app.disable('x-powered-by');
// Behind a host's load balancer (Render, Railway, ...), take the client IP from X-Forwarded-For.
app.set('trust proxy', 1);
app.use(express.static(path.join(__dirname, '..', 'public')));
// Browser build of supabase-js for the login pages, served from node_modules (no CDN needed).
app.get('/vendor/supabase.js', (_req, res) =>
  res.sendFile(require.resolve('@supabase/supabase-js/dist/umd/supabase.js'), { maxAge: '1d' }),
);

/**
 * Simple per-IP limit so a public deployment can't be used to hammer the shops
 * (each card search makes one /api/prices call per store).
 */
function rateLimit({ windowMs, max }) {
  const hits = new Map();
  setInterval(() => {
    const now = Date.now();
    for (const [ip, h] of hits) if (h.reset <= now) hits.delete(ip);
  }, windowMs).unref();
  return (req, res, next) => {
    const now = Date.now();
    let h = hits.get(req.ip);
    if (!h || h.reset <= now) hits.set(req.ip, (h = { count: 0, reset: now + windowMs }));
    if (++h.count > max) {
      res.set('Retry-After', String(Math.ceil((h.reset - now) / 1000)));
      return res.status(429).json({ error: 'Too many searches, please wait a few minutes and try again.', listings: [] });
    }
    next();
  };
}

const SEARCHES_PER_10_MIN = Number(process.env.SEARCHES_PER_10_MIN || 40);
app.use('/api/prices', rateLimit({ windowMs: 10 * 60 * 1000, max: SEARCHES_PER_10_MIN * stores.list.length }));
app.use('/api/autocomplete', rateLimit({ windowMs: 60 * 1000, max: 120 }));
app.use('/api/cardkingdom', rateLimit({ windowMs: 10 * 60 * 1000, max: SEARCHES_PER_10_MIN }));

app.get('/api/stores', (_req, res) => {
  res.json(stores.list.map(({ id, name, homepage }) => ({ id, name, homepage })));
});

app.get('/api/autocomplete', async (req, res) => {
  try {
    res.json({ data: await scryfall.autocomplete(req.query.q) });
  } catch (err) {
    res.status(502).json({ data: [], error: err.message });
  }
});

app.get('/api/card', async (req, res) => {
  if (!req.query.name) return res.status(400).json({ error: 'name is required' });
  try {
    res.json(await scryfall.cardInfo(req.query.name));
  } catch (err) {
    res.status(err.status === 404 ? 404 : 502).json({ error: err.message });
  }
});

/** Daily cheapest price per store: GET /api/history?name=Lightning%20Bolt&days=90 */
app.get('/api/history', async (req, res) => {
  if (!db.enabled) return res.json({ enabled: false, days: [] });
  const name = String(req.query.name || '').trim();
  if (!name) return res.status(400).json({ error: 'name is required' });
  const days = Math.min(365, Math.max(1, Number(req.query.days) || 90));
  try {
    res.json({ enabled: true, days: await db.history(name, days) });
  } catch (err) {
    res.status(502).json({ enabled: true, days: [], error: err.message });
  }
});

/** Card Kingdom buylist for every version of a card: GET /api/cardkingdom?name=Lightning%20Bolt */
app.get('/api/cardkingdom', async (req, res) => {
  const name = String(req.query.name || '').trim();
  if (!name) return res.status(400).json({ error: 'name is required' });
  try {
    res.json(await cardkingdom.buyPrices(name));
  } catch (err) {
    console.error(`[cardkingdom] ${name}: ${err.message}`);
    res.status(502).json({ card: name, versions: [], error: err.message });
  }
});

/* ---------- Sign-in (GitHub via Supabase Auth) and captured searches ---------- */

/** Public settings the login page needs. The publishable key is designed to be public. */
app.get('/api/config', (_req, res) => res.json(auth.publicConfig()));

app.get('/api/admin/me', auth.requireAdmin, (req, res) => res.json({ user: req.user }));

app.get('/api/admin/searches', auth.requireAdmin, async (req, res) => {
  const limit = Math.min(200, Math.max(1, Number(req.query.limit) || 50));
  const offset = Math.max(0, Number(req.query.offset) || 0);
  const q = String(req.query.q || '').slice(0, 100);
  try {
    const [searches, cards] = await Promise.all([db.searchEvents({ limit, offset, q }), offset ? null : db.capturedCards()]);
    res.json({ searches, cards, limit, offset });
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});

app.get('/api/admin/snapshots', auth.requireAdmin, async (req, res) => {
  const ids = String(req.query.ids || '')
    .split(',')
    .map((s) => Number(s))
    .filter((n) => Number.isInteger(n) && n > 0)
    .slice(0, 20);
  if (!ids.length) return res.status(400).json({ error: 'ids is required' });
  try {
    res.json({ snapshots: await db.snapshotsWithListings(ids) });
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});

/** Recently searched cards: GET /api/trending */
app.get('/api/trending', async (_req, res) => {
  if (!db.enabled) return res.json({ enabled: false, cards: [] });
  try {
    res.json({ enabled: true, cards: await db.trending() });
  } catch (err) {
    res.status(502).json({ enabled: true, cards: [], error: err.message });
  }
});

/** Price listings for one card at one store: GET /api/prices?store=agora&name=Lightning%20Bolt */
app.get('/api/prices', async (req, res) => {
  const name = String(req.query.name || '').trim();
  const store = stores.byId[req.query.store];
  if (!name) return res.status(400).json({ error: 'name is required' });
  if (!store) return res.status(400).json({ error: `unknown store; use one of ${Object.keys(stores.byId).join(', ')}` });

  const key = `${store.id}|${name.toLowerCase()}`;
  const cached = priceCache.get(key);
  if (cached && req.query.refresh !== '1') return res.json({ ...cached, cached: true });

  const started = Date.now();
  try {
    let p = inflight.get(key);
    if (!p) {
      p = store.search(name).finally(() => inflight.delete(key));
      inflight.set(key, p);
    }
    const listings = (await p).sort((a, b) => Number(b.inStock) - Number(a.inStock) || a.price - b.price);
    const payload = {
      store: store.id,
      storeName: store.name,
      searchUrl: store.searchPageUrl(name),
      listings,
      fetchedAt: new Date().toISOString(),
      ms: Date.now() - started,
    };
    priceCache.set(key, payload);
    res.json(payload);
    // Record fresh results for price history; never let storage errors affect the response.
    db.recordSnapshot(name, store.id, listings).catch((err) => console.error(`[db] ${store.id} ${name}: ${err.message}`));
  } catch (err) {
    console.error(`[${store.id}] ${name}: ${err.message}`);
    res.status(502).json({
      store: store.id,
      storeName: store.name,
      searchUrl: store.searchPageUrl(name),
      listings: [],
      error: err.message,
      ms: Date.now() - started,
    });
  }
});

if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`MTG SG price compare running at http://localhost:${PORT}`);
    console.log(db.enabled ? 'Price history: saving to Supabase' : 'Price history: off (set SUPABASE_URL and SUPABASE_SECRET_KEY to enable)');
  });
}

module.exports = app;
