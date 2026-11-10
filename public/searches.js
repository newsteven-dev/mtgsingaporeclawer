import { getClient, getSession, signOut } from './auth-client.js';

const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const money = (n) => (n == null ? '—' : `S$${Number(n).toFixed(2)}`);
const when = (t) =>
  new Date(t).toLocaleString('en-SG', { timeZone: 'Asia/Singapore', day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
const STORE_NAMES = {};
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
    tbody.innerHTML = `<tr><td colspan="6" class="muted">No searches match.</td></tr>`;
    $('#log-count').textContent = '';
    return;
  }
  for (const s of searches) {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td class="when">${when(s.searched_at)}</td>
      <td class="title">${esc(s.card_name)}</td>
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
  row.innerHTML = `<td colspan="6"><span class="muted">Loading…</span></td>`;
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

boot();
