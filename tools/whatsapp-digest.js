#!/usr/bin/env node
'use strict';

// Turns a WhatsApp "Export chat" .txt file into an insights report (Markdown) for a day, a week or a date range.
// Usage: node tools/whatsapp-digest.js <chat.txt> [--period day|week|all] [--date YYYY-MM-DD]
//        [--from YYYY-MM-DD --to YYYY-MM-DD] [--order dmy|mdy] [--out report.md]

const fs = require('node:fs');

const DAY_MS = 24 * 60 * 60 * 1000;
const DATE = String.raw`(\d{1,4})[./-](\d{1,2})[./-](\d{2,4})`;
const TIME = String.raw`(\d{1,2})[:.](\d{2})(?:[:.](\d{2}))?\s*([AaPp]\.?\s?[Mm]\.?)?`;
const IOS_LINE = new RegExp(String.raw`^\[${DATE},?\s+${TIME}\]\s(.*)$`);
const ANDROID_LINE = new RegExp(String.raw`^${DATE},?\s+${TIME}\s[-–]\s(.*)$`);

const MEDIA_RE = /^<?(?:media omitted|image omitted|video omitted|audio omitted|sticker omitted|gif omitted|document omitted|.*\.(?:jpg|jpeg|png|webp|mp4|opus|pdf) \(file attached\))>?$/i;
const DELETED_RE = /^(?:this message was deleted|you deleted this message)\.?$/i;
const LINK_RE = /https?:\/\/[^\s<>()]+/gi;
const TRADE_RE = /\b(wts|wtb|wtt|lf|lfm|ft|selling|buying|for sale|for trade|trade|trading|looking for|letting go|clearing)\b/i;
const PRICE_RE = /(?:s\$|\$|sgd\s?)\s?\d+(?:[.,]\d{1,2})?|\b\d+(?:[.,]\d{1,2})?\s?(?:sgd|bucks)\b/gi;
const SYSTEM_JOIN_RE = /\b(joined using this group's invite link|joined using an invite link|added|joined)\b/i;
const SYSTEM_LEAVE_RE = /\b(left|removed)\b/i;

const STOPWORDS = new Set(`a about above after again all also am an and any are aren as at be because been before being below
between both but by can cannot could did do does doing don done down during each even few for from further get got had has have
having he her here hers him his how i if in into is isn it its itself just know let like ll lol lor leh lah ya yah yeah yes ok okay
oh me more most much my need no nor not now of off on once one only or other our ours out over own pm am re same she should so
some still such than thank thanks that the their them then there these they thing think this those though through to too u ur
under until up us very was we were what when where which while who whom why will with would you your yours also can't don't i'm
it's that's there's you're i'll i've we're they're dont im its thats also gonna wanna wan see go going come anyone anybody
someone want really right sure tmr today tomorrow later already still guys bro hi hello hey ah eh hmm haha hahaha message
deleted omitted media edited null`.split(/\s+/));

function clean(s) {
  return s.replace(/[‎‏‪-‮﻿]/g, '').replace(/[  ]/g, ' ');
}

function headerMatch(line) {
  return IOS_LINE.exec(line) || ANDROID_LINE.exec(line);
}

// Works out whether dates are day-first or month-first from the export itself (Singapore exports are day-first).
function detectOrder(lines) {
  for (const line of lines) {
    const m = headerMatch(line);
    if (!m || m[1].length === 4) continue;
    if (Number(m[1]) > 12) return 'dmy';
    if (Number(m[2]) > 12) return 'mdy';
  }
  return 'dmy';
}

function toTimestamp(m, order) {
  let [a, b, c] = [m[1], m[2], m[3]].map(Number);
  let y, mo, d;
  if (m[1].length === 4) [y, mo, d] = [a, b, c];
  else if (order === 'mdy') [mo, d, y] = [a, b, c];
  else [d, mo, y] = [a, b, c];
  if (y < 100) y += 2000;
  let h = Number(m[4]);
  const min = Number(m[5]);
  const sec = Number(m[6] || 0);
  const ampm = m[7] && m[7].replace(/[.\s]/g, '').toLowerCase();
  if (ampm === 'pm' && h < 12) h += 12;
  if (ampm === 'am' && h === 12) h = 0;
  // Wall-clock time kept in UTC fields, so the report never shifts with the machine's time zone.
  return Date.UTC(y, mo - 1, d, h, min, sec);
}

function parseChat(text, { order } = {}) {
  const lines = clean(text).split(/\r?\n/);
  const dateOrder = order || detectOrder(lines);
  const messages = [];
  for (const line of lines) {
    const m = headerMatch(line);
    if (!m) {
      if (messages.length) messages[messages.length - 1].text += `\n${line}`;
      continue;
    }
    const rest = m[8];
    const sep = rest.indexOf(': ');
    const time = toTimestamp(m, dateOrder);
    if (sep > 0 && sep < 80) {
      messages.push({ time, sender: rest.slice(0, sep).trim(), text: rest.slice(sep + 2) });
    } else {
      messages.push({ time, sender: null, text: rest }); // system line: joins, leaves, group changes
    }
  }
  for (const msg of messages) msg.text = msg.text.replace(/\s*<This message was edited>\s*$/i, '').trim();
  return { messages, order: dateOrder };
}

function dayKey(t) {
  return new Date(t).toISOString().slice(0, 10);
}

function parseDay(s) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s || '')) throw new Error(`Expected a date like 2026-11-12, got "${s}"`);
  return Date.parse(`${s}T00:00:00Z`);
}

// Returns [start, end) for the requested period. "day" and "week" end on --date, or on the last day in the export.
function resolveRange(messages, { period = 'week', date, from, to } = {}) {
  if (from || to) {
    const start = from ? parseDay(from) : -Infinity;
    const end = to ? parseDay(to) + DAY_MS : Infinity;
    return { start, end, label: `${from || 'start'} to ${to || 'latest'}` };
  }
  if (period === 'all') return { start: -Infinity, end: Infinity, label: 'whole export' };
  const last = messages.length ? messages[messages.length - 1].time : Date.now();
  const endDay = date ? parseDay(date) : parseDay(dayKey(last));
  const end = endDay + DAY_MS;
  if (period === 'day') return { start: endDay, end, label: dayKey(endDay) };
  if (period === 'week') return { start: end - 7 * DAY_MS, end, label: `${dayKey(end - 7 * DAY_MS)} to ${dayKey(endDay)}` };
  throw new Error(`Unknown period "${period}" (use day, week or all)`);
}

function countBy(items, keyFn) {
  const counts = new Map();
  for (const item of items) {
    const k = keyFn(item);
    if (k != null) counts.set(k, (counts.get(k) || 0) + 1);
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1] || String(a[0]).localeCompare(String(b[0])));
}

function analyze(allMessages, range) {
  const inRange = allMessages.filter((m) => m.time >= range.start && m.time < range.end);
  const userMsgs = inRange.filter((m) => m.sender);
  const system = inRange.filter((m) => !m.sender);
  const textMsgs = userMsgs.filter((m) => !MEDIA_RE.test(m.text) && !DELETED_RE.test(m.text));

  const words = [];
  for (const m of textMsgs) {
    const plain = m.text.replace(LINK_RE, ' ').toLowerCase();
    for (const w of plain.match(/[a-z][a-z'’-]{2,}/g) || []) {
      const word = w.replace(/’/g, "'").replace(/^'+|'+$/g, '');
      if (word.length > 2 && !STOPWORDS.has(word)) words.push(word);
    }
  }

  const links = [];
  for (const m of textMsgs) for (const url of m.text.match(LINK_RE) || []) links.push({ ...m, url });

  // A question counts as possibly unanswered when nobody else posts within an hour of it.
  const questions = [];
  for (let i = 0; i < userMsgs.length; i++) {
    const q = userMsgs[i];
    if (!q.text.includes('?') || q.text.replace(LINK_RE, '').trim().length < 8) continue;
    let answered = false;
    for (let j = i + 1; j < userMsgs.length && userMsgs[j].time - q.time <= 60 * 60 * 1000; j++) {
      if (userMsgs[j].sender !== q.sender) { answered = true; break; }
    }
    if (!answered) questions.push(q);
  }

  return {
    range,
    total: userMsgs.length,
    senders: countBy(userMsgs, (m) => m.sender),
    byDay: countBy(userMsgs, (m) => dayKey(m.time)).sort((a, b) => a[0].localeCompare(b[0])),
    byHour: countBy(userMsgs, (m) => new Date(m.time).getUTCHours()),
    media: userMsgs.filter((m) => MEDIA_RE.test(m.text)).length,
    deleted: userMsgs.filter((m) => DELETED_RE.test(m.text)).length,
    terms: countBy(words, (w) => w).slice(0, 20),
    domains: countBy(links, (l) => { try { return new URL(l.url).hostname.replace(/^www\./, ''); } catch { return null; } }),
    links,
    trades: textMsgs.filter((m) => TRADE_RE.test(m.text) || (m.text.match(PRICE_RE) || []).length > 0),
    questions,
    joins: system.filter((m) => SYSTEM_JOIN_RE.test(m.text)),
    leaves: system.filter((m) => SYSTEM_LEAVE_RE.test(m.text) && !SYSTEM_JOIN_RE.test(m.text)),
  };
}

function stamp(t) {
  return new Date(t).toISOString().slice(0, 16).replace('T', ' ');
}

function oneLine(text, max = 160) {
  const s = text.replace(/\s+/g, ' ').trim();
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}

function bar(n, max, width = 20) {
  return '█'.repeat(Math.max(1, Math.round((n / max) * width)));
}

function renderMarkdown(r, title = 'WhatsApp group') {
  const out = [];
  const hourLabel = (h) => `${String(h).padStart(2, '0')}:00–${String(h).padStart(2, '0')}:59`;
  out.push(`# ${title}: insights for ${r.range.label}`, '');
  if (!r.total) {
    out.push('No messages in this period.');
    return out.join('\n');
  }
  const busiestDay = [...r.byDay].sort((a, b) => b[1] - a[1])[0];
  out.push('## At a glance', '');
  out.push(`- **${r.total}** messages from **${r.senders.length}** people`);
  if (r.byDay.length > 1) out.push(`- Busiest day: **${busiestDay[0]}** (${busiestDay[1]} messages)`);
  if (r.byHour.length) out.push(`- Busiest hour: **${hourLabel(r.byHour[0][0])}** (${r.byHour[0][1]} messages)`);
  out.push(`- ${r.media} media files, ${r.links.length} links, ${r.deleted} deleted messages`);
  if (r.joins.length || r.leaves.length) out.push(`- ${r.joins.length} joined or added, ${r.leaves.length} left or removed`);
  out.push('');

  out.push('## Most active members', '', '| Member | Messages | Share |', '| --- | ---: | ---: |');
  for (const [name, n] of r.senders.slice(0, 10)) out.push(`| ${name} | ${n} | ${Math.round((n / r.total) * 100)}% |`);
  if (r.senders.length > 10) out.push(`| *${r.senders.length - 10} others* | ${r.senders.slice(10).reduce((s, [, n]) => s + n, 0)} | |`);
  out.push('');

  if (r.byDay.length > 1) {
    const max = Math.max(...r.byDay.map(([, n]) => n));
    out.push('## Messages per day', '', '```');
    for (const [day, n] of r.byDay) out.push(`${day}  ${bar(n, max)} ${n}`);
    out.push('```', '');
  }

  const hours = [...r.byHour].sort((a, b) => a[0] - b[0]);
  const maxHour = Math.max(...hours.map(([, n]) => n));
  out.push('## When people post', '', '```');
  for (const [h, n] of hours) out.push(`${String(h).padStart(2, '0')}:00  ${bar(n, maxHour)} ${n}`);
  out.push('```', '');

  if (r.terms.length) {
    out.push('## Most mentioned words', '', r.terms.map(([w, n]) => `${w} (${n})`).join(', '), '');
  }

  if (r.trades.length) {
    out.push(`## Buying, selling and prices (${r.trades.length})`, '');
    for (const m of r.trades.slice(0, 40)) out.push(`- ${stamp(m.time)} **${m.sender}**: ${oneLine(m.text)}`);
    if (r.trades.length > 40) out.push(`- …and ${r.trades.length - 40} more`);
    out.push('');
  }

  if (r.questions.length) {
    out.push(`## Possibly unanswered questions (${r.questions.length})`, '', '*Nobody else posted within an hour of these.*', '');
    for (const m of r.questions.slice(0, 25)) out.push(`- ${stamp(m.time)} **${m.sender}**: ${oneLine(m.text)}`);
    out.push('');
  }

  if (r.links.length) {
    out.push(`## Links shared (${r.links.length})`, '');
    out.push(`Top sites: ${r.domains.slice(0, 8).map(([d, n]) => `${d} (${n})`).join(', ')}`, '');
    for (const l of r.links.slice(0, 30)) out.push(`- ${stamp(l.time)} **${l.sender}**: ${l.url}`);
    if (r.links.length > 30) out.push(`- …and ${r.links.length - 30} more`);
    out.push('');
  }

  if (r.joins.length || r.leaves.length) {
    out.push('## Membership changes', '');
    for (const m of [...r.joins, ...r.leaves].sort((a, b) => a.time - b.time)) out.push(`- ${stamp(m.time)} ${oneLine(m.text)}`);
    out.push('');
  }
  return out.join('\n');
}

function parseArgs(argv) {
  const opts = { period: 'week' };
  const positional = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '-h' || a === '--help') opts.help = true;
    else if (a.startsWith('--')) {
      const [key, inline] = a.slice(2).split('=');
      opts[key] = inline !== undefined ? inline : argv[++i];
    } else positional.push(a);
  }
  opts.file = positional[0];
  return opts;
}

function main(argv) {
  const opts = parseArgs(argv);
  if (opts.help || !opts.file) {
    console.log(`Usage: node tools/whatsapp-digest.js <exported-chat.txt> [options]

  --period day|week|all   day = last day in the export, week = the 7 days ending on it (default: week)
  --date YYYY-MM-DD       end the day/week on this date instead
  --from / --to           an explicit date range (inclusive)
  --order dmy|mdy         date order in the export (auto-detected; defaults to day-first)
  --title "Group name"    heading for the report
  --out report.md         write to a file instead of the terminal`);
    return opts.help ? 0 : 1;
  }
  const { messages } = parseChat(fs.readFileSync(opts.file, 'utf8'), { order: opts.order });
  if (!messages.length) {
    console.error('No WhatsApp messages found. Is this the .txt from "Export chat" (unzipped)?');
    return 1;
  }
  const report = renderMarkdown(analyze(messages, resolveRange(messages, opts)), opts.title);
  if (opts.out) {
    fs.writeFileSync(opts.out, `${report}\n`);
    console.error(`Wrote ${opts.out}`);
  } else console.log(report);
  return 0;
}

if (require.main === module) process.exitCode = main(process.argv.slice(2));

module.exports = { parseChat, resolveRange, analyze, renderMarkdown };
