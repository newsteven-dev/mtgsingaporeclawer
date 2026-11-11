'use strict';

/**
 * Price movers report for the newest set.
 *
 * 1. Once a day (Singapore time) the server saves the set's prices: Card Kingdom NM for every
 *    regular printing, plus the TCGplayer market price from Scryfall. Nobody publishes Card
 *    Kingdom's price history, so movers start from the first day this runs.
 * 2. The report takes the 5 cards whose Card Kingdom NM price changed most over the last
 *    7 days (or the 5 most valuable cards until there are two days of prices), looks them up
 *    at the Singapore stores, and flags in-stock listings of the set's own printing priced
 *    below 50% of Card Kingdom's price for the same condition (converted to S$).
 */

const db = require('./db');
const cardkingdom = require('./cardkingdom');
const latestset = require('./latestset');
const stores = require('./stores');
const { TtlCache, normalizeName, mapLimit } = require('./util');

const MOVER_DAYS = 7;
const TOP_N = 5;
const BARGAIN_RATIO = 0.5;
const reportCache = new TtlCache(10 * 60 * 1000);
let lastSnapshot = { day: null, set: null };

const sgToday = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Singapore' }).format(new Date());

/** Save today's prices for the newest set (at most once per Singapore day unless forced). */
async function snapshotSetPrices({ force = false } = {}) {
  if (!db.enabled) return { skipped: 'no database' };
  const set = await latestset.newestSet();
  const day = sgToday();
  if (!force && lastSnapshot.day === day && lastSnapshot.set === set.code) return { skipped: 'already saved today', day, set: set.code };
  const [ck, tcg] = await Promise.all([cardkingdom.editionCards(set.name), latestset.setTcgPrices(set.code).catch(() => new Map())]);
  const rows = ck
    .filter((c) => c.usd.NM != null)
    .map((c) => ({
      day,
      set_code: set.code,
      set_name: set.name,
      card_name: c.name,
      ck_nm_usd: c.usd.NM,
      ck_url: c.url,
      tcg_usd: tcg.get(c.name.toLowerCase()) ?? null,
    }));
  // PostgREST takes the batch in one request; ~300 rows per set.
  await db.upsertSetPrices(rows);
  lastSnapshot = { day, set: set.code };
  reportCache.map.clear();
  return { saved: rows.length, day, set: set.code };
}

/** Run the snapshot now and then hourly; each run only saves once per Singapore day. */
function scheduleSnapshots() {
  if (!db.enabled) return;
  const run = () => snapshotSetPrices().catch((err) => console.error(`[movers] snapshot failed: ${err.message}`));
  setTimeout(run, 30 * 1000).unref();
  setInterval(run, 60 * 60 * 1000).unref();
}

/** Does a store listing belong to this set's printing (not an older reprint)? */
function isSetPrinting(listing, set) {
  const code = String(listing.setCode || '').toUpperCase();
  if (code && code === set.code.toUpperCase()) return true;
  const want = normalizeName(set.name);
  const have = normalizeName(listing.set || '');
  return Boolean(have) && have.includes(want);
}

const CONDITION_FALLBACK = { NM: ['NM'], LP: ['LP', 'NM'], MP: ['MP', 'LP', 'NM'], HP: ['HP', 'MP', 'LP', 'NM'], DMG: ['HP', 'MP', 'LP', 'NM'] };

/** Card Kingdom's USD price for the listing's condition (closest available grade). */
function ckPriceFor(ck, condition) {
  for (const grade of CONDITION_FALLBACK[condition] || ['NM']) if (ck.usd[grade] != null) return { usd: ck.usd[grade], grade };
  return null;
}

/** Compare one card's Singapore listings with Card Kingdom. */
async function compareCard(card, set, ck, rate, getStorePrices) {
  const perStore = await mapLimit(stores.list, 4, async (store) => {
    try {
      const { payload } = await getStorePrices(store, card.name);
      const listings = payload.listings.filter((l) => l.inStock && isSetPrinting(l, set));
      return { store, listings, error: null };
    } catch (err) {
      return { store, listings: [], error: err.message };
    }
  });

  const stores_ = perStore.map(({ store, listings, error }) => {
    const cheapest = listings.reduce((m, l) => (m && m.price <= l.price ? m : l), null);
    return {
      id: store.id,
      name: store.name,
      error,
      inStock: listings.length,
      cheapest: cheapest && {
        price: cheapest.price,
        condition: cheapest.condition || '',
        finish: cheapest.finish,
        title: cheapest.title,
        url: cheapest.url,
      },
    };
  });

  const bargains = [];
  for (const { store, listings } of perStore) {
    for (const l of listings) {
      const ref = ckPriceFor(ck, l.condition || 'NM');
      if (!ref || !rate) continue;
      const ckSgd = Math.round(ref.usd * rate * 100) / 100;
      const ratio = l.price / ckSgd;
      if (ratio < BARGAIN_RATIO) {
        bargains.push({
          store: store.name,
          storeId: store.id,
          title: l.title,
          set: l.set,
          condition: l.condition || 'NM',
          finish: l.finish,
          price: l.price,
          stock: l.stock,
          url: l.url,
          ckGrade: ref.grade,
          ckUsd: ref.usd,
          ckSgd,
          pctOfCk: Math.round(ratio * 100),
        });
      }
    }
  }
  bargains.sort((a, b) => a.pctOfCk - b.pctOfCk);
  return { stores: stores_, bargains };
}

/** The full report: movers (or most valuable cards), Singapore comparison and under-50% listings. */
async function buildReport(getStorePrices) {
  const hit = reportCache.get('report');
  if (hit) return hit;

  const set = await latestset.newestSet();
  const [ckCards, fx, days] = await Promise.all([
    cardkingdom.editionCards(set.name),
    cardkingdom.usdToSgd(),
    db.setPriceDays(set.code).catch(() => null),
  ]);
  const rate = fx.rate;
  const ckByName = new Map(ckCards.map((c) => [c.name.toLowerCase(), c]));

  let movers = await db.setPriceMovers(set.code, MOVER_DAYS, TOP_N).catch(() => []);
  let mode = 'movers';
  let picks;
  if (movers && movers.length) {
    picks = movers.map((m) => ({ ckName: m.card_name, mover: m }));
  } else {
    // Not enough history yet: use the set's most valuable cards so the comparison still works.
    mode = 'valuable';
    picks = [...ckCards]
      .sort((a, b) => (b.usd.NM || 0) - (a.usd.NM || 0))
      .slice(0, TOP_N)
      .map((c) => ({ ckName: c.name, mover: null }));
  }

  // Scryfall gives each card's picture and the exact name the stores and autocomplete use.
  const ckRows = picks.map((p) => ckByName.get(p.ckName.toLowerCase()) || { name: p.ckName, scryfallId: null, usd: {}, qty: {} });
  const found = await latestset.scryfallCardsFor(ckRows, set.code).catch(() => []);

  const cards = await mapLimit(picks, 2, async (p, i) => {
    const ck = ckRows[i];
    const name = (found[i] && found[i].name) || p.ckName;
    const cmp = await compareCard({ name }, set, ck, rate, getStorePrices);
    const nm = ck.usd.NM ?? (p.mover && Number(p.mover.new_usd));
    return {
      name,
      image: found[i] ? latestset.imageOf(found[i]) : null,
      ckUrl: ck.url || (p.mover && p.mover.ck_url) || null,
      ckNmUsd: nm ?? null,
      ckNmSgd: nm != null && rate ? Math.round(nm * rate * 100) / 100 : null,
      mover: p.mover && {
        oldUsd: Number(p.mover.old_usd),
        newUsd: Number(p.mover.new_usd),
        changePct: Number(p.mover.change_pct),
        oldDay: p.mover.old_day,
        newDay: p.mover.new_day,
      },
      stores: cmp.stores,
      bargains: cmp.bargains,
    };
  });

  const report = {
    set,
    mode,
    moverDays: MOVER_DAYS,
    bargainRatio: BARGAIN_RATIO,
    history: days && days.days ? { firstDay: days.first_day, lastDay: days.last_day, days: Number(days.days) } : null,
    usdSgd: rate || null,
    cards,
    bargains: cards.flatMap((c) => c.bargains.map((b) => ({ card: c.name, ...b }))).sort((a, b) => a.pctOfCk - b.pctOfCk),
    generatedAt: new Date().toISOString(),
  };
  reportCache.set('report', report);
  return report;
}

module.exports = { snapshotSetPrices, scheduleSnapshots, buildReport, _isSetPrinting: isSetPrinting, _ckPriceFor: ckPriceFor };
