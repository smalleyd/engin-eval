import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  getGreenhouseAccessToken,
  fetchGreenhouseJobs,
  importGreenhouseJobs,
} from '../dist/greenhouse.js';

const env = {
  GREENHOUSE_CLIENT_ID: 'test-client',
  GREENHOUSE_CLIENT_SECRET: 'test-secret',
};
const token = () =>
  Response.json({
    access_token: 'test-token',
    token_type: 'Bearer',
    expires_in: 3600,
  });
const post = (id, title = 'Engineer') => ({
  id,
  title,
  content: '<p>Hello & welcome</p>',
  public_url: `https://example.com/jobs/${id}`,
  job_id: 99,
});
function transport(responses) {
  const calls = [];
  return {
    calls,
    options: {
      env,
      fetch: async (url, init) => {
        calls.push({ url: String(url), init });
        assert.ok(responses.length, 'Unexpected request');
        const response = responses.shift();
        if (response instanceof Error) throw response;
        return response;
      },
    },
  };
}

test('token exchange uses POST and Basic environment credentials', async () => {
  const { options, calls } = transport([token()]);
  assert.equal(await getGreenhouseAccessToken(options), 'test-token');
  assert.equal(
    calls[0].url,
    'https://auth.greenhouse.io/token?grant_type=client_credentials',
  );
  assert.equal(calls[0].init.method, 'POST');
  assert.equal(
    calls[0].init.headers.Authorization,
    `Basic ${Buffer.from('test-client:test-secret').toString('base64')}`,
  );
  assert.equal(calls[0].init.body, 'grant_type=client_credentials');
  assert.equal(calls[0].init.redirect, 'error');
  assert.ok(calls[0].init.signal instanceof AbortSignal);
});

test('missing credentials fail before making requests', async () => {
  for (const missing of [
    {},
    { GREENHOUSE_CLIENT_ID: 'id' },
    { ...env, GREENHOUSE_CLIENT_SECRET: ' ' },
  ]) {
    await assert.rejects(
      getGreenhouseAccessToken({
        env: missing,
        fetch: async () => assert.fail('unexpected request'),
      }),
      /must be set/,
    );
  }
});

test('fetches all pages using Bearer and cursor-only URL; maps post IDs, content and public URL', async () => {
  const next = 'https://harvest.greenhouse.io/v3/job_posts?cursor=opaque%3D';
  const { options, calls } = transport([
    token(),
    Response.json([post(1)], { headers: { Link: `<${next}>; rel="next"` } }),
    Response.json([{ ...post(2), content: null }]),
  ]);
  const rows = await fetchGreenhouseJobs(options);
  assert.deepEqual(rows[0], {
    id: '1',
    title: 'Engineer',
    description: '<p>Hello & welcome</p>',
    applyUrl: 'https://example.com/jobs/1',
    location: '',
  });
  assert.equal(rows[1].description, '');
  assert.equal(calls[2].url, next);
  const first = new URL(calls[1].url);
  assert.equal(first.searchParams.get('live'), 'true');
  assert.equal(first.searchParams.get('internal'), 'false');
  for (const call of calls.slice(1))
    assert.equal(call.init.headers.Authorization, 'Bearer test-token');
});

test('Greenhouse shares reconciliation rules for updates, closures, invalid IDs, and duplicates', async () => {
  const initial = await importGreenhouseJobs(
    [],
    transport([token(), Response.json([post(1), post(2)])]).options,
  );
  const next = await importGreenhouseJobs(
    initial.jobs,
    transport([token(), Response.json([post(1, 'Senior'), post(3), post(3)])])
      .options,
  );
  assert.deepEqual(next.counts, {
    added: 1,
    updated: 1,
    unchanged: 0,
    newlyClosed: 1,
  });
  const rejected = await importGreenhouseJobs(
    next.jobs,
    transport([
      token(),
      Response.json([{ ...post(1), public_url: null }, post(3)]),
    ]).options,
  );
  assert.deepEqual(rejected.jobs[0], next.jobs[0]);
  assert.equal(rejected.rejections.length, 1);
  const closed = await importGreenhouseJobs(
    next.jobs,
    transport([token(), Response.json([])]).options,
  );
  assert.equal(closed.counts.newlyClosed, 2);
});

test('refreshes expired token and retries the same page once', async () => {
  const { options, calls } = transport([
    token(),
    new Response(null, { status: 401 }),
    Response.json({ access_token: 'renewed' }),
    Response.json([post(1)]),
  ]);
  assert.equal((await fetchGreenhouseJobs(options)).length, 1);
  assert.equal(calls[1].url, calls[3].url);
  assert.equal(calls[3].init.headers.Authorization, 'Bearer renewed');
  const failed = transport([
    token(),
    new Response(null, { status: 401 }),
    token(),
    new Response(null, { status: 401 }),
  ]);
  await assert.rejects(fetchGreenhouseJobs(failed.options), /HTTP 401/);
  assert.equal(failed.calls.length, 4);
});

test('API, JSON, and token errors do not expose response bodies or transport details', async () => {
  for (const response of [
    new Response('test-secret', { status: 403 }),
    Response.json({ access_token: '' }),
    Response.json({ access_token: 'token', token_type: 'Basic' }),
    new Response('not JSON'),
  ]) {
    await assert.rejects(
      getGreenhouseAccessToken(transport([response]).options),
      (error) => !error.message.includes('test-secret'),
    );
  }
  await assert.rejects(
    fetchGreenhouseJobs(transport([new Error('test-secret')]).options),
    /network error/,
  );
  for (const response of [
    Response.json({ data: [] }),
    new Response('bad JSON'),
    new Response('test-secret', { status: 429 }),
  ]) {
    await assert.rejects(
      fetchGreenhouseJobs(transport([token(), response]).options),
    );
  }
});

test('unsafe, malformed, and cyclic pagination fail without forwarding the token', async () => {
  for (const next of [
    'https://evil.example/v3/job_posts?cursor=x',
    'http://harvest.greenhouse.io/v3/job_posts?cursor=x',
    'https://harvest.greenhouse.io/v3/users?cursor=x',
    'https://harvest.greenhouse.io/v3/job_posts?cursor=x&live=true',
  ]) {
    const { options, calls } = transport([
      token(),
      Response.json([post(1)], { headers: { Link: `<${next}>; rel="next"` } }),
    ]);
    await assert.rejects(fetchGreenhouseJobs(options), /pagination/);
    assert.equal(calls.length, 2);
  }
  const next = 'https://harvest.greenhouse.io/v3/job_posts?cursor=x';
  const page = () =>
    Response.json([], { headers: { Link: `<${next}>; rel="next"` } });
  await assert.rejects(
    fetchGreenhouseJobs(transport([token(), page(), page()]).options),
    /repeated a page/,
  );
  await assert.rejects(
    fetchGreenhouseJobs(
      transport([
        token(),
        Response.json([], { headers: { Link: 'malformed' } }),
      ]).options,
    ),
    /Link header/,
  );
});

test('failed later pages and invalid post schemas abort without modifying saved records', async () => {
  const saved = (
    await importGreenhouseJobs(
      [],
      transport([token(), Response.json([post(1)])]).options,
    )
  ).jobs;
  const original = structuredClone(saved);
  const next = 'https://harvest.greenhouse.io/v3/job_posts?cursor=x';
  await assert.rejects(
    importGreenhouseJobs(
      saved,
      transport([
        token(),
        Response.json([post(2)], {
          headers: { Link: `<${next}>; rel="next"` },
        }),
        new Response(null, { status: 500 }),
      ]).options,
    ),
    /HTTP 500/,
  );
  for (const invalid of [
    null,
    {},
    { ...post(1), id: Number.MAX_SAFE_INTEGER + 1 },
    { ...post(1), title: {} },
    { ...post(1), content: [] },
  ]) {
    await assert.rejects(
      importGreenhouseJobs(
        saved,
        transport([token(), Response.json([post(2), invalid])]).options,
      ),
      /entire import rejected/,
    );
  }
  assert.deepEqual(saved, original);
});
