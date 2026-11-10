'use strict';

const path = require('path');
const express = require('express');
const stores = require('./stores');
const scryfall = require('./scryfall');
const { TtlCache } = require('./util');

const PORT = Number(process.env.PORT || 3000);
const CACHE_MINUTES = Number(process.env.CACHE_MINUTES || 10);

const priceCache = new TtlCache(CACHE_MINUTES * 60 * 1000);
const inflight = new Map();

const app = express();
app.disable('x-powered-by');
app.use(express.static(path.join(__dirname, '..', 'public')));

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
  app.listen(PORT, () => console.log(`MTG SG price compare running at http://localhost:${PORT}`));
}

module.exports = app;
