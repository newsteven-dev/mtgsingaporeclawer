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
    render();

    // Card info from Scryfall (canonical name, image).
    fetch(`/api/card?name=${encodeURIComponent(name)}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((card) => {
        if (token !== searchToken) return;
        currentCard = card || { name };
        renderCard();
      });

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
  }

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

    $('#summary').innerHTML = stores
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
    $('#table tbody').innerHTML = rows.length
      ? rows
          .map(
            (l) => `<tr class="${l.inStock ? '' : 'oos'}">
            <td class="price">${money(l.price)}</td>
            <td>${esc(nameOf[l.store])}</td>
            <td class="title">${esc(l.title)}<span class="set">${esc([l.set, l.setCode && l.setCode !== l.set ? l.setCode : ''].filter(Boolean).join(' · '))}</span></td>
            <td>${esc(l.condition || '—')}</td>
            <td>${l.finish === 'foil' ? '<span class="foil">Foil</span>' : 'Non-foil'}</td>
            <td>${l.inStock ? esc(l.stock) : 'Out'}</td>
            <td><a href="${esc(l.url)}" target="_blank" rel="noopener">View ↗</a></td>
          </tr>`,
          )
          .join('')
      : `<tr><td colspan="7" class="muted">${Object.values(results).some((r) => r.status === 'loading') ? 'Searching stores…' : 'No listings match.'}</td></tr>`;
  }

  ['#f-stock', '#f-finish', '#f-cond'].forEach((sel) => $(sel).addEventListener('change', render));
  $('#refresh').addEventListener('click', () => currentCard && compare(currentCard.name || input.value.trim(), { refresh: true }));

  /* ---------------- Boot ---------------- */

  fetch('/api/stores')
    .then((r) => r.json())
    .then((s) => {
      stores = s;
      const initial = new URLSearchParams(location.search).get('card');
      if (initial) choose(initial);
    });
})();
