import { test } from 'node:test';
import assert from 'node:assert/strict';
import { importJobs } from '../dist/importer.js';

const row = (id, title = 'Engineer', extra = '') =>
  `<job><id>${id}</id><title>${title}</title><applyUrl>https://example.com/jobs/${id.trim()}</applyUrl>${extra}</job>`;
const feed = (...rows) => `<jobs>${rows.join('')}</jobs>`;

test('add, update, close, repeat, and reopen; retain string IDs', () => {
  const first = feed(row('0001'), row('2'));
  const initial = importJobs(first, []);
  assert.equal(initial.jobs[0].id, '0001');
  assert.deepEqual(initial.counts, {
    added: 2,
    updated: 0,
    unchanged: 0,
    newlyClosed: 0,
  });
  const second = feed(row('0001', 'Senior Engineer'), row('3'));
  const next = importJobs(second, initial.jobs);
  assert.deepEqual(next.counts, {
    added: 1,
    updated: 1,
    unchanged: 0,
    newlyClosed: 1,
  });
  assert.equal(next.jobs.find((job) => job.id === '2').status, 'closed');
  const repeated = importJobs(second, next.jobs);
  assert.deepEqual(repeated.jobs, next.jobs);
  assert.deepEqual(repeated.counts, {
    added: 0,
    updated: 0,
    unchanged: 3,
    newlyClosed: 0,
  });
  const reopened = importJobs(first, next.jobs);
  assert.deepEqual(reopened.counts, {
    added: 0,
    updated: 2,
    unchanged: 0,
    newlyClosed: 1,
  });
  assert.equal(reopened.jobs.find((job) => job.id === '2').status, 'open');
});

test('trim required fields, preserve optional text, decode escaped HTML and CDATA equally', () => {
  const xml =
    '<jobs><job><id> 001 </id><title> Engineer </title><applyUrl> https://example.com/1 </applyUrl><location>  Remote\n </location><description>&lt;p&gt;A &amp; B&lt;/p&gt;</description><ignored>anything</ignored></job></jobs>';
  const result = importJobs(xml, []);
  assert.deepEqual(result.jobs[0], {
    id: '001',
    title: 'Engineer',
    applyUrl: 'https://example.com/1',
    location: '  Remote\n ',
    description: '<p>A & B</p>',
    status: 'open',
  });
  const cdata = xml.replace(
    '&lt;p&gt;A &amp; B&lt;/p&gt;',
    '<![CDATA[<p>A & B</p>]]>',
  );
  assert.deepEqual(importJobs(cdata, []).jobs, result.jobs);
  const missing = importJobs(feed(row('2')), []).jobs[0];
  assert.equal(missing.description, '');
  assert.equal(missing.location, '');
});

test('reject entire file for malformed XML, wrong root, or any blank ID', () => {
  for (const xml of [
    '',
    '<jobs>',
    '<jobs><job></jobs>',
    '<other/>',
    '<jobs/><jobs/>',
    feed(row('1'), '<job><title>No ID</title></job>'),
    feed('<job><id> \n </id></job>'),
  ]) {
    assert.throws(() => importJobs(xml, []), undefined, xml);
  }
});

test('identical normalized duplicates import once; differing optional text conflicts', () => {
  const result = importJobs(feed(row(' 01 ', ' Engineer '), row('01')), []);
  assert.equal(result.jobs.length, 1);
  assert.equal(result.rejections.length, 0);
  const conflict = importJobs(
    feed(row('01'), row('01', 'Engineer', '<location> </location>'), row('2')),
    [],
  );
  assert.deepEqual(
    conflict.jobs.map((job) => job.id),
    ['2'],
  );
  assert.match(conflict.rejections[0].reason, /conflicting/);
});

test('invalid rows poison an ID in either order and preserve saved data and status', () => {
  const saved = importJobs(feed(row('1'), row('2'), row('3')), []).jobs;
  saved[1].status = 'closed';
  const invalid =
    '<job><id>1</id><title>Changed</title><applyUrl>ftp://example.com</applyUrl></job>';
  const invalidClosed =
    '<job><id>2</id><title> </title><applyUrl>https://example.com</applyUrl></job>';
  for (const rows of [
    [row('1', 'Changed'), invalid],
    [invalid, row('1', 'Changed')],
  ]) {
    const result = importJobs(feed(...rows, invalidClosed, row('4')), saved);
    assert.deepEqual(result.jobs[0], saved[0]);
    assert.deepEqual(result.jobs[1], saved[1]);
    assert.equal(result.jobs[2].status, 'closed');
    assert.equal(result.jobs[3].id, '4');
    assert.equal(result.rejections.length, 2);
  }
  assert.deepEqual(
    saved.map((job) => job.status),
    ['open', 'closed', 'open'],
  );
});

test('conflicting valid rows preserve existing record regardless of row order', () => {
  const saved = importJobs(feed(row('1')), []).jobs;
  for (const rows of [
    [row('1', 'A'), row('1', 'B')],
    [row('1', 'B'), row('1', 'A')],
  ]) {
    const result = importJobs(feed(...rows), saved);
    assert.deepEqual(result.jobs, saved);
    assert.equal(result.rejections.length, 1);
  }
});

test('empty feed closes all open records and is idempotent', () => {
  const saved = importJobs(feed(row('1'), row('2')), []).jobs;
  const result = importJobs('<jobs/>', saved);
  assert.equal(result.counts.newlyClosed, 2);
  assert.equal(result.jobs.length, 2);
  assert.deepEqual(importJobs('<jobs/>', result.jobs).jobs, result.jobs);
});

test('invalid URLs and missing title reject only their IDs', () => {
  for (const url of [
    '',
    '/relative',
    'ftp://example.com/x',
    'https://',
    'https:example.com',
    'https://example.com/a b',
  ]) {
    const result = importJobs(
      feed(
        `<job><id>1</id><title>T</title><applyUrl>${url}</applyUrl></job>`,
        row('2'),
      ),
      [],
    );
    assert.deepEqual(
      result.jobs.map((job) => job.id),
      ['2'],
    );
    assert.equal(result.rejections.length, 1);
  }
});

test('ignore unrelated tags and nested jobs outside direct root children', () => {
  assert.equal(
    importJobs('<jobs><metadata><job/></metadata></jobs>', []).jobs.length,
    0,
  );
});
