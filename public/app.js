(() => {
  'use strict';

  const $ = (sel) => document.querySelector(sel);
  const input = $('#q');
  const list = $('#suggestions');
  const combo = $('#combo');
  const form = $('#search-form');

  let stores = [];
  let results = {}; // storeId -> { status: 'loading'|'ok'|'error', data }
  let currentCard = null;
  let suggestions = [];
  let activeIndex = -1;
  let acController = null;
  let acTimer = null;
  let searchToken = 0;
  const PAGE_SIZE = 20; // rows shown at first, and added by each "Show next 20"
  let tableLimit = PAGE_SIZE;

  const money = (n) => (n == null ? '—' : `S$${Number(n).toFixed(2)}`);
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  /* ---------------- Autocomplete ---------------- */

  function highlight(name, q) {
    const i = name.toLowerCase().indexOf(q.toLowerCase());
    if (i < 0 || !q) return esc(name);
    return esc(name.slice(0, i)) + '<mark>' + esc(name.slice(i, i + q.length)) + '</mark>' + esc(name.slice(i + q.length));
  }

  function renderSuggestions(q) {
    if (!suggestions.length) return closeSuggestions();
    list.innerHTML = suggestions
      .map((name, i) => `<li role="option" id="opt-${i}" data-i="${i}" aria-selected="${i === activeIndex}">${highlight(name, q)}</li>`)
      .join('');
    list.hidden = false;
    combo.setAttribute('aria-expanded', 'true');
    input.setAttribute('aria-activedescendant', activeIndex >= 0 ? `opt-${activeIndex}` : '');
  }

  function closeSuggestions() {
    list.hidden = true;
    combo.setAttribute('aria-expanded', 'false');
    input.removeAttribute('aria-activedescendant');
    activeIndex = -1;
  }

  async function fetchSuggestions(q) {
    if (acController) acController.abort();
    acController = new AbortController();
    try {
      const res = await fetch(`/api/autocomplete?q=${encodeURIComponent(q)}`, { signal: acController.signal });
      const json = await res.json();
      if (input.value.trim() !== q) return;
      suggestions = json.data || [];
      activeIndex = -1;
      renderSuggestions(q);
    } catch (err) {
      if (err.name !== 'AbortError') console.warn('autocomplete failed', err);
    }
  }

  input.addEventListener('input', () => {
    const q = input.value.trim();
    clearTimeout(acTimer);
    if (q.length < 2) {
      suggestions = [];
      return closeSuggestions();
    }
    acTimer = setTimeout(() => fetchSuggestions(q), 150);
  });

  input.addEventListener('keydown', (e) => {
    if (list.hidden) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      activeIndex = (activeIndex + 1) % suggestions.length;
      renderSuggestions(input.value.trim());
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      activeIndex = (activeIndex - 1 + suggestions.length) % suggestions.length;
      renderSuggestions(input.value.trim());
    } else if (e.key === 'Tab' && suggestions.length) {
      e.preventDefault();
      input.value = suggestions[Math.max(activeIndex, 0)];
      closeSuggestions();
    } else if (e.key === 'Escape') {
      closeSuggestions();
    }
  });

  list.addEventListener('mousedown', (e) => {
    const li = e.target.closest('li');
    if (!li) return;
    e.preventDefault();
    choose(suggestions[Number(li.dataset.i)]);
  });

  input.addEventListener('blur', () => setTimeout(closeSuggestions, 100));

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    if (!list.hidden && activeIndex >= 0) return choose(suggestions[activeIndex]);
    const q = input.value.trim();
    if (!q) return;
    // Prefer an exact suggestion, else the first suggestion, else what was typed.
    const exact = suggestions.find((s) => s.toLowerCase() === q.toLowerCase());
    choose(exact || suggestions[0] || q);
  });

  function choose(name) {
    input.value = name;
    closeSuggestions();
    compare(name);
  }

  /* ---------------- Price comparison ---------------- */

  async function compare(name, { refresh = false } = {}) {
    const token = ++searchToken;
    const url = new URL(location.href);
    url.searchParams.set('card', name);
    history.replaceState(null, '', url);

    $('#main').hidden = false;
    results = Object.fromEntries(stores.map((s) => [s.id, { status: 'loading' }]));
    tableLimit = PAGE_SIZE;
    render();

    // Card info from Scryfall (canonical name, image).
    fetch(`/api/card?name=${encodeURIComponent(name)}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((card) => {
        if (token !== searchToken) return;
        currentCard = card || { name };
        renderCard();
      });

    loadCardKingdom(name, token);

    // Query every store in parallel; each tile fills in as its store answers.
    await Promise.all(
      stores.map(async (s) => {
        try {
          const res = await fetch(`/api/prices?store=${s.id}&name=${encodeURIComponent(name)}${refresh ? '&refresh=1' : ''}`);
          const data = await res.json();
          if (token !== searchToken) return;
          results[s.id] = { status: data.error ? 'error' : 'ok', data };
        } catch (err) {
          if (token !== searchToken) return;
          results[s.id] = { status: 'error', data: { error: err.message, listings: [] } };
        }
        render();
      }),
    );
    if (token !== searchToken) return;
    loadHistory(name, token);
    loadTrending();
  }

  /* ---------------- Card Kingdom retail prices ---------------- */

  let ck = null; // { status, data }
  let ckLimit = PAGE_SIZE;
  const usd = (n) => (n == null ? '—' : `US$${Number(n).toFixed(2)}`);

  async function loadCardKingdom(name, token) {
    ck = { status: 'loading' };
    ckLimit = PAGE_SIZE;
    renderCk();
    try {
      const res = await fetch(`/api/cardkingdom?name=${encodeURIComponent(name)}`);
      const data = await res.json();
      if (token !== searchToken) return;
      ck = { status: data.error ? 'error' : 'ok', data };
    } catch (err) {
      if (token !== searchToken) return;
      ck = { status: 'error', data: { error: err.message, versions: [] } };
    }
    renderCk();
  }

  function cheapestLocal() {
    let best = null;
    for (const s of stores) {
      const r = results[s.id];
      if (r?.status !== 'ok') continue;
      for (const l of r.data.listings) if (l.inStock && (!best || l.price < best.price)) best = { ...l, storeName: s.name };
    }
    return best;
  }

  const setKey = (s) => String(s || '').toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, ' ').replace(/\b(edition|core set|the)\b/g, '').replace(/\s+/g, ' ').trim();

  /** Card Kingdom's entry for the same set and finish as a shop listing, if the set names line up. */
  function sameVersion(listing, versions) {
    const want = setKey(listing.set);
    if (!want) return null;
    const candidates = versions.filter((v) => v.finish === listing.finish && setKey(v.edition) === want);
    // Prefer the plain printing over special variations (borderless, showcase, ...).
    return candidates.find((v) => !v.variation) || candidates[0] || null;
  }

  const priceOf = (c) => (c.sgd != null ? money(c.sgd) : usd(c.usd));
  const pct = (a, b) => Math.round(((a - b) / b) * 100);

  function condCell(v, grade) {
    const c = v.conditions.find((x) => x.grade === grade);
    if (!c) return '<td class="opt muted">—</td>';
    return `<td class="opt ${c.qty ? '' : 'muted'}">${priceOf(c)}<span class="usd">${c.qty ? `${esc(c.qty)} in stock` : 'sold out'}</span></td>`;
  }

  function renderCk() {
    const section = $('#ck');
    if (!ck) return (section.hidden = true);
    section.hidden = false;
    const tbody = $('#ck-table tbody');
    const headline = $('#ck-headline');
    const more = $('#ck-more');
    if (ck.status === 'loading') {
      headline.innerHTML = '<span class="muted">Loading Card Kingdom prices…</span>';
      tbody.innerHTML = '';
      more.hidden = true;
      return;
    }
    if (ck.status === 'error') {
      headline.innerHTML = `<span class="muted">Couldn't load Card Kingdom prices: ${esc(ck.data.error)}</span>`;
      tbody.innerHTML = '';
      more.hidden = true;
      return;
    }

    const d = ck.data;
    const onlyStock = $('#ck-instock').checked;
    const finish = $('#ck-finish').value;
    const rows = d.versions.filter((v) => (!onlyStock || v.inStock) && (!finish || v.finish === finish));
    const shown = rows.slice(0, ckLimit);

    // Cheapest copy Card Kingdom actually has in stock (any version, any condition).
    const best = d.versions.filter((v) => v.cheapest).reduce((m, v) => (m && m.cheapest.usd <= v.cheapest.usd ? m : v), null);
    const local = cheapestLocal();
    if (!d.versions.length) {
      headline.innerHTML = `Card Kingdom doesn't list this card. <a href="${esc(d.searchUrl)}" target="_blank" rel="noopener">Search Card Kingdom ↗</a>`;
    } else if (!best) {
      headline.innerHTML = `Card Kingdom is sold out of every version of this card right now.`;
    } else {
      const version = [best.edition, best.variation].filter(Boolean).join(' · ');
      let out = `Card Kingdom's cheapest copy is <strong>${priceOf(best.cheapest)}</strong> (${usd(best.cheapest.usd)})
        for <strong>${esc(version)}</strong>${best.finish === 'foil' ? ' (foil)' : ''}, ${esc(best.cheapest.grade)}.`;
      if (local && best.cheapest.sgd != null) {
        const diff = pct(local.price, best.cheapest.sgd);
        out += ` The cheapest copy in Singapore is <strong>${money(local.price)}</strong> at ${esc(local.storeName)}
          (${diff === 0 ? 'the same price' : `${Math.abs(diff)}% ${diff < 0 ? 'cheaper' : 'dearer'}`}, before shipping).`;
      }
      const same = local && sameVersion(local, d.versions);
      const sameCond = same && (same.conditions.find((c) => c.equivalent === (local.condition || 'NM')) || same.conditions[0]);
      if (sameCond) {
        out += `<br>Same printing (${esc(local.set)}${local.finish === 'foil' ? ', foil' : ''}, ${esc(local.condition || 'NM')}):
          ${esc(local.storeName)} <strong>${money(local.price)}</strong> vs Card Kingdom <strong>${priceOf(sameCond)}</strong>${sameCond.qty ? '' : ' (sold out at Card Kingdom)'}.`;
      }
      headline.innerHTML = out;
    }

    tbody.innerHTML = shown.length
      ? shown
          .map(
            (v) => `<tr class="${v.inStock ? '' : 'oos'}">
          <td class="title">${esc(v.edition)}${v.variation ? `<span class="set">${esc(v.variation)}</span>` : ''}</td>
          <td>${v.finish === 'foil' ? '<span class="foil">Foil</span>' : 'Non-foil'}</td>
          <td class="price">${v.cheapest ? `${priceOf(v.cheapest)}<span class="usd">${esc(v.cheapest.grade)} · ${usd(v.cheapest.usd)}</span>` : 'Sold out'}</td>
          ${['NM', 'EX', 'VG', 'G'].map((g) => condCell(v, g)).join('')}
          <td>${v.url ? `<a href="${esc(v.url)}" target="_blank" rel="noopener">View ↗</a>` : ''}</td>
        </tr>`,
          )
          .join('')
      : `<tr><td colspan="8" class="muted">No versions match.</td></tr>`;

    const ckRemaining = rows.length - shown.length;
    more.hidden = ckRemaining <= 0;
    more.textContent = `Show next ${Math.min(PAGE_SIZE, ckRemaining)}`;
    $('#ck-shown').textContent = rows.length > PAGE_SIZE ? `Showing ${shown.length} of ${rows.length} versions` : '';

    const rate = d.usdSgd ? `Converted at US$1 = S$${Number(d.usdSgd).toFixed(4)}${d.usdSgdDate && d.usdSgdDate !== 'fixed' ? ` (${d.usdSgdDate})` : ''}. ` : '';
    $('#ck-note').innerHTML = `Card Kingdom grades cards NM, EX, VG and G, roughly the same as NM, LP, MP and HP at the Singapore stores.
      Prices don't include shipping from the US. ${rate}
      ${d.priceListDate ? `Card Kingdom price list from ${esc(d.priceListDate)} (US Eastern). ` : ''}
      <a href="${esc(d.searchUrl)}" target="_blank" rel="noopener">Search Card Kingdom ↗</a>`;
  }

  ['#ck-instock', '#ck-finish'].forEach((sel) =>
    $(sel).addEventListener('change', () => {
      ckLimit = PAGE_SIZE;
      renderCk();
    }),
  );
  $('#ck-more').addEventListener('click', () => {
    ckLimit += PAGE_SIZE;
    renderCk();
  });

  /* ---------------- Price history (Supabase) ---------------- */

  let historyRows = [];
  let historyName = '';
  const SVG_NS = 'http://www.w3.org/2000/svg';
  const sgToday = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Singapore' }).format(new Date());
  const fmtDay = (d) => new Date(`${d}T00:00:00`).toLocaleDateString('en-SG', { day: 'numeric', month: 'short' });

  /** Authorization header for signed-in-only data, or null when signed out. */
  async function authHeaders() {
    const auth = await window.mtgAuthReady;
    const t = auth && (await auth.token());
    return t ? { Authorization: `Bearer ${t}` } : null;
  }

  async function loadHistory(name, token) {
    try {
      const headers = await authHeaders();
      if (token !== searchToken) return;
      // Past searches are only shown to signed-in users.
      if (!headers) return ($('#history').hidden = true);
      const res = await fetch(`/api/history?name=${encodeURIComponent(name)}&days=90`, { headers });
      if (!res.ok) return ($('#history').hidden = true);
      const json = await res.json();
      if (token !== searchToken) return;
      if (!json.enabled) return ($('#history').hidden = true);
      historyRows = json.days || [];
      historyName = name;
      $('#history').hidden = false;
      renderHistory();
    } catch (err) {
      console.warn('history failed', err);
    }
  }

  /** Merge stored daily rows with what we just fetched, so today's point is always current. */
  function historySeries(field) {
    const finish = { min_price: null, min_price_nonfoil: 'nonfoil', min_price_foil: 'foil' }[field];
    const byStore = Object.fromEntries(stores.map((s) => [s.id, new Map()]));
    for (const r of historyRows) {
      const v = r[field] == null ? null : Number(r[field]);
      if (v != null && byStore[r.store]) byStore[r.store].set(r.day, v);
    }
    const today = sgToday();
    for (const s of stores) {
      const r = results[s.id];
      if (r?.status !== 'ok') continue;
      const live = r.data.listings.filter((l) => l.inStock && (!finish || l.finish === finish)).map((l) => l.price);
      if (!live.length) continue;
      const m = byStore[s.id];
      m.set(today, Math.min(m.get(today) ?? Infinity, ...live));
    }
    return stores
      .map((s) => ({ id: s.id, name: s.name, points: [...byStore[s.id]].map(([day, v]) => ({ day, v })).sort((a, b) => a.day.localeCompare(b.day)) }))
      .filter((s) => s.points.length);
  }

  function renderHistory() {
    const field = $('#h-finish').value;
    const series = historySeries(field);
    const color = (id) => `var(--series-${id})`;
    const days = [...new Set(series.flatMap((s) => s.points.map((p) => p.day)))].sort();
    const chartEl = $('#h-chart');
    const tableEl = $('#h-table');
    const showTable = $('#h-view').getAttribute('aria-pressed') === 'true';

    $('#h-legend').innerHTML = series.map((s) => `<li><i style="background:${color(s.id)}"></i>${esc(s.name)}</li>`).join('');
    $('#h-note').textContent = days.length <= 1
      ? 'Tracking started today. Each search adds a data point, so the trend builds up as this card is searched on more days.'
      : `${days.length} days of data since ${fmtDay(days[0])}.`;

    // Table view (also the accessible alternative to the chart).
    tableEl.hidden = !showTable;
    chartEl.hidden = showTable;
    $('#h-legend').hidden = showTable;
    if (showTable) {
      const lookup = Object.fromEntries(series.map((s) => [s.id, Object.fromEntries(s.points.map((p) => [p.day, p.v]))]));
      tableEl.innerHTML = `<table><thead><tr><th>Day</th>${series.map((s) => `<th>${esc(s.name)}</th>`).join('')}</tr></thead><tbody>${days
        .slice()
        .reverse()
        .map((d) => `<tr><td>${fmtDay(d)}</td>${series.map((s) => `<td>${lookup[s.id][d] != null ? money(lookup[s.id][d]) : '—'}</td>`).join('')}</tr>`)
        .join('')}</tbody></table>`;
      return;
    }

    chartEl.innerHTML = '';
    if (!series.length) {
      chartEl.innerHTML = '<p class="muted small">No in-stock prices to chart yet.</p>';
      return;
    }

    const W = 760, H = 260, m = { t: 10, r: 16, b: 26, l: 56 };
    const values = series.flatMap((s) => s.points.map((p) => p.v));
    let lo = Math.min(...values), hi = Math.max(...values);
    if (lo === hi) { lo *= 0.9; hi *= 1.1; }
    // "Nice" tick step (1, 2, 2.5 or 5 x 10^n) so labels are evenly spaced and never repeat.
    const raw = (hi - lo) / 4;
    const mag = 10 ** Math.floor(Math.log10(raw));
    const step = [1, 2, 2.5, 5, 10].map((f) => f * mag).find((s) => s >= raw);
    lo = Math.max(0, Math.floor(lo / step) * step);
    hi = Math.ceil(hi / step) * step;
    const decimals = Number.isInteger(step) ? 0 : Number.isInteger(step * 10) ? 1 : 2;
    const x = (d) => (days.length === 1 ? m.l + (W - m.l - m.r) / 2 : m.l + (days.indexOf(d) / (days.length - 1)) * (W - m.l - m.r));
    const y = (v) => m.t + (1 - (v - lo) / (hi - lo)) * (H - m.t - m.b);

    const svg = document.createElementNS(SVG_NS, 'svg');
    svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
    const el = (tag, attrs, parent = svg) => {
      const n = document.createElementNS(SVG_NS, tag);
      for (const k in attrs) n.setAttribute(k, attrs[k]);
      parent.appendChild(n);
      return n;
    };

    // Recessive grid + y axis labels.
    const grid = el('g', { class: 'grid' });
    const axis = el('g', { class: 'axis' });
    for (let v = lo; v <= hi + step / 1000; v += step) {
      el('line', { x1: m.l, x2: W - m.r, y1: y(v), y2: y(v) }, grid);
      el('text', { x: m.l - 8, y: y(v) + 4, 'text-anchor': 'end' }, axis).textContent = `S$${v.toFixed(decimals)}`;
    }
    const tickEvery = Math.max(1, Math.ceil(days.length / 6));
    days.forEach((d, i) => {
      if (i % tickEvery && i !== days.length - 1) return;
      el('text', { x: x(d), y: H - 6, 'text-anchor': days.length === 1 ? 'middle' : i === 0 ? 'start' : i === days.length - 1 ? 'end' : 'middle' }, axis).textContent = fmtDay(d);
    });

    const cross = el('line', { class: 'cross', y1: m.t, y2: H - m.b, visibility: 'hidden' });
    const showMarkers = days.length <= 20;
    const hoverDots = [];
    for (const s of series) {
      const g = el('g', { class: 'series' });
      if (s.points.length > 1) {
        el('path', { d: s.points.map((p, i) => `${i ? 'L' : 'M'}${x(p.day).toFixed(1)},${y(p.v).toFixed(1)}`).join(''), stroke: color(s.id) }, g);
      }
      if (showMarkers || s.points.length === 1) for (const p of s.points) el('circle', { cx: x(p.day), cy: y(p.v), r: 4, fill: color(s.id) }, g);
      hoverDots.push({ s, dot: el('circle', { r: 5, fill: color(s.id), visibility: 'hidden' }, g) });
    }

    // Crosshair + tooltip, snapped to the nearest day.
    const tip = $('#h-tip');
    const hit = el('rect', { x: m.l, y: m.t, width: W - m.l - m.r, height: H - m.t - m.b, fill: 'transparent' });
    const hide = () => { tip.hidden = true; cross.setAttribute('visibility', 'hidden'); hoverDots.forEach((h) => h.dot.setAttribute('visibility', 'hidden')); };
    hit.addEventListener('pointerleave', hide);
    hit.addEventListener('pointermove', (e) => {
      const pt = svg.getBoundingClientRect();
      const sx = ((e.clientX - pt.left) / pt.width) * W;
      const day = days.reduce((best, d) => (Math.abs(x(d) - sx) < Math.abs(x(best) - sx) ? d : best), days[0]);
      cross.setAttribute('x1', x(day)); cross.setAttribute('x2', x(day)); cross.setAttribute('visibility', 'visible');
      const rows = [];
      for (const h of hoverDots) {
        const p = h.s.points.find((q) => q.day === day);
        if (!p) { h.dot.setAttribute('visibility', 'hidden'); continue; }
        h.dot.setAttribute('cx', x(day)); h.dot.setAttribute('cy', y(p.v)); h.dot.setAttribute('visibility', 'visible');
        rows.push({ s: h.s, v: p.v });
      }
      rows.sort((a, b) => a.v - b.v);
      tip.innerHTML = `<b>${fmtDay(day)}</b>${rows.map((r) => `<div><span><i style="background:${color(r.s.id)}"></i>${esc(r.s.name)}</span><em>${money(r.v)}</em></div>`).join('') || '<div>No data</div>'}`;
      tip.hidden = false;
      const card = chartEl.parentElement.getBoundingClientRect();
      const left = e.clientX - card.left + 14;
      tip.style.left = `${Math.min(left, card.width - tip.offsetWidth - 8)}px`;
      tip.style.top = `${e.clientY - card.top + 14}px`;
    });
    chartEl.appendChild(svg);
  }

  $('#h-finish').addEventListener('change', renderHistory);
  $('#h-view').addEventListener('click', (e) => {
    const on = e.currentTarget.getAttribute('aria-pressed') !== 'true';
    e.currentTarget.setAttribute('aria-pressed', String(on));
    e.currentTarget.textContent = on ? 'Show chart' : 'Show table';
    renderHistory();
  });

  /* ---------------- Trending (recently tracked cards) ---------------- */

  async function loadTrending() {
    try {
      const headers = await authHeaders();
      if (!headers) return ($('#trending').hidden = true);
      const res = await fetch('/api/trending', { headers });
      if (!res.ok) return ($('#trending').hidden = true);
      const json = await res.json();
      const cards = json.cards || [];
      $('#trending').hidden = !json.enabled || !cards.length;
      $('#trending-list').innerHTML = cards
        .map((c) => {
          const now = c.cheapest_now == null ? null : Number(c.cheapest_now);
          const before = c.cheapest_7d_ago == null ? null : Number(c.cheapest_7d_ago);
          let change = '';
          if (now != null && before) {
            const pct = ((now - before) / before) * 100;
            if (Math.abs(pct) >= 0.5) change = ` <span class="${pct < 0 ? 'down' : 'up'}">${pct < 0 ? '▼' : '▲'}${Math.abs(pct).toFixed(0)}% 7d</span>`;
          }
          return `<li><button type="button" data-card="${esc(c.card_name)}">${esc(c.card_name)} <span class="tp">${now != null ? `from ${money(now)}` : ''}${change}</span></button></li>`;
        })
        .join('');
    } catch (err) {
      console.warn('trending failed', err);
    }
  }

  $('#trending-list').addEventListener('click', (e) => {
    const b = e.target.closest('button[data-card]');
    if (b) choose(b.dataset.card);
  });

  function renderCard() {
    const c = currentCard || {};
    $('#card-name').textContent = c.name || '';
    $('#card-type').textContent = [c.typeLine, c.manaCost].filter(Boolean).join(' · ');
    $('#card-ref').textContent = c.usd ? `Scryfall reference (USD): $${c.usd}${c.usdFoil ? ` · foil $${c.usdFoil}` : ''}` : '';
    const img = $('#card-img');
    if (c.image) { img.src = c.image; img.alt = c.name; img.hidden = false; } else { img.hidden = true; }
    $('#card-scryfall').href = c.scryfallUri || `https://scryfall.com/search?q=${encodeURIComponent(`!"${c.name}"`)}`;
    $('#card-gatherer').href = c.gathererUri || `https://gatherer.wizards.com/search?name=${encodeURIComponent(c.name || '')}`;
  }

  function filters() {
    return {
      stock: $('#f-stock').checked,
      finish: $('#f-finish').value,
      cond: $('#f-cond').value,
    };
  }

  function applyFilters(listings) {
    const f = filters();
    return listings.filter(
      (l) => (!f.stock || l.inStock) && (!f.finish || l.finish === f.finish) && (!f.cond || l.condition === f.cond),
    );
  }

  function render() {
    // Summary tiles
    const cheapest = {};
    for (const s of stores) {
      const r = results[s.id];
      if (r?.status === 'ok') {
        const filtered = applyFilters(r.data.listings);
        cheapest[s.id] = filtered.reduce((m, l) => (m && m.price <= l.price ? m : l), null);
      }
    }
    const bestPrice = Math.min(...Object.values(cheapest).filter(Boolean).map((l) => l.price));

    const rank = (s) => {
      const r = results[s.id] || {};
      if (r.status === 'ok' && cheapest[s.id]) return [0, cheapest[s.id].price];
      if (r.status === 'loading') return [1, 0];
      if (r.status === 'ok') return [2, 0];
      return [3, 0];
    };
    const ordered = stores
      .map((s, i) => ({ s, i, k: rank(s) }))
      .sort((a, b) => a.k[0] - b.k[0] || a.k[1] - b.k[1] || a.i - b.i)
      .map((x) => x.s);

    $('#summary').innerHTML = ordered
      .map((s) => {
        const r = results[s.id] || {};
        if (r.status === 'loading') {
          return `<div class="store-tile"><span class="name">${esc(s.name)}</span><div class="spinner" aria-label="Loading"></div></div>`;
        }
        if (r.status === 'error') {
          return `<div class="store-tile"><span class="name">${esc(s.name)}</span>
            <span class="err">Couldn't load prices</span><span class="meta">${esc(r.data?.error || '')}</span>
            <a class="meta" href="${esc(r.data?.searchUrl || s.homepage)}" target="_blank" rel="noopener">Search on site ↗</a></div>`;
        }
        const best = cheapest[s.id];
        const total = r.data.listings.length;
        const shown = applyFilters(r.data.listings).length;
        const isBest = best && best.price === bestPrice;
        return `<div class="store-tile ${isBest ? 'best' : ''}">
          <span class="name">${esc(s.name)} ${isBest ? '<span class="badge">Cheapest</span>' : ''}</span>
          <span class="price">${best ? money(best.price) : '—'}</span>
          <span class="meta">${best ? `${esc(best.set || best.title)} · ${esc(best.condition || '')} ${best.finish === 'foil' ? '· Foil' : ''}` : total ? 'None match filters' : 'Not listed'}</span>
          <span class="meta">${shown} of ${total} listing${total === 1 ? '' : 's'} · <a href="${esc(best ? best.url : r.data.searchUrl)}" target="_blank" rel="noopener">Open ↗</a></span>
        </div>`;
      })
      .join('');

    // Combined table
    const nameOf = Object.fromEntries(stores.map((s) => [s.id, s.name]));
    const rows = stores
      .flatMap((s) => (results[s.id]?.status === 'ok' ? applyFilters(results[s.id].data.listings).map((l) => ({ ...l, store: s.id })) : []))
      .sort((a, b) => a.price - b.price);

    $('#count').textContent = rows.length ? `(${rows.length})` : '';
    const visible = rows.slice(0, tableLimit);
    const remaining = rows.length - visible.length;
    $('#table-more').hidden = remaining <= 0;
    $('#table-more').textContent = `Show next ${Math.min(PAGE_SIZE, remaining)}`;
    $('#table-shown').textContent = rows.length > PAGE_SIZE ? `Showing ${visible.length} of ${rows.length}` : '';
    $('#table tbody').innerHTML = rows.length
      ? visible
          .map(
            (l) => `<tr class="${l.inStock ? '' : 'oos'}">
            <td class="price">${money(l.price)}</td>
            <td>${esc(nameOf[l.store])}</td>
            <td class="title">${esc(l.title)}<span class="set">${esc([l.set, l.setCode && l.setCode !== l.set ? l.setCode : ''].filter(Boolean).join(' · '))}</span></td>
            <td>${esc(l.condition || '—')}</td>
            <td>${l.finish === 'foil' ? '<span class="foil">Foil</span>' : 'Non-foil'}</td>
            <td>${l.inStock ? (l.stock != null ? esc(l.stock) : 'In stock') : 'Out'}</td>
            <td><a href="${esc(l.url)}" target="_blank" rel="noopener">View ↗</a></td>
          </tr>`,
          )
          .join('')
      : `<tr><td colspan="7" class="muted">${Object.values(results).some((r) => r.status === 'loading') ? 'Searching stores…' : 'No listings match.'}</td></tr>`;
    if (ck && ck.status === 'ok') renderCk(); // keep the "cheapest in Singapore" comparison current
  }

  ['#f-stock', '#f-finish', '#f-cond'].forEach((sel) =>
    $(sel).addEventListener('change', () => {
      tableLimit = PAGE_SIZE;
      render();
    }),
  );
  $('#table-more').addEventListener('click', () => {
    tableLimit += PAGE_SIZE;
    render();
  });
  $('#refresh').addEventListener('click', () => currentCard && compare(currentCard.name || input.value.trim(), { refresh: true }));

  /* ---------------- Boot ---------------- */

  fetch('/api/stores')
    .then((r) => r.json())
    .then((s) => {
      stores = s;
      loadTrending();
      const initial = new URLSearchParams(location.search).get('card');
      if (initial) choose(initial);
    });
})();
