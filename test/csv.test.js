'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { cell, toCsv, slug } = require('../public/csv.js');

test('cells are quoted, with quotes, commas and line breaks kept intact', () => {
  assert.equal(cell('Lightning Bolt'), '"Lightning Bolt"');
  assert.equal(cell('Mox "Ruby", 2nd'), '"Mox ""Ruby"", 2nd"');
  assert.equal(cell('line1\nline2'), '"line1\nline2"');
  assert.equal(cell(null), '""');
  assert.equal(cell(undefined), '""');
});

test('numbers stay numbers, including negatives', () => {
  assert.equal(cell(12.5), '"12.5"');
  assert.equal(cell(0), '"0"');
  assert.equal(cell(-3), '"-3"', 'a negative number is not treated as a formula');
  assert.equal(cell(NaN), '""');
});

test('text that a spreadsheet would run as a formula is made harmless', () => {
  assert.equal(cell('=HYPERLINK("http://evil","click")'), `"'=HYPERLINK(""http://evil"",""click"")"`);
  assert.equal(cell('+1+1'), `"'+1+1"`);
  assert.equal(cell('-2+3'), `"'-2+3"`);
  assert.equal(cell('@SUM(A1)'), `"'@SUM(A1)"`);
  assert.equal(cell('\t=1'), `"'\t=1"`);
  assert.equal(cell('Sol Ring = good'), '"Sol Ring = good"', 'only a leading = counts');
});

test('a CSV file starts with a byte-order mark and uses Windows line endings', () => {
  const csv = toCsv(['Card', 'Price (SGD)'], [['Mjölnir, Hammer of Thor', 18.64], ['Sol Ring', 2.47]]);
  assert.ok(csv.startsWith('﻿'), 'BOM so Excel reads UTF-8');
  assert.equal(csv, '﻿"Card","Price (SGD)"\r\n"Mjölnir, Hammer of Thor","18.64"\r\n"Sol Ring","2.47"\r\n');
});

test('file names are safe', () => {
  assert.equal(slug('Lightning Bolt'), 'lightning-bolt');
  assert.equal(slug('Mjölnir, Hammer of Thor'), 'mjolnir-hammer-of-thor');
  assert.equal(slug('Emeritus of Woe // Demonic Tutor'), 'emeritus-of-woe-demonic-tutor');
  assert.equal(slug('../../etc/passwd'), 'etc-passwd');
  assert.equal(slug(''), 'export');
});
