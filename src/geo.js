'use strict';

/**
 * Approximate visitor location from their IP address, using offline databases bundled with
 * the app. Visitors' addresses are never sent anywhere and never stored.
 *
 *   IPv4: city or district, region and country, from DB-IP Lite (CC BY 4.0, "IP geolocation
 *         by DB-IP"), ~63 MB, loaded on the first lookup.
 *   IPv6: country only, from geo-whois-asn-country (CC0), ~5 MB. DB-IP's IPv6 city database
 *         is ~71 MB and would push the app past the 512 MB of Render's free plan during the
 *         Card Kingdom refresh, so IPv6 visitors get their country but not their city.
 */

const net = require('net');
const maxmind = require('maxmind');

const DB = {
  4: '@ip-location-db/dbip-city-mmdb/dbip-city-ipv4.mmdb',
  6: '@ip-location-db/geo-whois-asn-country-mmdb/geo-whois-asn-country-ipv6.mmdb',
};
const enabled = process.env.SEARCH_LOCATION !== 'off';
const readers = {};
const cache = new Map(); // ip -> location, small and short-lived

function reader(version) {
  if (!readers[version]) {
    readers[version] = maxmind.open(require.resolve(DB[version]), { cache: { max: 2000 } }).catch((err) => {
      delete readers[version];
      throw err;
    });
  }
  return readers[version];
}

/**
 * The visitor's address. The site runs behind Cloudflare (then Render's proxy), so the
 * socket address is a proxy's; Cloudflare puts the visitor's address in CF-Connecting-IP.
 */
function clientIp(req) {
  const h = req.headers || {};
  const candidates = [h['cf-connecting-ip'], h['true-client-ip'], String(h['x-forwarded-for'] || '').split(',')[0], req.ip];
  for (const c of candidates) {
    const ip = String(c || '').trim().replace(/^::ffff:/, '');
    if (net.isIP(ip)) return ip;
  }
  return '';
}

function isPrivate(ip) {
  return (
    /^(10\.|127\.|192\.168\.|169\.254\.|0\.)/.test(ip) ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(ip) ||
    /^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./.test(ip) ||
    ip === '::1' ||
    /^f[cd]/i.test(ip) ||
    /^fe80:/i.test(ip)
  );
}

/** { city, region, country } for an IP address, or null when unknown. */
async function locate(ip) {
  if (!enabled || !ip || isPrivate(ip)) return null;
  if (cache.has(ip)) return cache.get(ip);
  const version = net.isIP(ip);
  if (!version) return null;
  let loc = null;
  try {
    const r = (await reader(version)).get(ip);
    if (r && r.country_code) {
      loc = { city: r.city || '', region: r.state1 || '', country: String(r.country_code).toUpperCase() };
    }
  } catch (err) {
    console.error(`[geo] ${err.message}`);
  }
  cache.set(ip, loc);
  if (cache.size > 5000) cache.delete(cache.keys().next().value);
  return loc;
}

/** Location of the visitor making this request (or null). */
function locateRequest(req) {
  return locate(clientIp(req));
}

module.exports = { enabled, clientIp, locate, locateRequest, _isPrivate: isPrivate };
