'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { parseChat, resolveRange, analyze, renderMarkdown, analyzeAlerts, renderAlertsMarkdown } = require('../tools/whatsapp-digest');

const ANDROID = `13/11/2026, 09:15 - Messages and calls are end-to-end encrypted.
13/11/2026, 09:16 - Alice: WTS Sheoldred NM $95, Ragavan S$70
13/11/2026, 09:20 - Bob: interested in sheoldred
can meet at Agora?
13/11/2026, 21:05 - Bob: <Media omitted>
14/11/2026, 10:00 - Carol joined using this group's invite link
14/11/2026, 10:01 - Carol: anyone know when the next prerelease is?
14/11/2026, 10:30 - Carol: https://www.agorahobby.com/store/events
19/11/2026, 18:00 - Alice: This message was deleted`;

const IOS = `[11/13/26, 9:16:02 PM] Alice: WTB Ragavan
[11/13/26, 9:17:40 PM] Bob: Got one for $70 <This message was edited>`;

test('parses Android exports with multi-line and system messages', () => {
  const { messages, order } = parseChat(ANDROID);
  assert.equal(order, 'dmy');
  assert.equal(messages.length, 8);
  assert.equal(messages[0].sender, null);
  assert.equal(messages[2].sender, 'Bob');
  assert.equal(messages[2].text, 'interested in sheoldred\ncan meet at Agora?');
  assert.equal(new Date(messages[1].time).toISOString(), '2026-11-13T09:16:00.000Z');
});

test('parses iOS exports with month-first dates, 12-hour times and edit markers', () => {
  const { messages, order } = parseChat(IOS);
  assert.equal(order, 'mdy');
  assert.equal(new Date(messages[0].time).toISOString(), '2026-11-13T21:16:02.000Z');
  assert.equal(messages[1].text, 'Got one for $70');
});

test('week ends on the last day of the export; day and explicit ranges work', () => {
  const { messages } = parseChat(ANDROID);
  assert.equal(resolveRange(messages, { period: 'week' }).label, '2026-11-13 to 2026-11-19');
  assert.equal(resolveRange(messages, { period: 'day', date: '2026-11-14' }).label, '2026-11-14');
  const r = analyze(messages, resolveRange(messages, { from: '2026-11-13', to: '2026-11-13' }));
  assert.equal(r.total, 3);
});

test('reports members, trades, media, links, joins and unanswered questions', () => {
  const { messages } = parseChat(ANDROID);
  const r = analyze(messages, resolveRange(messages, { period: 'week' }));
  assert.equal(r.total, 6);
  assert.deepEqual(r.senders[0], ['Alice', 2]);
  assert.equal(r.media, 1);
  assert.equal(r.deleted, 1);
  assert.equal(r.trades.length, 1);
  assert.deepEqual(r.domains, [['agorahobby.com', 1]]);
  assert.equal(r.joins.length, 1);
  assert.deepEqual(r.questions.map((q) => q.sender), ['Bob', 'Carol']); // nobody else posted within an hour of either
  const md = renderMarkdown(r, 'MTG SG');
  assert.match(md, /# MTG SG: insights for 2026-11-13 to 2026-11-19/);
  assert.match(md, /WTS Sheoldred/);
});

const OPS = `[10/30/26, 8:00:00 AM] Ops Bot: <image omitted> INC1000001
[APP2] Queue consumer idle - PRD
major
Resource
OrderService
Description
OrderService has no consumption in the last hour.
[10/30/26, 8:30:00 AM] Ops Bot: <image omitted> Hi @~Sam, daily DLQ summary for 30 Oct
[10/30/26, 9:00:00 AM] Ops Bot: INC1000001
Reopened
[APP2] Queue consumer idle - PRD
major
Resource
OrderService
Description
OrderService has no consumption in the last hour.
@~Priya
[10/30/26, 9:05:00 AM] Priya: Ack
[10/30/26, 9:10:00 AM] Bot Watcher: why does this keep reopening?
[10/31/26, 1:00:00 AM] Ops Bot: <image omitted> INC1000002, INC1000003
[APP3] API Error 404 - PRD
critical
Resource
GET /orders
Description
Error 404 occurred 120 times in last ten minutes.`;

test('alerts mode groups tickets, reopens, severities, routine posts and discussion', () => {
  const { messages } = parseChat(OPS);
  const r = analyzeAlerts(messages, resolveRange(messages, { period: 'all' }));
  assert.equal(r.alerts.length, 3);
  assert.equal(r.tickets, 3);
  assert.deepEqual(r.types.map((t) => [t.title, t.posts]), [['[APP2] Queue consumer idle - PRD', 2], ['[APP3] API Error 404 - PRD', 1]]);
  assert.deepEqual(r.types[1].counts, [120]);
  assert.deepEqual(r.resources[0], ['OrderService', 2]);
  assert.equal(r.critical.length, 1);
  assert.deepEqual(r.repeated.map((t) => [t.id, t.posts, t.reopens]), [['INC1000001', 2, 1]]);
  assert.deepEqual(r.acks, [['Priya', 1]]);
  assert.deepEqual(r.discussion.map((m) => m.sender), ['Bot Watcher']);
  assert.equal(r.routine.length, 1);
  assert.deepEqual(r.mentions.map(([m]) => m), ['Priya']);
  const md = renderAlertsMarkdown(r, 'Ops');
  assert.match(md, /\*\*3\*\* alert posts covering \*\*3\*\* tickets/);
  assert.match(md, /\| INC1000001 \| 2 \| 1 \|/);
});

test('alerts mode accepts a custom ticket pattern', () => {
  const { messages } = parseChat('[10/30/26, 8:00:00 AM] Bot: JIRA-123\n[X] Disk full\nmajor');
  const r = analyzeAlerts(messages, resolveRange(messages, { period: 'all' }), { ticketPattern: String.raw`\bJIRA-\d+\b` });
  assert.equal(r.alerts[0].title, '[X] Disk full');
});
