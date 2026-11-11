import { getClient, getSession, signOut } from './auth-client.js';

const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const money = (n) => (n == null ? '—' : `S$${Number(n).toFixed(2)}`);
const when = (t) =>
  new Date(t).toLocaleString('en-SG', { timeZone: 'Asia/Singapore', day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
const STORE_NAMES = {};
let regionNames = null;
try {
  regionNames = new Intl.DisplayNames(['en'], { type: 'region' });
} catch {
  /* older browsers: show the code */
}
const countryName = (code) => {
  if (!code) return '';
  try {
    return (regionNames && regionNames.of(code)) || code;
  } catch {
    return code;
  }
};
/** "Singapore (Geylang)", "Johor Bahru, Johor", ... with the country added when it isn't Singapore. */
const placeLabel = (city, region, country) => {
  const place = [city, region && region !== city ? region : ''].filter(Boolean).join(', ');
  if (!country) return '';
  if (country === 'SG') return place || 'Singapore';
  return [place, countryName(country)].filter(Boolean).join(', ');
};
const storeName = (id) => STORE_NAMES[id] || id;
const PAGE = 50;

let token = null;
let offset = 0;
let query = '';
let allCards = [];

async function api(path) {
  const res = await fetch(path, { headers: { Authorization: `Bearer ${token}` } });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(body.error || `HTTP ${res.status}`);
    err.status = res.status;
    err.user = body.user;
    throw err;
  }
  return body;
}

function setState(html) {
  $('#state').innerHTML = html;
  $('#state').hidden = !html;
}

async function boot() {
  const client = await getClient();
  if (!client) return setState('Sign-in is not set up on this server yet.');
  const session = await getSession();
  if (!session) return location.replace('/login.html');
  token = session.access_token;
  client.auth.onAuthStateChange((_e, s) => {
    if (s) token = s.access_token;
  });

  const meta = session.user.user_metadata || {};
  $('#login').textContent = meta.user_name || meta.preferred_username || session.user.email || '';
  if (meta.avatar_url) $('#avatar').src = meta.avatar_url;
  else $('#avatar').hidden = true;
  $('#who').hidden = false;

  try {
    const [stores] = await Promise.all([fetch('/api/stores').then((r) => r.json()), api('/api/admin/me')]);
    for (const s of stores) STORE_NAMES[s.id] = s.name;
  } catch (err) {
    if (err.status === 401) return signOut();
    return setState(`<strong>${esc(err.message)}</strong><br>Only the GitHub accounts set in <code>ADMIN_GITHUB_USERS</code> can view captured searches.`);
  }
  setState('');
  $('#content').hidden = false;
  load(true);
}

async function load(reset) {
  if (reset) offset = 0;
  try {
    const data = await api(`/api/admin/searches?limit=${PAGE}&offset=${offset}&q=${encodeURIComponent(query)}`);
    if (data.cards) {
      allCards = data.cards;
      renderStats();
      renderLocations(data.locations || []);
      if (!topData) loadTop();
      renderCards();
    }
    renderLog(data.searches, reset);
    $('#more').hidden = data.searches.length < PAGE;
    offset += data.searches.length;
  } catch (err) {
    setState(`Couldn't load searches: ${esc(err.message)}`);
  }
}

function renderStats() {
  const searches = allCards.reduce((n, c) => n + Number(c.searches || 0), 0);
  const last = allCards[0];
  $('#stats').innerHTML = `
    <div class="stat"><span class="stat-n">${allCards.length}</span><span class="muted">cards tracked</span></div>
    <div class="stat"><span class="stat-n">${searches}</span><span class="muted">searches captured</span></div>
    <div class="stat"><span class="stat-n">${last ? esc(last.card_name) : '—'}</span><span class="muted">${last ? `last searched ${when(last.last_searched)}` : 'no searches yet'}</span></div>`;
}

function renderLocations(rows) {
  $('#locations tbody').innerHTML = rows.length
    ? rows
        .map(
          (l) => `<tr>
        <td class="title">${esc(placeLabel(l.city, l.region, l.country) || countryName(l.country))}</td>
        <td>${esc(countryName(l.country))}</td>
        <td>${esc(l.searches)}</td>
        <td class="opt">${esc(l.cards)}</td>
        <td class="opt">${when(l.last_searched)}</td>
      </tr>`,
        )
        .join('')
    : `<tr><td colspan="5" class="muted">No searches with a location yet. New searches will show up here.</td></tr>`;
}

function renderCards() {
  const q = query.toLowerCase();
  const rows = allCards.filter((c) => !q || c.card_name.toLowerCase().includes(q));
  $('#cards tbody').innerHTML = rows.length
    ? rows
        .map(
          (c) => `<tr>
        <td class="title">${esc(c.card_name)}</td>
        <td>${esc(c.searches)}</td>
        <td class="opt">${when(c.first_searched)}</td>
        <td class="opt">${when(c.last_searched)}</td>
        <td class="price">${money(c.cheapest_last_24h)}</td>
        <td><a href="/?card=${encodeURIComponent(c.card_name)}">Search now ↗</a></td>
      </tr>`,
        )
        .join('')
    : `<tr><td colspan="6" class="muted">No cards captured yet. Search a card on the main page and it shows up here.</td></tr>`;
}

function renderLog(searches, reset) {
  const tbody = $('#log tbody');
  if (reset) tbody.innerHTML = '';
  if (reset && !searches.length) {
    tbody.innerHTML = `<tr><td colspan="7" class="muted">No searches match.</td></tr>`;
    $('#log-count').textContent = '';
    return;
  }
  for (const s of searches) {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td class="when">${when(s.searched_at)}</td>
      <td class="title">${esc(s.card_name)}</td>
      <td class="loc">${s.location_country ? esc(placeLabel(s.location_city, s.location_region, s.location_country)) : '<span class="muted">—</span>'}</td>
      <td class="opt">${esc(s.stores_checked)}</td>
      <td class="price">${money(s.cheapest)}<span class="set">${s.cheapest_store ? esc(storeName(s.cheapest_store)) : ''}</span></td>
      <td class="opt">${esc(s.in_stock_listings ?? 0)}</td>
      <td><button type="button" class="ghost details-btn" aria-expanded="false">Details</button></td>`;
    tr.querySelector('.details-btn').addEventListener('click', (e) => toggleDetails(e.currentTarget, tr, s));
    tbody.appendChild(tr);
  }
  $('#log-count').textContent = `(${tbody.querySelectorAll('tr:not(.detail-row)').length} shown)`;
}

async function toggleDetails(btn, tr, s) {
  const open = btn.getAttribute('aria-expanded') === 'true';
  const next = tr.nextElementSibling;
  if (open) {
    btn.setAttribute('aria-expanded', 'false');
    btn.textContent = 'Details';
    if (next && next.classList.contains('detail-row')) next.remove();
    return;
  }
  btn.setAttribute('aria-expanded', 'true');
  btn.textContent = 'Hide';
  const row = document.createElement('tr');
  row.className = 'detail-row';
  row.innerHTML = `<td colspan="7"><span class="muted">Loading…</span></td>`;
  tr.after(row);
  try {
    const { snapshots } = await api(`/api/admin/snapshots?ids=${(s.snapshot_ids || []).join(',')}`);
    row.firstElementChild.innerHTML = snapshots.map(renderSnapshot).join('') || '<span class="muted">No details stored.</span>';
  } catch (err) {
    row.firstElementChild.innerHTML = `<span class="muted">Couldn't load details: ${esc(err.message)}</span>`;
  }
}

function renderSnapshot(sn) {
  const listings = (sn.price_listings || []).slice().sort((a, b) => a.price - b.price);
  const top = listings.slice(0, 8);
  return `<div class="snap">
    <div class="snap-head">
      <strong>${esc(storeName(sn.store))}</strong>
      <span class="muted small">${esc(sn.in_stock_count)} in stock of ${esc(sn.listing_count)} listings ·
        cheapest ${money(sn.min_price)} · non-foil ${money(sn.min_price_nonfoil)} · foil ${money(sn.min_price_foil)}</span>
    </div>
    ${top.length ? `<ul class="snap-list">${top
      .map((l) => `<li><span class="price">${money(l.price)}</span> ${esc(l.title)} <span class="muted">${esc([l.set_name, l.condition, l.finish === 'foil' ? 'Foil' : ''].filter(Boolean).join(' · '))}${l.stock != null ? ` · ${esc(l.stock)} in stock` : ''}</span>${l.url ? ` <a href="${esc(l.url)}" target="_blank" rel="noopener">↗</a>` : ''}</li>`)
      .join('')}${listings.length > top.length ? `<li class="muted">+ ${listings.length - top.length} more</li>` : ''}</ul>` : ''}
  </div>`;
}

let qTimer;
$('#q').addEventListener('input', (e) => {
  clearTimeout(qTimer);
  qTimer = setTimeout(() => {
    query = e.target.value.trim();
    renderCards();
    load(true);
  }, 250);
});
$('#more').addEventListener('click', () => load(false));
$('#signout').addEventListener('click', signOut);

/* ---------------- Top searches (per day / per month) ---------------- */

let topPeriod = 'day';
let topData = null;

const periodLabel = (period, d) =>
  new Date(`${d}T00:00:00`).toLocaleDateString('en-SG', period === 'month' ? { month: 'long', year: 'numeric' } : { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });

async function loadTop(start) {
  try {
    const q = new URLSearchParams({ period: topPeriod });
    if (start) q.set('start', start);
    topData = await api(`/api/admin/top?${q}`);
    renderTop();
  } catch (err) {
    $('#top-chart').innerHTML = `<p class="muted">Couldn't load top searches: ${esc(err.message)}</p>`;
  }
}

function renderTop() {
  const d = topData;
  const sel = $('#top-start');
  sel.innerHTML = d.periods
    .map((p) => `<option value="${esc(p.period)}" ${p.period === d.start ? 'selected' : ''}>${esc(periodLabel(d.period, p.period))} · ${esc(p.searches)} searches</option>`)
    .join('');
  sel.hidden = !d.periods.length;
  const current = d.periods.find((p) => p.period === d.start);
  $('#top-sub').textContent = current
    ? `${current.searches} searches of ${current.cards} cards in ${periodLabel(d.period, d.start)}`
    : '';

  const showTable = $('#top-view').getAttribute('aria-pressed') === 'true';
  $('#top-chart').hidden = showTable;
  $('#top-table').hidden = !showTable;
  $('#top-note').textContent = d.cards.length
    ? `Top ${d.cards.length} by number of searches${d.cards.length === 20 ? ' (top 20 shown)' : ''}. A search is one look-up of a card across the stores. Times are Singapore time.`
    : '';

  if (!d.cards.length) {
    $('#top-chart').innerHTML = '<p class="muted">No searches in this period yet.</p>';
    $('#top-table').innerHTML = '';
    return;
  }

  const max = Math.max(...d.cards.map((c) => Number(c.searches)));
  $('#top-chart').innerHTML = d.cards
    .map(
      (c, i) => `<a class="bar-row" role="listitem" data-i="${i}" href="/?card=${encodeURIComponent(c.card_name)}"
        aria-label="${esc(c.card_name)}: ${esc(c.searches)} searches">
        <span class="bar-rank">${i + 1}</span>
        <span class="bar-name">${esc(c.card_name)}</span>
        <span class="bar-track"><span class="bar-fill" style="width:${Math.max(2, (Number(c.searches) / max) * 100)}%"></span></span>
        <span class="bar-value">${esc(c.searches)}</span>
      </a>`,
    )
    .join('');

  $('#top-table').innerHTML = `<table><thead><tr><th>#</th><th>Card</th><th>Searches</th><th>Last searched</th><th>Cheapest seen</th><th></th></tr></thead><tbody>${d.cards
    .map(
      (c, i) => `<tr><td>${i + 1}</td><td class="title">${esc(c.card_name)}</td><td>${esc(c.searches)}</td>
        <td>${when(c.last_searched)}</td><td class="price">${money(c.cheapest)}</td>
        <td><a href="/?card=${encodeURIComponent(c.card_name)}">Search now ↗</a></td></tr>`,
    )
    .join('')}</tbody></table>`;
}

// Hover tooltip for the bars (the whole row is the hit target).
const topChart = $('#top-chart');
const tip = $('#top-tip');
function showTip(row, x, y) {
  const c = topData && topData.cards[Number(row.dataset.i)];
  if (!c) return;
  tip.innerHTML = `<b>${esc(c.card_name)}</b>
    <div><span>Searches</span><em>${esc(c.searches)}</em></div>
    <div><span>Last searched</span><em>${when(c.last_searched)}</em></div>
    <div><span>Cheapest seen</span><em>${money(c.cheapest)}</em></div>`;
  tip.hidden = false;
  const card = topChart.parentElement.getBoundingClientRect();
  tip.style.left = `${Math.min(x - card.left + 14, card.width - tip.offsetWidth - 8)}px`;
  tip.style.top = `${y - card.top + 14}px`;
}
topChart.addEventListener('pointermove', (e) => {
  const row = e.target.closest('.bar-row');
  if (row) showTip(row, e.clientX, e.clientY);
  else tip.hidden = true;
});
topChart.addEventListener('pointerleave', () => (tip.hidden = true));
topChart.addEventListener('focusin', (e) => {
  const row = e.target.closest('.bar-row');
  if (!row) return;
  const r = row.getBoundingClientRect();
  showTip(row, r.left + r.width / 2, r.bottom - 6);
});
topChart.addEventListener('focusout', () => (tip.hidden = true));

document.querySelectorAll('.seg-btn').forEach((b) =>
  b.addEventListener('click', () => {
    topPeriod = b.dataset.period;
    document.querySelectorAll('.seg-btn').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
    loadTop();
  }),
);
$('#top-start').addEventListener('change', (e) => loadTop(e.target.value));
$('#top-view').addEventListener('click', (e) => {
  const on = e.currentTarget.getAttribute('aria-pressed') !== 'true';
  e.currentTarget.setAttribute('aria-pressed', String(on));
  e.currentTarget.textContent = on ? 'Show chart' : 'Show table';
  if (topData) renderTop();
});

boot();
