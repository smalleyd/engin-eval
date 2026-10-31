# Job importer

A Node.js/TypeScript command-line tool that synchronizes a local JSON job list
with one local XML snapshot or a Greenhouse Harvest API snapshot per run.
The XML mode needs no API credentials.

## Setup and run

Requires Node.js 22 or newer and npm.

```sh
npm ci
npm start -- examples/01-development-feed.xml
```

The command compiles TypeScript and imports the feed into `./jobs.json`. Supply a
second positional argument to choose a different saved file:

```sh
npm start -- path/to/feed.xml path/to/saved-jobs.json
npm start -- --help
```

The output directory must already exist. A missing JSON file starts as an empty
list. Once built, `node dist/cli.js feed.xml [jobs.json]` avoids recompiling.
Paths containing spaces should be quoted.

## Greenhouse Harvest v3

Set `GREENHOUSE_CLIENT_ID` and `GREENHOUSE_CLIENT_SECRET` in the environment,
then run:

```sh
npm start -- greenhouse
# Defaults to ./greenhouse-jobs.json

npm start -- greenhouse path/to/greenhouse-jobs.json
```

For local credentials in `test.env`, compile and use Node's environment loader:

```sh
npm run build
node --env-file=test.env dist/cli.js greenhouse
```

`test.env` is ignored by Git. It should contain these keys with your own values:

```dotenv
GREENHOUSE_CLIENT_ID=your-client-id
GREENHOUSE_CLIENT_SECRET=your-client-secret
```

The module does not load environment files implicitly. Existing process
environment values take precedence when Node loads `test.env`.

[`src/greenhouse.ts`](src/greenhouse.ts) exports:

- `getGreenhouseAccessToken(options?)`: exchange environment credentials for an
  access token using POST and HTTP Basic authentication at
  `https://auth.greenhouse.io/token?grant_type=client_credentials`.
- `fetchGreenhouseJobs(options?)`: retrieve all pages of active, live, external
  job posts from `https://harvest.greenhouse.io/v3/job_posts` using the token as
  Bearer authentication, returning source rows.
- `importGreenhouseJobs(saved, options?)`: fetch the complete snapshot and apply
  the same validation, duplicate handling, and reconciliation rules as XML.

Options accept an `env` object and an injectable `fetch` function for testing;
production defaults are `process.env` and the built-in `fetch`.

Mapping uses **job post** `id` (converted to a string), `title`, `content` as
description, and `public_url` as apply URL. The parent `job_id` is not the source
ID: one job can have several posts. The endpoint does not supply a location
field, so location is `""`. Null content becomes `""`. HTML content is retained.
A missing title or public URL rejects that ID using the shared validation rules.

The initial request uses `active=true&live=true&internal=false&per_page=500`.
This makes the local list a snapshot of published external listings. Posts that
are unpublished, deleted, or changed to internal disappear from that snapshot
and their saved records close. Pagination follows the exact next cursor URL
from the `Link` header, without adding filters to subsequent requests. All pages
must succeed before reconciliation or storage begins. Use a separate saved file
for Greenhouse and XML; each import treats its source as the complete snapshot.

Tokens stay in memory for one import. A 401 triggers one token renewal and retry
of that page; repeated 401s, other HTTP errors (including 429), malformed
responses, unsafe pagination links, and network failures abort the import and
leave storage unchanged. Requests time out after 30 seconds and do not follow
redirects. Errors omit response bodies and transport details to avoid exposing
credentials. Rate limits are reported as failures; rerun after the server's
rate-limit window rather than relying on automatic retries.

Credentials need the `harvest:job_posts:list` scope and appropriate Greenhouse
permissions. See the official [token reference](https://harvestdocs.greenhouse.io/reference/generate-token),
[authentication guide](https://harvestdocs.greenhouse.io/docs/authentication),
[job posts reference](https://harvestdocs.greenhouse.io/reference/get_v3-job-posts),
and [pagination guide](https://harvestdocs.greenhouse.io/docs/pagination).

```sh
npm test
# Offline tests, including mocked Greenhouse HTTP requests. No credentials needed.

npm run test:greenhouse:live
# Explicit live check: loads test.env, fetches all pages, prints only a count.
# Does not read or write a saved job list.
```

## Import behavior

Each feed is the **complete current snapshot**. Jobs are matched by their source
`id`, retained as a string (including leading zeros). The saved JSON is an array:

```json
[
  {
    "id": "000101",
    "title": "Customer Support Associate",
    "location": "Austin, TX",
    "description": "<p>Example description.</p>",
    "applyUrl": "https://example.com/jobs/000101",
    "status": "open"
  }
]
```

- New accepted IDs are added as `open`. Changed accepted jobs are updated, and
  previously closed accepted jobs reopen.
- Saved IDs completely absent from a feed become `closed`; records are retained.
  A valid `<jobs/>` closes all open jobs.
- An unreadable file, malformed XML, wrong root, or any missing/blank job ID
  rejects the entire import. The saved file is untouched.
- Blank titles and missing/invalid apply URLs reject that ID only. If any row
  for an ID is invalid, all rows for that ID are rejected for the run.
- Identical valid duplicate rows import once. Conflicting valid rows reject
  their ID. Rejected saved IDs keep their previous data **and status**; their
  presence prevents closure. Other accepted IDs are still processed.
- IDs, titles, and URLs are trimmed. URLs require an explicit HTTP/HTTPS scheme,
  a host, and no whitespace. URLs are checked syntactically, without requests.
- Missing location/description becomes `""`. Otherwise their parsed text is
  preserved, including whitespace. Escaped XML and CDATA descriptions both work.
  XML entities are decoded and XML line-ending normalization applies; there is
  no additional text or HTML normalization.
- Only direct `<job>` children of `<jobs>` and the five named source fields are
  used. Other tags and attributes do not become saved fields. Status is derived
  by the importer, never taken from XML.

Every successful run prints counts of added, updated, unchanged, and newly
closed saved jobs. Reopened jobs count as updated. Unchanged includes existing
rejected jobs and already-closed jobs still absent from the feed; rejected new
IDs do not contribute to these counts. Rejections include the ID, the 1-based
job row number, and the reason on stderr.

Exit code `0` means the snapshot was processed, including runs with individual
ID rejections. Exit code `1` means a fatal input, storage, or usage failure.
Failed runs print an error instead of success counts.

## Demo and verification

`examples/01-development-feed.xml` is a local copy of the
[development feed linked in the requirements](https://s3.us-east-2.amazonaws.com/dev-images.engin.fit/miniproject/01-development-feed.xml).
The other examples are authored fixtures. Pick a new destination filename for
a fresh demo:

```sh
npm start -- examples/01-development-feed.xml /tmp/job-loader-demo.json
# Added: 3; updated: 0; unchanged: 0; newly closed: 0

npm start -- examples/02-changes.xml /tmp/job-loader-demo.json
# Added: 1; updated: 1; unchanged: 1; newly closed: 1

npm start -- examples/02-changes.xml /tmp/job-loader-demo.json
# Added: 0; updated: 0; unchanged: 4; newly closed: 0

npm start -- examples/01-development-feed.xml /tmp/job-loader-demo.json
# Added: 0; updated: 2; unchanged: 1; newly closed: 1
```

The final run reopens `DEV-103`, restores `000101`'s original title, and closes
`DEV-104`. Inspect the destination JSON to see all retained records.

Further examples:

```sh
npm start -- examples/03-invalid-rows.xml /tmp/job-loader-demo.json
# Preserve 000101 and DEV-102, report their rejections, add DEV-105 once,
# and close any open IDs absent from this snapshot.

npm start -- examples/05-missing-id.xml /tmp/job-loader-demo.json
# Exit 1: the saved JSON must remain byte-for-byte unchanged.

npm start -- examples/04-empty.xml /tmp/job-loader-demo.json
# Close every remaining open record without deleting any records.

npm test
```

Automated tests use Node's built-in test runner. They cover the snapshot lifecycle,
idempotency, leading-zero IDs, normalization, escaped HTML/CDATA, duplicate
conflicts, invalid rows in either order, empty feeds, malformed XML, missing IDs,
corrupt storage, same input/output protection, and persisted data preservation on
failure. Integration tests use isolated temporary directories and remove them
afterward.

## Decisions and limitations

- `src/importer.ts` parses and reconciles in memory without file access.
  `saxes` supplies strict XML parsing rather than attempting to parse XML with
  regular expressions. All rows and IDs are checked before reconciliation.
- `src/storage.ts` validates existing saved data and refuses to overwrite corrupt
  JSON or duplicate saved IDs. Writes use an exclusive temporary file in the
  destination directory, flush it, then rename it over the destination. No-op
  imports leave an existing file untouched, including its formatting.
- `src/cli.ts` handles arguments, filesystem operations, reporting, and exit codes.
  Existing job order is retained; new jobs are appended in first-seen order.
- Feeds are UTF-8, non-namespaced XML using the supplied schema. DTDs/custom
  entities and repeated known field elements within one job are unsupported and
  reject the file. Description HTML must be escaped XML text or CDATA as specified.
- The feed and saved list fit in memory. Run only one importer at a time for a
  given destination: there is no cross-process lock. Atomic replacement prevents
  partial JSON writes, but concurrent processes could overwrite each other's work.
  Directory metadata is not fsynced, so full power-loss durability is not claimed.
- There is no UI, server, scheduler, deployment, or physical deletion of jobs.
  Unused `public/` assets from the original starter are not part of the CLI build.
