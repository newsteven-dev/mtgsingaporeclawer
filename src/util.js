'use strict';

const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';

const DEFAULT_TIMEOUT_MS = 20000;

/**
 * fetch() with a timeout and a browser-like User-Agent.
 * Throws on non-2xx responses.
 */
async function http(url, { method = 'GET', headers = {}, body, timeout = DEFAULT_TIMEOUT_MS } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  try {
    const res = await fetch(url, {
      method,
      body,
      headers: { 'User-Agent': USER_AGENT, 'Accept-Language': 'en-SG,en;q=0.9', ...headers },
      signal: controller.signal,
      redirect: 'follow',
    });
    if (!res.ok) {
      const err = new Error(`HTTP ${res.status} from ${new URL(url).host}`);
      err.status = res.status;
      throw err;
    }
    return res;
  } catch (err) {
    if (err.name === 'AbortError') throw new Error(`Timed out after ${timeout / 1000}s contacting ${new URL(url).host}`);
    if (err.message === 'fetch failed') {
      const cause = err.cause && (err.cause.code || err.cause.message);
      throw new Error(`Could not reach ${new URL(url).host}${cause ? ` (${cause})` : ''}`);
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

async function getText(url, opts) {
  return (await http(url, opts)).text();
}

async function getJson(url, opts = {}) {
  const res = await http(url, { ...opts, headers: { Accept: 'application/json', ...(opts.headers || {}) } });
  return res.json();
}

/** Lower-case, strip accents and punctuation so "Æther Vial" == "aether vial". */
function normalizeName(name) {
  return String(name || '')
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/æ/gi, 'ae')
    .replace(/[’‘`]/g, "'")
    .toLowerCase()
    .replace(/[^a-z0-9'/ ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Remove decorations shops add to card titles so we can compare against the
 * canonical Scryfall name, e.g.
 *   "Lightning Bolt FOIL [Secret Lair - 085]" -> "Lightning Bolt"
 *   "Lightning Bolt (Showcase)"              -> "Lightning Bolt"
 *   "Lightning Bolt - Foil"                  -> "Lightning Bolt"
 */
function baseCardName(title) {
  let t = String(title || '');
  // repeatedly drop trailing (...) and [...] groups
  let prev;
  do {
    prev = t;
    t = t.replace(/\s*[[(][^\])]*[\])]\s*$/, '');
  } while (t !== prev);
  t = t.replace(/\s+-\s+(foil|non-foil|etched|foil etched).*$/i, '');
  t = t.replace(/\s+(foil|etched foil|foil etched)$/i, '');
  return t.trim();
}

/**
 * Does the shop's title refer to exactly this card (not e.g. "Lightning Bolt Token"
 * or "Chain Lightning")? Handles split/DFC names ("A // B") where shops may list
 * only the front face.
 */
function titleMatchesCard(title, cardName) {
  const base = normalizeName(baseCardName(title));
  const want = normalizeName(cardName);
  if (!base || !want) return false;
  if (base === want) return true;
  if (want.includes('//')) {
    const faces = want.split('//').map((s) => s.trim());
    const compactWant = faces.join(' // ');
    if (base === compactWant || base.replace(/\s*\/\/?\s*/g, ' // ') === compactWant) return true;
    if (base === faces[0]) return true;
  }
  return false;
}

function toNumber(v) {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(String(v).replace(/[^0-9.\-]/g, ''));
  return Number.isFinite(n) ? n : null;
}

/** Map assorted condition labels to NM / LP / MP / HP / DMG. */
function normalizeCondition(c) {
  const s = String(c || '').toUpperCase();
  if (!s) return '';
  if (/NEAR MINT|\bNM\b|NM\/M|MINT/.test(s)) return 'NM';
  if (/LIGHT|\bLP\b|\bEX\b|EXCELLENT|SP\b|SLIGHT/.test(s)) return 'LP';
  if (/MODERATE|\bMP\b|PLAYED/.test(s) && !/HEAV/.test(s)) return 'MP';
  if (/HEAV|\bHP\b/.test(s)) return 'HP';
  if (/DAMAGE|\bDMG\b|\bD\b/.test(s)) return 'DMG';
  return s.trim();
}

/** Run async fn over items with limited concurrency. */
async function mapLimit(items, limit, fn) {
  const out = new Array(items.length);
  let i = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (i < items.length) {
      const idx = i++;
      out[idx] = await fn(items[idx], idx);
    }
  });
  await Promise.all(workers);
  return out;
}

/** Tiny in-memory TTL cache. */
class TtlCache {
  constructor(ttlMs) {
    this.ttlMs = ttlMs;
    this.map = new Map();
  }
  get(key) {
    const hit = this.map.get(key);
    if (!hit) return undefined;
    if (Date.now() > hit.expires) {
      this.map.delete(key);
      return undefined;
    }
    return hit.value;
  }
  set(key, value) {
    this.map.set(key, { value, expires: Date.now() + this.ttlMs });
    if (this.map.size > 500) this.map.delete(this.map.keys().next().value);
  }
}

module.exports = {
  http,
  getText,
  getJson,
  normalizeName,
  baseCardName,
  titleMatchesCard,
  toNumber,
  normalizeCondition,
  mapLimit,
  TtlCache,
};
