# XML job importer

A Node.js/TypeScript command-line tool that synchronizes a local JSON job list
with one local XML snapshot per run. No API, credentials, database, or UI.

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
