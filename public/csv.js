/*
 * CSV export helpers, shared by the main page and the tests.
 * - Quotes every cell, doubling any quotes inside it.
 * - Starts the file with a UTF-8 byte-order mark so Excel shows "Mjölnir" and "S$" correctly.
 * - Guards against spreadsheet formula injection: text from a store that starts with
 *   = + - @ (or a tab / carriage return) gets a leading apostrophe, so Excel and Google
 *   Sheets show it as text instead of running it. Plain numbers (prices, stock) are left alone.
 */
(function (root) {
  'use strict';

  function cell(value) {
    if (value === null || value === undefined) return '""';
    let s = typeof value === 'number' ? (Number.isFinite(value) ? String(value) : '') : String(value);
    if (typeof value !== 'number' && /^[=+\-@\t\r]/.test(s)) s = `'${s}`;
    return `"${s.replace(/"/g, '""')}"`;
  }

  /** CSV text (with BOM and CRLF line endings) for a header row and data rows. */
  function toCsv(header, rows) {
    const lines = [header, ...rows].map((r) => r.map(cell).join(','));
    return `﻿${lines.join('\r\n')}\r\n`;
  }

  /** A safe file name: "Lightning Bolt" -> "lightning-bolt". */
  function slug(s) {
    return (
      String(s || 'export')
        .normalize('NFKD')
        .replace(/[̀-ͯ]/g, '')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 60) || 'export'
    );
  }

  /** Ask the browser to save the CSV text as a file. */
  function download(filename, csvText) {
    const blob = new Blob([csvText], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  const api = { cell, toCsv, slug, download };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.mtgCsv = api;
})(typeof self !== 'undefined' ? self : this);
