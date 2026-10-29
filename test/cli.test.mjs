import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const cli = resolve('dist/cli.js');
const run = (...args) =>
  spawnSync(process.execPath, [cli, ...args], { encoding: 'utf8' });
const valid =
  '<jobs><job><id>1</id><title>Test</title><applyUrl>https://example.com/1</applyUrl></job></jobs>';

test('CLI persists, reports, preserves bytes on failure and repeats, and reopens', async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'job-loader-test-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const input = join(dir, 'feed.xml');
  const output = join(dir, 'jobs.json');
  await writeFile(input, valid);
  let result = run(input, output);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Added: 1/);
  const original = await readFile(output, 'utf8');
  result = run(input, output);
  assert.match(result.stdout, /unchanged: 1/);
  assert.equal(await readFile(output, 'utf8'), original);
  for (const bad of ['<jobs>', '<wrong/>', '<jobs><job/></jobs>']) {
    await writeFile(input, bad);
    result = run(input, output);
    assert.equal(result.status, 1);
    assert.equal(await readFile(output, 'utf8'), original);
  }
  result = run(join(dir, 'missing.xml'), output);
  assert.equal(result.status, 1);
  assert.equal(await readFile(output, 'utf8'), original);
  await writeFile(input, '<jobs><job><id>1</id><title/></job></jobs>');
  result = run(input, output);
  assert.equal(result.status, 0);
  assert.match(result.stderr, /Rejected ID "1".*title.*applyUrl/);
  assert.equal(await readFile(output, 'utf8'), original);
  await writeFile(input, '<jobs/>');
  assert.match(run(input, output).stdout, /newly closed: 1/);
  await writeFile(input, valid);
  assert.match(run(input, output).stdout, /updated: 1/);
  assert.equal(JSON.parse(await readFile(output, 'utf8'))[0].status, 'open');
  assert.deepEqual((await readdir(dir)).sort(), ['feed.xml', 'jobs.json']);
});

test('corrupt saved JSON and same input/output are never overwritten', async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'job-loader-test-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const input = join(dir, 'feed.xml');
  const output = join(dir, 'jobs.json');
  await writeFile(input, valid);
  for (const corrupt of ['{broken', '{}', '[{"id":"1"}]']) {
    await writeFile(output, corrupt);
    assert.equal(run(input, output).status, 1);
    assert.equal(await readFile(output, 'utf8'), corrupt);
  }
  assert.equal(run(input, input).status, 1);
  assert.equal(await readFile(input, 'utf8'), valid);
  assert.equal(run(input, join(dir, 'missing-directory/jobs.json')).status, 1);
});
