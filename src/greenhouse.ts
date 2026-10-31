import { importJobRows, type Job, type SourceJob } from './importer.js';

const tokenUrl =
  'https://auth.greenhouse.io/token?grant_type=client_credentials';
const postsUrl = 'https://harvest.greenhouse.io/v3/job_posts';

export interface GreenhouseOptions {
  /** Defaults to process.env. Credentials are never loaded from disk implicitly. */
  env?: NodeJS.ProcessEnv;
  /** Injectable transport for deterministic tests. */
  fetch?: typeof globalThis.fetch;
}

function credentials(options: GreenhouseOptions) {
  const env = options.env ?? process.env;
  const clientId = env.GREENHOUSE_CLIENT_ID;
  const clientSecret = env.GREENHOUSE_CLIENT_SECRET;
  if (!clientId?.trim() || !clientSecret?.trim()) {
    throw new Error(
      'GREENHOUSE_CLIENT_ID and GREENHOUSE_CLIENT_SECRET must be set',
    );
  }
  if (clientId.includes(':'))
    throw new Error('GREENHOUSE_CLIENT_ID must not contain a colon');
  return { clientId, clientSecret };
}

async function request(
  url: string,
  init: RequestInit,
  options: GreenhouseOptions,
  label: string,
) {
  try {
    return await (options.fetch ?? globalThis.fetch)(url, {
      ...init,
      redirect: 'error',
      signal: AbortSignal.timeout(30_000),
    });
  } catch {
    // Transport errors and server bodies may echo authorization headers or tokens.
    throw new Error(
      `Greenhouse ${label} request failed (network error, redirect, or timeout)`,
    );
  }
}

async function json(response: Response, label: string): Promise<unknown> {
  if (!response.ok) {
    const text: string = await response.text(); // Added by DLS.
    throw new Error(`Greenhouse ${label} failed (HTTP ${response.status} - ${text})`);
  }
  try {
    return await response.json();
  } catch {
    throw new Error(`Greenhouse ${label} returned invalid JSON`);
  }
}

function object(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/** Exchange client credentials for a fresh access token. Never persist the token. */
export async function getGreenhouseAccessToken(
  options: GreenhouseOptions = {},
): Promise<string> {
  const { clientId, clientSecret } = credentials(options);
  const response = await request(
    tokenUrl,
    {
      method: 'POST',
      headers: {
        Authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`, 'utf8').toString('base64')}`,
        Accept: 'application/json',
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        grant_type: 'client_credentials',
      }).toString(),
    },
    options,
    'token',
  );
  const data = await json(response, 'token');
  if (
    !object(data) ||
    typeof data.access_token !== 'string' ||
    !data.access_token.trim() ||
    /\s/.test(data.access_token) ||
    (data.token_type !== undefined &&
      String(data.token_type).toLowerCase() !== 'bearer')
  ) {
    throw new Error(
      'Greenhouse token response is missing a valid Bearer access_token',
    );
  }
  return data.access_token;
}

function nextPage(link: string | null): string | undefined {
  if (!link) return undefined;
  const match = link.match(/^\s*<([^>]+)>\s*;\s*rel="next"\s*$/);
  if (!match)
    throw new Error('Greenhouse returned an unsupported pagination Link header');
  return match[1];
}

function mapPost(value: unknown, row: number): Partial<SourceJob> {
  if (
    !object(value) ||
    !Number.isSafeInteger(value.id) ||
    (value.id as number) < 1
  ) {
    throw new Error(
      `Greenhouse post ${row} is missing a valid integer ID; entire import rejected`,
    );
  }
  for (const field of ['title', 'content', 'public_url']) {
    if (value[field] != null && typeof value[field] !== 'string') {
      throw new Error(
        `Greenhouse post ${row} has an invalid ${field} type; entire import rejected`,
      );
    }
  }
  return {
    id: String(value.id),
    title: (value.title as string | null | undefined) ?? '',
    description: (value.content as string | null | undefined) ?? '',
    applyUrl: (value.public_url as string | null | undefined) ?? '',
    location: '',
  };
}

/** Fetch a complete snapshot of active, live external posts before reconciliation. */
export async function fetchGreenhouseJobs(
  options: GreenhouseOptions = {},
): Promise<Partial<SourceJob>[]> {
  let token = await getGreenhouseAccessToken(options);
  let url: string | undefined =
    `${postsUrl}?active=true&live=true&internal=false&per_page=500`;
  const visited = new Set<string>();
  const jobs: Partial<SourceJob>[] = [];
  while (url) {
    if (visited.has(url))
      throw new Error(
        'Greenhouse pagination repeated a page; entire import rejected',
      );
    visited.add(url);
    const getPage = () =>
      request(
        url!,
        {
          headers: {
            Authorization: `Bearer ${token}`,
            Accept: 'application/json',
          },
        },
        options,
        'job posts',
      );
    let response = await getPage();
    if (response.status === 401) {
      // A long-running import may outlive the token; retry this page once.
      await response.body?.cancel();
      token = await getGreenhouseAccessToken(options);
      response = await getPage();
    }
    const data = await json(response, 'job posts');
    if (!Array.isArray(data))
      throw new Error('Greenhouse job posts response must be an array');
    for (const post of data) jobs.push(mapPost(post, jobs.length + 1));
    url = nextPage(response.headers.get('link'));
  }
  return jobs;
}

export async function importGreenhouseJobs(
  saved: readonly Job[],
  options: GreenhouseOptions = {},
) {
  return importJobRows(await fetchGreenhouseJobs(options), saved);
}
