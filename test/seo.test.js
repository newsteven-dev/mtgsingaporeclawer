'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const seo = require('../src/seo');

test('main page metadata: title, description, canonical, link previews and structured data', () => {
  const html = seo.renderIndex(undefined);
  assert.ok(!html.includes('<!--SEO-->'), 'placeholder is replaced');
  assert.match(html, /<title>MTG SG Price Compare: Magic: The Gathering singles prices in Singapore<\/title>/);
  assert.match(html, /<meta name="description" content="Compare Magic: The Gathering singles prices[^"]+Games Haven/);
  assert.match(html, new RegExp(`<link rel="canonical" href="${seo.SITE_URL}/" />`));
  assert.match(html, /<meta property="og:image" content="https:\/\/[^"]+\/og-image\.png" \/>/);
  assert.match(html, /<meta name="twitter:card" content="summary_large_image" \/>/);
  const ld = JSON.parse(html.match(/<script type="application\/ld\+json">(.+?)<\/script>/)[1]);
  assert.equal(ld['@type'], 'WebSite');
  assert.equal(ld.potentialAction.target.urlTemplate, `${seo.SITE_URL}/?card={search_term_string}`);
  assert.equal(html.match(/<title>/g).length, 1, 'exactly one <title>');
});

test('card pages get their own title, description and canonical URL', () => {
  const html = seo.renderIndex('Lightning Bolt');
  assert.match(html, /<title>Lightning Bolt price in Singapore: compare 7 stores \| MTG SG Price Compare<\/title>/);
  assert.match(html, /<meta name="description" content="Compare Lightning Bolt prices and stock across 7 Singapore stores/);
  assert.match(html, new RegExp(`<link rel="canonical" href="${seo.SITE_URL}/\\?card=Lightning%20Bolt" />`));
});

test('a card name with HTML in it cannot break the page', () => {
  const evil = '</title><script>alert(1)</script>"><img src=x onerror=alert(1)>';
  const html = seo.renderIndex(evil);
  assert.ok(!html.includes('<script>alert(1)'), 'no injected script tag');
  assert.ok(!html.includes('<img src=x'), 'no injected element');
  assert.ok(!/<\/title><script>/.test(html));
  const ld = html.match(/<script type="application\/ld\+json">(.+?)<\/script>/)[1];
  assert.ok(!ld.includes('</'), 'structured data never contains "</"');
  assert.equal(seo._cleanCardName('x'.repeat(500)), '', 'overlong names are ignored');
  assert.equal(seo._cleanCardName(['Sol Ring', 'other']), 'Sol Ring');
});

test('robots.txt keeps private pages out but lets Google render card pages', () => {
  const r = seo.robotsTxt();
  assert.match(r, /Disallow: \/searches\.html/);
  assert.match(r, /Disallow: \/login\.html/);
  assert.match(r, /Disallow: \/api\/admin\//);
  assert.ok(!/Disallow: \/api\/\s*$/m.test(r), 'public API stays crawlable for rendering');
  assert.match(r, new RegExp(`Sitemap: ${seo.SITE_URL}/sitemap.xml`));
});

test('sitemap lists the main page and unique card pages', () => {
  const xml = seo.sitemapXml(['Lightning Bolt', 'lightning bolt', 'Mjölnir, Hammer of Thor', 'Emeritus of Woe // Demonic Tutor'], '2026-11-11');
  assert.equal((xml.match(/<url>/g) || []).length, 4, 'home + 3 unique cards');
  assert.ok(xml.includes(`<loc>${seo.SITE_URL}/</loc>`));
  assert.ok(xml.includes('?card=Mj%C3%B6lnir%2C%20Hammer%20of%20Thor'));
  assert.ok(xml.includes('<lastmod>2026-11-11</lastmod>'));
});

test('search engines and link-preview bots are recognised, people are not', () => {
  const ua = (s) => ({ headers: { 'user-agent': s } });
  assert.ok(seo.isBot(ua('Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)')));
  assert.ok(seo.isBot(ua('Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; bingbot/2.0)')));
  assert.ok(seo.isBot(ua('WhatsApp/2.23.20.0 A')));
  assert.ok(!seo.isBot(ua('Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Mobile/15E148 Safari/604.1')));
  assert.ok(!seo.isBot(ua('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/131.0 Safari/537.36')));
});
