'use strict';

/**
 * Card Kingdom retail prices (what CK sells a card for), per printing and condition.
 *
 * CK publishes its full price list once a day at api.cardkingdom.com/api/v2/pricelist
 * (~68 MB JSON, ~150k entries, with NM/EX/VG/G prices and stock). We stream it, keep only
 * the fields we need, index it by card name in memory, and refresh it every few hours.
 */

const { http, getJson, normalizeName, toNumber } = require('./util');

const PRICELIST_URL = process.env.CK_PRICELIST_URL || 'https://api.cardkingdom.com/api/v2/pricelist';
const SITE = 'https://www.cardkingdom.com/';
const REFRESH_MS = 6 * 60 * 60 * 1000;
// Card Kingdom condition grades, mapped to the NM/LP/MP/HP labels the Singapore shops use.
const CONDITIONS = [
  { key: 'nm', label: 'NM', equivalent: 'NM' },
  { key: 'ex', label: 'EX', equivalent: 'LP' },
  { key: 'vg', label: 'VG', equivalent: 'MP' },
  { key: 'g', label: 'G', equivalent: 'HP' },
];
const UA = { 'User-Agent': 'mtg-sg-price-compare/1.0' };

let index = null; // Map<normalizedName, entry[]>
let meta = { createdAt: null, loadedAt: 0, entries: 0 };
let loading = null;

/**
 * Pull complete JSON objects of the "data" array out of a stream of text chunks
 * without holding the whole document in memory. Records are flat objects at depth 3:
 *   { "meta": {...}, "data": [ {record}, {record}, ... ] }
 */
function createRecordScanner(onRecord, onMeta) {
  let depth = 0;
  let inString = false;
  let escaped = false;
  let buf = '';
  let capturing = false;
  let metaBuf = '';
  let inMeta = false;

  return function feed(chunk) {
    let start = capturing || inMeta ? 0 : -1;
    for (let i = 0; i < chunk.length; i++) {
      const c = chunk[i];
      if (inString) {
        if (escaped) escaped = false;
        else if (c === '\\') escaped = true;
        else if (c === '"') inString = false;
        continue;
      }
      if (c === '"') {
        inString = true;
      } else if (c === '{' || c === '[') {
        depth++;
        if (c === '{' && depth === 3) {
          capturing = true;
          start = i;
        } else if (c === '{' && depth === 2 && !inMeta && onMeta) {
          inMeta = true;
          metaBuf = '';
          start = i;
        }
      } else if (c === '}' || c === ']') {
        if (c === '}' && depth === 3 && capturing) {
          buf += chunk.slice(start, i + 1);
          try {
            onRecord(JSON.parse(buf));
          } catch {
            /* skip malformed record */
          }
          buf = '';
          capturing = false;
          start = -1;
        } else if (c === '}' && depth === 2 && inMeta) {
          metaBuf += chunk.slice(start, i + 1);
          try {
            onMeta(JSON.parse(metaBuf));
          } catch {
            /* ignore */
          }
          inMeta = false;
          start = -1;
        }
        depth--;
      }
    }
    if (capturing && start >= 0) buf += chunk.slice(start);
    else if (inMeta && start >= 0) metaBuf += chunk.slice(start);
  };
}

function slim(r) {
  const retail = toNumber(r.price_retail);
  if (!r.name || retail == null) return null;
  const cv = r.condition_values || {};
  const conds = CONDITIONS.map((c) => {
    const price = toNumber(cv[`${c.key}_price`]);
    return price == null ? null : [price, Number(cv[`${c.key}_qty`] || 0)];
  });
  // Older (v1) lists have no per-condition data: treat the retail price as NM.
  if (!conds.some(Boolean)) conds[0] = [retail, Number(r.qty_retail || 0)];
  return {
    name: r.name,
    edition: r.edition || '',
    variation: r.variation || '',
    foil: String(r.is_foil) === 'true',
    conds, // [[price, qty] | null] in NM, EX, VG, G order (compact to save memory)
    qty: Number(r.qty_retail || 0),
    url: r.url ? SITE + r.url : null,
    sid: r.scryfall_id || null, // Scryfall card id, for pictures and canonical names
  };
}

function keysFor(name) {
  const n = normalizeName(name);
  const keys = [n];
  if (n.includes('//')) keys.push(n.split('//')[0].trim());
  return keys;
}

async function load() {
  const res = await http(PRICELIST_URL, { headers: UA, timeout: 120000 });
  const next = new Map();
  let count = 0;
  let createdAt = null;
  const feed = createRecordScanner(
    (r) => {
      const e = slim(r);
      if (!e) return;
      count++;
      for (const k of keysFor(e.name)) {
        let arr = next.get(k);
        if (!arr) next.set(k, (arr = []));
        arr.push(e);
      }
    },
    (m) => {
      if (m && m.created_at) createdAt = m.created_at;
    },
  );
  const decoder = new TextDecoder();
  for await (const chunk of res.body) feed(decoder.decode(chunk, { stream: true }));
  feed(decoder.decode());
  if (!count) throw new Error('Card Kingdom price list was empty');
  index = next;
  meta = { createdAt, loadedAt: Date.now(), entries: count };
  return index;
}

async function ensureLoaded() {
  const stale = !index || Date.now() - meta.loadedAt > REFRESH_MS;
  if (!stale) return index;
  if (!loading) {
    // Free the old list before building the new one, so two copies (~120 MB each) are never
    // in memory at once; requests during the few-second reload wait for the new list.
    index = null;
    loading = load().finally(() => {
      loading = null;
    });
  }
  return loading;
}

/* ---------- USD -> SGD ---------- */

let fx = { rate: Number(process.env.USD_SGD_RATE) || null, date: null, fetchedAt: 0 };

async function usdToSgd() {
  if (process.env.USD_SGD_RATE) return { rate: Number(process.env.USD_SGD_RATE), date: 'fixed' };
  if (fx.rate && Date.now() - fx.fetchedAt < 12 * 60 * 60 * 1000) return fx;
  try {
    const j = await getJson('https://api.frankfurter.dev/v1/latest?base=USD&symbols=SGD', { headers: UA, timeout: 10000 });
    const rate = j && j.rates && Number(j.rates.SGD);
    if (rate) fx = { rate, date: j.date, fetchedAt: Date.now() };
  } catch (err) {
    console.error(`[fx] ${err.message}`);
  }
  return fx.rate ? fx : { rate: null, date: null };
}

/* ---------- Public API ---------- */

function searchUrl(name) {
  const u = new URL('/catalog/search', SITE);
  u.searchParams.set('search', 'header');
  u.searchParams.set('filter[name]', name);
  return u.toString();
}

const sgd = (usd, rate) => (rate && usd != null ? Math.round(usd * rate * 100) / 100 : null);

/** Card Kingdom's retail prices for every version of a card: in stock first, cheapest first. */
async function sellPrices(cardName) {
  const [idx, fxr] = await Promise.all([ensureLoaded(), usdToSgd()]);
  const rate = fxr.rate;
  const want = normalizeName(cardName);
  const seen = new Set();
  const rows = [];
  for (const k of keysFor(cardName)) {
    for (const e of idx.get(k) || []) {
      // Only exact name (or front-face) matches; skip "Lightning Bolt (Art Card)" style entries.
      const n = normalizeName(e.name);
      if (n !== want && n !== want.split('//')[0].trim() && n.split('//')[0].trim() !== want) continue;
      const id = `${e.edition}|${e.variation}|${e.foil}`;
      if (seen.has(id)) continue;
      seen.add(id);
      const conditions = CONDITIONS.map((c, i) => {
        const v = e.conds[i];
        return v ? { grade: c.label, equivalent: c.equivalent, usd: v[0], sgd: sgd(v[0], rate), qty: v[1] } : null;
      }).filter(Boolean);
      const available = conditions.filter((c) => c.qty > 0);
      const cheapest = available.reduce((m, c) => (m && m.usd <= c.usd ? m : c), null);
      rows.push({
        edition: e.edition,
        variation: e.variation,
        finish: e.foil ? 'foil' : 'nonfoil',
        conditions,
        inStock: available.length > 0,
        qty: available.reduce((t, c) => t + c.qty, 0),
        cheapest, // cheapest condition actually in stock
        url: e.url,
      });
    }
  }
  const sortPrice = (r) => (r.cheapest ? r.cheapest.usd : r.conditions[0] ? r.conditions[0].usd : Infinity);
  rows.sort((a, b) => Number(b.inStock) - Number(a.inStock) || sortPrice(a) - sortPrice(b));
  return {
    card: cardName,
    versions: rows,
    searchUrl: searchUrl(cardName),
    priceListDate: meta.createdAt,
    usdSgd: rate,
    usdSgdDate: fxr.date,
  };
}

/**
 * The most expensive regular printings in one edition (e.g. "Reality Fracture"): non-foil,
 * no special variation, ranked by Card Kingdom's Near Mint price, one entry per card.
 * Special versions live in separate editions ("Reality Fracture Variants") and are left out.
 */
async function topInEdition(edition, n = 5) {
  const [idx, fxr] = await Promise.all([ensureLoaded(), usdToSgd()]);
  const want = normalizeName(edition);
  const best = new Map();
  for (const entries of idx.values()) {
    for (const e of entries) {
      if (e.foil || e.variation || normalizeName(e.edition) !== want) continue;
      const nm = e.conds[0];
      if (!nm) continue;
      const cur = best.get(e.name);
      if (!cur || nm[0] > cur.conds[0][0]) best.set(e.name, e);
    }
  }
  return [...best.values()]
    .sort((a, b) => b.conds[0][0] - a.conds[0][0])
    .slice(0, n)
    .map((e) => ({
      name: e.name,
      usd: e.conds[0][0],
      sgd: sgd(e.conds[0][0], fxr.rate),
      nmQty: e.conds[0][1],
      url: e.url,
      scryfallId: e.sid || null,
    }));
}

/**
 * Every regular printing (non-foil, no special variation) in one edition, one entry per card,
 * with Card Kingdom's price and stock for each condition. Conditions are keyed by the
 * Singapore stores' grades: NM, LP (CK "EX"), MP (CK "VG"), HP (CK "G").
 */
async function editionCards(edition) {
  const idx = await ensureLoaded();
  const want = normalizeName(edition);
  const best = new Map();
  for (const entries of idx.values()) {
    for (const e of entries) {
      if (e.foil || e.variation || normalizeName(e.edition) !== want || !e.conds[0]) continue;
      const cur = best.get(e.name);
      if (!cur || e.conds[0][0] > cur.conds[0][0]) best.set(e.name, e);
    }
  }
  return [...best.values()].map((e) => {
    const usd = {};
    const qty = {};
    CONDITIONS.forEach((c, i) => {
      if (e.conds[i]) {
        usd[c.equivalent] = e.conds[i][0];
        qty[c.equivalent] = e.conds[i][1];
      }
    });
    return { name: e.name, url: e.url, scryfallId: e.sid || null, usd, qty };
  });
}

/**
 * The date of the Card Kingdom price list currently loaded ("YYYY-MM-DD"), from its
 * meta.created_at (US Eastern). Card Kingdom publishes one list a day, around 06:00 ET.
 */
async function priceListDate() {
  await ensureLoaded();
  const m = /^(\d{4}-\d{2}-\d{2})/.exec(String(meta.createdAt || ''));
  return m ? m[1] : null;
}

module.exports = { sellPrices, ensureLoaded, usdToSgd, topInEdition, editionCards, priceListDate, _createRecordScanner: createRecordScanner, _slim: slim };
