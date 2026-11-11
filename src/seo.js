'use strict';

/**
 * Search-engine metadata, served by the server so crawlers see it without running scripts:
 *  - the main page's <head>: title, description, canonical URL, Open Graph / Twitter tags,
 *    structured data (WebSite + SearchAction), and optional Google Search Console verification;
 *    card links (/?card=Lightning%20Bolt) get their own title, description and canonical URL
 *  - /robots.txt and /sitemap.xml
 *  - isBot(): crawler requests aren't saved as searches in the captured searches report
 */

const fs = require('fs');
const path = require('path');

const SITE_URL = (process.env.SITE_URL || 'https://mtg-sg-price-compare.onrender.com').replace(/\/+$/, '');
const SITE_NAME = 'MTG SG Price Compare';
const STORE_NAMES = 'Agora Hobby, MTG Asia, Mox & Lotus, The TCG Marketplace, Grey Ogre Games, Flagship Games and Games Haven';
const INDEX_FILE = path.join(__dirname, '..', 'public', 'index.html');
const PLACEHOLDER = '<!--SEO-->';

let template = null;

const esc = (s) =>
  String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/** A card name from the query string, made safe: trimmed, single-spaced, no control characters, capped. */
function cleanCardName(v) {
  const s = String(Array.isArray(v) ? v[0] : v || '')
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return s.length > 0 && s.length <= 120 ? s : '';
}

const pageUrl = (card) => (card ? `${SITE_URL}/?card=${encodeURIComponent(card)}` : `${SITE_URL}/`);

/** Title, description and canonical URL for the main page or a card page. */
function pageMeta(card) {
  if (card) {
    return {
      title: `${card} price in Singapore: compare 7 stores | ${SITE_NAME}`,
      description: `Compare ${card} prices and stock across 7 Singapore stores (${STORE_NAMES}), with Card Kingdom prices for every version.`,
      url: pageUrl(card),
    };
  }
  return {
    title: `${SITE_NAME}: Magic: The Gathering singles prices in Singapore`,
    description: `Compare Magic: The Gathering singles prices and stock across 7 Singapore stores: ${STORE_NAMES}. With Card Kingdom prices and the top cards of the newest sets.`,
    url: pageUrl(''),
  };
}

/** The <head> tags that replace <!--SEO--> in index.html. */
function headTags(card) {
  const m = pageMeta(card);
  const image = `${SITE_URL}/og-image.png`;
  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'WebSite',
    name: SITE_NAME,
    url: `${SITE_URL}/`,
    description: pageMeta('').description,
    inLanguage: 'en-SG',
    potentialAction: {
      '@type': 'SearchAction',
      target: { '@type': 'EntryPoint', urlTemplate: `${SITE_URL}/?card={search_term_string}` },
      'query-input': 'required name=search_term_string',
    },
  };
  const verification = String(process.env.GOOGLE_SITE_VERIFICATION || '').trim();
  return [
    `<title>${esc(m.title)}</title>`,
    `<meta name="description" content="${esc(m.description)}" />`,
    `<link rel="canonical" href="${esc(m.url)}" />`,
    `<meta name="robots" content="index, follow, max-image-preview:large" />`,
    `<meta property="og:type" content="website" />`,
    `<meta property="og:site_name" content="${esc(SITE_NAME)}" />`,
    `<meta property="og:locale" content="en_SG" />`,
    `<meta property="og:title" content="${esc(m.title)}" />`,
    `<meta property="og:description" content="${esc(m.description)}" />`,
    `<meta property="og:url" content="${esc(m.url)}" />`,
    `<meta property="og:image" content="${esc(image)}" />`,
    `<meta property="og:image:width" content="1200" />`,
    `<meta property="og:image:height" content="630" />`,
    `<meta property="og:image:alt" content="${esc(SITE_NAME)}: compare Magic singles prices across 7 Singapore stores" />`,
    `<meta name="twitter:card" content="summary_large_image" />`,
    `<meta name="twitter:title" content="${esc(m.title)}" />`,
    `<meta name="twitter:description" content="${esc(m.description)}" />`,
    `<meta name="twitter:image" content="${esc(image)}" />`,
    verification ? `<meta name="google-site-verification" content="${esc(verification)}" />` : '',
    // JSON inside <script>: escape "<" so a card name can never close the tag.
    `<script type="application/ld+json">${JSON.stringify(jsonLd).replace(/</g, '\\u003c')}</script>`,
  ]
    .filter(Boolean)
    .join('\n  ');
}

/** The main page with its metadata filled in. */
function renderIndex(cardParam) {
  if (!template || process.env.NODE_ENV === 'development') template = fs.readFileSync(INDEX_FILE, 'utf8');
  return template.replace(PLACEHOLDER, headTags(cleanCardName(cardParam)));
}

function robotsTxt() {
  return [
    'User-agent: *',
    'Allow: /',
    // Signed-in pages and their data stay out of search results. The public /api/ endpoints
    // stay crawlable: Google needs them to render a card page's prices.
    'Disallow: /login.html',
    'Disallow: /searches.html',
    'Disallow: /api/admin/',
    '',
    `Sitemap: ${SITE_URL}/sitemap.xml`,
    '',
  ].join('\n');
}

/** The main page plus card pages for the newest sets' top cards. */
function sitemapXml(cardNames = [], lastmod = new Date().toISOString().slice(0, 10)) {
  const seen = new Set();
  const urls = [{ loc: pageUrl(''), priority: '1.0', changefreq: 'daily' }];
  for (const name of cardNames) {
    const card = cleanCardName(name);
    if (!card || seen.has(card.toLowerCase())) continue;
    seen.add(card.toLowerCase());
    urls.push({ loc: pageUrl(card), priority: '0.6', changefreq: 'daily' });
  }
  const xmlEsc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls
  .map((u) => `  <url><loc>${xmlEsc(u.loc)}</loc><lastmod>${lastmod}</lastmod><changefreq>${u.changefreq}</changefreq><priority>${u.priority}</priority></url>`)
  .join('\n')}
</urlset>
`;
}

/** Search engines and link-preview bots (their requests aren't saved as searches). */
function isBot(req) {
  const ua = String((req.headers && req.headers['user-agent']) || '');
  return /bot|crawl|spider|slurp|bingpreview|facebookexternalhit|whatsapp|telegram|discord|embedly|preview|lighthouse|headless/i.test(ua);
}

module.exports = { SITE_URL, renderIndex, robotsTxt, sitemapXml, isBot, _cleanCardName: cleanCardName, _headTags: headTags };
